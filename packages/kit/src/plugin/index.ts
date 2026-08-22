import type { PluginManifest } from "./types.js";

/**
 * `@corpus/kit/plugin` — the plugin author's import surface (SPEC.md §10).
 *
 * A subpath rather than part of the `.` barrel so the manifest contract does
 * not bloat the app-facing kit surface; everything a `manifest.ts` needs is
 * here, and everything a plugin *component* needs (hooks, rows, markdown,
 * tokens) stays on `@corpus/kit` itself.
 */

export type {
  ColumnComponentProps,
  DerivedDocDue,
  DerivedDocStatus,
  DocPanelProps,
  DocViewProps,
  ListItemProps,
  OpenPayload,
  OpenRequest,
  PluginColumnType,
  PluginDocType,
  PluginManifest,
  RevealItem,
  RevealTarget,
  RevealThread,
} from "./types.js";

/**
 * Identity helper for manifest type inference: `export default
 * definePlugin({...})` gets the author excess-property checking and hover types
 * without an annotation. Returns its argument by reference and does nothing
 * else — no runtime behavior a plugin could come to depend on.
 */
export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest;
}
