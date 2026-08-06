# [SHARED-007] Self-upgrade spec rider (signed 2026-08-02)

## Domain
shared (orchestrator-owned)

## Status
done — applied to SPEC.md §2.4 on 2026-08-05.

## Priority
P1

## Model
fable

## Dependencies
- Depends on: —
- Blocks: INFRA-016, CLI-025, CONTRACT-027, SERVER-050, UI-035

## Summary
User-approved behavior (AskUserQuestion sign-off, 2026-08-02 — "Approve all"),
to be applied verbatim to SPEC.md (new §2.x "Upgrading") at the upgrade
phase's kickoff, per the established amendment-at-kickoff pattern:

> **Upgrading.** Corpus upgrades itself only on demand — it never checks for,
> downloads, or installs anything in the background, and never phones home.
> `corpus upgrade --check` queries the GitHub Releases API for the latest
> release of the installed distribution, compares versions, and reports.
> `corpus upgrade` performs the check, downloads the release tarball over
> HTTPS, verifies its published checksum, and reinstalls through the same
> npm-global path the tool was installed with; if the install method cannot
> be detected it refuses with instructions rather than guessing. If — and
> only if — the workspace's server was running when the upgrade began, the
> upgrade restarts it against the same workspace once the install succeeds.
> The UI offers the same flow on demand: a check affordance, and when a newer
> release exists, an "Upgrade & restart" action that asks the server to spawn
> the detached CLI upgrade; the UI rides out the restart with its normal SSE
> reconnect and shows the new version on return.

## Amendment — the workspace half (SIGNED 2026-08-03)

**The gap the user found.** The text above upgrades the *tool* and says nothing
about the workspace's template files — the agent's skills, installed by
`corpus init` and living in the workspace ever since. As written, a user would
upgrade, get a new server and UI, and keep running last version's skills with
nothing telling them so.

The machinery already exists and is unchanged by this: `corpus workspace
upgrade` compares three ways per file — the sha `init` recorded in
`.corpus/template-manifest.json`, the sha on disk now, and the sha the new tool
ships — and **the only cell that overwrites is "untouched here, changed
upstream"**. A file the workspace edited is never overwritten; a file with no
recorded baseline is never overwritten, because without one an untouched old
copy cannot be told from an edited one. What was missing is the wiring.

**User answer 1, verbatim:** _"Yes, and report what it did."_ `corpus upgrade`
performs the workspace template sync as part of the upgrade, not as a separate
command the user has to know about.

**User answer 2, verbatim:** _"let's assume this will be run by an agent. so it
should show the diff on request but also make it clear it needs to be
resolved."_ This is the load-bearing one: the audience for the output is the
**agent**, so a conflict is not an FYI line — it is outstanding work, and the
output has to make that unambiguous and actionable.

APPEND to the §2.x "Upgrading" text above:

> An upgrade also brings the workspace's template files up to the installed
> tool's, by the same three-way rule `corpus workspace upgrade` applies: a file
> the workspace never touched is updated, and a file the workspace edited is
> **never** overwritten. The upgrade reports what it did — what it updated, and
> what it left alone — in one place, and everything it wrote lands in a single
> attributed commit, so `corpus skill rollback` undoes a bad upgrade like any
> other change.
>
> A file the workspace edited **and** the tool changed is a **conflict, and a
> conflict is unresolved work rather than a notice**. The upgrade names each one,
> states that the tool's version has moved on and that the workspace's copy has
> not taken those changes, and gives the command that shows the difference
> (`corpus workspace diff <path>`). Corpus never merges these automatically: a
> skill is prose that instructs the agent, and a plausible-looking auto-merge
> would corrupt the instructions the loop runs on. The report is written to be
> read by the agent as well as by a person — conflicts are listed distinctly
> from the things that merely happened, so an agent running an upgrade can tell
> what it must still act on without parsing prose.

## Acceptance Criteria
- [x] Rider applied to SPEC.md verbatim at phase kickoff (orchestrator)
- [ ] The five dependent issues implement against this text

## Completion Checklist (orchestrator)
- [x] SPEC.md updated on the phase branch; fidelity-checked in review
