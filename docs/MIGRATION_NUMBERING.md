# Migration Numbering

The repository keeps Supabase migration filenames in a single increasing
sequence so future migration runners and reviewers see deterministic order.

On 2026-09-01 the repository had two local `0010_*` files:

- `0010_class_rep_corrections_and_exceptions.sql`
- `0010_subscriber_profiles.sql`

Both changes were already represented in production history under timestamped
Supabase migration names. The repository-only hygiene fix renamed the subscriber
profile file to `0011_subscriber_profiles.sql` without changing or replaying its
DDL. Do not blindly reapply either migration to production; use Supabase
migration history and schema readiness checks to confirm whether an environment
already contains the equivalent objects.
