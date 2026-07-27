import { createClient } from "./client.js";
import { resolveCommand } from "./dispatch.js";
import { ExitCode, exitCodeFor } from "./errors.js";
import { renderCommandHelp, renderRootHelp, renderTopicHelp } from "./help.js";
import { bindPositionals, parseFlags, type ParsedInput } from "./parse-args.js";
import { registry as defaultRegistry } from "./registry/index.js";
import type { CommandSpec, Registry } from "./registry/types.js";
import { createOutput, type Output, type Writer } from "./output.js";
import { readPackageVersion } from "./version.js";
import { resolveWorkspace } from "./workspace.js";

/**
 * One run of the CLI, as a function of its inputs. `bin/corpus.ts` is a shim
 * over this: everything that decides output or exit status lives here, so the
 * whole surface is exercisable without spawning a process.
 */

export interface RunOptions {
  /** argv without `node` and the script path. */
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: Writer;
  readonly stderr: Writer;
  /** Colour is only ever emitted to a TTY (SPEC.md §2.3: no colour for the agent). */
  readonly isTTY: boolean;
  readonly registry?: Registry;
  readonly version?: string;
  /** Injectable transport, for tests that drive a real stub server. */
  readonly fetch?: typeof globalThis.fetch;
}

export async function run(options: RunOptions): Promise<ExitCode> {
  const registry = options.registry ?? defaultRegistry;
  const hints = scanGlobalHints(options.argv);

  // Until argv parses, the rendering mode can only be guessed from raw tokens;
  // once it parses, the parsed flags are authoritative and replace this.
  let out = createOutput({
    json: hints.json,
    color: options.isTTY && !hints.noColor,
    stdout: options.stdout,
    stderr: options.stderr,
  });
  let verbose = hints.verbose;

  try {
    const resolution = resolveCommand(registry, options.argv);

    if (resolution.kind === "root-help") {
      out.write(renderRootHelp(registry, { color: out.color }));
      return ExitCode.success;
    }
    if (resolution.kind === "version") {
      out.write(`${options.version ?? readPackageVersion()}\n`);
      return ExitCode.success;
    }
    if (resolution.kind === "topic-help") {
      out.write(renderTopicHelp(resolution.topic, { color: out.color }));
      return ExitCode.success;
    }

    const { flags, positionals } = parseFlags(resolution.command, resolution.tokens);
    verbose = flags.boolean("verbose");
    out = createOutput({
      json: flags.boolean("json"),
      color: options.isTTY && !flags.boolean("no-color"),
      stdout: options.stdout,
      stderr: options.stderr,
    });

    // Help is human text even under `--json`: help is not data (docs/cli.md).
    if (flags.boolean("help")) {
      out.write(
        renderCommandHelp(resolution.command, {
          color: out.color,
          ...(resolution.topic === undefined ? {} : { topic: resolution.topic }),
        }),
      );
      return ExitCode.success;
    }
    if (flags.boolean("version")) {
      out.write(`${options.version ?? readPackageVersion()}\n`);
      return ExitCode.success;
    }

    const args = bindPositionals(resolution.command, positionals);
    await invoke(resolution.command, { args, flags }, out, options);
    return ExitCode.success;
  } catch (error) {
    out.fail(error, { verbose });
    return exitCodeFor(error);
  }
}

async function invoke(
  command: CommandSpec,
  input: ParsedInput,
  out: Output,
  options: RunOptions,
): Promise<void> {
  const context = {
    args: input.args,
    flags: input.flags,
    out,
    cwd: options.cwd,
    env: options.env,
    version: options.version ?? readPackageVersion(),
  };

  if (command.requiresWorkspace === false) {
    await command.handler(context);
    return;
  }

  const workspace = resolveWorkspace({
    cwd: options.cwd,
    env: options.env,
    workspaceFlag: input.flags.string("workspace"),
  });
  const timeoutMs = input.flags.number("timeout");
  const client = createClient({
    workspace,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  await command.handler({ ...context, workspace, client });
}

interface GlobalHints {
  readonly json: boolean;
  readonly verbose: boolean;
  readonly noColor: boolean;
}

/** Presence-only pre-scan, used solely to render errors thrown before argv parses. */
function scanGlobalHints(argv: readonly string[]): GlobalHints {
  const has = (name: string): boolean =>
    argv.some((token) => token === `--${name}` || token === `--${name}=true`);
  return { json: has("json"), verbose: has("verbose"), noColor: has("no-color") };
}
