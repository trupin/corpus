// Workspace resolution and `.corpus/config.json` parsing (SPEC.md §4).
//
// The server never *writes* this file — `corpus init` (CLI-002) owns creating
// it. Everything ambient (env vars, cwd, argv) is read here and nowhere else, so
// `createServer` can stay a pure function of its config.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  type AttachmentLimits,
} from "./attachments/index.js";
import { ConfigError } from "./errors.js";
import { LogLevelSchema, type LogLevel } from "./logger.js";

export const CORPUS_DIR = ".corpus";
export const CONFIG_FILE = "config.json";
export const CONFIG_RELATIVE_PATH = `${CORPUS_DIR}/${CONFIG_FILE}`;

export const DEFAULT_PORT = 8765;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_DATA_DIR = "data";

/**
 * `corpus init` generates a token of at least this length. The *reader* does not
 * enforce it (Sprint-002 Adjudication 3: token strength is the generator's
 * concern, so a hand-made fixture workspace is not accepted by one component and
 * rejected by another) — it only warns.
 */
export const RECOMMENDED_TOKEN_LENGTH = 32;

/**
 * v1 binds loopback only (CLAUDE.md Architecture Decision 5): a routable host
 * would expose an unencrypted, single-token API to the network, and remote
 * setups stay a later configuration change rather than a v1 feature.
 *
 * That rule is enforced *at bind time*, not at parse time (Sprint-002
 * Adjudication 6). `.corpus/config.json` is shared with the CLI, which only
 * dials `host` — making a routable value a schema failure would break the CLI's
 * reader over a constraint that is none of its business, and would report a
 * server capability limit as a malformed file.
 */
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "::1",
  "[::1]",
  "::ffff:127.0.0.1",
  "0:0:0:0:0:0:0:1",
]);

export function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host.toLowerCase())) return true;
  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
  return (
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) &&
    host.split(".").every((part) => Number(part) <= 255)
  );
}

/**
 * The canonical on-disk shape, pinned by Sprint-002 Adjudications 3 and 6 and
 * shared with the CLI's reader. Parsed non-strictly: unknown keys pass through
 * (a newer `corpus init` may write fields this server does not know), absent
 * optionals take their documented defaults — including `port`, so a config
 * written without one is valid and binds {@link DEFAULT_PORT}.
 *
 * `host` is any string here; loopback-only is a *semantic* boot rule owned by
 * the component that binds (see {@link nonLoopbackBindError}).
 */
/**
 * Attachment upload caps (SPEC.md §6, SERVER-010). Optional with defaults, so a
 * workspace `corpus init` created before this key existed still parses — and so
 * an operator raising the cap for a workspace full of screenshots edits one
 * number rather than rebuilding anything.
 */
export const AttachmentConfigSchema = z.object({
  maxFileBytes: z.number().int().min(0).default(DEFAULT_MAX_FILE_BYTES),
  maxRequestBytes: z.number().int().min(0).default(DEFAULT_MAX_REQUEST_BYTES),
});

export const WorkspaceConfigSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1).max(65535).default(DEFAULT_PORT),
  host: z.string().default(DEFAULT_HOST),
  token: z.string().min(1),
  dataDir: z.string().min(1).default(DEFAULT_DATA_DIR),
  attachments: AttachmentConfigSchema.default({
    maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    maxRequestBytes: DEFAULT_MAX_REQUEST_BYTES,
  }),
});

/**
 * The boot-time refusal for a host this version will not bind. It names the
 * value, the rule and the file to edit, because the operator's next action is
 * always "change that key" — the config itself is well-formed.
 */
export function nonLoopbackBindError(host: string, configPath: string): ConfigError {
  return new ConfigError(
    `refusing to bind ${JSON.stringify(host)}: this version of corpus serves loopback only — ` +
      `set "host" to ${DEFAULT_HOST} in ${configPath}, or remove the key to use the default`,
  );
}

/**
 * The boot-time refusal for a `dataDir` this version cannot honour.
 *
 * The layout SPEC.md §4 fixes is spelled out in `projection/roots.ts`, whose own
 * docstring records deriving it from this key as a deliberate non-goal — "one
 * deriving it differently would be a silent split-brain". Until SERVER-022 the
 * value was parsed, resolved into {@link ServerConfig.dataDir} and then read by
 * nothing at all: a workspace configured with `dataDir: "content"` started
 * cleanly and kept every document under `data/`, which is the one outcome
 * nobody asked for. Refusing says so out loud, in the same shape as
 * {@link nonLoopbackBindError}.
 */
export function unsupportedDataDirError(value: string, configPath: string): ConfigError {
  return new ConfigError(
    `refusing to start with "dataDir": ${JSON.stringify(value)}: this version of corpus keeps ` +
      `documents under ${JSON.stringify(DEFAULT_DATA_DIR)} and cannot relocate them — ` +
      `set "dataDir" to ${JSON.stringify(DEFAULT_DATA_DIR)} in ${configPath}, or remove the key ` +
      `to use the default`,
  );
}

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

/** Everything `createServer` needs. No field is derived from ambient state later. */
export interface ServerConfig {
  readonly workspaceRoot: string;
  readonly corpusDir: string;
  readonly attachments: AttachmentLimits;
  /**
   * Absolute path of the workspace's document tree. Always `<root>/data`: a
   * config naming anything else is refused at load
   * ({@link unsupportedDataDirError}), because the roots that actually read the
   * tree spell the layout out rather than deriving it.
   */
  readonly dataDir: string;
  readonly configPath: string;
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly version: string;
  readonly logLevel: LogLevel;
  /** Absolute path of the pre-built UI, or `undefined` when none was resolvable. */
  readonly uiDistDir: string | undefined;
  /** Warnings worth surfacing at boot that are not fatal (e.g. a weak token). */
  readonly warnings: readonly string[];
}

export interface LoadServerConfigOptions {
  /** Explicit workspace root; wins over `CORPUS_WORKSPACE` and the upward search. */
  workspace?: string | undefined;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Directory holding `apps/server`'s `package.json`; overridable for tests. */
  packageRoot?: string;
}

/**
 * Walks up from `startDir` to the filesystem root looking for the nearest
 * `.corpus/config.json` (SPEC.md §4 — "nearest ancestor wins", which is what
 * makes several workspaces on one machine independent).
 */
export function findWorkspaceRoot(startDir: string): string | undefined {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, CORPUS_DIR, CONFIG_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export interface ResolvedWorkspace {
  readonly root: string;
  readonly source: "explicit" | "env" | "search";
}

/** Explicit argument > `CORPUS_WORKSPACE` > upward search from `cwd`. */
export function resolveWorkspace(options: LoadServerConfigOptions): ResolvedWorkspace {
  const explicit = options.workspace?.trim();
  if (explicit !== undefined && explicit !== "") {
    return { root: resolve(options.cwd, explicit), source: "explicit" };
  }

  const fromEnv = options.env.CORPUS_WORKSPACE?.trim();
  if (fromEnv !== undefined && fromEnv !== "") {
    return { root: resolve(options.cwd, fromEnv), source: "env" };
  }

  const found = findWorkspaceRoot(options.cwd);
  if (found === undefined) {
    throw new ConfigError(
      `not a Corpus workspace: no ${CONFIG_RELATIVE_PATH} found in ${resolve(options.cwd)} or any parent directory; run \`corpus init\``,
    );
  }
  return { root: found, source: "search" };
}

/** Reads and validates `<workspaceRoot>/.corpus/config.json`. */
export function readWorkspaceConfig(workspaceRoot: string): WorkspaceConfig {
  const configPath = join(workspaceRoot, CORPUS_DIR, CONFIG_FILE);

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (cause) {
    const reason =
      cause instanceof Error && "code" in cause && cause.code === "ENOENT"
        ? "no such file"
        : "unreadable";
    throw new ConfigError(
      `not a Corpus workspace: ${configPath} is ${reason}; run \`corpus init\` in the workspace directory`,
      { cause },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigError(`${configPath} is not valid JSON: ${detail}`, { cause });
  }

  const result = WorkspaceConfigSchema.safeParse(parsed);
  if (!result.success) {
    const problems = result.error.issues
      .map(
        (issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`,
      )
      .join("; ");
    throw new ConfigError(`${configPath} is not a valid workspace config — ${problems}`, {
      cause: result.error,
    });
  }

  return result.data;
}

/**
 * Unlike the config file's `port`, the override accepts `0` — "bind an ephemeral
 * port", which is how tests avoid colliding with a real workspace's server. A
 * workspace config may not use it: the CLI has to know which port to talk to.
 */
const PortOverrideSchema = z.coerce.number().int().min(0).max(65535);

/** `CORPUS_PORT` overrides the config — useful for tests and for a second workspace. */
function resolvePort(config: WorkspaceConfig, env: NodeJS.ProcessEnv): number {
  const override = env.CORPUS_PORT?.trim();
  if (override === undefined || override === "") return config.port;

  const result = PortOverrideSchema.safeParse(override);
  if (!result.success) {
    throw new ConfigError(
      `CORPUS_PORT must be a port number between 0 and 65535 (0 binds an ephemeral port), got ${JSON.stringify(override)}`,
    );
  }
  return result.data;
}

function resolveLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.CORPUS_LOG_LEVEL?.trim();
  if (raw === undefined || raw === "") return "info";

  const result = LogLevelSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      `CORPUS_LOG_LEVEL must be one of silent, info, debug — got ${JSON.stringify(raw)}`,
    );
  }
  return result.data;
}

/**
 * Resolution order for the pre-built UI: an explicit `CORPUS_UI_DIST` (honoured
 * even when it does not exist — an operator who names a directory should be told
 * that directory is missing, not silently served a different build), then the
 * monorepo dev layout, then the packaged layout inside the npm tarball.
 */
export function resolveUiDistDir(env: NodeJS.ProcessEnv, packageRoot: string): string | undefined {
  const explicit = env.CORPUS_UI_DIST?.trim();
  if (explicit !== undefined && explicit !== "") {
    return isAbsolute(explicit) ? explicit : resolve(packageRoot, explicit);
  }

  const candidates = [resolve(packageRoot, "..", "ui", "dist"), resolve(packageRoot, "ui")];
  return candidates.find((candidate) => existsSync(candidate));
}

/** The directory holding `apps/server/package.json`, from this module's location. */
export function defaultPackageRoot(): string {
  return resolve(import.meta.dirname, "..");
}

const PackageJsonSchema = z.object({ version: z.string().min(1) });

/**
 * The version reported by `GET /api/health`. Read from the package rather than
 * hard-coded so a release bump cannot drift from what the server announces.
 */
export function readToolVersion(packageRoot: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const result = PackageJsonSchema.safeParse(parsed);
    return result.success ? result.data.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function loadServerConfig(options: LoadServerConfigOptions): ServerConfig {
  const workspace = resolveWorkspace(options);
  const config = readWorkspaceConfig(workspace.root);
  const packageRoot = options.packageRoot ?? defaultPackageRoot();

  const configPath = join(workspace.root, CORPUS_DIR, CONFIG_FILE);
  const dataDir = resolve(workspace.root, config.dataDir);
  if (dataDir !== resolve(workspace.root, DEFAULT_DATA_DIR)) {
    throw unsupportedDataDirError(config.dataDir, configPath);
  }

  const warnings: string[] = [];
  if (config.token.length < RECOMMENDED_TOKEN_LENGTH) {
    warnings.push(
      `the workspace token is ${config.token.length} characters; \`corpus init\` generates at least ${RECOMMENDED_TOKEN_LENGTH}`,
    );
  }

  return {
    workspaceRoot: workspace.root,
    corpusDir: join(workspace.root, CORPUS_DIR),
    attachments: config.attachments,
    dataDir,
    configPath,
    host: config.host,
    port: resolvePort(config, options.env),
    token: config.token,
    version: readToolVersion(packageRoot),
    logLevel: resolveLogLevel(options.env),
    uiDistDir: resolveUiDistDir(options.env, packageRoot),
    warnings,
  };
}
