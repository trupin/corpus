# `@corpus/kit`

The plugin contract (SPEC.md §10). Plugin UI imports **only** from `@corpus/kit`
— never from `@corpus/contract`, never from `apps/ui`, never `fetch` directly.

Three code entry points, and the stylesheets:

| Import                                                                     | What it is                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@corpus/kit`                                                              | The runtime contract: client, provider, hooks, key builders, components, types                    |
| `@corpus/kit/plugin`                                                       | The manifest surface: `definePlugin`, `PluginManifest`, `ColumnComponentProps`, `DocPanelProps`   |
| `@corpus/kit/testing`                                                      | Test doubles: `FakeEventSource`, `createCorpusTestHarness`                                        |
| `@corpus/kit/tokens.css`                                                   | The design tokens (light/dark). CSS has no compile step, so it is a stylesheet, not an export     |
| `@corpus/kit/row.css`, `/markdown.css`, `/autocomplete.css`, `/weight.css` | The anatomy stylesheets for the components that need one — import the sheet next to the component |

## The kit is the only data path

Everything that talks to the workspace server goes through this package. That is
not a style preference — it is what makes the board's live updates work at all.
The server never pushes data; it announces which **query keys** went stale and
the client refetches over plain HTTP (SPEC.md §2.2 rule 3). A component that
fetched on its own would cache under no key at all, and nothing would ever tell
it that its data had changed.

So:

```tsx
import { CorpusProvider, createCorpusClient, useDocs } from "@corpus/kit";
import "@corpus/kit/tokens.css";

const client = createCorpusClient({ baseUrl: window.location.origin, token });

<CorpusProvider client={client}>
  <Board />
</CorpusProvider>;

function Board() {
  const docs = useDocs({ type: "note", tag: ["finance"] });
  …
}
```

**The kit never sources its own credentials.** `createCorpusClient` takes
`{ baseUrl, token }` as configuration and reads no file, no cookie and no
environment variable. Provisioning belongs to whoever mounts the provider — in
this repo, `apps/ui/src/app/apiClient.ts`.

## What else is in here

Beyond the data path, the kit ships the pieces that make a plugin column look
native (SPEC.md §10) — each with its stylesheet as a subpath beside it:

| Family                | Exports                                                                                                                                       | Stylesheet         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Rows                  | `Row` (and the `ListItem` seam a plugin replaces), `AgeChip`, `UnreadBadge`, `NeedsYouBadge`, `WorkingDot`, `stalenessLevel`, `useRowActions` | `row.css`          |
| Markdown              | `MarkdownView`, the `[[ref]]` grammar (`parseRefs`, `remarkCorpusRefs`), `CorpusImage`, `ImageViewerProvider`                                 | `markdown.css`     |
| Smart input           | `useAutocomplete`, `AutocompleteMenu`, `handleAutocompleteKeyDown` — the one `@` / `/` / `[[` implementation                                  | `autocomplete.css` |
| Composer key contract | the `↵` / `⌘↵` / `⇧⌘↵` handling every composer obeys                                                                                          | —                  |
| Weight                | `WeightPicker`, `useComposerWeight`                                                                                                           | `weight.css`       |

`src/index.ts` is the authority on the surface and says why each export is on it;
this table is a map, not a census.

## Query keys

Keys are hierarchical arrays, and invalidation is **prefix-matched**: a frame
naming `["docs"]` invalidates every entry whose key starts with `"docs"`. Build
keys with the exported builders; never write a literal.

| Key                               | Builder                 | Emitted by                                                                                                                                                                                                            | Refetched by                                                                                 |
| --------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `["docs"]`                        | `DOCS_KEY`              | every document or thread mutation, and every out-of-band file change the watcher projects                                                                                                                             | every `useDocs` variant                                                                      |
| `["docs", <canonical>]`           | `docsListKey(filter)`   | — (a client-side collection variant; reached through the `["docs"]` prefix)                                                                                                                                           | that `useDocs` call                                                                          |
| `["docs", "<docId\|threadId>"]`   | `docKey(id)`            | a mutation of that one document; a thread mutation for both the thread and its parent                                                                                                                                 | `useDoc(id)`                                                                                 |
| `["docs", "<docId>", "related"]`  | `relatedKey(id)`        | — (under `docKey(id)`, so both that document's frames and bare `["docs"]` reach it)                                                                                                                                   | `useRelatedDocs(id)`                                                                         |
| `["docs", "search", <canonical>]` | `searchKey(params)`     | — (a client-side variant under the `["docs"]` prefix)                                                                                                                                                                 | `useCorpusSearch(params)`                                                                    |
| `["threads", "<threadId>"]`       | `threadKey(id)`         | thread creation, turn append, turn deletion, resolve/reopen, mark-seen                                                                                                                                                | `useThread(id)`                                                                              |
| `["tree"]`                        | `TREE_KEY`              | anything that changes the folder hierarchy                                                                                                                                                                            | `useTree()`                                                                                  |
| `["queue"]`                       | `QUEUE_KEY`             | every queue transition (SPEC.md §7)                                                                                                                                                                                   | the console's depth and halted state                                                         |
| `["jobs"]`                        | `JOBS_KEY`              | every queue transition, plus any job-log append (coalesced)                                                                                                                                                           | every `useJobs` variant                                                                      |
| `["jobs", <canonical>]`           | `jobsListKey(params)`   | — (a client-side variant under the `["jobs"]` prefix)                                                                                                                                                                 | that `useJobs` call                                                                          |
| `["jobs", "<eventId>"]`           | `jobKey(eventId)`       | an append to that job's log, and its retry/abandon transitions                                                                                                                                                        | the console's live log panel                                                                 |
| `["index"]`                       | `INDEX_KEY`             | the embed worker's state transitions and throttled drain progress; rebuild start/end                                                                                                                                  | the console strip's index pill                                                               |
| `["agents"]`                      | `AGENTS_KEY`            | designating or releasing a thread's resident, a thread's resolution releasing one with it, and every change to a lane's liveness — a scoped `idle` parking, its hold ending, and a lane lapsing past the grace window | `GET /api/agents` — the composer's recipient picker and every surface showing who is running |
| `["health"]`                      | `HEALTH_KEY`            | **nothing server-side.** The SSE bridge invalidates it on every drop and every reconnect                                                                                                                              | `useHealth()` — the console strip                                                            |
| `["attachments", "<target>"]`     | `attachmentKey(target)` | **nothing.** Attachment bytes are immutable once stored, so nothing ever invalidates them                                                                                                                             | `useAttachment(target)`                                                                      |
| `["x", "<plugin>", …]`            | `pluginKey(plugin, …)`  | whatever the plugin's server routes emit                                                                                                                                                                              | the plugin's own queries                                                                     |

There is no lock key, and there never will be one: the per-document edit lock is
gone (SPEC.md §7 "A key, not a lock"), and with it `LOCKS_KEY`, `lockKey`,
`useLocks` and the holder banner they fed. Nothing is acquired, held, released or
broken, so there is no state for a query key to name. What replaced it is the
**document key** below — carried on the document itself, not in a cache entry of
its own.

The eight core shapes come from `@corpus/contract`'s published
vocabulary, whose set is closed and pinned by a test upstream, and are
re-exported here rather than restated — a rename there is a compile error here,
not a cache that silently stops updating. `["health"]` and the `x/` namespace
are the kit's own, because the contract publishes what the _server_ emits and
the server emits neither.

The two retrieval shapes are the kit's own for a different reason: the contract's
vocabulary is closed, and ranked search and a related set need no name of their
own in it. Both hang **under the `["docs"]` prefix** the server already emits on
every mutation, so prefix matching invalidates them for free — a `[[ref]]`
appearing anywhere refreshes an open related panel with no new frame, no contract
change and no artifact regeneration (sprint-022 Open Conflict 7).

### Two spellings that matter

`["docs", id]` and `["threads", id]` — **plural**. A kit built on `["doc", id]`
/ `["thread", id]` type-checks, passes every unit test, and then caches under
keys no `invalidate` frame ever names.

### Filter canonicalisation

`useDocs(filter)` caches under `["docs", canonicalFilter(filter)]`. The
canonicaliser drops `undefined`, `null`, `""`, empty arrays and empty nested
objects; sorts object keys; and sorts array members. Two calls with logically
identical filters therefore share one cache entry and issue one request — a
column re-rendering its filters in a different order must not double the
request rate. Filters the kit does not recognise are **preserved and
forwarded**, so the contract can grow a query parameter without a kit release.

### Plugin keys

```ts
pluginKey("todos", "board"); // ["x", "todos", "board"]
```

Plugin keys travel through exactly the same invalidation path as core keys — the
bridge does not allowlist the core shapes, so a server route that emits
`["x","todos","board"]` refetches the plugin's query with no kit change.

## Writes present a key

Two writers share every document — the person at the board and the agent — and
they are kept from overwriting each other by a **key**, not a lock (SPEC.md §7).
A plugin that replaces a document's body is one of those writers and takes part
in exactly the same mechanism.

- **Every document read carries its key.** `key` is a field of `Doc`, so a
  writer reads one off the document it read.
- **A body replacement must present it.** `PUT /api/docs/{id}` requires `key`
  when — and only when — the patch carries `body` (the contract's
  `KEYED_UPDATE_FIELDS`, and a `400` if you omit it). A **delta** write names
  what it changes — `tags`, `status`, `due`, `archived`, the §11 view keys — and
  needs no key at all, because it merges instead of overwriting.
- **A refusal is a `409` with `code: "stale_key"`, never a bare "no".** It
  carries the document _as it now stands_, whose own `key` is the fresh one.
  `staleKeyDoc(error)` parses that payload with the contract's schema and returns
  the document — or `null` for a `409` this build does not recognise, so an
  unfamiliar refusal can never be mistaken for one you know how to retry.
- **A refusal is not a lost edit.** Nothing was written, and what you tried to
  save is still yours to re-send: adopt the fresh key and retry with the _same_
  buffer.

```ts
import { staleKeyDoc } from "@corpus/kit";

try {
  await updateDoc.mutateAsync({ body, key });
} catch (error) {
  const fresh = staleKeyDoc(error);
  if (fresh === null) throw error;
  await updateDoc.mutateAsync({ body, key: fresh.key }); // same body, new key
}
```

`apps/ui/src/editor/useAutosave.ts` is the in-repo implementation of that loop,
and the reason a conflict arriving mid-sentence costs a round trip rather than a
sentence. There is nothing to acquire before writing and nothing to release
after, so a plugin that crashes mid-edit wedges no document, and no surface ever
renders read-only (SPEC.md §11).

## Live updates

`CorpusProvider` opens **one** `EventSource` on `/events` and keeps it open. The
token travels as a query parameter because `EventSource` cannot set headers.

- **Frames.** Only `event: invalidate` with `{"keys": [[…], […]]}` exists.
  Parsing is the contract's (`createEventStream` validates with
  `InvalidatePayloadSchema`); the kit adds no second parser. A malformed frame
  is logged and dropped — never thrown, and never treated as a disconnect.
- **Coalescing.** Keys are batched for `DEFAULT_BATCH_WINDOW_MS` (50 ms), so an
  agent editing twenty files causes one refetch per key rather than twenty.
- **Reconnect.** A dropped stream is retried with jittered exponential backoff
  (`DEFAULT_BASE_DELAY_MS` 500 ms → `DEFAULT_MAX_DELAY_MS` 30 s, half-to-full
  jitter, never zero). On every reconnect — and never on the first connect — the
  bridge calls `refetchQueries({ type: "active" })`: while disconnected it
  cannot know which keys changed, so refetching what is on screen is the only
  correct recovery.
- **Health.** Both transitions invalidate `HEALTH_KEY`, so a console strip whose
  query is `staleTime: Infinity` still converges in both directions.
- **State.** `useConnectionState()` returns `connecting | open | reconnecting`.
  Surface it: a UI that cannot say "reconnecting" looks exactly like one that is
  up to date.

### One provider per application

Each `CorpusProvider` owns its own `EventSource` and its own cache, so two
mounted providers are two connections. That is legitimate in a test harness or a
component gallery and a bug in an application. The kit cannot forbid it without
breaking the harness case, so a second concurrent mount is reported through the
provider's `logger` (`console` by default); `mountedCorpusProviders()` exposes
the count.

## Optimistic turn append

`useAppendTurn(threadId)` writes the user's turn into the `["threads", id]`
cache immediately, marked `pending: true` so a view can render it differently,
and reconciles by **turn timestamp**: timestamps are unique and monotonic within
a thread (SPEC.md §6), so a confirmed turn by the same author at or after the
provisional's timestamp _is_ the provisional one. A failed mutation restores the
pre-mutation snapshot and rethrows.

The provisional turn also lives in a provider-level store that `useThread`'s
`queryFn` re-merges, which is what lets it survive an `invalidate` frame landing
before the mutation settles.

## Testing kit consumers

There is no `EventSource` in Node (gated behind `--experimental-eventsource`) or
in jsdom, so every test injects one:

```tsx
import { createCorpusTestHarness } from "@corpus/kit/testing";

const harness = createCorpusTestHarness({ fetch: myFetchDouble });
render(<MyPluginPanel />, { wrapper: harness.Wrapper });

harness.eventSource.latest().emit("open");
harness.eventSource.latest().invalidate(["x", "todos", "board"]);
```

`harness.eventSource.sources.length` is the number of connections opened — the
direct way to assert that mounting more hooks does not open more streams.

One environment caveat worth knowing: jsdom implements `AbortSignal` while
leaving `fetch`/`Request` to Node, so the two are different realms and
`new Request(url, { signal })` throws there. The client probes once and skips
the signal under jsdom; query cancellation is live in the browser, where there
is actually something on the wire to cancel.
