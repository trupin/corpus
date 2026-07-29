import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { resolvePluginsRoot } from "../paths.js";
import type { CommandSpec, TopicSpec } from "./types.js";

/**
 * Plugin CLI discovery — the CLI's single entry point into `plugins/`
 * (SPEC.md §10, PLUGINS-001). Each `plugins/<dir>/cli/commands/*.ts` module
 * default-exports the same declarative `CommandSpec` shape core verbs use;
 * the scan wraps a plugin's commands into a `TopicSpec` named after its
 * **directory** and hands the topics to `registry/index.ts`, which merges
 * them *before* `validateRegistry` runs — so a plugin verb with no example
 * fails validation as loudly as a core verb would, and help and `docs/cli.md`
 * need no plugin knowledge at all.
 *
 * Failure is containment, never fatality: a command module that throws at
 * import, or exports something that is not command-shaped, is skipped with a
 * warning naming it; `corpus --help` and every core verb keep working. The
 * scan is sorted at both levels so the registry — and therefore the committed
 * `docs/cli.md` — is byte-identical on every machine.
 */

/**
 * The underscore convention, CLI half (sprint-012 Adjudication 9): plugins
 * whose directory starts with `_` are test fixtures — registered in dev and
 * tests, skipped in production. This predicate is the CLI's one enforcement
 * site; `docs/cli.md` additionally never documents them (see
 * `../docs/generate.ts`).
 */
export function excludedInProduction(dir: string, env: NodeJS.ProcessEnv): boolean {
  return dir.startsWith("_") && env["NODE_ENV"] === "production";
}

/**
 * The loader's shape gate. Deliberately shallow: it establishes only that the
 * module exported *a command* — the deep rules (kebab-case names, ≥1 example,
 * flag/arg discipline) belong to `validateRegistry`, which must be the single
 * place they live. A module failing this gate is skipped; one passing it with
 * an invalid command fails registry validation loudly, by design.
 */
const CommandModuleSchema = z.object({
  name: z.string().min(1),
  summary: z.string(),
  args: z.array(z.unknown()),
  flags: z.array(z.unknown()),
  examples: z.array(z.unknown()),
  handler: z.custom<CommandSpec["handler"]>((value) => typeof value === "function"),
});

export interface PluginTopicScan {
  readonly topics: readonly TopicSpec[];
  readonly warnings: readonly string[];
}

export interface DiscoverPluginTopicsOptions {
  /** Overrides the resolved plugins root; `undefined` field means "resolve normally". */
  readonly pluginsRoot?: string | undefined;
  readonly env?: NodeJS.ProcessEnv;
}

/** `add.ts` → its compiled `dist/cli/commands/add.js` when built, else itself. */
function commandModulePath(pluginRoot: string, fileName: string): string {
  const compiled = join(pluginRoot, "dist", "cli", "commands", fileName.replace(/\.ts$/, ".js"));
  if (existsSync(compiled)) return compiled;
  return join(pluginRoot, "cli", "commands", fileName);
}

export async function discoverPluginTopics(
  options: DiscoverPluginTopicsOptions = {},
): Promise<PluginTopicScan> {
  const env = options.env ?? process.env;
  const pluginsRoot = "pluginsRoot" in options ? options.pluginsRoot : resolvePluginsRoot(env);
  if (pluginsRoot === undefined || !existsSync(pluginsRoot)) {
    return { topics: [], warnings: [] };
  }

  const warnings: string[] = [];
  const topics: TopicSpec[] = [];

  const dirs = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((dir) => !excludedInProduction(dir, env))
    .sort();

  for (const dir of dirs) {
    const commandsDir = join(pluginsRoot, dir, "cli", "commands");
    if (!existsSync(commandsDir)) continue;

    const files = readdirSync(commandsDir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .sort();

    const commands: CommandSpec[] = [];
    for (const file of files) {
      const modulePath = commandModulePath(join(pluginsRoot, dir), file);
      try {
        const module: unknown = await import(pathToFileURL(modulePath).href);
        const exported =
          typeof module === "object" && module !== null && "default" in module
            ? module.default
            : undefined;
        if (!CommandModuleSchema.safeParse(exported).success) {
          warnings.push(`plugin ${dir}: ${file} does not default-export a command spec — skipped`);
          continue;
        }
        commands.push(exported as CommandSpec);
      } catch (error) {
        warnings.push(
          `plugin ${dir}: ${file} failed to load — skipped (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
    }

    if (commands.length === 0) continue;
    topics.push({
      name: dir,
      summary: `Commands contributed by the ${dir} plugin.`,
      description:
        `Discovered from \`plugins/${dir}/cli/commands/\` (SPEC.md §10) — the plugin's verbs ` +
        `behave, document and validate exactly like core verbs.`,
      commands,
    });
  }

  return { topics, warnings };
}
