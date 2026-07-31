import { COLUMN_REF_PATTERN, RESERVED_FRONTMATTER_KEYS } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError } from "../../errors.js";
import { ParsedFlags, type FlagValue } from "../../parse-args.js";
import {
  combineExtraPatches,
  parseColumn,
  parseExtraFlags,
  parseExtraJsonFlags,
  parseExtraValue,
  parseOrder,
  parseQuery,
  parseViewFlags,
  VIEW_KEY_FLAGS,
} from "./frontmatter.js";

const flagsOf = (values: Record<string, FlagValue>): ParsedFlags =>
  new ParsedFlags(new Map(Object.entries(values)));

const hint = (error: unknown): string => (isCliError(error) ? (error.hint ?? "") : "");

const thrown = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected a throw");
};

describe("the shared value grammar", () => {
  // The grammar itself is pinned by `edit.test.ts`, which is where it is
  // documented; these cases exist because `--order` and `--query` now depend on
  // the *type* it returns, not only on its values.
  it.each([
    ["null", null],
    ["true", true],
    ["false", false],
    ["520", 520],
    ["-1.5", -1.5],
    ['"520"', "520"],
    ["007", "007"],
    ["1e400", "1e400"],
    ["", ""],
  ])("maps %s to a single scalar", (raw, expected) => {
    expect(parseExtraValue(raw)).toBe(expected);
  });
});

describe("--extra-json", () => {
  it("carries an object into the same merge patch --extra writes", () => {
    expect(parseExtraJsonFlags(['publish={"target":"blog","draft":true}'])).toEqual({
      publish: { target: "blog", draft: true },
    });
  });

  it("carries the array-of-objects shape a plugin key actually has", () => {
    // SPEC.md §12's `todo` document: the shape CONTRACT-011 sized
    // `EXTRA_MAX_DEPTH` around, and the one `--extra` could never express.
    expect(parseExtraJsonFlags(['items=[{"text":"Ship it","done":false}]'])).toEqual({
      items: [{ text: "Ship it", done: false }],
    });
  });

  it("keeps `null` meaning deletion, exactly as --extra does", () => {
    expect(parseExtraJsonFlags(["publish=null"])).toEqual({ publish: null });
  });

  it("bounds nothing itself — a deep value goes to the server that owns the limit", () => {
    // `EXTRA_MAX_DEPTH` is the contract's and is enforced over the whole merged
    // object; a second CLI-side limit could only disagree with it.
    const deep = parseExtraJsonFlags(["k=" + "[".repeat(12) + "1" + "]".repeat(12)]);
    expect(deep).toBeDefined();
  });

  it("is a usage error on text that is not JSON, before any request", () => {
    const error = thrown(() => parseExtraJsonFlags(["publish={target: blog}"]));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("not valid JSON");
    expect(hint(error)).toContain("--extra");
  });

  it("refuses a core key too, naming the flag that writes it", () => {
    const error = thrown(() => parseExtraJsonFlags(['query={"type":"note"}']));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(hint(error)).toContain("--query");
  });

  it.each(["publish", "=1"])("is a usage error on the pair shape %s", (entry) => {
    expect(exitCodeFor(thrown(() => parseExtraJsonFlags([entry])))).toBe(ExitCode.usageError);
  });

  it("sends nothing when the flag was not given", () => {
    expect(parseExtraJsonFlags([])).toBeUndefined();
  });
});

describe("combining the two extra flags", () => {
  it("passes either one through alone", () => {
    expect(combineExtraPatches({ width: 520 }, undefined)).toEqual({ width: 520 });
    expect(combineExtraPatches(undefined, { publish: {} })).toEqual({ publish: {} });
    expect(combineExtraPatches(undefined, undefined)).toBeUndefined();
  });

  it("merges disjoint keys into one patch", () => {
    expect(combineExtraPatches({ width: 520 }, { publish: { target: "blog" } })).toEqual({
      width: 520,
      publish: { target: "blog" },
    });
  });

  it("refuses a key set by both rather than picking a winner nobody could predict", () => {
    const error = thrown(() => combineExtraPatches({ publish: "x" }, { publish: {} }));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("publish");
  });
});

describe("--order", () => {
  it.each([
    ["4", 4],
    ["1.5", 1.5],
    ["-2", -2],
    ["0", 0],
    ["null", null],
  ])("takes %s", (raw, expected) => {
    expect(parseOrder(raw)).toBe(expected);
  });

  it("is absent when the flag is", () => {
    expect(parseOrder(undefined)).toBeUndefined();
  });

  it.each(["1e400", "007", "1.", "first", "", '"4"'])(
    "refuses %s rather than writing a quoted number the board cannot sort on",
    (raw) => {
      const error = thrown(() => parseOrder(raw));
      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
      expect(String(error)).toContain("--order");
    },
  );
});

describe("--column", () => {
  it("takes a plugin reference and clears with null", () => {
    expect(parseColumn("todos/todos")).toBe("todos/todos");
    expect(parseColumn("null")).toBeNull();
    expect(parseColumn(undefined)).toBeUndefined();
  });

  it("accepts a reference to a plugin that is not installed — the shape is the whole check", () => {
    expect(parseColumn("not-installed/board")).toBe("not-installed/board");
  });

  it.each(["nonsense", "a/b/c", "a/", "/b", "a b/c", "a/b c"])("refuses %s", (raw) => {
    const error = thrown(() => parseColumn(raw));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("<plugin>/<type>");
    expect(hint(error)).toContain("Exactly one slash");
  });

  it("agrees with the contract's own pattern rather than re-typing it", () => {
    // Imported, not copied: a reference the request schema would accept is
    // accepted here, and one it would reject never leaves the process.
    for (const raw of ["todos/todos", "not-installed/board", "nonsense", "a/b/c", "a b/c"]) {
      const accepted = COLUMN_REF_PATTERN.test(raw);
      if (accepted) expect(parseColumn(raw), raw).toBe(raw);
      else expect(exitCodeFor(thrown(() => parseColumn(raw))), raw).toBe(ExitCode.usageError);
    }
  });
});

describe("--query", () => {
  it("builds a flat map from repeated pairs", () => {
    expect(parseQuery(["type=thread", "status=open", "tag=finance"])).toEqual({
      type: "thread",
      status: "open",
      tag: "finance",
    });
  });

  it("round-trips the Attention seed's own value", () => {
    expect(parseQuery(["needs=me"])).toEqual({ needs: "me" });
  });

  it("reads a comma as the OR the wire form already means", () => {
    expect(parseQuery(["type=note,view"])).toEqual({ type: ["note", "view"] });
  });

  it("keeps a comma inside a quoted value", () => {
    // What the shell delivers for `--query q='"salt, pepper"'`: the JSON string
    // literal is the escape hatch from the OR split, exactly as it is `--extra`'s
    // escape hatch from the number rule.
    expect(parseQuery(['q="salt, pepper"'])).toEqual({ q: "salt, pepper" });
  });

  it("types booleans and finite numbers the way --extra does", () => {
    expect(parseQuery(["includeArchived=true", "limit=50", "q=007"])).toEqual({
      includeArchived: true,
      limit: 50,
      q: "007",
    });
  });

  it("clears the whole map with null", () => {
    expect(parseQuery(["null"])).toBeNull();
  });

  it("is absent when the flag is", () => {
    expect(parseQuery([])).toBeUndefined();
  });

  it("refuses `null` combined with pairs — that is two contradictory instructions", () => {
    const error = thrown(() => parseQuery(["null", "type=thread"]));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("clears the whole query");
  });

  it("takes the last value when a key is repeated", () => {
    expect(parseQuery(["type=note", "type=view"])).toEqual({ type: "view" });
  });

  it.each(['filters={"type":"note"}', "type=[note]"])(
    "refuses the nested value in %s, saying the map is flat",
    (entry) => {
      const error = thrown(() => parseQuery([entry]));
      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
      expect(String(error)).toContain("flat map");
    },
  );

  it("refuses a null value, which is not a filter", () => {
    const error = thrown(() => parseQuery(["tag=null"]));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(hint(error)).toContain("--query null");
  });

  it("refuses a blank entry inside an OR list", () => {
    expect(exitCodeFor(thrown(() => parseQuery(["type=note,,view"])))).toBe(ExitCode.usageError);
  });

  it.each(["type", "=thread"])("is a usage error on the pair shape %s", (entry) => {
    expect(exitCodeFor(thrown(() => parseQuery([entry])))).toBe(ExitCode.usageError);
  });
});

describe("the view flags as a patch fragment", () => {
  it("names only the keys the caller named", () => {
    expect(parseViewFlags(flagsOf({ pinned: "true" }))).toEqual({ pinned: true });
    expect(parseViewFlags(flagsOf({}))).toEqual({});
  });

  it("carries all four at once", () => {
    expect(
      parseViewFlags(
        flagsOf({ pinned: "true", order: "4", query: ["type=thread"], column: "todos/todos" }),
      ),
    ).toEqual({ pinned: true, order: 4, query: { type: "thread" }, column: "todos/todos" });
  });

  it("carries every clearing form", () => {
    expect(
      parseViewFlags(flagsOf({ pinned: "false", order: "null", query: ["null"], column: "null" })),
    ).toEqual({ pinned: false, order: null, query: null, column: null });
  });

  it("refuses a non-boolean --pinned", () => {
    expect(exitCodeFor(thrown(() => parseViewFlags(flagsOf({ pinned: "yes" }))))).toBe(
      ExitCode.usageError,
    );
  });
});

describe("the flag declarations", () => {
  it("declares the four view keys once, for both verbs to share", () => {
    expect(VIEW_KEY_FLAGS.map((flag) => flag.name)).toEqual(["pinned", "order", "query", "column"]);
    expect(VIEW_KEY_FLAGS.find((flag) => flag.name === "query")?.repeated).toBe(true);
  });

  it("names every reserved view key in a flag, so the refusal has somewhere to point", () => {
    const named = new Set(VIEW_KEY_FLAGS.map((flag) => flag.name));
    for (const key of ["pinned", "order", "query", "column"]) {
      expect(RESERVED_FRONTMATTER_KEYS).toContain(key);
      expect(named.has(key), key).toBe(true);
    }
  });
});

describe("the reserved-key refusal covers the view keys", () => {
  it.each([
    ["pinned=true", "--pinned"],
    ["order=1", "--order"],
    ["query=x", "--query"],
    ["column=a/b", "--column"],
  ])("refuses --extra %s and names %s", (entry, flag) => {
    const error = thrown(() => parseExtraFlags([entry]));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is a core frontmatter key");
    expect(hint(error)).toContain(flag);
  });
});
