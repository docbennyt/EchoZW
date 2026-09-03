import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  enqueueLatestSourceSnapshot,
  listSourceGatewayState,
  mapSourceCohort,
  mapSourceProgramme,
} from "./sourceGatewayAdminRepository.js";
import { SourceSnapshotRepositoryError } from "./sourceSnapshotRepository.js";

const programmeMappingSchema = z.object({
  targetProgrammeId: z.string().uuid(),
});

const cohortMappingSchema = z.object({
  targetAcademicPeriodId: z.string().uuid(),
  targetCohortId: z.string().uuid(),
  targetProgrammeId: z.string().uuid(),
});

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as unknown) : {};
}

function sendSourceGatewayError(res: ServerResponse, error: unknown) {
  if (error instanceof z.ZodError) {
    sendJson(res, 422, {
      error: {
        code: "VALIDATION_FAILED",
        message: "Check the highlighted fields.",
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }

  if (error instanceof SourceSnapshotRepositoryError) {
    sendJson(res, error.status, {
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    });
    return;
  }

  sendJson(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "We could not complete that request. Please try again.",
    },
  });
}

export async function handleSourceGatewayAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  user: { id: string },
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");

  try {
    if (
      req.method === "GET" &&
      requestUrl.pathname === "/api/admin/source-gateway"
    ) {
      sendJson(res, 200, await listSourceGatewayState());
      return true;
    }

    const programmeMatch = requestUrl.pathname.match(
      /^\/api\/admin\/source-gateway\/programmes\/([^/]+)\/mapping$/,
    );
    if (req.method === "POST" && programmeMatch) {
      const parsed = programmeMappingSchema.parse(await readJson(req));
      sendJson(res, 200, {
        programme: await mapSourceProgramme({
          discoveredProgrammeId: decodeURIComponent(programmeMatch[1]),
          targetProgrammeId: parsed.targetProgrammeId,
          userId: user.id,
        }),
      });
      return true;
    }

    const cohortMatch = requestUrl.pathname.match(
      /^\/api\/admin\/source-gateway\/cohorts\/([^/]+)\/mapping$/,
    );
    if (req.method === "POST" && cohortMatch) {
      const parsed = cohortMappingSchema.parse(await readJson(req));
      sendJson(res, 200, {
        cohort: await mapSourceCohort({
          discoveredCohortId: decodeURIComponent(cohortMatch[1]),
          targetAcademicPeriodId: parsed.targetAcademicPeriodId,
          targetCohortId: parsed.targetCohortId,
          targetProgrammeId: parsed.targetProgrammeId,
          userId: user.id,
        }),
      });
      return true;
    }

    const processMatch = requestUrl.pathname.match(
      /^\/api\/admin\/source-gateway\/sources\/([^/]+)\/process-latest$/,
    );
    if (req.method === "POST" && processMatch) {
      sendJson(res, 202, {
        job: await enqueueLatestSourceSnapshot(
          decodeURIComponent(processMatch[1]),
        ),
      });
      return true;
    }
  } catch (error) {
    sendSourceGatewayError(res, error);
    return true;
  }

  return false;
}
