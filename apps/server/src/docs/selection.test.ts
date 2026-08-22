// Compiling §10's whole-result-set query (SERVER-087).
//
// The act itself is exercised end-to-end in `bulk.test.ts`, against a real
// workspace and real git output. What is asserted here is the translation on its
// own: a stored view's value shapes are not the wire's, and the two ways this can
// be silently wrong — a value that compiles to something narrower than it means,
// and a key that compiles to nothing at all — leave no trace in the result,
// because a Save reports what it changed and not what it looked for.

import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import { compileSelectionQuery } from "./selection.js";

interface Issue {
  readonly path: string;
  readonly message: string;
}

/** The `400` a bad query raises, as its issues — or a failure if it did not raise. */
function refusalOf(query: Record<string, unknown>): Issue[] {
  try {
    compileSelectionQuery(query as Parameters<typeof compileSelectionQuery>[0]);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    const http = error as HttpError;
    expect(http.status).toBe(400);
    return (http.body as { issues: Issue[] }).issues;
  }
  throw new Error(`expected ${JSON.stringify(query)} to be refused`);
}

const pathsOf = (issues: readonly Issue[]): string[] => issues.map((issue) => issue.path);

describe("compiling a stored query into the collection query", () => {
  it("ORs an array as the comma-separated form the grammar already takes", () => {
    // `{type: ["note","view"]}` ≡ `type=note,view` — the translation
    // `ViewQuerySchema` itself states, so a column and a Save select alike.
    expect(compileSelectionQuery({ type: ["note", "view"], tag: ["a", "b"] })).toMatchObject({
      type: "note,view",
      tag: "a,b",
    });
  });

  it("carries booleans and numbers through in their wire spelling", () => {
    expect(compileSelectionQuery({ includeArchived: true, pinned: false })).toMatchObject({
      includeArchived: true,
      pinned: false,
    });
    expect(compileSelectionQuery({ limit: 5 })).toMatchObject({ limit: 5 });
  });

  it("fills the collection query's own defaults, so the act runs the same statement", () => {
    expect(compileSelectionQuery({ tag: "finance" })).toMatchObject({ sort: "-updated" });
  });

  it("refuses an unrecognised key, naming each one", () => {
    const issues = refusalOf({ tag: "finance", colour: "blue", shape: "round" });
    expect(pathsOf(issues)).toEqual(["wholeResultSet.query.colour", "wholeResultSet.query.shape"]);
    expect(issues[0]?.message).toContain("`colour`");
    expect(issues[1]?.message).toContain("`shape`");
  });

  it("refuses a value the grammar does not accept, at that value's own path", () => {
    expect(pathsOf(refusalOf({ status: "half-done" }))).toEqual(["wholeResultSet.query.status"]);
    // The collection query's own cross-field rule, reported the same way rather
    // than swallowed: `sort=relevance` means nothing without something to rank.
    expect(pathsOf(refusalOf({ sort: "relevance" }))).toEqual(["wholeResultSet.query.sort"]);
  });
});
