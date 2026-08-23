import { RESERVED_FRONTMATTER_KEYS } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError } from "../../errors.js";
import { ParsedFlags, type FlagValue } from "../../parse-args.js";
import {
  BOARD_KEY_FLAGS,
  combineExtraPatches,
  parseBoardFlags,
  parseColumns,
  parseExtraFlags,
  parseExtraJsonFlags,
  parseExtraValue,
  parseKanban,
  parseOrder,
  parseQuery,
  parseStage,
  parseUnsetKeys,
  UNSET_FLAG,
} from "./frontmatter.js";
import type { FlagSpec } from "../../registry/types.js";

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

  it("carries the array-of-objects shape an extra key actually has", () => {
    // A document carrying a list of records under its own key: the shape
    // CONTRACT-011 sized
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

/**
 * `column` was a view key with a flag of its own until SHARED-066 (it named a
 * plugin renderer, `<plugin>/<type>`, and there are no plugins). It is now an
 * ordinary key the core does not define, which is exactly what `--extra` is
 * for — so the flag is gone and the key is *writable*, where naming a core key
 * there is still a usage error.
 */
describe("`column` after the plugin surface went", () => {
  it("is no longer a reserved key", () => {
    expect(RESERVED_FRONTMATTER_KEYS).not.toContain("column");
  });

  it("is settable through --extra, like any other key the core does not define", () => {
    expect(parseExtraFlags(["column=todos/todos"])).toEqual({ column: "todos/todos" });
  });

  it("has no flag of its own on either verb", () => {
    expect(BOARD_KEY_FLAGS.map((flag: FlagSpec) => flag.name)).not.toContain("column");
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

  it("takes the whole map as one JSON object", () => {
    expect(parseQuery(['{"type":"thread","tag":["finance","housing"]}'])).toEqual({
      type: "thread",
      tag: ["finance", "housing"],
    });
  });

  it("refuses the JSON form mixed with pairs", () => {
    const error = thrown(() => parseQuery(['{"type":"thread"}', "status=open"]));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("not both");
  });

  it("is a usage error on a JSON object that is not a flat map", () => {
    const error = thrown(() => parseQuery(['{"filters":{"type":"note"}}']));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("not a board query");
  });

  it("is a usage error on a `{`-leading value that is not JSON at all", () => {
    expect(exitCodeFor(thrown(() => parseQuery(["{type: thread}"])))).toBe(ExitCode.usageError);
  });
});

describe("--stage", () => {
  it("passes a value through exactly as typed", () => {
    expect(parseStage("triage")).toBe("triage");
    expect(parseStage("In Review")).toBe("In Review");
  });

  it("is absent when the flag is", () => {
    expect(parseStage(undefined)).toBeUndefined();
  });

  it("refuses the empty string and points at --unset stage", () => {
    // `--stage ""` looks like "clear it" and is not: the empty string is the
    // *filter's* null sentinel, and `--unset stage` is what removes the key.
    const error = thrown(() => parseStage(""));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(hint(error)).toContain("--unset stage");
  });

  it("does not pre-validate a comma — the boundary that owns the rule refuses it", () => {
    // `StageValueSchema` refuses one with a `400` naming the filter it would
    // break. A second copy of that rule here is a copy that can disagree.
    expect(parseStage("triage,doing")).toBe("triage,doing");
  });
});

describe("--columns", () => {
  it("splits a comma-separated list, keeping the order", () => {
    expect(parseColumns("doc_a1b2,doc_c3d4")).toEqual(["doc_a1b2", "doc_c3d4"]);
  });

  it("trims around a comma, so a readable command line still works", () => {
    expect(parseColumns("doc_a1b2, doc_c3d4")).toEqual(["doc_a1b2", "doc_c3d4"]);
  });

  it("reads the empty string as the empty list — a board with no columns", () => {
    expect(parseColumns("")).toEqual([]);
    expect(parseColumns("   ")).toEqual([]);
  });

  it("is absent when the flag is, which is what leaves the key alone", () => {
    expect(parseColumns(undefined)).toBeUndefined();
  });

  it("refuses a blank entry rather than dropping it — dropping one shifts every column after", () => {
    const error = thrown(() => parseColumns("doc_a1b2,,doc_c3d4"));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("blank entry");
  });
});

describe("--kanban", () => {
  it("carries the whole block, graph and status map included", () => {
    expect(
      parseKanban(
        '{"field":"stage","stages":["triage","doing","done"],' +
          '"transitions":{"triage":["doing"]},"status":{"done":"resolved"}}',
      ),
    ).toEqual({
      field: "stage",
      stages: ["triage", "doing", "done"],
      transitions: { triage: ["doing"] },
      status: { done: "resolved" },
    });
  });

  it("keeps an omitted transitions absent — absent is the linear funnel, `{}` is not", () => {
    const kanban = parseKanban('{"field":"stage","stages":["a","b"]}');
    expect(kanban).toEqual({ field: "stage", stages: ["a", "b"] });
    expect(kanban).not.toHaveProperty("transitions");
  });

  it("keeps an empty transitions, which is a different statement", () => {
    expect(parseKanban('{"field":"stage","stages":["a"],"transitions":{}}')).toEqual({
      field: "stage",
      stages: ["a"],
      transitions: {},
    });
  });

  it("clears the block with null", () => {
    expect(parseKanban("null")).toBeNull();
  });

  it("is absent when the flag is", () => {
    expect(parseKanban(undefined)).toBeUndefined();
  });

  it("is a usage error on text that is not JSON", () => {
    const error = thrown(() => parseKanban("{field: stage}"));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("not valid JSON");
  });

  it.each([
    ['{"stages":["a"]}', "field"],
    ['{"field":"stage","stages":[]}', "stages"],
    ['{"field":"stage","stages":["a"],"transitionz":{}}', "transitionz"],
    ['{"field":"stage","stages":["a"],"transitions":{"a":["a"]}}', "itself"],
    ['{"field":"stage","stages":["a"],"transitions":{"b":["a"]}}', "stages"],
    ['{"field":"stage","stages":["a"],"status":{"b":"open"}}', "stages"],
    ['{"field":"status","stages":["triage"]}', "not a status"],
    ['{"field":"stage","stages":["a","a"]}', "duplicate stage"],
  ])("refuses %s before anything is sent, naming %s", (raw, named) => {
    const error = thrown(() => parseKanban(raw));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain(named);
  });
});

describe("--unset", () => {
  it("collects the keys as typed, in order", () => {
    expect(parseUnsetKeys(["pinned", "order"])).toEqual(["pinned", "order"]);
  });

  it("is absent when the flag is", () => {
    expect(parseUnsetKeys([])).toBeUndefined();
  });

  it("takes file spellings, not wire ones — `default-open` is the key a file holds", () => {
    expect(parseUnsetKeys(["default-open"])).toEqual(["default-open"]);
  });

  it.each(["id", "type", "created"])("refuses %s by name, before any request", (key) => {
    const error = thrown(() => parseUnsetKeys(["title", key]));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain(key);
  });
});

describe("the board flags as a patch fragment", () => {
  it("names only the keys the caller named", () => {
    expect(parseBoardFlags(flagsOf({ stage: "triage" }))).toEqual({ stage: "triage" });
    expect(parseBoardFlags(flagsOf({}))).toEqual({});
  });

  it("carries all six at once", () => {
    expect(
      parseBoardFlags(
        flagsOf({
          stage: "triage",
          order: "4",
          query: ["type=thread"],
          columns: "doc_a1b2",
          kanban: '{"field":"stage","stages":["triage"]}',
          "default-open": "true",
        }),
      ),
    ).toEqual({
      stage: "triage",
      order: 4,
      query: { type: "thread" },
      columns: ["doc_a1b2"],
      kanban: { field: "stage", stages: ["triage"] },
      defaultOpen: true,
    });
  });

  it("carries every clearing form", () => {
    expect(
      parseBoardFlags(
        flagsOf({
          order: "null",
          query: ["null"],
          columns: "",
          kanban: "null",
          "default-open": "false",
        }),
      ),
    ).toEqual({ order: null, query: null, columns: [], kanban: null, defaultOpen: false });
  });

  it("refuses a non-boolean --default-open", () => {
    expect(exitCodeFor(thrown(() => parseBoardFlags(flagsOf({ "default-open": "yes" }))))).toBe(
      ExitCode.usageError,
    );
  });
});

describe("the flag declarations", () => {
  it("declares the six board keys once, for both verbs to share", () => {
    expect(BOARD_KEY_FLAGS.map((flag: FlagSpec) => flag.name)).toEqual([
      "stage",
      "order",
      "columns",
      "kanban",
      "default-open",
      "query",
    ]);
    expect(BOARD_KEY_FLAGS.find((flag: FlagSpec) => flag.name === "query")?.repeated).toBe(true);
  });

  it("declares --unset separately, because only `doc edit` has anything to remove", () => {
    expect(BOARD_KEY_FLAGS.map((flag: FlagSpec) => flag.name)).not.toContain("unset");
    expect(UNSET_FLAG.repeated).toBe(true);
  });

  it("no longer declares --pinned, which rider 2 removed", () => {
    expect(BOARD_KEY_FLAGS.map((flag: FlagSpec) => flag.name)).not.toContain("pinned");
    expect(RESERVED_FRONTMATTER_KEYS).not.toContain("pinned");
  });

  it("names every reserved board key in a flag, so the refusal has somewhere to point", () => {
    const named = new Set(BOARD_KEY_FLAGS.map((flag: FlagSpec) => flag.name));
    for (const key of ["stage", "order", "query", "columns", "kanban"]) {
      expect(RESERVED_FRONTMATTER_KEYS).toContain(key);
      expect(named.has(key), key).toBe(true);
    }
    // `default-open` is the file spelling and `defaultOpen` the wire one; both
    // are reserved, and the one flag covers them.
    expect(RESERVED_FRONTMATTER_KEYS).toContain("default-open");
    expect(named.has("default-open")).toBe(true);
  });
});

describe("the reserved-key refusal covers the board keys", () => {
  it.each([
    ["stage=triage", "--stage"],
    ["order=1", "--order"],
    ["query=x", "--query"],
    ["columns=a", "--columns"],
    ["kanban=x", "--kanban"],
    ["default-open=true", "--default-open"],
    ["defaultOpen=true", "--default-open"],
  ])("refuses --extra %s and names %s", (entry, flag) => {
    const error = thrown(() => parseExtraFlags([entry]));
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is a core frontmatter key");
    expect(hint(error)).toContain(flag);
  });

  it("lets `pinned` through to `extra`, which is how a migration removes it", () => {
    // Rider 2 took it out of the core, so it is an ordinary key the core does
    // not define — and `--extra pinned=null` deletes it under RFC 7386.
    expect(parseExtraFlags(["pinned=null"])).toEqual({ pinned: null });
  });
});
