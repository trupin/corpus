/**
 * `@corpus/contract/plugin` — the plugin author's non-UI import surface
 * (SPEC.md §10, CONTRACT-015).
 *
 * A **types-only subpath**, parallel to `@corpus/kit/plugin`, so a plugin
 * author reads two symmetric imports: the kit publishes the manifest and the
 * React-bound rendering contract, the contract publishes what a plugin's
 * `server/routes.ts` factory and `cli/commands/*.ts` modules are handed. It is
 * deliberately **not** on the `.` barrel, which every app imports wholesale —
 * the plugin surface has no business bloating it, and the split is what lets
 * the eslint allowlist keep banning `@corpus/contract/client` by name while
 * admitting this subpath.
 *
 * Two invariants hold this module together, both pinned by `index.test.ts`:
 *
 * 1. **Types only.** Nothing here emits a runtime export — no classes, no
 *    factories, no validation. Every implementation stays where it already
 *    lives: `createPluginContext` in `apps/server`, `validateRegistry` and the
 *    dispatcher in `apps/cli`. The implementing side annotates itself with
 *    these types, so drift is a type error there rather than a rotted copy here.
 * 2. **No new dependency.** These declarations reference the contract's own
 *    resource types and nothing else — never `apps/*`, never `better-sqlite3`,
 *    `node:fs`, `hono` or `react` — so a plugin (and the browser bundle that
 *    reaches this package through the kit) pays nothing for them.
 *
 * What deliberately did *not* graduate, with its reason:
 *
 * - `PluginRoutesFactory` stays in `apps/server`: it is `(context) => unknown`
 *   guarded by a runtime duck-type at mount, because the module it describes
 *   was dynamically imported and proves nothing. Publishing it would either
 *   publish that `unknown` — which types nothing for the plugin author, whose
 *   own `routes.ts` states its `Hono` return directly — or put Hono's app type
 *   on a surface this package keeps browser-friendly.
 * - The CLI's `TopicSpec` and `Registry` stay in `apps/cli`: a plugin declares
 *   neither. Its topic is *derived* from the directory name by the scanner, and
 *   the registry is the whole tool's command surface. Publishing them would
 *   mean publishing a second, plugin-shaped copy of types whose `commands` are
 *   the CLI's own union — the duplication this issue exists to remove.
 * - `PluginManifest` stays in `@corpus/kit/plugin`: its members are React
 *   component types, and this package must not gain `react`.
 */

export type {
  PluginArgSpec,
  PluginCommandArgs,
  PluginCommandClient,
  PluginCommandContext,
  PluginCommandFlags,
  PluginCommandOutput,
  PluginCommandSpec,
  PluginCommandWorkspace,
  PluginExample,
  PluginFlagSpec,
  PluginFlagType,
} from "./cli.js";

export type {
  PluginDocMutation,
  PluginLogFields,
  PluginLogger,
  PluginServerContext,
} from "./server.js";
