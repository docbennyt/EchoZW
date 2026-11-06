/* global URL, Response, TextDecoder */
import {
  listOwnedExamReminderPreferences,
  updateOwnedExamReminderPreferences,
} from "../server/examReminderPreferences.ts";
import { PilotApiError } from "../server/pilotRepository.ts";

export async function handleExamReminderPreferences(request, env) {
  const url = new URL(request.url);
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (!["GET", "PATCH"].includes(request.method))
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } },
      405,
    );
  const owner =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("calenderzw_anon_session="))
      ?.slice("calenderzw_anon_session=".length) ?? null;
  try {
    if (request.method === "GET")
      return json(
        await listOwnedExamReminderPreferences(
          url.searchParams.get("timetableId") ?? "",
          owner,
          env,
        ),
      );
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (
      (origin !== url.origin &&
        !(origin === env.PUBLIC_APP_URL && site === "same-origin")) ||
      site === "cross-site"
    )
      return json(
        {
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "Use the application where you connected this calendar.",
          },
        },
        403,
      );
    const reader = request.body?.getReader();
    let body = "";
    let size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          return json(
            {
              error: {
                code: "BODY_TOO_LARGE",
                message: "Request is too large.",
              },
            },
            413,
          );
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    }
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      return json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid request." } },
        422,
      );
    }
    return json(await updateOwnedExamReminderPreferences(input, owner, env));
  } catch (error) {
    return json(
      {
        error: {
          code: error instanceof PilotApiError ? error.code : "INTERNAL_ERROR",
          message:
            error instanceof PilotApiError
              ? error.message
              : "Reminder settings could not be loaded.",
        },
      },
      error instanceof PilotApiError ? error.status : 500,
    );
  }
}
