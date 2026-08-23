---
name: czw-watchdog
description: Mostly read-only CalenderZW loop watchdog. Detect stalled Linear or PR flow, CI failures, source-sync incidents, destructive parser drift, and republish verification failures. Post one alert when an incident begins and one resolved notification when it clears.
---

# czw-watchdog

## Purpose

Read mostly.

Detect incidents across the loop and source-sync pipeline, then notify humans without spamming them.

## Incident classes to detect

- issue stuck In Progress too long
- PR changes requested without follow-up
- required CI red
- `agent-ready` queue unexpectedly stalled
- source watcher unhealthy
- no successful source snapshot for the expected interval
- source access lost
- source parser suddenly producing destructive or large diffs
- calendar republish verification failing

## Notification policy

Post or open one alert when an incident begins.

Do not repeat unchanged alerts.

Post a resolved notification when the incident clears.

If there is no durable incident state store yet, say so explicitly and do not fake deduplication.

## Governance

- Slack is the attention surface only.
- Linear and GitHub remain the durable sources of work state.
- Repository docs remain the durable source of architecture and policy.
- A watchdog must not create unique state that exists only in Slack.

## Slack channel policy

Recommended routing:

- `#czw-blocked` for blocked work that needs human answers
- `#czw-merge-ready` for merge-ready review outcomes
- `#czw-source-alerts` for source or publication incidents

Required alert content:

- exact issue or PR identifier when applicable
- exact source name when applicable
- last good sync time when applicable
- current error or failure mode
- affected classes or publication scope when known

## Required rereads before mutation

Any mutation initiated from Slack must reread current Linear and GitHub state first.

Never trust old Slack messages as current authorization.

## High-signal behavior

- Prefer one high-signal alert to many repeated reminders.
- Escalate only when the condition is real in current state.
- Resolve alerts promptly when the condition clears.
- For ambiguous source incidents, include the exact missing evidence instead of guessing.
