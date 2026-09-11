import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsHandler = vi.hoisted(() =>
  vi.fn(async (...args: unknown[]) => {
    const res = args[1] as ServerResponse | undefined;
    if (res) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
    }
    return true;
  }),
);

vi.mock("../server/timetablePublicSettingsAdminApi", () => ({
  handleTimetablePublicSettingsAdminApi: settingsHandler,
}));

import { handleAdminRequest } from "../server/adminApi";

function request(authorization = "Bearer valid") {
  const stream = Readable.from([]) as IncomingMessage;
  Object.assign(stream, {
    method: "PUT",
    url: "/api/admin/timetables/11111111-1111-4111-8111-111111111111/public-settings",
    headers: authorization ? { authorization } : {},
  });
  return stream;
}

function response() {
  const chunks: string[] = [];
  const res = new EventEmitter() as ServerResponse & { statusCode?: number };
  res.writeHead = ((statusCode: number) => {
    res.statusCode = statusCode;
    return res;
  }) as ServerResponse["writeHead"];
  res.end = ((chunk?: string) => {
    if (chunk) chunks.push(chunk);
    res.emit("finish");
    return res;
  }) as ServerResponse["end"];
  return { res, body: () => JSON.parse(chunks.join("")) };
}

function userClient(id = "user-1") {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id, email: `${id}@example.com` } },
        error: null,
      })),
    },
  };
}

function adminClient(
  role: "superadmin" | "admin" | "class_rep",
  isFounder = false,
) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => {
          const builder = {
            eq: vi.fn(() => builder),
            maybeSingle: vi.fn(async () => ({
              data:
                table === "staff_users"
                  ? {
                      id: `staff-${role}`,
                      role,
                      active: true,
                      is_founder: isFounder,
                      display_name: null,
                      email: `${role}@example.com`,
                    }
                  : null,
              error: null,
            })),
          };
          return builder;
        }),
      })),
    })),
  };
}

describe("founder-only timetable public settings route", () => {
  beforeEach(() => settingsHandler.mockClear());

  it("rejects anonymous mutation", async () => {
    const { res, body } = response();
    await handleAdminRequest(request(""), res);
    expect(res.statusCode).toBe(401);
    expect(body().error.code).toBe("AUTH_REQUIRED");
    expect(settingsHandler).not.toHaveBeenCalled();
  });

  it("rejects a Class Rep even when authenticated", async () => {
    const { res, body } = response();
    await handleAdminRequest(request(), res, {
      createUserClient: () => userClient("rep-user"),
      createAdminClient: () => adminClient("class_rep"),
    });
    expect(res.statusCode).toBe(403);
    expect(body().error.code).toBe("FOUNDER_REQUIRED");
    expect(settingsHandler).not.toHaveBeenCalled();
  });

  it("rejects a normal operational Admin", async () => {
    const { res, body } = response();
    await handleAdminRequest(request(), res, {
      createUserClient: () => userClient("admin-user"),
      createAdminClient: () => adminClient("admin"),
    });
    expect(res.statusCode).toBe(403);
    expect(body().error.code).toBe("FOUNDER_REQUIRED");
    expect(settingsHandler).not.toHaveBeenCalled();
  });

  it("allows the protected founder-superadmin", async () => {
    const { res, body } = response();
    await handleAdminRequest(request(), res, {
      createUserClient: () => userClient("founder-user"),
      createAdminClient: () => adminClient("superadmin", true),
    });
    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({ ok: true });
    expect(settingsHandler).toHaveBeenCalledTimes(1);
    expect(settingsHandler.mock.calls[0]?.[2]).toMatchObject({
      staff: {
        id: "staff-superadmin",
        role: "superadmin",
        isFounder: true,
      },
    });
  });
});
