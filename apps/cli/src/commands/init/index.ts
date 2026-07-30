import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { UsageError } from "../../errors.js";
import { resolvePluginsRoot, resolveTemplateRoot, templateManifestPath } from "../../paths.js";
import type { CommandContext, StandaloneCommandSpec } from "../../registry/types.js";
import { CONFIG_DIR, CONFIG_FILE, findWorkspaceRoot } from "../../workspace.js";
import {
  commitAll,
  DEFAULT_BRANCH,
  gitFailure,
  initRepository,
  isRepositoryRoot,
  requireGit,
  runGit,
  type GitRunner,
} from "./git.js";
import { claimPort, type FindFreePortOptions } from "./port.js";
import {
  CreatedPaths,
  existingWorkspaceReason,
  generateToken,
  scaffoldWorkspace,
  unrelatedContentReasons,
} from "./scaffold.js";

/**
 * `corpus init` — the one command that writes workspace files directly, because
 * it exists to create the workspace the server will then own (SPEC.md §2.1,
 * §2.2 rule 4). Everything after it goes through the server.
 *
 * The order is deliberate: every reason to refuse is checked *before* anything
 * is created, and everything created afterwards is tracked so a failure can put
 * the directory back — but only what this run created. A file the template
 * overwrote is gone for good, because `CreatedPaths` has no snapshot of it. That
 * is why a directory holding unrelated content is refused up front rather than
 * rolled back afterwards (CLI-013), and why `--force` buys past that refusal
 * only: a directory that already holds a workspace is never replaced, with or
 * without it.
 */

export const INITIAL_COMMIT_MESSAGE = "workspace: initialize corpus workspace by user";

export interface InitDependencies {
  readonly git?: GitRunner;
  readonly templateRoot?: string;
  /**
   * The tool's bundled `plugins/` directory. Named to override (tests point it
   * at a fixture tree; `undefined` means "no plugins"); absent, the real root
   * is resolved from the install directory — never the workspace
   * (SPEC.md §10, sprint-012 Adjudication 12).
   */
  readonly pluginsRoot?: string | undefined;
  readonly portProbe?: FindFreePortOptions;
}

export interface InitReport {
  readonly workspace: string;
  readonly port: number;
  readonly configPath: string;
  readonly manifestPath: string;
  readonly repository: "initialized" | "reused";
  readonly installed: readonly string[];
  /** Plugin skill files copied into `.claude/skills/` (SPEC.md §10). */
  readonly installedPluginSkills: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Where the workspace is created: `positional ?? --workspace ?? CORPUS_WORKSPACE
 * ?? cwd`, resolved against the invocation directory — the chain every other
 * command already runs (`workspace.ts`), with init's own positional in front.
 *
 * `--workspace` reaches init through `mergedFlags` like any global, and init
 * used to parse and discard it, silently scaffolding the operator's current
 * directory instead of the one they named. That divergence is CLI-013 and it was
 * destructive three times, so the two are reconciled here and a disagreement is
 * reported rather than quietly resolved (sprint-015 Open Conflict 4).
 */
function resolveInitTarget(context: CommandContext): {
  readonly target: string;
  readonly warnings: readonly string[];
} {
  const positional = context.args.optional("path");
  const flag = context.flags.string("workspace");
  const named = positional ?? flag ?? context.env.CORPUS_WORKSPACE;
  const target = resolve(context.cwd, named ?? ".");

  const shadowed = positional === undefined ? undefined : (flag ?? context.env.CORPUS_WORKSPACE);
  const warnings =
    shadowed === undefined || resolve(context.cwd, shadowed) === target
      ? []
      : [
          `two targets were named; the positional ${target} wins over ${resolve(context.cwd, shadowed)}, which was ignored.`,
        ];

  return { target, warnings };
}

export async function runInit(
  context: CommandContext,
  dependencies: InitDependencies = {},
): Promise<InitReport> {
  const git = dependencies.git ?? runGit;
  const { target, warnings: targetWarnings } = resolveInitTarget(context);
  const force = context.flags.boolean("force");

  if (existsSync(target) && !statSync(target).isDirectory()) {
    throw new UsageError(`${target} is not a directory.`, {
      hint: "Pass a directory to initialize, or omit the argument to use the current one.",
    });
  }

  const existing = existsSync(target) ? existingWorkspaceReason(target) : undefined;
  if (existing !== undefined) {
    throw new UsageError(`${target} is already a Corpus workspace: ${existing}.`, {
      hint: "--force does not override this: a live workspace is never replaced. Remove the directory yourself, or initialize somewhere else.",
    });
  }

  // The refusal that has to come before every write, including the `mkdir`
  // below: the scaffold overwrites same-named files and nothing can put them
  // back (CLI-013).
  const unrelated = unrelatedContentReasons(target);
  if (unrelated.length > 0 && !force) {
    throw new UsageError(`refusing to initialize ${target} — ${unrelated.join("; ")}.`, {
      hint: "Initialize an empty or not-yet-existing directory, or pass --force to write into this one anyway. --force cannot undo an overwrite: the template's README.md and .gitignore replace any of the same name.",
    });
  }

  // Both preconditions are proved on an untouched directory: a missing `git` or
  // a broken installation must not be discovered halfway through a scaffold.
  await requireGit(git, existsSync(target) ? target : context.cwd);
  const templateRoot = dependencies.templateRoot ?? resolveTemplateRoot();

  const warnings: string[] = [...targetWarnings];
  if (unrelated.length > 0) {
    warnings.push(`--force: initializing ${target} anyway — ${unrelated.join("; ")}.`);
  }
  const enclosing = findWorkspaceRoot(dirname(target));
  if (enclosing !== undefined) {
    warnings.push(
      `${target} sits inside the workspace at ${enclosing}; commands run here will now resolve to the inner workspace (nearest ancestor wins).`,
    );
  }

  const port = await claimPort(context.flags.number("port"), dependencies.portProbe ?? {});
  const token = generateToken();

  const created = new CreatedPaths();
  const reused = existsSync(target) && isRepositoryRoot(target);

  try {
    created.mkdir(target);
    const result = scaffoldWorkspace({
      root: target,
      templateRoot,
      pluginsRoot: "pluginsRoot" in dependencies ? dependencies.pluginsRoot : resolvePluginsRoot(),
      port,
      token,
      toolVersion: context.version,
      // One tracker across the whole run: the scaffold and the repository must
      // unwind together, or a failed commit leaves a half-workspace behind.
      created,
    });
    warnings.push(...result.pluginWarnings);
    if (created.overwritten.length > 0) {
      warnings.push(
        `overwrote ${String(created.overwritten.length)} pre-existing file${
          created.overwritten.length === 1 ? "" : "s"
        }, which cannot be restored: ${created.overwritten
          .map((path) => relative(target, path))
          .join(", ")}.`,
      );
    }

    if (!reused) {
      await initRepository(target, git).catch((cause: unknown) => {
        throw gitFailure("git init", cause);
      });
      created.record(join(target, ".git"), "tree");
    }
    await commitAll({ dir: target, message: INITIAL_COMMIT_MESSAGE, git }).catch(
      (cause: unknown) => {
        throw gitFailure("the workspace's initial commit", cause);
      },
    );

    return {
      workspace: target,
      port,
      configPath: result.configPath,
      manifestPath: templateManifestPath(target),
      repository: reused ? "reused" : "initialized",
      installed: result.installed.map((file) => file.to),
      installedPluginSkills: result.installedPluginSkills,
      warnings,
    };
  } catch (error) {
    created.unwind();
    throw error;
  }
}

export const initCommand: StandaloneCommandSpec = {
  name: "init",
  requiresWorkspace: false,
  summary: "Create a Corpus workspace here (document tree, config, git repository, agent skills).",
  description:
    "Materializes a workspace: `data/docs` and `data/threads`, the `.corpus/` runtime tree, a " +
    "`.corpus/config.json` holding a freshly generated bearer token and this workspace's port " +
    "(mode 600), the bundled agent skills and seed documents copied verbatim from the tool's " +
    "workspace template, and a git repository with one initial commit authored as `user`. " +
    "The target is the positional `path`, else `--workspace`, else `CORPUS_WORKSPACE`, else the " +
    "current directory — in that order, so a positional always wins and naming two targets " +
    "warns rather than picking one quietly. Refuses a directory that already holds a " +
    "workspace, which `--force` never overrides. Refuses **before writing anything** a " +
    "directory that holds unrelated content — existing files, a git repository or worktree, or " +
    "any directory inside one — naming what it found; `--force` proceeds there and reports what " +
    "it overwrote. Refusing first is the whole safety property: the template replaces " +
    "same-named files such as `README.md` and `.gitignore`, and nothing can put them back.",
  args: [
    {
      name: "path",
      required: false,
      description:
        "Directory to initialize, created if missing. Wins over `--workspace` and `CORPUS_WORKSPACE`; with none of the three, the current directory.",
    },
  ],
  flags: [
    {
      name: "port",
      type: "number",
      valueName: "n",
      description:
        "Port this workspace's server binds. Defaults to the first free port at or above 8765; a port already in use is an error, never silently replaced.",
    },
    {
      name: "force",
      type: "boolean",
      description:
        "Initialize into a directory that already holds unrelated content — existing files, a git repository or worktree, or a directory inside one. Same-named template files are overwritten and cannot be restored, so what was clobbered is reported. It never overrides the refusal to touch an existing workspace.",
    },
  ],
  examples: [
    { command: "corpus init", description: "Create a workspace in the current directory." },
    { command: "corpus init ~/notes", description: "Create a workspace at ~/notes." },
    {
      command: "corpus init --workspace ~/notes",
      description:
        "Same target, named by the global flag instead of a positional — for scripts that already carry one.",
    },
    {
      command: "corpus init ~/notes --port 8790",
      description: "Pin the port instead of probing upward from 8765.",
    },
    {
      command: "corpus init ~/project --force",
      description:
        "Initialize over a directory that already holds files or a git repository, overwriting same-named template files.",
    },
    {
      command: "corpus init --json",
      description: "Machine-readable form. The bearer token is never printed.",
    },
  ],
  handler: async (context) => {
    const report = await runInit(context);

    context.out.emit(report);
    for (const warning of report.warnings) context.out.line(`warning: ${warning}`);
    context.out.line(`Initialized Corpus workspace at ${report.workspace}`);
    context.out.line(
      `  port ${String(report.port)}, token in ${CONFIG_DIR}/${CONFIG_FILE} (mode 600)`,
    );
    context.out.line(
      report.repository === "reused"
        ? "  git: reused the existing repository, added the workspace commit"
        : `  git: initialized on ${DEFAULT_BRANCH}, one commit authored as user`,
    );
    context.out.line(
      `  installed ${String(report.installed.length)} template files, recorded in ${relative(report.workspace, report.manifestPath)}`,
    );
    if (report.installedPluginSkills.length > 0) {
      context.out.line(
        `  installed ${String(report.installedPluginSkills.length)} plugin skill file${
          report.installedPluginSkills.length === 1 ? "" : "s"
        } into .claude/skills/`,
      );
    }
    context.out.line("Next: corpus server start");
  },
};
