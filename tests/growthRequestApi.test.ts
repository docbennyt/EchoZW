import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  handleGrowthAdminRequest,
  handleGrowthPublicRequest,
} from "../server/growthRequestApi";
import type { GrowthRequest } from "../server/growthRequestRepository";

let requestNumber = 0;

function request(method: string, url: string, body?: unknown): IncomingMessage {
  requestNumber += 1;
  const stream = Readable.from(
    body === undefined ? [] : [JSON.stringify(body)],
  ) as IncomingMessage;
  Object.assign(stream, {
    method,
    url,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-forwarded-for": `192.0.2.${requestNumber}`,
    },
    socket: { remoteAddress: `192.0.2.${requestNumber}` },
  });
  return stream;
}

function response() {
  const chunks: string[] = [];
  const res = new EventEmitter() as ServerResponse & {
    statusCode?: number;
    headers?: Record<string, string>;
  };
  res.writeHead = ((statusCode: number, headers: Record<string, string>) => {
    res.statusCode = statusCode;
    res.headers = headers;
    return res;
  }) as ServerResponse["writeHead"];
  res.end = ((chunk?: string) => {
    if (chunk) chunks.push(chunk);
    res.emit("finish");
    return res;
  }) as ServerResponse["end"];
  return {
    res,
    body: () => JSON.parse(chunks.join("")),
  };
}

const savedRequest: GrowthRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  requestType: "missing_timetable",
  status: "new",
  timetableId: null,
  publicSlug: null,
  institutionName: "Harare Institute of Technology",
  programmeName: "Computer Science",
  classGroupLabel: "Part 2.1",
  academicPeriodName: "August Semester 2026",
  feedbackType: null,
  rating: null,
  message: "Class Rep can provide the official source.",
  contactName: "Class Rep",
  contactEmail: null,
  contactPhoneE164: "+263780481182",
  contactConsent: true,
  isClassRep: true,
  canProvideSource: true,
  testimonialConsent: false,
  testimonialApproved: false,
  testimonialApprovedAt: null,
  testimonialApprovedBy: null,
  sourcePage: "/find",
  internalNote: null,
  resolvedAt: null,
  createdAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T10:00:00.000Z",
};

describe("growth request API", () => {
  it("captures missing timetable demand while keeping PII out of the response", async () => {
    const create = vi.fn().mockResolvedValue(savedRequest);
    const { res, body } = response();

    await handleGrowthPublicRequest(
      request("POST", "/api/public/growth-requests", {
        requestType: "missing_timetable",
        institutionName: "Harare Institute of Technology",
        programmeName: "Computer Science",
        classGroupLabel: "Part 2.1",
        academicPeriodName: "August Semester 2026",
        contactName: "Class Rep",
        contactPhoneE164: "0780 481 182",
        contactConsent: true,
        isClassRep: true,
        canProvideSource: true,
        sourcePage: "/find?utm_source=test",
      }),
      res,
      {},
      { create },
    );

    expect(res.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        contactPhoneE164: "+263780481182",
        contactConsent: true,
        isClassRep: true,
        canProvideSource: true,
        sourcePage: "/find",
      }),
      {},
    );
    expect(body()).toEqual({
      request: {
        id: savedRequest.id,
        requestType: "missing_timetable",
        status: "new",
        createdAt: savedRequest.createdAt,
      },
    });
    expect(JSON.stringify(body())).not.toContain("+263780481182");
    expect(JSON.stringify(body())).not.toContain("Class Rep");
  });

  it("refuses to store contact details without explicit consent", async () => {
    const create = vi.fn();
    const { res, body } = response();

    await handleGrowthPublicRequest(
      request("POST", "/api/public/growth-requests", {
        requestType: "missing_timetable",
        institutionName: "HIT",
        programmeName: "Computer Science",
        classGroupLabel: "1.1",
        contactEmail: "student@example.com",
        contactConsent: false,
      }),
      res,
      {},
      { create },
    );

    expect(res.statusCode).toBe(422);
    expect(body().error.code).toBe("CONTACT_CONSENT_REQUIRED");
    expect(create).not.toHaveBeenCalled();
  });

  it("does not let testimonial permission bypass contact consent", async () => {
    const create = vi.fn();
    const { res, body } = response();

    await handleGrowthPublicRequest(
      request("POST", "/api/public/growth-requests", {
        requestType: "feedback",
        feedbackType: "rating",
        rating: 5,
        message: "Useful timetable.",
        testimonialConsent: true,
      }),
      res,
      {},
      { create },
    );

    expect(res.statusCode).toBe(422);
    expect(body().error.code).toBe("TESTIMONIAL_CONSENT_INVALID");
    expect(create).not.toHaveBeenCalled();
  });

  it("silently accepts honeypot submissions without polluting the inbox", async () => {
    const create = vi.fn();
    const { res, body } = response();

    await handleGrowthPublicRequest(
      request("POST", "/api/public/growth-requests", {
        website: "https://spam.example",
      }),
      res,
      {},
      { create },
    );

    expect(res.statusCode).toBe(202);
    expect(body()).toEqual({ accepted: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("lists private requests for the authenticated admin handler", async () => {
    const list = vi.fn().mockResolvedValue([savedRequest]);
    const { res, body } = response();

    await handleGrowthAdminRequest(
      request(
        "GET",
        "/api/admin/growth-requests?requestType=missing_timetable&status=new",
      ),
      res,
      "22222222-2222-4222-8222-222222222222",
      {},
      { list },
    );

    expect(res.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith(
      { requestType: "missing_timetable", status: "new", limit: 50 },
      {},
    );
    expect(body().requests).toHaveLength(1);
  });

  it("updates triage state through the founder handler", async () => {
    const updated = { ...savedRequest, status: "triaged" as const };
    const update = vi.fn().mockResolvedValue(updated);
    const { res, body } = response();

    await handleGrowthAdminRequest(
      request(
        "PATCH",
        `/api/admin/growth-requests/${savedRequest.id}`,
        { status: "triaged", internalNote: "Contact Class Rep" },
      ),
      res,
      "22222222-2222-4222-8222-222222222222",
      {},
      { update },
    );

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      savedRequest.id,
      {
        status: "triaged",
        internalNote: "Contact Class Rep",
        testimonialApproved: undefined,
      },
      "22222222-2222-4222-8222-222222222222",
      {},
    );
    expect(body().request.status).toBe("triaged");
  });
});
