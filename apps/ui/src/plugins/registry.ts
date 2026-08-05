import type { PluginColumnType, PluginDocType, PluginManifest } from "@corpus/kit/plugin";
import { useSyncExternalStore } from "react";
import { validateManifest } from "./validate.js";

/**
 * Plugin discovery — the UI's single entry point into `plugins/` (SPEC.md §10,
 * PLUGINS-001). Discovery is convention, not registration: the glob below is
 * the only place the plugin directory is named, nothing in core enumerates a
 * plugin, and adding or removing one is a change under `plugins/` alone.
 *
 * **Why the glob is lazy, not `eager: true`.** Vite still compiles, type-checks
 * and bundles every matched manifest at build time — there is no runtime module
 * loader. But `eager: true` becomes *static* imports of every manifest, so one
 * manifest throwing at module scope would take down the whole bundle's init
 * before any try/catch could run. The lazy form gives us one dynamic import per
 * manifest, kicked off at bootstrap ({@link loadPlugins} in `main.tsx`), each
 * wrapped individually — a broken plugin becomes a console-strip warning and
 * every other plugin still loads. That containment is §10's actual promise
 * ("a manifest that fails to load is skipped with a visible warning"), and it
 * is why this file deviates from the issue text's `{ eager: true }`.
 *
 * **The underscore convention** (sprint-012 Adjudication 9): plugins whose
 * directory starts with `_` are test fixtures — present in dev and tests,
 * excluded from production bundles. This composition is the single place the
 * UI enforces it: the first glob excludes `_*` outright, and the dev-only glob
 * sits behind `import.meta.env.DEV`, so in a production build the branch is
 * dead code and Rollup emits no chunk for any `_*` plugin.
 */

type ManifestLoader = () => Promise<unknown>;

function discoverManifestLoaders(): Readonly<Record<string, ManifestLoader>> {
  return {
    ...import.meta.glob([
      "../../../../plugins/*/manifest.ts",
      "!../../../../plugins/_*/manifest.ts",
    ]),
    ...(import.meta.env.DEV ? import.meta.glob("../../../../plugins/_*/manifest.ts") : {}),
  };
}

/** A skipped or losing manifest, surfaced in the console strip (TEST-85). */
export interface PluginLoadWarning {
  /** The plugin's directory name — the only identity a broken manifest has. */
  readonly plugin: string;
  readonly reason: string;
}

/** One loaded plugin: the §10 manifest plus the directory that owns it. */
export interface LoadedPlugin {
  /**
   * The directory name under `plugins/`. Namespaces everything the plugin
   * contributes — column keys (`"<dir>/<type>"`), routes (`/api/x/<dir>`),
   * query keys (`x/<dir>/…`) — so a manifest cannot choose its own prefix.
   */
  readonly dir: string;
  readonly manifest: PluginManifest;
}

/** A doc type resolved to its owning plugin. */
export interface RegisteredDocType {
  readonly plugin: LoadedPlugin;
  readonly docType: PluginDocType;
}

/** A column type resolved to its owning plugin, keyed `"<dir>/<type>"`. */
export interface RegisteredColumnType {
  readonly plugin: LoadedPlugin;
  readonly column: PluginColumnType;
  readonly key: string;
}

export interface PluginRegistry {
  readonly plugins: readonly LoadedPlugin[];
  readonly warnings: readonly PluginLoadWarning[];
  readonly docTypes: ReadonlyMap<string, RegisteredDocType>;
  readonly columns: ReadonlyMap<string, RegisteredColumnType>;
}

export const EMPTY_REGISTRY: PluginRegistry = {
  plugins: [],
  warnings: [],
  docTypes: new Map(),
  columns: new Map(),
};

/** `"../../../../plugins/_fixture/manifest.ts"` → `"_fixture"`. */
function dirOfModulePath(path: string): string {
  const match = /\/plugins\/([^/]+)\/manifest\.ts$/.exec(path);
  return match?.[1] ?? path;
}

interface DiscoveredModule {
  readonly dir: string;
  /** The module namespace, or the error its import rejected with. */
  readonly loaded: { readonly module: unknown } | { readonly error: unknown };
}

async function importAll(
  loaders: Readonly<Record<string, ManifestLoader>>,
): Promise<readonly DiscoveredModule[]> {
  return Promise.all(
    Object.entries(loaders).map(async ([path, load]): Promise<DiscoveredModule> => {
      const dir = dirOfModulePath(path);
      try {
        return { dir, loaded: { module: await load() } };
      } catch (error) {
        return { dir, loaded: { error } };
      }
    }),
  );
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Builds the registry from discovered modules — pure, deterministic, and the
 * unit-testable half of discovery.
 *
 * Determinism (TEST-83): plugins are sorted by manifest `order` (absent sorts
 * last) then directory name *before* indexing, so a contested doc type resolves
 * to the same winner regardless of the order the glob returned keys in. The
 * loser is a warning, never a silent coin flip.
 */
export function buildRegistry(modules: readonly DiscoveredModule[]): PluginRegistry {
  const warnings: PluginLoadWarning[] = [];
  const plugins: LoadedPlugin[] = [];

  for (const { dir, loaded } of modules) {
    if ("error" in loaded) {
      warnings.push({
        plugin: dir,
        reason: `its manifest failed to load: ${reasonOf(loaded.error)}`,
      });
      continue;
    }
    const exported =
      typeof loaded.module === "object" && loaded.module !== null && "default" in loaded.module
        ? loaded.module.default
        : undefined;
    if (exported === undefined) {
      warnings.push({ plugin: dir, reason: "its manifest has no default export" });
      continue;
    }
    const validated = validateManifest(exported);
    if (!validated.ok) {
      warnings.push({ plugin: dir, reason: `its manifest is invalid — ${validated.error}` });
      continue;
    }
    plugins.push({ dir, manifest: validated.manifest });
  }

  plugins.sort((left, right) => {
    const leftOrder = left.manifest.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.manifest.order ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.dir < right.dir ? -1 : left.dir > right.dir ? 1 : 0;
  });

  const docTypes = new Map<string, RegisteredDocType>();
  const columns = new Map<string, RegisteredColumnType>();
  for (const plugin of plugins) {
    for (const docType of plugin.manifest.docTypes) {
      const holder = docTypes.get(docType.type);
      if (holder !== undefined) {
        warnings.push({
          plugin: plugin.dir,
          reason:
            `it also claims the doc type "${docType.type}", ` +
            `already owned by ${holder.plugin.dir} — ${holder.plugin.dir} wins`,
        });
        continue;
      }
      docTypes.set(docType.type, { plugin, docType });
    }
    for (const column of plugin.manifest.columns) {
      // Keys are namespaced by directory, so cross-plugin collision is
      // impossible; an intra-manifest duplicate already failed validation.
      columns.set(`${plugin.dir}/${column.type}`, {
        plugin,
        column,
        key: `${plugin.dir}/${column.type}`,
      });
    }
  }

  return { plugins, warnings, docTypes, columns };
}

/**
 * Where discovery has got to — the half of the registry a **layout** has to
 * consult (UI-073).
 *
 * `pluginRegistry()` answers "what is registered", which is the same answer
 * (`EMPTY_REGISTRY`) whether nothing is registered or nothing has loaded *yet*.
 * A surface whose geometry depends on a plugin cannot act on that: painting
 * during `pending` is painting a layout that is about to change under whatever
 * the user is doing to it. This is the distinction that was missing.
 *
 * - `settled` — discovery is done, or was never asked for. The initial value,
 *   so every host that does not call {@link loadPlugins} (unit tests, any
 *   non-browser render) sees a registry it can act on immediately.
 * - `pending` — {@link loadPlugins} is in flight. Set **synchronously** when it
 *   is called, which is what puts it in place before `main.tsx` renders.
 * - `abandoned` — it took longer than {@link DISCOVERY_BUDGET_MS}. Surfaces
 *   stop waiting and paint without plugin chrome.
 */
export type PluginDiscoveryPhase = "settled" | "pending" | "abandoned";

/**
 * The bound on how long any surface may wait for discovery.
 *
 * The manifests are chunks of this same bundle, served from the origin that
 * served the page: two seconds is not a slow import, it is a broken one, and
 * past that point a document the user cannot read is worse than a document
 * without its plugin's panel. Nothing is cancelled — a discovery that finishes
 * afterwards still installs, and the next reader to open gets it.
 */
export const DISCOVERY_BUDGET_MS = 2_000;

let registry: PluginRegistry = EMPTY_REGISTRY;
let phase: PluginDiscoveryPhase = "settled";
const listeners = new Set<() => void>();

/**
 * Swaps registry and phase together and notifies once. Two notifications would
 * be two renders, and the second of them is exactly the frame in which a panel
 * appears over an already-painted body.
 */
function publish(next: PluginRegistry, nextPhase: PluginDiscoveryPhase): void {
  registry = next;
  phase = nextPhase;
  for (const listener of [...listeners]) listener();
}

/**
 * Discovers and loads every plugin manifest. Kicked off (not awaited) from
 * `main.tsx`: the app's first render must not wait on module fetches, so the
 * registry starts {@link EMPTY_REGISTRY} and components that resolve slots
 * subscribe through {@link usePluginRegistry} and re-render when discovery
 * settles. Never throws — every failure mode is a warning in the registry.
 *
 * The shell, the board and the keyboard are live from the first frame, which is
 * why this is not awaited. The one surface that *does* wait is the document
 * body, whose geometry is what a late arrival damages — see `DocView.tsx`,
 * where that decision and its alternatives are argued.
 */
export async function loadPlugins(): Promise<PluginRegistry> {
  // Synchronous, before the first `await`: `main.tsx` calls this and then
  // renders, so the app's first render must already see `pending`.
  publish(registry, "pending");
  const budget = setTimeout(() => {
    publish(registry, "abandoned");
  }, DISCOVERY_BUDGET_MS);
  try {
    const next = buildRegistry(await importAll(discoverManifestLoaders()));
    for (const warning of next.warnings) {
      console.error(`[corpus] plugin ${warning.plugin} skipped: ${warning.reason}`);
    }
    publish(next, "settled");
    return next;
  } finally {
    clearTimeout(budget);
  }
}

/** The current registry — {@link EMPTY_REGISTRY} until {@link loadPlugins} resolves. */
export function pluginRegistry(): PluginRegistry {
  return registry;
}

/** How far discovery has got — see {@link PluginDiscoveryPhase}. */
export function pluginDiscoveryPhase(): PluginDiscoveryPhase {
  return phase;
}

/** Notifies on every registry swap; returns the unsubscribe. */
export function subscribePlugins(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The registry as a React external store: any component that resolves plugin
 * slots during render calls this, so the swap from empty to loaded — or a test
 * installing a fixture registry — re-renders exactly the consumers.
 */
export function usePluginRegistry(): PluginRegistry {
  return useSyncExternalStore(subscribePlugins, pluginRegistry);
}

/**
 * The same store, read for {@link PluginDiscoveryPhase} rather than contents.
 * A component that lays out around a plugin slot needs both: the phase decides
 * whether it may paint at all, the registry decides what it paints.
 */
export function usePluginDiscovery(): PluginDiscoveryPhase {
  return useSyncExternalStore(subscribePlugins, pluginDiscoveryPhase);
}

/**
 * Test seam: install a registry built by hand. Returns the previous one.
 *
 * An explicit install is a **settled** registry by default — there is nothing
 * in flight to wait for — which is why gating on the phase changes nothing for
 * the tests that use this seam. Pass a phase to drive a surface through
 * discovery's own states.
 */
export function setPluginRegistry(
  next: PluginRegistry,
  nextPhase: PluginDiscoveryPhase = "settled",
): PluginRegistry {
  const previous = registry;
  publish(next, nextPhase);
  return previous;
}
