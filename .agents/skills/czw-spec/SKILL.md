---
name: czw-spec
description: Turn a CalenderZW idea or bug into a Linear issue that another Codex session can implement without guessing. Research the repository first, ask only product questions the code cannot answer, draft the exact issue contract, and create the issue only after human confirmation. Never apply agent-ready.
---

# czw-spec

## Purpose

Turn an idea or bug into a Linear issue sufficiently precise that another Codex session can implement it without guessing.

The user is the product brain. You are the repository and implementation brain.

## Governance

- Linear is the work and specification source of truth.
- GitHub is the code, PR, CI, and merge source of truth.
- Slack is human attention only.
- The repository is the architecture and policy source of truth.
- Never store unique project state only in Slack.
- Never apply `agent-ready`. Only a human does that.

## Required repository research before questions

Always inspect the repository before asking questions:

1. Read the relevant code and tests first.
2. Read the relevant durable docs and runbooks.
3. Read `docs/CODEX_ENGINEERING_LOOP.md` for current loop policy.
4. Use existing architecture truth before asking the user something the codebase already answers.

Ask only product decisions the code cannot answer.

## Interview rule

Ask the fewest questions that remove genuine ambiguity. Ask only:

- behavior forks
- scope boundaries
- permissions or audience decisions
- failure behavior that changes the contract
- sequencing decisions when one issue should become multiple blocked-by issues

Before each question round, apply this confidence test:

Could two different engineers read the resulting issue and ship the same observable behavior?

If no, ask another short round. If yes, stop asking.

## Issue contract

Every issue must use exactly this structure:

## Problem

One or two sentences describing the user or business problem.

## Acceptance Criteria

- [ ] AC-1 ...
- [ ] AC-2 ...

## Non-goals

- NG-1 ...
- NG-2 ...

## Relevant files

- `path/to/file.ts` - why it matters

## Test expectations

- specific automated and manual verification expectations

## How to verify

1. Numbered manual steps anyone can follow.
2. Cover every AC with observable evidence.

## Contract rules

- Every acceptance criterion must describe observable behavior.
- Every non-goal is binding.
- Do not allow an AC to require behavior excluded by an NG.
- If an issue is larger than one agent-day, split it into multiple Linear issues connected by blocked-by relations.
- If the issue should be split, draft the chain in order instead of cramming multiple deliverables into one issue.
- Use repository terminology that matches current durable docs unless the user explicitly changes the terminology.

## CalenderZW-specific spec discipline

Research these before writing source, publication, or calendar specs:

- `docs/ARCHITECTURE.md`
- `docs/ARCHITECTURE_REMEDIATION_PLAN.md`
- `docs/IMPORT_ARCHITECTURE.md`
- `docs/IMPORT_REVIEW_WORKFLOW.md`
- `docs/SOURCE_TRACEABILITY.md`
- `docs/PRODUCTION_DATA_AUDIT.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `Progress.md`

When the work touches any of these, make the issue explicit about them:

- publication safety
- source traceability
- stable identifiers
- calendar subscription behavior
- Supabase auth or RLS boundaries
- administrative permissions

## Linear behavior

- Draft the issue in chat first.
- Get human confirmation before creating it in Linear.
- The skill may create the Linear issue after that confirmation.
- The skill must not apply `agent-ready`.
- If Linear tools are unavailable, return the final issue draft in chat and say creation is blocked by missing connector access.

## Output standard

Return either:

1. A final draft ready for human confirmation and optional Linear creation.
2. Multiple draft issues with a proposed blocked-by chain.
3. One specific blocking question if repository research still leaves a real product ambiguity.
