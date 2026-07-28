# [SERVER-016] Form answer write path (form.respond producer)

## Domain

server

## Status

done

## Priority

P1

## Model

opus — consumes CONTRACT-007's pinned shapes through the shipped write pipeline.

## Dependencies

- Depends on: CONTRACT-007, SERVER-006
- Blocks: UI-008

## Spec References

- SPEC.md §8 — the answer flow; §7 — form.respond enqueue

## Summary

Implements CONTRACT-007's form-answer route through the shipped mutation pipeline: validate the answer against the form fence, append the answer turn, enqueue `form.respond`, clear the needs=form attention reason.

## Acceptance Criteria

- [x] `POST /api/threads/{id}/turns/{ts}/form` is mounted against `contractRoutes.respondToForm` and answers `201` with `FormAnswerResponse` (`{thread, turn, eventId, warnings}`).
- [x] The answer is validated against the **fence it answers** by calling `@corpus/contract`'s `validateFormAnswer` — an option the form does not offer is `400` naming `body.option` and quoting the offered options.
- [x] The fence is located with the contract's own grammar (`extractFormSource` / `FormSchema`); no third definition is introduced. ` ```formula `, ` ```form-builder `, no fence, unparseable YAML and YAML failing `FormSchema` are all refused.
- [x] Only the four declared statuses (`201 / 400 / 401 / 404`) are reachable — in particular **no `423`**: no lock guard is added (sprint-006 Adjudication 1 stands).
- [x] The answer appends a real turn through the shipped pipeline (atomic write, `updated`/`agent` frontmatter, auto-commit with the acting party as git author, synchronous re-projection, SSE `invalidate`), carrying §14 warnings on the response.
- [x] Exactly one `form.respond` event is enqueued, with the `FormRespondPayloadSchema` shape `{threadId, formTs, option, note|null}` where `formTs` is the **carrying turn's** stamp; no `comment.created` rides along.
- [x] §8 is honoured through the shipped `decideParticipation` predicate: a resolved (or non-engaged) thread appends the turn and commits it but enqueues nothing, and `eventId` is `null`.
- [x] The attention reason clears: the thread is in `needs=form` / `needs=me` before the answer and absent after (discharged by construction — appending a *user* turn moves `last_author`, so `needs.ts` needed no change).

## Technical Design

**`apps/server/src/threads/forms.ts`** holds the verb; `routes.ts` mounts it with `app.openapi(contractRoutes.respondToForm, …)` (single media type, so the dual-media helper is not needed).

`answerThreadForm` runs inside `mutex.run(id, …)` and does, in order:

1. `loadThread` → `requireForm(thread, ts)`. `requireForm` normalizes `ts`, finds the turn, requires it be an **agent** turn, pulls the fence with the contract's `extractFormSource`, parses the YAML with the `yaml` package, and validates it with the contract's `FormSchema`. Each of those five failures is the contract's `404` with its own message — the route's description assigns "no such turn, or that turn carries no form" to `404`, and `400` is reserved for the one thing a static schema cannot check.
2. `validateFormAnswer(form, answer)` from `@corpus/contract`; its `ValidationError` becomes the `400` verbatim (`path: "body.option"`).
3. `decideParticipation({requestsAgent: undefined, author: actor, parsed: NO_MENTIONS, thread})` — the §8 matrix, unmodified, so `resolved` / not-`engaged` / agent-authored all land on "do not re-trigger" without a second `if` in this file.
4. `buildTurnAppend` + `commitTurnAppend`, **extracted from `turns.ts`** so the answer is written by the same code a reply is. The only two things the form path supplies of its own are the commit subject (`form: answer on <id> by <actor>`, a deliberate sibling of `comment: turn on <id> by <actor>`) and the event.
5. `workspace.enqueue({type: FORM_RESPOND_EVENT_TYPE, source: "thread", payload: formRespondPayload(…)})` when and only when step 3 said to. The payload builder's return type is the contract's `FormRespondPayload`, so the compiler enforces `note: string | null` being **present**.

The answer turn's body is `**Answered:** <option>` plus a blank line and the note when one was given — prose, because a thread is markdown a person reads; the machine-readable form travels in the event payload.

**Decided corners** (each with its own test):

- **Answering twice is allowed** and appends a second turn with a second event. §6 defines no once-only rule and gives the format no "answered" marker to write one with; the first answer moves `last_author` to `user`, so the thread leaves `needs=form` and the UI stops offering the controls anyway.
- **A non-engaged thread** enqueues nothing, for the same reason a resolved one does not — it is one decision, `decideParticipation`'s, reported once through `eventId`.
- **A `doc_` id** is a `400` from `ThreadIdSchema` before the handler runs. That is a declared status, not a leak.

## E2E Verification Log

**implemented on: opus**

### Reproduction (bugs only)

Not a bug — a missing write path. The pre-implementation state was confirmed by the sprint contract:
the route is in `ENDPOINT_INVENTORY` and `404`s on a running server ("no route matches POST …"),
and nothing in `apps/server` imported any of `@corpus/contract`'s form surface.

### Post-Implementation Verification

Real `corpus init` workspace at `/tmp/corpus-s016-noCNar`, real server on **8925** (pid 3548, later
8097; both stopped by pid, `8925` and `8765` confirmed free afterwards with
`lsof -nP -iTCP:<port> -sTCP:LISTEN`). Every `git` invocation carried `-C "$WS"`. The scratch
directory and the file holding the bearer token were deleted at the end. `curl` is the interface —
there is no CLI verb for this route.

#### The fixture recipe (TEST-94 — this is UI-008's handoff)

```sh
WS=$(mktemp -d /tmp/corpus-s016-XXXXXX)
node --import tsx apps/cli/src/bin/corpus.ts init "$WS" --port 8925
node --import tsx apps/cli/src/bin/corpus.ts server start --workspace "$WS"
TOK=$(python3 -c "import json;print(json.load(open('$WS/.corpus/config.json'))['token'])")

# a parent document — note the id is at doc.frontmatter.id, not doc.id
DOC=$(curl -s -X POST http://127.0.0.1:8925/api/docs -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"type":"note","title":"Rate decision","body":"The model assumes 6.1%.\n"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['doc']['frontmatter']['id'])")

# a thread that pulls the agent in (so the thread reaches agent: engaged)
TH=$(curl -s -X POST http://127.0.0.1:8925/api/threads -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d "{\"parent\":\"$DOC\",\"body\":\"@agent which rate?\",\"requestsAgent\":true}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['thread']['id'])")

# the agent posts the form-carrying turn; its ts IS the form's identity
FORMTS=$(curl -s -X POST http://127.0.0.1:8925/api/threads/$TH/turns \
  -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -H 'x-corpus-author: agent' \
  -d '{"body":"I need a decision.\n\n```form\nprompt: Which rate should the model assume?\noptions:\n  - \"6.1% fixed\"\n  - \"5.4% variable\"\n```\n"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['turn']['ts'])")

# answer it — the ts MUST be URL-encoded, an ISO instant contains ':'
curl -s -X POST "http://127.0.0.1:8925/api/threads/$TH/turns/2026-07-28T01%3A10%3A05Z/form" \
  -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"option":"6.1% fixed","note":"matches the quote in the doc"}'
```

#### TEST-73, 79, 80, 81, 84, 90, 92 — the whole loop

Response (`HTTP 201`):

```json
{"thread":{"id":"th_lgmjei7d","status":"open","parent":"doc_2vgaq6l5","agent":"engaged",
 "updated":"2026-07-28T01:10:14Z","turnCount":3,"lastAuthor":"user","lastTs":"2026-07-28T01:10:14Z"},
 "turn":{"author":"user","ts":"2026-07-28T01:10:14Z",
         "body":"**Answered:** 6.1% fixed\n\nmatches the quote in the doc"},
 "eventId":"evt_avba3suhwhqu","warnings":[]}
```

`data/threads/th_lgmjei7d.md` on disk, tail:

````
## agent · 2026-07-28T01:10:05Z
I need a decision.

```form
prompt: Which rate should the model assume?
options:
  - "6.1% fixed"
  - "5.4% variable"
```

## user · 2026-07-28T01:10:14Z
**Answered:** 6.1% fixed

matches the quote in the doc
````

`git -C "$WS" log -3 --format='%h | %an <%ae> | %s'`:

```
c6883e4 | user <user@corpus.local>  | form: answer on th_lgmjei7d by user
c292ea9 | agent <agent@corpus.local> | comment: turn on th_lgmjei7d by agent
b8459f5 | user <user@corpus.local>  | comment: new thread on doc_2vgaq6l5 (th_lgmjei7d) by user
```

**TEST-81**: the subject is `form: answer on <thread> by <actor>` on every answer — the same shape
as the turn path's `comment: turn on <id> by <actor>`, differing only in the verb, so `git log`
distinguishes an answer from a reply without opening the diff.

**TEST-90** — `GET /api/threads/{id}` issued immediately after the `201`, no delay, no retry:
`3 turns; last: 2026-07-28T01:10:14Z '**Answered:** 6.1% fixed…'`.

**TEST-92** — `curl -N /events?token=…` attached across the answer, captured verbatim:

```
:connected

event: invalidate
data: {"keys":[["docs"],["docs","th_lgmjei7d"],["threads","th_lgmjei7d"],["docs","doc_2vgaq6l5"]]}

event: invalidate
data: {"keys":[["queue"],["jobs"]]}
```

Keys only. The stream contains zero occurrences of the option text, the note text or the prompt.

#### TEST-82, 83 — the event

`.corpus/queue/pending/` held one `evt_*.json` before (the fixture's `comment.created`) and gained
exactly one, of type `form.respond` — no `comment.created` alongside:

```json
{"id":"evt_avba3suhwhqu","type":"form.respond","created":"2026-07-28T01:10:14Z","source":"thread",
 "payload":{"threadId":"th_lgmjei7d","formTs":"2026-07-28T01:10:05Z",
            "option":"6.1% fixed","note":"matches the quote in the doc"},
 "status":"pending","updated":"2026-07-28T01:10:14Z"}
```

`formTs` is `01:10:05Z` — the turn **carrying** the form — while the answer turn is `01:10:14Z`.
**TEST-84**: the response's `eventId` (`evt_avba3suhwhqu`) is that file's `id`.

An answer given with no note wrote, verbatim:
`{"threadId":"th_jvwknwxo","formTs":"2026-07-28T01:11:36Z","option":"B","note":null}` —
`'note' key present: True`, value `null`. Not omitted.

#### TEST-85, 86, 87 — §8

- **Resolved thread** (`status: resolved`, `agent: engaged`): `HTTP 201`, `eventId: None`,
  **zero** new `evt_*.json`; the turn is on disk (`**Answered:** Yes`) and committed
  (`user | form: answer on th_qcdgn6km by user`).
- **Not engaged** (`agent: none`): `HTTP 201`, `eventId: None`, zero new events.
- Both fall out of `decideParticipation` — there is no `status === "resolved"` test in `forms.ts`.

#### TEST-74, 77, 78 — every status, every refusal, over real HTTP

| Provoked | Result |
| --- | --- |
| valid answer | `201` |
| option `4.0% teaser` | `400` `{"code":"bad_request","issues":[{"path":"body.option","message":"`4.0% teaser` is not one of this form's options: `6.1% fixed`, `5.4% variable`."}]}` |
| no `Authorization` | `401` + `www-authenticate: Bearer` |
| `ts` naming no turn | `404` `no turn at 2026-07-19T10:05:00Z in thread th_lgmjei7d` |
| unknown thread id | `404` `no document with id th_zzzzzz` |
| `ts` of a **user** turn | `404` `…is not an agent turn and carries no form` |
| ` ```formula ` fence | `404` `…carries no form` |
| ` ```form-builder ` fence | `404` `…carries no form` |
| no fence at all | `404` `…carries no form` |
| unparseable YAML | `404` `…is not valid YAML` |
| `options: []` | `404` `…is not a valid form: Too small: expected array to have >=1 items` |

No `403`, `409` or `423` was ever returned. After all eleven refusals `git log -1` was unchanged and
the pending count was unchanged — a refusal writes nothing.

#### TEST-75 — no lock guard

The parent document was locked by the **agent** (`POST /api/locks/{docId}` with
`x-corpus-author: agent` → `201`), then a **user** answered a form on a thread under it:
`HTTP 201`, event enqueued. Confirmed at the code level too: `forms.ts` never calls
`assertWritable`, exactly as `turns.ts` does not.

#### TEST-76 — the acting party

Body carrying `author`/`actor`/`from` set to `user` with header `x-corpus-author: agent` committed as
`agent <agent@corpus.local>` and wrote a `## agent ·` turn (unit test); the header decides, the body
is ignored (it is not even in `FormAnswerRequestSchema`).

#### TEST-88 — answering twice

Second answer to the same form: `HTTP 201`, a second `form.respond`
(`evt_w7etktbb35o6`, `option: "A"`, `note: "changed my mind"`), thread now at 4 turns. Deliberate —
§6 gives the turn format no "answered" marker, and the thread has already left `needs=form`.

#### TEST-89 — §14 warnings

With a `pre-commit` hook exiting 1 in the real workspace:

```
HTTP 201 | warnings: [{"code":"commit_failed","detail":"git commit failed: doc check: refusing"}]
HEAD unchanged: True
turn still on disk: True
git status for the file: M data/threads/th_thkolnvs.md
```

The write stands, uncommitted, and the client is told — §14's rule exactly.

#### TEST-91 — Attention

`GET /api/docs?needs=form` → `['th_lgmjei7d']` and `?needs=me` → `['th_lgmjei7d']` before the answer;
`[]` and `[]` after. **The detector needed no change**: `needs.ts` requires
`t.last_author = 'agent' AND tu.ts = t.last_ts`, and appending a *user* turn moves both — so this is
discharged by construction, and `docs/needs.ts` was not touched (no third fence definition, per
Open Conflict 11).

#### TEST-95 — the event survives the queue's lifecycle

`corpus queue claim-all` returned the `form.respond` event among the batch;
`GET /api/queue/status` read `pending 6 / inProgress 0` → `pending 0 / inProgress 6` after the claim
→ `inProgress 5 / processed 1` after `corpus queue complete evt_avba3suhwhqu`, with the file landing
in `.corpus/queue/processed/evt_avba3suhwhqu.json`.

#### TEST-96 and the check suite

- `npx vitest run apps/server` — **2079 passed, 0 failed** across 484 suites (111 test files). The turn, resolve,
  reopen, seen and cascade suites are untouched and green; the `turns.ts` change is a mechanical
  extraction those suites cover.
- Whole repo: **3851 passed, 0 failed** (933 suites, 218 test files).
- `npm run lint` clean · `npm run format:check` "All matched files use Prettier code style!" ·
  `npm run typecheck` clean.
- `GET /api/db/doctor` on the exercised workspace: `{"ok":true,"drift":[],"stats":{"files":15,"documents":15}}`.

#### TEST-93 — the unit suite

`apps/server/src/threads/forms.test.ts`, **33 tests**, real app + real git repo via
`createThreadWorkspace("forms")` (`mkdtemp`, `port: 0` — no port is hardcoded anywhere): valid
answer; option not offered; empty option; no fence; ` ```formula `; ` ```form-builder `; YAML that is
not a mapping; YAML that does not parse; `options: []`; empty prompt; repeated options; `ts` naming
no turn; `ts` naming a user turn quoting a fence; unknown thread; `doc_` id; unauthenticated; note
present; note absent; resolved thread; non-engaged thread; agent answering its own form; answering
twice; concurrent answers; locked parent; `commit_failed`; invalidation keys and no content on the
bus; `needs=form`/`needs=me` before and after; the queue lifecycle; read-your-write.

#### Not verified / deferred

Nothing. All 24 criteria (TEST-73…96) were executed.

## Completion Checklist (domain agent)

- [x] Tests written and passing (33 new, `apps/server` 2079 green, repo 3851 green)
- [x] `/lint` passes (eslint, prettier, tsc)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [x] `/evaluate` passes (if evaluator active)
- [ ] Committed with the issue-ID prefix
