// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type Row = Record<string, unknown>;
type Client = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
};
const modulePath = process.env.DR178_PG_MODULE;
if (
  !modulePath &&
  [process.env.CI, process.env.DR178_REQUIRE_POSTGRES].some((value) =>
    ["1", "true"].includes(value ?? ""),
  )
)
  throw new Error(
    "Staff RPC integration tests require DR178_PG_MODULE and local PG17.",
  );
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const adminUser = uuid(1),
  adminStaff = uuid(2),
  repUser = uuid(3),
  repStaff = uuid(4);
const founderUser = uuid(5),
  founderStaff = uuid(6),
  initialTimetable = uuid(7),
  replacementTimetable = uuid(8),
  initialAssignment = uuid(9);
const enrollment = {
  userId: repUser,
  email: "rep@example.test",
  displayName: "Updated QA Rep",
  timetableId: replacementTimetable,
  enrollment: "access_granted_existing_user",
  invitationSent: false,
  existingAuthUser: true,
};

describe.skipIf(!modulePath)(
  "Worker staff lifecycle PostgreSQL transactions",
  () => {
    let admin: Client, db: Client, contender: Client;
    let created = false;
    let contenderPid: number;
    const database = `dr178_staff_rpc_${process.pid}_${randomUUID().replaceAll("-", "")}`;
    const checkedDatabase = () => {
      if (
        !/^dr178_staff_rpc_[0-9]+_[a-f0-9]{32}$/.test(database) ||
        database.length > 63
      )
        throw new Error("UNSAFE_STAFF_RPC_TEST_DATABASE");
      return database;
    };
    const rows = async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params)).rows;
    const rpc = async (
      client: Client,
      operation: string,
      input: Row,
      actor = adminUser,
    ): Promise<Row> =>
      (
        await client.query(
          "select public.czw_staff_lifecycle($1,$2,$3::jsonb) as result",
          [actor, operation, JSON.stringify(input)],
        )
      ).rows[0].result as Row;
    const accessRows = () =>
      rows("select * from public.class_rep_assignments order by id");
    const activeRows = () =>
      rows(
        "select id,timetable_id from public.class_rep_assignments where active order by id",
      );
    const blocked = async () => {
      if (!Number.isSafeInteger(contenderPid))
        throw new Error("Invalid fixture backend PID");
      // Observe live locks server-side instead of relying on client polling latency.
      await admin.query(`do $$ begin
        for attempt in 1..1000 loop
          if exists(select 1 from pg_locks where pid=${contenderPid} and not granted) then return; end if;
          perform pg_sleep(0.01);
        end loop;
        raise exception 'Expected contender to wait on the lifecycle transaction lock';
      end $$;`);
    };
    const capture = (promise: Promise<Row>) =>
      promise.then(
        (result) => ({ result, error: undefined }),
        (error: unknown) => ({ result: undefined, error }),
      );
    const auditFailure = () =>
      db.query(`create function public.reject_staff_audit() returns trigger language plpgsql as $$
    begin raise exception 'SYNTHETIC_AUDIT_FAILURE'; end $$;
    create trigger reject_staff_audit before insert on public.audit_logs for each row execute function public.reject_staff_audit();`);

    beforeAll(async () => {
      const { Client } = await import(
        /* @vite-ignore */ pathToFileURL(modulePath!).href
      );
      const config = {
        host: "127.0.0.1",
        port: 15478,
        user: "dr178",
        database: "postgres",
      };
      admin = new Client(config);
      await admin.connect();
      expect(
        Math.floor(
          Number(
            (await admin.query("show server_version_num")).rows[0]
              .server_version_num,
          ) / 10000,
        ),
      ).toBe(17);
      await admin.query(`do $$ declare role_name text; begin
      foreach role_name in array array['anon','authenticated','service_role'] loop
        begin
          if not exists(select 1 from pg_roles where rolname=role_name) then execute format('create role %I',role_name); end if;
        exception when duplicate_object or unique_violation then null;
        end;
      end loop;
    end $$;`);
      await admin.query(`create database ${checkedDatabase()}`);
      created = true;
      db = new Client({ ...config, database });
      contender = new Client({ ...config, database });
      await db.connect();
      await contender.connect();
      contenderPid = Number(
        (await contender.query("select pg_backend_pid() as pid")).rows[0].pid,
      );
      for (const client of [db, contender])
        await client.query(
          "set statement_timeout='20s'; set lock_timeout='15s'",
        );
      await db.query(`create schema auth;
      grant usage on schema public to anon,authenticated,service_role;
      create table auth.users(id uuid primary key, email text);
      create table public.timetables(id uuid primary key);
      create table public.admin_users(user_id uuid primary key references auth.users(id),active boolean not null);
      create table public.staff_users(id uuid primary key default gen_random_uuid(),user_id uuid unique not null references auth.users(id),
        role text not null check(role in ('superadmin','admin','class_rep')),is_founder boolean not null default false,
        active boolean not null default true,email text,display_name text,invited_at timestamptz,last_invited_at timestamptz,
        disabled_at timestamptz,created_by uuid references auth.users(id),updated_at timestamptz default now());
      create table public.class_rep_assignments(id uuid primary key default gen_random_uuid(),
        staff_user_id uuid not null references public.staff_users(id),timetable_id uuid not null references public.timetables(id),
        active boolean not null default true,created_by uuid references auth.users(id),revoked_at timestamptz);
      create unique index class_rep_assignments_one_active_idx on public.class_rep_assignments(staff_user_id,timetable_id) where active;
      create table public.audit_logs(id uuid primary key default gen_random_uuid(),actor_id uuid,
        action text not null,entity_type text not null,entity_id uuid,metadata jsonb not null default '{}'::jsonb,created_at timestamptz default now());
      grant select,insert,update,delete on public.staff_users,public.class_rep_assignments,public.audit_logs to service_role;
      grant select on public.admin_users,public.timetables to service_role;`);
      await db.query(
        await readFile(
          new URL(
            "../supabase/migrations/0042_staff_lifecycle_safety.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
    }, 30000);

    beforeEach(async () => {
      await contender.query("rollback");
      await db.query(`rollback; reset role;
      drop trigger if exists reject_staff_audit on public.audit_logs;
      drop function if exists public.reject_staff_audit();
      drop trigger if exists reject_assignment_insert on public.class_rep_assignments;
      drop function if exists public.reject_assignment_insert();
      truncate public.staff_invitation_actor_budgets,public.staff_invitation_cooldowns,public.audit_logs,public.class_rep_assignments,public.staff_users,public.admin_users,public.timetables,auth.users;
      insert into auth.users values ('${adminUser}','admin@example.test'),('${repUser}','rep@example.test'),('${founderUser}','founder@example.test');
      insert into public.timetables values ('${initialTimetable}'),('${replacementTimetable}');
      insert into public.staff_users(id,user_id,role,is_founder,active,email,display_name) values
        ('${adminStaff}','${adminUser}','admin',false,true,'admin@example.test','QA Admin'),
        ('${repStaff}','${repUser}','class_rep',false,true,'rep@example.test','QA Rep'),
        ('${founderStaff}','${founderUser}','superadmin',true,true,'founder@example.test','QA Founder');
      insert into public.class_rep_assignments(id,staff_user_id,timetable_id,active,created_by)
        values ('${initialAssignment}','${repStaff}','${initialTimetable}',true,'${adminUser}');`);
    });
    afterAll(async () => {
      try {
        await contender?.query("rollback");
        await db?.query("rollback");
      } finally {
        await contender?.end();
        await db?.end();
        if (admin)
          try {
            if (created)
              await admin.query(`drop database ${checkedDatabase()}`);
          } finally {
            await admin.end();
          }
      }
    });

    it.each(["assignment insert", "audit insert"])(
      "preserves the original assignment when %s fails after revocation",
      async (failure) => {
        if (failure === "audit insert") await auditFailure();
        else
          await db.query(`create function public.reject_assignment_insert() returns trigger language plpgsql as $$
      begin raise exception 'SYNTHETIC_ASSIGNMENT_FAILURE'; end $$;
      create trigger reject_assignment_insert before insert on public.class_rep_assignments for each row execute function public.reject_assignment_insert();`);
        const before = await accessRows();
        await expect(
          rpc(db, "assign", {
            staffUserId: repStaff,
            timetableId: replacementTimetable,
          }),
        ).rejects.toThrow(/SYNTHETIC_/);
        expect(await accessRows()).toEqual(before);
        expect(await rows("select * from public.audit_logs")).toEqual([]);
      },
    );

    it("keeps same-target retries idempotent, retaining assignment ID and audit count", async () => {
      const before = await accessRows();
      const first = await rpc(db, "assign", {
        staffUserId: repStaff,
        timetableId: initialTimetable,
      });
      const audit = await rows("select * from public.audit_logs order by id");
      expect(
        await rpc(db, "assign", {
          staffUserId: repStaff,
          timetableId: initialTimetable,
        }),
      ).toEqual(first);
      expect(first).toEqual({ id: initialAssignment });
      expect(await accessRows()).toEqual(before);
      expect(await rows("select * from public.audit_logs order by id")).toEqual(
        audit,
      );
    });

    it("serializes simultaneous replacements without retaining multiple active assignments", async () => {
      await db.query("begin");
      const first = await rpc(db, "assign", {
        staffUserId: repStaff,
        timetableId: replacementTimetable,
      });
      const waiting = capture(
        rpc(contender, "assign", {
          staffUserId: repStaff,
          timetableId: initialTimetable,
        }),
      );
      try {
        await blocked();
      } finally {
        await db.query("commit");
      }
      const second = await waiting;
      expect(second.error).toBeUndefined();
      expect(first.id).toBeDefined();
      expect(second.result?.id).toBeDefined();
      expect(await activeRows()).toEqual([
        { id: second.result?.id, timetable_id: initialTimetable },
      ]);
    }, 30_000);

    it.each(["assign", "enroll_class_rep"])(
      "rechecks target role after a concurrent promotion before %s",
      async (operation) => {
        await db.query("begin");
        expect(
          await rpc(
            db,
            "set_role",
            { staffUserId: repStaff, role: "admin" },
            founderUser,
          ),
        ).toEqual({});
        const input =
          operation === "assign"
            ? { staffUserId: repStaff, timetableId: replacementTimetable }
            : enrollment;
        const waiting = capture(rpc(contender, operation, input));
        try {
          await blocked();
        } finally {
          await db.query("commit");
        }
        const result = await waiting;
        expect(result.error).toBeUndefined();
        expect(result.result).toEqual({
          error: {
            code: operation === "assign" ? "NOT_FOUND" : "ROLE_CHANGE_REQUIRED",
          },
        });
        expect(
          (
            await rows("select role from public.staff_users where id=$1", [
              repStaff,
            ])
          )[0].role,
        ).toBe("admin");
        expect(await activeRows()).toEqual([]);
      },
      30_000,
    );

    it("rechecks actor authority after concurrent deactivation instead of trusting transport authorization", async () => {
      await db.query("begin");
      await rows("update public.staff_users set active=false where id=$1", [
        adminStaff,
      ]);
      const before = await accessRows();
      const waiting = capture(
        rpc(contender, "assign", {
          staffUserId: repStaff,
          timetableId: replacementTimetable,
        }),
      );
      try {
        await blocked();
      } finally {
        await db.query("commit");
      }
      const result = await waiting;
      expect(result.error).toBeUndefined();
      expect(result.result).toEqual({
        error: { code: "STAFF_MANAGER_REQUIRED" },
      });
      expect(await accessRows()).toEqual(before);
    }, 30_000);

    it("rolls back staff metadata and assignment changes when enrollment audit fails", async () => {
      const staff = await rows("select * from public.staff_users order by id"),
        assignments = await accessRows();
      await auditFailure();
      await expect(rpc(db, "enroll_class_rep", enrollment)).rejects.toThrow(
        /SYNTHETIC_AUDIT_FAILURE/,
      );
      expect(
        await rows("select * from public.staff_users order by id"),
      ).toEqual(staff);
      expect(await accessRows()).toEqual(assignments);
      expect(await rows("select * from public.audit_logs")).toEqual([]);
    });

    it("allows only one concurrent invitation reservation and retains the committed throttle after audit failure", async () => {
      const reservation = {
        email: "rep@example.test",
        role: "class_rep",
        userId: repUser,
        staffUserId: repStaff,
      };
      await db.query("begin");
      expect(await rpc(db, "reserve_invite", reservation)).toEqual({
        reserved: true,
      });
      const waiting = capture(rpc(contender, "reserve_invite", reservation));
      try {
        await blocked();
      } finally {
        await db.query("commit");
      }
      const result = await waiting;
      expect(result.error).toBeUndefined();
      expect(result.result).toEqual({ error: { code: "INVITE_RATE_LIMITED" } });
      const staff = await rows("select * from public.staff_users order by id");
      await auditFailure();
      await expect(
        rpc(db, "record_resend", {
          ...reservation,
          enrollment: "invite_resent_pending_user",
          invitationSent: true,
        }),
      ).rejects.toThrow(/SYNTHETIC_AUDIT_FAILURE/);
      expect(
        await rows("select * from public.staff_users order by id"),
      ).toEqual(staff);
      expect(await rpc(db, "reserve_invite", reservation)).toEqual({
        error: { code: "INVITE_RATE_LIMITED" },
      });
      expect(
        await rows("select * from public.staff_invitation_cooldowns"),
      ).toHaveLength(1);
    }, 30_000);

    it("does not replace access or reserve an invitation for a missing timetable", async () => {
      const before = await accessRows();
      expect(
        await rpc(db, "assign", {
          staffUserId: repStaff,
          timetableId: uuid(99),
        }),
      ).toEqual({ error: { code: "TIMETABLE_NOT_FOUND" } });
      expect(
        await rpc(db, "reserve_invite", {
          email: "new@example.test",
          role: "class_rep",
          timetableId: uuid(99),
        }),
      ).toEqual({ error: { code: "TIMETABLE_NOT_FOUND" } });
      expect(await accessRows()).toEqual(before);
      expect(
        await rows("select * from public.staff_invitation_cooldowns"),
      ).toEqual([]);
    });

    it("bounds one actor across different recipients without consuming the denied recipient", async () => {
      for (let attempt = 0; attempt < 10; attempt++)
        expect(
          await rpc(db, "reserve_invite", {
            email: `recipient-${attempt}@example.test`,
            role: "class_rep",
          }),
        ).toEqual({ reserved: true });
      const budgets = await rows(
        "select * from public.staff_invitation_actor_budgets order by actor_user_id",
      );
      const recipients = await rows(
        "select * from public.staff_invitation_cooldowns order by recipient_email",
      );
      expect(
        await rpc(db, "reserve_invite", {
          email: "not-consumed@example.test",
          role: "class_rep",
        }),
      ).toEqual({ error: { code: "INVITE_ACTOR_RATE_LIMITED" } });
      expect(
        await rows(
          "select * from public.staff_invitation_actor_budgets order by actor_user_id",
        ),
      ).toEqual(budgets);
      expect(
        await rows(
          "select * from public.staff_invitation_cooldowns order by recipient_email",
        ),
      ).toEqual(recipients);
    });

    it("serializes different actors reserving the same recipient without consuming the losing actor budget", async () => {
      const input = { email: "shared@example.test", role: "class_rep" };
      await db.query("begin");
      expect(await rpc(db, "reserve_invite", input)).toEqual({
        reserved: true,
      });
      const waiting = capture(
        rpc(contender, "reserve_invite", input, founderUser),
      );
      try {
        await blocked();
      } finally {
        await db.query("commit");
      }
      const result = await waiting;
      expect(result.error).toBeUndefined();
      expect(result.result).toEqual({ error: { code: "INVITE_RATE_LIMITED" } });
      expect(
        await rows(
          "select actor_user_id,attempt_count from public.staff_invitation_actor_budgets order by actor_user_id",
        ),
      ).toEqual([{ actor_user_id: adminUser, attempt_count: 1 }]);
      expect(
        await rows(
          "select recipient_email from public.staff_invitation_cooldowns",
        ),
      ).toEqual([{ recipient_email: input.email }]);
    }, 30_000);

    it("does not charge an existing actor budget when a different recipient is already reserved", async () => {
      const input = { email: "shared@example.test", role: "class_rep" };
      expect(await rpc(db, "reserve_invite", input, founderUser)).toEqual({
        reserved: true,
      });
      expect(
        await rpc(db, "reserve_invite", {
          email: "other@example.test",
          role: "class_rep",
        }),
      ).toEqual({ reserved: true });
      const budgets = await rows(
        "select * from public.staff_invitation_actor_budgets order by actor_user_id",
      );
      const recipients = await rows(
        "select * from public.staff_invitation_cooldowns order by recipient_email",
      );
      expect(await rpc(db, "reserve_invite", input)).toEqual({
        error: { code: "INVITE_RATE_LIMITED" },
      });
      expect(
        await rows(
          "select * from public.staff_invitation_actor_budgets order by actor_user_id",
        ),
      ).toEqual(budgets);
      expect(
        await rows(
          "select * from public.staff_invitation_cooldowns order by recipient_email",
        ),
      ).toEqual(recipients);
    });

    it("resets an expired ten-minute actor window without refunding an active recipient cooldown", async () => {
      for (let attempt = 0; attempt < 10; attempt++)
        await rpc(db, "reserve_invite", {
          email: `recipient-${attempt}@example.test`,
          role: "class_rep",
        });
      await rows(
        "update public.staff_invitation_actor_budgets set window_started_at=clock_timestamp()-interval '11 minutes'",
      );
      expect(
        await rpc(db, "reserve_invite", {
          email: "recipient-0@example.test",
          role: "class_rep",
        }),
      ).toEqual({ error: { code: "INVITE_RATE_LIMITED" } });
      expect(
        (
          await rows(
            "select attempt_count from public.staff_invitation_actor_budgets",
          )
        )[0].attempt_count,
      ).toBe(10);
      expect(
        await rpc(db, "reserve_invite", {
          email: "fresh@example.test",
          role: "class_rep",
        }),
      ).toEqual({ reserved: true });
      expect(
        (
          await rows(
            "select attempt_count from public.staff_invitation_actor_budgets",
          )
        )[0].attempt_count,
      ).toBe(1);
    });

    it("persists founder-authorized Admin enrollment and its audit atomically", async () => {
      const result = await rpc(
        db,
        "enroll_admin",
        {
          userId: repUser,
          email: "rep@example.test",
          displayName: "QA Admin promoted",
          enrollment: "invited_new_user",
          invitationSent: true,
          existingAuthUser: false,
        },
        founderUser,
      );
      expect(result).toEqual({
        staffUserId: repStaff,
        enrollment: "invited_new_user",
      });
      expect(
        (
          await rows(
            "select role,is_founder,active,disabled_at,last_invited_at is not null as invited,display_name from public.staff_users where id=$1",
            [repStaff],
          )
        )[0],
      ).toEqual({
        role: "admin",
        is_founder: false,
        active: true,
        disabled_at: null,
        invited: true,
        display_name: "QA Admin promoted",
      });
      expect(await activeRows()).toEqual([]);
      expect(
        await rows("select action from public.audit_logs order by action"),
      ).toEqual([
        { action: "admin.invited" },
        { action: "class_rep.assignments_revoked_for_role_change" },
      ]);
    });

    it("persists disable and reactivation timestamps without changing the Admin role", async () => {
      expect(
        await rpc(
          db,
          "set_active",
          { staffUserId: adminStaff, active: false },
          founderUser,
        ),
      ).toEqual({});
      expect(
        (
          await rows(
            "select role,active,disabled_at is not null as disabled from public.staff_users where id=$1",
            [adminStaff],
          )
        )[0],
      ).toEqual({ role: "admin", active: false, disabled: true });
      expect(
        await rpc(
          db,
          "set_active",
          { staffUserId: adminStaff, active: true },
          founderUser,
        ),
      ).toEqual({});
      expect(
        (
          await rows(
            "select role,active,disabled_at from public.staff_users where id=$1",
            [adminStaff],
          )
        )[0],
      ).toEqual({ role: "admin", active: true, disabled_at: null });
      expect(
        await rows("select action from public.audit_logs order by action"),
      ).toEqual([
        { action: "admin.deactivated" },
        { action: "admin.reactivated" },
      ]);
    });

    it.each([false, true])(
      "records resend enrollment and invitation timestamps correctly (pending=%s)",
      async (pending) => {
        const outcome = pending
          ? "invite_resent_pending_user"
          : "access_granted_existing_user";
        expect(
          await rpc(db, "record_resend", {
            staffUserId: repStaff,
            userId: repUser,
            email: "rep@example.test",
            enrollment: outcome,
            invitationSent: pending,
          }),
        ).toEqual({ enrollment: outcome });
        expect(
          (
            await rows(
              "select role,is_founder,active,last_invited_at is not null as invited from public.staff_users where id=$1",
              [repStaff],
            )
          )[0],
        ).toEqual({
          role: "class_rep",
          is_founder: false,
          active: true,
          invited: pending,
        });
        expect(
          await rows("select action,metadata from public.audit_logs"),
        ).toEqual([
          {
            action: pending
              ? "class_rep.invite_resent"
              : "class_rep.access_confirmed_existing_user",
            metadata: {
              enrollment: outcome,
              existingAuthUser: true,
              invitationSent: pending,
            },
          },
        ]);
        expect(await activeRows()).toEqual([
          { id: initialAssignment, timetable_id: initialTimetable },
        ]);
      },
    );

    it("executes reservation and lifecycle operations with service-role RLS and grants", async () => {
      // Mirror Supabase's existing server role, never a browser role or live grant.
      await db.query(
        "alter role service_role bypassrls; grant update on public.timetables,public.admin_users to service_role; alter table public.staff_users enable row level security; alter table public.class_rep_assignments enable row level security; alter table public.audit_logs enable row level security; set role service_role",
      );
      try {
        expect(
          await rpc(db, "reserve_invite", {
            email: "rep@example.test",
            role: "class_rep",
            userId: repUser,
            staffUserId: repStaff,
          }),
        ).toEqual({ reserved: true });
        const assignment = await rpc(db, "assign", {
          staffUserId: repStaff,
          timetableId: replacementTimetable,
        });
        expect(assignment.id).toEqual(expect.any(String));
        expect(
          await rpc(db, "set_active", { staffUserId: repStaff, active: false }),
        ).toEqual({});
      } finally {
        await db.query("reset role");
      }
      expect(
        (
          await rows(
            "select active,disabled_at is not null as disabled from public.staff_users where id=$1",
            [repStaff],
          )
        )[0],
      ).toEqual({ active: false, disabled: true });
      expect(
        await rows("select action from public.audit_logs order by action"),
      ).toEqual([
        { action: "class_rep.assigned" },
        { action: "class_rep.deactivated" },
      ]);
    });

    it("restricts the RPC and recipient cooldowns to the service boundary", async () => {
      for (const role of ["anon", "authenticated"]) {
        expect(
          (
            await rows(
              "select has_function_privilege($1,'public.czw_staff_lifecycle(uuid,text,jsonb)','EXECUTE') as allowed",
              [role],
            )
          )[0].allowed,
        ).toBe(false);
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
          expect(
            (
              await rows(
                "select has_table_privilege($1,'public.staff_invitation_cooldowns',$2) as allowed",
                [role, privilege],
              )
            )[0].allowed,
          ).toBe(false);
      }
      expect(
        (
          await rows(
            "select has_function_privilege('service_role','public.czw_staff_lifecycle(uuid,text,jsonb)','EXECUTE') as allowed",
          )
        )[0].allowed,
      ).toBe(true);
      for (const role of ["anon", "authenticated"])
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
          expect(
            (
              await rows(
                "select has_table_privilege($1,'public.staff_invitation_actor_budgets',$2) as allowed",
                [role, privilege],
              )
            )[0].allowed,
          ).toBe(false);
      expect(
        (
          await rows(
            "select relrowsecurity from pg_class where oid='public.staff_invitation_cooldowns'::regclass",
          )
        )[0].relrowsecurity,
      ).toBe(true);
      expect(
        (
          await rows(
            "select prosecdef from pg_proc where oid='public.czw_staff_lifecycle(uuid,text,jsonb)'::regprocedure",
          )
        )[0].prosecdef,
      ).toBe(false);
      await db.query("set role authenticated");
      try {
        await expect(
          rpc(db, "assign", {
            staffUserId: repStaff,
            timetableId: replacementTimetable,
          }),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.query("reset role");
      }
    });
  },
);
