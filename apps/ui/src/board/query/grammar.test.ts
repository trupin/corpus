import { DOC_SORTS, DOC_STATUSES, DocsQuerySchema, NEEDS_FILTERS } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  ISPARENT_SUMMARY,
  QUERY_COMBINATORS,
  QUERY_EXAMPLES,
  QUERY_FIELD_NAMES,
  QUERY_FIELDS,
  QUERY_OPERATORS,
  queryField,
  unknownQueryFields,
} from "./grammar";
import { parseQueryString } from "../viewDoc";

describe("the query grammar", () => {
  it("takes its field names from the schema that parses them", () => {
    expect([...QUERY_FIELD_NAMES].sort()).toEqual([...Object.keys(DocsQuerySchema.shape)].sort());
    expect(QUERY_FIELD_NAMES).toContain("type");
    expect(QUERY_FIELD_NAMES).toContain("needs");
  });

  /**
   * The one thing in `grammar.ts` that is written rather than derived is the
   * prose, so it is the one thing that can drift. A filter added to the contract
   * fails here until somebody writes its sentence — the editor keeps working
   * meanwhile, offering it with a placeholder description.
   */
  it("describes every field the schema publishes", () => {
    const undescribed = QUERY_FIELDS.filter((field) =>
      field.summary.startsWith("A filter this build"),
    );
    expect(undescribed.map((field) => field.name)).toEqual([]);
  });

  it("offers each field exactly once, in reading order", () => {
    expect(QUERY_FIELDS).toHaveLength(QUERY_FIELD_NAMES.length);
    expect(new Set(QUERY_FIELDS.map((field) => field.name)).size).toBe(QUERY_FIELDS.length);
    // `q` is what a person reaches for first; pagination is last, though the
    // schema declares it first.
    expect(QUERY_FIELDS[0]?.name).toBe("q");
    expect(QUERY_FIELDS.at(-1)?.name).toBe("offset");
  });

  it("enumerates values from the contract's own constants", () => {
    expect(queryField("status")?.values).toEqual({ kind: "fixed", values: DOC_STATUSES });
    expect(queryField("needs")?.values).toEqual({ kind: "fixed", values: NEEDS_FILTERS });
    expect(queryField("sort")?.values).toEqual({ kind: "fixed", values: DOC_SORTS });
  });

  it("marks the two comma-separated fields, and only those", () => {
    expect(QUERY_FIELDS.filter((field) => field.multi).map((field) => field.name)).toEqual([
      "type",
      "tag",
    ]);
  });

  it("names one operator and two combinators — the whole language", () => {
    expect(QUERY_OPERATORS.map((rule) => rule.token)).toEqual(["="]);
    expect(QUERY_COMBINATORS.map((rule) => rule.token)).toEqual(["&", ","]);
  });

  /**
   * A wrong example is worse than none: every one must parse into fields the
   * server publishes, so a filter renamed in the contract fails here too.
   */
  it("ships examples that are valid queries", () => {
    expect(QUERY_EXAMPLES.length).toBeGreaterThanOrEqual(4);
    for (const example of QUERY_EXAMPLES) {
      const parsed = parseQueryString(example.query);
      expect(Object.keys(parsed).length).toBeGreaterThan(0);
      expect(unknownQueryFields(parsed)).toEqual([]);
    }
  });
});

/**
 * `isParent` is the only field whose name argues against its meaning, so it is
 * the only one whose prose is pinned rather than merely required to exist
 * (UI-088). `isParent=true` selects documents with **no** parent
 * (CONTRACT-042); the summary is the whole of what a user is told about that,
 * because the query editor shows them the parameter name and nothing else.
 */
describe("the isParent field, whose name contradicts what it selects", () => {
  it("is offered, with true and false, next to the parent filter it inverts", () => {
    expect(queryField("isParent")).toEqual({
      name: "isParent",
      summary: ISPARENT_SUMMARY,
      values: { kind: "fixed", values: ["true", "false"] },
      multi: false,
    });

    const names = QUERY_FIELDS.map((field) => field.name);
    expect(names.indexOf("isParent")).toBe(names.indexOf("parent") + 1);
  });

  it("is described as what it does, in wording pinned character for character", () => {
    expect(ISPARENT_SUMMARY).toBe(
      'Top-level only: true keeps documents with no parent. Never "has children".',
    );
  });

  /**
   * The failure this guards is a rewrite that "corrects" the summary to match
   * the name — the exact mistake CONTRACT-042 says was considered and rejected.
   * Read as prose rather than as an identifier: `isParent` itself appears in
   * the menu beside this text, and that is the parameter, not a claim.
   */
  it("never claims the document is a parent, and mentions children only to deny them", () => {
    const prose = ISPARENT_SUMMARY.toLowerCase();
    expect(prose).toContain("no parent");
    expect(prose).not.toContain("is a parent");
    expect(prose).toContain('never "has children"');
  });
});

describe("unknownQueryFields", () => {
  it("says nothing about a query the schema accepts", () => {
    expect(unknownQueryFields({ type: "thread", status: "open" })).toEqual([]);
  });

  /**
   * `DocsQuerySchema` is a tolerant object, so the server *strips* an unknown
   * parameter instead of refusing it: a typo renders a healthy column that
   * quietly ignores the filter. That silence is what this exists to break.
   */
  it("names a typo the server would silently ignore, sorted", () => {
    expect(unknownQueryFields({ typ: "todo", status: "open", zz: "1" })).toEqual(["typ", "zz"]);
  });
});
