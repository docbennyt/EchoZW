---
name: czw-review
description: Review one CalenderZW pull request from a fresh context against its linked Linear issue, current head SHA, required CI evidence, repository docs, and high-risk gates. Apply loop labels conservatively. Never merge.
---

# czw-review

## Purpose

Review one PR in a fresh context or fresh session from the builder.

Never review from the same working context that built the change.

Never merge.

## Required inputs

Read all of these before producing a verdict:

- linked Linear issue
- full diff
- affected files in context
- CI state
- mergeability
- relevant architecture docs
- `docs/CODEX_ENGINEERING_LOOP.md`

Review the exact current PR head SHA.

If the head SHA changes during review, discard the review and start again later.

## Required finding classes

Every must-fix finding must start with one of:

- `[AC-N]`
- `[DEFECT]`
- `[SECURITY]`
- `[CI]`
- `[SCOPE-CONFLICT]`

Use:

- `[AC-N]` when the PR fails that acceptance criterion
- `[DEFECT]` when behavior is broken while staying inside scope
- `[SECURITY]` for shipping-blocking security risk
- `[CI]` for failed required checks
- `[SCOPE-CONFLICT]` when the requested fix would cross a non-goal or contradict the issue contract

Non-goals are binding.

## Review standard

Review only against:

- the linked Linear contract
- repository architecture and policy
- current CI and merge evidence
- CalenderZW high-risk rules

Do not suggest unrelated improvements unless they are severe.

## Required labels

Use these labels:

- `loop-approved`
- `loop-changes-requested`
- `needs-human-review`
- `loop-stuck`

Only apply `loop-approved` when all of these are true:

- all ACs are satisfied
- there is no must-fix defect
- required CI is green
- the current head SHA was reviewed
- there is no unresolved merge conflict

If the repository has no required CI for the PR, escalate to `needs-human-review`. Missing CI is not green.

## High-risk gate

High-risk changes should retain `needs-human-review` even when technically correct.

Always require `needs-human-review` for changes involving:

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

## Verdict shape

Post one verdict that makes clear:

- the reviewed head SHA
- CI result
- mergeability
- summary
- must-fix findings
- optional follow-up
- whether the PR is safe for human merge

`loop-approved` is evidence for a human. It is not merge authorization.

## Hard limits

- Never merge.
- Never enable auto-merge.
- Never approve or request changes through a formal GitHub review if a comment-plus-label workflow is the safer repository policy.
- Never review a stale commit and present it as current.
