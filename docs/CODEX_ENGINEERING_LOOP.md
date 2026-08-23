# Codex Engineering Loop

Date: 2026-08-22

## Purpose

This repository uses a Codex-native engineering loop inspired by Finn-loop's workflow principles and adapted for repository skills under `.agents/skills/`.

The loop is:

idea or bug -> `czw-spec` -> human reviews the Linear issue -> human applies `agent-ready` -> `czw-build` -> GitHub PR + CI -> fresh-session `czw-review` -> human merges

Humans merge. Agents do not merge and do not enable auto-merge.

## Sources of truth

- Linear is the work and specification source of truth.
- GitHub is the code, pull request, CI, and merge source of truth.
- Slack is a human attention and control surface only.
- The repository is the source of truth for architecture, policies, and agent behavior.

Never store unique project state only in Slack.

## Repository inspection summary

### AGENTS.md

No `AGENTS.md` file exists in this repository as of 2026-08-22.

### Package and commands

`package.json` defines:

- `npm run build`
- `npm run test`
- `npm run lint`
- `npm run format:check`

The stack is React, Vite, TypeScript, Vitest, ESLint, and a Node production server.

### CI

`.github/workflows/ci.yml` runs on `push` and `pull_request` and executes:

1. `npm ci`
2. `npm run lint`
3. `npm run format:check`
4. `npm run test`
5. `npm run build`

### GitHub default branch

The repository remote is `docbennyt/EchoZW`. GitHub reports the default branch as `Calender`.

### Architecture and status documentation

The main durable architecture and status references currently present are:

- `docs/ARCHITECTURE.md`
- `docs/ARCHITECTURE_REMEDIATION_PLAN.md`
- `docs/IMPORT_ARCHITECTURE.md`
- `docs/IMPORT_REVIEW_WORKFLOW.md`
- `docs/SOURCE_TRACEABILITY.md`
- `docs/PRODUCTION_DATA_AUDIT.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `Progress.md`

These documents establish several high-risk areas for review and escalation, especially around Supabase auth, publication, source traceability, stable identifiers, and calendar delivery.

## Current integration state

### GitHub

- Live GitHub repository metadata is available through the GitHub connector in this Codex environment.
- The repository is public.
- The authenticated connector has admin and push-level repository permissions.
- Repository metadata confirms `allow_auto_merge: false`.
- Local `gh` CLI authentication is currently invalid in this shell session, so the loop must not assume `gh` is usable without re-authentication.

### Linear

- No callable Linear connector was available in this Codex session on 2026-08-22.
- No checked-in repository automation for Linear was found.
- As a result, live team key, labels, workflow states, blocked-by relations, and current issue queue state remain unverified from this session.

### Slack

- No callable Slack connector was available in this Codex session on 2026-08-22.
- No checked-in repository automation for Slack was found.
- Slack channel behavior in this loop is therefore documented as policy and intended operating mode, not as a verified live integration.

## Required labels

### Linear

The loop expects these labels to exist:

- `agent-ready`
- `blocked`
- `needs-spec`

Only a human applies `agent-ready`.

### GitHub

The loop expects these labels to exist:

- `loop-approved`
- `loop-changes-requested`
- `needs-human-review`
- `loop-stuck`

Do not remove or destroy unrelated existing labels.

## Skill map

Repository skills live in:

- `.agents/skills/czw-spec/SKILL.md`
- `.agents/skills/czw-build/SKILL.md`
- `.agents/skills/czw-review/SKILL.md`
- `.agents/skills/czw-status/SKILL.md`
- `.agents/skills/czw-watchdog/SKILL.md`

### czw-spec

Turns a raw idea or bug into a Linear issue that another Codex session can implement without guessing. It researches the codebase first, asks only product questions the code cannot answer, uses `AC-N` and `NG-N` contracts, and never applies `agent-ready`.

### czw-build

Performs one unit of work per invocation. It prioritizes safe repair of an existing `loop-changes-requested` PR, otherwise claims one eligible Linear issue, implements only the issue contract, verifies the change, and opens or updates a PR. It never merges.

### czw-review

Runs in a fresh session from the builder, reviews one exact PR head SHA against the linked Linear contract, checks CI and mergeability, classifies findings with required prefixes, and applies labels conservatively. It never merges.

### czw-status

Read-only founder view over live Linear plus GitHub state. It returns an ordered action list without mutating any system.

### czw-watchdog

Mostly read-only incident detection across Linear, GitHub, source-sync health, and publication verification. It posts one alert when an incident begins and one resolved notification when it clears.

## CalenderZW high-risk paths

Changes in the following areas must retain `needs-human-review` even when implementation and CI are otherwise acceptable:

- Supabase migrations
- RLS
- authentication
- authorization
- admin provisioning
- class-rep permissions
- Google source credentials
- secret handling
- schedule source synchronization
- automatic timetable publication
- source or rep conflict resolution
- timetable versioning
- `stable_session_key`
- ICS UID
- calendar subscription tokens
- production deployment configuration

## Slack operating policy

Slack is a control plane, not the durable system of record.

Recommended channels:

- `#czw-dev`
- `#czw-blocked`
- `#czw-merge-ready`
- `#czw-source-alerts`

Expected message content:

- Blocked: exact Linear issue plus the exact question
- Merge-ready: PR URL, AC evidence, CI result, risk
- Source alerts: source name, last good sync, error, affected classes

Any mutation initiated from Slack must first reread current Linear and GitHub state. Old Slack messages are not current authorization.

## Source-watcher initiative context

The repository already documents source ingestion and traceability, but not yet a durable source-watcher control loop. Relevant existing context includes:

- `docs/IMPORT_ARCHITECTURE.md`
- `docs/IMPORT_REVIEW_WORKFLOW.md`
- `docs/SOURCE_TRACEABILITY.md`
- `docs/ARCHITECTURE_REMEDIATION_PLAN.md`
- `docs/PRODUCTION_DATA_AUDIT.md`

The next source-watcher specs should preserve the current architecture rule that publication and sync behavior must be auditable, traceable to source artifacts, and safe against destructive or silent drift.
