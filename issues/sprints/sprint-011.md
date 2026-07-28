# Sprint 011 — Phase 3, the writing surface: the editor, its anchors, the conversation, and the way in

**Issues**: UI-006, UI-007, UI-008, UI-010
**Domains**: ui (`apps/ui` + `packages/kit`)
**Date**: 2026-07-28
**Plan phase**: Phase 3 — UI (the last four issues of it)
**Branch**: `phase-3-ui` (currently at `f90c6a5`, clean; agents work in worktrees cut from it)

---

## What makes this sprint different

**This is the sprint where Corpus stops being readable and becomes usable.** Sprint-010 shipped a
reader: a document opens, its body renders, its threads list, its menu acts. Nothing in it writes a
character of prose. All four issues here do — UI-006 writes the body, UI-007 writes anchors into the
parent's frontmatter, UI-008 writes turns and form answers, UI-010 writes new documents and new
threads from nothing. **Every single acceptance criterion below that claims a write is verified on
disk and in `git log`, never from the DOM.**

**Two waves, and wave B is defined by integration rather than by features.** UI-006 and UI-008 are
both ready at sprint start and are file-disjoint (`reader/` body vs `reader/` threads + `kit`).
UI-007 exists only on top of UI-006's serializer — its crux, the markdown-offset ↔ ProseMirror
mapping, is *derived from* that serializer's emission trace and cannot be built against a stub.
UI-010 is a composition of UI-008's composer, UI-008's attachment intake and UI-009's overlay
machinery; almost nothing in it is new mechanism. **So wave-B criteria below are written as
integration criteria** — they assert that UI-007 uses UI-006's serializer rather than a second one,
and that UI-010 uses UI-008's intake hook and `@corpus/kit`'s autocomplete rather than a second copy.
A wave-B issue that reimplements its parent's unit passes its own features and fails this contract.

**Three of the four issue files describe mechanisms the shipped contract deliberately replaced.**
This is the same pattern sprint-010 hit three times, and it is worth stating up front so agents do
not implement stale text:

- **UI-008 says the form answer is "a structured answer turn" the UI composes and posts.** The
  shipped contract has a dedicated route — `POST /api/threads/{id}/turns/{ts}/form`
  (`packages/contract/src/routes/forms.ts`) — whose own description says the *server* "appends a
  structured answer turn carrying the chosen option and any note, and enqueues a `form.respond`
  event". A UI that posts a hand-built turn to `/turns` produces no `form.respond`, no queue event,
  and no agent re-trigger. **Open Conflict 1.**
- **UI-006 says the lock comes from `GET /api/docs/:id`.** It does not. `DocSchema` has no lock
  field; lock state is `GET /api/locks` → `useLocks()` / `useDocLock(docId)`, invalidated by the
  `["locks"]` / `["locks", docId]` SSE keys. `DocView.tsx` already reads it that way. **Open
  Conflict 3.**
- **UI-006 says the PUT response "reports the commit" and drives a `committed · git ✓` chip state.**
  `UpdateDocResponseSchema` is `{doc, anchors: {remapped, orphaned}, warnings}` — there is no commit
  field, no sha, and the closed 9-shape SSE key vocabulary has no squash-on-idle signal either. The
  third chip state has no wire source today. **Open Conflict 2 — the one blocking hole in this
  batch.**

**All four issue files place their code under `apps/ui/src/features/…`, which does not exist.** The
shipped tree is domain-foldered: `apps/ui/src/{app,board,console,dev,reader,search,shell,testing}/`.
Four agents inventing `features/` in four worktrees is four merge conflicts and a layout the repo
does not use. **Open Conflict 8.**

**Everything else these issues need is mounted and answering.** Verified by reading the route
definitions and their `mountX` helpers, not an inventory: `PUT /api/docs/{id}` with its
`{remapped, orphaned}` report, `GET /api/docs/{id}` with `anchors[].range = {start, end}` character
offsets into `body`, `POST /api/threads` in **both** JSON and multipart forms carrying `selector`,
`POST /api/threads/{id}/turns` in both forms, `POST /api/threads/{id}/turns/{ts}/form`,
`DELETE /api/threads/{id}/turns/{ts}`, `/resolve`, `/reopen`, `/seen`, **`POST /api/capture`**,
`GET /attachments/*`, and the `uploadTurn` / `uploadCreateThread` / `uploadCapture` multipart helpers
in `@corpus/contract/client`. Nothing in this batch is blocked on a contract change except Open
Conflict 2.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue      | The real application in this sprint                                                                                                                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI-006** | A **real `corpus init` workspace on `9002`** seeded with documents covering every markdown construct in the round-trip corpus, plus one anchored thread and one lockable document; a **real server**; a **real browser**. Every editor claim is verified by `cat`-ing the file and by `git diff HEAD~1` — "the text appeared" is not verification. |
| **UI-008** | A **real workspace on `9007`** with a thread carrying user turns, agent turns, a ```` ```form ```` turn, and attachments; a real second actor driving `corpus thread reply --from agent` from a terminal. Attachment bytes are checked under `.corpus/attachments/`; queue events are checked under `.corpus/queue/pending/`.        |
| **UI-007** | A **real workspace on `9012`** with a multi-paragraph document, at least three anchors at different vertical offsets, one resolved thread and one already-orphaned thread. Every anchor claim is verified against the parent's frontmatter `anchors:` map on disk, and against `GET /api/docs/{id}`'s `anchors[].range`.             |
| **UI-010** | A **real workspace on `9017`**, a real browser, and a real keyboard. Every keyboard claim is exercised through actual key events (Playwright or manual), never by calling a handler. `⇧←`/`⇧→` is verified by `cat`-ing the view documents' `order` frontmatter and by `git log`.                                                     |

### Port allocation

This sprint takes `9000`–`9024`. Verified free at contract time (`lsof -nP -iTCP -sTCP:LISTEN`
showed nothing bound in `9000`–`9199`).

| Consumer                              | Range         | Primary | UI dev server         |
| ------------------------------------- | ------------- | ------- | --------------------- |
| UI-006                                | `9000`–`9004` | `9002`  | `CORPUS_UI_PORT=5278` |
| UI-008                                | `9005`–`9009` | `9007`  | `CORPUS_UI_PORT=5279` |
| UI-007                                | `9010`–`9014` | `9012`  | `CORPUS_UI_PORT=5280` |
| UI-010                                | `9015`–`9019` | `9017`  | `CORPUS_UI_PORT=5281` |
| Cross-issue (TEST-159…176)            | `9020`–`9024` | `9022`  | `CORPUS_UI_PORT=5281` |
| Automated tests, every workspace      | —             | `0` (ephemeral). Never hardcode. | — |

**Reserved and off-limits:**

- **`8765` must stay UNBOUND for the whole sprint, by everyone.** It is the workspace default and the
  target of `apps/ui/vite.config.ts`'s proxy. `apps/ui/e2e/smoke.spec.ts` asserts the console strip
  reads exactly `"server unreachable"`, which is only true when nothing listens on 8765. Always pass
  `--port` explicitly to `corpus init` so its upward probe never reaches it, and check
  `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done. Verified free at contract time.
- **`8985`–`8994` and `/tmp/corpus-eval-s010-*` belong to a sprint-010 evaluator running
  concurrently.** Do not bind them, do not read them, do not clean them. `8982` was observed **bound
  by another node process** at contract time — it is sprint-010's cross-issue port. Nothing in
  `8960`–`8999` is this sprint's.
- **`5173` and `5174` are held by an unrelated `ssh` process (PID 16094)**, re-confirmed at contract
  time. Never let anything default there. Per-agent dev ports are assigned above (the sprint-010
  adjudication that ended contention for one shared Vite port stands).
- **Playwright is still single-holder.** `playwright.config.ts` sets `reuseExistingServer: false`
  with `--strictPort`, so an `npm run e2e` run owns whatever `CORPUS_UI_PORT` it is given for its
  whole duration. Four claimants, four assigned ports — but only **one e2e run at a time on this
  machine** regardless, because of the machine-load rules below. The orchestrator schedules them.

### Scratch directories — one prefix per issue

| Issue       | Prefix                                    |
| ----------- | ----------------------------------------- |
| UI-006      | `mktemp -d /tmp/corpus-s011-u006-XXXXXX`  |
| UI-008      | `mktemp -d /tmp/corpus-s011-u008-XXXXXX`  |
| UI-007      | `mktemp -d /tmp/corpus-s011-u007-XXXXXX`  |
| UI-010      | `mktemp -d /tmp/corpus-s011-u010-XXXXXX`  |
| Cross-issue | `mktemp -d /tmp/corpus-s011-int-XXXXXX`   |

Automated tests use `fs.mkdtemp`/`mkdtempSync` with the same prefix.

**Never** `rm -rf /tmp/corpus-*` — a sprint-010 evaluator's `/tmp/corpus-eval-s010-*` workspaces are
live right now. Delete only paths you created and captured in a variable.

**The scratch hazard specific to this sprint:** all four issues run `git` against a scratch workspace
to prove auto-commits. Every `git` invocation carries an explicit `cwd` or `-C`; a `git` command with
the wrong working directory operates on **the Corpus repository itself**. Run `git status` in your
worktree before declaring done.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node` and `killall node` **kill sibling
agents' servers, the sprint-010 evaluator's server, and dev servers** — forbidden for the duration of
this sprint. Stop what you started, by pid:

```sh
node --import tsx apps/cli/src/bin/corpus.ts server start   # then: corpus server stop
CORPUS_UI_PORT=5278 npm run dev -w apps/ui & UI=$!          ; kill -TERM "$UI"
curl -N "http://127.0.0.1:9002/events?token=$TOK" & SSE=$!  ; kill -TERM "$SSE"
```

Before declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. Playwright's
`webServer` child and background `curl -N` SSE clients are killed by captured pid. Check your
assigned dev port too.

### Machine-load discipline — binding on every agent in this batch

Verbatim from sprint-010, and it applies harder here because a sprint-010 evaluator is already
running:

- **Scoped tests only during development**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`.
  **Never** run the repo-wide suite, `npm test` without a workspace filter, or `npm run coverage`
  from a worktree. The orchestrator's harvest run is the single repo-wide gate.
- **One workspace-scoped run at the very end of your session is the maximum**
  (`VITEST_MAX_THREADS=4 npm test -w apps/ui`).
- **Cap workers on every vitest invocation**: `VITEST_MAX_THREADS=4`.
- **One heavy command at a time.** Never overlap builds, test runs, e2e, or `npm install`; wait for
  each to finish before starting the next. Never start a build while a backgrounded run is alive.
- **Playwright/e2e is single-holder** — it starts its own Vite. Never run it while another e2e run or
  dev server is up.
- **Before ending, kill every process you started (recorded pids only) and verify your ports are
  free.** After any interrupted run, sweep orphans: `ps aux | grep [v]itest`, kill by pid.
- **Cap concurrent implementation agents at three.** This batch is four issues in two waves — wave A
  is two agents, wave B is two agents. Do not run all four at once.

### Runtime gotchas that will otherwise be misread as bugs

Every fact below was read out of the shipped tree at `f90c6a5` while writing this contract.

**The shipped body-render seam, exactly**

`apps/ui/src/reader/DocView.tsx` has **one** body call site and it already branches:

```tsx
{reader.isThread ? (
  <div className="doc-body thread-conversation">
    <TurnList turns={reader.thread?.turns ?? []} onOpenRef={onNavigate} />
  </div>
) : (
  <MarkdownView markdown={doc.body} className="doc-body" onOpenRef={onNavigate} />
)}
```

- `MarkdownView` lives in **`packages/kit/src/markdown/MarkdownView.tsx`** (`react-markdown` +
  `[remarkGfm, remarkCorpusRefs]`, with a `RefLink` that resolves `[[id]]` through cache-deduped
  `useDoc`). `remarkCorpusRefs` is `packages/kit/src/markdown/refs.ts` and also exports `parseRefs`,
  `refIds`, `splitTextNode`, `REF_PATTERN`, `REF_ID_ATTRIBUTE`, `REF_ALIAS_ATTRIBUTE`.
- **`MarkdownView` does not disappear when UI-006 lands.** `TurnList` renders each turn through it,
  UI-008 renders turn bodies through it, and a plugin-rendered doc type never gets an editor. UI-006
  replaces the **else** branch only. See Open Conflict 4.
- The title is **not** in that seam: `FrontmatterForm` owns it, takes `selectTitle` and `locked`, and
  already PUTs it. See Open Conflict 5.

**The escape registry is shipped and is not the same thing as a shortcut registry**

`apps/ui/src/reader/useEscapeStack.ts` exports `useEscapeLayer({active, priority, onEscape})` plus
the test seams `resetEscapeLayers()`, `escapeLayerCount()`, `topLayer()`, and:

```ts
export const EscapeLayerPriority = { Reader: 0, Focus: 10, Overlay: 20, Popover: 30 } as const;
```

The topmost active layer consumes Escape/Backspace on the **capture** phase. It handles `esc`/`⌫`
and nothing else. UI-010's shortcut registry is a different mechanism for a different key set — see
Open Conflict 9 before writing a second precedence chain.

**`isOverlayOpen()` reads the DOM, not state**

`apps/ui/src/shell/Shell.tsx` exports `isOverlayOpen()` as
`document.querySelector(".overlay.open") !== null`. UI-010's compose panel and cheat sheet **must**
carry `.overlay` + `.open` or the signal silently lies to every caller (TEST-140).

**`useOpenInColumn()` is context-based**

`apps/ui/src/board/openInColumn.tsx` exports `useOpenInColumn(): {open(target), revealColumn(id)}`;
`Board` registers handlers with `useRegisterBoardNavigation`. UI-010's `↵` and `⇧↵` go through it —
sprint-010's TEST-115 required exactly one implementation of scroll + flash + open.

**The kit's surface as it stands, and what this batch must add**

Shipped read hooks: `useDocs`, `useDoc`, `useThread`, `useTree`, `useJobs`, `useJobLog`,
`useQueueStatus`, `useLocks`, `useHealth`, `useConnectionState`.
Shipped write hooks: `useCreateDoc`, `useCreateThread`, `useUpdateDoc` / `useUpdateDocById`,
`useAppendTurn`, `useMarkThreadSeen`, `useSetThreadStatus`, `useDeleteDoc`, `useBreakLock`,
`useHaltQueue`, `useResumeQueue`, `useRetryJob`, `useAbandonJob`.
Row/signal hooks: `useRowActions`, `useDocLock`, `useAgentActivity`.

- **`CreateThreadInput = CreateThreadRequest`** — the full contract shape, `selector` included. UI-007
  does **not** need a new hook for the JSON path; `useCreateThread` already carries it.
- **`markThreadSeen(id)` deliberately omits `lastSeenTs`**, and its docblock says why: *"the kit's
  callers are surfaces that displayed a thread, and SPEC.md §7's rule is displayed content only."*
  The contract's optional `lastSeenTs` stays unused. De-duplication is client-side. See Open
  Conflict 6.
- **Missing and must be added as named `CorpusClient` methods + named hooks**: `deleteTurn`
  (`DELETE /api/threads/{id}/turns/{ts}`), `respondToForm`
  (`POST /api/threads/{id}/turns/{ts}/form`), `capture` (`POST /api/capture`), and the **three
  multipart paths** — turn-with-files, create-thread-with-files, capture-with-files.
- **The multipart helpers exist but are in the wrong package for a UI caller.**
  `@corpus/contract/client` exports `buildTurnFormData`, `buildThreadFormData`,
  `buildCaptureFormData`, `uploadTurn`, `uploadCreateThread`, `uploadCapture`. The sprint-008 rule
  still stands: **no file under `apps/ui/src` outside the provider wiring may call `fetch(` or import
  from `@corpus/contract/client`.** These get wrapped as kit methods. UI-008 writes the wrappers;
  UI-010 consumes them (TEST-166).
- `useMutation`, `QueryClient` and the raw `CorpusApi` are still deliberately not re-exported.

**The wire shapes that four criteria hinge on**

- `POST /api/threads` (JSON): `{parent?: string|null, selector?: {exact, prefix?, suffix?}|null,
  title?, body, requestsAgent?: boolean}`. Multipart form: `parent`, `selector` **as one
  JSON-encoded text part**, `title`, `text` (not `body`), `requestsAgent` as `"true"|"false"`, and
  repeated `files` parts.
- `POST /api/threads/{id}/turns` (JSON): `{body, requestsAgent?: boolean}`. Multipart: `text`,
  `requestsAgent` string-bool, repeated `files`.
- **The flag is `requestsAgent`, not `agent`, and it is tri-state.** Omitted = "@mention only /
  enqueue if engaged"; `true` = enqueue; `false` = **explicit note-only, which suppresses the §8
  engaged-thread re-trigger**. `○ note only` must send `false`, not omit. This is TEST-52 and it is
  the single easiest thing in the batch to get silently wrong.
- `GET /api/docs/{id}` → `{frontmatter, body, path, anchors: ResolvedAnchor[]}` where a
  `ResolvedAnchor` is `{anchorId, selector: {exact, prefix, suffix}, threadId, threadStatus,
  range: {start, end} | null, orphaned: boolean}`. **`range` is character offsets into the returned
  `body` string** — the markdown body, frontmatter excluded. That is UI-007's input and it removes
  any need for the UI to search text itself.
- `PUT /api/docs/{id}` → `{doc, anchors: {remapped: string[], orphaned: string[]}, warnings}`.
- `POST /api/threads/{id}/seen` → `{threadId, lastSeenTs, unread}`; `unread` is the honest "still
  unread after this mark" answer.
- `DELETE /api/threads/{id}/turns/{ts}` → `{deletedTurn: true, deletedThread: boolean,
  removedAnchor: string|null, parentId: string|null, warnings}`. `ts` contains `:` and **must be
  URL-encoded**.
- `POST /api/capture` is **multipart only**: `{text, requestsAgent?: "true"|"false", files: File[]}`
  → `{docId, threadId, eventId: string|null, warnings}`.
- Attachment bytes: `.corpus/attachments/<threadId>/<turnTs>/<filename>`, served at
  `GET /attachments/<threadId>/<turnTs>/<filename>`, gitignored. **Limits: 25 MB per file, 100 MB per
  request** (`apps/server/src/attachments/limits.ts`) — not the 10 MB UI-008's edge-case list names.
- SSE carries `event: invalidate` with `{keys}` only, from a **closed 9-shape vocabulary**:
  `["docs"]`, `["docs", id]`, `["tree"]`, `["threads", id]`, `["queue"]`, `["jobs"]`, `["jobs", id]`,
  `["locks"]`, `["locks", docId]`. There is no key for "a commit was squashed" and there will not be
  one in this sprint.

**The form grammar, as shipped**

`packages/contract/src/schemas/form.ts`: the opening fence's info string is matched **whole** — only
```` ```form ```` opens a form, ```` ```formula ```` does not. YAML carries `prompt` (non-empty) and
`options` (≥1, each non-empty, all distinct). **Single-select, verbatim option text, optional free
note, no form id** — a form is identified by the timestamp of the turn carrying it, so a turn carries
at most one form. Helpers: `extractFormSource(body)`, `containsFormFence(body)`. The queue payload is
`{threadId, formTs, option, note|null}` (`FORM_RESPOND_EVENT_TYPE = "form.respond"`).

**The CLI entry point and the verbs that exist**

- The `corpus` bin runs from source as `node --import tsx apps/cli/src/bin/corpus.ts`. There is no
  installed `corpus` on PATH in this repo.
- Relevant verbs: `doc create|edit|move|archive|delete`, `thread reply|resolve|reopen`,
  `lock acquire|release|break|list|reap`, `queue …`, `job …`, `db …`, `server …`.
- **There is no CLI verb to mark a thread seen, to answer a form, or to attach a file.** Those are
  exercised over HTTP or through the browser.

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed — because an adjudication struck it, or a dependency has
not landed at the moment of verification — is marked `DEFERRED → <issue>` or
`STRUCK → Open Conflict N` in the E2E Verification Log, with the reason and the substitute evidence
supplied. **Silent omission is a fail.**

---

## Acceptance Tests

### UI-006: Always-editable TipTap document editor

Ports `9000`–`9004`, primary `9002`; UI on `CORPUS_UI_PORT=5278`. **Wave A. 36 criteria.**
The serializer this issue writes is consumed by UI-007's offset map, so its determinism is not an
internal quality concern — it is the substrate of the next issue.

#### The editing surface

```
TEST-1: The body is editable with no mode, no button, no ceremony
  Given: A `type: note` document open in a column reader on 9002
  When:  The user clicks mid-paragraph
  Then:  A caret appears with `caret-color` computing to `var(--accent)` (the prototype's
         `[contenteditable] { outline: none; caret-color: var(--accent) }`), typing inserts at the
         caret, and NO "Edit" button, mode toggle or save button exists anywhere in the tree. Grep
         the rendered DOM for a save control and quote the empty result

TEST-2: The editor replaces exactly one branch of the shipped seam
  Then:  `DocView.tsx`'s non-thread branch renders the editor; its `reader.isThread` branch STILL
         renders `TurnList`, and `MarkdownView` is still exported from `@corpus/kit` and still used
         by turn bodies. The E2E log names the single call site that changed. A second body-render
         call site, or a deleted `MarkdownView`, is the failure this catches (Open Conflict 4)

TEST-3: Focus mode gets the same editor, not a copy
  Given: A document open in focus mode (`f` / ⤢)
  Then:  The same editor component renders at the focus measures — `.doc-body` computes to 16.5px /
         line-height 1.7 / max-width 66ch, versus 15px / 1.62 / 62ch in the column — and entering or
         leaving focus mode does not lose the caret position or discard an unsaved buffer

TEST-4: Prototype typography, not approximately
  Then:  In a column: `.doc-body` is `var(--serif)`, 15px, line-height 1.62, max-width 62ch;
         `.doc-body h2` is 17px with `22px 0 6px` margins; `.doc-body p` is `10px 0`; `.doc-body ul`
         is `8px 0` with `padding-left: 22px`; `li` is `4px 0`. Values read from computed style, not
         from the stylesheet source

TEST-5: A plugin-rendered or non-markdown document type never gets an editor
  Given: A document whose type renders through a plugin `View` (§10), and a `type: view` document
  Then:  Neither mounts the editor. The editor is for markdown-bodied documents only
```

#### The serializer, which is the contract

```
TEST-6: Round-trip is byte-identical over the whole fixture corpus
  Given: A fixture corpus of canonical markdown covering, at minimum: ATX headings h1–h4;
         bold/italic/inline code; bullet lists and ordered lists, each with two nesting levels;
         fenced code blocks with and without a language string; blockquotes, including one
         containing a list; links; `[[ref]]` and `[[ref|alias]]`; horizontal rules; hard breaks; and
         at least two mixed documents combining all of it
  When:  Each fixture is parsed and re-serialized with zero edits
  Then:  `serialize(parse(md)) === md` byte for byte for every fixture. The fixture count is STATED

TEST-7: Serialization is idempotent from the second pass for arbitrary input
  Given: Non-canonical inputs — setext headings, `*` bullets, `_italic_`, ordered lists starting at
         3, trailing whitespace, CRLF, multiple blank lines between blocks
  Then:  `serialize(parse(x))` may differ from `x`, but
         `serialize(parse(serialize(parse(x)))) === serialize(parse(x))` for every case. Both
         properties are asserted, not just the first

TEST-8: The serializer's normalization rules are the stated ones
  Then:  Headings emit ATX (`## `), never setext; bullets emit `- `; bold emits `**`, italic emits
         `*`; fences emit ``` with the language string preserved; exactly one blank line separates
         block nodes; no line has trailing whitespace; the file ends with exactly one `\n`

TEST-9: The serializer is written, not borrowed
  Then:  No HTML→markdown converter (turndown or equivalent) appears in `apps/ui/package.json` or
         `packages/kit/package.json`. Serialization is an explicit walk keyed on node and mark type,
         and parse/serialize share ONE schema/extension definition — asserted by both importing the
         same module, not by two lists that happen to agree

TEST-10: An empty document serializes to empty
  Given: A document whose file is frontmatter only
  Then:  The editor shows one empty paragraph, and serializing yields an empty body string — not
         `"\n\n"`, not `"\n"`. Saving it does not dirty the file (TEST-16 covers the no-op guard)

TEST-11: A ref serializes from its attributes, never from its rendered text
  Given: `[[doc_b]]` where doc_b is titled "Rates", and `[[doc_b|the rate assumption]]`
  Then:  The rendered text is `Rates` and `the rate assumption` respectively, and BOTH serialize back
         to their original bracket forms. Renaming doc_b out of band with `corpus doc edit` changes
         the rendered text and leaves the serialized form identical — verified by `git diff` on the
         parent showing no change to the ref
```

#### Markdown input shortcuts

```
TEST-12: The shortcut set from §11 works as you type
  When:  Each of `## `, `### `, `#### `, `**bold**`, `*italic*`, `_italic_`, `` `code` ``, `- `,
         `* `, `1. `, ``` ``` ```, `> ` is typed at the start of an empty block (or around a word)
  Then:  Each transforms live into the corresponding node or mark, and the result survives a save +
         reload as the canonical markdown form on disk (`cat` the file per case)

TEST-13: Shortcuts do not fire inside a code block
  Given: The caret inside a fenced code block
  When:  `## `, `- ` and `**x**` are typed
  Then:  They stay literal text. `git diff` after autosave shows the characters verbatim inside the
         fence

TEST-14: Pasting markdown parses; pasting into a code block does not
  When:  A block of markdown text is pasted into a paragraph, and the same text is pasted into a
         fenced code block
  Then:  The first is parsed into rich nodes; the second stays literal. Pasting rich HTML goes
         through the schema's `parseHTML` and normalizes on the next serialize — `git diff` shows no
         `<span>`, `<div>`, `style=` or `class=` anywhere in the body
```

#### Autosave, and the save chip

```
TEST-15: N rapid edits are one PUT
  Given: The network panel recording
  When:  Fifteen characters are typed in under 700 ms, then typing stops
  Then:  Exactly ONE `PUT /api/docs/{id}` is issued, ~700 ms after the last keystroke, carrying the
         full serialized body. The request count is quoted from the network log

TEST-16: A no-op edit issues no request
  When:  The user clicks into the body, types a character and deletes it, then idles
  Then:  Zero PUTs. The comparison is against the last SAVED string, not against "the editor fired
         onUpdate"

TEST-17: The save chip reflects the response, never a timer
  Then:  `.save-chip` gains class `saving` (color `var(--sepia-ink)`) while the PUT is in flight and
         class `saved` (color `var(--good)`) only when the response has arrived. With the request
         artificially delayed to 5 s, the chip stays `saving…` for the full 5 s — a chip that
         advances on a timeout is the failure this catches

TEST-18: The chip's anchor claim is the response's anchor claim
  Given: A document with one anchor, edited so the server reports it remapped
  Then:  The `saved` text reflects the PUT response's `anchors: {remapped, orphaned}` — and when the
         response reports an orphan, the chip does not claim `anchors ✓`. The exact copy is whatever
         Open Conflict 2's adjudication settles; the criterion is that it is derived from the
         response body, quoted in the E2E log alongside the chip text

TEST-19: A failed PUT keeps the buffer and retries
  Given: The server made to return 500 for one save
  Then:  The chip shows a `var(--signal)` error state with a retry affordance, the typed text is
         STILL in the editor (nothing rolled back), and the retry issues a fresh PUT carrying the
         same body. After the server recovers, the file on disk matches the editor

TEST-20: Pending saves flush before the buffer can be lost
  When:  Each of: the reader unmounts; the reader switches to a different document; focus mode is
         entered and exited; `visibilitychange` fires with `hidden`
  Then:  A pending debounced save flushes first. Verified on disk: type, immediately switch document,
         and `cat` the outgoing file — the text is there. Rapid doc switching in one reader flushes
         the OUTGOING document's buffer before the editor rebinds (never writes it to the incoming
         document — the id in the PUT URL is quoted)

TEST-21: Autosave never touches undo history
  When:  Text is typed, a save lands mid-sequence, and ⌘Z is pressed repeatedly
  Then:  Undo walks back past the save point normally. Autosave pushes no transaction of its own —
         asserted by comparing the editor's history depth before and after a save

TEST-22: The disk proof — one intended change, nothing else
  Given: A document with headings, nested lists, a fenced block and emphasis
  When:  One sentence is typed into one paragraph and autosave lands
  Then:  `git -C <ws> diff HEAD~1 -- <file>` shows ONLY that paragraph changed. No reflowed lists, no
         re-escaped emphasis, no heading-style churn, no whitespace-only hunks anywhere else. This is
         the criterion the whole serializer exists to satisfy

TEST-23: A commit lands, with the user as author
  When:  An editing session ends and the idle window passes
  Then:  `git -C <ws> log -1` shows the auto-commit with `user` as author. Two saves inside the
         squash window are ONE commit; a save after the window is a second (SPEC.md §4) — the commit
         count before and after is stated
```

#### `[[` autocomplete

```
TEST-24: `[[` opens the menu and it is the prototype's
  When:  `[[` is typed in the body
  Then:  An `.ac-menu` opens (fixed, `var(--surface)`, 1px `var(--line)`, 9px radius, `var(--shadow)`,
         4px padding, `min-width: 250px`, `max-height: 200px`, scrolling) listing documents by title
         from `useDocs`, each row an `.ac-item`

TEST-25: The menu is keyboard-first
  Then:  ↑/↓ move the highlight, ↵ inserts, esc closes and leaves the literal `[[` characters, and
         mouse hover moves the highlight. Esc here must NOT propagate to the reader's escape layer
         and close the document (the layer registry's Popover priority is 30 — TEST-31)

TEST-26: Selecting inserts an id ref that renders as the target's title
  When:  An entry is chosen
  Then:  A `[[<id>]]` node is inserted whose rendered text is the target's CURRENT title on a `.ref`
         element (`var(--accent-ink)`, 1px `var(--accent-wash)` bottom border). `cat` the file: the
         body contains `[[<id>]]`, never the title text

TEST-27: A ref to a nonexistent id is visibly broken and still round-trips
  Given: A body containing `[[doc_doesnotexist]]`
  Then:  It renders with a distinct non-`.ref` broken treatment (§5: a warning, not an error — no
         console output, no toast), and serializing leaves the bracket form byte-identical

TEST-28: Ref title resolution follows sprint-010's adjudicated strategy
  Then:  Titles resolve through cache-deduped per-id `useDoc` (sprint-010 Adjudication 6), NOT a
         request per rendered ref and NOT a collection N+1. A body with eight refs, three of them
         duplicates, issues at most five title requests and zero for ids already in the cache from
         the column's list response. The number is STATED
```

#### Selection toolbar

```
TEST-29: Selecting text pops the prototype's toolbar
  When:  A phrase is selected
  Then:  `.sel-toolbar` gains `.open` and positions above the selection — `var(--surface)`, 1px
         `var(--line)`, 9px radius, `var(--shadow)`, 4px padding — containing **B**, **I**, a
         `.divider` (1px `var(--line)`), and `.comment-btn` reading `💬 Comment` in
         `var(--accent-ink)` at weight 600

TEST-30: B and I toggle marks and report state
  When:  B is clicked on a selection, then the caret is placed inside the bolded run
  Then:  The text bolds, the file gains `**…**` after autosave, and the B button reflects the active
         mark. Same for I and `*…*`

TEST-31: Comment hands off without mutating the document
  When:  `💬 Comment` is clicked
  Then:  An injected `onComment(selection)` callback fires with the selection payload, and the
         document body is BYTE-IDENTICAL before and after (`git status` clean, no PUT issued). Until
         UI-007 lands the callback is a no-op stub — the criterion is that the prop exists, is
         called, and nothing is written. The payload's shape is stated in the E2E log because UI-007
         consumes it
```

#### Locks

```
TEST-32: An agent-held lock makes the editor read-only
  Given: `corpus lock acquire <docId> --holder agent` run from a terminal against the 9002 workspace
  Then:  Within one SSE round trip and with no reload: the editor is `editable: false`, typing
         inserts nothing, no caret renders, the selection toolbar does not open, `[[` does not open
         the menu, and `LockBanner` is the only affordance. The lock source is `useLocks` /
         `useDocLock` — NOT a field on `GET /api/docs/{id}`, which has none (Open Conflict 3)

TEST-33: Unlocking restores editability without a remount
  When:  `corpus lock release` (or Force unlock) clears the lock
  Then:  The editor becomes editable again with scroll position and selection preserved. Asserted by
         scrolling to the middle of a long document before the release and checking `scrollTop` after
         — a remount that resets scroll is the failure this catches

TEST-34: Whether typing acquires a user lock is DECIDED, implemented and logged
  Then:  SPEC.md §7 says "the user's editor session holds the lock while actively editing (acquired
         via the server on first keystroke, released on idle/close)". Per Open Conflict 3's
         adjudication, either the editor acquires and releases the lock — verified by
         `corpus lock list` showing a `user`-held lock during typing and no lock 
         after idle — or the adjudication struck it for this sprint and the E2E log records
         `STRUCK → Open Conflict 3` with the follow-up issue id. Shipping neither, silently, is a fail
```

#### Live updates while editing

```
TEST-35: An SSE invalidation for the doc being typed into does not clobber the buffer
  Given: The editor focused with unsaved text in it
  When:  The SAME document is touched out of band (`corpus doc edit <docId> …`)
  Then:  The in-progress text is NOT replaced. Then, once editing settles (no keystroke for the
         registry's idle window and no pending buffer), the deferred invalidation fires EXACTLY ONCE
         and the external change becomes visible. Both halves are asserted — a guard that never
         releases is as wrong as no guard

TEST-36: A different document's invalidation is not deferred
  Given: The editor focused on doc A with unsaved text
  When:  Doc B is touched out of band
  Then:  Doc B's row/reader updates immediately; doc A's buffer is untouched. The registry is keyed
         by doc id, not global
```

---

### UI-008: Thread view, composer, attachments, forms, read state

Ports `9005`–`9009`, primary `9007`; UI on `CORPUS_UI_PORT=5279`. **Wave A. 48 criteria.**
The densest surface in the batch and the one UI-007 and UI-010 both consume. Its composer, its
attachment intake and the kit's shared autocomplete are **units other issues call**, not private
implementation.

#### The card

```
TEST-37: The thread card is the prototype's, computed
  Then:  `.thread-card` computes to `var(--surface-2)`, 1px `var(--line)` border with a **3px**
         `var(--accent)` LEFT border, 10px radius, `max-width: 62ch`. `.thread-card.resolved`
         switches the left border to `var(--ink-3)` and `opacity: .75`

TEST-38: The head's three variants read exactly as the prototype writes them
  Then:  With an anchor: `.t-quote` is the quote in double quotes, serif italic, `var(--ink-2)`,
         12.5px. With `anchor: null` and a parent: `whole-document thread`. With `parent: null`:
         `standalone`. Then in all three: a `.chip.t-status` carrying the status, a `.t-resolve`
         button reading `✓ resolve` (or `reopen` when resolved), and — only when NOT `bare` — a
         `.t-collapse` `–` button

TEST-39: The context line names the parent and links back at the anchor
  Then:  `.t-context` (11px mono, `var(--ink-3)`) reads `on <parent title> · at "<quote>"`, or
         `on <parent title> · whole document`, or `standalone thread · <id>`. Clicking the parent
         title opens that document in the reader SCROLLED TO the anchor with the highlight flashed
         (with UI-007 landed; before it, scrolled to the document and the log says so)

TEST-40: A thread whose parent was deleted degrades instead of breaking
  Given: A thread whose parent document has been deleted (its record is orphaned per §9)
  Then:  The context line shows the stored parent id as plain text with no link, and nothing throws.
         Assert with a page-error listener collecting nothing

TEST-41: The card renders in all three hosts from one component
  Then:  `bare` (a slot / margin card, no collapse control), standalone (a `type: thread` document
         open in a reader — full width, context line shown) and nested (a child thread) are ONE
         component switched by a host class in CSS. Two JSX branches producing two layouts is the
         failure this catches
```

#### Turns

```
TEST-42: Turns render as the prototype's blocks
  Then:  Each `.turn` has a hairline top border except the first. `.turn-who` is 10.5px mono,
         `var(--ink-3)`, baseline-aligned; `.turn-who .who` is 700 weight, uppercase,
         `letter-spacing: .05em`, `var(--ink-2)` — and `.who.agent` is `var(--accent-ink)`. The
         timestamp renders beside it

TEST-43: Turn bodies are markdown with live refs
  Then:  `.turn-body` renders markdown through the kit's `MarkdownView` (not a second renderer), and
         a `[[ref]]` inside a turn shows the target's CURRENT title. Rename the target out of band
         with `corpus doc edit`: the turn's link text updates live via SSE with no reload

TEST-44: The trace line is the prototype's
  Given: An agent turn carrying a trace
  Then:  `.turn-trace` renders 11px `var(--ink-3)` with `↳ ` supplied by `::before` — the arrow is
         CSS content, not text in the string

TEST-45: React keys are turn timestamps
  Then:  Turn list keys are `ts`, never the array index. Verified by deleting a middle turn and
         asserting no other turn's DOM node is recreated (or by reading the code and quoting it in
         the log — state the method used)

TEST-46: Delete arms before it fires, and only for user turns
  When:  A user turn is hovered
  Then:  `.turn-del` (`✕`) goes from `opacity: 0` to `1` (also on `:focus-visible`), `var(--signal)`
         on hover. First click re-labels it to `delete?` with class `armed` (10px mono,
         `var(--signal)`) and issues NO request — network log quoted. Second click issues
         `DELETE /api/threads/{id}/turns/{ts}` with the timestamp URL-ENCODED. Clicking elsewhere or
         pressing esc disarms. An AGENT turn exposes no delete control at all

TEST-47: Deletion is honest on disk and in git
  When:  A user turn is deleted
  Then:  Its `## user · <ts>` block is gone from the thread file, `git -C <ws> log -p` still contains
         it, and `git log -1` shows the deletion auto-commit

TEST-48: The cascade is reflected, not assumed
  When:  A thread's LAST remaining turn is deleted
  Then:  The response's `deletedThread: true` is honored — the thread disappears from every surface
         showing it, its file is gone, and (with a parent) the parent's `anchors` entry named by
         `removedAnchor` is gone in the SAME commit. The component unmounts cleanly: no "thread not
         found" flash, no error toast, no page error

TEST-49: Deleting a turn that has child threads does whatever the server does
  Then:  The UI reflects the server's response and the observed disk state, and the E2E log RECORDS
         what that is. Guessing — either assuming cascade or assuming survival — is the failure
```

#### The composer

```
TEST-50: The placeholder is exact
  Then:  The composer input's placeholder is exactly
         `Reply — @ route · / skill · [[ link · paste or drop files`
         and its `aria-label` is `Reply`. Character-for-character, from `design/index.html`

TEST-51: The foot is the prototype's, in order
  Then:  `.composer` is `var(--surface)`, 1px `var(--line)`, 8px radius, `8px 10px` padding.
         `.composer-foot` is 10.5px mono `var(--ink-3)` and contains, in order: `.clip` (`📎`), the
         toggle, the status hint, and `.send` reading `Reply ↵` right-aligned in `var(--accent-ink)`
         at weight 600. `.toggle.on` is `var(--accent-ink)`

TEST-52: The toggle maps to the tri-state `requestsAgent`, correctly
  Then:  `◉ ask agent` posts `requestsAgent: true`. `○ note only` posts `requestsAgent: FALSE` —
         explicitly false, NOT omitted, because omitted means "enqueue if engaged" and would
         re-trigger the agent on an engaged thread (SPEC.md §8). Verified three ways on an ENGAGED
         thread: request body quoted from the network log; `.corpus/queue/pending/` empty after a
         note-only reply; `.corpus/queue/pending/` holding a `comment.created` after an ask reply

TEST-53: An `@` or `/` in the text requests the agent regardless of the toggle
  Given: The toggle set to `○ note only`
  When:  A reply containing `@agent` is sent
  Then:  Per SPEC.md §8 a mention requests the agent. The UI does not resolve routing itself — it
         sends the raw text and the flag; the server parses mentions authoritatively. What the UI
         sends for `requestsAgent` in this case is STATED in the E2E log along with the observed
         queue result, because "note only + @agent" is a genuine ambiguity and the observed behavior
         is the record

TEST-54: The hint text follows thread status
  Then:  An open thread's hint reads `thread stays open`; a resolved thread's reads
         `reopens on reply`. Sending an `ask agent` reply to a resolved thread reopens it
         server-side, and the hint said so BEFOREHAND — verified by reading the hint, then sending,
         then `cat`-ing the file's `status`

TEST-55: The send button cannot fire twice
  When:  Reply is pressed twice in rapid succession
  Then:  ONE POST is issued (send disabled while in flight) and exactly one optimistic turn appears.
         Network log quoted

TEST-56: The optimistic turn appears then reconciles
  When:  Reply is pressed
  Then:  The user's turn appends immediately with a provisional timestamp, and is REPLACED (not
         merged, not duplicated) by the server's turn on refetch. On a failed POST it is removed and
         the composer's text AND pending attachment chips are restored

TEST-57: A turn arriving via SSE does not eat the draft
  Given: Draft text in the composer
  When:  `corpus thread reply --from agent` appends a turn from a terminal
  Then:  The new turn renders and the draft text is still in the input, uncleared
```

#### The shared autocomplete (a kit unit)

```
TEST-58: One autocomplete, three triggers, one data source
  Then:  `@`, `/` and `[[` all resolve through `useDocs` over `GET /api/docs` with a TYPE FILTER —
         `@` → `type: agent-def` (name + description), `/` → `type: skill`, `[[` → documents by
         title. There is NO separate registry, no hardcoded agent list, and no second endpoint.
         Creating a new `agent-def` document with `corpus doc create` makes it autocompletable
         immediately (§11: "there is no separate registry")

TEST-59: It lives in `@corpus/kit` and has three callers
  Then:  The component ships under `packages/kit/src/components/Autocomplete/` (or the kit path the
         adjudication settles), is exported from `packages/kit/src/index.ts`, and is imported by
         UI-008's thread composer, UI-006's `[[` menu and UI-010's global composer. `apps/ui/src`
         contains exactly ONE trigger-detection implementation — grep and quote the result

TEST-60: Trigger detection handles the awkward cases
  Then:  A trigger fires at a word boundary and mid-line; it does NOT fire inside an existing
         completed token, immediately after a word character (`foo@bar`), or when escaped. Closing
         the menu with esc leaves the literal trigger characters in the input

TEST-61: The menu is the prototype's and is keyboard-first
  Then:  `.ac-menu` / `.ac-item` with a mono accent `.k` key and a dim `.d` description; ↑↓ move, ↵
         selects, esc closes, hover moves the highlight
```

#### Attachments

```
TEST-62: Three ways in, one pending list
  Then:  (a) `📎` opens a file picker; (b) pasting an image or file from the clipboard creates an
         attachment — `ClipboardEvent.clipboardData.files` is read FIRST and text insertion happens
         only when there are no files, so NO base64 or filename garbage lands in the input;
         (c) dragging over the composer adds `.composer.dropping` (`var(--accent)` border,
         `var(--accent-wash)` background) and dropping adds the file. All three land in one
         `PendingAttachment[]`

TEST-63: The drop highlight does not flicker over nested children
  Given: A composer with nested elements
  When:  A drag moves across child boundaries
  Then:  `.dropping` stays applied throughout — a dragenter/dragleave COUNTER, not a boolean.
         Asserted by moving the drag over three nested targets and sampling the class each time

TEST-64: Pending chips preview and clean up
  Then:  Each pending attachment renders an `.att-chip` (1px `var(--line)`, 7px radius, `3px 8px`,
         11px mono, `var(--surface-2)`) with a 34px-high image thumbnail for images and a remove
         button that turns `var(--signal)` on hover. Object URLs are revoked on removal and on
         unmount — asserted, because the leak is invisible

TEST-65: An attachment-only turn is a turn
  Given: One pending attachment and an empty input
  Then:  Reply is ENABLED. Sending posts multipart with `files` and no `text`, and the thread file
         gains a turn whose body is the attachment reference only

TEST-66: Posted attachments render per the prototype and resolve real bytes
  Then:  Images render inline as `.turn-att-img` (max 240×180, 8px radius, 1px `var(--line)`);
         non-images render as `.att-file` download chips. Both resolve through
         `GET /attachments/<threadId>/<turnTs>/<file>` — the response is a 200 with the right
         content-type, quoted from the network log

TEST-67: The bytes are on disk, gitignored, and the reference is committed
  When:  A PNG and a PDF are sent
  Then:  Bytes exist at `.corpus/attachments/<threadId>/<turnTs>/`; `git -C <ws> status` shows them
         untracked-and-ignored; the committed thread markdown contains RELATIVE links to them

TEST-68: An oversized upload surfaces the server's answer, not a silent failure
  Given: The shipped limits — 25 MB per file, 100 MB per request
  When:  A file past the per-file cap is attached and sent
  Then:  The server's 413 surfaces as a toast naming what happened, the turn is NOT posted, and the
         composer text and remaining chips are restored. (UI-008's issue file says 10 MB; the shipped
         limit is 25 MB — Open Conflict 10)

TEST-69: A failed upload with text present posts nothing
  When:  A send with both text and attachments fails at the upload
  Then:  NO turn is created (verified by `cat`-ing the thread file — no partial turn), and the text
         and chips are restored with an error toast
```

#### Forms

```
TEST-70: A `form` fence renders as live controls
  Given: An agent turn posted via `corpus thread reply --from agent` carrying a ```` ```form ````
         block with a `prompt` and three `options`
  Then:  `.form-comment` renders a stack of `.form-opt` cards (1px `var(--line)`, 8px radius,
         `7px 10px`, `var(--surface)`; `var(--accent)` border on hover), each with the option label
         and a right-aligned mono `.price` detail when the option carries one, plus a `.form-submit`
         reading `Answer` (accent fill, `var(--bg)` text, 7px radius, weight 600)

TEST-71: The fence grammar is matched WHOLE
  Given: Turns containing ```` ```formula ````, ```` ```form-builder ````, and ```` ```form ````
  Then:  Only the third renders as a form; the other two render as ordinary code blocks. This is the
         contract's own rule (`packages/contract/src/schemas/form.ts`) and the UI must not
         re-implement a looser match — reuse `containsFormFence` / `extractFormSource`

TEST-72: Picking marks, and submitting goes through the FORM route
  When:  An option is clicked and `Answer` is pressed
  Then:  The picked card gains `.picked` (accent border + `var(--accent-wash)`), and the submit issues
         `POST /api/threads/{id}/turns/{ts}/form` — the dedicated route — with
         `{option, note?}`, the `ts` URL-ENCODED. **Not** a hand-built turn posted to `/turns`
         (Open Conflict 1). The request URL is quoted from the network log

TEST-73: The answer produces a real answer turn and a real queue event
  Then:  After the 201: the thread file gains a structured answer turn recording the chosen option
         and any note (`cat` it), and `.corpus/queue/pending/` holds a `form.respond` event whose
         payload is `{threadId, formTs, option, note|null}` with `formTs` equal to the answered
         turn's timestamp and `option` VERBATIM from the offered options. The event JSON is quoted

TEST-74: An answered form is inert
  Then:  A form with a later answer turn addressing it renders with the chosen option shown and NO
         submit control. Answering the same form from a second browser tab makes the first tab's copy
         go inert via SSE refetch, and a submit that races loses harmlessly — the server's rejection
         surfaces as a toast and the UI reconciles

TEST-75: Malformed YAML degrades, never crashes
  Given: A turn containing a ```` ```form ```` fence whose YAML is invalid, and one whose `options`
         list is empty
  Then:  Each renders as a plain code block with a small warning. Nothing throws — page-error
         listener collects nothing. The `yaml` library does the parsing (SPEC.md §5: never hand-roll)
```

#### Child threads

```
TEST-76: Commenting on a turn creates a child thread
  When:  A turn's comment affordance is used
  Then:  `POST /api/threads` is issued with `parent` set to the THREAD's id, and the resulting child
         thread renders nested under that turn. `cat` the new thread file: `parent` is the thread id

TEST-77: Two levels render without breaking
  When:  A turn of the child thread is itself commented on
  Then:  Level-2 nesting renders, and the composer at every level keeps a usable width

TEST-78: Depth ≥3 flattens instead of indenting
  Then:  At depth 3 and beyond the card renders FLUSH with a depth indicator rather than indenting
         further. Asserted by measuring the left offset at depths 1, 2, 3 and 4 — 3 and 4 are equal
```

#### Read state

```
TEST-79: Seen fires for displayed content only
  Then:  `POST /api/threads/{id}/seen` fires when the thread view opens, when a collapsed chip is
         expanded, and when a margin card becomes visible. It does NOT fire when the parent document
         is merely opened with its chips collapsed. All four cases are exercised against the network
         log and the negative case is quoted

TEST-80: Seen is de-duplicated per (thread, last turn)
  When:  A chip is expanded, collapsed and re-expanded three times with no new turn
  Then:  ONE seen POST total. A new turn arriving re-arms it, and the next expand POSTs again.
         Exactly one POST per `(threadId, lastTurnTs)` pair

TEST-81: The kit's bare seen call stays bare
  Then:  `markThreadSeen(id)` sends no `lastSeenTs` — the kit's docblock says why and the contract's
         optional parameter stays unused (Open Conflict 6). De-duplication is client-side. The
         response's `unread` field is what the UI trusts for "still unread", not a local guess

TEST-82: Badges clear everywhere from the server, not locally
  Then:  Opening a thread in one column clears its `.unread` badge in EVERY column showing it, driven
         by the SSE invalidation — not by a local mutation of another component's state. Verified in
         a second browser window against the same server

TEST-83: The document aggregate agrees with the wire
  Given: A document with three threads, two of them unread, visible as a row
  When:  One thread is opened
  Then:  The row's aggregate pill goes 2 → 1 with no reload, and `GET /api/docs`'s `unreadThreads`
         for that document returns 1. Opening the PARENT document alone does not change the
         remaining count. The refresh path (which SSE key invalidates the aggregate) is STATED
```

#### The pending indicator, and resolve/reopen

```
TEST-84: The pending indicator escalates honestly, from the turn's timestamp
  Given: An outstanding agent response
  Then:  A `.working` row (hairline top border, `9px 0`, 12px, `var(--ink-3)`) with a pulsing 7px
         `.working-dot` shows `agent is working…`, then at 45 s `still working…`, at 3 m
         `still working — longer than usual`, at 15 m `still working — <elapsed>`. **RELOAD the page
         mid-wait**: the tier is preserved, because elapsed is computed from the requesting turn's
         timestamp and not from mount. No progress bar, no percentage, no token streaming exists
         anywhere in the tree — grep and quote

TEST-85: Reduced motion is respected
  Then:  Under `prefers-reduced-motion: reduce` the `.working-dot` does not animate — through
         `global.css`'s EXISTING guard block, extended, not re-declared elsewhere

TEST-86: Resolve and reopen work from both places and agree
  Then:  The card head's `✓ resolve` / `reopen` and the reader ⋯ menu's item both hit
         `POST /api/threads/{id}/resolve|reopen`, both update the card's status chip and styling
         live, and both are reflected in the file's `status` on disk. Resolving removes the thread
         from the Attention column live; reopening returns it
```

---

### UI-007: Anchored threads — highlights, comment-from-selection, chips ↔ margin cards

Ports `9010`–`9014`, primary `9012`; UI on `CORPUS_UI_PORT=5280`. **Wave B — evaluated on
integration with UI-006. 37 criteria.** The offset-mapping module is the crux: it is built from
UI-006's serializer and is tested first.

#### Integration with UI-006 (evaluated before anything else here)

```
TEST-87: The offset map is derived from UI-006's serializer, not a second one
  Then:  `apps/ui/src` contains exactly ONE markdown serializer. The offset map consumes a position
         TRACE that UI-006's serializer optionally emits — `{pmFrom, pmTo, mdStart, mdEnd}[]` — added
         to the existing module, not a parallel walk. Grep for a second serialization implementation
         and quote the empty result. This is the criterion wave B exists to enforce

TEST-88: The trace is computed with the serialization, and cached
  Then:  The trace is produced alongside the autosave serialization and cached keyed by document
         version — never recomputed per decoration or per render. The E2E log states the cache key
         and quotes a measurement showing N decorations cost one trace, not N

TEST-89: Highlights are decorations, and the proof is byte-level
  Then:  Highlights are a ProseMirror `Decoration.inline` set held in a plugin — never schema marks.
         The assertion: with every highlight rendered, `serialize(editor.state.doc)` is
         BYTE-IDENTICAL to the same document with no anchors loaded. And on disk after a full session
         of highlighting, expanding and replying, `git -C <ws> diff` on the document shows no
         `<span>`, no `class=`, no marker character anywhere in the body
```

#### The offset map

```
TEST-90: Markdown range → ProseMirror range, table-driven
  Then:  For fixture documents, a table of known markdown `[start, end)` ranges maps to the expected
         PM `{from, to}`. Cases, each present: a plain paragraph; inside `**bold**`; inside a nested
         list item; inside a fenced code block; across a paragraph boundary; adjacent to a `[[ref]]`;
         at document start; at document end; inside a blockquote

TEST-91: The inverse round-trips
  Then:  For every case above, PM → markdown → PM returns the original range. The inverse direction
         is what `selectorFromSelection` uses, so it is not optional

TEST-92: Syntax the serializer adds belongs to no text range
  Given: An offset landing inside `## `, `- `, `**`, a fence line, or a blockquote `> `
  Then:  It snaps to the nearest CONTENT boundary — deterministically, and the direction of the snap
         is stated. Only text-content runs are mapped

TEST-93: A `[[ref]]` is one atomic run
  Then:  An offset anywhere inside a ref's bracket form maps to the whole node's range, and
         commenting on a ref anchors the whole node

TEST-94: A range spanning blocks produces multiple decoration segments
  Then:  One decoration per block, never one crossing a block — ProseMirror inline decorations cannot
         span blocks. The segment count is asserted for a two-block and a three-block range

TEST-95: The map survives every construct in UI-006's fixture corpus
  Then:  The offset map's suite runs over the SAME fixtures as the round-trip suite. A fixture the
         serializer handles and the map does not is a fail
```

#### Rendering anchors

```
TEST-96: Server-resolved ranges become highlights
  Given: `GET /api/docs/{id}` returning anchors with `range: {start, end}` — character offsets into
         the returned `body`
  Then:  Each renders as an `.anchor-hl` span over the corresponding editor text:
         `var(--accent-wash)` background, 2px `var(--accent)` bottom border, `3px 3px 0 0` radius,
         `0 2px` padding, pointer cursor. Each carries `data-thread="<id>"`

TEST-97: The pip is a widget, and it shows the turn count
  Then:  A superscript `.anchor-pip` (10px mono, `var(--accent)` pill, `var(--bg)` text, 99px radius,
         `0 5px`, `margin-left: 3px`) sits at the range END as a `Decoration.widget` — never part of
         the text, never serialized. It shows the thread's turn count

TEST-98: Resolved threads read as resolved
  Then:  `.anchor-hl.resolved` has no background and a DOTTED `var(--ink-3)` bottom border, and its
         pip is `var(--ink-3)`. Resolving a thread flips both live via SSE

TEST-99: The UI never resolves an anchor itself
  Given: A document where the anchor's `exact` text appears three times
  Then:  The highlight sits where the SERVER's `range` says, and `apps/ui/src` contains no text
         search for anchor text — grep for `indexOf`/`search` against `selector.exact` and quote the
         empty result. The server owns the four-step resolution ladder (§6)

TEST-100: Overlapping anchors both render and click sensibly
  Given: Two anchors overlapping the same words
  Then:  Both decorations render; the pips sit SIDE BY SIDE, not stacked on top of each other; and
         clicking the overlapping region opens the INNERMOST (shortest) anchor's thread
```

#### Comment from selection

```
TEST-101: The comment popover is a composer, not a dialog
  When:  Text is selected and `💬 Comment` (UI-006's toolbar) is clicked
  Then:  A small composer popover opens anchored to the selection with a text input, an
         `◉ ask agent / ○ note only` toggle, and a submit. It registers in the escape layer registry
         at Popover priority so esc closes it without closing the reader

TEST-102: The selector is computed against the MARKDOWN, with the shipped shape
  Then:  Submitting computes `exact` from the markdown slice, `prefix` from ~32 characters before
         (clamped at 0) and `suffix` from ~32 after (clamped at length) — from the markdown SOURCE,
         not from DOM text, and with NO trimming or whitespace normalization, because the server's
         ladder matches literally first. The POST body is
         `{parent, selector: {exact, prefix, suffix}, body, requestsAgent}` — field names quoted from
         the network log and matched against `CreateThreadRequestSchema`

TEST-103: An empty or whitespace-only selection cannot create a thread
  Then:  The `💬 Comment` button is DISABLED for an empty or whitespace-only selection. No request is
         possible

TEST-104: The disk proof — §15 M3's gold path
  When:  A phrase is selected, a comment typed, `○ note only` set, and submit pressed
  Then:  Without a page reload: the highlight appears and a `💬 1 · user` chip appears. On disk: the
         PARENT's frontmatter gains an `anchors:` entry whose `exact`/`prefix`/`suffix` match what
         was sent; a thread file exists under `data/threads/` with `parent` and `anchor` set; both
         land in ONE auto-commit (`git show --stat` quoted); and `.corpus/queue/pending/` is EMPTY
         because it was note-only

TEST-105: Ask-agent creates the event
  When:  The same flow runs with `◉ ask agent`
  Then:  `.corpus/queue/pending/` holds a `comment.created` event naming the new thread id

TEST-106: The optimistic highlight paints, and rolls back
  Then:  The highlight appears before the response lands, under a client-side temp id, and the thread
         is optimistically inserted into the doc's query cache. On success the temp id is swapped for
         the server id (no flicker, no duplicate highlight). On a rejected mutation BOTH are removed
         and a toast fires

TEST-107: A comment mid-save is queued behind the in-flight PUT
  Given: An autosave PUT in flight
  When:  Comment is submitted
  Then:  The POST is issued only after the PUT resolves, so the selector is computed against the
         version the server has. Asserted with a delayed PUT and the network log's ordering quoted
```

#### Living with edits

```
TEST-108: Typing near a highlight just edits
  When:  Text is typed BEFORE, AFTER, and INSIDE a highlighted range
  Then:  No mode, no dialog, no prompt. Decorations remap through each transaction's `mapping` so the
         highlight follows the text locally, before any server round trip

TEST-109: The server's report is authoritative over the local mapping
  When:  The debounced PUT returns its `{remapped, orphaned}` report
  Then:  Decorations are REFRESHED from that report and it wins over the local mapping. A `setAnchors`
         meta rebuilds the set from server data; a stale response (older local revision) is IGNORED —
         asserted by delivering two responses out of order and checking the newer one survives

TEST-110: §15 M1's reconciliation semantics, seen through the UI
  Then:  Four sequences, each verified on screen AND in `git diff` on the parent's frontmatter:
         (a) insert before the range → highlight unchanged, `exact` unchanged, `prefix` refreshed;
         (b) insert after → highlight unchanged, `exact` unchanged, `suffix` refreshed;
         (c) edit inside → highlight follows, `exact` updated to the edited text;
         (d) delete the whole range → the thread ORPHANS

TEST-111: A deleted-then-retyped range does not flicker the thread away
  When:  The anchored text is deleted and immediately retyped before the debounce fires
  Then:  The decoration mapped to a zero-width range is RETAINED-but-hidden pending the server
         verdict rather than dropped, so the thread does not disappear and reappear

TEST-112: An orphaned anchor moves, live, with no reload
  When:  The server reports an anchor orphaned
  Then:  Its highlight disappears and its thread moves into the "detached threads" section below the
         body — no reload, no stale decoration left behind. The thread stays fully functional and its
         stored quote is still readable (§6: the selector is preserved byte-for-byte)

TEST-113: A deleted thread takes its highlight with it
  When:  A thread is deleted (⋯ menu, or its last turn per §6's cascade) — including from another
         client
  Then:  Its highlight and pip disappear live via SSE, the parent's frontmatter `anchors` entry is
         gone on disk, and no stale decoration remains. Asserted by grepping the DOM for the thread
         id afterwards
```

#### Adaptive placement

```
TEST-114: Narrow columns get chips at the anchor
  Then:  In a column reader, each anchored thread renders as a `.thread-slot` containing a collapsed
         `.t-chip` (10.5px mono, `var(--accent-ink)` on `var(--accent-wash)`, 99px radius, `3px 10px`,
         `var(--accent)` border on hover) positioned at the anchor's BLOCK. The label format is
         exactly the prototype's: `💬 <n> · <last author>` plus ` · resolved` when resolved.
         `.resolved-chip` renders `var(--ink-3)` on `var(--surface-2)`

TEST-115: Expanding a chip expands in place and marks seen
  When:  A chip is clicked
  Then:  `.thread-slot.expanded` shows the `.thread-card` and hides the chip; the thread is marked
         seen (ONE POST — UI-008's de-duplication); `–` (`.t-collapse`) collapses it back

TEST-116: Focus/wide switches to margin cards
  Then:  `.focus-inner` gains `.with-margin` and becomes a two-column grid `minmax(0,1fr) 300px`
         with a 30px gap; `.t-chip` is hidden; thread cards are absolutely positioned inside
         `.focus-margin` (`left: 0; right: 0; margin: 0; max-width: none`), each with the `::before`
         connector — a 23px hairline `var(--line-strong)` at `left: -23px; top: 16px`

TEST-117: The cascade is the prototype's algorithm, exactly
  Then:  Cards are measured against their anchor's vertical offset relative to the main column,
         sorted ascending by that offset, then walked: `y = max(top, lastBottom)`;
         `lastBottom = y + card.offsetHeight + 12`; and `margin.style.minHeight = lastBottom`.
         Threads with no anchor element fall to `lastBottom`. Asserted by unit test over synthetic
         offsets and heights: sorted, non-overlapping, 12px gutter, correct `minHeight`

TEST-118: The layout recomputes on every trigger that changes it
  Then:  Recompute fires on: first render, expand/collapse, a reply appended (height change), window
         resize, font load, and editor content height change — and is debounced to at most one per
         animation frame. Each trigger is exercised and the resulting positions checked

TEST-119: Zero anchors means no gutter
  Given: A document with no anchored threads
  Then:  `.focus-inner` does NOT gain `.with-margin`. An empty 300px column is the failure this
         catches

TEST-120: Margin overflow extends the margin, not the document
  Given: More total card height than document height
  Then:  `minHeight` on the margin extends the scroll region and the MAIN column does not stretch

TEST-121: Clicking a highlight opens its thread and marks it seen
  When:  An `.anchor-hl` is clicked
  Then:  In wide mode the margin card scrolls into view; in narrow mode the chip expands. Either way
         the thread is marked seen and its unread badge clears — verified against the row badge and
         the Attention column

TEST-122: The detached and whole-document sections, and the 💬 popover
  Then:  Whole-document threads (`anchor: null`) and orphaned threads are listed BELOW the body in
         their own sections, with `whole-document thread` / `standalone` head text in place of a
         quote. Separately: the reader header's `.comments-btn` (`💬 <n>`) opens `.comments-pop`
         listing this document's threads (serif-italic quote + mono meta) and clicking an entry jumps
         to its anchor. A locked document (§7) still renders highlights and still allows reading and
         REPLYING, but offers no selection toolbar and no comment creation
```

---

### UI-010: Global Ask/Capture composer + keyboard scheme

Ports `9015`–`9019`, primary `9017`; UI on `CORPUS_UI_PORT=5281`. **Wave B — evaluated on
integration with UI-008 and UI-009. 36 criteria.** P1, and the only P1 in the batch: if the sprint
runs short, this is what gets a second wave rather than what gets cut, because INFRA-008 depends on it.

#### Integration with UI-008 and UI-009 (evaluated before anything else here)

```
TEST-123: The composer reuses UI-008's units, and the proof is by identity
  Then:  Attachment intake is UI-008's hook, and the `@`/`/`/`[[` autocomplete is `@corpus/kit`'s
         component. `apps/ui/src` contains exactly ONE attachment-intake implementation and ONE
         trigger-detection implementation — grep, quote both empty results. A second copy passes
         every feature criterion below and fails this one

TEST-124: `↵` and `⇧↵` from the board go through `useOpenInColumn`
  Then:  Both use UI-009's `useOpenInColumn` with its resolution precedence — the same code path as
         the console's `↗ open` and search's `↵` (sprint-010's TEST-115). Exactly one implementation
         of scroll + flash + open exists

TEST-125: `⇧←`/`⇧→` calls UI-003's `moveColumn`, not a parallel implementation
  Then:  The keyboard column move calls the SAME `moveColumn(fromIndex, toIndex)` the drag reorder
         uses. Asserted against the shared function by test, not by two functions that agree
```

#### The compose overlay

```
TEST-126: Two ways in, one panel, focus in the textarea
  When:  The top-bar `＋ Ask / Capture` button (carrying its `c` `kbd` hint) is clicked, and
         separately `c` is pressed on the board
  Then:  Both open the compose overlay and focus lands in the textarea

TEST-127: The panel is the prototype's, computed
  Then:  An `.overlay` scrim plus `.search-panel.compose-panel` at `min(640px, 100vw - 48px)` with
         `12vh` top margin; a borderless serif 16px / line-height 1.55 textarea with
         `min-height: 110px`, `16px 18px` padding and `resize: vertical`; a `.pending-atts` strip;
         and `.compose-actions` (surface-2, top hairline, `10px 16px`) carrying 📎, the hint
         `@ agents · / skills · [[ refs · ⇧↵ newline`, then `Capture ⌘↵` (`.btn-capture`: 1px
         `var(--line-strong)`, `var(--ink-2)`, accent on hover) and `Ask ↵` (`.btn-ask`: accent fill,
         `var(--bg)` text, 8px radius, `6px 16px`, weight 600) — in that order

TEST-128: The placeholder is the prototype's two lines, exactly
  Then:  The textarea's placeholder is exactly
         `Ask the agent anything, or capture a thought…` then a newline then
         `@ routes to a subagent · / invokes a skill · [[ links a document · paste/drop files`.
         In `design/index.html` both lines are ONE placeholder attribute separated by `&#10;`;
         UI-010's issue file calls the second a separate "hint line". Whichever is implemented, the
         rendered text matches character-for-character and the E2E log states which structure was used

TEST-129: The panel carries `.overlay.open` so `isOverlayOpen()` tells the truth
  Then:  With the composer open, `isOverlayOpen()` returns true — because the panel's scrim carries
         `.overlay` AND `.open`, the selectors that function queries. Same for the cheat sheet.
         A composer that manages its own state and leaves the DOM signal false silently breaks every
         caller of that function (Open Conflict 7)

TEST-130: `↵` submits Ask, and the thread is real
  When:  A question is typed and `↵` pressed
  Then:  `POST /api/threads` fires with `parent: null` (or omitted), `selector: null`, the text as the
         first turn's body, and `requestsAgent: true` — body quoted from the network log. The
         overlay closes with a narrating toast. On disk: a thread file under `data/threads/` with
         `parent: null` and `agent: requested`, and `.corpus/queue/pending/` holding a
         `comment.created` event. The standalone thread row appears on the board IMMEDIATELY in the
         columns whose queries match it, with a pending-agent indicator

TEST-131: `⌘↵` submits Capture, and it is ONE call
  When:  A thought is typed and `⌘↵` pressed
  Then:  A single `POST /api/capture` fires — multipart, `{text, requestsAgent, files}` — returning
         `{docId, threadId, eventId}`. Exactly one request; composing a doc-create plus a
         thread-create client-side is the failure this catches. On disk: a document under
         `data/docs/inbox/`, an agent-requested WHOLE-DOCUMENT thread pointing at it, the filing
         event in the queue, and an auto-commit in `git log`. Both rows are on the board immediately

TEST-132: `Ctrl+↵` works where `⌘↵` is claimed
  Then:  On non-mac (and when the OS/browser swallows the chord) `Ctrl+↵` also submits Capture

TEST-133: `⇧↵` inserts a newline and never submits
  When:  Text is typed and `⇧↵` pressed
  Then:  A newline is inserted in the textarea and NO request is issued. Per sprint-010's
         Adjudication 8, `⇧↵` follows the prototype in every scope — newline in the compose
         textarea, "new list from search" in the search overlay, "open in full screen" on the board.
         All three are exercised in one session and the scope that consumed each press is stated
         (TEST-146 covers the precedence that makes this unambiguous)

TEST-134: Empty submit is impossible
  Given: No text and no attachments
  Then:  Both buttons are disabled and `↵` does nothing

TEST-135: A failed submit loses nothing
  When:  A submit fails
  Then:  The overlay STAYS OPEN with the text and attachment chips intact, plus an error toast

TEST-136: IME composition is never a shortcut or a submit
  Then:  A keystroke with `e.isComposing` true is ignored by both the shortcut layer and the submit
         handler. Asserted with synthesized composition events

TEST-137: Attachments work all three ways and land in the right place
  Then:  📎, clipboard paste and drag-and-drop (with the visible dropzone highlight) all produce
         `.att-chip` previews. Submitting with `↵` puts them on the created standalone thread's FIRST
         TURN; submitting with `⌘↵` puts them on the CAPTURE's filing thread. Verified under
         `.corpus/attachments/<threadId>/<ts>/` for each case, with the thread id checked against the
         right thread. An attachment-only submit is allowed

TEST-138: The three autocompletes work in the textarea
  Then:  `@` lists agent + subagents from `type: agent-def` documents, `/` lists `type: skill`, `[[`
         lists documents by title — the same kit component, the same `useDocs` type filters, as the
         thread composer

TEST-139: Very long text posts fine
  Given: A capture over 10 KB
  Then:  It posts, the textarea grows with `resize: vertical`, and the document on disk holds the
         whole text
```

#### The shortcut registry and the cheat sheet

```
TEST-140: One registry declares every binding once
  Then:  Every shortcut is declared as `{id, keys, match, scope, allowInInput?, group, description,
         run}` in a single module. Handlers are BOUND FROM the registry. A registry-integrity test
         asserts: unique ids; no two entries matching the same key in the same scope; every entry has
         a non-empty `description` and `group`

TEST-141: The cheat sheet is generated, provably
  Then:  Every registry entry renders exactly one `.kbd-row` in the `?` overlay, and a test adds a
         FIXTURE entry to the registry and asserts it appears without touching the component. A
         hand-maintained legend is the failure this catches

TEST-142: The cheat sheet is the prototype's panel
  Then:  `.kbd-panel` (`20px 24px`) with a mono uppercase `Keyboard` header (11px,
         `letter-spacing: .08em`, `var(--ink-3)`) and a `.kbd-grid` of `1fr 1fr` with `2px 30px` gap;
         each `.kbd-row` has a `.keys` group (`min-width: 92px`) of `<kbd>` chips (10.5px mono, 1px
         `var(--line-strong)` with a 2px bottom border, 4px radius, `1px 6px`) then a `.d` description
         in `var(--ink-2)`. `?` toggles it; `esc` closes it

TEST-143: The rendered legend covers §11's enumeration, item by item
  Then:  The cheat sheet's rows are cross-checked against SPEC.md §11's keyboard scheme AND the
         prototype's twelve rows (`↑↓` move rows / also j,k · `↵` open document · `⇧↵` open in full
         screen · `esc` close/back · `←→` switch column / also [,] · `⇧←⇧→` move column · `f` focus
         mode · `e` archive · `r` reply · `c` compose · `⌘K` search · `?` cheat-sheet). Any binding
         present in one and absent from the other is named in the E2E log

TEST-144: `?` does not stack overlays
  Then:  `?` is suppressed inside inputs; with a non-input overlay already open it is IGNORED rather
         than opening a second overlay. `⌘K` while the composer is open REPLACES it (one overlay at a
         time, UI-009's rule)
```

#### The full scheme

```
TEST-145: Every binding does what §11 says
  Then:  On the board with no overlay: `j`/`k` and `↑`/`↓` move the row cursor in the ACTIVE column
         with a visible `.row.kbd` outline, scrolling the cursor into view, and CLAMP at both ends
         (no wrap, and the board does not scroll); `↵` opens the highlighted document in its column;
         `⇧↵` opens it directly in FOCUS MODE; `←`/`→` and `[`/`]` switch the active column with a
         smooth `scrollIntoView` and clamp at both ends; `f` toggles focus mode on the open document;
         `e` archives; `r` focuses a reply composer; `?` opens the cheat sheet. Each is exercised
         through a real key event

TEST-146: `esc`/`⌫` precedence is exactly the spec's chain, and only the top layer consumes
  Given: A reader open, focus mode over it, the compose overlay over that, and a popover in that
  When:  Escape is pressed repeatedly
  Then:  Layers close in order — popover, overlay, focus, then the column reader (popping its nav
         stack, exiting to the list when the stack empties) — and each press closes EXACTLY ONE
         layer. Grep for a hard-coded `if (overlayOpen) … else if (focusOpen) …` and quote the empty
         result. `⌫` behaves identically outside inputs and is suppressed inside them

TEST-147: The active column follows focus and hover, visibly
  Then:  Exactly one column carries `.col.kactive` at a time (`box-shadow: 0 0 0 2px
         var(--accent-wash), var(--shadow-soft)`), and it follows keyboard navigation AND hover

TEST-148: `⇧→` writes `order` to disk through the shared path
  When:  `⇧→` moves a column
  Then:  The board reorders on screen, `cat` of the affected view documents shows updated `order`
         frontmatter, `git log -1` shows the auto-commit, the moved column STAYS active and is
         scrolled back into view, and reloading the browser preserves the new order. `⇧←` on the
         first column is a no-op

TEST-149: `r` finds a thread, expanding one if it must
  Then:  `r` focuses the reply composer of the open document's VISIBLE thread; when none is expanded
         it auto-expands the FIRST collapsed thread and focuses that composer. Per §7 the expansion
         marks that thread seen — which is intended, and the seen POST is observed and recorded. `r`
         on a document with zero threads is a no-op with a toast

TEST-150: `e` archives the right target and is honest when it can't
  Then:  With a reader open `e` archives the OPEN document; with no reader open it archives the row
         under the cursor. `status: archived` is verified in the file. On an already-archived
         document it is a no-op with a toast. `f` with no document open is a no-op — it does not open
         focus mode on nothing

TEST-151: Every handler is disabled inside every writing surface
  When:  `c`, `e`, `f`, `r`, `j`, `k` and `?` are typed into: the TipTap editor, the thread composer,
         the compose textarea, the search input, and the frontmatter title field
  Then:  All characters appear as text and NO shortcut fires — in all five surfaces. `⌘K` still fires
         in all five. Suppression checks `document.activeElement` for `INPUT`, `TEXTAREA`,
         `[contenteditable="true"]` and any ancestor with `[data-shortcuts="off"]` (the editor root
         sets it) — NOT `e.target` alone, because ProseMirror retargets

TEST-152: Shortcuts survive a board that changed under them
  Given: An SSE update removing the active column mid-keystroke
  Then:  The handler resolves defensively — no crash, no page error, and the active column falls back
         to a valid one

TEST-153: ⌘K is registered THROUGH the registry
  Then:  `SearchOverlay` no longer owns its own keydown listener for ⌘K; the binding lives in the
         registry with `allowInInput: true`. Exactly one ⌘K listener exists — grep and quote

TEST-154: The pending indicator appears on both flows for free
  Then:  Both Ask and Capture create agent-requested threads, so UI-008's `.working` indicator
         appears on the resulting row/thread without new code. Verified, not assumed — the issue file
         says "verify it does"

TEST-155: The optimistic row appears immediately and reconciles
  Then:  Per §11 both results appear on the board IMMEDIATELY — optimistically inserted into the
         matching columns and reconciled on the SSE-driven refetch. A row that appears only after the
         refetch fails this; a row that never reconciles (duplicates after refetch) also fails it

TEST-156: The toasts say what actually happened
  Then:  Ask toasts that a standalone thread was created; Capture toasts that the text went to
         `inbox/` and the agent will file it. Both claims are checked against disk. A toast claiming
         something the server did not do is the failure this catches

TEST-157: `c` inside the editor types a `c`
  Given: The TipTap editor focused
  When:  `c` is pressed
  Then:  The character is inserted and the composer does NOT open. (Restated separately from TEST-151
         because it is the single most likely regression in this issue)

TEST-158: Nothing in this issue is a second implementation of anything
  Then:  The E2E log lists, by name, the units UI-010 REUSED rather than rewrote: `useOpenInColumn`,
         `moveColumn`, UI-008's attachment intake, the kit autocomplete, `useEscapeLayer`, UI-008's
         pending indicator, and the existing archive mutation. Anything reimplemented is named with
         the reason
```

---

## Cross-Issue Tests

Ports `9020`–`9024`, primary `9022`; UI on `CORPUS_UI_PORT=5281`. One `corpus init` workspace, zero
stubs, real browser, real server, real CLI. **18 criteria.** These exist because this is the sprint
where the editor, its anchors, the conversation and the way in are all on screen at once, sharing one
serializer, one keyboard and one document.

```
TEST-159: §15 M4's gold path, end to end, in one unbroken act
  Given: A real workspace on 9022 with the seed columns
  When:  Omnibox-create a document (it lands in `inbox/`, opens title-selected) → type a paragraph →
         select a phrase → comment with `○ note only` → open the resulting thread → reply
  Then:  The file updates via autosave; the anchor survives the typing; the highlight and chip appear
         with NO reload; the thread appears in an Open-threads column; the reply lands in the thread
         file; and `git log` shows the squashed auto-commits. This is SPEC.md §15 M4's named
         Playwright check and it spans all four issues

TEST-160: One serializer, one autocomplete, one intake, one open-in-column, one escape chain
  Then:  `apps/ui/src` + `packages/kit/src` contain exactly one markdown serializer, one
         `@`/`/`/`[[` trigger-detection implementation, one attachment-intake implementation, one
         scroll+flash+open implementation, and one escape-precedence registry. Five greps, five
         quoted results. This is the criterion wave B exists to enforce and it is checked once, here,
         across all four worktrees merged

TEST-161: The document body survives a full session byte-clean
  When:  A session that types, bolds, adds a heading, inserts two refs, creates two anchors, expands
         both threads, replies to one, resolves the other, deletes a turn, and enters and leaves
         focus mode
  Then:  `git -C <ws> diff <first-commit>..HEAD -- <file>` shows ONLY the prose changes and the
         frontmatter `anchors` map. No `<span>`, no `class=`, no marker character, no reflowed list,
         no re-escaped emphasis, no whitespace-only hunk

TEST-162: The keyboard scheme does not fight the editor, the composer or the anchors
  When:  The full binding set is exercised with a document open, an anchor highlighted, a thread
         expanded and the compose overlay opened and closed
  Then:  Every writing surface swallows every letter shortcut; every navigation shortcut works
         outside them; `esc` unwinds popover → overlay → focus → reader in that order; and no
         shortcut fires twice from two listeners

TEST-163: Read state closes its loop across all four surfaces
  Given: A document with three threads, two unread, visible as a row
  When:  One thread is opened from its highlight, one chip is expanded in a narrow column, and the
         parent document is opened without expanding anything
  Then:  The first two clear their own badges and drop the row's aggregate 2 → 1 → 0 with no reload;
         the third changes nothing. `GET /api/docs`'s `unreadThreads` agrees at each step

TEST-164: An agent lock is respected by every writing surface at once
  Given: `corpus lock acquire <docId> --holder agent` on the open document
  Then:  The editor is read-only, the selection toolbar cannot open, comment creation is unavailable,
         AND highlights still render and threads are still readable and repliable (§6/§7 — replying
         to a thread is not editing the document). Force unlock restores all of it live

TEST-165: No document content ever crosses the SSE stream
  When:  The full `/events` capture from TEST-159…164 is grepped
  Then:  Zero matches for any document title, body text, turn body, anchor quote, form option,
         attachment filename or capture text. Every frame is `event: invalidate` with `keys` only,
         drawn from the closed 9-shape vocabulary. This is the sprint where four issues all had a
         reason to want data on the wire

TEST-166: No UI file bypasses the kit
  Then:  No file under `apps/ui/src` outside the provider wiring calls `fetch(` or imports from
         `@corpus/contract/client` — including the multipart paths, which are wrapped as named
         `CorpusClient` methods and named kit hooks. Grep for both and quote the results. The kit's
         newly added surface is listed by name in the E2E log

TEST-167: The production-served board carries all of it
  Given: `npm run build -w apps/ui`, then `corpus server start`
  When:  The board is opened at the URL the server prints — no Vite, no env var
  Then:  Editor, anchors, threads, composer and keyboard all work against real data with the injected
         token (SERVER-024's mechanism). This is what an installed user gets and it is the environment
         the UI evaluation should prefer

TEST-168: Generated artifacts green at the tip
  When:  `node --import tsx scripts/check-generated-artifacts.ts` runs on the phase branch tip
  Then:  Green TWICE IN A ROW for `openapi.json`, `schema.generated.ts` and `docs/cli.md`. If Open
         Conflict 2 produced a CONTRACT rider, this is where its regeneration is proven idempotent

TEST-169: The whole repo gate is green at the tip
  When:  `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck` and `npm test`
         run on the phase branch tip — as the ORCHESTRATOR's single harvest run, not duplicated by
         any agent or by the evaluator
  Then:  All pass. The test-file count is stated with the command that produced it and compared to
         the sprint-010 baseline

TEST-170: The merged coverage gate holds with the editor in it
  When:  `npm run coverage` runs on the phase branch tip
  Then:  All four metrics at or above 90. Per-workspace numbers recorded, and
         `coverage/merged/e2e-attribution.json` inspected. A ProseMirror editor is the single easiest
         place in this repo to add hundreds of branchy uncovered lines — the serializer and the
         offset map are where the coverage must actually be

TEST-171: e2e green at the tip with the reserved ports respected
  When:  `CORPUS_UI_PORT=5281 npm run e2e` runs with nothing bound on 8765
  Then:  All specs pass — the shipped set plus `editor.spec.ts`, `thread.spec.ts`, `anchors.spec.ts`
         and `compose-keyboard.spec.ts` — and the `"server unreachable"` assertion still holds
         (confirm 8765 free with `lsof` and say so). `.c-failed` / `.c-failed-jobs` assertions still
         pass unmodified

TEST-172: The four Playwright specs each cover their issue's §15-named check
  Then:  `editor.spec.ts` covers type → autosave → file updates → anchors survive → squashed commit;
         `thread.spec.ts` covers seen-on-display (expanding a chip counts, opening the parent does
         not), the comment flow and turn deletion; `anchors.spec.ts` covers select → comment
         ("note only") → highlight + chip without reload, plus before/after edits and the margin
         layout; `compose-keyboard.spec.ts` covers Ask, Capture, the keyboard sweep, the column move
         and the input-suppression check

TEST-173: The prototype comparison is done, side by side, once
  Then:  The editor chrome, the margin cards, the thread card, the composer, the compose panel and the
         cheat sheet are each compared against `design/index.html` in the same browser at the same
         zoom, and every deviation is either fixed or named in the E2E log with a reason.
         `design/index.html` is authoritative for look and feel (§11)

TEST-174: Light and dark both come from the token set
  Then:  No new hardcoded color literal appears in any CSS added by this sprint — every value is a
         `var(--…)` token from `packages/kit/src/tokens.css`. Both themes are screenshotted. Grep for
         hex literals in the new CSS and quote the result

TEST-175: PLAN.md tells the truth at the end
  Then:  `issues/PLAN.md` marks UI-005, UI-009 and UI-011 `done` (all three are committed at
         `f90c6a5` and still read `in_progress`/`todo` — Open Conflict 12), and UI-006, UI-007,
         UI-008 and UI-010 `done`, closing Phase 3

TEST-176: Nothing left running and the repo is clean
  When:  The sprint closes
  Then:  Nothing bound in `9000`–`9024`, nothing on `8765`, nothing on `5278`–`5281`, no orphaned Vite
         or Playwright children, no stray `vitest` workers (`ps aux | grep [v]itest`), every
         `/tmp/corpus-s011-*` path created here removed BY NAME (and every `/tmp/corpus-eval-s010-*`
         path left ALONE), and `git status` clean in every worktree and in the Corpus repository. Each
         issue's E2E log states which model the implementing agent ran on ("implemented on: opus |
         fable")
```

---

## Out of Scope

- **Any change to `packages/contract`, by a UI agent.** §9.3, restated from sprints 008, 009 and 010.
  Open Conflict 2 may produce a filed CONTRACT rider with a number in `issues/PLAN.md`; it is written
  by the contract agent and by nobody else.
- **New routes of any kind.** Everything this batch needs is mounted. A rider for Open Conflict 2
  would add a FIELD, not a route.
- **Streaming anything over SSE.** SPEC.md §2.2 rule 3 is absolute (TEST-165). No editor
  presence, no collaborative cursors, no live turn push.
- **Multi-user / collaborative editing.** Corpus is single-user (§6: "single-user system"). One
  editor, one lock, no OT, no CRDT, no awareness protocol.
- **The plugin registry and plugin `View` renderers.** PLUGINS-001. TEST-5 only asserts that a
  plugin-rendered type does not get the editor.
- **The publish plugin.** SPEC.md §13.
- **`corpus doc check`, `corpus skill rollback`, and any new CLI verb.** Phase 4. In particular there
  is still no CLI verb to mark seen, to answer a form, or to attach a file — those are exercised over
  HTTP or through the browser.
- **Skill/agent-def editing affordances beyond the ordinary editor.** §7 says skills are edited "in
  the normal editor" — which this sprint delivers by delivering the normal editor. Frontmatter
  validation on save is the server's, already shipped.
- **An error boundary.** Still absent, still nobody's in this batch — SPEC.md §10 requires one per
  plugin column, which is PLUGINS-001's. If a UI agent adds one opportunistically it says so.
- **Rewriting the e2e suite to drive a real server.** Still the standing recommendation from
  sprint-009's Open Conflict 12, still not a requirement. If declined, the reason is recorded.
- **Changing `BOARD_STATE_VERSION` again**, unless a criterion here demands new persisted local
  state. If one does, the bump lands in the same commit as the shape change (sprint-010's Conflict 8
  precedent) and is called out.
- **Optimizing the editor for very large documents.** UI-006's issue says it: do not add a worker
  preemptively. Profile if TEST-15 shows jank, record the number, move on.
- **Packaging.** INFRA-008, which depends on UI-010 and is the next thing after this sprint.

---

## Integration Points

**UI-006 produces → UI-007 consumes. This is the sprint's hard dependency.**

```
serialize(doc)                    → the single serializer, shared schema with parse()
serialize(doc, {trace: true})     → { markdown, trace: {pmFrom, pmTo, mdStart, mdEnd}[] }
                                    UI-007 adds the trace option to UI-006's module; it does not
                                    write a second serializer (TEST-87)
onComment(selection)              → the DocEditor prop UI-006 defines and stubs, UI-007 wires.
                                    Its payload shape is stated in UI-006's E2E log (TEST-31)
onReconciled({remapped, orphaned})→ the autosave callback UI-006 defines and publishes from the PUT
                                    response, UI-007 consumes as authoritative (TEST-109)
Revision tagging                  → each PUT carries a monotonic local revision so UI-007 can ignore
                                    a stale report. UI-006 owns the counter
```

**UI-008 produces → UI-007 and UI-010 consume.**

```
ThreadCard (bare | standalone | nested)  → UI-007 renders it in slots and margin cards
useAttachmentIntake                      → UI-010's compose overlay reuses it verbatim (TEST-123)
kit Autocomplete (@ / [[ )               → UI-006's [[ menu and UI-010's textarea both use it
PendingIndicator                         → UI-010's Ask/Capture rows get it for free (TEST-154)
markSeen wrapper + de-duplication        → UI-007 calls it on chip expand and margin visibility
                                           (UI-007's issue permits a thin local wrapper only if
                                           UI-008 has not landed; wave A means it has)
```

**UI-009 + UI-005 produce → UI-010 consumes.**

```
useOpenInColumn()      apps/ui/src/board/openInColumn.tsx — ↵ and ⇧↵ (TEST-124)
isOverlayOpen()        apps/ui/src/shell/Shell.tsx — reads `.overlay.open` from the DOM (TEST-129)
useEscapeLayer()       apps/ui/src/reader/useEscapeStack.ts, EscapeLayerPriority
                       { Reader: 0, Focus: 10, Overlay: 20, Popover: 30 } — UI-010's overlays
                       register at Overlay, UI-007's comment popover at Popover (Open Conflict 9)
moveColumn()           UI-003's reorder, via useColumnOrder — ⇧←/⇧→ (TEST-125)
useCreateInColumn()    the creation unit; the omnibox-create path TEST-159 exercises
```

**The kit is the shared file and three issues must write it.** `packages/kit/src/index.ts` and
`client/createCorpusClient.ts` are edited by UI-006, UI-008 and UI-010. Additions are disjoint in
content and adjacent in the file — **rebase those two files rather than serializing the issues**
(the sprint-010 resolution, which worked). What must land:

```
Needed by UI-006:  useSaveDoc / a save wrapper over the existing updateDoc, if the debounce state
                   machine wants its own hook. `updateDoc` itself already exists — do not add a
                   second client method for the same route
Needed by UI-008:  deleteTurn   (DELETE /api/threads/{id}/turns/{ts}, ts URL-encoded)
                   respondToForm(POST /api/threads/{id}/turns/{ts}/form)      ← Open Conflict 1
                   appendTurn multipart variant (wraps uploadTurn / buildTurnFormData)
                   createThread multipart variant (wraps uploadCreateThread)
                   Autocomplete component + its trigger detection
Needed by UI-010:  capture      (POST /api/capture — multipart only, wraps uploadCapture)
Needed by UI-007:  nothing new — useCreateThread already carries `selector`, and useDoc already
                   returns `anchors[].range`
Invariant:         all land as named CorpusClient methods + named hooks exported from
                   packages/kit/src/index.ts, following useAppendTurn's and useUpdateDoc's shape.
                   No file under apps/ui/src imports @corpus/contract/client (TEST-166)
```

**The reader is a shared file and three issues touch it.** `DocView.tsx` (UI-006 swaps the non-thread
body branch; UI-007 adds the decoration plugin and moves anchored slots inline; UI-008 replaces
`Turns.tsx`'s read-only list), `ThreadSlot.tsx` (**shipped by UI-005, claimed as new by both UI-007
and UI-008** — Open Conflict 11), `CommentsPopover.tsx` (UI-007 adds the jump-to-anchor behavior),
`Reader.css` / `FocusMode.css` (all three), and `global.css`'s reduced-motion guard (UI-008's working
dot, UI-007's flash — both EXTEND the existing block, neither re-declares it).

**`apps/ui/e2e/` gains four specs and shares one config.** `editor.spec.ts`, `thread.spec.ts`,
`anchors.spec.ts`, `compose-keyboard.spec.ts` — each owned by one issue, no shared file. But the
existing `reader.spec.ts` asserts read-only reader behavior that UI-006 changes; whoever breaks it
fixes it, and says so.

---

## Merge order (recommendation)

1. **Adjudicate Open Conflicts 1, 2, 3, 4, 8 and 11 before anyone starts.** 1 and 3 are "the shipped
   code already decided this" and shrink UI-008 and UI-006 before they read their issue files. 2 is
   the only blocking hole and may need a CONTRACT rider, which has a lead time. 8 and 11 are file
   layout and file ownership — a two-minute decision that otherwise costs two merge conflicts. None
   is discoverable cheaply mid-implementation.
2. **Wave A: UI-006 and UI-008 in parallel worktrees, launched staggered.** They are genuinely
   disjoint — UI-006 owns `DocView`'s non-thread body branch plus a new editor module; UI-008 owns
   the thread components, the kit's autocomplete and four new kit methods. They collide only on
   `packages/kit/src/index.ts` (adjacent lines) and `Reader.css`.
3. **Give UI-006 the serializer first and let UI-007 read it early.** UI-007's crux is the offset
   map, its first suite is the map's, and it needs the serializer's shape — not its completion.
   The moment UI-006's `markdown/` module has a settled schema and a passing round-trip suite,
   UI-007 can start against it even if autosave and the save chip are still in flight.
4. **Wave B: UI-007 and UI-010, capped at two concurrent agents.** UI-007 is the fable-tier issue in
   this batch (its Model recommendation says so, and correctly — the offset mapping and the adaptive
   layout are the hardest UI problems in the product). UI-010 is opus and is mostly composition.
5. **Only one e2e run at a time on this machine**, regardless of the four assigned dev ports, and
   never while the sprint-010 evaluator is mid-run. The orchestrator schedules them.
6. **Cross-issue tests (TEST-159…176) after everything**, on 9022, preferably against the
   production-served board (TEST-167).

The genuinely serialized edges are: UI-006's serializer → UI-007's offset map; UI-008's intake +
autocomplete → UI-010's composer; UI-008's `ThreadCard` → UI-007's slots and margin cards. Everything
else in this batch is parallel.

---

## Open Conflicts — orchestrator decision required before implementation

### 1. UI-008 builds the form answer by hand; the contract shipped a route for it (**blocking for TEST-72/73; resolution looks unambiguous**)

UI-008's Technical Design says: *"Submitting posts a structured answer turn whose body records the
chosen option and optional note in the canonical shape the server/CLI expects (a `form.respond` event
follows from the server side — the UI does not enqueue)."* Its acceptance criterion says the submit
*"appends a structured answer turn (chosen option + note) and results in a `form.respond` queue
event."*

The shipped contract has `POST /api/threads/{id}/turns/{ts}/form`
(`packages/contract/src/routes/forms.ts`), whose description says the server *"appends a structured
answer turn carrying the chosen option and any note, and enqueues a `form.respond` event that
re-triggers the agent like any engaged-thread reply"*, validates `option` against the offered options
(400 naming `body.option`), and 404s when the turn carries no form. `FormAnswerRequestSchema` and
`FormAnswerResponseSchema` exist. A UI that instead POSTs a hand-composed turn to `/turns` produces
**no `form.respond` event, no agent re-trigger, and no validation** — and the failure is invisible
until someone checks the queue directory.

**Blocking**: TEST-72 and TEST-73 cannot both be satisfied by the issue file's described mechanism.

### 2. The `committed · git ✓` chip state has no wire source (**the one genuinely blocking spec hole in this batch; P0 for UI-006**)

UI-006's acceptance criterion: *"the save chip reflects real state driven by the PUT lifecycle:
`saving…` → `saved · anchors ✓` when the response reports reconciliation → `committed · git ✓` when
the response reports the commit"*, and its Technical Design adds *"or after the server's
squash-on-idle signal arrives via SSE"*.

Neither source exists:

- `UpdateDocResponseSchema` is `{doc, anchors: {remapped, orphaned}, warnings}`. There is no commit
  field, no sha, no timestamp. `warnings` reports §14 problems (e.g. a git hook rejection) — it is
  evidence a commit did **not** land, not evidence one did.
- The SSE key vocabulary is **closed at nine shapes** and none of them means "a commit was written"
  or "the idle window elapsed and the commits squashed". `["docs", id]` fires on any mutation,
  including the user's own save, so treating it as a commit signal makes the chip advance on the
  echo of its own write.

The prototype's `.save-chip` has exactly two classes — `.saving` (`var(--sepia-ink)`) and `.saved`
(`var(--good)`) — which suggests two states, not three. **This needs a ruling before UI-006 starts**,
because TEST-17 and TEST-18 are written against whatever it is. The shapes of an answer, none of
which I am choosing:

- **Two states.** Drop `committed · git ✓`; the chip is `saving…` → `saved · anchors ✓`, matching the
  prototype's two classes. Cheapest, and honest.
- **Derive the third state from `warnings`.** Empty `warnings` on a 200 ⇒ the auto-commit landed.
  This is inference, not report, and it would be a claim the wire does not make.
- **File a CONTRACT rider** adding a commit report to `UpdateDocResponse` (the server already knows —
  it wrote the commit). One field, no new route, and it makes §4's squashing observable to the UI for
  the first time. This is the only option that makes the criterion literally true, and it has a lead
  time.

Whatever is chosen, §15 M4's named check — *"squashed auto-commit on idle per §4"* — is still
verified on disk in TEST-23 and TEST-159, so the milestone does not depend on this ruling.

### 3. UI-006 reads the lock from a field that does not exist, and says nothing about acquiring one (**P0**)

Two problems in one criterion.

**(a) The read side is simply wrong.** UI-006 says *"when `GET /api/docs/:id` reports an active
lock"*. `DocSchema` has no lock field. Lock state is `GET /api/locks` → `useLocks()` /
`useDocLock(docId)`, invalidated by `["locks"]` / `["locks", docId]`. `DocView.tsx` already does it
correctly and `LockBanner` already consumes it. This is a stale-text correction, cheap.

**(b) The write side is a genuine scope question nobody has answered.** SPEC.md §7: *"The user's
editor session holds the lock while actively editing (acquired via the server on first keystroke,
released on idle/close); the orchestrator defers edits to user-locked documents — the work stays
queued and applies when the lock clears."* UI-006 implements only the read-only-when-agent-holds
case. Nothing in this batch acquires a user lock on first keystroke. Without it, the agent has no way
to know the user is typing, and §7's deferral has nothing to defer on.

Related and unanswered: **what does typing do when the agent holds the lock?** The editor is
`editable: false`, so keystrokes are swallowed silently. The prototype's focus hint says *"click
anywhere to edit"*, which is a lie under a lock. Block silently, block with a nudge toward Force
unlock, or queue locally — three different products.

**Blocking for TEST-34**, which is written to accept either implementation or an explicit strike, but
not silence.

### 4. Who owns the document body now, and what happens to `remarkCorpusRefs` inside an editable surface

UI-005 shipped one body-render call site with two branches (`TurnList` for threads, `MarkdownView`
otherwise) and its E2E log recorded it as the seam UI-006 replaces. But "replace the seam" is
ambiguous in three ways:

- **`MarkdownView` does not go away.** UI-008 renders every turn body through it, and `remarkCorpusRefs`
  + `RefLink` are how a `[[ref]]` resolves to a live title anywhere outside the editor. The editor
  needs its **own** ref node (a ProseMirror node with `{id, alias}` attrs and a node view), because a
  remark plugin cannot run inside ProseMirror. **Two ref renderers will exist.** They must agree on
  broken-ref treatment, on alias handling, and on the title-resolution strategy (sprint-010's
  Adjudication 6: cache-deduped per-id `useDoc`). Which one is canonical, and does the editor's node
  view reuse `RefLink`?
- **A locked document is read-only. Does it render through the editor (`editable: false`) or through
  `MarkdownView`?** The former keeps highlights, decorations and scroll position and is what TEST-33
  assumes; the latter is simpler and loses all three at the lock boundary.
- **Does the editor live in `apps/ui/src` or `packages/kit`?** SPEC.md §10 names `MarkdownView` as
  part of the kit contract, and a plugin rendering an editable markdown body is a plausible §10
  consumer. UI-006's file list puts everything in `apps/ui`. Deciding late means moving a module.

Non-blocking for most criteria, but TEST-2 is written against whatever is decided.

### 5. Two owners for the title, and the frontmatter form got there first

UI-006: *"Editing the title heading writes the frontmatter `title` through the same debounced PUT"*,
and its file list adds a `.doc-title` field above the editor.

`FrontmatterForm` (UI-005, shipped) already renders the title, already takes `selectTitle` (the
omnibox-create path opens with the title selected — sprint-009's TEST-66 depends on it), already
takes `locked`, and already PUTs it. A second editable title means two debounces racing on one field
and two PUTs that can each clobber the other, and it would break `selectTitle`.

The prototype has it as `<h1 class="doc-title" contenteditable>` above the body — one element, and it
is not obviously either component's. **Cheap to decide, expensive to discover**: the failure mode is
a title that intermittently reverts.

### 6. `markThreadSeen` drops the honesty parameter on purpose, and UI-008's dedup must not add it back (**non-blocking; needs stating**)

`POST /api/threads/{id}/seen` accepts an optional `lastSeenTs` and returns
`{threadId, lastSeenTs, unread}`. The kit's `markThreadSeen(id)` sends no body, and its docblock
explains why: *"the kit's callers are surfaces that displayed a thread, and SPEC.md §7's rule is
displayed content only."*

UI-008 wants de-duplication *"per `(threadId, lastTurnTs)` pair"*, which is compatible — the pair is
the client-side key, not a request field. But an agent reading "MarkSeen honesty" and finding an
unused parameter will be tempted to send it, which would mean the UI asserting what the user read
rather than the server recording what was displayed. **Recommendation: state that the parameter stays
unused and the `unread` response field is what the UI trusts** (TEST-81 is written that way).

Separately and genuinely unverified: **which SSE key refreshes the `unreadThreads` aggregate.** A
seen POST invalidates the thread; the parent document row's aggregate lives on `DocRow`, which comes
from `["docs"]`. If the server does not broadcast `["docs"]` on a seen mark, TEST-83's "2 → 1 with no
reload" fails and the cause will look like a UI bug. **Worth confirming against the server before
UI-008 starts**, and if it does not, that is a SERVER rider, not a UI workaround.

### 7. The compose overlay must carry `.overlay.open` or it silently breaks `isOverlayOpen()`

`isOverlayOpen()` is `document.querySelector(".overlay.open") !== null` — a DOM query, not state.
UI-009 built it as the signal UI-010 asked for. If UI-010's compose panel or cheat sheet manages its
own React state and renders a differently-classed scrim, the function returns `false` while an
overlay is open, and every caller — the keyboard scope resolution, the search overlay's
one-at-a-time rule, anything added later — is silently wrong.

This is not a design question so much as a **contract that must be written down before four surfaces
depend on it**. TEST-129 pins it. Related: UI-009's rule is one overlay at a time; UI-010 adds two
more overlays and the cheat sheet's `?` must not stack on top of the composer (TEST-144).

### 8. All four issue files put code in `apps/ui/src/features/…`, which does not exist

The shipped tree is domain-foldered: `apps/ui/src/{app,board,console,dev,reader,search,shell,testing}/`
with colocated tests and CSS. Every file path in every one of the four issue files reads
`apps/ui/src/features/editor/…`, `features/threads/…`, `features/anchors/…`, `features/compose/…`,
`features/keyboard/…`.

Four agents in four worktrees will each invent `features/`, and the result is a repo with two
conventions and a merge that has to pick one. CLAUDE.md's Code Organization rule ("colocate by
component/feature") is satisfied by either. **Cheap decision, and it must be made once, up front, for
all four.**

### 9. UI-010 wants a scope stack for `esc`, and one already exists

UI-010's Technical Design: *"Esc precedence falls out of the scope stack: overlays push `overlay`,
focus mode pushes `focus`, an open reader pushes `reader`. `esc`/`⌫` is registered once per scope
with the scope-appropriate action; the topmost registration wins."*

That is a description of `useEscapeLayer`, which UI-005 shipped, which UI-009's overlay and UI-011's
drawer already register into, and whose priorities (`Reader: 0, Focus: 10, Overlay: 20, Popover: 30`)
already encode exactly that chain — sprint-010's TEST-114 verified it and its Conflict 9 assigned
ownership to UI-005 precisely so three issues would not each write their own.

A `ShortcutScopeProvider` that re-implements it is a second precedence chain, and TEST-146's grep for
a hard-coded conditional will not catch it because it will look principled. The question is a real
architectural one and I am not resolving it:

- **Registry owns non-esc keys; `useEscapeLayer` keeps `esc`/`⌫`.** Two mechanisms, clean seam, but
  the cheat sheet must render `esc` rows from a source that is not the registry — which weakens
  TEST-141's "generated, provably".
- **Registry owns everything and `useEscapeLayer` becomes its esc backend.** One source for the cheat
  sheet, but UI-010 refactors a shipped, verified mechanism that three other surfaces depend on, in a
  P1 issue, in wave B.

### 10. Three stale numbers and one stale field name in the issue files (**trivial, but each costs a debugging cycle**)

- **UI-008's edge case says ">10 MB" is the oversized-attachment threshold.** The shipped limits are
  **25 MB per file and 100 MB per request** (`apps/server/src/attachments/limits.ts`). A test written
  against 10 MB will not get a 413.
- **Every issue file calls the agent flag `agent`.** The wire field is **`requestsAgent`**, and it is
  **tri-state**: omitted ≠ `false`. `○ note only` must send an explicit `false`, because omitted means
  "enqueue if engaged" and would re-trigger the agent on exactly the threads where the user chose not
  to (TEST-52). This is the single most consequential naming slip in the batch.
- **UI-008's multipart turn field is `text`, not `body`.** The JSON form uses `body`; the multipart
  form uses `text`. Same for create-thread.
- **`ts` path parameters contain `:` and must be URL-encoded** — `2026-07-19T10%3A05%3A00Z`. The
  contract's own route description says so. Two routes take one (`DELETE …/turns/{ts}` and
  `…/turns/{ts}/form`).

### 11. `ThreadSlot.tsx` is shipped, and two issues claim to create it

`apps/ui/src/reader/ThreadSlot.tsx` exists (UI-005): it renders a collapsed chip and an expanded card
and already calls `useThread` and `useMarkThreadSeen`. `apps/ui/src/reader/Turns.tsx` exists: a
read-only turn list.

- **UI-007's file list**: "create `apps/ui/src/features/threads/ThreadSlot.tsx`" and
  `ThreadChip.tsx`.
- **UI-008's file list**: "create `apps/ui/src/features/threads/ThreadCard.tsx`", `TurnList.tsx`,
  `Turn.tsx`.

So UI-007 (wave B) and UI-008 (wave A) both plan to own the slot, and neither knows one exists. The
related question: **UI-005 renders every thread in a `.thread-slots` block below the body; UI-007
moves the anchored ones inline at their anchors and leaves whole-document and orphaned ones below.**
Who owns that region during the sprint, and what does it look like after UI-008 lands but before
UI-007 does?

**Recommendation shape** (not a resolution): UI-008 owns the card and the turn stream and replaces
`Turns.tsx`; UI-007 owns placement — the slot's position, the chip, the margin layout — and extends
`ThreadSlot.tsx` rather than replacing it. Somebody has to say so before wave B starts.

### 12. `issues/PLAN.md` still calls three landed issues unfinished (**bookkeeping, non-blocking**)

At `f90c6a5` the branch contains `[UI-005]`, `[UI-009]` and `[UI-011]` commits. `issues/PLAN.md` still
reads `in_progress` for UI-005 and UI-009 and `todo` for UI-011. A UI agent computing "what is ready"
from PLAN.md gets the wrong answer, and the sprint-010 evaluator running right now may report against
stale status. TEST-175 closes it at the end; correcting it at the start is free.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above has a verdict** in the evaluator's report — PASS, or
  `STRUCK → Open Conflict N` / `DEFERRED → <issue>` with the reason and substitute evidence recorded.
  Silent omission is a fail.
- **Every Open Conflict was adjudicated before implementation started**, and each adjudication is
  written back into the issue file it affects — not only into this contract. Conflicts 1, 3, 5 and 10
  correct stale issue-file text before the agent reads it. Conflict 2 either produces a filed CONTRACT
  rider with a number in `issues/PLAN.md` or produces a recorded, reasoned narrowing of UI-006's chip
  criterion. Conflicts 8, 9 and 11 are decided once and bind all four agents.
- **The editor is an editor**: a document opens editable with no mode (TEST-1), the round-trip is
  byte-identical across the fixture corpus (TEST-6), N edits are one PUT (TEST-15), the disk diff
  shows only the intended change (TEST-22), and a lock makes it read-only and back without losing
  scroll (TEST-32, TEST-33). Without these five, UI-007 has nothing to build on and the product has no
  writing surface.
- **The serializer is one serializer** (TEST-9, TEST-87, TEST-160). This is the criterion that makes
  UI-007 possible and the one whose violation is cheapest to commit and most expensive to unwind.
- **Anchors are decorations, provably** (TEST-89): with every highlight rendered, serialization is
  byte-identical, and a full session of anchoring leaves no markup on disk (TEST-161). SPEC.md §6's
  "the body stays clean — no inline markers" is a data-integrity guarantee, not a rendering
  preference.
- **§15 M4's named Playwright checks pass against the real app** (TEST-159, TEST-172): omnibox-create
  → type (file updates via autosave; anchors survive; squashed auto-commit on idle) → select text →
  comment ("note only") → highlight + chip appear without reload → thread appears in an Open-threads
  column; and open an unread thread → the badge clears everywhere, expanding a chip counts, opening
  the parent alone does not.
- **§6's reconciliation semantics are visibly honored through the UI** (TEST-110): edits before and
  after an anchored range keep it attached with refreshed context, an edit inside updates `exact`, and
  deleting the range orphans the thread with its selector preserved byte-for-byte.
- **The three destructive or irreversible acts are provably correct**: turn deletion arms before it
  fires, is user-only, and leaves git history intact (TEST-46, TEST-47); the cascade removes the
  thread AND the parent's anchor entry in one commit (TEST-48); and a failed upload posts nothing
  partial (TEST-69).
- **The agent flag is correct in every path** (TEST-52, TEST-53, TEST-105, TEST-130): `requestsAgent`,
  tri-state, with `○ note only` sending an explicit `false`. Verified against `.corpus/queue/pending/`
  and not from the request body alone.
- **The form answer goes through the form route and produces a real `form.respond` event**
  (TEST-72, TEST-73), with the payload `{threadId, formTs, option, note|null}` quoted from the queue
  file.
- **The keyboard scheme is generated from one registry, covers §11 item by item, and is silent inside
  every writing surface** (TEST-140, TEST-141, TEST-143, TEST-151, TEST-157).
- **Ask and Capture are each one call** (TEST-130, TEST-131) and both land on disk and on the board
  immediately with an honest pending indicator (TEST-154, TEST-155).
- **Nothing is a second implementation of anything** (TEST-160, TEST-158, TEST-166): one serializer,
  one autocomplete, one attachment intake, one open-in-column, one escape chain, and no `fetch(` or
  `@corpus/contract/client` import under `apps/ui/src`.
- **Each issue's E2E Verification Log is filled with concrete evidence** — actual commands, actual
  output, actual file/git/queue/SSE/browser state — and states which model the implementing agent ran
  on (TEST-176).
- **The logs carry the artifacts the next phase depends on**: UI-006's serializer API and trace shape,
  its `onComment` payload and its reconciliation callback (TEST-31, TEST-87); the kit's newly added
  methods and hooks (TEST-166); and the shortcut registry's entry shape.
- `npm run build` succeeds in dependency order; `/lint` passes (ESLint, Prettier, `tsc --noEmit`
  across all workspaces); `/test` passes with no regressions — as the orchestrator's single harvest
  run (TEST-169).
- **The merged coverage gate is green at 90 % on all four metrics** (TEST-170), with the serializer
  and the offset map actually covered rather than the gate carried by easier files.
- `CORPUS_UI_PORT=5281 npm run e2e` passes with **nothing bound on 8765** (TEST-171).
- `node --import tsx scripts/check-generated-artifacts.ts` is green **twice in a row** (TEST-168).
- **`/audit` has been run on UI-006** (P0, replaces the document body, owns the serializer every later
  issue depends on) and **on UI-008** (P0, largest surface in the batch, handles file uploads and
  user-only deletion). UI-007 is P0 and fable-tier; the orchestrator decides whether its size warrants
  a third audit.
- **Any user-observable behavior change carries its SPEC.md amendment**, drafted by spec-writer and
  held for user sign-off at the phase PR — SHARED-002's adopted process rule. In this batch the
  candidates are Conflict 2's save-chip claim (§11 says "autosave, no save button" and does not
  describe chip states), Conflict 3(b)'s user-lock-on-first-keystroke (§7 asserts it; nothing
  implements it), and whatever Conflict 5 decides about title ownership.
- **pr-reviewer verdict APPROVE** on the phase PR, with CRITICAL and MAJOR findings fixed or
  explicitly waived by the user.
- **No stray processes**: nothing bound in `9000`–`9024`, `8765` free, `5278`–`5281` free, the
  sprint-010 evaluator's `8985`–`8994` and `/tmp/corpus-eval-s010-*` untouched, no orphaned Vite,
  Playwright or vitest children, and `git status` clean in every worktree and in the Corpus repository
  (TEST-176).
- **Phase 3 is closed in `issues/PLAN.md`** — all eleven UI issues `done` (TEST-175) — and the phase
  PR is cut, babysat to green CI, reviewed and merged.

## Orchestrator Adjudications (2026-07-28)

Binding rulings on the Open Conflicts. Implementing agents follow these; the evaluator evaluates
with them.

1. **Conflict 2 (save chip): two states, no rider.** The server commits synchronously inside the
   mutation pipeline (SERVER-005) — a `PUT` that has answered IS committed, so `.saving`/`.saved`
   are the only states and the `.saved` copy may truthfully read `committed · git ✓`. No commit
   field is added to the wire. If an implementing agent finds the auto-commit is actually
   asynchronous, STOP and escalate — do not infer from `warnings`.
2. **Conflict 1 (form answers): the contract's form endpoint is mandatory.**
   `POST /api/threads/{id}/turns/{ts}/form` (CONTRACT-007/SERVER-016) — it is what produces the
   `form.respond` event and the §8 re-trigger. UI-008's issue-file text about composing an answer
   turn by hand is struck. URL-encode the `ts` path param.
3. **Conflict 3 (locks).** (a) Lock state reads via `useLocks`/`useDocLock` + `["locks"]` keys —
   `GET /api/docs/:id` has no lock field; `DocView.tsx` is the working example. (b) **UI-006 owns
   §7's user-side acquire**: acquire on first local keystroke, heartbeat while focused, release on
   blur/idle — through the existing locks API (add the missing kit client methods additively if
   `acquire`/`release`/`heartbeat` aren't surfaced yet). (c) Under a foreign (agent) lock the
   editor renders `editable: false` behind the LockBanner (which already offers the break-lock
   affordance); typing does nothing. No silent local queueing — an invisible buffer that may be
   discarded is worse than a visibly read-only page.
4. **Conflict 8 (paths): there is no `features/` directory.** Domain folders beside the existing
   ones: `apps/ui/src/editor/` (UI-006), `apps/ui/src/thread/` (UI-008), `apps/ui/src/anchors/`
   (UI-007), `apps/ui/src/compose/` (UI-010). The four issue files' `features/*` lists are
   corrected in place.
5. **Conflict 11 (ThreadSlot/Turns): UI-008 owns them.** They shipped in UI-005 as scaffolding;
   UI-008 (wave A) evolves them into the real thread view. UI-007 (wave B) consumes them through
   props/slots and does not rewrite them.
6. **Conflict 9 (shortcut scopes): struck — one chain.** UI-010 registers into UI-005's
   `useEscapeLayer` (extending `EscapeLayerPriority` additively if it needs a slot). No
   `ShortcutScopeProvider`, no second precedence chain.
7. **Conflict 4 (body ownership): the editor owns the document body, always.** A locked or
   read-only document renders through the editor at `editable: false` — never a MarkdownView
   fallback for document bodies (one surface, one scroll/selection model). `MarkdownView` remains
   the renderer for non-document bodies (turns, snippets). Two render paths for `[[ref]]` are
   accepted ONLY if both consume kit's `parseRefs`/`refIds` — the parse stays single-sourced.
8. **Conflict 5 (title): FrontmatterForm keeps the title.** Sprint-009's `selectTitle` behavior
   and the `locked` wiring depend on it. UI-006's editor is body-only; its second title surface is
   struck.
9. **Conflict 7 (`isOverlayOpen`)**: UI-010's compose panel and cheat sheet carry the
   `.overlay.open` classes (and register at `Overlay` escape priority), with a comment naming the
   DOM-query contract.
10. **Conflict 6 (read state)**: client-side dedup stays without `lastSeenTs` (the kit docblock's
    reasoning stands). The server half is VERIFIED, not deferred: `threads/seen.ts:133` already
    broadcasts `[DOCS_KEY, docKey(id), threadKey(id)]` + the parent's `docKey` — TEST-83's
    aggregate refresh has its wire signal today; no rider.
11. **Conflict 10 (stale values)**: 25 MB/file + 100 MB/request; `requestsAgent` is tri-state and
    `○ note only` sends explicit `false` (omitted means "enqueue if engaged"); multipart's text
    field is `text`; `ts` path params URL-encoded. Corrected in the issue files.
12. **Conflict 12 (PLAN drift)**: statuses flip only after the sprint-010 evaluator returns (the
    standing rule); the running evaluator has been told UI-005/009/011 are committed at f90c6a5.
13. **`⇧↵` (three scopes)**: follows the prototype in every scope — compose textarea: newline;
    search overlay: save-as-view/new list; board: open-in-full-screen. The active escape layer
    decides which scope owns the keystroke; TEST-133 stands as written.

## Wave-B Addendum (orchestrator, 2026-07-28 — post wave A)

1. **Autocomplete (TEST-59 reinterpretation).** Wave A legitimately produced two trigger
   detectors: kit's textarea caret-scanner (`detectTrigger`, UI-008) and UI-006's ProseMirror
   `@tiptap/suggestion` plugin — the mechanisms are genuinely different and neither can absorb
   the other. The ruling: **one menu (`AutocompleteMenu`) and one matcher, both in kit; exactly
   two trigger detectors, each native to its surface.** UI-010 unifies presentation: its composer
   uses the kit pieces, and if `.ac-menu`/`.ac-item` CSS moves to kit, UI-006's added states
   (`.on`, `.ac-empty`, `.k`, `.d`) move with it. The evaluator greps for menu/matcher
   singularity, not detector singularity.
2. **Sprint-text correction**: the lock CLI flag is `--from` (there is no `--holder`) — TEST-34
   verifies with `corpus lock list` / `--from`.
3. **Rider chores for UI-010** (one-liners flagged by other agents, same domain):
   `apps/ui/src/thread/parseFormBlock.ts` imports `FORM_ANSWER_LABEL` from `@corpus/contract`
   and deletes its local copy (CONTRACT-013 landed the contract side).
4. **UI-007 heads-up**: `EditorSelection.range/selector` are *located, not mapped* — `null` when
   the selection spans markup the body spells differently; never treat `null` as a bug. The
   position↔offset map is UI-007's own crux (`markdown/serialize.ts` is the emission trace to
   derive it from). `DocEditor.onEditor` publishes the live instance for decoration plugins;
   `onAnchors` fires each save with `{remapped, orphaned, warnings}`.
