# [AGENT-036] A transcript line the CLI cannot print (and a sentence SERVER-125 made true)

## Domain

agent-runtime

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SERVER-125 (the product half of the first one), AGENT-034 (the skill)

## Spec References

- SPEC.md **§7** line 399 — the agent-def document root
- SPEC.md **§8** — `@<subagent>` resolution

## Summary

Two statements in `assets/workspace/claude/skills/profile/SKILL.md` are false.
Found by PR #49's fifth review, judged not worth a fifth round, filed here.

Both are the same species this file has now been corrected for four times: a
claim about **another component's behaviour**, written from what the author
believed rather than from that component's code. The rule adopted in AGENT-034's
last pass — *a skill states what the agent must do and what it may conclude,
names the component that owns a rule, and does not describe that component's
internal refusals* — was applied to the paragraphs under review and not swept
across the whole file. This is the sweep.

## STOP — finding 1 was inverted by SERVER-125 on 2026-08-18

**Do not fix finding 1. Fixing it would make the sentence false.**

SERVER-125 landed in the same release and chose route 2: `targetIndex` now skips
any row whose `invocableName` is null, the title alias included. An off-root
`type: agent-def` document is addressable under **no** spelling.

So the sentence this issue was filed to correct —

> a `type: agent-def` document filed anywhere but `.claude/agents/` is a document
> *about* an agent rather than an agent, and it resolves to nobody

— **is now true**, and it was made true by changing the product rather than the
prose. The instruction was right and the reason was right; only the code
disagreed, and the code was what was wrong.

**This issue is therefore reduced to finding 2**, plus its sweep criterion. The
analysis below is kept because it is the record of why SERVER-125 chose what it
chose, and because a later reader who finds the sentence and remembers this issue
needs to know the sentence won.

**What is still worth doing about finding 1:** nothing to the sentence itself.
Check only that no *other* line in the file contradicts it, since the file was
written when the sentence was false.

## 1. *"it resolves to nobody"* was false when filed — line ~209 — and is true now

The Refusals section says:

> Never retry into a different folder: a `type: agent-def` document filed
> anywhere but `.claude/agents/` is a document *about* an agent rather than an
> agent, and **it resolves to nobody**.

`targetIndex` (`apps/server/src/threads/mentions.ts:144-156`) indexes each
agent-def under **two** aliases — `invocableName(row.path)` *and* `row.title`,
both lowercased. `invocableName` returns null off-root; **the title alias does
not.**

So `corpus doc create --type agent-def --title Bookkeeper --folder inbox`
produces a document that:

- `@bookkeeper` **does** resolve to (`MENTION_TYPE = "agent-def"`),
- `GET /api/docs?type=agent-def` offers in the `@` autocomplete,
- carries no `name`/`description` (create's `claudeCodeFields` returns `{}` when
  `discoveredAs` is null),
- Claude Code will never load,
- and `corpus doc check` says nothing about, because the requirement is gated on
  `discoveredAs !== null` and does not fire off-root.

That is **worse** than resolving to nobody: it is SERVER-123's two-readers
divergence in its other direction — offered, resolvable, and dead.

**The instruction is right and the reason is wrong**, which is why this is not
urgent. The damage is downstream: an agent asked *"why does `@bookkeeper` never
answer?"* consults this skill, concludes a misfiled persona is inert, and looks
elsewhere. It also under-sells the refusal — the real reason not to retry into
another folder is worse than the one given.

## 2. The worked example prints output the CLI cannot produce — line ~269

```bash
corpus doc list --type agent-def
showing 0 documents
```

`runDocList` (`apps/cli/src/commands/doc/list.ts:113-117`) short-circuits an
empty result before the tally is built, so the real output is
`no documents match.`. `renderTally` is unreachable there, and would render
`showing 1–0 of 0 documents` if it were — the string in the skill is not a form
the CLI emits on **any** path.

Low consequence, since the agent reads what the command actually returns. The
risk is a skill author or agent treating the transcript as the contract — for
instance matching on `showing ` to detect an empty roster, which would never
fire.

**Scope this fix tightly.** The fifth review verified the rest of the file's
transcript lines against source and they are correct: `--type` is a real flag,
`created <id> — <path>`, `edited <id>` followed by `key <sha>`, and the
name-collision message with its exit `5` all match.

## Acceptance Criteria

- [x] **The "resolves to nobody" sentence is left exactly as it is.** SERVER-125
      made it true. Editing it is the failure mode this issue now guards against
- [x] No *other* line in the file contradicts it — the file was written while the
      sentence was false, so a neighbouring line may still describe the old
      behaviour
- [x] The transcript line matches what `runDocList` actually prints
- [x] Every **other** command transcript in the file is checked against its
      source in the same pass, rather than fixing the one that was reported
- [x] `scripts/workspace-template.test.ts` pins the transcript line and the
      "resolves to nobody" sentence, in the tightening direction. The second pin
      is what stops a future reader "correcting" a sentence that is now right
- [x] No claim about another component's internal refusal is added while fixing
      this

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/profile/SKILL.md`
- `scripts/workspace-template.test.ts`

### Key Implementation Details

**Superseded, 2026-08-18.** This section told the implementer not to wait for
SERVER-125 because *"the sentence is wrong today whichever way that lands"*. That
reasoning was wrong. SERVER-125 landed in the same release, chose to remove
off-root agent-defs from the `@` index, and made the sentence right. Had this
issue been worked first, as this section advised, it would have introduced the
error it was filed to remove.

The lesson is narrower than "wait for dependencies". It is that **a prose fix
predicting a product decision is a bet**, and this file has now lost that bet
after winning it four times.

### Edge Cases

- The sentence describes a **consequence** ("resolves to nobody") rather than a
  mechanism, which is why it survived a change of mechanism. Keep it that way.
  Wording that recited `targetIndex`'s two aliases would now be stale
- A neighbouring line may still describe the pre-SERVER-125 behaviour

## Testing Strategy

Pins for both statements. The behavioural check is reading each transcript line
against the function that emits it.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. `corpus doc list --type agent-def` on an empty workspace — compare byte for
   byte with the skill's transcript
3. Create an agent-def with `--folder inbox`, then post `@<title>` in a real
   thread and read the queue event's `mentions` — confirm what the skill now says
4. Stop the server; confirm the port is free

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). Date: 2026-08-18. Branch
`phase-34-loose-ends`.

### Setup

Throwaway workspace, port **8795** (never 8765, never 5173). CLI and server both
run from source via `tsx`, so what was measured is the source under review rather
than a stale `dist/`.

```
$ ./node_modules/.bin/tsx apps/cli/src/bin/corpus.ts init /tmp/agent036-ws
Initialized Corpus workspace at /tmp/agent036-ws
  port 8766, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
  git: background maintenance is off here — corpus packs the repository at server start
  installed 10 template files, recorded in .corpus/template-manifest.json
  installed 2 plugin skill files into .claude/skills/
  installed 1 plugin seed template into data/docs/templates/
Next: corpus server start

# .corpus/config.json port rewritten 8766 -> 8795, then:
$ corpus server start
corpus 0.11.0 listening on http://127.0.0.1:8795 (pid 24401)
  logs: corpus server logs -f
```

### 1. The reported line — `corpus doc list --type agent-def` on an empty roster

The skill transcribed `showing 0 documents`. The CLI prints:

```
$ corpus doc list --type agent-def
no documents match.
EXIT=0

$ corpus doc list --type agent-def | od -c | tail -3
0000000    n   o       d   o   c   u   m   e   n   t   s       m   a   t
0000020    c   h   .  \n
0000024
```

Byte for byte: `no documents match.\n`. `runDocList`
(`apps/cli/src/commands/doc/list.ts:113-118`) returns on the empty page before
`renderTally` is reached, so the tally never renders on this path; had it been
reachable it would have read `showing 1–0 of 0 documents`. **`showing 0
documents` is emitted by no path.** Corrected in the skill to the measured line.

Non-empty, for contrast — this is the only shape in which `showing ` appears:

```
$ corpus doc list --type agent-def
doc_jrgrqgii  agent-def  open  Bookkeeper  .claude/agents/bookkeeper.md
showing 1–1 of 1 document
```

### 2. The sweep — every other transcript, and every claim about another component

The file has six fenced blocks (lines 125-127, 136-141, 146-151, 167-173,
256-280, 290-301). Four output lines total, all re-derived by running them:

| Skill's transcript / claim | Measured | Verdict |
| --- | --- | --- |
| `corpus doc list --type agent-def` (the flag itself) | accepted, exit 0 | correct |
| `created doc_b7c1d5 — .claude/agents/bookkeeper.md` | `created doc_jrgrqgii — .claude/agents/bookkeeper.md` | correct |
| `edited doc_b7c1d5` then `key <64 hex>` | `edited doc_jrgrqgii` / `key 6a18d7bcef87a7a623eca0716b642e51cbb047e6ccf20b769302bc33ec5be142` | correct |
| collision: *the name `bookkeeper` is already taken in .claude/agents*, exit **5** | ``corpus: 400 bad_request: the name `bookkeeper` is already taken in .claude/agents`` … `EXIT=5` | correct |
| "there is no `--folder` to pass: the document lands in `.claude/agents/`, at a filename slugged from the title" | `--title Bookkeeper`, no `--folder` → `.claude/agents/bookkeeper.md` | correct |
| "The server writes it into the frontmatter from the filename it just allocated" | created file carries `name: bookkeeper` | correct |
| "The server fills it in from the title" (`description`) | a create with no description edit wrote `description: Proofreader` under `title: Proofreader` | correct |
| "`--extra` names its own delta and takes no key" | `doc edit … --extra description="$d"` with no `--key`, exit 0 | correct |
| `corpus thread designate` is "**user-only**: sent with `--from agent` the server refuses it outright" | `corpus: 403 forbidden: designating a resident is user-only; …`, `EXIT=5` | correct |
| "`corpus thread designate <th_…>`, with no `--agent`, is that designation" | `designated a general resident on th_x6pkquhh`, exit 0 | correct |
| "What reports a profile Claude Code cannot load … is `corpus doc check`, at any age and as an error" | hand-written `.claude/agents/handwritten.md` with no `description` → `error frontmatter-invalid … description: missing or empty`, `corpus: 1 error in 16 documents.`, `EXIT=6` | correct |

The illustrative ids (`doc_b7c1d5`, `th_4b8e2c`) are shorter than a minted id
(`doc_jrgrqgii`) but are valid under `^doc_[A-Za-z0-9]+$` and are the
template-wide placeholder convention; not touched.

**One wrong line in the file, and it is the reported one.** Nothing else in the
sweep failed.

### 3. Finding 1 — the sentence is true, and no neighbouring line contradicts it

Not edited. Verified true against the running server, which is what SERVER-125
changed:

```
$ corpus doc create --type agent-def --title "$title" --folder inbox --from agent <<'EOF' …
created doc_cgghngsd — data/docs/inbox/ledgerclerk.md

$ corpus doc list --type agent-def
doc_cgghngsd  agent-def  open  Ledgerclerk  data/docs/inbox/ledgerclerk.md
doc_jrgrqgii  agent-def  open  Bookkeeper   .claude/agents/bookkeeper.md
showing 1–2 of 2 documents

$ corpus thread create --title "Mention probe" --from user <<'EOF'
Does @ledgerclerk resolve, and does @bookkeeper?
EOF
created th_x6pkquhh — standalone (queued evt_k24t3k4l3rpc)

$ corpus queue claim-all --json
{"events":[{"id":"evt_k24t3k4l3rpc","type":"comment.created","created":"2026-08-18T18:38:04Z",
"source":"thread","payload":{"threadId":"th_x6pkquhh","parentId":null,
"turnTs":"2026-08-18T18:38:03Z","mentions":[{"name":"bookkeeper","docId":"doc_jrgrqgii",
"status":"open"}],"skills":[],"unresolved":["@ledgerclerk"]}}],
"inProgress":{"events":[],"total":0,"truncated":false}}
```

The on-root persona resolves; the off-root one lands in `unresolved` and is
addressable under neither its stem nor its title. **It resolves to nobody.**

Contradiction sweep over the rest of the file: `grep -i
"alias|targetIndex|invocableName|autocomplete|index"` returns nothing, so no line
recites the pre-SERVER-125 mechanism. The two neighbouring statements that touch
the same ground both agree with it — *"there is no `--folder` to pass"* (Writing
it) and *"Never retry into a different folder"* (Refusals). Note that the
mechanism moved but the outcome the skill states did not, which is why it
survived: it names a consequence, not an index.

### 4. Pins, and their falsification

Both added to the `profile skill body` describe block in
`scripts/workspace-template.test.ts`, after AGENT-035's block, which was read
first.

Green baseline: `377 passed`.

| Falsification | Result |
| --- | --- |
| transcript line put back to `showing 0 documents` | `× profile skill body > transcribes the empty roster as the CLI actually prints it` — **1 failed, 376 passed** |
| the *"resolves to nobody"* sentence deleted outright | `× profile skill body > keeps a misfiled profile's consequence, and names no mechanism for it` — **1 failed, 376 passed** |
| the same sentence reworded to the pre-SERVER-125 claim (*"it still resolves under its title alias"*) — the realistic future "correction" | same single failure — **1 failed, 376 passed** |
| restored | **377 passed** |

Each pin fails alone; neither is carried by another assertion.

The transcript pin reads the **emitting source** rather than a copied literal —
it extracts the string out of `runDocList`'s empty-page branch and requires the
skill's transcript to equal it — so a change to the CLI's wording fails here and
names the skill that has to follow. Derivation confirmed independently:
`/result\.page\.offset === 0 \? "([^"]+)"/` over `apps/cli/src/commands/doc/list.ts`
yields `"no documents match."`.

### 5. Checks

```
$ VITEST_MAX_THREADS=4 npx vitest run scripts/workspace-template.test.ts
Test Files  1 passed (1)
     Tests  377 passed (377)

$ npx eslint .              # clean, no output
$ npx prettier --check scripts/workspace-template.test.ts assets/workspace/claude/skills/profile/SKILL.md
All matched files use Prettier code style!
```

### 6. Teardown

```
$ corpus server stop
stopped (pid 24401)
$ lsof -nP -iTCP:8795 -sTCP:LISTEN   # nothing
PORT 8795 FREE
```

Port 8765 still held by the user's own server (pid 35736), untouched. Nothing was
written under `/Users/theophanerupin/cos`; `apps/server/`, `packages/kit/` and
`apps/ui/` were read but never modified.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Orchestrator adjudication — the one judgment call raised

The implementer flagged line ~142 and left it, judging it inside *"scope this fix
tightly"*:

> `agent-def` has a document root of its own, so there is no `--folder` to pass

**Overruled, and changed to "so pass no `--folder`".** The reasoning it gave for
leaving it is sound in isolation: the Refusals section says *"Never retry into a
different folder"*, which presupposes the flag exists, so the file does not
contradict itself.

It loses on this file's history. `--folder` **is** accepted for `type: agent-def`
— the implementer used it to build the off-root probe — so *"there is no
`--folder` to pass"* is a claim about another component's behaviour that is
false when read literally. That is the exact species this file has now been
corrected for four times, and the fix costs three words.

The replacement is an instruction rather than a claim, which is what the file's
own adopted rule asks for: *a skill states what the agent must do, names the
component that owns a rule, and does not describe that component's internal
refusals.*

Re-ran `scripts/workspace-template.test.ts` after the edit: 377 passed.

## Completion Checklist (orchestrator)

- [x] Committed with `[AGENT-036]` prefix
