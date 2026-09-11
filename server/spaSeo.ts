import type { PublicTimetable } from "../src/api/pilotTypes.js";
import { buildPublicTimetableMetadata } from "../src/domain/publicTimetable.js";
import {
  getStaticSeoMetadata,
  isKnownSpaPath,
  isSensitiveAuthSpaPath,
  noindexMetadataForPath,
} from "../src/domain/seo.js";
import { getPublishedTimetableBySlug } from "./pilotRepository.js";
import { injectSpaMetadata, type SpaMetadata } from "./spaMetadata.js";

export type PublishedTimetableResolver = (
  slug: string,
) => Promise<PublicTimetable>;

export type SpaSeoResponse = {
  statusCode: number;
  responseBody: string;
  cacheControl: string;
  metadata: SpaMetadata;
};

export async function resolveSpaSeoMetadata(
  requestTarget: string,
  resolvePublishedTimetable: PublishedTimetableResolver = getPublishedTimetableBySlug,
) {
  const requestUrl = new URL(requestTarget, "http://localhost");
  const pathname = requestUrl.pathname;
  let statusCode = isKnownSpaPath(pathname) ? 200 : 404;
  let metadata: SpaMetadata =
    getStaticSeoMetadata(pathname) ?? noindexMetadataForPath(pathname);

  const googleConnectMatch = pathname.match(/^\/t\/([^/]+)\/google\/?$/);
  const timetableMatch = pathname.match(/^\/t\/([^/]+)\/?$/);

  if (googleConnectMatch) {
    const slug = decodeURIComponent(googleConnectMatch[1]);
    metadata = {
      title: "Connect Google Calendar | CalenderZW",
      description:
        "Connect a published CalenderZW timetable to Google Calendar.",
      canonicalPath: `/t/${encodeURIComponent(slug)}`,
      robots: "noindex, nofollow",
    };
  } else if (timetableMatch) {
    const slug = decodeURIComponent(timetableMatch[1]);
    try {
      const timetable = await resolvePublishedTimetable(slug);
      metadata = buildPublicTimetableMetadata(timetable);
      statusCode = 200;
    } catch {
      metadata = noindexMetadataForPath(pathname);
      statusCode = 404;
    }
  }

  return { pathname, statusCode, metadata };
}

export async function renderSpaSeoResponse(
  html: string,
  requestTarget: string,
  resolvePublishedTimetable: PublishedTimetableResolver = getPublishedTimetableBySlug,
): Promise<SpaSeoResponse> {
  const { pathname, statusCode, metadata } = await resolveSpaSeoMetadata(
    requestTarget,
    resolvePublishedTimetable,
  );
  const responseBody = injectSpaMetadata(html, metadata);
  const cacheControl = isSensitiveAuthSpaPath(pathname)
    ? "private, no-store"
    : statusCode === 404
      ? "no-store"
      : "public, max-age=300";

  return {
    statusCode,
    responseBody,
    cacheControl,
    metadata,
  };
}
