export type SeoRouteMetadata = {
  title: string;
  description: string;
  canonicalPath: string;
  robots?: string;
};

export const INDEXABLE_STATIC_ROUTES = [
  "/",
  "/find",
  "/support",
  "/privacy",
  "/terms",
  "/data-deletion",
] as const;

const staticRouteMetadata: Record<string, SeoRouteMetadata> = {
  "/": {
    title: "CalenderZW | University timetables in your calendar",
    description:
      "Find a published university timetable and add your classes to Google Calendar, Apple Calendar, or a subscribed calendar feed.",
    canonicalPath: "/",
  },
  "/find": {
    title: "Find your university timetable | CalenderZW",
    description:
      "Find a published CalenderZW timetable by institution, programme, class, and academic period.",
    canonicalPath: "/find",
  },
  "/support": {
    title: "CalenderZW help and timetable support",
    description:
      "Get help with a timetable, calendar connection, or incorrect class information on CalenderZW.",
    canonicalPath: "/support",
  },
  "/privacy": {
    title: "Privacy Policy | CalenderZW",
    description:
      "Read how CalenderZW handles timetable, calendar, analytics, and optional contact data.",
    canonicalPath: "/privacy",
  },
  "/terms": {
    title: "Terms of Service | CalenderZW",
    description:
      "Read the terms that apply to CalenderZW timetable, calendar, and administrator services.",
    canonicalPath: "/terms",
  },
  "/data-deletion": {
    title: "Data deletion | CalenderZW",
    description:
      "Learn how to disconnect Google Calendar and request deletion of eligible CalenderZW data.",
    canonicalPath: "/data-deletion",
  },
};

const noindexRouteMetadata: Record<string, SeoRouteMetadata> = {
  "/account/settings": {
    title: "Calendar settings | CalenderZW",
    description: "Manage a CalenderZW calendar connection.",
    canonicalPath: "/account/settings",
    robots: "noindex, nofollow",
  },
  "/account/update-password": {
    title: "Set your CalenderZW password",
    description: "Complete a CalenderZW administrator account setup.",
    canonicalPath: "/account/update-password",
    robots: "noindex, nofollow",
  },
  "/auth/callback": {
    title: "CalenderZW sign-in",
    description: "Complete a CalenderZW sign-in request.",
    canonicalPath: "/auth/callback",
    robots: "noindex, nofollow",
  },
};

export function getStaticSeoMetadata(pathname: string) {
  return staticRouteMetadata[pathname] ?? noindexRouteMetadata[pathname] ?? null;
}

export function isKnownSpaPath(pathname: string) {
  if (getStaticSeoMetadata(pathname)) return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if (/^\/t\/[^/]+(?:\/google)?\/?$/.test(pathname)) return true;
  if (/^\/sync\/[^/]+\/?$/.test(pathname)) return true;
  return false;
}

export function noindexMetadataForPath(pathname: string): SeoRouteMetadata {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return {
      title: "CalenderZW Admin",
      description: "CalenderZW administrator workspace.",
      canonicalPath: "/admin",
      robots: "noindex, nofollow",
    };
  }

  return {
    title: "Page not found | CalenderZW",
    description: "Find your university timetable or return to CalenderZW.",
    canonicalPath: pathname,
    robots: "noindex, nofollow",
  };
}
