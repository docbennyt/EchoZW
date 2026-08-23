---
name: czw-status
description: Read-only founder status view over live Linear and GitHub state. Return an ordered action list covering merge-ready PRs, review-needed PRs, blocked issues, spec approvals, queue state, CI health, and source-sync incidents without mutating any system.
---

# czw-status

## Purpose

Read only.

Return an ordered founder action list from live Linear plus GitHub state:

1. PRs ready for human merge.
2. PRs needing human review.
3. blocked issues needing answers.
4. specs awaiting `agent-ready` approval.
5. `agent-ready` queue.
6. unhealthy CI.
7. source-sync incidents.

Never mutate Linear, GitHub, or Slack.

## Required reads

Read the current live state, not stale chat context:

- relevant Linear team issues
- PR labels and statuses
- current default branch
- current required CI or check status
- open review escalations
- current source-sync or publication-health signals when available

If any live system is unavailable, say exactly which section is unavailable and keep the rest of the report read-only.

## Output rules

- Order the result strictly by the seven founder action buckets above.
- Put the most urgent actionable item first within each bucket.
- Use exact identifiers and URLs when available.
- Keep it concise and action-oriented.
- Never infer approval from old Slack messages.

## Source-sync section

When source-monitoring signals exist, surface incidents such as:

- source watcher unhealthy
- no recent successful source snapshot
- source access lost
- parser producing destructive or unusually large diffs
- republish verification failing

If no live source-monitoring feed exists yet, say that explicitly instead of pretending the system is healthy.
