import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/0019_growth_requests.sql",
  "utf8",
);

describe("growth requests migration", () => {
  it("keeps demand and feedback data server-owned", () => {
    expect(migration).toContain(
      "alter table public.growth_requests enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.growth_requests from anon, authenticated",
    );
    expect(migration).toContain(
      "grant all on table public.growth_requests to service_role",
    );
  });

  it("requires consent before contact data or testimonials can be used", () => {
    expect(migration).toContain(
      "contact_consent\n    or (contact_email is null and contact_phone_e164 is null)",
    );
    expect(migration).toContain(
      "not testimonial_consent\n    or (request_type = 'feedback' and contact_consent)",
    );
    expect(migration).toContain("not testimonial_approved");
    expect(migration).toContain("testimonial_approved_by is not null");
  });

  it("requires a real class identity for missing timetable demand", () => {
    expect(migration).toContain("request_type <> 'missing_timetable'");
    expect(migration).toContain("nullif(btrim(institution_name), '') is not null");
    expect(migration).toContain("nullif(btrim(programme_name), '') is not null");
    expect(migration).toContain("nullif(btrim(class_group_label), '') is not null");
  });
});
