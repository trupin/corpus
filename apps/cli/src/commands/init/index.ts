import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { UsageError } from "../../errors.js";
import { resolveTemplateRoot, templateManifestPath } from "../../paths.js";
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
} from "./scaffold.js";

/**
 * `corpus init` — the one command that writes workspace files directly, because
 * it exists to create the workspace the server will then own (SPEC.md §2.1,
 * §2.2 rule 4). Everything after it goes through the server.
 *
 * The order is deliberate: every reason to refuse is checked *before* anything
 * is created, and everything created afterwards is tracked so a failure can put
 * the directory back. `corpus init` has no `--force` — a workspace that already
 * exists is never silently replaced.
 */

export const INITIAL_COMMIT_MESSAGE = "workspace: initialize corpus workspace by user";

export interface InitDependencies {
  readonly git?: GitRunner;
  readonly templateRoot?: string;
  readonly portProbe?: FindFreePortOptions;
}

export interface InitReport {
  readonly workspace: string;
  readonly port: number;
  readonly configPath: string;
  readonly manifestPath: string;
  readonly repository: "initialized" | "reused";
  readonly installed: readonly string[];
  readonly warnings: readonly string[];
}

export async function runInit(
  context: CommandContext,
  dependencies: InitDependencies = {},
): Promise<InitReport> {
  const git = dependencies.git ?? runGit;
  const target = resolve(context.cwd, context.args.optional("path") ?? ".");

  if (existsSync(target) && !statSync(target).isDirectory()) {
    throw new UsageError(`${target} is not a directory.`, {
      hint: "Pass a directory to initialize, or omit the argument to use the current one.",
    });
  }

  const existing = existsSync(target) ? existingWorkspaceReason(target) : undefined;
  if (existing !== undefined) {
    throw new UsageError(`${target} is already a Corpus workspace: ${existing}.`, {
      hint: "There is no --force. Remove the directory yourself, or initialize somewhere else.",
    });
  }

  // Both preconditions are proved on an untouched directory: a missing `git` or
  // a broken installation must not be discovered halfway through a scaffold.
  await requireGit(git, existsSync(target) ? target : context.cwd);
  const templateRoot = dependencies.templateRoot ?? resolveTemplateRoot();

  const warnings: string[] = [];
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
      port,
      token,
      toolVersion: context.version,
      // One tracker across the whole run: the scaffold and the repository must
      // unwind together, or a failed commit leaves a half-workspace behind.
      created,
    });

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
    "Refuses to touch a directory that already holds a workspace — there is no `--force`.",
  args: [
    {
      name: "path",
      required: false,
      description:
        "Directory to initialize, created if missing. Defaults to the current directory.",
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
  ],
  examples: [
    { command: "corpus init", description: "Create a workspace in the current directory." },
    { command: "corpus init ~/notes", description: "Create a workspace at ~/notes." },
    {
      command: "corpus init ~/notes --port 8790",
      description: "Pin the port instead of probing upward from 8765.",
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
    context.out.line("Next: corpus server start");
  },
};
