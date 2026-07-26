import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { UsageError, WorkspaceConfigError, WorkspaceNotFoundError } from "./errors.js";

/**
 * Workspace discovery (SPEC.md §4). The CLI's only filesystem read of workspace
 * state: walk up from the starting directory to the nearest `.corpus/config.json`
 * and take the port and bearer token from it. The nearest ancestor wins —
 * nested workspaces never merge.
 *
 * The schema is deliberately loose: unknown keys pass through and optional keys
 * default, so the server and the CLI accept exactly the same file (sprint-002
 * adjudication 1). Token strength is `corpus init`'s concern, not a reader's.
 */

export const CONFIG_DIR = ".corpus";
export const CONFIG_FILE = "config.json";
export const CONFIG_RELATIVE_PATH = join(CONFIG_DIR, CONFIG_FILE);

export const WorkspaceConfigSchema = z.looseObject({
  version: z.literal(1),
  port: z.number().int().min(1).max(65535),
  host: z.string().min(1).default("127.0.0.1"),
  token: z.string().min(1),
  dataDir: z.string().min(1).default("data"),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export interface Workspace {
  readonly root: string;
  readonly configPath: string;
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly dataDir: string;
  /** Origin the typed client is bound to. */
  readonly baseUrl: string;
}

export interface ResolveWorkspaceOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Value of the global `--workspace` flag, if given. */
  readonly workspaceFlag?: string | undefined;
}

export function findWorkspaceRoot(start: string): string | undefined {
  let directory = resolve(start);
  for (;;) {
    if (existsSync(join(directory, CONFIG_DIR, CONFIG_FILE))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function resolveWorkspace(options: ResolveWorkspaceOptions): Workspace {
  const start = options.workspaceFlag ?? options.env.CORPUS_WORKSPACE ?? options.cwd;
  const root = findWorkspaceRoot(start);
  if (root === undefined) {
    throw new WorkspaceNotFoundError(
      "not inside a Corpus workspace — run `corpus init` here or pass --workspace",
      { hint: `Searched upward from ${resolve(start)} for ${CONFIG_RELATIVE_PATH}.` },
    );
  }

  const configPath = join(root, CONFIG_DIR, CONFIG_FILE);
  const config = readWorkspaceConfig(configPath);
  const host = config.host;
  const port = portOverride(options.env) ?? config.port;
  const token = options.env.CORPUS_TOKEN ?? config.token;

  return {
    root,
    configPath,
    host,
    port,
    token,
    dataDir: config.dataDir,
    baseUrl: `http://${host}:${String(port)}`,
  };
}

export function readWorkspaceConfig(configPath: string): WorkspaceConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (cause) {
    throw new WorkspaceConfigError(`cannot read ${configPath}: ${systemMessage(cause)}`, {
      hint: "Check the file's permissions, or pass --workspace to point at another workspace.",
      cause,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new WorkspaceConfigError(
      `workspace config is invalid: ${configPath} is not valid JSON (${systemMessage(cause)})`,
      { cause },
    );
  }

  const result = WorkspaceConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new WorkspaceConfigError(
      `workspace config is invalid: ${configPath} — ${formatIssues(result.error)}`,
      { hint: "Fix the file, or pass --workspace to point at another workspace." },
    );
  }
  return result.data;
}

function portOverride(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const raw = env.CORPUS_PORT;
  if (raw === undefined) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(`CORPUS_PORT must be a port number between 1 and 65535, got "${raw}".`);
  }
  return port;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join(".");
      return path === "" ? issue.message : `${path}: ${issue.message}`;
    })
    .join("; ");
}

function systemMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
