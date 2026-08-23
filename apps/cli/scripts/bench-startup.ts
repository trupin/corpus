/**
 * `npm run bench:startup -w apps/cli` — the fixed cost of one `corpus` call
 * (CLI-058).
 *
 * Every invocation pays for Node booting, for the module graph loading, and for
 * the client reaching the server, before the verb does any work of its own. The
 * agent loop is made of hundreds of invocations, so that fixed cost is a real
 * budget — and it is the kind of number that drifts upward one static import at
 * a time, with nothing failing. This script is how the claim gets re-checked
 * rather than remembered.
 *
 * ## Reading the output
 *
 * Three commands, each spawned `--runs` times:
 *
 * - `node -e ''` — the floor. Nothing below this is available to any change we
 *   could make, short of a different runtime.
 * - `corpus --version` — boot plus the whole module graph. It resolves no
 *   workspace and opens no socket.
 * - `corpus health` — the full fixed cost: the above, plus reading the workspace
 *   config, constructing the client (which is where Node initialises `undici`,
 *   on the first `new Headers()`), and one round trip to a warm local server.
 *
 * The differences between them are the phases. `--json` emits the samples for a
 * caller that wants to do its own arithmetic.
 *
 * ## Two warnings about the numbers
 *
 * **Report the minimum, not the mean.** A benchmark on a developer laptop
 * competes with everything else on it; the median moved by a factor of three
 * across a single afternoon while the minimum barely moved. The minimum is the
 * closest thing here to "what this costs when nothing is in the way".
 *
 * **Measure the shape that ships.** The installed tool is one esbuild bundle
 * (`npm run package:build`), not the ~120 separate modules in `apps/cli/dist`.
 * Loading them one file at a time costs measurably more, so benchmarking `dist`
 * measures a layout no user has. `--cli` defaults to the staged bundle for that
 * reason and says so when it falls back.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

/** The shape that ships, then the built-but-unbundled fallback. */
const CLI_CANDIDATES = [
  resolve(repoRoot, "dist-package", "dist", "corpus.js"),
  resolve(repoRoot, "apps", "cli", "dist", "bin", "corpus.js"),
] as const;

interface Options {
  readonly cli: string;
  readonly bundled: boolean;
  readonly workspace: string;
  readonly runs: number;
  readonly json: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) continue;
    const [name, inline] = token.slice(2).split("=", 2);
    if (name === undefined) continue;
    flags.set(name, inline ?? argv[index + 1] ?? "");
  }

  const requested = flags.get("cli");
  const cli = requested ?? CLI_CANDIDATES.find((candidate) => existsSync(candidate));
  if (cli === undefined) {
    throw new Error(
      "no corpus build to measure — run `npm run build && npm run package:build`, or pass --cli <path>",
    );
  }
  const runs = Number(flags.get("runs") ?? "25");
  if (!Number.isInteger(runs) || runs < 3)
    throw new Error("--runs takes a whole number, 3 or more");

  return {
    cli,
    bundled: cli === CLI_CANDIDATES[0],
    workspace: resolve(flags.get("workspace") ?? process.cwd()),
    runs,
    json: flags.has("json"),
  };
}

interface Measurement {
  readonly label: string;
  readonly samples: readonly number[];
}

function measure(label: string, argv: readonly string[], options: Options): Measurement {
  const samples: number[] = [];
  for (let run = 0; run < options.runs; run += 1) {
    const started = performance.now();
    const result = spawnSync(process.execPath, argv, {
      cwd: options.workspace,
      stdio: "ignore",
    });
    const elapsed = performance.now() - started;
    if (result.status !== 0) {
      throw new Error(
        `${label} exited ${String(result.status)} — the server must be running in ${options.workspace}`,
      );
    }
    samples.push(elapsed);
  }
  return { label, samples };
}

function minimum(measurement: Measurement): number {
  return Math.min(...measurement.samples);
}

function median(measurement: Measurement): number {
  const sorted = [...measurement.samples].sort((one, other) => one - other);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function row(label: string, ms: number, share: number | undefined): string {
  const percent = share === undefined ? "" : `  ${(100 * share).toFixed(0).padStart(3)}%`;
  return `${label.padEnd(46)}${ms.toFixed(1).padStart(8)} ms${percent}`;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));

  const boot = measure("node boot", ["-e", ""], options);
  const version = measure("corpus --version", [options.cli, "--version"], options);
  const health = measure("corpus health", [options.cli, "health"], options);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        cli: options.cli,
        bundled: options.bundled,
        workspace: options.workspace,
        runs: options.runs,
        measurements: [boot, version, health],
      })}\n`,
    );
    return;
  }

  const lines: string[] = [
    `corpus startup cost — ${String(options.runs)} runs each, minimum reported`,
    `  cli:       ${options.cli}${options.bundled ? "" : "  (NOT the packaged bundle — measure dist-package for the real shape)"}`,
    `  workspace: ${options.workspace}`,
    "",
    row("Node boot", minimum(boot), minimum(boot) / minimum(health)),
    row(
      "module graph (bundle parse + imports)",
      minimum(version) - minimum(boot),
      (minimum(version) - minimum(boot)) / minimum(health),
    ),
    row(
      "workspace, client, one round trip",
      minimum(health) - minimum(version),
      (minimum(health) - minimum(version)) / minimum(health),
    ),
    row("TOTAL, one `corpus health`", minimum(health), 1),
    "",
    `medians, for the record: boot ${median(boot).toFixed(1)} ms, --version ${median(version).toFixed(1)} ms, health ${median(health).toFixed(1)} ms`,
    "A median well above the minimum means the machine was busy, not that the tool got slower.",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
