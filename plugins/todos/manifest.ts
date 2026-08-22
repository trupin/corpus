import { definePlugin } from "@corpus/kit/plugin";
import { deriveDue, deriveStatus, docSource, itemProblems } from "./items.js";
import { TODO_DOC_TYPE, TODOS_COLUMN_TYPE } from "./shared.js";
import { TodoDocPanel } from "./ui/TodoDocPanel.js";
import { TodoListItem } from "./ui/TodoListItem.js";
import { TodosColumn } from "./ui/TodosColumn.js";

/**
 * The v1 reference plugin (SPEC.md §12), and the subject of §15 M6's
 * subtractive check: delete `plugins/todos/` and the core must still boot, with
 * todo documents rendering as ordinary markdown **with working checkboxes** and
 * this column showing a "plugin missing" card.
 *
 * It exercises all four extension points — this manifest (the `todo` document
 * type with a `ListItem`, a `DocPanel` and `validate`, plus one board column
 * type), `server/routes.ts`, `cli/commands/`, and `skills/todos/SKILL.md` —
 * with enough real utility that it earns its place in a default workspace.
 *
 * **No `View`, deliberately** (PLUGINS-006; SPEC.md §12 as amended 2026-07-30:
 * "the plugin registers no custom document renderer"). Items are GFM task-list
 * lines in the body, and the core editor already renders, toggles and
 * serializes those — so registering a `View` here would replace the standard
 * document surface with a worse one *and* suppress the anchor layer
 * (`DocView.tsx`'s `anchorsHost` is false wherever a plugin View wins), which
 * is precisely what made item-level commenting unreachable. Claiming the slot
 * costs the document its comments; not claiming it costs nothing. The slot
 * itself stays contracted and covered by the underscore fixture plugin.
 *
 * Nothing here declares the plugin's identity. `id` is documentation; the
 * **directory name** is what namespaces the column reference
 * (`column: "todos/todos"`), the route prefix (`/api/x/todos`), the CLI topic
 * and the invalidation namespace, and discovery assigns all of it.
 */
export default definePlugin({
  id: "todos",
  name: "Todos",
  icon: "☑",
  docTypes: [
    {
      type: TODO_DOC_TYPE,
      ListItem: TodoListItem,
      DocPanel: TodoDocPanel,
      // Reads the whole document, body included: items are body task-list lines
      // since PLUGINS-005, and the only thing left that can be malformed is a
      // pre-migration `extra.items` key.
      validate: (doc) => itemProblems(docSource(doc)),
      // SPEC.md §12 (rider signed 2026-08-12): a todo document's status is its
      // items — derived, never set. Mirrored by `derivedStatus: true` in
      // types.yaml and by `server/derive.ts` for the surfaces that never load
      // UI code; parity.test.ts pins the three against each other.
      deriveStatus: (doc) => deriveStatus(docSource(doc), doc.frontmatter.status),
      // PLUGINS-018: the same seam, one field over. A todo document's deadline
      // is its earliest open item's, so §5's `due` — the field Attention,
      // `--due overdue`, `--needs due` and `--needs me` all read — finally sees
      // the `(due: …)` markers §12 puts on items.
      deriveDue: (doc) => deriveDue(docSource(doc), doc.frontmatter.status),
    },
  ],
  columns: [
    {
      type: TODOS_COLUMN_TYPE,
      label: "Todos",
      icon: "☑",
      Component: TodosColumn,
      defaultQuery: { type: TODO_DOC_TYPE },
    },
  ],
});
