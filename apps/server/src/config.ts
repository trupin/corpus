// Workspace resolution and `.corpus/config.json` parsing (SPEC.md §4).
//
// The server never *writes* this file — `corpus init` (CLI-002) owns creating
// it. Everything ambient (env vars, cwd, argv) is read here and nowhere else, so
// `createServer` can stay a pure function of its config.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_REFLECT_QUIET_MINUTES } from "@corpus/contract";
import {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  type AttachmentLimits,
} from "./attachments/index.js";
import { EDIT_ACK_IDLE_MS } from "./edit/index.js";
import { ConfigError } from "./errors.js";
import { LogLevelSchema, type LogLevel } from "./logger.js";
import {
  EmbeddingConfigSchema,
  resolveEmbeddingSettings,
  type EmbeddingSettings,
} from "./semantic/index.js";

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

/**
 * SPEC.md §4's edit-acknowledgment window — how long a document may sit with no
 * user save before the session on it ends and a `doc.edited` is enqueued.
 *
 * A nested block on the `attachments` precedent rather than a bare
 * `editAckIdleMs`, so the acknowledgment has somewhere to grow (a workspace that
 * later wants to opt out entirely, or to scope the window per document type, adds
 * a key here rather than a second top-level one).
 *
 * The floor is one second, not zero: a window of zero would end a session on the
 * same tick as the save that opened it, which is not a shorter acknowledgment but
 * a different feature — one event per autosave, which is what §4's window exists
 * to prevent.
 */
export const EditAcknowledgmentConfigSchema = z.object({
  idleMs: z.number().int().min(1_000).default(EDIT_ACK_IDLE_MS),
});

/**
 * SPEC.md §7's quiet window (rider 9, 2026-08-22): how long the corpus must go
 * without a change by anyone other than the agent before the server enqueues a
 * `workspace.reflect` by itself.
 *
 * **Minutes, not milliseconds**, unlike every other window on this config. It is
 * the one duration a person sets on purpose and reads back on a board — the
 * Reflect control publishes it (`ReflectStatus.quiet`) — and half an hour spelled
 * `1800000` is a number nobody checks.
 *
 * **`0` disables the automatic path** and is a value, not an absence: a
 * workspace that wants reflection only when somebody asks for it says so, and
 * the floor is therefore zero rather than one. The nested block follows the
 * `attachments` and `editAcknowledgment` precedent, so a later key about
 * reflection has somewhere to go.
 */
export const ReflectConfigSchema = z.object({
  quiet: z.number().int().min(0).default(DEFAULT_REFLECT_QUIET_MINUTES),
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
  /**
   * The semantic index's provider (SPEC.md §9.1, SERVER-043). Optional — the
   * `attachments` precedent — because zero config is the *designed* case: with
   * no block at all the server uses the embedded engine when its model has been
   * downloaded and reports `disabled` otherwise, which is an answer rather than
   * an error. What the block names is judged at boot, not here
   * ({@link resolveEmbeddingSettings}), so a workspace an older or newer build
   * wrote stays readable.
   */
  embedding: EmbeddingConfigSchema.optional(),
  editAcknowledgment: EditAcknowledgmentConfigSchema.default({ idleMs: EDIT_ACK_IDLE_MS }),
  reflect: ReflectConfigSchema.default({ quiet: DEFAULT_REFLECT_QUIET_MINUTES }),
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
  /**
   * The `embedding` block, already judged against what this build can serve
   * (SERVER-043). Never carries an unusable provider: a block naming one
   * resolves to `invalid` here and to an explicit error state at the seam, with
   * a boot warning in {@link warnings} naming the file and the key.
   */
  readonly embedding: EmbeddingSettings;
  /**
   * SPEC.md §4's edit-acknowledgment window (SERVER-052). The one optional key on
   * this interface, and it earns the exception: `loadServerConfig` always
   * supplies it, so no *running* server is ever without a value — but a
   * `ServerConfig` is also a literal in two dozen test fixtures, none of which
   * has an opinion about the window, and making every one of them restate the
   * shipped default would state it two dozen times. Omitted means
   * {@link EDIT_ACK_IDLE_MS}, resolved at the one place that builds the tracker.
   */
  readonly editAcknowledgment?: { readonly idleMs: number } | undefined;
  /**
   * SPEC.md §7's quiet window, in minutes (SERVER-137). Optional for
   * {@link editAcknowledgment}'s reason — two dozen fixture literals have no
   * opinion about it — and omitted means {@link DEFAULT_REFLECT_QUIET_MINUTES}.
   *
   * It is the value read **at boot**. The scheduler re-reads the file when it
   * arms and when the status route answers, so an edit to `.corpus/config.json`
   * takes effect without a restart; this is what that re-read falls back to when
   * the file has since become unreadable ({@link readQuietMinutes}).
   */
  readonly reflect?: { readonly quiet: number } | undefined;
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

  const embedding = resolveEmbeddingSettings(config.embedding, configPath);
  if (embedding.warning !== undefined) warnings.push(embedding.warning);

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
    embedding: embedding.settings,
    editAcknowledgment: config.editAcknowledgment,
    reflect: config.reflect,
    warnings,
  };
}

/**
 * SPEC.md §7's quiet window as it stands **right now**, re-read from
 * `.corpus/config.json` (SERVER-137).
 *
 * The issue asks for the key to be "read on start and on config change". There
 * is no config watcher in this server and adding one would put every other key
 * — the port, the token, the data directory — into a reload path nothing has
 * asked for. So the window is read at the two moments it is used instead: when
 * the scheduler arms a timer, and when `GET /api/workspace/reflect` reports it.
 * An operator who edits the file gets the new window on the next write to the
 * corpus, with no restart, and the config file stays a boot-time contract
 * everywhere else.
 *
 * **Never throws, and never reports a value it did not read.** A file that has
 * since gone missing, become unreadable, stopped being JSON or grown a
 * `reflect` block this build refuses returns `fallback` — the value loaded at
 * boot — because a malformed edit must not silently switch the automatic path
 * on or off. It is one `readFileSync` of a few hundred bytes on a path that is
 * already doing a projection query.
 */
export function readQuietMinutes(configPath: string, fallback: number): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return fallback;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  const block = (parsed as Record<string, unknown>)["reflect"];
  const result = ReflectConfigSchema.safeParse(block ?? {});
  return result.success ? result.data.quiet : fallback;
}
