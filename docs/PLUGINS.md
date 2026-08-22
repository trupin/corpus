# Writing a Corpus plugin

A plugin is a directory `plugins/<name>/`, discovered by convention — no central
registration anywhere (SPEC.md §10). Adding a plugin is `mkdir plugins/<name>`
plus files; removing it is `rm -rf`, and the core stays fully functional: your
documents keep rendering (as plain markdown through the standard document view),
your column shows a "plugin missing" card in its body while the column itself
stays reorderable and deletable, and your routes and verbs simply disappear.

In v1 plugins ship **bundled with the tool**. Discovery resolves against the
tool's install directory — a `plugins/` directory inside a user's workspace is
not discovered.

## Directory layout

All four extension points are optional:

```
plugins/<name>/
  manifest.ts               # UI: doc-type renderers + board column types
  ui/                       # React components the manifest references
  server/routes.ts          # mounted at /api/x/<name>
  cli/commands/<verb>.ts    # registered as `corpus <name> <verb>`
  skills/<skill>/SKILL.md   # installed into the workspace's .claude/skills/
  types.yaml                # the doc types you own — see below
  package.json              # a normal npm workspace (plugins/* is in the root workspaces)
```

The `<name>` **directory name is your identity everywhere** — the column
reference (`column: "<name>/<type>"`), the route prefix (`/api/x/<name>`), the
CLI topic, the invalidation namespace (`x/<name>/…`). Your manifest's `id`
cannot change any of it.

**The underscore convention:** a directory starting with `_` (like the test
fixture `plugins/_fixture`) is excluded from production bundles, from
`docs/cli.md`, and from packaging — present only in dev and tests.

## The kit-only rule (lint-enforced)

Plugin UI code imports **only** `@corpus/kit` (components, hooks, query keys)
and `@corpus/contract` (wire types and schemas). Importing `apps/ui/src`
internals — or any other workspace — fails `npm run lint`; so does a core file
importing plugin code (discovery is the only coupling). Third-party packages
(`react`, `hono`, `zod`) are yours to declare in your own `package.json`.

## manifest.ts — doc types and columns

```ts
import { definePlugin } from "@corpus/kit/plugin";

export default definePlugin({
  id: "todos",
  name: "Todos",
  docTypes: [{ type: "todo", ListItem, DocPanel, validate }], // every field optional
  columns: [{ type: "board", label: "Todos", Component, defaultQuery: { type: "todo" } }],
});
```

- `View` replaces the standard document view for your type; no `View` (or no
  plugin) falls back to plain markdown. **Think hard before claiming it.** A
  `View` also suppresses the anchor layer — `anchorsHost` is false wherever a
  plugin `View` wins — so the document loses text-anchored commenting (SPEC.md
  §6), and you inherit responsibility for editing, serializing and rendering
  everything else in the body. If your data is ordinary markdown that the core
  editor already handles, do not register one: `plugins/todos` stores its items
  as GFM task-list lines and deliberately registers **no** `View` (PLUGINS-006),
  which is why an item is commentable and why a todo document still works with
  the plugin deleted. Claim the slot only for a type the core editor genuinely
  cannot render.
- `ListItem` replaces the default row (`Row`'s props, re-exported as
  `ListItemProps`) in every column list.
- `DocPanel` renders in a fixed slot **above the document body**, in both the
  column reader and focus mode. It is the only core injection slot in v1.
- A `columns` entry contributes a "＋ New list" picker choice. Choosing it
  creates a pinned `type: view` document with `column: "<name>/<type>"` (plus
  your `defaultQuery`) in its frontmatter — ordering, persistence, reordering
  and agent stewardship all come from that document, never from your code.
- Your column `Component` is handed `{ viewDocId, title, query, onOpen }`.
  `onOpen(docId)` is the board's own "open this document in **this** column's
  reader" — the same act a core row's click performs. Use it for any row that
  stands for a document; a host with no board (a test) passes nothing and your
  column simply does not navigate.
- Every plugin component renders inside its own error boundary: a crash shows
  an error card in place and the rest of the board keeps working. A manifest
  that fails to load or validate is skipped with a console-strip warning.
- **A column that would just be a filtered list should not be React at all** —
  ship a view document instead.

Manifests load at build time (`import.meta.glob`) — a dropped-in plugin appears
on the next dev-server rebuild.

## types.yaml — the non-TS mirror

The server and CLI never load UI code, so the doc types you own are declared
twice: in `manifest.ts` (for the UI) and in `types.yaml` (for everything else):

```yaml
types:
  - type: todo
    label: Todo
    seedTemplate: seeds/todo.md # optional, a BODY-only template (§9.2)
```

Ship a parity test asserting the two agree in both directions (copy
`plugins/_fixture/parity.test.ts`); the server also warns at boot when a
`manifest.ts` exists with no `types.yaml`. Store plugin document data in
frontmatter under your own keys — they travel on the wire in `extra`
(`@corpus/contract`), which the server stores verbatim and never interprets.

**`seedTemplate` supplies a BODY and nothing else.** Template pre-fill is
body-only (SPEC.md §10): a template's frontmatter is the _template document's_
housekeeping and never bleeds onto instances. So a plugin key cannot be seeded
— design your reader so an **absent key means its empty value**. That is also
what makes a hand-written document, and one whose key someone deleted, render
instead of erroring. `plugins/todos` does exactly this: no `items` key is a
list with no items.

**Give the format one owner.** Put the parse, the serialize, the mutations and
the error messages in a single module and route the routes, the manifest's
`validate` and every component through it (`plugins/todos/items.ts`). A second
reader written "just for the UI" is how the two halves of a plugin start
disagreeing about their own data.

## server/routes.ts

Default-export a factory taking the plugin server context and returning a Hono
router:

```ts
export default function routes(context) {
  const app = new Hono();
  app.post("/items", async (c) => {
    const doc = await context.createDoc("user", { type: "todo", title: "…" });
    context.broadcastInvalidate([["items"]]); // reaches the wire as ["x","<name>","items"]
    return c.json({ id: doc.frontmatter.id }, 201);
  });
  return app;
}
```

- Mounted at `/api/x/<name>` — after every core route, inside the workspace
  bearer guard. You cannot choose or escape the prefix.
- The context is your **only** door to workspace state: `listDocs`, `getDoc`,
  `createDoc`, `updateDoc` run the same pipeline core routes run — git
  auto-commit, projection update, anchor reconciliation, SSE broadcast. No
  filesystem, no database, no git (Architecture Decision 2: the server is the
  sole writer).
- `broadcastInvalidate(keys)` prefixes every key with `x/<name>/` and rejects
  core roots (`docs`, `tree`, …): core keys are broadcast by the write path
  itself, so your write already refreshes the board — your key names _your_
  stale queries. On the UI side, `usePluginQuery("<name>", "items")` caches
  under the same key and refetches on your broadcast through the one core SSE
  connection.
- A routes module that throws at import (or a factory that throws) is skipped
  with a logged warning; the server still boots and your paths 404.
- The dev layout imports `server/routes.ts` under the TS loader; a built plugin
  is imported from `dist/server/routes.js` (add a `build` script emitting
  `dist/`; the root `npm run build` runs it).

## cli/commands/

Each module default-exports the same declarative command spec core verbs use —
`{ name, summary, description?, args, flags, examples, handler }`, at least one
example — and appears as `corpus <name> <verb>` in the dispatcher, all three
`--help` levels and (for non-underscore plugins) `docs/cli.md`, subject to the
same registry validation. Handlers are thin HTTP clients: call your own
`/api/x/<name>` routes with `context.workspace.baseUrl` and `token`; never
touch files.

A command module with a syntax error is skipped with a stderr warning; a
command that fails validation (e.g. no example) fails the whole registry loudly
— exactly like a core verb.

Discovery is **dist-first**, like the server's: the CLI enumerates
`dist/cli/commands/*.js` when your plugin has been built and falls back to
`cli/commands/*.ts` in the monorepo. Anything else under `cli/` (a shared HTTP
helper, say) is not enumerated — only the `commands/` directory is.

## skills/

`corpus init` copies `plugins/<name>/skills/*` into the workspace's
`.claude/skills/`, records them in `.corpus/template-manifest.json` with
`source: "plugin:<name>"`, and refuses collisions with core skills
(`orchestrate`, `comment` — core always wins). The dev flow is the same
mechanism: run `corpus init` from the repo. The orchestrate skill routes
`<name>.<action>` events to the skill named `<name>` by convention — you wire
nothing. That convention is a **constraint on the skill's directory name**: the
event is handed to `.claude/skills/<name>/`, so a skill directory named anything
other than your plugin's directory is unreachable by event type, and the
orchestrate skill fails such an event with `no installed skill named <name>`.
`plugins/todos/skills/todos/` is the shape to copy; `plugins/_fixture`'s
`skills/fixture-notes/` is reachable by name only, and says so in its own body.

Once installed, your skill sits in the same `.claude/skills/` as the core two
and is read by the same agent, so **it is held to the same authoring rules** —
an example that contradicts one of them beats the rule it contradicts, because
the example is what gets copied. `scripts/workspace-template.test.ts` sweeps
every skill `corpus init` installs, yours included, from the installer's own
plan: today it requires that a worked `corpus thread reply|create … --from
agent` states `--model`, that a trace line is a turn's last line or absent, and
that every multi-line argument goes through a quoted heredoc. Defer to the
comment skill for anything it already states — a second statement of a rule is a
second thing to keep true.

## Packaging

`npm run package:build` stages every non-underscore plugin that has a `dist/`:
its **entry points bundled** (`dist/server/routes.js` and each
`dist/cli/commands/*.js`, with `@corpus/*` inlined the way the tool's own
bundles inline it), plus `skills/`, `seeds/`, `types.yaml` and `README.md`.
Sources never ship. Two consequences worth knowing:

- everything else in your `dist/` is reachable from an entry point and is
  inlined into it, so keep your runtime code reachable from those entries;
- your **third-party** dependencies stay external and are resolved from the
  published package's own `dependencies`. In v1 that means a plugin may rely on
  what the tool already depends on (`hono`, `zod`, …) and not on more.

## Testing and coverage

`plugins/*/**` is inside the repo's coverage gate (underscore plugins excluded
like test files); colocate `*.test.ts` in your plugin directory — the root
vitest run collects them. The subtractive check is the bar your plugin must
pass: delete your directory, and the core must not notice.
