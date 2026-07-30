# [SHARED-003] PR #11 review — non-blocking MINOR/NIT findings ledger

## Domain
shared

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- Various — each finding cites its own.

## Summary
The 2026-07-29 pr-reviewer pass on PR #11 (verdict REQUEST_CHANGES) produced 15 MINOR
and 14 NIT findings beyond the three MAJORs. The MAJORs and MINORs 4/12/13/14/15 were
fixed pre-merge (CONTRACT-018/019, SERVER-034/035, PLUGINS-004, CLI-014); finding 24
(INFRA-010 AC text) and 32 (root `*.tgz` gitignore) were fixed as bookkeeping; finding
18 (PR body drift) was fixed on the PR; finding 16 is already tracked by CLI-012 (add
a "not yet wired" note to docs/PLUGINS.md:88-93 there). This ledger holds the rest for
triage into domain issues — do not let them silently expire.

## Findings to triage

**MINOR**
- (5, infra) `scripts/pack-audit.ts:40` — no positive `REQUIRED_PACK_ENTRIES` entry for the todos plugin; if `npm run build` stops invoking `build-plugins.ts`, the tarball ships without the §15 reference plugin while `pack:check` stays green.
- (6, infra) `.github/workflows/release.yml:78-82` — only the absent `NPM_TOKEN` bars a `v*` tag from publishing; an `environment:` with required reviewers would make the no-publish decision structural. (User decision on record: no publish, ever — consider deleting the publish job instead.)
- (7, infra) `eslint.config.js:116-120` — core→plugin import ban enumerates only relative depths 3–5; shallower/deeper files slip through; boundary test probes depth 3 only.
- (8, kit) `packages/kit/src/client/createCorpusClient.ts:655-660` — `pluginRequest` claims plugin-namespace-only but only strips leading slashes; `../../` escapes with the bearer token attached. Reject dot segments or soften the claim.
- (9, kit) `packages/kit/src/query/usePluginQuery.ts:26-30` — a query string in the path breaks cache-key matching against `broadcastInvalidate`, silently losing SSE invalidation; docblock promises "byte-identical" keys without that precondition.
- (10, ui) `apps/ui/src/editor/useAutosave.ts:346-349` — `beforeunload` guard calls `preventDefault()` but never sets `event.returnValue`; pre-119 Chromium/WebViews show no dialog and the parked buffer (only copy of user text) is destroyed unprompted.
- (11, agent-runtime) `assets/workspace/claude/skills/comment/SKILL.md:31,394-395` — documented `unresolved` payload examples strip the `@` sigil the server actually sends (`threads/mentions.ts:170`); sigil is the discriminator vs. skill invocations; file internally inconsistent (137-138 keeps it).
- (17, docs) `docs/workspace-template.md` (~line 140) — contradiction: manifest declared tracked (gitignore negation ships) but a later paragraph says it "is gitignored under `.corpus/*`".

**NIT**
- (19, contract) `packages/contract/src/schemas/form.ts` — `FormFenceMatch.end` doc comment imprecise for CRLF bodies.
- (20, ui) `apps/ui/src/thread/parseFormBlock.ts:157` — known-pairing tier skips the `options.includes(answered)` check the fallback tiers make.
- (21, kit) `packages/kit/src/row/useRowActions.ts:101` — `setLeaving(false)` in `onError` can fire post-unmount; relies on React 18 no-op.
- (22, agent-runtime) `orchestrate/SKILL.md:128-132` — touched-set rule for `form.respond` requires a parent doc id its payload doesn't carry (safe fallback: serialize); also :68-69 "no other knob" overlooks global `--json`.
- (23, infra) `scripts/merge-coverage.ts:149-156` — INFRA-009 guard wiring untested (deleting the call site keeps the suite green).
- (25, infra) `scripts/package-staging.ts:153` — `externalizeThirdParty` would externalize Node `#subpath` imports into a confusing (but loud) `PackagingError`.
- (26, infra) `scripts/check-pack.ts:70-80` — staged-name assertion inside the zero-violations branch; combined failures under-report; name-only mismatch prints success before failure (exit codes correct).
- (27, server/cli) `apps/server/src/plugins/discover.ts:159` / `apps/cli/src/registry/plugins.ts:118` — `isDirectory()` false for symlinked plugin dirs while the UI glob matches them; three discovery surfaces disagree.
- (28, plugins) `plugins/todos/ui/TodoView.tsx:153` — React key `${item.ts}:${item.text}` collides for identical texts in the same millisecond.
- (29, ui) `apps/ui/src/plugins/slots.tsx` — wrapped-component cache never observes a registry swap outside tests; fine until manifest hot-reload.
- (30, cli) `apps/cli/src/commands/workspace/upgrade.ts:161-167` — version-only bump early-returns without refreshing the manifest's `tool` field (stale `fromVersion` later).
- (31, cli) `apps/cli/src/commands/init/git.ts` — `commitPaths` docstring overclaims ("index left alone"); `git add -- <paths>` does update those index entries.

**Post-review observations (cli-dev during CLI-014, 2026-07-29 — same triage rules)**
- (cli) `corpus server status` renders the `unowned` detail with the *pidfile's* port while the probe used the *configured* one — a re-pointed workspace reads "not answering on :9181" when :9182 was probed.
- (cli) `corpus workspace upgrade` with nothing to do but a manifest rewrite still commits ("wrote 0 files in commit …") because `installedAt` changes every run — no-op runs should not create commits.

## Acceptance Criteria
- [ ] Each finding above is either fixed, converted to a domain issue, or explicitly waived with a note here.

## Technical Design
Triage task — batch by domain (a `pr11-minor-findings` batch issue per domain mirrors the SERVER-029/UI-013 precedent).

## Testing Strategy
Per finding, once triaged.

## E2E Verification Plan
Per finding, once triaged.

## E2E Verification Log
_n/a until triage._

## Completion Checklist (orchestrator)
- [ ] All findings dispositioned
