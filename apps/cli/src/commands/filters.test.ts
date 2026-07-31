import { docFilterShape } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../errors.js";
import type { FlagValue } from "../parse-args.js";
import { createTestContext } from "../registry/fixtures.js";
import type { CommandContext } from "../registry/types.js";
import { listCommand } from "./doc/list.js";
import { relatedCommand } from "./doc/related.js";
import { collectDocFilters, DOC_FILTER_FLAGS, insertFlagAfter, oneOf } from "./filters.js";
import { searchCommand } from "./search.js";

/**
 * The promise this module exists to keep: `corpus doc list` and `corpus search`
 * take the same structured filters, because there is one definition of them.
 * The contract makes the same promise one layer down (`docFilterShape`), so the
 * strongest available assertion is against that shape rather than against a
 * hand-written list — a filter added to the contract shows up here as a failing
 * test naming it, on both verbs at once.
 */

/** `includeArchived` on the wire is `--include-archived` on the command line. */
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const contextWith = (flags: Readonly<Record<string, FlagValue>>): CommandContext =>
  createTestContext({ flags }).context;

describe("the shared document filters", () => {
  it("declares exactly the contract's shared filter set, no more and no less", () => {
    expect(DOC_FILTER_FLAGS.map((flag) => flag.name).toSorted()).toEqual(
      Object.keys(docFilterShape).map(kebab).toSorted(),
    );
  });

  it("is one definition site: both verbs publish the very same flag objects", () => {
    for (const flag of DOC_FILTER_FLAGS) {
      expect(listCommand.flags, `doc list dropped --${flag.name}`).toContain(flag);
      expect(searchCommand.flags, `search dropped --${flag.name}`).toContain(flag);
    }
  });

  it("keeps the list-only parameters off the ranked-retrieval verbs", () => {
    // `/api/search` accepts none of these (CONTRACT-022), so a flag for them
    // would be a convenience that goes nowhere on the wire.
    const searchFlags = searchCommand.flags.map((flag) => flag.name);
    for (const listOnly of ["pinned", "sort", "offset"]) {
      expect(searchFlags, `search declares --${listOnly}`).not.toContain(listOnly);
    }
    // `doc related` takes a cap and the archived flag, and nothing else.
    expect(relatedCommand.flags.map((flag) => flag.name)).toEqual(["limit", "include-archived"]);
  });

  it("leaves doc list's published flag order untouched", () => {
    expect(listCommand.flags.map((flag) => flag.name)).toEqual([
      "q",
      "type",
      "tag",
      "folder",
      "status",
      "include-archived",
      "needs",
      "parent",
      "references",
      "agent",
      "author",
      "unread",
      "pinned",
      "due",
      "since",
      "stale",
      "sort",
      "limit",
      "offset",
    ]);
  });
});

describe("insertFlagAfter", () => {
  const extra = { name: "pinned", type: "boolean", description: "d." } as const;

  it("places a verb's own flag after a named shared one", () => {
    expect(insertFlagAfter(DOC_FILTER_FLAGS, "unread", extra).map((flag) => flag.name)).toEqual([
      "type",
      "tag",
      "folder",
      "status",
      "include-archived",
      "needs",
      "parent",
      "references",
      "agent",
      "author",
      "unread",
      "pinned",
      "due",
      "since",
      "stale",
    ]);
  });

  it("refuses an anchor that is not a shared filter, rather than appending silently", () => {
    expect(() => insertFlagAfter(DOC_FILTER_FLAGS, "unrede", extra)).toThrow(/unrede/);
  });
});

describe("collectDocFilters", () => {
  it("sends only the filters that were passed", () => {
    expect(collectDocFilters(contextWith({ tag: "finance" }))).toEqual({ tag: "finance" });
    expect(collectDocFilters(contextWith({}))).toEqual({});
  });

  it("passes every shared filter through verbatim", () => {
    expect(
      collectDocFilters(
        contextWith({
          type: "note,view",
          tag: "finance",
          folder: "finance",
          status: "open",
          parent: "doc_a1b2c3",
          references: "doc_zz",
          agent: "engaged",
          author: "agent",
          since: "2026-07-01T00:00:00Z",
          due: "week",
          stale: "aging",
          needs: "unread-reply",
          "include-archived": true,
          unread: true,
        }),
      ),
    ).toEqual({
      type: "note,view",
      tag: "finance",
      folder: "finance",
      status: "open",
      parent: "doc_a1b2c3",
      references: "doc_zz",
      agent: "engaged",
      author: "agent",
      since: "2026-07-01T00:00:00Z",
      due: "week",
      stale: "aging",
      needs: "unread-reply",
      includeArchived: true,
      unread: true,
    });
  });

  it("sends the boolean filters only on their true side", () => {
    expect(collectDocFilters(contextWith({ "include-archived": false, unread: false }))).toEqual(
      {},
    );
  });

  it("refuses a misspelled enumerated filter before anything is sent", () => {
    const error: unknown = (() => {
      try {
        return collectDocFilters(contextWith({ status: "closed" }));
      } catch (cause: unknown) {
        return cause;
      }
    })();

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("open, resolved, archived");
  });
});

describe("oneOf", () => {
  it("accepts a listed value and reports the alternatives for anything else", () => {
    expect(oneOf(contextWith({ status: "open" }), "status", ["open", "archived"])).toBe("open");
    expect(oneOf(contextWith({}), "status", ["open"])).toBeUndefined();
    expect(() => oneOf(contextWith({ status: "shut" }), "status", ["open"])).toThrow(
      '--status must be one of: open — got "shut".',
    );
  });
});
