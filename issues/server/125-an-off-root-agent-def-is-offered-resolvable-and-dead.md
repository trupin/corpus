# [SERVER-125] An off-root agent-def is offered, resolvable, and dead

## Domain

server

## Status

done

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SERVER-123
- Blocks: —
- Related: AGENT-036 (the skill sentence that describes this wrongly today)

## Spec References

- SPEC.md **§7** line 399 — `.claude/agents/*.md` as the agent-def root, and
  *"`corpus doc check` validates both sets"*
- SPEC.md **§8** — `@<subagent-name>` is a directive routed to that persona
- SPEC.md **§11** line 539 — the `@` autocomplete, backed by `GET /api/docs`

## Summary

A `type: agent-def` document filed **outside** `.claude/agents/` is offered to
people, resolvable by the agent, invisible to Claude Code, and unreported by
every check. Found by PR #49's fifth review while checking a skill sentence that
claimed such a document "resolves to nobody".

It does resolve. `targetIndex` (`apps/server/src/threads/mentions.ts:144-156`)
indexes each agent-def under **two** aliases — `invocableName(row.path)` and
`row.title`, both lowercased. `invocableName` returns null off-root; the title
alias does not.

So `corpus doc create --type agent-def --title Bookkeeper --folder inbox`
produces a document that:

| | |
| --- | --- |
| `@bookkeeper` in a comment | **resolves to it** (`MENTION_TYPE = "agent-def"`) |
| the `@` autocomplete | **offers it** (`GET /api/docs?type=agent-def`) |
| `name` / `description` frontmatter | **absent** — `claudeCodeFields` returns `{}` when `discoveredAs` is null |
| Claude Code | **never loads it** |
| `corpus doc check` | **says nothing** — the requirement is gated on `discoveredAs !== null` |

That is SERVER-123's two-readers divergence in its **other** direction. SERVER-123
closed the case where a document in the right root lacks the fields; this is a
document in the wrong root that looks addressable from every surface a person or
agent touches, and answers from none.

**Not a regression.** Before Phase 34, *every* CLI-created agent-def landed
off-root, so this was the norm and the divergence was universal. SERVER-122 and
CLI-050 made the root the default, which narrows this to an explicit `--folder`
opt-out — a much smaller target, and now a surprising one, because everything
else about creating a persona started working.

## The question to settle

**Should an agent-def outside its root be addressable at all?** Three readings,
and the issue does not pick one:

1. **Report it.** `corpus doc check` gains a finding for a `type: agent-def`
   document outside `.claude/agents/`. Cheapest, keeps every existing document
   working, and makes the state visible. Follow SERVER-123's precedent:
   **reported, never blocking** — a blocking finding would make existing
   documents unwritable, which is the regression PR #49's third review caught.
2. **Stop offering it.** Drop the title alias for agent-defs whose path is
   off-root, so `@bookkeeper` resolves to nothing and the autocomplete omits it.
   Honest, and it makes the skill's current sentence true — but it silently
   breaks any workspace that has been mentioning such a persona, and those
   mentions become "target not found" rather than doing nothing.
3. **Both**, in that order: report now, stop offering after a release in which
   people could see the report.

Weigh 2 against §8's rule that a missing or archived target *"is never silently
ignored"* — the agent says so in its reply. That rule argues a mention resolving
to nothing is a legible state, not a broken one, which strengthens route 2.

## Acceptance Criteria

- [x] The state is no longer silent: an off-root `type: agent-def` document is
      either reported by `corpus doc check`, or not offered as a mention target,
      or both — and the choice is recorded with the rejected alternatives
      — *route 2: not resolved by anything, with the decision and the four
      rejected alternatives recorded below*
- [x] Whatever is chosen, **no existing document becomes unwritable** — the
      SERVER-123 regression is the precedent, and its fix is the shape
      — *nothing was added to any check; `edit`, `archive`, `unarchive` and
      `doc check` all verified against a real server*
- [x] A document *about* a persona, deliberately filed under `data/docs/`, is
      still expressible. That case is why `--folder` wins over the by-type
      default (SERVER-122), and it must not be collateral damage
      — *creatable, projected under its declared type, readable, writable, and
      `doc check`-clean; it is now inert, which is what SERVER-122 said it was*
- [x] `assets/workspace/claude/skills/profile/SKILL.md` is reconciled — AGENT-036
      corrects its sentence against today's behaviour, and this issue must not
      leave that sentence false again in the other direction
      — **the sentence is now true as written and must be left alone.** It reads
      *"a `type: agent-def` document filed anywhere but `.claude/agents/` is a
      document about an agent rather than an agent, and it resolves to nobody"*
      (line 209–211). AGENT-036's premise — that it is false — no longer holds;
      correcting it would make it false. Flagged to the orchestrator.
- [x] The two-alias indexing is documented where it is read, since it is the
      mechanism nobody expected — *at `targetIndex`, with `invocableName`'s
      docstring pointing forward to the gate*

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/mentions.ts` — `targetIndex`'s two aliases
- `apps/server/src/core/check.ts` — the finding, if route 1 or 3
- `apps/server/src/docs/write.ts` — the reported/blocking partition
  (`isClaudeCodeRequirement`'s sibling)

### Key Implementation Details

The title alias is not an accident and predates the agent-def root being
creatable — it is what let a hand-authored profile be addressed by its human
title. Read why it exists before removing it: the same alias serves skills, and
a change here reaches `@` resolution for every type `targetIndex` covers.

---

## The decision: route 2 — an unaddressable document is not addressed

**Chosen: route 2.** `targetIndex` skips a row whose {@link invocableName} is
`null`, whole — the title alias is kept for every row that has an invocable name,
and dropped for every row that has not. The orchestrator recommended route 1 and
invited a written argument; this is it.

### Why route 2 rather than route 1

**1. Route 1 cannot tell the broken case from the blessed one, because today they
are the same case.** SERVER-122 blessed `--folder` winning over the by-type
default in as many words, in `write.ts`'s `rootForType`: *"An explicit `folder`
always wins, which is what keeps a document about an agent-def expressible:
`--folder inbox` still files one under `data/docs/`, **exactly as `invocableName`
already contemplates for skills**."* And `invocableName` contemplates it thus: *"a
`type: skill` document filed under `data/docs/` is a document about a skill, not
an invocable one."* Both sentences say the same thing: off-root means *about*, and
*about* means not addressable. The only place that stopped being true is
`targetIndex`'s title alias. So route 2 is not a new product rule — it is the
existing, written, tested-elsewhere rule finally applied at the one place that
ignored it, and route 1 would be reporting as an error a document class the
codebase blesses on the create path.

**2. A `doc check` finding here is an exit-6 error on a legitimate document,
forever, with no repair.** §14's warning family is closed to two states by name
(`core/check.ts`, and the contract's `CHECK_WARNING_CODES`), so a new finding is
an **error**, and `corpus doc check` turns any error into exit 6 — the code a
workspace can wire into its own hooks. A document deliberately filed as "notes
about the Bookkeeper persona" would fail that check for as long as it exists, and
the only thing that would silence it is deleting it, retyping it, or moving it
into a root the `move` verb refuses to name (`resolveFolder` is called without
`forType` by `move`, so `.claude/agents` is a 400 there). That is the acceptance
criterion "must not be collateral damage", failed. It is also the same species of
regression PR #49's third review caught in SERVER-123 — a rule that made existing
files fail for a state nobody had ever been told about — one level removed from
the write path.

**3. Route 1 does not fix the harm; it annotates it.** The document stays offered,
stays resolvable, stays designatable, and stays undispatchable. The line it adds
to a report is read by whoever runs `corpus doc check`, which is nobody on the
path where the damage happens (posting a comment).

**4. Route 1 is not the cheaper change.** `CheckCode` is a **closed enum published
by `packages/contract`** (`schemas/check.ts`), pinned by
`apps/server/src/check/codes.test.ts` member-for-member and by count, quoted as
"the other twelve are errors" in two schema descriptions and in the
`POST /api/check` route description, and baked into the committed `openapi.json`.
A new code is a contract change plus a regeneration, coordinated with
contract-dev. Route 2 is three lines in one server file.

**5. The alias was also a live name-theft, which nothing else would have
closed.** `targetIndex` breaks a collision by **id order**, and a created
document's `doc_*` id is minted at random — so an inert `type: agent-def` note
titled `Researcher` under `data/docs/` took `@researcher` away from
`.claude/agents/researcher.md` whenever its id happened to sort first.
Reproduced on a real server below: `@researcher` resolved to
`data/docs/inbox/researcher.md`. The same applies to `/skill` invocations, where
a `doc_*` id beats a synthetic `doc_skill*` id most of the time. No report can fix
that; only the gate can.

### What answers route 2's own objections

- *"It silently breaks a workspace that has been mentioning such a persona."* It
  was never not broken: pre-Phase-34 **every** CLI-created agent-def landed
  off-root, so `.claude/agents/` was empty and no such mention has ever reached a
  Claude Code subagent. What changes is that the request stops waking the agent to
  dispatch to somebody who is not there.
- *"§8 says a missing target is never silently ignored."* It is not ignored. The
  token lands in the event payload's `unresolved` (`threads/events.ts`), and where
  the comment asks for the agent at all — `@agent`, a `/skill`, or an engaged
  thread — the orchestrate skill states it in the reply, verbatim: *"A missing or
  archived target is never silently ignored: do the work as well as you can and
  state in the reply that the named target was not found."* Verified below. On a
  fresh, unengaged thread `@legacy` alone wakes nobody — which is this module's
  existing, deliberate treatment of every name that names nobody, typos included,
  and not a new class of silence.
- *"A designation would fail with an unhelpful 404."* Closed here rather than
  deferred: `residentFor` now asks `unaddressableTarget` when a name misses, and
  the refusal names the file and what is wrong with it. This is the only surface
  where a person asks the server for a persona by name and waits for an answer, so
  it is the only one that can say it.

### Rejected

- **Route 1 (report via `corpus doc check`)** — for the five reasons above. Its
  premise, that the state needs a report, is answered by removing the state: once
  the document is not addressed by anything, it is an ordinary document about a
  persona, and reporting it would be reporting a document for existing.
- **Route 3 (both, staged over a release)** — inherits route 1's exit-6 problem
  entire, and buys a migration window for a break that, per the above, is not a
  break. It also assumes a release cadence this pre-1.0 tool does not have.
- **Dropping the title alias altogether** — would have been simpler and is wrong.
  Two live callers use only one alias each: a person in a composer types the
  **stem** (`@bookkeeper`), while the board's designate menu sends the **title** it
  read off the document row (`apps/ui/src/thread/residentActions.ts`, which maps
  rows to `{id, name: row.title.trim()}` and never looks at `path`). Both are
  pinned by tests; the gate is the invocable name, never the alias count.
- **Refusing `--type agent-def --folder <x>` at create time** — makes the
  document *about* a persona inexpressible, which acceptance criterion 3 forbids
  and SERVER-122 decided against.
- **Attaching the state to the resolution instead** (resolve it, but flag it, the
  way `status: archived` is flagged so §8's orchestrator can say so) — the honest
  §8-shaped alternative, and rejected on blast radius: `ResolvedTarget` is on the
  wire in the event payload, so it is a contract change plus an agent-runtime
  change to the orchestrate skill, for a state whose correct handling is "do not
  route to it" — which is what not resolving already means.

### Where the two-alias indexing is documented

At `targetIndex` in `apps/server/src/threads/mentions.ts`, which is where it is
read — both aliases, why each one has a caller that uses only it, and why the gate
is the invocable name rather than the alias. `invocableName`'s own docstring now
points forward to it, so the "off-root means *about*" sentence and the code that
enforces it are one click apart.

### Follow-up this leaves open (escalated, not done here)

`packages/kit`'s `useAutocomplete` keeps its **own** copy of `invocableName` and
computes each row's token as `invocableName(row.path) ?? row.title` — the same two
aliases, independently written — over `GET /api/docs?type=agent-def`. That list
route must keep returning every agent-def (the board's `type:` filter and the
"Skills & agents" seed view read it), so the filter belongs in the kit: `rowToken`
should return `invocableName(row.path)` and drop the row when it is null. Until
that lands the `@` autocomplete still offers an off-root agent-def whose title is
one typeable word, and it now resolves to nothing.
`apps/ui/src/thread/residentActions.ts` has the same gap for the resident menu,
which will offer a row the server now 404s. Both are ui-dev's; neither is
reachable from `apps/server`.

### Edge Cases

- An agent-def whose title and stem differ, in the root — the common case since
  SERVER-122, and it must keep both aliases
- A workspace that has been mentioning an off-root persona for months
- The autocomplete and the resolver must agree: offering what will not resolve is
  worse than either

## Testing Strategy

Resolution tests for on-root and off-root agent-defs by stem and by title, plus
the autocomplete query. Falsify by reverting the chosen change and watching the
specific case go green.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Create an agent-def with `--folder inbox`; post `@<title>` in a real thread
3. Read the queue event's `mentions` — confirm the chosen behaviour
4. Confirm an on-root persona still resolves by both stem and title
5. Confirm a document *about* a persona is still creatable and does not become
   an accidental mention target
6. Stop the server; confirm the port is free

## E2E Verification Log

**Model: Fable 5** (`claude-fable-5`), server-dev agent, 2026-08-18.

Real `corpus` binary built from source (`npm run build`), real workspace at
`/tmp/s125-ws` (throwaway, deleted afterwards), real server on **port 8791** —
never 8765, never 5173. Every command below is the CLI over HTTP; nothing is
stubbed.

### Setup

```
$ corpus init --port 8791
Initialized Corpus workspace at /private/tmp/s125-ws
$ corpus server start
corpus 0.11.0 listening on http://127.0.0.1:8791 (pid 37367)

$ corpus doc create --type agent-def --title Researcher --from user
created doc_apnjcoop — .claude/agents/researcher.md
$ corpus doc create --type agent-def --title Legacy --folder inbox --from user
created doc_57bz3y54 — data/docs/inbox/legacy.md
$ corpus doc create --type agent-def --title Researcher --folder inbox --from user
created doc_5ejuwz2b — data/docs/inbox/researcher.md      # the name-thief
$ corpus doc create --type agent-def --title "Money Bookkeeper" --from user
created doc_caevahzp — .claude/agents/money-bookkeeper.md  # title ≠ stem
$ corpus thread create --title "Kick-off" --from user
created th_ph2kxwlb — standalone
```

### Pre-fix reproduction (the gate reverted in source, rebuilt, restarted)

```
$ corpus server start                      # pid 40143, pre-fix build
$ corpus thread reply th_ph2kxwlb --from user   <<< "@researcher — pre-fix: which document answers this?"
mentions: [{"name": "Researcher", "docId": "doc_5ejuwz2b", "status": "open"}]
```

`doc_5ejuwz2b` is `data/docs/inbox/researcher.md`. The inert note **took the name
off** `.claude/agents/researcher.md`, and the payload directed the orchestrator to
dispatch to a subagent called `Researcher` — a name Claude Code has never heard,
in a workspace where the real profile was sitting one directory away.

```
$ corpus thread reply th_ph2kxwlb --from user   <<< "@legacy — pre-fix: does this wake anyone?"
mentions: [{"name": "Legacy", "docId": "doc_57bz3y54", "status": "resolved"}]

$ corpus thread designate th_ph2kxwlb --agent Legacy --from user
designated Legacy (doc_57bz3y54) on th_ph2kxwlb
EXIT=0
```

All three defects reproduced against a real server: the mention resolved and woke
the agent, the name-theft resolved to the wrong document, and a whole conversation
was handed to a persona nothing loads.

### Post-fix

```
$ corpus server start                      # pid 40768, fixed build

$ corpus thread reply th_ph2kxwlb --from user   <<< "@researcher — post-fix: which document answers this?"
mentions: [{"name": "researcher", "docId": "doc_apnjcoop", "status": "open"}] unresolved: []
```

`doc_apnjcoop` = `.claude/agents/researcher.md`. The profile answers to its own
name again, and the payload carries the stem Claude Code dispatches on.

**An off-root mention alone requests nothing** (queue directory read either side):

```
$ ls .corpus/queue/pending | grep -c evt_          →  0
$ corpus thread reply th_ph2kxwlb --from user   <<< "@legacy can you take a look at this?"
replied to th_ph2kxwlb — turn 2026-08-18T18:21:59Z
$ ls .corpus/queue/pending | grep evt_             →  (none)

$ corpus thread reply th_ph2kxwlb --from user   <<< "@researcher can you take a look at this?"
replied to th_ph2kxwlb — turn 2026-08-18T18:22:00Z (queued evt_topahjl35rno)
```

**And §8's rule holds where the agent is asked for at all** — the token is carried,
not swallowed, so the orchestrator states it in its reply:

```
$ corpus thread reply th_ph2kxwlb --from user   <<< "@agent please ask @legacy about this."
replied to th_ph2kxwlb — turn 2026-08-18T18:22:13Z (queued evt_fe4bm7oazxnq)

evt_fe4bm7oazxnq.json payload:
{ "mentions": [], "skills": [], "unresolved": ["@legacy"] }
```

**The designation refusal names the file:**

```
$ corpus thread designate th_ph2kxwlb --agent Legacy --from user
corpus: 404 not_found: no agent named Legacy in this workspace —
  data/docs/inbox/legacy.md declares `type: agent-def` but is not under
  `.claude/agents/`, so nothing loads it as a subagent and nothing resolves
  `@Legacy` to it; a persona has to live in that root
EXIT=5

$ corpus thread designate th_ph2kxwlb --agent nobody --from user
corpus: 404 not_found: no agent named nobody in this workspace — a designation
  names an agent-def the way a mention does
EXIT=5
```

**An on-root persona whose title is not its filename still answers to both** — the
composer's spelling and the board's:

```
$ corpus thread designate th_ph2kxwlb --agent "Money Bookkeeper" --from user
designated money-bookkeeper (doc_caevahzp) on th_ph2kxwlb        # by title
$ corpus thread designate th_ph2kxwlb --agent money-bookkeeper --from user
designated money-bookkeeper (doc_caevahzp) on th_ph2kxwlb        # by stem
```

**A residency designated before the fix degrades legibly rather than lying:**

```
$ corpus thread show th_ph2kxwlb
Kick-off
th_ph2kxwlb · open · agent requested
resident Legacy (profile missing)
```

**Nothing became unwritable, and nothing new is reported** (acceptance criteria 2
and 3):

```
$ corpus doc show doc_57bz3y54          → prints the document, type agent-def
$ corpus doc edit doc_57bz3y54 --key … --from user
edited doc_57bz3y54
$ corpus doc archive doc_57bz3y54 --from user     → archived doc_57bz3y54
$ corpus doc unarchive doc_57bz3y54 --from user   → unarchived doc_57bz3y54
$ corpus doc check
checked 16 documents — no findings.
EXIT=0
```

`git log` shows every one of those as an ordinary commit authored `user`
(`doc archive: Legacy (doc_57bz3y54) by user`, `resident designate: …`), so the
audit trail is unchanged.

**The autocomplete's data source is deliberately untouched** — the board's
`type:` filter and the "Skills & agents" seed view read the same route:

```
$ curl -H "Authorization: Bearer …" "…/api/docs?type=agent-def&limit=50"
doc_5ejuwz2b data/docs/inbox/researcher.md      | Researcher
doc_57bz3y54 data/docs/inbox/legacy.md          | Legacy
doc_caevahzp .claude/agents/money-bookkeeper.md | Money Bookkeeper
doc_apnjcoop .claude/agents/researcher.md       | Researcher
```

This is the residual escalated above: `packages/kit` must stop *offering* the two
`data/docs/` rows, which it can do from `row.path` alone.

### Teardown

```
$ corpus server stop
stopped (pid 40768)
$ curl -m 2 http://127.0.0.1:8791/api/health   → connection refused
$ lsof -ti :8791                               → nothing on 8791
$ rm -rf /tmp/s125-ws
```

Port 8791 free, workspace removed. Nothing under `/Users/theophanerupin/cos` was
read or written at any point.

### Checks

- `vitest run apps/server` — **191 files, 4123 tests, all passing**
- `vitest run apps/cli` — 93 files, 1535 tests, all passing (the designate 404
  rendering lives there)
- `npm run lint` — clean · `npm run typecheck` — clean (exit 0, all workspaces) ·
  `prettier --check` on every touched file — clean

### Falsification

With the gate reverted in `targetIndex` (`if (invocable === null) continue;`
removed and the `?? row.title` fallbacks restored), **six** of the new tests go
red and nothing else does:

```
× a document outside the root its type is discovered from > resolves under no spelling, its title included
× a document outside the root its type is discovered from > is an unresolved token that requests nothing
× an unaddressable document that claims a working name > does not take `@researcher` from the profile that answers it
× an unaddressable document that claims a working name > does not take `/comment` from the skill that answers it
× POST /api/docs > SPEC.md §7's agent-def root > keeps an explicitly foldered agent-def under data/docs, addressable by nothing
× POST /api/threads/{id}/resident > refuses an agent-def filed outside `.claude/agents/`, and says which file it is
Tests  6 failed | 107 passed (113)
```

Two further new tests stay green under that revert **by design**, and are guards
rather than proofs: "a persona in its root whose title is not its filename answers
to its stem and to its title alike" falsifies the *other* plausible fix (deleting
the title alias outright, which would break the board's designate menu), and the
`unaddressableTarget` cases test new code the gate does not gate. The shadow tests
write their ids (`doc_zzzzzz` on-root against `doc_aaaaaa` off-root) rather than
letting them be minted, so the pre-fix answer is the wrong one on every run rather
than half the time.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-125]` prefix
