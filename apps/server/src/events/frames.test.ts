// **Where a frame's key list is allowed to be written down** (SERVER-115).
//
// SERVER-114 found one emitter that failed to name a key the changed fact was
// cached under; its sweep found seven more of the same shape, and the reason
// there were seven is structural rather than careless: the key list for "a queue
// change" existed as a shared constant *and* as a hand-written copy inside the
// watcher, and nothing anywhere required the two to agree. Fixing the constant
// silently missed the copy.
//
// So this file does not test behaviour. It tests that the vocabulary stays
// centralised: a module that emits a frame naming the queue or the job list must
// import a **named, individually pinned table** rather than assemble one out of
// key constants at the call site. That is the invariant which, had it existed,
// would have caught the whole family at once — a new emitter cannot quietly
// invent a list, because building one requires naming the raw keys somewhere
// this test can see.
//
// It is deliberately a rule about *source*, not about types. Nothing in the type
// system distinguishes `[QUEUE_KEY, JOBS_KEY, DOCS_KEY]` from
// `QUEUE_QUERY_KEYS`; they are the same value, which is exactly how the copy
// survived review.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTS_KEY, DOCS_KEY, JOBS_KEY, QUEUE_KEY } from "./index.js";
import { PRESENCE_QUERY_KEYS } from "../queue/liveness.js";
import { QUEUE_QUERY_KEYS, QUEUE_TRANSITION_QUERY_KEYS } from "../queue/project.js";
import { REBUILD_QUERY_KEYS } from "../projection/routes.js";

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The modules allowed to name `QUEUE_KEY` or `JOBS_KEY` directly, and what each
 * of them is for.
 *
 * Every entry either *is* the vocabulary (`events/`) or *declares a table* that
 * this file pins by value below. Anything else naming those keys is a call site
 * assembling its own list, which is the defect.
 */
const DECLARES_A_TABLE: ReadonlyMap<string, string> = new Map([
  ["events/keys.ts", "the server's import site for the contract's key vocabulary"],
  ["events/index.ts", "the barrel that re-exports it"],
  ["queue/project.ts", "declares QUEUE_QUERY_KEYS and QUEUE_TRANSITION_QUERY_KEYS"],
  ["queue/liveness.ts", "declares PRESENCE_QUERY_KEYS"],
  ["projection/routes.ts", "declares REBUILD_QUERY_KEYS"],
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) out.push(path);
  }
  return out;
}

describe("the queue and job key vocabulary lives in one place per table", () => {
  it("is named directly only by the modules that declare a table", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => {
        const text = readFileSync(path, "utf8");
        // Comments may discuss a key by name; only code may use one.
        const code = text
          .split("\n")
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
          .join("\n");
        return /\bQUEUE_KEY\b|\bJOBS_KEY\b/.test(code);
      })
      .map((path) => relative(SRC, path).split("\\").join("/"))
      .filter((path) => !DECLARES_A_TABLE.has(path));

    expect(offenders).toEqual([]);
  });

  /**
   * Each declared table, by value. The list above says *where* a table may be
   * written; this says *what* each one is, so a key going missing from one fails
   * here rather than in somebody's stale pill.
   */
  it("pins every declared table whole", () => {
    expect(QUEUE_QUERY_KEYS).toEqual([QUEUE_KEY, JOBS_KEY, DOCS_KEY]);
    expect(QUEUE_TRANSITION_QUERY_KEYS).toEqual([QUEUE_KEY, JOBS_KEY, DOCS_KEY, AGENTS_KEY]);
    expect(REBUILD_QUERY_KEYS).toEqual([DOCS_KEY, ["tree"], QUEUE_KEY, JOBS_KEY, AGENTS_KEY]);
    expect(PRESENCE_QUERY_KEYS).toEqual([AGENTS_KEY, QUEUE_KEY]);
  });

  /**
   * The one thing a "does every queue frame name the roster?" test could not be
   * asserted as, stated as what is actually true instead.
   *
   * The blanket version — *every* frame carrying `["queue"]` or `["jobs"]` also
   * carries `["agents"]` — is **false by design**, and making it true would be a
   * different defect: an enqueue writes a `pending` event and a halt writes a
   * sentinel, and a lane's row reports the work it is *holding*, so neither
   * changes what `GET /api/agents` answers. What is true is that the roster
   * travels with every table derived from rows the roster reads.
   */
  it("names the roster on exactly the tables that move a row the roster reads", () => {
    const namesRoster = (table: readonly unknown[]): boolean =>
      table.some((key) => JSON.stringify(key) === '["agents"]');

    // Moves an event into or out of `in-progress`, replaces every row, or
    // changes a lane's liveness: all three move the roster.
    expect(namesRoster(QUEUE_TRANSITION_QUERY_KEYS)).toBe(true);
    expect(namesRoster(REBUILD_QUERY_KEYS)).toBe(true);
    expect(namesRoster(PRESENCE_QUERY_KEYS)).toBe(true);
    // Counts and the job list moved; no lane's held work did.
    expect(namesRoster(QUEUE_QUERY_KEYS)).toBe(false);
  });
});
