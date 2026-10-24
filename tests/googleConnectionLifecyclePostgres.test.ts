// @vitest-environment node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const modulePath = process.env.DR178_PG_MODULE;
const subscription = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
type Client = {
  connect(): Promise<void>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};

describe.skipIf(!modulePath)(
  "Google connection lifecycle PostgreSQL fencing",
  () => {
    let admin: Client;
    let db: Client;
    let second: Client;
    const database = `dr178_google_lifecycle_${process.pid}`;
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
      await admin.query(`
        do $$ declare role_name text; begin
          foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
            begin
              if not exists (select 1 from pg_roles where rolname = role_name) then
                execute format('create role %I', role_name);
              end if;
            exception when duplicate_object or unique_violation then null;
            end;
          end loop;
        end $$;
      `);
      await admin.query(`create database ${database}`);
      db = new Client({ ...config, database });
      second = new Client({ ...config, database });
      await db.connect();
      await second.connect();
      await db.query(`
      create table public.cohorts(id uuid primary key, programme_id uuid);
      create table public.timetables(id uuid primary key, current_published_version_id uuid, institution_id uuid, cohort_id uuid);
      create table public.timetable_correction_directives(id uuid primary key, timetable_id uuid, active boolean);
      create table public.timetable_session_exceptions(id uuid primary key, timetable_id uuid, active boolean);
      create table public.academic_schedule_pauses(id uuid primary key, scope_type text, timetable_id uuid, institution_id uuid, programme_id uuid, cohort_id uuid, active boolean);
      create table public.push_notification_outbox(id uuid primary key, timetable_id uuid, source_kind text);
      insert into public.timetables(id, current_published_version_id) values ('${subscription}', '${subscription}');
      create table public.calendar_subscriptions (
        id uuid primary key, anonymous_session_id uuid, provider text, status text,
        revoked_at timestamptz, updated_at timestamptz default now(), last_error_code text, external_calendar_id text,
        timetable_id uuid default '${subscription}');
      create table public.google_calendar_oauth_states (
        state_hash text primary key, subscription_id uuid, expires_at timestamptz);
      create table public.google_calendar_credentials (
        subscription_id uuid primary key, encrypted_refresh_token text, granted_scope text, updated_at timestamptz);
      create table public.calendar_event_sync_records (
        subscription_id uuid, provider text, internal_event_id text, timetable_version_id uuid,
        external_calendar_id text, external_event_id text, content_hash text, sync_status text,
        last_synced_at timestamptz, last_error_code text, updated_at timestamptz,
        unique(subscription_id, provider, internal_event_id));
    `);
      await db.query(
        await readFile(
          new URL(
            "../supabase/migrations/0038_google_calendar_delivery.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await db.query(
        await readFile(
          new URL(
            "../supabase/migrations/0039_google_calendar_connection_lifecycle.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
    }, 30000);
    beforeEach(async () => {
      await db.query("rollback");
      await db.query(
        "truncate google_calendar_delivery_jobs, calendar_event_sync_records, google_calendar_credentials, google_calendar_oauth_states, calendar_subscriptions",
      );
      await db.query(
        "insert into calendar_subscriptions(id, anonymous_session_id, provider, status, external_calendar_id) values ($1,$2,'google_api','pending','calendar')",
        [subscription, owner],
      );
    });
    afterAll(async () => {
      await db?.query("rollback");
      await second?.query("rollback");
      await db?.end();
      await second?.end();
      if (admin) {
        await admin.query(`drop database if exists ${database}`);
        await admin.end();
      }
    });
    const complete = (client: Client, generation = 0) =>
      client.query(
        "select complete_google_calendar_connection($1,$2,'synthetic-ciphertext','scope') as accepted",
        [subscription, generation],
      );
    const disconnect = (client: Client) =>
      client.query(
        "select disconnect_google_calendar_connection($1,$2,false) as result",
        [subscription, owner],
      );

    it("rejects callback persistence after disconnect holds the subscription lock", async () => {
      await db.query("begin");
      await disconnect(db);
      const callback = complete(second);
      await db.query("commit");
      expect((await callback).rows[0].accepted).toBe(false);
      expect(
        (await db.query("select * from google_calendar_credentials")).rows,
      ).toEqual([]);
      expect(
        (await db.query("select status from calendar_subscriptions")).rows[0]
          .status,
      ).toBe("disconnected");
    });

    it("disconnect deletes a credential committed by a concurrent winning callback", async () => {
      await db.query("begin");
      expect((await complete(db)).rows[0].accepted).toBe(true);
      const disconnected = disconnect(second);
      await db.query("commit");
      expect((await disconnected).rows[0].result).toMatchObject({
        encrypted_refresh_token: "synthetic-ciphertext",
        external_calendar_id: "calendar",
      });
      expect(
        (await db.query("select * from google_calendar_credentials")).rows,
      ).toEqual([]);
    });

    it("invalidates old consumed states across reconnect and admits only the new generation", async () => {
      await db.query(
        "select start_google_calendar_connection($1,$2,'old-state',now()+interval '10 minutes')",
        [subscription, owner],
      );
      await disconnect(db);
      expect(
        (await db.query("select * from google_calendar_oauth_states")).rows,
      ).toEqual([]);
      await db.query(
        "select start_google_calendar_connection($1,$2,'new-state',now()+interval '10 minutes')",
        [subscription, owner],
      );
      expect((await complete(db, 0)).rows[0].accepted).toBe(false);
      expect((await complete(db, 1)).rows[0].accepted).toBe(true);
    });

    it("fences a callback failure update after disconnection", async () => {
      await disconnect(db);
      const update = await db.query(
        "update calendar_subscriptions set status='failed' where id=$1 and google_connection_generation=0 and status<>'disconnected' and revoked_at is null returning id",
        [subscription],
      );
      expect(update.rows).toEqual([]);
    });

    it("atomically requests another delivery generation even when the prior job was fulfilled", async () => {
      expect((await complete(db)).rows[0].accepted).toBe(true);
      const job = (
        await db.query("select * from claim_google_calendar_delivery(1,300)")
      ).rows[0];
      expect(
        (
          await db.query(
            "select finish_google_calendar_delivery($1,$2,$3,'success',null) as accepted",
            [subscription, job.lease_token, job.claimed_revision],
          )
        ).rows[0].accepted,
      ).toBe(true);
      expect(
        (
          await db.query(
            "select * from list_google_calendar_delivery_ready(10)",
          )
        ).rows,
      ).toEqual([]);
      await disconnect(db);
      await db.query(
        "select start_google_calendar_connection($1,$2,'reconnect',now()+interval '10 minutes')",
        [subscription, owner],
      );
      expect((await complete(db, 1)).rows[0].accepted).toBe(true);
      // No queue wake-up callback: the callback transaction itself leaves intent.
      expect(
        (
          await db.query(
            "select * from list_google_calendar_delivery_ready(10)",
          )
        ).rows,
      ).toEqual([{ subscription_id: subscription }]);
      const queued = (
        await db.query(
          "select requested_generation > successful_generation as pending from google_calendar_delivery_jobs where subscription_id=$1",
          [subscription],
        )
      ).rows[0];
      expect(queued.pending).toBe(true);
      expect(
        (await db.query("select status from calendar_subscriptions")).rows[0]
          .status,
      ).toBe("pending");
      expect(
        (await db.query("select * from google_calendar_credentials")).rows,
      ).toHaveLength(1);
    });

    it("rolls credential and pending changes back when delivery intent persistence fails", async () => {
      await db.query("update calendar_subscriptions set status='active'");
      await db.query("begin");
      await db.query(
        "create or replace function public.enqueue_google_calendar_subscription(p_subscription_id uuid) returns boolean language sql as 'select false'",
      );
      await db.query("savepoint before_callback");
      await expect(complete(db)).rejects.toThrow(
        "delivery intent could not be persisted",
      );
      await db.query("rollback to savepoint before_callback");
      expect(
        (await db.query("select * from google_calendar_credentials")).rows,
      ).toEqual([]);
      expect(
        (await db.query("select status from calendar_subscriptions")).rows[0]
          .status,
      ).toBe("active");
      await db.query("rollback");
    });

    it("rejects calendar cleanup without any local lifecycle change", async () => {
      const result = await db.query(
        "select disconnect_google_calendar_connection($1,$2,true) as result",
        [subscription, owner],
      );
      expect(result.rows[0].result).toBeNull();
      expect(
        (
          await db.query(
            "select status, google_connection_generation from calendar_subscriptions",
          )
        ).rows[0],
      ).toMatchObject({ status: "pending", google_connection_generation: "0" });
    });

    it("fences old sync calendar, active status and mapping writes after disconnect/reconnect", async () => {
      await disconnect(db);
      await db.query(
        "select start_google_calendar_connection($1,$2,'fresh',now()+interval '10 minutes')",
        [subscription, owner],
      );
      await db.query(
        "update calendar_subscriptions set external_calendar_id='new-calendar' where id=$1",
        [subscription],
      );
      const update = await db.query(
        "update calendar_subscriptions set status='active', external_calendar_id='stale-calendar' where id=$1 and google_connection_generation=0 and status<>'disconnected' and revoked_at is null returning id",
        [subscription],
      );
      expect(update.rows).toEqual([]);
      const record = {
        timetable_version_id: subscription,
        external_calendar_id: "stale-calendar",
        external_event_id: "event",
        content_hash: "hash",
        sync_status: "active",
      };
      expect(
        (
          await db.query(
            "select write_google_calendar_sync_record($1,0,'session',$2) as accepted",
            [subscription, record],
          )
        ).rows[0].accepted,
      ).toBe(false);
      expect(
        (
          await db.query(
            "select status, external_calendar_id from calendar_subscriptions",
          )
        ).rows[0],
      ).toEqual({ status: "pending", external_calendar_id: "new-calendar" });
      expect(
        (await db.query("select * from calendar_event_sync_records")).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select write_google_calendar_sync_record($1,1,'session',$2) as accepted",
            [subscription, record],
          )
        ).rows[0].accepted,
      ).toBe(true);
      expect(
        (
          await db.query(
            "select write_google_calendar_sync_record($1,0,'session',null) as accepted",
            [subscription],
          )
        ).rows[0].accepted,
      ).toBe(false);
      expect(
        (await db.query("select * from calendar_event_sync_records")).rows,
      ).toHaveLength(1);
    });

    it("restricts all lifecycle RPCs to service_role", async () => {
      for (const fn of [
        "start_google_calendar_connection(uuid,uuid,text,timestamptz)",
        "complete_google_calendar_connection(uuid,bigint,text,text)",
        "disconnect_google_calendar_connection(uuid,uuid,boolean)",
        "write_google_calendar_sync_record(uuid,bigint,text,jsonb)",
      ]) {
        for (const role of ["anon", "authenticated"]) {
          expect(
            (
              await db.query(
                "select has_function_privilege($1,$2,'execute') as allowed",
                [role, fn],
              )
            ).rows[0].allowed,
          ).toBe(false);
        }
        expect(
          (
            await db.query(
              "select has_function_privilege('service_role',$1,'execute') as allowed",
              [fn],
            )
          ).rows[0].allowed,
        ).toBe(true);
      }
    });
  },
);
