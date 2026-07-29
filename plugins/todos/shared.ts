/**
 * The names the todos plugin owns, stated once.
 *
 * The **directory** `plugins/todos/` is the plugin's identity everywhere — the
 * route prefix (`/api/x/todos`), the CLI topic (`corpus todos …`), the column
 * reference (`column: "todos/todos"`), the invalidation namespace
 * (`x/todos/…`) and the skill the orchestrate loop routes `todos.*` events to.
 * None of that is declared here or in the manifest; it is assigned by
 * discovery. What is declared here is only what the plugin chooses: the
 * document type it claims and the column type it registers.
 */

/** The frontmatter `type` this plugin owns (SPEC.md §12). Mirrored in `types.yaml`. */
export const TODO_DOC_TYPE = "todo";

/** The board column type — reachable as `column: "todos/todos"`. */
export const TODOS_COLUMN_TYPE = "todos";

/** The plugin's directory name, needed by the UI's kit calls (`pluginRequest`, `pluginKey`). */
export const TODOS_PLUGIN = "todos";
