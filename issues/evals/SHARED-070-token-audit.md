# SHARED-070 — Where the context actually goes: a measured audit of the agent loop

**Date**: 2026-08-23 · **Build**: v0.19.0 working tree at `b86ce33a` (`npm run build` re-run before measuring) · **Model that ran the audit**: claude-fable-5
**Machine load**: load average 3.87 at the start of the run, 1.64 at the end. All latency figures are minima over interleaved runs unless marked otherwise.
**Tokenizer**: `gpt-tokenizer` (o200k BPE). It is not Claude's tokenizer; treat token figures as comparable to each other, not as exact billing. Word counts are exact and stay comparable with Phase 39.

## Method

A real workspace (`corpus init` under the session scratchpad, server on port 8766), a seeded corpus (5 notes across `finance/`, `home/`, `inbox/`), and a real agent loop run to the letter of the installed `orchestrate` and `comment` skills: 3 passes, 6 events (4 `comment.created` — one anchored, one whole-document filing, one standalone ask, one engaged-thread follow-up — 1 `workspace.reflect`, 1 `form.respond` via the UI's API surface), every event claimed, dispatched, logged, worked, replied to and settled. Every invocation was captured through a wrapper recording argv, stdin, stdout, stderr, exit code and wall time: **111 invocations** across setup, seeding, the loop, the subagents, a deliberate error battery, and `--json` comparisons. Raw transcripts: `scratchpad/audit/*.jsonl`; analyzers: `analyze.mjs`, `detail.mjs`, `totals.mjs`, `help-audit.mjs`, `skills-audit.mjs` beside them. Every number below names the command that produced it and is re-runnable from those scripts.

## The headline

**The marginal cost of an event is not the CLI. It is the re-briefing.** A dispatched comment-skill subagent pays ~17,500 tokens of context before its first command runs (comment SKILL.md 15,228 + workspace CLAUDE.md 891 + five skill descriptions ~375 + a dispatch prompt whose binding-rules block alone is 1,028). The same event's entire CLI traffic — briefing reads, edits, reply, logs — is 376–2,254 tokens. Phase 39 optimised the smaller half. Nobody had counted the larger one.

## The ranked table — cost × frequency

Frequency classes from the measured loop, projected onto a working day of 30 events, 3 orchestrator sessions, 2 reflections, on a 20-document corpus. Every unit cost is measured; only the day-shape is a projection.

| # | Cost | Unit (tok) | Paid | Day total (tok) | Share |
|---|------|-----------:|------|----------------:|------:|
| 1 | `comment/SKILL.md` read by every dispatched subagent | 15,228 | per event | 456,840 | 56% |
| 2 | `asd-ste100/SKILL.md`, standing rule via workspace CLAUDE.md | 3,366 | per context (33 = 3 sessions + 30 subagents) | 111,078 | 14% |
| 3 | `orchestrate/SKILL.md` read at `/orchestrate` | 34,632 | per session | 103,896 | 13% |
| 4 | Dispatch-prompt invariants (1,028) + comment skill restating them (593) | 1,621 | per event | 48,630 | 6% |
| 5 | All CLI traffic of working the events (in+out, subagent + orchestrator share) | 571–2,449, mean ~1,500 | per event | ~45,000 | 6% |
| 6 | Workspace CLAUDE.md (891) + 5 skill descriptions (~375) | 1,266 | per context | 41,778 | 5% |
| 7 | — of row 5: retrieval rows pointing at the product's own skill/seed docs | ~580 per event with retrieval | per event | ~15,000 | 2% |
| 8 | Reflection's `doc list --json` (293 tok/row × 20 rows) | 5,864 | per reflection | 11,728 | 1.4% |
| 9 | Queue surface: claim envelope ~25 + ~80/event, idle return ~10, reap 0, settle ~12, `job log` 0 out | — | per pass/event | ~2,500 | 0.3% |
| 10 | Help (post-AGENT-045: the loop consulted help **0 times**; occasional brief lookup 217–872) | ~250 | per lookup | ~1,000 | 0.1% |
| 11 | Errors and refusals (none occurred on the worked loop; battery: usage 20–90, patch refusals ~100, stale key 394) | ~100 | per mistake | ~500 | 0.1% |

Day total ≈ 820k tokens, of which ≈ **763k (93%) is briefing and skill text** and ≈ 57k is everything Phase 39 worked on. A 200-word answer paid 300 times was the issue's hypothetical; the measured reality is a 15,228-token skill paid once per event.

## The five surfaces, one by one

**1 — Command output (human and `--json`).** Human output is frugal: `doc list` 25 tok/row, `search` ~40 tok/row, confirmations 8–30 tok, `job log` prints nothing, `agents` 9 tok. `--json` is not: `doc list --json` is **293 tok/row — 11.7× the human row** — because every item carries ~25 fields including `excerpt` and `lastTurn` bodies (`doc list --json` on 20 docs: 5,864 tok vs 497 human; command: `corpus doc list --json`). Words understate JSON badly: 1,295 words → 6,361 tokens (4.9×) on that call; prose runs ~1.4×, human CLI output ~2–3×. The reflection procedure is the one place a skill directs the agent to `--json` (for `lastActor`) — filed as CLI-065. `thread context` costs 723–993 tok/call and is the right shape; over half of it was pollution (surface 7, filed as SERVER-144).

**2 — Help.** All 59 leaf verbs measured (`help-audit.mjs`): full `--help` totals 44,981 words / 68,511 tokens; `--help=brief` totals 10,030 / 17,267. Largest: `doc edit` 4,841 tok full, 872 brief. After AGENT-045, the measured loop read help **zero times** — the skills carry the command lines. No new opportunity worth filing; CLI-056 landed and is confirmed working in practice.

**3 — Errors and refusals.** Deliberately triggered: stale key (exit 9, 394 tok — reprints the whole document plus a fresh key), patch matched-0 and matched-4 (exit 10, ~100 tok each, each naming the exact recovery), keyless edit (exit 2, 90 tok), agent delete (exit 2, 40 tok), `--from bogus` (30 tok), model-on-user-turn (46 tok), unknown id (exit 5, 18 tok), invalid form fence (400, 98 tok naming the bad field). **This surface is in good shape**: every refusal is short, names its recovery, and the paid-twice cost is bounded — the stale-key reprint substitutes for the `doc show` the recovery would otherwise run, so its net cost on a small document is ~0 (dismissed below). Two non-token defects surfaced here and are filed (SERVER-144-adjacent: SERVER-145 re-settling; CLI-066 socket stdin).

**4 — The installed skills.** The whole of `assets/workspace/` as installed: 54,671 words / 77,843 tokens (`skills-audit.mjs`). What is paid when: CLAUDE.md + the five frontmatter descriptions in **every** context (1,266 tok); `orchestrate` once per orchestrator session (34,632); `comment` once per **dispatched event** (15,228); `converse` once per listener launch (14,714 — not exercised, see coverage); `asd-ste100` per context as a standing rule (3,366) — although CLAUDE.md itself restates the eight structural rules, which makes the full read arguably redundant (filed as AGENT-048). This is the largest cost in the product and rows 1–4 and 6 of the table are all this surface.

**5 — Queue and jobs.** The cheapest surface, working as designed: parking is a held response and costs 0 tokens; the idle return is ~10 tok; `reap-stale` prints nothing when it reaps nothing; `claim-all` is ~25 tok envelope + ~80 tok/event; settling ~12 tok; `job log` echoes nothing. A fully quiet 8-hour park at the 8-minute rearm costs ~60 × (10 + 25 + 4) ≈ **2.3k tok/day** — the fixed floor of an empty workspace. Per-call latency floor observed: **164 ms min, ~190 ms median** across 111 invocations at load ~2–4 (CLI-058 measured 136.8 ms minimum under better conditions; not re-litigated). ~15 calls per worked event ⇒ ~2.9 s of fixed latency per event; a 30-event day ⇒ ~450 calls ≈ 86 s. Those two figures are the audit's feed to CLI-058 (session mode) and CLI-064 (batching); both decisions stay where they are.

## Issues filed

| Issue | Finding (measured) | Estimated saving |
|-------|--------------------|------------------|
| `issues/agent-runtime/047-the-comment-skill-is-paid-whole-on-every-event.md` | 15,228 tok/event; sections a given event never uses: worked examples 1,758, forms 1,600, skill genesis 979, engagement 1,054 | ~40–50% of row 1 (≈ 200k/day) |
| `issues/agent-runtime/048-the-standing-style-rule-is-paid-twice-per-context.md` | asd-ste100 3,366 tok/context; CLAUDE.md already carries the 8-rule digest (891) | up to ~110k/day |
| `issues/agent-runtime/049-idle-prints-a-shape-the-skill-does-not-promise.md` | skill promises `{"idle":true,"reason":"timeout"}`; human mode prints `idle — no events (timeout)` | correctness, ~0 tok |
| `issues/server/144-retrieval-ranks-the-products-own-skills-into-every-pack.md` | 52% of retrieval output tokens (1,746 of 3,355 over 7 calls) were `doc_skill*` rows; `search "rate assumption 6.1%"` top hit was a skill's worked example; `doc related` #1 for a mortgage note was `orchestrate` | ~15k/day + relevance |
| `issues/server/145-a-settled-event-can-be-settled-again.md` | `queue fail` (no `--reason`) on a processed event: exit 0, processed→failed; `queue complete` flips it back | correctness |
| `issues/cli/065-doc-list-json-pays-293-tokens-a-row.md` | 293 vs 25 tok/row (11.7×); at 500 docs a reflection's window read is ~147k tok | ~90% of row 8, growing with corpus |
| `issues/cli/066-a-body-piped-over-a-socket-is-dropped-silently.md` | `spawnSync`-style harness: 340-byte body captured, template body written, exit 0, no warning (`stdinCarriesABody` rejects sockets by design, CLI-007) | correctness |

## Measured and dismissed — do not re-check

- **Stale-key refusal size** (394 tok, reprints the document): it replaces the `doc show` the recovery needs, net ≈ 0 on the path that reads it. By design, fine.
- **Patch refusals** (~100 tok each, exit 10 both directions): already minimal and name the exact recovery. Fine.
- **Queue idle / reap-stale / job log / settle verbs**: 0–13 tok out each. Fine — this surface needs nothing.
- **`claim-all` payload** (~80 tok/event + 25 envelope): proportionate; the batch JSON is the work order itself. Fine.
- **Help after AGENT-045**: 0 reads in a worked loop; brief totals 17,267 tok over all 59 verbs if every one were read once, which nothing does. No further issue.
- **`thread context` pack size** (~900 tok): right-sized *once the pollution rows go* (SERVER-144); the bounded-pack design does its job — briefing cost did not grow between a 5-doc and 20-doc corpus.
- **Anchored-thread orphan on create**: reproduced once, root-caused to the CLI-066 stdin loss (the quote was never in the body), not an anchoring bug. Re-tested clean: anchor resolved.
- **`corpus agents`, `queue status`, `health`**: 9–92 tok. Fine.
- **Error frequency on the happy path**: a skill-faithful 6-event loop produced **zero** errors — the error surface's day-cost is bounded by mistakes, not by design.

## Not measured — the bound on this audit

- **`doc.edited` reflection**: a user's CLI edit emits no `doc.edited` (verified — edit landed, queue stayed empty); the event comes from UI editing sessions, which this audit did not drive. The `doc diff` read path and its 16,000-char bound are uncosted.
- **Residents**: no `resident.designated`/`released` was exercised; `converse/SKILL.md` (14,714 tok/launch) and the listener's own lane costs are counted as an installed-surface figure only.
- **The real briefing behavior of Claude Code**: rows 1–4 assume the runtime loads what the skills and CLAUDE.md direct (SKILL.md on invocation, CLAUDE.md and descriptions per context). If a runtime caches skill bodies across subagents, rows 1–2 shrink; nothing in the product controls that today.
- **Claude's actual tokenizer** (see header) and **multi-day parking** (the 8-min rearm was projected from one measured cycle, not run for 8 hours).
- **`corpus upgrade`, `workspace *`, `db *`, `index *`, `folder *`, `board order`** outputs in anger — helped-measured only.
- **The UI surface** — out of scope; the agent never reads it.
