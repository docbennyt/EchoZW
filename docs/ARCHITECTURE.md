# Architecture

The pilot is a React/Vite application with domain logic separated from UI components.

- `src/config`: product configuration and feature flags.
- `src/domain`: timetable types, seed data, reminders, next-event calculation, validation, and calendar generation.
- `src/integrations`: provider interfaces for PesePay and future timetable extraction.
- `src/App.tsx`: public routes, dashboard scaffold, sync wizard, and reporting UI.

Production should add Supabase-backed persistence, RLS, edge/server handlers for feeds, OAuth callbacks, payment webhooks, and audit logs.
