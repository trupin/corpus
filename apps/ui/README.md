# `@corpus/ui`

The board (SPEC.md §11). React 19 + Vite, served statically by the workspace
server in the installed tool and proxied through the Vite dev server in
development.

All data access goes through `@corpus/kit`. Three files here know a transport
exists: `src/app/apiClient.ts` (builds the client), `src/app/App.tsx` (mounts the
one `CorpusProvider`), and `src/abandon/unloadClient.ts`, which builds a second
client from the same factory with `keepalive: true` — the only way a `DELETE`
issued from `pagehide` outlives the document that issued it.

## Running the dev server

```sh
npm run dev -w apps/ui
```

Vite serves on `5173` and proxies `/api`, `/attachments` and `/events` to
`127.0.0.1:8765`, the workspace server's documented default. **That default
belongs to the `dev` script, not to the Vite config**: `vite.config.ts` proxies
nothing unless `CORPUS_SERVER_ORIGIN` names a target, so no other entry point can
reach a workspace server by accident (INFRA-028). `npm run dev:isolated` is the
same dev server with nothing behind it — every workspace path answers `500`, and
the console strip says "server unreachable". That is what the e2e suite runs.

Point the dev server at another workspace with `CORPUS_SERVER_ORIGIN`; override
the UI port when something else holds `5173`:

```sh
npm run dev -w apps/ui -- --port 5273 --strictPort
# …or against a workspace server on another port:
CORPUS_SERVER_ORIGIN=http://127.0.0.1:8766 npm run dev -w apps/ui
```

## The bearer token in development

Every route is authenticated (SPEC.md §2.1) but for two documented exceptions:
`GET /api/health`, and `POST /api/jobs/{id}/log`, the loopback job-log ingest —
which is guarded by loopback plus an `Origin` refusal instead of a token (`GET`
on that same path stays authenticated). `@corpus/kit` deliberately never goes
looking for credentials — it takes the token as configuration, and
`src/app/apiClient.ts` is the one place in the app that decides where it comes
from. In development that is the `VITE_CORPUS_TOKEN` environment variable.

Start the dev server with the workspace's own token:

```sh
VITE_CORPUS_TOKEN="$(jq -r .token /path/to/workspace/.corpus/config.json)" \
  npm run dev -w apps/ui -- --port 5273 --strictPort
```

Without it the UI still boots and the console strip still reports server
health — but every list, reader and thread returns `401`, visibly rather than
silently.

**Production is a different mechanism, and it wins.** The workspace server
injects the token into the very shell it serves, and `apiClient.ts` reads it back
out of the document (SERVER-024). Precedence is deliberate: a non-empty injected
token shadows `VITE_CORPUS_TOKEN`, because the env var is baked in at _build_
time and can only ever be a guess about which workspace the bundle would later be
served from, while the injected value comes from the server that just handed out
this exact page. An absent or empty injected token falls back to the env var,
which is what leaves the dev flow above unchanged.

## The development data probe

`/__probe` mounts a cross-section of the kit's read hooks at once — `useDocs`,
`useTree`, `useJobs`, `useQueueStatus`, plus `useConnectionState` — and lists the
documents it gets back. `?thread=<id>` adds the thread half: `useThread`'s turns
and a button that appends one through `useAppendTurn`. It exists to make the
live-update loop observable in a real browser before real board columns exist,
and to make "exactly one `/events` connection" something you can see in the
Network tab rather than infer.

It is mounted only when `import.meta.env.DEV` is true, so a production bundle
drops both the route and the component.

## Tests

Both are **root** scripts — this workspace declares no `test` script of its own,
so `npm test -w apps/ui` fails.

- `npx vitest run apps/ui` (or `npm test` for the whole repo) — Vitest, jsdom per
  file via a `@vitest-environment` docblock.
- `npm run e2e` — Playwright against the real dev server, started with no proxy
  target, so a workspace server running on `8765` changes nothing. Set
  `CORPUS_UI_PORT=5273` if `5173` is taken.

Two environment quirks the suites work around, both documented at their
workaround: Node 25 shadows jsdom's `localStorage` (`src/testing/memoryStorage.ts`),
and neither Node nor jsdom implements `EventSource`, so tests inject one from
`@corpus/kit/testing`.
