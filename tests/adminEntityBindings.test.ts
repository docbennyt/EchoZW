// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adminClient: vi.fn() }));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: mocks.adminClient,
}));

type Repository = typeof import("../server/pilotRepository");
const ids = {
  institutions: "10000000-0000-4000-8000-000000000001",
  programmes: "10000000-0000-4000-8000-000000000002",
  cohorts: "10000000-0000-4000-8000-000000000003",
  academic_periods: "10000000-0000-4000-8000-000000000004",
};
type Table = keyof typeof ids;
type Query = {
  table: Table;
  operation: "select" | "insert" | "update";
  filters: Array<[string, unknown]>;
};

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function fixture(pauseFirstQuery = false) {
  const common = {
    active: true,
    slug: "binding-fixture",
    created_at: "2026-10-24T00:00:00.000Z",
    updated_at: "2026-10-24T00:00:00.000Z",
  };
  const rows = {
    institutions: {
      ...common,
      id: ids.institutions,
      name: "Fixture Institute",
      short_name: "FI",
      timezone: "Africa/Harare",
    },
    programmes: {
      ...common,
      id: ids.programmes,
      institution_id: ids.institutions,
      name: "Fixture Programme",
      code: "FP",
      institutions: { name: "Fixture Institute" },
    },
    cohorts: {
      ...common,
      id: ids.cohorts,
      programme_id: ids.programmes,
      label: "1.1",
      code: "1.1",
      year_level: 1,
      semester_number: 1,
      group_name: null,
      programmes: { name: "Fixture Programme" },
    },
    academic_periods: {
      ...common,
      id: ids.academic_periods,
      institution_id: ids.institutions,
      name: "Semester 1 2026",
      academic_year: "2026",
      starts_on: "2026-08-01",
      ends_on: "2026-12-01",
      institutions: { name: "Fixture Institute" },
    },
  };
  const queries: Query[] = [];
  const entered = gate();
  const resume = gate();
  let paused = false;
  const client = {
    from(table: Table) {
      if (!(table in rows)) throw new Error(`Unexpected table ${table}`);
      const query: Query = { table, operation: "select", filters: [] };
      let payload: Record<string, unknown> = {};
      async function result() {
        queries.push(query);
        if (pauseFirstQuery && !paused) {
          paused = true;
          entered.release();
          await resume.promise;
        }
        for (const [column, value] of query.filters) {
          expect(column).toBe("id");
          expect(value).toBe(ids[table]);
        }
        return { data: { ...rows[table], ...payload }, error: null };
      }
      const chain = {
        select: () => chain,
        eq(column: string, value: unknown) {
          query.filters.push([column, value]);
          return chain;
        },
        insert(value: Record<string, unknown>) {
          query.operation = "insert";
          payload = value;
          return chain;
        },
        update(value: Record<string, unknown>) {
          query.operation = "update";
          payload = value;
          return chain;
        },
        single: result,
        maybeSingle: result,
      };
      return chain;
    },
  };
  return { client, queries, entered, resume };
}

const operations: Array<{
  name: string;
  table: Table;
  reads: Table[];
  run: (repo: Repository, env?: NodeJS.ProcessEnv) => Promise<{ id: string }>;
}> = [
  {
    name: "createInstitution",
    table: "institutions",
    reads: [],
    run: (repo, env) => repo.createInstitution({ name: "New Institute" }, env),
  },
  {
    name: "updateInstitution",
    table: "institutions",
    reads: ["institutions"],
    run: (repo, env) =>
      repo.updateInstitution(
        ids.institutions,
        { name: "Updated Institute" },
        env,
      ),
  },
  {
    name: "createProgramme",
    table: "programmes",
    reads: ["institutions"],
    run: (repo, env) =>
      repo.createProgramme(
        { institutionId: ids.institutions, name: "New Programme" },
        env,
      ),
  },
  {
    name: "updateProgramme",
    table: "programmes",
    reads: ["programmes", "institutions"],
    run: (repo, env) =>
      repo.updateProgramme(ids.programmes, { name: "Updated Programme" }, env),
  },
  {
    name: "createClassGroup",
    table: "cohorts",
    reads: ["programmes"],
    run: (repo, env) =>
      repo.createClassGroup({ programmeId: ids.programmes, label: "2.1" }, env),
  },
  {
    name: "updateClassGroup",
    table: "cohorts",
    reads: ["cohorts", "programmes"],
    run: (repo, env) =>
      repo.updateClassGroup(ids.cohorts, { label: "2.1" }, env),
  },
  {
    name: "createAcademicPeriod",
    table: "academic_periods",
    reads: ["institutions"],
    run: (repo, env) =>
      repo.createAcademicPeriod(
        {
          institutionId: ids.institutions,
          name: "Semester 1 2026",
          startsOn: "2026-08-01",
          endsOn: "2026-12-01",
        },
        env,
      ),
  },
  {
    name: "updateAcademicPeriod",
    table: "academic_periods",
    reads: ["academic_periods", "institutions"],
    run: (repo, env) =>
      repo.updateAcademicPeriod(
        ids.academic_periods,
        { name: "Semester 2 2026" },
        env,
      ),
  },
];

function expectQueries(
  queries: Query[],
  operation: (typeof operations)[number],
) {
  expect(queries.filter((query) => query.operation === "select")).toEqual(
    operation.reads.map((table) => ({
      table,
      operation: "select",
      filters: [["id", ids[table]]],
    })),
  );
  expect(queries.filter((query) => query.operation !== "select")).toEqual([
    {
      table: operation.table,
      operation: operation.name.startsWith("create") ? "insert" : "update",
      filters: operation.name.startsWith("create")
        ? []
        : [["id", ids[operation.table]]],
    },
  ]);
}

describe("Admin entity repository environment bindings", () => {
  let repo: Repository;
  let nodeEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    repo = await import("../server/pilotRepository");
    nodeEnv = { SUPABASE_URL: "https://node-fallback.invalid" };
    repo.setPilotRepositoryEnv(nodeEnv);
  });

  it.each(operations)(
    "$name uses supplied Worker bindings for every client, including parent reads",
    async (operation) => {
      const env = { SUPABASE_URL: "https://worker-request.invalid" };
      const request = fixture();
      mocks.adminClient.mockImplementation((bindings) => {
        expect(bindings).toBe(env);
        return request.client;
      });

      expect((await operation.run(repo, env)).id).toBe(ids[operation.table]);
      expectQueries(request.queries, operation);
      expect(mocks.adminClient).toHaveBeenCalledTimes(
        operation.reads.length + 1,
      );
    },
  );

  it.each(operations)(
    "$name retains setPilotRepositoryEnv when the optional env is omitted",
    async (operation) => {
      const fallback = fixture();
      mocks.adminClient.mockImplementation((bindings) => {
        expect(bindings).toBe(nodeEnv);
        return fallback.client;
      });

      expect((await operation.run(repo)).id).toBe(ids[operation.table]);
      expectQueries(fallback.queries, operation);
      expect(mocks.adminClient).toHaveBeenCalledTimes(
        operation.reads.length + 1,
      );
    },
  );

  it.each(operations)(
    "$name isolates two interleaved Worker requests and preserves the Node fallback",
    async (operation) => {
      const firstEnv = { SUPABASE_URL: "https://first-request.invalid" };
      const secondEnv = { SUPABASE_URL: "https://second-request.invalid" };
      const first = fixture(true);
      const second = fixture(true);
      const fallback = fixture();
      mocks.adminClient.mockImplementation((bindings) => {
        if (bindings === firstEnv) return first.client;
        if (bindings === secondEnv) return second.client;
        expect(bindings).toBe(nodeEnv);
        return fallback.client;
      });

      // Pause both requests at their first database result, then finish B before A.
      const firstRequest = operation.run(repo, firstEnv);
      const secondRequest = operation.run(repo, secondEnv);
      const settled = Promise.allSettled([firstRequest, secondRequest]);
      try {
        const bothPaused = await Promise.all([
          Promise.race([
            first.entered.promise.then(() => true),
            firstRequest.then(
              () => false,
              () => false,
            ),
          ]),
          Promise.race([
            second.entered.promise.then(() => true),
            secondRequest.then(
              () => false,
              () => false,
            ),
          ]),
        ]);
        expect(bothPaused, "Both requests must reach their own client").toEqual(
          [true, true],
        );
        await repo.createInstitution({ name: "Node while both paused" });
        second.resume.release();
        expect((await secondRequest).id).toBe(ids[operation.table]);
        await repo.createInstitution({ name: "Node while first paused" });
        first.resume.release();
        expect((await firstRequest).id).toBe(ids[operation.table]);
        await repo.createInstitution({ name: "Node after both completed" });

        expectQueries(first.queries, operation);
        expectQueries(second.queries, operation);
        expect(fallback.queries).toEqual(
          Array.from({ length: 3 }, () => ({
            table: "institutions",
            operation: "insert",
            filters: [],
          })),
        );
        const bindings = mocks.adminClient.mock.calls.map(([env]) => env);
        expect(bindings.filter((env) => env === firstEnv)).toHaveLength(
          operation.reads.length + 1,
        );
        expect(bindings.filter((env) => env === secondEnv)).toHaveLength(
          operation.reads.length + 1,
        );
        expect(bindings.filter((env) => env === nodeEnv)).toHaveLength(3);
      } finally {
        first.resume.release();
        second.resume.release();
        await settled;
      }
    },
  );
});
