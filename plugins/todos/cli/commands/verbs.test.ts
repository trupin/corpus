import { ACTOR_HEADER } from "@corpus/contract";
import type { PluginCommandSpec } from "@corpus/contract/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliHarness, listPayload, type CliHarness } from "../testing.js";
import add from "./add.js";
import check from "./check.js";
import list from "./list.js";
import migrate from "./migrate.js";

/**
 * The three `corpus todos` verbs, driven through their real handlers.
 *
 * They are **thin clients** (SPEC.md §10): every assertion below is about the
 * request they issue and the output they write. There is no filesystem here
 * and no frontmatter parsing, because a verb has neither — the item format
 * lives on the server side of these routes.
 */

const item = (text: string, done: boolean): Record<string, unknown> => ({ text, done });

const WEEK = listPayload("doc_week", "Week of Jul 20", [
  item("Renew passport", false),
  item("Call plumber", false),
  item("Send lease notice", true),
]);
const HOUSE = listPayload("doc_house", "House purchase — paperwork", [
  item("Pull credit reports", false),
]);

const lists = (...entries: readonly Record<string, unknown>[]): Record<string, unknown> => ({
  lists: entries,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("every verb's spec", () => {
  const specs: readonly [string, PluginCommandSpec][] = [
    ["add", add],
    ["check", check],
    ["list", list],
    ["migrate", migrate],
  ];

  it.each(specs)("%s is kebab-case with a summary and at least one example", (name, spec) => {
    expect(spec.name).toBe(name);
    expect(spec.name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(spec.summary.length).toBeGreaterThan(0);
    expect(spec.examples.length).toBeGreaterThan(0);
    for (const example of spec.examples) {
      expect(example.command.startsWith("corpus ")).toBe(true);
      expect(example.description.length).toBeGreaterThan(0);
    }
  });

  it.each(specs)("%s declares no flag that shadows a CLI global", (_name, spec) => {
    // `--from`, `--json`, `--workspace`, `--timeout`, `--verbose`, `--no-color`,
    // `--help` and `--version` are merged into every command by the parser.
    const globals = new Set([
      "from",
      "json",
      "workspace",
      "timeout",
      "verbose",
      "no-color",
      "help",
      "version",
    ]);
    for (const flag of spec.flags) expect(globals.has(flag.name)).toBe(false);
  });

  it.each(specs)("%s declares no required argument after an optional one", (_name, spec) => {
    const firstOptional = spec.args.findIndex((arg) => !arg.required);
    if (firstOptional < 0) return;
    expect(spec.args.slice(firstOptional).every((arg) => !arg.required)).toBe(true);
  });

  it.each(specs)("%s documents its JSON shape in an example, house style", (_name, spec) => {
    const jsonExample = spec.examples.find((example) => example.command.includes("--json"));
    expect(jsonExample?.description).toMatch(/One JSON value|`\{/);
  });
});

describe("corpus todos add", () => {
  let h: CliHarness;

  beforeEach(() => {
    h = cliHarness({
      args: { list: "week of jul 20", text: "Book dentist" },
      flags: {},
      actor: "agent",
      replies: [
        { status: 200, body: lists(WEEK, HOUSE) },
        {
          status: 201,
          body: {
            docId: "doc_week",
            index: 3,
            item: { text: "Book dentist", done: false },
          },
        },
      ],
    });
  });

  it("resolves the list by title, then POSTs the item", async () => {
    await add.handler(h.context);
    expect(
      h.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`),
    ).toEqual(["GET /api/x/todos/lists", "POST /api/x/todos/doc_week/items"]);
    expect(h.requests[1]?.body).toEqual({ text: "Book dentist" });
  });

  it("attributes the write to the actor the CLI resolved from --from", async () => {
    await add.handler(h.context);
    expect(h.requests[1]?.headers[ACTOR_HEADER]).toBe("agent");
    expect(h.requests[1]?.headers["Authorization"]).toBe("Bearer test-token");
  });

  it("emits exactly one JSON value and one human line", async () => {
    await add.handler(h.context);
    expect(h.emitted).toEqual([
      { docId: "doc_week", index: 3, item: { text: "Book dentist", done: false } },
    ]);
    expect(h.lines).toEqual(["added item 4 to Week of Jul 20 [doc_week] — Book dentist"]);
  });

  it("passes a --due date through", async () => {
    const dated = cliHarness({
      args: { list: "doc_week", text: "Book dentist" },
      flags: { due: "2026-08-01" },
      actor: "user",
      replies: [
        { status: 200, body: lists(WEEK) },
        {
          status: 201,
          body: {
            docId: "doc_week",
            index: 3,
            item: { text: "Book dentist", done: false, due: "2026-08-01" },
          },
        },
      ],
    });
    await add.handler(dated.context);
    expect(dated.requests[1]?.body).toEqual({ text: "Book dentist", due: "2026-08-01" });
  });

  it("reports the server's own refusal message", async () => {
    const refused = cliHarness({
      args: { list: "doc_week", text: "" },
      flags: {},
      actor: "user",
      replies: [
        { status: 200, body: lists(WEEK) },
        { status: 400, body: { code: "bad_request", message: "an item needs a non-empty `text`" } },
      ],
    });
    await expect(add.handler(refused.context)).rejects.toThrow("an item needs a non-empty `text`");
  });
});

describe("resolving a list by name", () => {
  const resolveWith = (selector: string): Promise<void> =>
    add.handler(
      cliHarness({
        args: { list: selector, text: "x" },
        flags: {},
        actor: "user",
        replies: [
          { status: 200, body: lists(WEEK, HOUSE) },
          { status: 201, body: { docId: "doc_week", index: 0, item: item("x", false) } },
        ],
      }).context,
    );

  it("accepts an id, an exact title and an unambiguous fragment", async () => {
    await expect(resolveWith("doc_week")).resolves.toBeUndefined();
    await expect(resolveWith("WEEK OF JUL 20")).resolves.toBeUndefined();
    await expect(resolveWith("paperwork")).resolves.toBeUndefined();
  });

  it("refuses an ambiguous fragment, naming the candidates", async () => {
    const h = cliHarness({
      args: { list: "list", text: "x" },
      flags: {},
      actor: "user",
      replies: [
        {
          status: 200,
          body: lists(
            listPayload("doc_a", "Shopping list", []),
            listPayload("doc_b", "Work list", []),
          ),
        },
      ],
    });
    await expect(add.handler(h.context)).rejects.toThrow(/matches 2 lists.*Shopping list/s);
  });

  it("refuses a duplicate exact title too", async () => {
    const h = cliHarness({
      args: { list: "Notes", text: "x" },
      flags: {},
      actor: "user",
      replies: [
        {
          status: 200,
          body: lists(listPayload("doc_a", "Notes", []), listPayload("doc_b", "notes", [])),
        },
      ],
    });
    await expect(add.handler(h.context)).rejects.toThrow(/matches 2 lists/);
  });

  it("says what exists when nothing matches, and says so plainly when nothing does", async () => {
    const some = cliHarness({
      args: { list: "groceries", text: "x" },
      flags: {},
      actor: "user",
      replies: [{ status: 200, body: lists(WEEK) }],
    });
    await expect(add.handler(some.context)).rejects.toThrow(/try one of: Week of Jul 20/);

    const none = cliHarness({
      args: { list: "groceries", text: "x" },
      flags: {},
      actor: "user",
      replies: [{ status: 200, body: lists() }],
    });
    await expect(add.handler(none.context)).rejects.toThrow(/this workspace has none yet/);
  });

  it("reports a transport failure with its status when the body is not an ApiError", async () => {
    const h = cliHarness({
      args: { list: "doc_week", text: "x" },
      flags: {},
      actor: "user",
      replies: [{ status: 502, body: "<html>gateway</html>" }],
    });
    await expect(add.handler(h.context)).rejects.toThrow(/HTTP 502/);
  });
});

describe("corpus todos check", () => {
  const checking = (selector: string, flags: Record<string, boolean> = {}): CliHarness =>
    cliHarness({
      args: { list: "doc_week", item: selector },
      flags,
      actor: "agent",
      replies: [
        { status: 200, body: lists(WEEK) },
        { status: 200, body: { docId: "doc_week", index: 0, item: item("Renew passport", true) } },
      ],
    });

  it("checks by 1-based number", async () => {
    const h = checking("2");
    await check.handler(h.context);
    expect(new URL(String(h.requests[1]?.url)).pathname).toBe("/api/x/todos/doc_week/items/1");
    expect(h.requests[1]?.body).toEqual({ done: true, expectedText: "Call plumber" });
  });

  it("checks by text, case-insensitively, and carries the guard", async () => {
    const h = checking("renew PASSPORT");
    await check.handler(h.context);
    expect(new URL(String(h.requests[1]?.url)).pathname).toBe("/api/x/todos/doc_week/items/0");
    expect(h.requests[1]?.body).toEqual({ done: true, expectedText: "Renew passport" });
    expect(h.lines[0]).toContain("checked item 1");
  });

  it("unchecks with --uncheck", async () => {
    const h = checking("1", { uncheck: true });
    await check.handler(h.context);
    expect(h.requests[1]?.body).toMatchObject({ done: false });
    expect(h.lines[0]).toContain("unchecked item 1");
  });

  it("refuses ambiguous text and lists the candidate numbers, writing nothing", async () => {
    const h = cliHarness({
      args: { list: "doc_dupes", item: "milk" },
      flags: {},
      actor: "user",
      replies: [
        {
          status: 200,
          body: lists(
            listPayload("doc_dupes", "Shopping", [item("milk", false), item("Milk", false)]),
          ),
        },
      ],
    });
    await expect(check.handler(h.context)).rejects.toThrow(/matches 2 items \(1, 2\)/);
    expect(h.requests).toHaveLength(1);
  });

  it("refuses a number outside the list", async () => {
    await expect(check.handler(checking("9").context)).rejects.toThrow(/has 3 items/);
  });

  it("surfaces a 409 from the concurrency guard", async () => {
    const h = cliHarness({
      args: { list: "doc_week", item: "1" },
      flags: {},
      actor: "user",
      replies: [
        { status: 200, body: lists(WEEK) },
        { status: 409, body: { code: "conflict", message: "it changed under you" } },
      ],
    });
    await expect(check.handler(h.context)).rejects.toThrow("it changed under you");
  });
});

describe("corpus todos list", () => {
  it("prints one line per list and emits a stable JSON shape", async () => {
    const h = cliHarness({
      args: {},
      flags: {},
      actor: "user",
      replies: [{ status: 200, body: lists(WEEK, HOUSE) }],
    });
    await list.handler(h.context);
    expect(h.emitted).toEqual([{ lists: [WEEK, HOUSE] }]);
    expect(h.lines).toEqual([
      "Week of Jul 20 [doc_week] — 2 open · 1 done",
      "House purchase — paperwork [doc_house] — 1 open · 0 done",
    ]);
  });

  it("expands the named list's numbered items", async () => {
    const h = cliHarness({
      args: { list: "week" },
      flags: {},
      actor: "user",
      replies: [{ status: 200, body: lists(WEEK, HOUSE) }],
    });
    await list.handler(h.context);
    expect(h.emitted).toEqual([{ lists: [WEEK] }]);
    expect(h.lines).toEqual([
      "Week of Jul 20 [doc_week] — 2 open · 1 done",
      "   1 ☐ Renew passport",
      "   2 ☐ Call plumber",
      "   3 ☑ Send lease notice",
    ]);
  });

  it("renders a deadline beside the item it belongs to", async () => {
    const h = cliHarness({
      args: { list: "doc_week" },
      flags: {},
      actor: "user",
      replies: [
        {
          status: 200,
          body: lists(
            listPayload("doc_week", "Week", [{ text: "a", done: false, due: "2026-08-01" }]),
          ),
        },
      ],
    });
    await list.handler(h.context);
    expect(h.lines[1]).toBe("   1 ☐ a  (due 2026-08-01)");
  });

  it("filters to open items with --open", async () => {
    const h = cliHarness({
      args: { list: "doc_week" },
      flags: { open: true },
      actor: "user",
      replies: [{ status: 200, body: lists(WEEK) }],
    });
    await list.handler(h.context);
    expect(h.lines).toEqual([
      "Week of Jul 20 [doc_week] — 2 open · 1 done",
      "   1 ☐ Renew passport",
      "   2 ☐ Call plumber",
    ]);
  });

  it("says so when there are no todo lists at all", async () => {
    const h = cliHarness({
      args: {},
      flags: {},
      actor: "user",
      replies: [{ status: 200, body: lists() }],
    });
    await list.handler(h.context);
    expect(h.emitted).toEqual([{ lists: [] }]);
    expect(h.lines).toEqual(["no todo lists."]);
  });
});

describe("corpus todos migrate", () => {
  const report = (
    migrated: readonly Record<string, unknown>[],
    conflicts: readonly Record<string, unknown>[],
    unchanged: number,
  ): Record<string, unknown> => ({ migrated, conflicts, unchanged });

  it("POSTs once and reports what it changed", async () => {
    const h = cliHarness({
      args: {},
      flags: {},
      actor: "agent",
      replies: [
        {
          status: 200,
          body: report(
            [{ docId: "doc_week", title: "Week of Jul 20", items: 3 }],
            [{ docId: "doc_bad", title: "Broken", reason: "doc_bad has malformed items" }],
            2,
          ),
        },
      ],
    });
    await migrate.handler(h.context);
    expect(
      h.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`),
    ).toEqual(["POST /api/x/todos/migrate"]);
    expect(h.requests[0]?.headers[ACTOR_HEADER]).toBe("agent");
    expect(h.lines).toEqual([
      "migrated Week of Jul 20 [doc_week] — 3 items moved into the body",
      "skipped Broken [doc_bad] — doc_bad has malformed items",
      "1 migrated · 1 skipped · 2 already migrated",
    ]);
  });

  it("says plainly when a second run has nothing to do", async () => {
    const h = cliHarness({
      args: {},
      flags: {},
      actor: "user",
      replies: [{ status: 200, body: report([], [], 3) }],
    });
    await migrate.handler(h.context);
    expect(h.emitted).toEqual([{ migrated: [], conflicts: [], unchanged: 3 }]);
    expect(h.lines).toEqual(["nothing to migrate — 3 todo lists already store items in the body."]);
  });

  it("singularises the one-item and one-list cases", async () => {
    const h = cliHarness({
      args: {},
      flags: {},
      actor: "user",
      replies: [{ status: 200, body: report([{ docId: "doc_a", title: "A", items: 1 }], [], 1) }],
    });
    await migrate.handler(h.context);
    expect(h.lines[0]).toBe("migrated A [doc_a] — 1 item moved into the body");
  });
});
