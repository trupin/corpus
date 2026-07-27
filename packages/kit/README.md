# `@corpus/kit`

The plugin contract (SPEC.md §10). Plugin UI imports **only** from `@corpus/kit`
— never from `@corpus/contract`, never from `apps/ui`, never `fetch` directly.

Two entry points:

| Import                   | What it is                                                                     |
| ------------------------ | ------------------------------------------------------------------------------ |
| `@corpus/kit`            | The runtime contract: client, provider, hooks, key builders, types             |
| `@corpus/kit/tokens.css` | The design tokens (light/dark). CSS has no compile step, so it is a stylesheet |
| `@corpus/kit/testing`    | Test doubles: `FakeEventSource`, `createCorpusTestHarness`                     |

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

## Query keys

Keys are hierarchical arrays, and invalidation is **prefix-matched**: a frame
naming `["docs"]` invalidates every entry whose key starts with `"docs"`. Build
keys with the exported builders; never write a literal.

| Key                             | Builder                | Emitted by                                                                                | Refetched by                         |
| ------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| `["docs"]`                      | `DOCS_KEY`             | every document or thread mutation, and every out-of-band file change the watcher projects | every `useDocs` variant              |
| `["docs", <canonical>]`         | `docsListKey(filter)`  | — (a client-side collection variant; reached through the `["docs"]` prefix)               | that `useDocs` call                  |
| `["docs", "<docId\|threadId>"]` | `docKey(id)`           | a mutation of that one document; a thread mutation for both the thread and its parent     | `useDoc(id)`                         |
| `["threads", "<threadId>"]`     | `threadKey(id)`        | thread creation, turn append, turn deletion, resolve/reopen, mark-seen                    | `useThread(id)`                      |
| `["tree"]`                      | `TREE_KEY`             | anything that changes the folder hierarchy                                                | `useTree()`                          |
| `["queue"]`                     | `QUEUE_KEY`            | every queue transition (SPEC.md §7)                                                       | the console's depth and halted state |
| `["jobs"]`                      | `JOBS_KEY`             | every queue transition, plus any job-log append (coalesced)                               | every `useJobs` variant              |
| `["jobs", <canonical>]`         | `jobsListKey(params)`  | — (a client-side variant under the `["jobs"]` prefix)                                     | that `useJobs` call                  |
| `["jobs", "<eventId>"]`         | `jobKey(eventId)`      | an append to that job's log, and its retry/abandon transitions                            | the console's live log panel         |
| `["locks"]`                     | `LOCKS_KEY`            | lock acquire, release, force-break, reap                                                  | `useLocks()`                         |
| `["locks", "<docId>"]`          | `lockKey(docId)`       | acquire/release/force-break/reap of that one document's lock                              | the open reader's holder banner      |
| `["health"]`                    | `HEALTH_KEY`           | **nothing server-side.** The SSE bridge invalidates it on every drop and every reconnect  | `useHealth()` — the console strip    |
| `["x", "<plugin>", …]`          | `pluginKey(plugin, …)` | whatever the plugin's server routes emit                                                  | the plugin's own queries             |

The first eleven core shapes come from `@corpus/contract`'s published
vocabulary, whose set is closed and pinned by a test upstream, and are
re-exported here rather than restated — a rename there is a compile error here,
not a cache that silently stops updating. `["health"]` and the `x/` namespace
are the kit's own, because the contract publishes what the _server_ emits and
the server emits neither.

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
