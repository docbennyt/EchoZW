---
name: czw-build
description: Perform one CalenderZW unit of work per invocation: first repair one safe loop-changes-requested PR when possible, otherwise claim one eligible Linear issue, implement only its contract, verify the change, and open or update a PR. Never merge or enable auto-merge.
---

# czw-build

## Purpose

One invocation performs one unit of work.

Priority:

1. Fix an existing `loop-changes-requested` PR when safe.
2. Otherwise claim one eligible Linear issue.

Never merge. Never enable auto-merge.

## Governance

- Linear is the work and specification source of truth.
- GitHub is the code, PR, CI, and merge source of truth.
- Slack is human attention only.
- The repository is the architecture and policy source of truth.
- Humans merge.

## Preflight

Before changing Linear, GitHub, branches, or files:

1. Confirm this is the intended repository.
2. Detect the real GitHub default branch. Never assume `main`.
3. Require a clean working tree. If it is dirty, report the paths and stop.
4. Read `docs/CODEX_ENGINEERING_LOOP.md`.
5. Read the full Linear issue or review verdict before coding.

If GitHub or Linear access required for the pass is unavailable, stop and report the exact missing dependency.

## Cooperative lock

Only one automated builder should operate for the CalenderZW Linear team at once.

Use the Linear assignee as a cooperative lock:

- claim before coding
- re-read the issue immediately after claiming
- if it is no longer eligible, stop and pick again

## Review-fix priority

First inspect open PRs labeled `loop-changes-requested`.

Skip:

- draft PRs
- PRs labeled `needs-human-review`
- PRs whose requested fix would require changing the Linear contract

Choose the least recently updated safe PR. Read:

- the linked Linear issue
- the latest loop review verdict
- the current PR head SHA

Fix only the must-fix items. Do not broaden scope.

If a fix would cross a non-goal, require a product decision, or enter a high-risk area that the issue did not authorize, stop, add `needs-human-review`, and explain the exact conflict.

## Eligible issue definition

An issue is eligible only when it is:

- labeled `agent-ready`
- unassigned
- not labeled `blocked`
- not blocked by any unresolved relation

Claim it before coding.

## Read before build

Read the complete issue including:

- problem
- all `AC-N`
- all `NG-N`
- comments
- blocker relations

Implement only `AC-N` requirements.

`NG-N` requirements are binding.

No opportunistic refactors.

## Branching

Use a branch named from the real Linear identifier.

The branch name should begin with the real issue identifier and a short slug, for example:

- `CZW-123-source-watcher-snapshot-worker`

Never invent a fake identifier.

## Build rules

- Follow existing repository style and architecture.
- Add or update tests when behavior, permissions, data flow, parsing, or user-visible output changes.
- Preserve behavior outside the issue contract.
- If the issue is ambiguous, blocked, or contradictory, stop and return to the human with one exact question.

## Verification

Run the narrowest relevant checks plus all required repository checks attributable to the change before opening or updating a PR.

Default repository verification is:

- `npm run lint`
- `npm run format:check`
- `npm run test`
- `npm run build`

If a broad check is blocked by a known unrelated failure, run the relevant narrower check, preserve the evidence, and disclose the limitation in the PR.

## PR contract

The PR description must include:

- linked Linear issue
- what changed
- one evidence line for every `AC-N`
- one preservation statement for every `NG-N`
- manual verification instructions
- automated checks
- `risk: LOW`, `risk: MEDIUM`, or `risk: HIGH`
- `Other behavior changes: None`

If `Other behavior changes` is not `None`, stop and amend the Linear contract first.

## High-risk rule

Do not treat these as normal merge-ready changes. They require `needs-human-review` even when technically correct:

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

## Hard limits

- Never merge.
- Never enable auto-merge.
- Never broaden the Linear contract in code.
- Never trust stale Slack text as authorization.
- Never use Slack as the only durable record of state.
