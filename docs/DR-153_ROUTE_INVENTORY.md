# DR-153 Cloudflare Native-Versus-Bridged Route Inventory

Generated for the DR-153 migration checkpoint on 2026-10-12.

Machine-readable source: [DR-153_ROUTE_INVENTORY.json](./DR-153_ROUTE_INVENTORY.json)

## Summary

- Native/native-if-configured Worker routes: release identity, runtime config, health/readiness, public timetable reads, staff session read, calendar feed/download ICS, and authenticated edge source document intake.
- Static Cloudflare asset ownership: SPA routes, class deep links, `/t/:slug/google`, and immutable `/assets/*` files remain owned by the same deployed Vite build.
- Bridged routes: authenticated Admin/Class Rep mutations, calendar subscription creation, Google OAuth/callback/disconnect, payments, analytics, growth capture/admin, push, internal source snapshots, static import review/drafts, and scheduled cleanup still require the Railway Node backend.
- Native incomplete background route: `SOURCE_PROCESSING_QUEUE` is bound and receives authenticated source upload messages, but currently ACKs `source_document_uploaded` rather than parsing into Supabase review evidence.

## Current Native Worker Surface

| Method   | Route                                    | Auth                         | Runtime status                               | Contract evidence                           |
| -------- | ---------------------------------------- | ---------------------------- | -------------------------------------------- | ------------------------------------------- |
| GET      | `/__release`                             | public-safe                  | native                                       | `scripts/smoke-cloudflare-staging.mjs`      |
| GET      | `/runtime-config.js`                     | browser-safe public config   | native                                       | `tests/cloudflareRuntimeFoundation.test.ts` |
| GET      | `/api/health/live`                       | public health                | native                                       | `scripts/smoke-cloudflare-staging.mjs`      |
| GET      | `/api/health/release`                    | public-safe release identity | native                                       | `scripts/smoke-cloudflare-staging.mjs`      |
| GET      | `/api/health/ready`                      | public readiness             | native                                       | `tests/cloudflareRuntimeFoundation.test.ts` |
| GET      | `/api/public/timetables`                 | public                       | native when Supabase config is present       | `tests/publicTimetableCore.test.ts`         |
| GET      | `/api/public/timetables/:slug`           | public                       | native when Supabase config is present       | `tests/publicTimetableCore.test.ts`         |
| GET/HEAD | `/calendar/feed/:token.ics`              | private feed token           | native when Supabase/token config is present | `scripts/smoke-cloudflare-staging.mjs`      |
| GET/HEAD | `/calendar/download/:subscriptionId.ics` | private subscription id      | native when Supabase config is present       | `scripts/smoke-cloudflare-staging.mjs`      |
| GET      | `/api/admin/session`                     | staff bearer token           | native when Supabase config is present       | `tests/adminAuth.test.ts`                   |
| POST     | `/api/edge/source-documents`             | service bearer secret        | native when R2/Queue/secret are present      | authenticated staging smoke                 |

## Current Bridged Runtime Surface

The JSON inventory lists each bridged route family with auth policy, service owner, database dependencies, and remaining blocker. These route families are still proxied through `LEGACY_BACKEND_ORIGIN`:

- `/api/calendar/subscriptions`
- `/api/calendar/subscriptions/:id/revoke`
- `/api/calendar/google/connect`
- `/api/calendar/google/callback`
- `/api/calendar/google/disconnect`
- `/api/admin/my/timetables`
- `/api/admin/timetables/:id/corrections*`
- `/api/admin/timetables/:id/exceptions*`
- `/api/admin/timetables/:id/pauses*`
- `/api/admin/institutions|programmes|class-groups|academic-periods|timetables*`
- `/api/admin/static-timetable-imports*`
- `/api/admin/staff*`
- `/api/admin/source-gateway*`
- `/api/internal/source-snapshots`
- `/api/analytics/events`
- `/api/payments*`
- `/api/public/timetable-requests|/api/public/feedback`
- `/api/admin/growth*|/api/admin/analytics*`
- `/api/push*`
- `static raw cleanup`

## First Authenticated Cloudflare Workflow

The Worker source document intake now fails closed unless `EDGE_SOURCE_UPLOAD_SECRET` is configured and the request supplies `Authorization: Bearer <secret>` or `X-CalenderZW-Edge-Upload-Secret`.

The exact-head Cloudflare smoke now proves:

1. unauthenticated `POST /api/edge/source-documents` returns `401`;
2. authenticated `POST /api/edge/source-documents` accepts a DOCX-shaped diagnostic payload;
3. the Worker writes the private object to staging R2;
4. the Worker dispatches `source_document_uploaded` to `SOURCE_PROCESSING_QUEUE`;
5. the response reports `queued: true` without exposing the secret.

This is the first authenticated native Worker workflow. `GET /api/admin/session` now has a native Worker adapter too, with anonymous rejection covered by staging smoke. A successful 200 staff-session canary still requires a real staging staff access token. Admin/Class Rep mutation route families remain bridged until their Request/Response adapters are migrated.
