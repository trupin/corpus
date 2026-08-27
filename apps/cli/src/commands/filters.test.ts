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
    for (const listOnly of ["is-parent", "sort", "offset"]) {
      expect(searchFlags, `search declares --${listOnly}`).not.toContain(listOnly);
    }
    // `doc related` takes a cap and the archived flag, and nothing else.
    expect(relatedCommand.flags.map((flag) => flag.name)).toEqual(["limit", "include-archived"]);
  });

  it("leaves doc list's published flag order untouched", () => {
    expect(listCommand.flags.map((flag) => flag.name)).toEqual([
      "q",
      "type",
      // SHARED-011's rider (2026-08-04, applied 2026-08-26). They are in the
      // **shared** list, so they land on `corpus search` too: the contract puts
      // them on `docFilterShape` because they are structural filters exactly as
      // `--tag` is, and §9.2's parameter line for ranked retrieval names them.
      "title",
      "body",
      "tag",
      "folder",
      "status",
      "stage",
      "include-archived",
      "needs",
      "parent",
      "references",
      "agent",
      "author",
      "unread",
      "is-parent",
      "due",
      "since",
      "stale",
      // SHARED-011's open namespace, list-only for the same reason
      // `--is-parent` is: §9.2's signed `/api/search` parameter string does not
      // carry `extra`, so a flag for it on `search` would go nowhere.
      "extra",
      "sort",
      "limit",
      "offset",
      // CLI-065. `--fields` is `doc list`'s own, not a shared filter: it
      // projects the answer rather than selecting rows, and `search` returns a
      // ranked address list whose shape is fixed. Appended rather than placed
      // among the filters so the published order above stays the order it was.
      "fields",
    ]);
  });

  /**
   * CLI-032. `isParent` is a structural filter that would belong in the shared
   * set on the merits, and is held out of it only because §9.2's signed
   * `/api/search` parameter string does not carry it (CONTRACT-042). A flag for
   * it on `search` would therefore go nowhere on the wire, which is the one
   * failure this whole module exists to prevent — so it is pinned on both sides:
   * absent from the shared list, present on `doc list`.
   */
  it("keeps --is-parent off search, where the contract does not declare it", () => {
    expect(DOC_FILTER_FLAGS.map((flag) => flag.name)).not.toContain("is-parent");
    expect(searchCommand.flags.map((flag) => flag.name)).not.toContain("is-parent");
    expect(listCommand.flags.map((flag) => flag.name)).toContain("is-parent");
  });

  /** `extra` is held out for the same reason, and pinned the same way. */
  it("keeps --extra off search, where the contract does not declare it", () => {
    expect(DOC_FILTER_FLAGS.map((flag) => flag.name)).not.toContain("extra");
    expect(searchCommand.flags.map((flag) => flag.name)).not.toContain("extra");
    expect(listCommand.flags.map((flag) => flag.name)).toContain("extra");
  });

  /**
   * The glob-bearing filters, by contrast, **are** shared — so a workspace can
   * narrow a ranked search by title the way it narrows a list.
   */
  it.each(["title", "body"])("puts --%s on both verbs", (name) => {
    expect(searchCommand.flags.map((flag) => flag.name)).toContain(name);
    expect(listCommand.flags.map((flag) => flag.name)).toContain(name);
  });
});

describe("insertFlagAfter", () => {
  const extra = { name: "is-parent", type: "boolean", description: "d." } as const;

  it("places a verb's own flag after a named shared one", () => {
    expect(insertFlagAfter(DOC_FILTER_FLAGS, "unread", extra).map((flag) => flag.name)).toEqual([
      "type",
      // SHARED-011's rider (2026-08-04, applied 2026-08-26). They are in the
      // **shared** list, so they land on `corpus search` too: the contract puts
      // them on `docFilterShape` because they are structural filters exactly as
      // `--tag` is, and §9.2's parameter line for ranked retrieval names them.
      "title",
      "body",
      "tag",
      "folder",
      "status",
      "stage",
      "include-archived",
      "needs",
      "parent",
      "references",
      "agent",
      "author",
      "unread",
      "is-parent",
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
          stage: "triage",
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
      stage: "triage",
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

  /**
   * `--stage ""` is the one filter whose **empty** value is a question rather
   * than the absence of one: the empty element is the null sentinel and selects
   * documents carrying no stage at all (SPEC.md §5, §10). So absence and the
   * empty string have to reach the wire as two different requests, exactly as
   * `--is-parent`'s three states do.
   */
  it("keeps --stage's empty value, which selects the unstaged", () => {
    expect(collectDocFilters(contextWith({ stage: "" }))).toEqual({ stage: "" });
    expect(collectDocFilters(contextWith({}))).toEqual({});
    expect(collectDocFilters(contextWith({ stage: ",triage" }))).toEqual({ stage: ",triage" });
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
