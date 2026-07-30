# todos — the reference plugin

The v1 reference plugin (SPEC.md §12). It owns the `todo` document type and
exercises all four extension points, so it doubles as the worked example
`docs/PLUGINS.md` describes in the abstract:

| Extension point    | Here                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `manifest.ts`      | the `todo` doc type with `View`, `ListItem`, `DocPanel` and `validate`, plus the `todos` board column |
| `server/routes.ts` | `/api/x/todos` — append, update and delete one item, all through the core write path                  |
| `cli/commands/`    | `corpus todos add \| check \| list \| migrate`                                                        |
| `skills/todos/`    | what the agent does when a thread asks for a todo                                                     |

**The item format lives in exactly one module**, [`items.ts`](./items.ts):
standard GFM task-list lines in the document **body** — `- [ ] text` /
`- [x] text`, in body order, with an optional `(due: YYYY-MM-DD)` at the end of
a line (SPEC.md §12). The routes mutate them, the manifest validates with them,
and the React components read with them. The CLI never sees the format at all —
its verbs are thin clients over the routes.

Items are body text on purpose (PLUGINS-003, Candidate 3): that is what makes a
comment on an item an ordinary §6 text-quote anchor, with no special anchoring
code anywhere. It is also why every mutation here edits **only the line it
owns** — the plugin shares the body with the user, and a serializer that
rewrote the document from a parsed model would eat prose.

Documents written before PLUGINS-005 stored items in an `items` frontmatter
key. Those are read for as long as they exist and converted on the first write
through any verb; `corpus todos migrate` converts the rest in one pass and is
safe to re-run.

This directory is the subject of SPEC.md §15 M6's subtractive check: delete it
and the core must still boot, with todo documents rendering as ordinary
markdown **with working checkboxes** and the Todos column showing a "plugin
missing" card.

See [`docs/PLUGINS.md`](../../docs/PLUGINS.md) for the author's guide.
