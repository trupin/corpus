import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Hono } from "hono";
import * as YAML from "yaml";
import { z } from "zod";
import { defaultPackageRoot } from "../config.js";
import type { DocsWorkspace, DocumentMutex } from "../docs/index.js";
import { describeThrown } from "../errors.js";
import type { Logger } from "../logger.js";
import { createPluginContext, type PluginServerContext } from "./context.js";
import type { PluginDerive } from "./derived-fields.js";

/**
 * Plugin discovery — the server's single entry point into `plugins/`
 * (SPEC.md §10, PLUGINS-001). Discovery is convention, not registration:
 * every direct child of the plugins root is a candidate, a `server/routes`
 * module is mounted at `/api/x/<dir>`, and nothing anywhere names a plugin.
 *
 * Failure is always containment: a missing plugins root, a plugin without a
 * `server/` directory, a routes module that throws at import, a factory that
 * throws at mount — none of them may prevent boot. The failing plugin is
 * skipped with a logged warning; core routes are untouched (they mount first,
 * so a plugin cannot shadow `/api/docs` even by accident).
 */

/** One `types.yaml` entry — the non-TS mirror of the manifest's `docTypes`. */
export interface PluginTypeDecl {
  readonly type: string;
  readonly label: string;
  readonly seedTemplate?: string | undefined;
  /**
   * This type's `status` is derived from the document itself (SPEC.md §12,
   * PLUGINS-016) — the non-TS half of the manifest's `deriveStatus`, and what
   * lets the server and the CLI know the field is not anyone's to set without
   * executing a line of the plugin. `true` is the only spelling: absent means
   * not derived, and `false` is not a way of saying so.
   */
  readonly derivedStatus?: true | undefined;
  /**
   * This type's `due` is derived from the document itself in the same way
   * (PLUGINS-018: a todo document's deadline is its earliest open item's) — the
   * non-TS half of the manifest's `deriveDue`, answered by the same module's
   * named `deriveDue` export. One flag per derived field, so a field is declared
   * where it is read and adding one is never a change to what the others mean.
   */
  readonly derivedDue?: true | undefined;
}

/** The core fields a plugin may answer for, and how each one is declared. */
type DerivedFieldName = "status" | "due";

interface DerivedFieldDescriptor {
  readonly name: DerivedFieldName;
  /** Its flag on a `types.yaml` entry. */
  readonly flag: "derivedStatus" | "derivedDue";
  /**
   * Its export on `server/derive`. `status` is the **default** export because it
   * is the field the seam shipped with; every field after it is named, which is
   * the convention `plugins/todos/server/derive.ts` documents on the other side.
   */
  readonly exportName: string;
}

const DERIVED_FIELDS: readonly DerivedFieldDescriptor[] = [
  { name: "status", flag: "derivedStatus", exportName: "default" },
  { name: "due", flag: "derivedDue", exportName: "deriveDue" },
];

interface DerivedFieldLoad {
  readonly field: DerivedFieldDescriptor;
  readonly declared: readonly PluginTypeDecl[];
}

const TypesFileSchema = z.object({
  types: z.array(
    z.object({
      type: z.string().min(1),
      label: z.string().min(1),
      seedTemplate: z.string().min(1).optional(),
      derivedStatus: z.literal(true).optional(),
      derivedDue: z.literal(true).optional(),
    }),
  ),
});

/**
 * What a plugin's `server/routes` module default-exports: a factory taking the
 * {@link PluginServerContext} and returning a Hono router. Typed loosely at
 * this boundary — the module was dynamically imported and proves nothing.
 */
export type PluginRoutesFactory = (context: PluginServerContext) => unknown;

export interface DiscoveredPlugin {
  /** The directory name — the plugin's identity and its `/api/x/<dir>` prefix. */
  readonly dir: string;
  /** Absolute path of the plugin directory. */
  readonly root: string;
  /** The routes factory, or `null` when the plugin ships no server half. */
  readonly routes: PluginRoutesFactory | null;
  /**
   * The `server/derive` **default** export — §12's derived `status` — or `null`
   * when the plugin declares no such type or ships no such module (SPEC.md §12,
   * PLUGINS-016). Loaded under the same containment as the routes module and
   * typed just as loosely: `createDerivedFieldsRegistry` validates every answer.
   */
  readonly deriveStatus: PluginDerive | null;
  /**
   * The same module's named `deriveDue` export — the seam's second field
   * (PLUGINS-018, SERVER-134) — or `null` on the same terms. **One module, two
   * exports, one import**: a plugin's server half is one directory with one
   * build, and a second discovery rule for a second field would be a second
   * thing to get wrong (and a second entry point to forget in
   * `scripts/package-staging.ts`, where `server/derive.js` is already staged).
   */
  readonly deriveDue: PluginDerive | null;
  /** Doc types declared in `types.yaml` — the server's whole view of them. */
  readonly types: readonly PluginTypeDecl[];
  /** Everything non-fatal that went wrong while discovering this plugin. */
  readonly warnings: readonly string[];
}

/**
 * Where the bundled `plugins/` directory lives — the tool's install directory,
 * never the workspace (sprint-012 Adjudication 12: a workspace-local `plugins/`
 * is not discovered in v1). Mirrors `resolveTemplateRoot` in
 * `apps/cli/src/paths.ts` and `resolveUiDistDir` in `../config.ts`: an explicit
 * `CORPUS_PLUGINS_DIR` wins, then the packaged layout, then the monorepo dev
 * layout. A missing root is a normal state — no plugins — not an error.
 */
export function pluginsRootCandidates(
  packageRoot: string = defaultPackageRoot(),
): readonly string[] {
  return [join(packageRoot, "plugins"), resolve(packageRoot, "..", "..", "plugins")];
}

export function resolvePluginsRoot(
  env: NodeJS.ProcessEnv,
  packageRoot: string = defaultPackageRoot(),
): string | undefined {
  const explicit = env["CORPUS_PLUGINS_DIR"]?.trim();
  if (explicit !== undefined && explicit !== "") {
    return isAbsolute(explicit) ? explicit : resolve(packageRoot, explicit);
  }
  return pluginsRootCandidates(packageRoot).find((candidate) => existsSync(candidate));
}

/**
 * The underscore convention, server half (sprint-012 Adjudication 9): a plugin
 * directory starting with `_` is a test fixture — discovered in dev and tests,
 * skipped in production. This predicate is the only place the server enforces
 * it.
 */
export function excludedInProduction(dir: string, env: NodeJS.ProcessEnv): boolean {
  return dir.startsWith("_") && env["NODE_ENV"] === "production";
}

/**
 * The routes module to import for one plugin: compiled `dist/server/routes.js`
 * when the plugin was built, else `server/routes.ts` for the dev layout under
 * a TS-capable loader (sprint-012 Adjudication 12iii). `null` when the plugin
 * ships no server half — a normal, silent state.
 */
export function resolveRoutesModule(pluginRoot: string): string | null {
  return resolveServerModule(pluginRoot, "routes");
}

/**
 * The `server/derive` module — §12's derived status, executable half. Same
 * convention as {@link resolveRoutesModule}, deliberately: a plugin's server
 * half is one directory with one build, and a second discovery rule for a second
 * module is a second thing to get wrong.
 */
export function resolveDeriveModule(pluginRoot: string): string | null {
  return resolveServerModule(pluginRoot, "derive");
}

function resolveServerModule(pluginRoot: string, name: string): string | null {
  const compiled = join(pluginRoot, "dist", "server", `${name}.js`);
  if (existsSync(compiled)) return compiled;
  const source = join(pluginRoot, "server", `${name}.ts`);
  return existsSync(source) ? source : null;
}

/**
 * One exported function of a dynamically imported module. `null` for every other
 * outcome, with the reason pushed onto `warnings` — a plugin's server half is
 * convention, so "no such module" and "not a factory" are both ordinary states
 * of somebody's directory, never a boot failure.
 *
 * `exportName` is `"default"` for the routes factory and for the seam's first
 * derived field, and a named export for every field after it (SERVER-134). The
 * import is memoized by `importModule` so one module read once serves every
 * export a plugin declares.
 */
async function loadExportedFunction(
  modulePath: string,
  exportName: string,
  module: { readonly describe: string; readonly noun: string; readonly skipped: string },
  warnings: string[],
  logger: Logger,
  plugin: string,
  importModule: (path: string) => Promise<unknown>,
): Promise<((...args: never[]) => unknown) | null> {
  const describeExport =
    exportName === "default"
      ? `default-exported ${module.noun}`
      : `\`${exportName}\` ${module.noun}`;
  try {
    const loaded: unknown = await importModule(modulePath);
    const exported =
      typeof loaded === "object" && loaded !== null && exportName in loaded
        ? (loaded as Record<string, unknown>)[exportName]
        : undefined;
    if (typeof exported === "function") return exported as (...args: never[]) => unknown;
    warnings.push(`its ${module.describe} module has no ${describeExport}`);
    return null;
  } catch (error) {
    warnings.push(`its ${module.describe} module failed to load`);
    logger.error(
      `plugin ${plugin} ${module.describe} module failed to load — skipping ${module.skipped}`,
      { plugin, module: modulePath, ...describeThrown(error) },
    );
    return null;
  }
}

/**
 * Imports each module path at most once per discovery. The derive module carries
 * one export per derived field, and importing it once per field would run a
 * plugin's top-level code twice for a document type that declares two.
 */
function memoizedImport(): (path: string) => Promise<unknown> {
  const loaded = new Map<string, Promise<unknown>>();
  return (path) => {
    const held = loaded.get(path);
    if (held !== undefined) return held;
    const loading: Promise<unknown> = import(pathToFileURL(path).href);
    loaded.set(path, loading);
    return loading;
  };
}

function readTypesFile(pluginRoot: string, warnings: string[]): readonly PluginTypeDecl[] {
  const typesPath = join(pluginRoot, "types.yaml");
  if (!existsSync(typesPath)) {
    if (existsSync(join(pluginRoot, "manifest.ts"))) {
      warnings.push(
        "it has a manifest.ts but no types.yaml — the server cannot validate or route its doc types (SPEC.md §10)",
      );
    }
    return [];
  }
  try {
    const parsed = TypesFileSchema.safeParse(YAML.parse(readFileSync(typesPath, "utf8")));
    if (!parsed.success) {
      warnings.push(
        `its types.yaml does not match the required shape (types: [{type, label, seedTemplate?}]): ${parsed.error.issues
          .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
      return [];
    }
    return parsed.data.types;
  } catch (error) {
    warnings.push(
      `its types.yaml is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

export interface DiscoverPluginsOptions {
  readonly pluginsRoot: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly logger: Logger;
}

/**
 * Enumerates the plugins root and loads each plugin's server half. Sorted by
 * directory name so boot logs, mounts and docs are deterministic on every
 * machine. Never throws.
 */
export async function discoverPlugins(
  options: DiscoverPluginsOptions,
): Promise<readonly DiscoveredPlugin[]> {
  const { pluginsRoot, env, logger } = options;
  if (pluginsRoot === undefined || !existsSync(pluginsRoot)) return [];

  const dirs = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((dir) => !excludedInProduction(dir, env))
    .sort();

  const plugins: DiscoveredPlugin[] = [];
  const importModule = memoizedImport();
  for (const dir of dirs) {
    const root = join(pluginsRoot, dir);
    const warnings: string[] = [];
    const types = readTypesFile(root, warnings);

    let routes: PluginRoutesFactory | null = null;
    const routesPath = resolveRoutesModule(root);
    if (routesPath !== null) {
      routes = (await loadExportedFunction(
        routesPath,
        "default",
        { describe: "server/routes", noun: "factory function", skipped: "its routes" },
        warnings,
        logger,
        dir,
        importModule,
      )) as PluginRoutesFactory | null;
    }

    // One export per derived field, all from one module, loaded only for a
    // plugin that declares at least one derived type: importing a module nothing
    // will ask anything of is boot latency spent on nothing, and a plugin
    // shipping an unreferenced `server/derive.ts` should not be able to fail a
    // boot with it. A plugin declaring both fields imports the module once.
    const derivedFields: DerivedFieldLoad[] = [];
    for (const field of DERIVED_FIELDS) {
      const declared = types.filter((entry) => entry[field.flag] === true);
      if (declared.length > 0) derivedFields.push({ field, declared });
    }
    const loaded: Record<DerivedFieldName, PluginDerive | null> = {
      status: null,
      due: null,
    };
    if (derivedFields.length > 0) {
      const derivePath = resolveDeriveModule(root);
      for (const { field, declared } of derivedFields) {
        if (derivePath === null) {
          warnings.push(
            `its types.yaml declares a derived ${field.name} for ${declared
              .map((entry) => entry.type)
              .join(", ")} but it ships no server/derive module (SPEC.md §12)`,
          );
          continue;
        }
        loaded[field.name] = (await loadExportedFunction(
          derivePath,
          field.exportName,
          {
            describe: "server/derive",
            noun: "function",
            skipped: `its ${field.name} derivation`,
          },
          warnings,
          logger,
          dir,
          importModule,
        )) as PluginDerive | null;
      }
    }

    for (const warning of warnings) {
      logger.info(`warning: plugin ${dir} — ${warning}`, { plugin: dir });
    }
    logger.info("plugin discovered", {
      plugin: dir,
      routes: routes !== null,
      types: types.map((declared) => declared.type),
      // Every type deriving *any* field, deduped and in declaration order — one
      // line an operator reads as "these types answer for themselves", which is
      // what it meant when `status` was the only field.
      derives: [
        ...new Set(derivedFields.flatMap(({ declared }) => declared.map((entry) => entry.type))),
      ],
    });
    plugins.push({
      dir,
      root,
      routes,
      deriveStatus: loaded.status,
      deriveDue: loaded.due,
      types,
      warnings,
    });
  }
  return plugins;
}

export interface MountPluginRoutesDeps {
  readonly workspace: DocsWorkspace;
  readonly mutex: DocumentMutex;
  readonly logger: Logger;
  readonly now: () => number;
}

/** Duck-typed: a Hono app of any version exposes a `fetch` handler. */
function isHonoRouter(value: unknown): value is Hono {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fetch?: unknown }).fetch === "function"
  );
}

/**
 * Mounts every discovered plugin router at `/api/x/<dir>` — after all core
 * mounts, so nothing a plugin registers can shadow a core route, and inside
 * the `/api/*` bearer guard, so plugin routes are authenticated with zero
 * wiring. The prefix comes from the directory name alone: a plugin cannot
 * choose or escape it — a router path like `/api/docs` lands harmlessly at
 * `/api/x/<dir>/api/docs`.
 */
export function mountPluginRoutes(
  app: OpenAPIHono,
  plugins: readonly DiscoveredPlugin[],
  deps: MountPluginRoutesDeps,
): void {
  for (const plugin of plugins) {
    if (plugin.routes === null) continue;
    const context = createPluginContext({
      plugin: plugin.dir,
      workspace: deps.workspace,
      mutex: deps.mutex,
      logger: deps.logger,
      now: deps.now,
    });
    try {
      const router = plugin.routes(context);
      if (!isHonoRouter(router)) {
        deps.logger.error(
          `plugin ${plugin.dir} routes factory did not return a Hono router — skipping its routes`,
          { plugin: plugin.dir },
        );
        continue;
      }
      app.route(`/api/x/${plugin.dir}`, router);
      deps.logger.info("plugin routes mounted", {
        plugin: plugin.dir,
        prefix: `/api/x/${plugin.dir}`,
      });
    } catch (error) {
      deps.logger.error(`plugin ${plugin.dir} routes factory threw — skipping its routes`, {
        plugin: plugin.dir,
        ...describeThrown(error),
      });
    }
  }
}
