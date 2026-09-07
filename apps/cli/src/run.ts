import type { InvocationReport } from "@corpus/contract";
import { createClient } from "./client.js";
import { resolveCommand } from "./dispatch.js";
import { ExitCode, exitCodeFor } from "./errors.js";
import { parseHelpMode, renderCommandHelp, renderRootHelp, renderTopicHelp } from "./help.js";
import { resolveFlagFiles } from "./flag-file.js";
import { resolveActor } from "./input.js";
import { bindPositionals, parseFlags, type ParsedInput } from "./parse-args.js";
import { registry as defaultRegistry } from "./registry/index.js";
import type { CommandSpec, CostLedger, Registry, SubInvocationCost } from "./registry/types.js";
import { createOutput, type Output, type Writer } from "./output.js";
import { sendInvocationReports, type ReportDependencies } from "./telemetry/report.js";
import { resetStdinBytes, stdinBytesRead } from "./telemetry/stdin-bytes.js";
import { collectSubjects } from "./telemetry/subjects.js";
import { readPackageVersion } from "./version.js";
import { resolveWorkspace, type Workspace } from "./workspace.js";

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
  /**
   * Bytes the two streams have delivered, read once the command's own output is
   * flushed and its exit code is decided — the `readBytes` of the cost report
   * (SPEC.md §9.4). `bin/corpus.ts` passes the pipe guard's counter, which is
   * below the guard and therefore counts delivered bytes rather than attempted
   * ones. Absent means nothing is measured, which is what a caller that owns its
   * own writers is telling us.
   */
  readonly bytesWritten?: () => number;
  /** Injected by tests only, so a report can be observed without a real server. */
  readonly telemetry?: ReportDependencies;
}

export async function run(options: RunOptions): Promise<ExitCode> {
  const registry = options.registry ?? defaultRegistry;
  const hints = scanGlobalHints(options.argv);
  resetStdinBytes();

  let out = createOutput({
    json: hints.json,
    color: options.isTTY && !hints.noColor,
    stdout: options.stdout,
    stderr: options.stderr,
  });
  let verbose = hints.verbose;

  const measurement = createMeasurement(options);

  try {
    const resolution = resolveCommand(registry, options.argv);

    if (resolution.kind === "root-help") {
      out.write(renderRootHelp(registry, { color: out.color, mode: resolution.helpMode }));
      return ExitCode.success;
    }
    if (resolution.kind === "version") {
      out.write(`${options.version ?? readPackageVersion()}\n`);
      return ExitCode.success;
    }
    if (resolution.kind === "topic-help") {
      out.write(renderTopicHelp(resolution.topic, { color: out.color, mode: resolution.helpMode }));
      return ExitCode.success;
    }

    const parsed = parseFlags(resolution.command, resolution.tokens);
    const { positionals } = parsed;
    let flags = parsed.flags;
    verbose = flags.boolean("verbose");
    out = createOutput({
      json: flags.boolean("json"),
      color: options.isTTY && !flags.boolean("no-color"),
      stdout: options.stdout,
      stderr: options.stderr,
    });

    measurement.useWorkspace(flags.string("workspace"));

    const helpMode = flags.string("help");
    if (helpMode !== undefined) {
      out.write(
        renderCommandHelp(resolution.command, {
          color: out.color,
          mode: parseHelpMode(helpMode),
          ...(resolution.topic === undefined ? {} : { topic: resolution.topic }),
        }),
      );
      return ExitCode.success;
    }
    if (flags.boolean("version")) {
      out.write(`${options.version ?? readPackageVersion()}\n`);
      return ExitCode.success;
    }

    // Past the help and version registers, so nothing that returns above is ever
    // measured: `--help` is documentation, not work on a document (SPEC.md §9.4).
    measurement.begin(resolution.command, commandPath(resolution.command, resolution.topic));

    flags = await resolveFlagFiles(resolution.command, parsed, { cwd: options.cwd });
    // Again, because `--flag-file workspace=…` may have replaced the value the
    // pre-flight above recorded. Nothing has resolved a workspace yet, so the
    // report and the command still resolve exactly the same one.
    measurement.useWorkspace(flags.string("workspace"));

    const args = bindPositionals(resolution.command, positionals);
    measurement.name(collectSubjects(resolution.command, args, flags));
    await invoke(resolution.command, { args, flags }, out, options, registry, measurement);
    return ExitCode.success;
  } catch (error) {
    out.fail(error, { verbose });
    return exitCodeFor(error);
  } finally {
    // After the catch, so the failure's own bytes are counted and the exit code
    // is already decided. `settle` cannot throw: a report that could replace this
    // function's return value would be the telemetry channel deciding an
    // invocation's outcome, which is the one thing §9.4 forbids it.
    await measurement.settle();
  }
}

function commandPath(command: CommandSpec, topic: string | undefined): string {
  return topic === undefined ? command.name : `${topic} ${command.name}`;
}

/**
 * The invocation's own measurement (SPEC.md §9.4, CLI-085), collected as the run
 * proceeds and sent once it is over.
 *
 * It is a small state machine rather than a value because the three facts it
 * needs become available at three different moments: the command path as soon as
 * the surface is settled, the subjects once the positionals are bound, and the
 * printed bytes only after the failure has been rendered. `settle` is called
 * from a `finally` and is the one place any of it is used.
 *
 * The workspace is resolved **lazily and once**, shared with `invoke`, so the
 * report costs no second walk up the tree and — more importantly — the error a
 * caller outside a workspace sees is still the one `invoke` would have raised,
 * in the same order relative to `--flag-file` and the positional binding.
 */
interface Measurement {
  /** The invocation is measured from here on, unless the command opts out. */
  begin(command: CommandSpec, path: string): void;
  name(subjects: readonly string[]): void;
  /** The `--workspace` value the run parsed, before anything resolves one. */
  useWorkspace(flag: string | undefined): void;
  /** The workspace, resolved once for the command and reused by the report. */
  workspace(): Workspace;
  /** Handed to a composite verb, which reports its entries instead of itself. */
  readonly ledger: CostLedger;
  settle(): Promise<void>;
}

function createMeasurement(options: RunOptions): Measurement {
  let path: string | undefined;
  let subjects: readonly string[] = [];
  let resolved: Workspace | undefined;
  let workspaceFlag: string | undefined;
  const parts: SubInvocationCost[] = [];

  const workspace = (): Workspace =>
    (resolved ??= resolveWorkspace({
      cwd: options.cwd,
      env: options.env,
      workspaceFlag,
    }));

  return {
    begin(command, commandName) {
      if (command.measured === false) return;
      path = commandName;
    },
    name(named) {
      subjects = named;
    },
    useWorkspace(flag) {
      workspaceFlag = flag;
    },
    workspace,
    ledger: {
      record(cost) {
        parts.push(cost);
      },
    },
    async settle() {
      // Every line of the composition is inside this `try`, not only the send.
      // `settle` runs from a `finally`, so anything it threw would replace the
      // exit code the command earned — and "no verb's outcome may depend on the
      // telemetry channel" (SPEC.md §9.4) has to be a property of the shape
      // rather than a claim about three lines that happen not to throw today.
      try {
        await compose();
      } catch {
        // Nothing is printed and nothing is retried: a measurement is gone, and
        // that is the whole of the event.
      }
    },
  };

  async function compose(): Promise<void> {
    if (path === undefined) return;

    let target: Workspace;
    try {
      target = workspace();
    } catch {
      // No workspace, so no base URL and no token. Nothing to report to, and
      // the caller has already been told what is wrong by the run itself.
      return;
    }

    const at = new Date().toISOString();
    const reports: InvocationReport[] =
      parts.length > 0
        ? parts.map((part) => ({
            command: part.command,
            wroteBytes: part.wroteBytes,
            readBytes: part.readBytes,
            subjects: [...part.subjects],
            at,
          }))
        : [
            {
              command: path,
              wroteBytes: Buffer.byteLength(options.argv.join(" "), "utf8") + stdinBytesRead(),
              readBytes: options.bytesWritten?.() ?? 0,
              subjects: [...subjects],
              at,
            },
          ];

    await sendInvocationReports(target, reports, options.telemetry ?? {});
  }
}

async function invoke(
  command: CommandSpec,
  input: ParsedInput,
  out: Output,
  options: RunOptions,
  registry: Registry,
  measurement: Measurement,
): Promise<void> {
  const context = {
    args: input.args,
    flags: input.flags,
    out,
    cwd: options.cwd,
    env: options.env,
    version: options.version ?? readPackageVersion(),
    registry,
    costs: measurement.ledger,
  };

  if (command.requiresWorkspace === false) {
    await command.handler(context);
    return;
  }

  const actor = resolveActor(input.flags, options.env);

  const workspace = measurement.workspace();
  const timeoutMs = input.flags.number("timeout");
  const client = createClient({
    workspace,
    actor,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  await command.handler({ ...context, workspace, client, actor });
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
