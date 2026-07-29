import { definePlugin } from "@corpus/kit/plugin";
import { itemProblems } from "./items.js";
import { TODO_DOC_TYPE, TODOS_COLUMN_TYPE } from "./shared.js";
import { TodoDocPanel } from "./ui/TodoDocPanel.js";
import { TodoListItem } from "./ui/TodoListItem.js";
import { TodoView } from "./ui/TodoView.js";
import { TodosColumn } from "./ui/TodosColumn.js";

/**
 * The v1 reference plugin (SPEC.md §12), and the subject of §15 M6's
 * subtractive check: delete `plugins/todos/` and the core must still boot, with
 * todo documents rendering as plain markdown and this column showing a "plugin
 * missing" card.
 *
 * It exercises all four extension points — this manifest (the `todo` document
 * type with all three renderers plus `validate`, and one board column type),
 * `server/routes.ts`, `cli/commands/`, and `skills/todos/SKILL.md` — with
 * enough real utility that it earns its place in a default workspace.
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
      View: TodoView,
      ListItem: TodoListItem,
      DocPanel: TodoDocPanel,
      validate: (doc) => itemProblems(doc.frontmatter),
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
