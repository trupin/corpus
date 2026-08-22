/**
 * The plugin surface (SPEC.md §10, PLUGINS-001): discovery of `plugins/*` at
 * boot, mounting at `/api/x/<dir>`, and the context handed to plugin routers.
 *
 * This file is the surface: nothing outside `plugins/` imports its internals.
 */

export {
  discoverPlugins,
  excludedInProduction,
  mountPluginRoutes,
  pluginsRootCandidates,
  resolveDeriveModule,
  resolvePluginsRoot,
  resolveRoutesModule,
} from "./discover.js";
export type {
  DiscoveredPlugin,
  DiscoverPluginsOptions,
  MountPluginRoutesDeps,
  PluginRoutesFactory,
  PluginTypeDecl,
} from "./discover.js";
export { createDerivedFieldsRegistry, EMPTY_DERIVED_FIELDS } from "./derived-fields.js";
export type {
  DerivedDocDue,
  DerivedDocStatus,
  DerivedFieldRegistry,
  DerivedFieldsDeclaration,
  DerivedFieldsRegistry,
  DeriveInput,
  PluginDerive,
} from "./derived-fields.js";
export { createPluginContext, PLUGIN_KEY_PREFIX } from "./context.js";
export type { PluginContextDeps, PluginServerContext } from "./context.js";
