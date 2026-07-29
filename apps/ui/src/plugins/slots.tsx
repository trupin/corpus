import type {
  ColumnComponentProps,
  DocPanelProps,
  DocViewProps,
  ListItemProps,
} from "@corpus/kit/plugin";
import type { ComponentType, ReactElement } from "react";
import { PluginErrorBoundary } from "./PluginErrorBoundary.js";
import { pluginRegistry } from "./registry.js";

/**
 * Slot resolution — the **only** coupling between core components and plugin
 * code (SPEC.md §10, PLUGINS-001). Core calls one of the four resolvers below
 * and receives either a plugin component already wrapped in its own error
 * boundary, or `null`, meaning "use the core default". The fallback path —
 * a deleted plugin's documents "render as plain markdown" — is the natural
 * consequence of `null`, not a special case.
 *
 * Exactly four resolvers exist; `DocPanel` is the single core injection slot
 * in v1. Wrapped components are cached per `<plugin>/<role>/<type>` so a
 * resolver call during render returns a stable component identity — a fresh
 * wrapper each call would remount the plugin component on every render. The
 * cache key is also the boundary key: one boundary per slot, so one crash can
 * never blank anything beyond its own card, and remounting the slot resets it.
 */

type Role = "view" | "list-item" | "doc-panel" | "column";

const wrapped = new Map<string, ComponentType<never>>();

function boundaryWrapped<Props extends object>(
  plugin: string,
  role: Role,
  type: string,
  Inner: ComponentType<Props>,
): ComponentType<Props> {
  const key = `${plugin}/${role}/${type}`;
  const cached = wrapped.get(key);
  if (cached !== undefined) return cached as ComponentType<Props>;
  function Slot(props: Props): ReactElement {
    return (
      <PluginErrorBoundary plugin={plugin} role={role}>
        <Inner {...props} />
      </PluginErrorBoundary>
    );
  }
  Slot.displayName = `PluginSlot(${key})`;
  wrapped.set(key, Slot as ComponentType<never>);
  return Slot;
}

/** Test seam: drops cached wrappers so a swapped registry takes effect. */
export function resetSlotCache(): void {
  wrapped.clear();
}

/** The plugin `View` owning this doc type, or `null` — core renders the standard document view. */
export function resolveDocView(type: string): ComponentType<DocViewProps> | null {
  const entry = pluginRegistry().docTypes.get(type);
  const View = entry?.docType.View;
  if (entry === undefined || View === undefined) return null;
  return boundaryWrapped(entry.plugin.dir, "view", type, View);
}

/** The plugin `ListItem` owning this doc type, or `null` — the kit `Row` renders. */
export function resolveListItem(type: string): ComponentType<ListItemProps> | null {
  const entry = pluginRegistry().docTypes.get(type);
  const ListItem = entry?.docType.ListItem;
  if (entry === undefined || ListItem === undefined) return null;
  return boundaryWrapped(entry.plugin.dir, "list-item", type, ListItem);
}

/** The plugin `DocPanel` owning this doc type, or `null` — no panel renders. */
export function resolveDocPanel(type: string): ComponentType<DocPanelProps> | null {
  const entry = pluginRegistry().docTypes.get(type);
  const DocPanel = entry?.docType.DocPanel;
  if (entry === undefined || DocPanel === undefined) return null;
  return boundaryWrapped(entry.plugin.dir, "doc-panel", type, DocPanel);
}

/** The column `Component` behind a `"<plugin>/<type>"` key, or `null` — the missing card renders. */
export function resolveColumnType(key: string): ComponentType<ColumnComponentProps> | null {
  const entry = pluginRegistry().columns.get(key);
  if (entry === undefined) return null;
  return boundaryWrapped(entry.plugin.dir, "column", entry.column.type, entry.column.Component);
}
