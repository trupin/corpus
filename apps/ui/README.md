# `@corpus/ui`

The board (SPEC.md §11). React 18 + Vite, served statically by the workspace
server in the installed tool and proxied through the Vite dev server in
development.

All data access goes through `@corpus/kit`. The only files here that know a
transport exists are `src/app/apiClient.ts` (builds the client) and
`src/app/App.tsx` (mounts the one `CorpusProvider`).

## Running the dev server

```sh
npm run dev -w apps/ui
```

Vite serves on `5173` and proxies `/api` and `/events` to `127.0.0.1:8765`, the
workspace server's documented default. Override the UI port when something else
holds `5173`:

```sh
npm run dev -w apps/ui -- --port 5273 --strictPort
```

## The bearer token in development

Every route except `GET /api/health` is authenticated (SPEC.md §2.1), and
`@corpus/kit` deliberately never goes looking for credentials — it takes the
token as configuration. In development, that configuration is the
`VITE_CORPUS_TOKEN` environment variable, read once in `src/app/apiClient.ts`.

Start the dev server with the workspace's own token:

```sh
VITE_CORPUS_TOKEN="$(jq -r .token /path/to/workspace/.corpus/config.json)" \
  npm run dev -w apps/ui -- --port 5273 --strictPort
```

Without it the UI still boots and the console strip still reports server
health — but every list, reader and thread returns `401`, visibly rather than
silently.

**Production is a different mechanism.** The server that serves the built UI
injects the token itself; that is SERVER-024. `VITE_CORPUS_TOKEN` is a
development affordance and is not read by an installed build's server.

## The development data probe

`/__probe` mounts every kit read hook at once — `useDocs`, `useTree`,
`useJobs`, `useLocks` — plus `useConnectionState`, and lists the documents it
gets back. It exists to make the live-update loop observable in a real browser
before real board columns exist, and to make "exactly one `/events` connection"
something you can see in the Network tab rather than infer.

It is mounted only when `import.meta.env.DEV` is true, so a production bundle
drops both the route and the component.

## Tests

- `npm test -w apps/ui` — Vitest, jsdom per file via a `@vitest-environment`
  docblock.
- `npm run e2e` — Playwright against the real dev server. Set
  `CORPUS_UI_PORT=5273` if `5173` is taken.

Two environment quirks the suites work around, both documented at their
workaround: Node 25 shadows jsdom's `localStorage` (`src/testing/memoryStorage.ts`),
and neither Node nor jsdom implements `EventSource`, so tests inject one from
`@corpus/kit/testing`.
