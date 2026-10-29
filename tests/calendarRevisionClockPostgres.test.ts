// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const modulePath = process.env.DR178_PG_MODULE;
if (
  !modulePath &&
  [process.env.CI, process.env.DR178_REQUIRE_POSTGRES].some((value) =>
    ["1", "true"].includes(value ?? ""),
  )
) {
  throw new Error(
    "Calendar clock tests require DR178_PG_MODULE and local PG17.",
  );
}

type Row = Record<string, unknown>;
type Client = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
};
type Clock = { revision: number; instant: string; ticks: bigint };
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const a = id(1),
  b = id(2),
  unpublished = id(3);
const institutionA = id(11),
  institutionB = id(12);
const programmeA = id(21),
  programmeB = id(22);
const cohortA = id(31),
  cohortB = id(32);
const periodA = id(41),
  periodB = id(42);
const versionA = id(51),
  versionB = id(52),
  historicalA = id(53);
const pauseId = id(61);
const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

describe.skipIf(!modulePath)(
  "Calendar revision clock PostgreSQL contracts",
  () => {
    let admin: Client;
    let db: Client;
    let older: Client;
    let databaseCreated = false;
    let migration: string;
    const database = `dr178_calendar_clock_${process.pid}_${randomUUID().replaceAll("-", "")}`;
    const checkedDatabase = () => {
      if (
        !/^dr178_calendar_clock_[0-9]+_[a-f0-9]{32}$/.test(database) ||
        database.length > 63
      )
        throw new Error("UNSAFE_CALENDAR_CLOCK_TEST_DATABASE");
      return database;
    };
    const rows = async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params)).rows;
    const clock = async (timetableId = a): Promise<Clock> => {
      const [row] = await rows(
        `select revision::text,
      updated_at::text as instant, floor(extract(epoch from updated_at) * 1000000)::text as ticks
      from public.google_calendar_delivery_revisions where timetable_id = $1`,
        [timetableId],
      );
      expect(row, `Missing clock for ${timetableId}`).toBeDefined();
      return {
        revision: Number(row.revision),
        instant: String(row.instant),
        ticks: BigInt(String(row.ticks)),
      };
    };
    const advanced = (before: Clock, after: Clock) => {
      expect(after.revision).toBeGreaterThan(before.revision);
      // SEQUENCE must advance for same-second edits; wall-clock time cannot regress.
      expect(after.ticks).toBeGreaterThanOrEqual(before.ticks);
    };
    const preservedTables = [
      "institutions",
      "programmes",
      "cohorts",
      "academic_periods",
      "timetables",
      "timetable_versions",
      "timetable_sessions",
      "timetable_correction_directives",
      "timetable_session_exceptions",
      "academic_schedule_pauses",
      "calendar_subscriptions",
      "calendar_event_sync_records",
      "google_calendar_credentials",
      "push_notification_outbox",
      "google_calendar_delivery_jobs",
    ];
    const snapshot = async () => {
      const result: Row = {};
      for (const table of preservedTables) {
        result[table] = (
          await rows(
            `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as value from public.${table} t`,
          )
        )[0].value;
      }
      return result;
    };
    const apply = () => db.query(migration);

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
      const version = (await admin.query("show server_version_num")).rows[0]
        .server_version_num;
      expect(Math.floor(Number(version) / 10000)).toBe(17);
      await admin.query(`do $$ declare role_name text; begin
      foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
        begin
          if not exists (select 1 from pg_roles where rolname = role_name) then
            execute format('create role %I', role_name);
          end if;
        exception when duplicate_object or unique_violation then null;
        end;
      end loop;
    end $$;`);
      await admin.query(`create database ${checkedDatabase()}`);
      databaseCreated = true;
      db = new Client({ ...config, database });
      older = new Client({ ...config, database });
      await db.connect();
      await older.connect();
      await db.query("set statement_timeout = '8s'; set lock_timeout = '3s'");
      await older.query(
        "set statement_timeout = '8s'; set lock_timeout = '3s'",
      );
      const names = (await readdir(migrationDirectory)).filter((name) =>
        /^0041_.*\.sql$/.test(name),
      );
      expect(
        names,
        "Exactly one additive 0041 clock migration is required",
      ).toHaveLength(1);
      migration = await readFile(new URL(names[0], migrationDirectory), "utf8");
    }, 30_000);

    beforeEach(async () => {
      await older.query("rollback");
      await db.query("rollback; reset role");
      // Unlike the delivery fixture, this public schema belongs only to our disposable DB.
      await db.query(`drop schema public cascade; create schema public;
      grant usage on schema public to anon, authenticated, service_role;
      create table institutions(id uuid primary key, name text, short_name text, timezone text,
        active boolean default true, updated_at timestamptz default now());
      create table programmes(id uuid primary key, institution_id uuid, name text, code text,
        active boolean default true, updated_at timestamptz default now());
      create table cohorts(id uuid primary key, programme_id uuid, label text, code text,
        active boolean default true, updated_at timestamptz default now());
      create table academic_periods(id uuid primary key, institution_id uuid, name text,
        academic_year text, starts_on date, ends_on date, active boolean default true,
        updated_at timestamptz default now());
      create table timetables(id uuid primary key, institution_id uuid, programme_id uuid,
        cohort_id uuid, academic_period_id uuid, current_published_version_id uuid,
        public_slug text, updated_at timestamptz default '2020-01-01Z');
      create table timetable_versions(id uuid primary key, timetable_id uuid references timetables(id),
        version_number integer, status text, published_at timestamptz, created_at timestamptz default '2020-01-01Z');
      create table timetable_sessions(id uuid primary key, timetable_version_id uuid,
        stable_session_key text, course_code text, weekday integer, start_time time);
      create table timetable_correction_directives(id uuid primary key default gen_random_uuid(),
        timetable_id uuid, active boolean, action text, venue text, created_at timestamptz default '2020-01-01Z',
        updated_at timestamptz default '2020-01-01Z', revoked_at timestamptz, superseded_at timestamptz);
      create table timetable_session_exceptions(id uuid primary key default gen_random_uuid(),
        timetable_id uuid, active boolean, venue text, created_at timestamptz default '2020-01-01Z', revoked_at timestamptz);
      create table academic_schedule_pauses(id uuid primary key default gen_random_uuid(), scope_type text,
        institution_id uuid, programme_id uuid, cohort_id uuid, timetable_id uuid, stable_session_key text,
        active boolean, label text, starts_on date, ends_on date, updated_at timestamptz default '2020-01-01Z');
      create table calendar_subscriptions(id uuid primary key, timetable_id uuid references timetables(id),
        provider text, status text, revoked_at timestamptz, feed_token text);
      create table google_calendar_credentials(subscription_id uuid primary key, updated_at timestamptz);
      create table calendar_event_sync_records(id uuid primary key, subscription_id uuid,
        internal_event_id text, external_event_id text, content_hash text);
      create table push_notification_outbox(id uuid primary key default gen_random_uuid(),
        timetable_id uuid references timetables(id), source_kind text, status text);
      insert into institutions(id,name,short_name,timezone) values
        ('${institutionA}','QA A','A','Africa/Harare'),('${institutionB}','QA B','B','Africa/Harare');
      insert into programmes(id,institution_id,name,code) values
        ('${programmeA}','${institutionA}','Programme A','A'),('${programmeB}','${institutionB}','Programme B','B');
      -- Deliberately disagree with timetables.programme_id: feed scope uses the latter.
      insert into cohorts(id,programme_id,label,code) values
        ('${cohortA}','${programmeB}','Cohort A','A'),('${cohortB}','${programmeA}','Cohort B','B');
      insert into academic_periods(id,institution_id,name,academic_year,starts_on,ends_on) values
        ('${periodA}','${institutionA}','Period A','2026','2026-01-01','2026-12-31'),
        ('${periodB}','${institutionB}','Period B','2026','2026-01-01','2026-12-31');
      insert into timetables values
        ('${a}','${institutionA}','${programmeA}','${cohortA}','${periodA}','${versionA}','qa-a','2020-01-01Z'),
        ('${b}','${institutionB}','${programmeB}','${cohortB}','${periodB}','${versionB}','qa-b','2020-01-01Z'),
        ('${unpublished}',null,null,null,null,null,'qa-unpublished','2020-01-01Z');
      insert into timetable_versions(id,timetable_id,version_number,status,published_at) values
        ('${versionA}','${a}',2,'published','2020-01-01Z'),
        ('${historicalA}','${a}',42,'archived','2020-01-01Z'),
        ('${versionB}','${b}',3,'published','2020-01-01Z'),
        ('${id(54)}','${unpublished}',80,'archived','2020-01-01Z');
      insert into timetable_sessions values ('${id(70)}','${versionA}','stable-source','QA101',2,'13:00');
      insert into timetable_correction_directives(timetable_id,active,action,revoked_at,superseded_at)
        select '${a}',false,'remove','2020-01-02Z','2020-01-03Z' from generate_series(1,4);
      insert into timetable_correction_directives(timetable_id,active,action)
        select '${unpublished}',false,'remove' from generate_series(1,2);
      insert into timetable_session_exceptions(timetable_id,active,revoked_at)
        select '${a}',false,'2020-01-02Z' from generate_series(1,3);
      insert into timetable_session_exceptions(timetable_id,active) values ('${unpublished}',false);
      insert into calendar_subscriptions values ('${id(71)}','${a}','google_api','active',null,'synthetic-feed');
      insert into google_calendar_credentials values ('${id(71)}','2020-01-01Z');
      insert into calendar_event_sync_records values ('${id(72)}','${id(71)}','stable-source','synthetic-provider-id','hash');
      insert into push_notification_outbox(timetable_id,source_kind,status) values ('${a}','correction','delivered');
    `);
      for (const name of [
        "0038_google_calendar_delivery.sql",
        "0040_google_calendar_delivery_continuation.sql",
      ])
        await db.query(
          await readFile(new URL(name, migrationDirectory), "utf8"),
        );
      await db.query(`update google_calendar_delivery_revisions set revision = 900 where timetable_id = '${b}';
      insert into google_calendar_delivery_jobs(subscription_id,desired_revision,successful_revision)
        values ('${id(71)}',1,1);`);
    }, 30_000);

    afterAll(async () => {
      try {
        await older?.query("rollback");
        await db?.query("rollback");
      } finally {
        await older?.end();
        await db?.end();
        if (admin) {
          try {
            if (databaseCreated)
              await admin.query(`drop database ${checkedDatabase()}`);
          } finally {
            await admin.end();
          }
        }
      }
    });

    it("adopts the historical high-water mark, including unpublished timetables, without rewriting existing rows", async () => {
      const before = await snapshot();
      await apply();
      expect((await clock(a)).revision).toBeGreaterThanOrEqual(
        42 + 3 * 4 + 2 * 3 + 1,
      );
      expect((await clock(b)).revision).toBeGreaterThan(900);
      expect((await clock(unpublished)).revision).toBeGreaterThanOrEqual(
        80 + 3 * 2 + 2 + 1,
      );
      expect(await snapshot()).toEqual(before);
      for (const target of [a, b, unpublished])
        expect((await clock(target)).ticks).toBeGreaterThan(0n);
    });

    it("seeds a timetable with no versions, corrections, exceptions or prior clock", async () => {
      await rows("insert into timetables(id) values ($1)", [id(4)]);
      await apply();
      expect((await clock(id(4))).revision).toBeGreaterThanOrEqual(2);
    });

    it.each([
      ["timetables", "updated_at"],
      ["timetable_versions", "published_at"],
      ["timetable_versions", "created_at"],
      ["timetable_correction_directives", "created_at"],
      ["timetable_correction_directives", "updated_at"],
      ["timetable_correction_directives", "revoked_at"],
      ["timetable_correction_directives", "superseded_at"],
      ["timetable_session_exceptions", "created_at"],
      ["timetable_session_exceptions", "revoked_at"],
    ])(
      "preserves the historical timestamp high-water mark from %s.%s",
      async (table, column) => {
        const key = table === "timetables" ? "id" : "timetable_id";
        await rows(
          `update ${table} set ${column}='2040-01-01T00:00:00Z' where ${key}=$1`,
          [a],
        );
        const before = await snapshot();
        await apply();
        expect((await clock(a)).ticks).toBeGreaterThanOrEqual(
          2208988800000000n,
        );
        expect(await snapshot()).toEqual(before);
      },
    );

    it("advances revision on publication and rollback with monotonic timestamps, even in one transaction", async () => {
      await apply();
      await db.query("begin");
      const before = await clock();
      await rows(
        "update timetables set current_published_version_id=$1 where id=$2",
        [historicalA, a],
      );
      const published = await clock();
      advanced(before, published);
      await rows(
        "update timetables set current_published_version_id=$1 where id=$2",
        [versionA, a],
      );
      const undone = await clock();
      advanced(published, undone);
      await rows(
        "update timetables set current_published_version_id=current_published_version_id where id=$1",
        [a],
      );
      expect(await clock()).toEqual(undone);
      await db.query("commit");
    });

    it("stays above a legacy reader after version 999 is allocated and published after migration", async () => {
      await apply();
      const before = await clock(a);
      const unrelated = await clock(b);
      const allocatedVersion = randomUUID();
      await rows(
        "insert into timetable_versions(id,timetable_id,version_number,status) values ($1,$2,999,'draft')",
        [allocatedVersion, a],
      );
      expect(await clock(a)).toEqual(before);

      await rows(
        "update timetable_versions set status='published',published_at=clock_timestamp() where id=$1",
        [allocatedVersion],
      );
      await rows(
        "update timetables set current_published_version_id=$1 where id=$2",
        [allocatedVersion, a],
      );
      // Reproduce the 754 reader's actual row-count clock after publication.
      const [legacy] = await rows(
        `select v.version_number::bigint
          + (select count(*) + count(revoked_at) + count(superseded_at)
             from timetable_correction_directives where timetable_id=t.id)
          + (select count(*) + count(revoked_at)
             from timetable_session_exceptions where timetable_id=t.id) as revision
         from timetables t
         join timetable_versions v on v.id=t.current_published_version_id
         where t.id=$1`,
        [a],
      );
      expect(Number(legacy.revision)).toBe(1017);
      const published = await clock(a);
      advanced(before, published);
      expect(published.revision).toBeGreaterThan(Number(legacy.revision));
      expect(published.revision).toBeLessThanOrEqual(2147483647);
      expect(await clock(b)).toEqual(unrelated);
    });

    it("atomically rejects publication whose version high-water floor exceeds the RFC sequence maximum", async () => {
      await apply();
      const allocatedVersion = randomUUID();
      await rows(
        "insert into timetable_versions(id,timetable_id,version_number,status) values ($1,$2,2147483647,'draft')",
        [allocatedVersion, a],
      );
      const before = await clock(a);
      const pointer = await rows("select * from timetables where id=$1", [a]);

      await expect(
        rows(
          "update timetables set current_published_version_id=$1 where id=$2",
          [allocatedVersion, a],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "calendar_revision_rfc_sequence_range",
      });
      expect(await rows("select * from timetables where id=$1", [a])).toEqual(
        pointer,
      );
      expect(await clock(a)).toEqual(before);
    });

    it("atomically rejects an increment at the RFC sequence maximum without clamping", async () => {
      await apply();
      await rows(
        "update google_calendar_delivery_revisions set revision=2147483647 where timetable_id=$1",
        [a],
      );
      const before = await clock(a);
      expect(before.revision).toBe(2147483647);

      await expect(
        rows(
          "update google_calendar_delivery_revisions set revision=revision+1 where timetable_id=$1",
          [a],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "calendar_revision_rfc_sequence_range",
      });
      expect(await clock(a)).toEqual(before);
    });

    it.each([
      "timetable_correction_directives",
      "timetable_session_exceptions",
    ])(
      "tracks remove, undo, active edit and deletion in %s without altering source or subscriber rows",
      async (table) => {
        await apply();
        const source = await rows("select * from timetable_sessions");
        const subscribers = await rows("select * from calendar_subscriptions");
        let before = await clock();
        const [created] = await rows(
          `insert into ${table}(timetable_id,active,venue${table === "timetable_correction_directives" ? ",action" : ""}) values ($1,true,'initial'${table === "timetable_correction_directives" ? ",'remove'" : ""}) returning id`,
          [a],
        );
        advanced(before, await clock());
        for (const sql of [
          `update ${table} set active=false where id=$1`,
          `update ${table} set active=true where id=$1`,
          `update ${table} set venue='edited' where id=$1`,
          `delete from ${table} where id=$1`,
        ]) {
          before = await clock();
          await rows(sql, [created.id]);
          advanced(before, await clock());
        }
        expect(await rows("select * from timetable_sessions")).toEqual(source);
        expect(await rows("select * from calendar_subscriptions")).toEqual(
          subscribers,
        );
      },
    );

    const scopes = [
      ["institution", "institution_id", institutionA, institutionB],
      ["programme", "programme_id", programmeA, programmeB],
      ["cohort", "cohort_id", cohortA, cohortB],
      ["timetable", "timetable_id", a, b],
      ["session", "timetable_id", a, b],
    ] as const;
    it.each(scopes)(
      "observes %s pauses, old/new targets, deactivate, reactivate and delete",
      async (scope, column, first, next) => {
        await apply();
        const beforeA = await clock(a),
          beforeB = await clock(b);
        await rows(
          `insert into academic_schedule_pauses(id,scope_type,${column},stable_session_key,active,label,starts_on,ends_on)
      values ($1,$2,$3,'stable-source',true,'isolated pause','2026-10-27','2026-10-27')`,
          [pauseId, scope, first],
        );
        let previousA = await clock(a),
          previousB = await clock(b);
        advanced(beforeA, previousA);
        expect(previousB).toEqual(beforeB);
        await rows(
          `update academic_schedule_pauses set ${column}=$1 where id=$2`,
          [next, pauseId],
        );
        advanced(previousA, await clock(a));
        advanced(previousB, await clock(b));
        previousA = await clock(a);
        for (const sql of [
          "update academic_schedule_pauses set label='edited' where id=$1",
          "update academic_schedule_pauses set active=false where id=$1",
          "update academic_schedule_pauses set active=true where id=$1",
          "delete from academic_schedule_pauses where id=$1",
        ]) {
          previousB = await clock(b);
          await rows(sql, [pauseId]);
          advanced(previousB, await clock(b));
          expect(await clock(a)).toEqual(previousA);
        }
      },
    );

    it("invalidates both sides when a pause changes scope type", async () => {
      await apply();
      await rows(
        "insert into academic_schedule_pauses(id,scope_type,institution_id,active) values ($1,'institution',$2,true)",
        [pauseId, institutionA],
      );
      const beforeA = await clock(a),
        beforeB = await clock(b);
      await rows(
        "update academic_schedule_pauses set scope_type='timetable',institution_id=null,timetable_id=$1 where id=$2",
        [b, pauseId],
      );
      advanced(beforeA, await clock(a));
      advanced(beforeB, await clock(b));
    });

    it.each([
      ["institutions", institutionA, "name", "Renamed institute"],
      ["institutions", institutionA, "timezone", "Africa/Johannesburg"],
      ["programmes", programmeA, "name", "Renamed programme"],
      ["cohorts", cohortA, "label", "Renamed cohort"],
      ["academic_periods", periodA, "name", "Renamed period"],
      ["academic_periods", periodA, "starts_on", "2026-01-02"],
      ["academic_periods", periodA, "ends_on", "2026-12-30"],
    ])(
      "only advances related timetables for %s.%s semantic changes",
      async (table, target, column, value) => {
        await apply();
        const sibling = id(5);
        await rows(
          `insert into timetables(id,institution_id,programme_id,cohort_id,academic_period_id,current_published_version_id)
          select $1,institution_id,programme_id,cohort_id,academic_period_id,current_published_version_id from timetables where id=$2`,
          [sibling, a],
        );
        const beforeA = await clock(a),
          beforeB = await clock(b),
          beforeSibling = await clock(sibling);
        await rows(
          `update ${table} set updated_at=clock_timestamp() where id=$1`,
          [target],
        );
        expect(await clock(a)).toEqual(beforeA);
        expect(await clock(b)).toEqual(beforeB);
        expect(await clock(sibling)).toEqual(beforeSibling);
        await rows(`update ${table} set ${column}=$1 where id=$2`, [
          value,
          target,
        ]);
        advanced(beforeA, await clock(a));
        advanced(beforeSibling, await clock(sibling));
        expect(await clock(b)).toEqual(beforeB);
        const changed = await clock(a);
        await rows(`update ${table} set ${column}=${column} where id=$1`, [
          target,
        ]);
        expect(await clock(a)).toEqual(changed);
      },
    );

    it("keeps revision no-ops stable and rejects lower revisions", async () => {
      await apply();
      const before = await clock();
      await rows(
        "update google_calendar_delivery_revisions set revision=revision,updated_at=clock_timestamp()+interval '1 day' where timetable_id=$1",
        [a],
      );
      expect(await clock()).toEqual(before);
      await expect(
        rows(
          "update google_calendar_delivery_revisions set revision=revision-1 where timetable_id=$1",
          [a],
        ),
      ).rejects.toThrow();
      expect(await clock()).toEqual(before);
    });

    it("does not let an older transaction move the timestamp behind a later committed revision", async () => {
      await apply();
      await older.query("begin");
      await older.query("select transaction_timestamp()");
      const first = await clock();
      await rows(
        "update google_calendar_delivery_revisions set revision=revision+1 where timetable_id=$1",
        [a],
      );
      const committed = await clock();
      advanced(first, committed);
      await older.query(
        "update google_calendar_delivery_revisions set revision=revision+1 where timetable_id=$1",
        [a],
      );
      await older.query("commit");
      advanced(committed, await clock());
    });

    it("refreshes the timestamp on an ordinary increase even when the caller supplies an older timestamp", async () => {
      await apply();
      const before = await clock();
      await rows(
        "update google_calendar_delivery_revisions set revision=revision+1,updated_at='1990-01-01T00:00:00Z' where timetable_id=$1",
        [a],
      );
      const after = await clock();
      advanced(before, after);
      expect(after.ticks).toBeGreaterThan(before.ticks);
    });

    it("retains service-only table access, RLS, and non-public clock functions", async () => {
      await apply();
      expect(
        (
          await rows(
            "select relrowsecurity from pg_class where oid='public.google_calendar_delivery_revisions'::regclass",
          )
        )[0].relrowsecurity,
      ).toBe(true);
      for (const role of ["anon", "authenticated"]) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
          expect(
            (
              await rows(
                "select has_table_privilege($1,'public.google_calendar_delivery_revisions',$2) as allowed",
                [role, privilege],
              )
            )[0].allowed,
          ).toBe(false);
      }
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
        expect(
          (
            await rows(
              "select has_table_privilege('service_role','public.google_calendar_delivery_revisions',$1) as allowed",
              [privilege],
            )
          )[0].allowed,
        ).toBe(true);
      const functions =
        await rows(`select p.oid::text as oid, p.prorettype='trigger'::regtype as trigger
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and
        (p.proname like '%calendar%revision%' or p.proname like '%calendar%effective%' or p.proname like '%calendar%reference%' or p.proname like '%calendar%clock%')`);
      expect(functions.length).toBeGreaterThanOrEqual(2);
      for (const fn of functions)
        for (const role of ["anon", "authenticated"])
          expect(
            (
              await rows(
                "select has_function_privilege($1,$2::oid,'EXECUTE') as allowed",
                [role, fn.oid],
              )
            )[0].allowed,
          ).toBe(false);
      await db.query("set role anon");
      try {
        await expect(
          rows("select * from public.google_calendar_delivery_revisions"),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.query("reset role");
      }
    });

    it("rolls back the entire atomic migration when adoption exceeds the RFC revision bound", async () => {
      await rows(
        "update google_calendar_delivery_revisions set revision=2147483647 where timetable_id=$1",
        [b],
      );
      const before = await snapshot();
      const revisions = await rows(
        "select * from google_calendar_delivery_revisions order by timetable_id",
      );
      await expect(apply()).rejects.toThrow(/SEQUENCE range/);
      expect(await snapshot()).toEqual(before);
      expect(
        await rows(
          "select * from google_calendar_delivery_revisions order by timetable_id",
        ),
      ).toEqual(revisions);
      expect(
        await rows(
          "select 1 from information_schema.columns where table_schema='public' and table_name='google_calendar_delivery_revisions' and column_name='updated_at'",
        ),
      ).toEqual([]);
      expect(
        await rows(
          "select 1 from pg_proc where oid=to_regprocedure('public.stamp_calendar_revision_clock()')",
        ),
      ).toEqual([]);
    });

    it("atomically rolls back adoption, replaced functions and earlier triggers after a late trigger-creation failure", async () => {
      await db.query(`create trigger calendar_revision_period_reference
        after update on public.academic_periods for each row
        execute function public.observe_google_calendar_effective_change()`);
      const before = await snapshot();
      const revisions = await rows(
        "select * from google_calendar_delivery_revisions order by timetable_id",
      );
      const definitions = () =>
        rows(`select p.proname,pg_get_functiondef(p.oid) as definition
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' order by p.proname`);
      const functions = await definitions();
      const triggers = () =>
        rows(`select tgname,pg_get_triggerdef(oid) as definition from pg_trigger
        where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace)
        order by tgname`);
      const originalTriggers = await triggers();
      await expect(apply()).rejects.toThrow(/trigger .* already exists/);
      expect(await snapshot()).toEqual(before);
      expect(
        await rows(
          "select * from google_calendar_delivery_revisions order by timetable_id",
        ),
      ).toEqual(revisions);
      expect(await definitions()).toEqual(functions);
      expect(await triggers()).toEqual(originalTriggers);
      expect(
        await rows(
          "select 1 from information_schema.columns where table_schema='public' and table_name='google_calendar_delivery_revisions' and column_name='updated_at'",
        ),
      ).toEqual([]);
    });

    it("rolls back clock adoption and trigger replacement if a later application statement fails", async () => {
      const before = await snapshot();
      const revisions = await rows(
        "select * from google_calendar_delivery_revisions order by timetable_id",
      );
      const observer = (
        await rows(
          "select pg_get_functiondef('public.observe_google_calendar_effective_change()'::regprocedure) as definition",
        )
      )[0].definition;
      await db.query("begin");
      await apply();
      await expect(
        db.query("select 1 / 0 as later_migration_failure"),
      ).rejects.toThrow();
      await db.query("rollback");
      expect(await snapshot()).toEqual(before);
      expect(
        await rows(
          "select * from google_calendar_delivery_revisions order by timetable_id",
        ),
      ).toEqual(revisions);
      expect(
        (
          await rows(
            "select pg_get_functiondef('public.observe_google_calendar_effective_change()'::regprocedure) as definition",
          )
        )[0].definition,
      ).toBe(observer);
      expect(
        await rows(
          "select 1 from information_schema.columns where table_schema='public' and table_name='google_calendar_delivery_revisions' and column_name='updated_at'",
        ),
      ).toEqual([]);
    });
  },
);
