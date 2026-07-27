import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The read-only-filesystem constraint, enforced rather than asserted (CLAUDE.md
 * Architecture Decision 2). The server is the sole writer: a CLI verb that
 * touched a document file, or ran a state-changing git command, would fork the
 * one write path every guarantee in SPEC.md §14 rests on — and it would do so
 * silently, because the result on disk looks the same until two writers race.
 *
 * The scan covers the topics this rule is about — `doc`, `thread`, `db` — and
 * reads the modules as source, so it catches a violation the type system cannot
 * see. Reading (`readFile`, for `--file`) is permitted and lives in
 * `src/input.ts`, outside the command modules.
 */

const TOPICS = ["doc", "thread", "db"] as const;

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

/** Anything that could shell out at all; the CLI runs no subprocess of any kind. */
const FORBIDDEN_PROCESS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"];

const FORBIDDEN_IMPORTS = [
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "child_process",
  "fs/promises",
];

interface Module {
  readonly path: string;
  readonly source: string;
  /** Comments and string literals removed, so prose about "rename" is not a violation. */
  readonly code: string;
}

async function commandModules(): Promise<readonly Module[]> {
  const root = import.meta.dirname;
  const modules: Module[] = [];

  for (const topic of TOPICS) {
    const dir = join(root, topic);
    for (const entry of await readdir(dir)) {
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || entry === "fixtures.ts") continue;
      const path = join(dir, entry);
      const source = await readFile(path, "utf8");
      modules.push({ path: `${topic}/${entry}`, source, code: stripProse(source) });
    }
  }
  return modules;
}

function stripProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

describe("the doc, thread and db verbs never write to the filesystem", () => {
  it("finds the modules it is supposed to be guarding", async () => {
    const modules = await commandModules();
    expect(modules.map((module) => module.path).sort()).toEqual([
      "db/doctor.ts",
      "db/index.ts",
      "db/rebuild.ts",
      "doc/archive.ts",
      "doc/create.ts",
      "doc/delete.ts",
      "doc/edit.ts",
      "doc/index.ts",
      "doc/move.ts",
      "thread/index.ts",
      "thread/reply.ts",
      "thread/status.ts",
    ]);
  });

  it("imports no filesystem or subprocess module", async () => {
    for (const module of await commandModules()) {
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(module.source, `${module.path} imports ${forbidden}`).not.toMatch(
          new RegExp(`from\\s+["']${forbidden.replace("/", "\\/")}["']`),
        );
      }
    }
  });

  it("calls no write API and spawns no process", async () => {
    for (const module of await commandModules()) {
      for (const forbidden of [...FORBIDDEN_FS, ...FORBIDDEN_PROCESS]) {
        expect(module.code, `${module.path} calls ${forbidden}`).not.toMatch(
          new RegExp(`\\b${forbidden}\\s*\\(`),
        );
      }
    }
  });

  it("runs no git command, state-changing or otherwise", async () => {
    for (const module of await commandModules()) {
      expect(module.code, `${module.path} mentions git in code`).not.toMatch(/\bgit\b/);
    }
  });

  it("builds every request through the generated typed client", async () => {
    for (const module of await commandModules()) {
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
