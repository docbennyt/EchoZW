// @vitest-environment node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Install PGlite outside the checkout and set this to its dist/index.js.
// No database URLs, credentials, provider requests, or live migrations are used.
const modulePath = process.env.DR178_PGLITE_MODULE;
const pgModulePath = process.env.DR178_PG_MODULE;
if (
  (process.env.CI === "true" ||
    process.env.CI === "1" ||
    ["1", "true"].includes(process.env.DR178_REQUIRE_POSTGRES ?? "")) &&
  !pgModulePath
) {
  throw new Error(
    "Google delivery CI requires PostgreSQL 17 on 127.0.0.1:15478 (user dr178, database postgres) and DR178_PG_MODULE pointing to pg/esm/index.mjs.",
  );
}
type Row = Record<string, unknown>;
type Database = {
  exec(sql: string): Promise<unknown>;
  query<T = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};
const timetable = "00000000-0000-0000-0000-000000000001";
const subscription = "00000000-0000-0000-0000-000000000002";
const second = "00000000-0000-0000-0000-000000000003";

describe.skipIf(!modulePath && !pgModulePath)(
  "Google delivery PostgreSQL contracts",
  () => {
    let db: Database;
    let connect: (() => Promise<Database>) | undefined;
    const rows = async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params)).rows;
    const recover = async (limit = 100) =>
      rows("select recover_google_calendar_delivery($1) as count", [limit]);
    const claim = async (limit = 10) =>
      rows("select * from claim_google_calendar_delivery($1, 300)", [limit]);
    const finish = async (job: Row, outcome = "success") =>
      (
        await rows(
          "select finish_google_calendar_delivery($1, $2, $3, $4, 'TEST_FAILURE') as accepted",
          [job.subscription_id, job.lease_token, job.claimed_revision, outcome],
        )
      )[0].accepted;

    beforeAll(async () => {
      if (pgModulePath) {
        const { Client, types } = await import(
          /* @vite-ignore */ pathToFileURL(pgModulePath).href
        );
        types.setTypeParser(20, Number);
        connect = async () => {
          const client = new Client({
            host: "127.0.0.1",
            port: 15478,
            user: "dr178",
            database: "postgres",
          });
          await client.connect();
          return {
            exec: (sql: string) => client.query(sql),
            query: (sql: string, params?: unknown[]) =>
              client.query(sql, params),
            close: () => client.end(),
          };
        };
        db = await connect();
      } else {
        const { PGlite } = await import(
          /* @vite-ignore */ pathToFileURL(modulePath!).href
        );
        db = new PGlite();
      }
      await db.exec(`
      do $$ declare role_name text; begin
        foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
          begin
            if not exists(select 1 from pg_roles where rolname = role_name) then
              execute format('create role %I', role_name);
            end if;
          exception when duplicate_object or unique_violation then null;
          end;
        end loop;
      end $$;
      drop schema public cascade; create schema public;
      create table public.cohorts(id uuid primary key, programme_id uuid);
      create table public.timetables(id uuid primary key, current_published_version_id uuid, institution_id uuid, cohort_id uuid);
      create table public.timetable_correction_directives(id uuid primary key default gen_random_uuid(), timetable_id uuid, active boolean, venue text);
      create table public.timetable_session_exceptions(id uuid primary key default gen_random_uuid(), timetable_id uuid, active boolean, venue text);
      create table public.academic_schedule_pauses(id uuid primary key default gen_random_uuid(), scope_type text,
        timetable_id uuid, institution_id uuid, programme_id uuid, cohort_id uuid, active boolean, label text);
      create table public.calendar_subscriptions(
        id uuid primary key, timetable_id uuid references timetables(id),
        provider text, status text, revoked_at timestamptz);
      create table public.google_calendar_credentials(
        subscription_id uuid primary key references calendar_subscriptions(id), updated_at timestamptz);
      create table public.push_notification_outbox(
        id uuid primary key default gen_random_uuid(), timetable_id uuid references timetables(id),
        source_kind text, status text default 'pending', dedupe_key text unique);
      insert into timetables(id, current_published_version_id) values ('${timetable}', gen_random_uuid());
      insert into push_notification_outbox(timetable_id, source_kind, status)
        values ('${timetable}', 'correction', 'delivered');
    `);
      await db.exec(
        await readFile(
          new URL(
            "../supabase/migrations/0038_google_calendar_delivery.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      expect(
        (
          await rows("select revision from google_calendar_delivery_revisions")
        )[0].revision,
      ).toBe(1);
    }, 30_000);

    beforeEach(async () => {
      await db.exec(`
      truncate google_calendar_delivery_jobs, google_calendar_credentials, calendar_subscriptions,
        timetable_correction_directives, timetable_session_exceptions, academic_schedule_pauses, cohorts;
      delete from push_notification_outbox;
      delete from timetables where id <> '${timetable}';
      update google_calendar_delivery_revisions set revision = 1;
      insert into calendar_subscriptions values ('${subscription}', '${timetable}', 'google_api', 'active', null);
    `);
    });
    afterAll(async () => {
      await db?.close();
    });

    it.each(["enqueue", "recover"])(
      "recovers a credentialed pending OAuth subscription after %s and a worker crash",
      async (entry) => {
        await db.exec("update calendar_subscriptions set status = 'pending'");
        await rows(
          "insert into google_calendar_credentials values ($1, clock_timestamp())",
          [subscription],
        );
        if (entry === "enqueue") {
          expect(
            (
              await rows(
                "select enqueue_google_calendar_subscription($1) as queued",
                [subscription],
              )
            )[0].queued,
          ).toBe(true);
        } else {
          expect(await recover()).toEqual([{ count: 1 }]);
        }
        expect(
          await rows("select * from list_google_calendar_delivery_ready(10)"),
        ).toEqual([{ subscription_id: subscription }]);
        const [crashed] = await rows(
          "select * from claim_google_calendar_delivery(1,300,$1)",
          [subscription],
        );
        expect(crashed.subscription_id).toBe(subscription);
        expect(await claim()).toEqual([]);
        await db.exec(
          "update google_calendar_delivery_jobs set lease_expires_at = now() - interval '1 second'",
        );
        await recover();
        const [resumed] = await claim();
        expect(resumed.lease_token).not.toBe(crashed.lease_token);
        expect(await finish(crashed)).toBe(false);
        expect(await finish(resumed)).toBe(true);
        expect(
          await rows(
            "select successful_revision from google_calendar_delivery_jobs",
          ),
        ).toEqual([{ successful_revision: 1 }]);
      },
    );

    it("excludes pending OAuth subscriptions without credentials from enqueue, recovery, listing and claims", async () => {
      await db.exec("update calendar_subscriptions set status = 'pending'");
      await rows(
        "insert into calendar_subscriptions select gen_random_uuid(), $1, 'google_api', 'pending', null from generate_series(1,21)",
        [timetable],
      );
      expect(
        (
          await rows(
            "select enqueue_google_calendar_subscription($1) as queued",
            [subscription],
          )
        )[0].queued,
      ).toBe(false);
      expect(await recover()).toEqual([{ count: 0 }]);
      expect(await rows("select * from google_calendar_delivery_jobs")).toEqual(
        [],
      );
      await rows(
        "insert into google_calendar_delivery_jobs(subscription_id, desired_revision) values ($1, 1)",
        [subscription],
      );
      expect(
        await rows("select * from list_google_calendar_delivery_ready(25)"),
      ).toEqual([]);
      expect(
        await rows("select * from claim_google_calendar_delivery(1,300,$1)", [
          subscription,
        ]),
      ).toEqual([]);
      expect(await claim()).toEqual([]);
    });

    it("rechecks pending credentials at listing and claim time", async () => {
      await db.exec("update calendar_subscriptions set status = 'pending'");
      await rows(
        "insert into google_calendar_credentials values ($1, clock_timestamp())",
        [subscription],
      );
      await rows("select enqueue_google_calendar_subscription($1)", [
        subscription,
      ]);
      await db.exec("delete from google_calendar_credentials");
      expect(
        await rows("select * from list_google_calendar_delivery_ready(25)"),
      ).toEqual([]);
      expect(await claim()).toEqual([]);
    });

    it("captures manual publication and rollback without any push/source-publication row", async () => {
      const [original] = await rows(
        "select current_published_version_id from timetables where id = $1",
        [timetable],
      );
      await rows(
        "update timetables set current_published_version_id = gen_random_uuid() where id = $1",
        [timetable],
      );
      await rows(
        "update timetables set current_published_version_id = $1 where id = $2",
        [original.current_published_version_id, timetable],
      );
      expect(
        (
          await rows("select revision from google_calendar_delivery_revisions")
        )[0].revision,
      ).toBe(3);
      expect(await rows("select * from push_notification_outbox")).toHaveLength(
        0,
      );
      await db.exec("begin");
      await db.exec(
        "update timetables set current_published_version_id = gen_random_uuid()",
      );
      await db.exec("rollback");
      expect(
        (
          await rows("select revision from google_calendar_delivery_revisions")
        )[0].revision,
      ).toBe(3);
    });

    it.each([
      "timetable_correction_directives",
      "timetable_session_exceptions",
    ])(
      "captures active edits, repeated undo and delete for %s without new push evidence",
      async (table) => {
        await rows(
          `insert into ${table}(timetable_id, active, venue) values ($1, false, 'draft')`,
          [timetable],
        );
        expect(
          (
            await rows(
              "select revision from google_calendar_delivery_revisions",
            )
          )[0].revision,
        ).toBe(1);
        await db.exec(`update ${table} set active = true`);
        await db.exec(`update ${table} set venue = 'edited'`);
        await db.exec(`update ${table} set active = false`);
        await db.exec(`update ${table} set active = true`);
        await db.exec(`update ${table} set active = false`);
        await db.exec(`update ${table} set active = true`);
        await db.exec(`delete from ${table}`);
        expect(
          (
            await rows(
              "select revision from google_calendar_delivery_revisions",
            )
          )[0].revision,
        ).toBe(8);
      },
    );

    it("captures pause edits, repeated toggles and scope moves for old and new targets", async () => {
      await rows(
        "insert into timetables(id, current_published_version_id) values ($1, gen_random_uuid())",
        [second],
      );
      await rows(
        "insert into academic_schedule_pauses(scope_type, timetable_id, active) values ('timetable', $1, true)",
        [timetable],
      );
      await db.exec("update academic_schedule_pauses set active = false");
      await db.exec("update academic_schedule_pauses set active = true");
      await db.exec("update academic_schedule_pauses set label = 'edited'");
      await rows("update academic_schedule_pauses set timetable_id = $1", [
        second,
      ]);
      expect(
        (
          await rows(
            "select revision from google_calendar_delivery_revisions where timetable_id = $1",
            [timetable],
          )
        )[0].revision,
      ).toBe(6);
      expect(
        (
          await rows(
            "select revision from google_calendar_delivery_revisions where timetable_id = $1",
            [second],
          )
        )[0].revision,
      ).toBe(2);
    });

    it("targets institution, programme, cohort and session pauses", async () => {
      await rows("insert into cohorts values ($1, $1)", [second]);
      await rows("update timetables set institution_id = $1, cohort_id = $1", [
        second,
      ]);
      for (const scope of ["institution", "programme", "cohort", "session"]) {
        await rows(
          "insert into academic_schedule_pauses(scope_type, timetable_id, institution_id, programme_id, cohort_id, active) values ($1, $2, $3, $3, $3, true)",
          [scope, timetable, second],
        );
      }
      expect(
        (
          await rows("select revision from google_calendar_delivery_revisions")
        )[0].revision,
      ).toBe(5);
    });

    it("serializes targeted requests with batch claims without losing a request arriving during delivery", async () => {
      expect(
        (
          await rows(
            "select enqueue_google_calendar_subscription($1) as queued",
            [subscription],
          )
        )[0].queued,
      ).toBe(true);
      const [job] = await rows(
        "select * from claim_google_calendar_delivery(1, 300, $1)",
        [subscription],
      );
      expect(await claim()).toEqual([]);
      await rows("select enqueue_google_calendar_subscription($1)", [
        subscription,
      ]);
      expect(
        await rows("select * from claim_google_calendar_delivery(1, 300, $1)", [
          subscription,
        ]),
      ).toEqual([]);
      expect(await finish(job)).toBe(true);
      const [next] = await claim();
      expect(next.claimed_revision).toBe(job.claimed_revision);
      expect(next.successful_revision).toBe(job.claimed_revision);
      expect(next.claimed_generation).toBe(2);
      expect(await finish(next)).toBe(true);
      expect(await claim()).toEqual([]);
    });

    it("lists due retry/crash recovery without claiming, and remains empty when quiet", async () => {
      await recover();
      const ready = () =>
        rows("select * from list_google_calendar_delivery_ready(10)");
      expect(await ready()).toEqual([{ subscription_id: subscription }]);
      expect(await ready()).toEqual([{ subscription_id: subscription }]);
      const [job] = await rows(
        "select * from claim_google_calendar_delivery(1,300,$1)",
        [subscription],
      );
      expect(await ready()).toEqual([]);
      await finish(job, "retry");
      expect(await ready()).toEqual([]);
      await db.exec(
        "update google_calendar_delivery_jobs set available_at = now() - interval '1 second'",
      );
      expect(await recover()).toEqual([{ count: 0 }]);
      expect(await ready()).toHaveLength(1);
      const [retried] = await claim();
      await db.exec(
        "update google_calendar_delivery_jobs set lease_expires_at = now() - interval '1 second'",
      );
      expect(await ready()).toHaveLength(1);
      const [recovered] = await claim();
      expect(await finish(retried)).toBe(false);
      await finish(recovered);
      expect(await ready()).toEqual([]);
    });

    it("caps ready listing at 25 and recovery at its requested limit", async () => {
      await rows(
        "insert into calendar_subscriptions select gen_random_uuid(), $1, 'google_api', 'active', null from generate_series(1, 30)",
        [timetable],
      );
      await recover(1);
      expect(
        await rows("select * from google_calendar_delivery_jobs"),
      ).toHaveLength(1);
      await recover();
      expect(
        await rows("select * from list_google_calendar_delivery_ready(9999)"),
      ).toHaveLength(25);
    });

    it("atomically captures all four push sources without consuming their state", async () => {
      for (const kind of [
        "source_publication",
        "correction",
        "exception",
        "academic_pause",
      ]) {
        await rows(
          "insert into push_notification_outbox(timetable_id, source_kind, status) values ($1, $2, 'delivered')",
          [timetable, kind],
        );
      }
      expect(
        (
          await rows("select revision from google_calendar_delivery_revisions")
        )[0].revision,
      ).toBe(5);
      expect(
        await rows("select distinct status from push_notification_outbox"),
      ).toEqual([{ status: "delivered" }]);
      await db.exec("begin");
      await rows(
        "insert into push_notification_outbox(timetable_id) values ($1)",
        [timetable],
      );
      await db.exec("rollback");
      expect(
        (
          await rows("select revision from google_calendar_delivery_revisions")
        )[0].revision,
      ).toBe(5);
    });

    it("does not advance revision on deduplicated push insertion", async () => {
      const sql =
        "insert into push_notification_outbox(timetable_id, dedupe_key) values ($1, 'same') on conflict do nothing";
      await rows(sql, [timetable]);
      await rows(sql, [timetable]);
      expect(
        (
          await rows("select revision from google_calendar_delivery_revisions")
        )[0].revision,
      ).toBe(2);
    });

    it("recovers lost enqueue and coalesces revisions without resetting a live lease", async () => {
      await recover();
      const [job] = await claim();
      expect(await claim()).toEqual([]);
      await rows(
        "insert into push_notification_outbox(timetable_id) values ($1), ($1)",
        [timetable],
      );
      await recover();
      expect(await claim()).toEqual([]);
      expect(await finish(job)).toBe(true);
      const [next] = await claim();
      expect(next.claimed_revision).toBe(3);
      expect(next.successful_revision).toBe(1);
      expect(await finish(next)).toBe(true);
      expect(await claim()).toEqual([]);
      await recover();
      expect(await claim()).toEqual([]);
    });

    it("recovers a crash with a new token and rejects stale or expired completion", async () => {
      await recover();
      const [old] = await claim();
      await db.exec(
        "update google_calendar_delivery_jobs set lease_expires_at = now() - interval '1 second'",
      );
      expect(await finish(old)).toBe(false);
      const [fresh] = await claim();
      expect(fresh.lease_token).not.toBe(old.lease_token);
      expect(await finish(old)).toBe(false);
      expect(await finish(fresh)).toBe(true);
    });

    it("schedules transient retry without advancing success or losing new revisions", async () => {
      await recover();
      const [job] = await claim();
      expect(await finish(job, "retry")).toBe(true);
      expect(await claim()).toEqual([]);
      const [state] = await rows("select * from google_calendar_delivery_jobs");
      expect(state.successful_revision).toBe(0);
      expect(state.attempt_count).toBe(1);
      expect(Date.parse(String(state.available_at))).toBeGreaterThan(
        Date.now(),
      );
      await db.exec(
        "update google_calendar_delivery_jobs set available_at = now() - interval '1 second'",
      );
      const [retried] = await claim();
      expect(retried.attempt_count).toBe(2);
      expect(await finish(retried)).toBe(true);
    });

    it("blocks reconnect work until credentials are replaced, including across newer revisions", async () => {
      await recover();
      const [job] = await claim();
      await finish(job, "reconnect");
      await rows(
        "insert into push_notification_outbox(timetable_id) values ($1)",
        [timetable],
      );
      await recover();
      expect(await claim()).toEqual([]);
      await rows(
        "insert into google_calendar_credentials values ($1, clock_timestamp() + interval '1 second')",
        [subscription],
      );
      await recover();
      const [resumed] = await claim();
      expect(resumed.claimed_revision).toBe(2);
      expect(resumed.successful_revision).toBe(0);
    });

    it("recognizes credentials replaced while the old delivery was still in flight", async () => {
      await rows(
        "insert into google_calendar_credentials values ($1, '2020-01-01')",
        [subscription],
      );
      await recover();
      const [job] = await claim();
      await db.exec(
        "update google_calendar_credentials set updated_at = clock_timestamp()",
      );
      await finish(job, "reconnect");
      await recover();
      expect(await claim()).toHaveLength(1);
    });

    it("keeps unchanged invalid credentials blocked", async () => {
      await rows(
        "insert into google_calendar_credentials values ($1, '2020-01-01')",
        [subscription],
      );
      await recover();
      const [job] = await claim();
      await finish(job, "reconnect");
      expect(await recover()).toEqual([{ count: 0 }]);
      expect(await claim()).toEqual([]);
    });

    it.skipIf(!pgModulePath)(
      "serializes independent concurrent claimers and skips locked subscription rows",
      async () => {
        await rows(
          "insert into calendar_subscriptions values ($1, $2, 'google_api', 'active', null)",
          [second, timetable],
        );
        await recover();
        const locker = await connect!();
        const worker = await connect!();
        try {
          await locker.exec("begin");
          await locker.query(
            "select 1 from google_calendar_delivery_jobs where subscription_id = $1 for update",
            [subscription],
          );
          const result = await worker.query(
            "select * from claim_google_calendar_delivery(10,300)",
          );
          expect(result.rows.map((row) => row.subscription_id)).toEqual([
            second,
          ]);
          await locker.exec("rollback");
          const [a, b] = await Promise.all([
            db.query("select * from claim_google_calendar_delivery(1,300)"),
            worker.query("select * from claim_google_calendar_delivery(1,300)"),
          ]);
          expect(a.rows.length + b.rows.length).toBe(1);
          expect([...a.rows, ...b.rows][0].subscription_id).toBe(subscription);
        } finally {
          await locker.exec("rollback");
          await locker.close();
          await worker.close();
        }
      },
    );

    it("bounds recovery/claims and excludes revoked/disconnected/non-Google subscriptions", async () => {
      await rows(
        "insert into calendar_subscriptions values ($1, $2, 'google_api', 'failed', null)",
        [second, timetable],
      );
      for (const [provider, status, revoked] of [
        ["google_api", "disconnected", null],
        ["google_api", "active", "2020-01-01"],
        ["ics_download", "active", null],
      ]) {
        await rows(
          "insert into calendar_subscriptions values (gen_random_uuid(), $1, $2, $3, $4)",
          [timetable, provider, status, revoked],
        );
      }
      expect(await recover(1)).toEqual([{ count: 1 }]);
      expect(await recover(1)).toEqual([{ count: 1 }]);
      expect(await recover(1)).toEqual([{ count: 0 }]);
      expect(await claim(1)).toHaveLength(1);
      expect(await claim(1)).toHaveLength(1);
      expect(await claim(1)).toHaveLength(0);
    });

    it("rejects a revoked subscription between recovery and claim", async () => {
      await recover();
      await db.exec("update calendar_subscriptions set revoked_at = now()");
      expect(await claim()).toEqual([]);
    });

    it("protects RLS tables and all RPCs from PUBLIC, anon and authenticated", async () => {
      const functions = [
        "observe_google_calendar_delivery_revision()",
        "recover_google_calendar_delivery(integer)",
        "claim_google_calendar_delivery(integer,integer,uuid)",
        "enqueue_google_calendar_subscription(uuid)",
        "list_google_calendar_delivery_ready(integer)",
        "observe_google_calendar_effective_change()",
        "finish_google_calendar_delivery(uuid,uuid,bigint,text,text)",
      ];
      for (const role of ["anon", "authenticated"]) {
        for (const fn of functions) {
          expect(
            (
              await rows(
                "select has_function_privilege($1, $2, 'execute') as allowed",
                [role, fn],
              )
            )[0].allowed,
          ).toBe(false);
        }
        for (const table of [
          "google_calendar_delivery_jobs",
          "google_calendar_delivery_revisions",
        ]) {
          expect(
            (
              await rows(
                "select has_table_privilege($1, $2, 'select') as allowed",
                [role, table],
              )
            )[0].allowed,
          ).toBe(false);
        }
      }
      expect(
        await rows(
          "select relrowsecurity from pg_class where relname in ('google_calendar_delivery_jobs', 'google_calendar_delivery_revisions')",
        ),
      ).toEqual([{ relrowsecurity: true }, { relrowsecurity: true }]);
      expect(
        (
          await rows(
            "select has_function_privilege('service_role', 'claim_google_calendar_delivery(integer,integer,uuid)', 'execute') as allowed",
          )
        )[0].allowed,
      ).toBe(true);
    });
  },
);
