import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two constraints that are enforced rather than asserted, because both fail
 * silently in production and neither is visible to the type system.
 *
 * **The server is the sole writer** (CLAUDE.md Architecture Decision 2). A CLI
 * verb that touched a document file, or ran a state-changing git command, would
 * fork the one write path every guarantee in SPEC.md §14 rests on — and the
 * result on disk looks the same until two writers race. That scan covers the
 * topics the rule is about: `doc`, `thread`, `db`, and `index-maintenance` —
 * the `corpus index` verbs, whose directory is named for the barrel collision it
 * avoids. The lifecycle and scaffolding
 * topics (`server`, `init`) legitimately write the CLI's own two files — the
 * pidfile and the log (SPEC.md §2.2 rule 4) — and create the workspace itself.
 *
 * That rule has **one** admitted exception, and it is named rather than
 * implicit (sprint-013 Adjudication 12, Open Conflict 8). `corpus doc check
 * --staged` must validate the content in git's **index**, which exists neither
 * on disk nor on the server, so no HTTP call can produce it. The plumbing lives
 * in `src/staged.ts` — outside these prefixes, one file, refusing any git
 * subcommand outside a read-only allowlist before it spawns anything — and
 * exactly one guarded module may import it, pinned below by name. Every other
 * prohibition is untouched: a guarded module still imports no `node:fs` and no
 * `node:child_process`, still calls no `exec*`/`spawn*`, still writes nothing,
 * and still may not name git itself.
 *
 * **`process.stdin` is reachable from exactly one file** (CLI-007, CLI-008 item
 * 5). An agent harness hands its child a socket on fd 0 that never ends, so a
 * verb that reads stdin because it "is not a TTY" hangs forever with no way to
 * see why. `src/input.ts` holds the `fstat` probe that tells a heredoc and a
 * pipe from that socket, and exports the two accessors every other module uses.
 * That rule is absolute and has no per-file exemptions: an exemption list is how
 * the next module talks its way onto the exception.
 *
 * Both scans read the modules as source, with comments and string literals
 * stripped, so prose about "rename" or about stdin is not a violation.
 */

/** Topics whose verbs are pure API clients: they may not touch the filesystem at all. */
const WRITE_RESTRICTED_TOPICS = ["doc", "thread", "db", "index-maintenance"];

/** Write APIs, their sync twins, and the stream that bypasses both. */
const FORBIDDEN_FS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "rename",
  "renameSync",
  "unlink",
  "unlinkSync",
  "mkdir",
  "mkdirSync",
  "rmdir",
  "rmdirSync",
  "rmSync",
  "copyFile",
  "copyFileSync",
  "truncate",
  "createWriteStream",
];

/** Anything that could shell out at all; these verbs run no subprocess of any kind. */
const FORBIDDEN_PROCESS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"];

const FORBIDDEN_IMPORTS = [
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "child_process",
  "fs/promises",
];

/** The one file allowed to name `process.stdin`, relative to the scanned root. */
const STDIN_OWNER = "input.ts";

const STDIN_REFERENCE = /\bprocess\s*\.\s*stdin\b/;

/**
 * The guarded modules permitted to reach the read-only staged-git helper, and
 * the only capability admitted through these prefixes at all. Exhaustive on
 * purpose: a second verb wanting the index shows up here as a failing diff and
 * has to justify itself in review.
 */
const STAGED_HELPER_IMPORTERS = ["doc/check.ts"];

const STAGED_HELPER_IMPORT = /from\s+["'][^"']*\/staged\.js["']/;

interface Module {
  /** Path relative to the scan's root, with `/` separators on every platform. */
  readonly path: string;
  readonly source: string;
  /** Comments and string literals removed, so prose about "rename" is not a violation. */
  readonly code: string;
}

const commandsRoot = import.meta.dirname;
const sourceRoot = join(commandsRoot, "..");

async function modulesUnder(root: string): Promise<readonly Module[]> {
  const modules: Module[] = [];

  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    if (entry.name === "fixtures.ts") continue;

    const absolute = join(entry.parentPath, entry.name);
    const source = await readFile(absolute, "utf8");
    modules.push({
      path: relative(root, absolute).split(sep).join("/"),
      source,
      code: stripProse(source),
    });
  }
  return modules.sort((one, other) => one.path.localeCompare(other.path));
}

/** Every command module, whatever topic it belongs to — nothing is out of scope by being new. */
function commandModules(): Promise<readonly Module[]> {
  return modulesUnder(commandsRoot);
}

async function writeRestrictedModules(): Promise<readonly Module[]> {
  const modules = await commandModules();
  return modules.filter((module) =>
    WRITE_RESTRICTED_TOPICS.some((topic) => module.path.startsWith(`${topic}/`)),
  );
}

/** `<path> calls <api>` for every write API or subprocess call in the modules. */
function processViolations(modules: readonly Module[]): readonly string[] {
  return modules.flatMap((module) =>
    [...FORBIDDEN_FS, ...FORBIDDEN_PROCESS]
      .filter((forbidden) => new RegExp(`\\b${forbidden}\\s*\\(`).test(module.code))
      .map((forbidden) => `${module.path} calls ${forbidden}`),
  );
}

/** Modules naming git in code rather than in prose — none may, whatever the subcommand. */
function gitViolations(modules: readonly Module[]): readonly string[] {
  return modules.filter((module) => /\bgit\b/.test(module.code)).map((module) => module.path);
}

function stdinViolations(modules: readonly Module[]): readonly string[] {
  return modules
    .filter((module) => module.path !== STDIN_OWNER && STDIN_REFERENCE.test(module.code))
    .map((module) => module.path);
}

function stripProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** A module that does the wrong thing, built in memory so the rule can be shown catching it. */
function fabricate(path: string, body: string): Module {
  return { path, source: body, code: stripProse(body) };
}

describe("the doc, thread and db verbs never write to the filesystem", () => {
  it("finds the modules it is supposed to be guarding", async () => {
    const modules = await writeRestrictedModules();
    expect(modules.map((module) => module.path)).toEqual([
      "db/doctor.ts",
      "db/index.ts",
      "db/rebuild.ts",
      "doc/archive-toggle.ts",
      "doc/archive.ts",
      "doc/check.ts",
      "doc/create.ts",
      "doc/delete.ts",
      "doc/detach.ts",
      "doc/diff.ts",
      "doc/edit.ts",
      "doc/frontmatter.ts",
      "doc/index.ts",
      "doc/list.ts",
      "doc/move.ts",
      "doc/patch.ts",
      "doc/related.ts",
      "doc/render.ts",
      "doc/show.ts",
      "doc/unarchive.ts",
      "index-maintenance/index.ts",
      "index-maintenance/rebuild.ts",
      "index-maintenance/status.ts",
      "thread/context.ts",
      "thread/create.ts",
      "thread/designate.ts",
      "thread/index.ts",
      "thread/release.ts",
      "thread/reply.ts",
      "thread/show.ts",
      "thread/status.ts",
    ]);
  });

  it("imports no filesystem or subprocess module", async () => {
    for (const module of await writeRestrictedModules()) {
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(module.source, `${module.path} imports ${forbidden}`).not.toMatch(
          new RegExp(`from\\s+["']${forbidden.replace("/", "\\/")}["']`),
        );
      }
    }
  });

  it("calls no write API and spawns no process", async () => {
    expect(processViolations(await writeRestrictedModules())).toEqual([]);
  });

  it("catches a spawned git command and names the file", () => {
    const rogue = fabricate(
      "doc/rogue.ts",
      'export function rogue() { spawnSync("git", ["commit", "-m", "x"]); }',
    );
    expect(processViolations([rogue])).toEqual(["doc/rogue.ts calls spawnSync"]);
    expect(gitViolations([rogue])).toEqual([]); // the word is inside a string literal…
    expect(gitViolations([fabricate("doc/rogue2.ts", "export const c = git.commit();")])).toEqual([
      "doc/rogue2.ts",
    ]);
  });

  it("runs no git command, state-changing or otherwise", async () => {
    expect(gitViolations(await writeRestrictedModules())).toEqual([]);
  });

  it("admits the read-only staged helper in exactly one guarded module", async () => {
    // The whole of Adjudication 12's carve-out, asserted rather than assumed:
    // one importer, named. `staged.ts` itself proves it is read-only, in
    // `src/staged.test.ts`.
    const importers = (await writeRestrictedModules())
      .filter((module) => STAGED_HELPER_IMPORT.test(module.source))
      .map((module) => module.path);
    expect(importers).toEqual(STAGED_HELPER_IMPORTERS);
  });

  it("builds every request through the generated typed client", async () => {
    for (const module of await writeRestrictedModules()) {
      // No hand-rolled transport, and no hand-written URL.
      expect(module.code, `${module.path} calls fetch directly`).not.toMatch(/\bfetch\s*\(/);
      expect(module.source, `${module.path} hand-builds a URL`).not.toMatch(/https?:\/\//);

      const callsApi = /\bapi\.(GET|POST|PUT|DELETE|PATCH)\(/.test(module.code);
      const callsUntimed = /untimedApi\.(GET|POST|PUT|DELETE|PATCH)\(/.test(module.code);
      if (callsApi || callsUntimed) {
        expect(module.code, `${module.path} bypasses client.request`).toMatch(
          /client\.request\(|context\.client\.request\(/,
        );
      }
    }
  });
});

describe("nothing outside input.ts touches process.stdin", () => {
  it("scans every command module, not a chosen few", async () => {
    // The list is exhaustive on purpose: a new verb joins the scan by existing,
    // and a new topic directory shows up here as a failing diff rather than as
    // an unguarded module.
    const modules = await commandModules();
    expect(modules.map((module) => module.path)).toEqual([
      "age.ts",
      "agents.ts",
      "columns.ts",
      "db/doctor.ts",
      "db/index.ts",
      "db/rebuild.ts",
      "doc/archive-toggle.ts",
      "doc/archive.ts",
      "doc/check.ts",
      "doc/create.ts",
      "doc/delete.ts",
      "doc/detach.ts",
      "doc/diff.ts",
      "doc/edit.ts",
      "doc/frontmatter.ts",
      "doc/index.ts",
      "doc/list.ts",
      "doc/move.ts",
      "doc/patch.ts",
      "doc/related.ts",
      "doc/render.ts",
      "doc/show.ts",
      "doc/unarchive.ts",
      "filters.ts",
      "health.ts",
      "index-maintenance/index.ts",
      "index-maintenance/rebuild.ts",
      "index-maintenance/status.ts",
      "init/git.ts",
      "init/index.ts",
      "init/port.ts",
      "init/scaffold.ts",
      "job/console.ts",
      "job/index.ts",
      "job/log.ts",
      "queue/claim-all.ts",
      "queue/control.ts",
      "queue/defer.ts",
      "queue/idle.ts",
      "queue/in-progress.ts",
      "queue/index.ts",
      "queue/lane.ts",
      "queue/poll.ts",
      "queue/transitions.ts",
      "retrieval.ts",
      "search.ts",
      "server/daemon.ts",
      "server/index.ts",
      "server/logs.ts",
      "server/start.ts",
      "server/state.ts",
      "server/status.ts",
      "server/stop.ts",
      "skill/create.ts",
      "skill/index.ts",
      "thread/context.ts",
      "thread/create.ts",
      "thread/designate.ts",
      "thread/index.ts",
      "thread/release.ts",
      "thread/reply.ts",
      "thread/show.ts",
      "thread/status.ts",
      "upgrade/index.ts",
      "upgrade/install.ts",
      "upgrade/journal.ts",
      "upgrade/release.ts",
      "workspace/diff.ts",
      "workspace/index.ts",
      "workspace/maintain.ts",
      "workspace/maintenance.ts",
      "workspace/unified-diff.ts",
      "workspace/upgrade.ts",
    ]);
  });

  it("finds no reference in any command module", async () => {
    expect(stdinViolations(await commandModules())).toEqual([]);
  });

  it("finds no reference anywhere else in the CLI either", async () => {
    // `src/input.ts` is the owner; `src/testing/stdin.ts` names it in prose
    // only, which `stripProse` removes before the rule ever sees it.
    expect(stdinViolations(await modulesUnder(sourceRoot))).toEqual([]);
  });

  it("catches a real violation and names the file", () => {
    const rogue = fabricate(
      "queue/rogue.ts",
      "export async function rogue() { return readAll(process.stdin); }",
    );
    expect(stdinViolations([rogue])).toEqual(["queue/rogue.ts"]);

    const sneaky = fabricate("job/sneaky.ts", "const tty = process . stdin . isTTY;");
    expect(stdinViolations([sneaky])).toEqual(["job/sneaky.ts"]);
  });

  it("does not mistake prose for a read", () => {
    const documented = fabricate(
      "doc/documented.ts",
      "/** Never reads process.stdin. */\nexport const note = 'process.stdin is off limits';\n",
    );
    expect(stdinViolations([documented])).toEqual([]);
  });
});
