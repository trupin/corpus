# todos — the reference plugin

The v1 reference plugin (SPEC.md §12). It owns the `todo` document type and
exercises all four extension points, so it doubles as the worked example
`docs/PLUGINS.md` describes in the abstract:

| Extension point    | Here                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `manifest.ts`      | the `todo` doc type with `View`, `ListItem`, `DocPanel` and `validate`, plus the `todos` board column |
| `server/routes.ts` | `/api/x/todos` — append, update and delete one item, all through the core write path                  |
| `cli/commands/`    | `corpus todos add \| check \| list`                                                                   |
| `skills/todos/`    | what the agent does when a thread asks for a todo                                                     |

**The item format lives in exactly one module**, [`items.ts`](./items.ts):
`items: [{ text, done, ts, due? }]` in the document's frontmatter, carried on
the wire in `extra`. The routes mutate it, the manifest validates with it, and
the four React components read with it. The CLI never sees it at all — its
verbs are thin clients over the routes.

An absent `items` key is an **empty list**, everywhere. Template pre-fill is
body-only (SPEC.md §11), so no seed can supply `items: []`; treating absence as
empty also covers a hand-written document and one whose key was deleted.

This directory is the subject of SPEC.md §15 M6's subtractive check: delete it
and the core must still boot, with todo documents rendering as plain markdown
and the Todos column showing a "plugin missing" card.

See [`docs/PLUGINS.md`](../../docs/PLUGINS.md) for the author's guide.
