import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Three constraints that are enforced rather than asserted, because each fails
 * silently in production and none is visible to the type system.
 *
 * **The server is the sole writer** (CLAUDE.md Architecture Decision 2). A CLI
 * verb that touched a document file, or ran a state-changing git command, would
 * fork the one write path every guarantee in SPEC.md §11 rests on — and the
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
 * **Every heredoc this CLI demonstrates terminates with `CORPUS_EOF`.** The
 * bodies the agent sends are text it is carrying on someone else's behalf — a
 * pasted shell transcript above all — and a carried line reading `EOF` ends an
 * `<<'EOF'` heredoc early, so the shell runs the remainder of the message as
 * commands and the document silently loses the rest. Measured, not theorised: a
 * planted `touch /tmp/pwned.txt` executed, exit 0, three lines dropped. The
 * defence is a terminator chosen once rather than weighed per message, because
 * weighing it per message is inspection, and inspection is the check this
 * construction exists to replace. The CLI's own help is where an agent looks
 * when it is stuck, so it may not demonstrate the word the workspace skills
 * forbid (`assets/workspace/`, PR #50). What is forbidden is the
 * **demonstration** — an opener with any other delimiter, or a closing line
 * that is the bare word — not the mention: the hint `requireBody` raises names
 * `EOF` in order to rule it out, and a check that could not tell the two apart
 * would forbid stating the rule.
 *
 * The first two scans read the modules as source, with comments and string
 * literals stripped, so prose about "rename" or about stdin is not a violation;
 * the third reads the source whole, because a heredoc only ever appears inside
 * a string literal or a doc comment.
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

const SAFE_TERMINATOR = "CORPUS_EOF";

/**
 * A shell heredoc opener and its delimiter: `<<X`, `<<'X'`, `<<"X"`, `<<-X`, in
 * **any** case.
 *
 * The bare alternative used to be `[A-Z_][A-Z0-9_]*`, so that a left shift by a
 * lowercase identifier could not be read as an opener — and the same sentence
 * then observed that this CLI shifts no bits at all, which is the argument for
 * not needing the restriction rather than for keeping it. It cost a real case
 * (PR #50 review 3, NIT 7): `<<eof … eof` is a heredoc the shell honours exactly
 * as it honours `<<EOF … EOF`, carried text containing a line reading `eof`
 * truncates it exactly the same way, and both halves of this rule were blind to
 * it. {@link TERMINATOR_LINE} is matched case-insensitively for the same reason.
 *
 * Only the exact `CORPUS_EOF` is safe, so a lowercase `corpus_eof` is a
 * violation too — a shell delimiter is case-sensitive, and half of why the safe
 * word is safe is that it is spelled the one way everything else in this CLI
 * spells it.
 */
const HEREDOC_OPENER = /<<-?\s*(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)"|([A-Za-z_]\w*))/g;

/**
 * A line that is nothing but the closing terminator, once the TypeScript around
 * it is stripped: `EOF`, `"EOF"`, `"EOF",`, `EOF" +`, `eof`. This is the half
 * that catches a demonstration opened safely and closed with the forgeable word.
 */
const TERMINATOR_LINE = /^[\s"'`+,;)\]}]*EOF[\s"'`+,;)\]}]*$/i;

/**
 * `<path>:<line> <what>` for every heredoc demonstrated with a terminator other
 * than `CORPUS_EOF`.
 *
 * The source is read with the literal two-character `\n` escape turned into a
 * real newline first, because an example's terminator sits mid-string-literal —
 * `"… <<'CORPUS_EOF'\nbody\nCORPUS_EOF"` is one source line holding three.
 *
 * Naming the word in prose is deliberately **not** a violation: the hint
 * `requireBody` raises says "never `EOF`", and a rule that could not tell a
 * demonstration from a warning about one would forbid stating the rule.
 */
function heredocViolations(modules: readonly Module[]): readonly string[] {
  return modules.flatMap((module) =>
    module.source
      .replaceAll("\\n", "\n")
      .split("\n")
      .flatMap((line, index) => {
        const where = `${module.path}:${index + 1}`;
        const openers = [...line.matchAll(HEREDOC_OPENER)]
          .map(([, quoted, doubleQuoted, bare]) => quoted ?? doubleQuoted ?? bare)
          .filter((delimiter) => delimiter !== SAFE_TERMINATOR)
          .map((delimiter) => `${where} opens a heredoc with ${delimiter}`);
        return TERMINATOR_LINE.test(line) ? [...openers, `${where} closes one with EOF`] : openers;
      }),
  );
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
      "doc/sections.ts",
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
      "thread/scope.ts",
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
      "doc/sections.ts",
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
      "resident.ts",
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
      "thread/scope.ts",
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

describe("every heredoc the CLI demonstrates terminates with CORPUS_EOF", () => {
  it("finds none anywhere in the CLI's source", async () => {
    // Whole-source, not commands-only: the hint `requireBody` raises on an
    // empty body lives in `src/input.ts`, and that is the one an agent reads at
    // the moment it is stuck with no body to send.
    expect(heredocViolations(await modulesUnder(sourceRoot))).toEqual([]);
  });

  it("catches a help example, both halves of it, and names the line", () => {
    const example = fabricate(
      "doc/rogue.ts",
      "export const examples = [\n" +
        "  { command: \"corpus doc create --from agent <<'EOF'\\nbody\\nEOF\" },\n" +
        "];\n",
    );
    expect(heredocViolations([example])).toEqual([
      "doc/rogue.ts:2 opens a heredoc with EOF",
      "doc/rogue.ts:4 closes one with EOF",
    ]);
  });

  it("catches an unquoted opener, a terminator split across a concatenation, and an invention", () => {
    const unquoted = fabricate("thread/rogue.ts", "/** Pipe it in: `… <<EOF … EOF`. */\n");
    expect(heredocViolations([unquoted])).toEqual(["thread/rogue.ts:1 opens a heredoc with EOF"]);

    // How the last site of this fix hid: the opener was rewritten, the closing
    // terminator sat on its own source line as a separate string literal.
    const split = fabricate(
      "doc/split.ts",
      "const command =\n  \"corpus doc patch <id> --stdin <<'CORPUS_EOF'\\n\" +\n  '{}\\n' +\n  \"EOF\";\n",
    );
    expect(heredocViolations([split])).toEqual(["doc/split.ts:6 closes one with EOF"]);

    const invented = fabricate("doc/invented.ts", "const c = \"corpus doc create <<'BODY'\";\n");
    expect(heredocViolations([invented])).toEqual(["doc/invented.ts:1 opens a heredoc with BODY"]);
  });

  // The case the rule used to walk straight past: the shell does not care, so
  // neither half of this may (PR #50 review 3, NIT 7).
  it("catches a lowercase delimiter, in both halves", () => {
    const lower = fabricate("doc/lower.ts", 'const c = "corpus doc create <<eof\\nbody\\neof";\n');
    expect(heredocViolations([lower])).toEqual([
      "doc/lower.ts:1 opens a heredoc with eof",
      "doc/lower.ts:3 closes one with EOF",
    ]);

    const mixed = fabricate("doc/mixed.ts", "const c = \"corpus doc create <<'Eof'\";\n");
    expect(heredocViolations([mixed])).toEqual(["doc/mixed.ts:1 opens a heredoc with Eof"]);
  });

  it("does not mistake the safe terminator, or a warning about the unsafe one, for a demonstration", () => {
    const safe = fabricate(
      "doc/safe.ts",
      "export const example = \"corpus doc create --from agent <<'CORPUS_EOF'\\nbody\\nCORPUS_EOF\";\n",
    );
    expect(heredocViolations([safe])).toEqual([]);

    const warning = fabricate(
      "doc/warning.ts",
      'const hint = "Always `CORPUS_EOF`, never `EOF`: carried text can contain a line reading `EOF`.";\n',
    );
    expect(heredocViolations([warning])).toEqual([]);
  });
});
