import { DocListSchema, DocSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { computeContext } from "../anchors/index.js";
import {
  createDoc,
  createWriteWorkspace,
  JSON_HEADERS,
  putDoc,
  type WriteWorkspace,
} from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const RESOLVING = "anc_here0001";
const MISSING = "anc_gone0001";

const threadFile = (id: string, anchor: string, status = "open"): string =>
  [
    "---",
    `id: ${id}`,
    "type: thread",
    `title: About ${anchor}`,
    "created: 2026-07-01T00:00:00Z",
    "updated: 2026-07-01T00:00:00Z",
    "tags: []",
    `status: ${status}`,
    "anchors: {}",
    "due: null",
    "reviewed: null",
    "evergreen: false",
    "parent: doc_reader01",
    `anchor: ${anchor}`,
    "agent: none",
    "---",
    "",
    "## user · 2026-07-01T00:00:00Z",
    "",
    "A question.",
    "",
  ].join("\n");

describe("GET /api/docs/{id}", () => {
  it("resolves anchors and reports the orphaned ones", async () => {
    ws = createWriteWorkspace("read-anchors");
    ws.write(
      "data/docs/inbox/reader.md",
      [
        "---",
        "id: doc_reader01",
        "type: note",
        "title: Reader",
        "created: 2026-07-01T00:00:00Z",
        "updated: 2026-07-02T00:00:00Z",
        "tags: [finance]",
        "status: open",
        "anchors:",
        `  ${RESOLVING}:`,
        '    exact: "a sentence that is present"',
        '    prefix: ""',
        '    suffix: ""',
        `  ${MISSING}:`,
        '    exact: "a sentence that was removed"',
        '    prefix: ""',
        '    suffix: ""',
        "due: null",
        "reviewed: null",
        "evergreen: false",
        "---",
        "",
        "Here is a sentence that is present.",
        "",
      ].join("\n"),
    );
    ws.write("data/threads/th_here0001.md", threadFile("th_here0001", RESOLVING));
    ws.write("data/threads/th_gone0001.md", threadFile("th_gone0001", MISSING, "resolved"));
    ws.reproject();

    const response = await ws.request("/api/docs/doc_reader01");
    expect(response.status).toBe(200);
    const doc = DocSchema.parse(await response.json());

    expect(doc.path).toBe("data/docs/inbox/reader.md");
    expect(doc.frontmatter.tags).toEqual(["finance"]);
    expect(doc.body).toContain("Here is a sentence that is present.");

    const resolving = doc.anchors.find((anchor) => anchor.anchorId === RESOLVING);
    expect(resolving).toMatchObject({
      threadId: "th_here0001",
      threadStatus: "open",
      orphaned: false,
    });
    expect(resolving?.range).not.toBeNull();

    const missing = doc.anchors.find((anchor) => anchor.anchorId === MISSING);
    expect(missing).toMatchObject({
      threadId: "th_gone0001",
      threadStatus: "resolved",
      orphaned: true,
      range: null,
    });
  });

  it("omits an anchor entry no thread claims", async () => {
    ws = createWriteWorkspace("read-unclaimed");
    ws.write(
      "data/docs/inbox/unclaimed.md",
      [
        "---",
        "id: doc_reader01",
        "type: note",
        "title: Unclaimed",
        "created: 2026-07-01T00:00:00Z",
        "updated: 2026-07-01T00:00:00Z",
        "tags: []",
        "status: open",
        "anchors:",
        `  ${RESOLVING}:`,
        '    exact: "present text"',
        '    prefix: ""',
        '    suffix: ""',
        "due: null",
        "reviewed: null",
        "evergreen: false",
        "---",
        "",
        "Some present text here.",
        "",
      ].join("\n"),
    );
    ws.reproject();

    const doc = DocSchema.parse(await (await ws.request("/api/docs/doc_reader01")).json());
    expect(doc.anchors).toEqual([]);
  });

  it("fills the server-owned defaults for a sparse hand-written file", async () => {
    ws = createWriteWorkspace("read-defaults");
    ws.write(
      "data/docs/inbox/sparse.md",
      ["---", "id: doc_sparse01", "type: note", "title: Sparse", "---", "", "Body only.", ""].join(
        "\n",
      ),
    );
    ws.reproject();

    const doc = DocSchema.parse(await (await ws.request("/api/docs/doc_sparse01")).json());
    expect(doc.frontmatter).toMatchObject({
      tags: [],
      status: "open",
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      origin: null,
    });
    // Undated is `null`, exactly as the collection query reports it, so one
    // document never has two ages depending on the endpoint.
    expect(doc.frontmatter.created).toBeNull();
    expect(doc.frontmatter.updated).toBeNull();
  });

  /**
   * The SERVER-005 escalation, closed: a hand-written `SKILL.md` (SPEC.md §7)
   * carries no timestamps at all, and the two read routes used to disagree about
   * it — `null` from the collection, an epoch sentinel from the single read.
   */
  it("agrees with the collection query about an undated skill file", async () => {
    ws = createWriteWorkspace("read-undated-agreement");
    ws.write(
      ".claude/skills/handwritten/SKILL.md",
      "---\nname: handwritten\ndescription: Written by hand, dated by nobody.\n---\n\nSteps.\n",
    );
    ws.reproject();

    const list = DocListSchema.parse(await (await ws.request("/api/docs?type=skill")).json());
    const row = list.items.find((candidate) => candidate.title === "handwritten");
    expect(row).toBeDefined();
    expect(row?.created).toBeNull();
    expect(row?.updated).toBeNull();

    const doc = DocSchema.parse(await (await ws.request(`/api/docs/${row?.id ?? ""}`)).json());
    expect(doc.frontmatter.created).toBe(row?.created);
    expect(doc.frontmatter.updated).toBe(row?.updated);
  });

  it("takes type and status from the row so an archived skill reads correctly", async () => {
    ws = createWriteWorkspace("read-skill");
    ws.write(
      ".claude/skills-archived/retired/SKILL.md",
      "---\nname: retired\ndescription: An old skill.\n---\n\nRetired.\n",
    );
    ws.reproject();
    const row = ws.db.prepare("SELECT id FROM documents WHERE type = 'skill'").get() as {
      id: string;
    };

    const doc = DocSchema.parse(await (await ws.request(`/api/docs/${row.id}`)).json());
    expect(doc.frontmatter.type).toBe("skill");
    expect(doc.frontmatter.status).toBe("archived");
    expect(doc.frontmatter.title).toBe("retired");
  });

  it("404s an unknown id and 400s a malformed one, and never leaks a path", async () => {
    ws = createWriteWorkspace("read-ids");
    ws.reproject();

    const missing = await ws.request("/api/docs/doc_zzzzzzzz");
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { code: string; message: string };
    expect(missingBody.code).toBe("not_found");
    expect(missingBody.message).not.toContain(ws.root);

    const malformed = await ws.request("/api/docs/not-an-id");
    expect(malformed.status).toBe(400);
    const body = (await malformed.json()) as { code: string; issues: unknown[] };
    expect(body.code).toBe("bad_request");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("404s a row whose file vanished from under it", async () => {
    ws = createWriteWorkspace("read-vanished");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Vanishing" });
    ws.git("rm", "-q", "--", created.path);

    expect((await ws.request(`/api/docs/${created.id}`)).status).toBe(404);
  });
});

/**
 * SPEC.md §6's resolution ladder, end to end on the read path.
 *
 * Every case here edits the file **out of band** — the state where the ladder is
 * the only thing standing between a comment and detachment, because no
 * reconciliation pass has refreshed the selector. The read path runs rungs 1–2:
 * an edit *around* the quote keeps the comment attached, an edit *inside* it
 * detaches the comment until the next save reconciles the selector (the round
 * trip at the bottom of this block), and a lookalike never captures a thread.
 *
 * SERVER-055 wired rung 3 in here so the "edited inside" shapes would resolve
 * too, and was reverted: in a list, a table or a template the rung answered with
 * a *sibling* of the anchored passage — including for the edited-in-place case
 * it was meant to serve. `anchors/resolve.test.ts` holds those shapes.
 */
describe("GET /api/docs/{id} — the §6 ladder against an edited body", () => {
  const QUOTE = "assume a 30-year fixed at 6.1%";
  const ORIGINAL = [
    "",
    "# Mortgage model",
    "",
    "The committee met on Tuesday to review the base case.",
    "",
    `We ${QUOTE} which may be stale, and revisit it each quarter.`,
    "",
    "Closing paragraph about the model.",
    "",
  ].join("\n");

  const ANCHOR = "anc_ladder01";
  const DOC_ID = "doc_ladder01";

  /** The selector a save would have written for `QUOTE` in `ORIGINAL`. */
  const selector = (() => {
    const start = ORIGINAL.indexOf(QUOTE);
    return { exact: QUOTE, ...computeContext(ORIGINAL, start, start + QUOTE.length) };
  })();

  const documentFile = (body: string): string =>
    [
      "---",
      `id: ${DOC_ID}`,
      "type: note",
      "title: Mortgage model",
      "created: 2026-07-01T00:00:00Z",
      "updated: 2026-07-01T00:00:00Z",
      "tags: []",
      "status: open",
      "anchors:",
      `  ${ANCHOR}:`,
      `    exact: ${JSON.stringify(selector.exact)}`,
      `    prefix: ${JSON.stringify(selector.prefix)}`,
      `    suffix: ${JSON.stringify(selector.suffix)}`,
      "due: null",
      "reviewed: null",
      "evergreen: false",
      "---",
      body,
    ].join("\n");

  const threadOn = (body: string): string =>
    [
      "---",
      "id: th_ladder01",
      "type: thread",
      "title: About the rate",
      "created: 2026-07-01T00:00:00Z",
      "updated: 2026-07-01T00:00:00Z",
      "tags: []",
      "status: open",
      "anchors: {}",
      "due: null",
      "reviewed: null",
      "evergreen: false",
      `parent: ${DOC_ID}`,
      `anchor: ${ANCHOR}`,
      "agent: none",
      "---",
      "",
      "## user · 2026-07-01T00:00:00Z",
      "",
      body,
      "",
    ].join("\n");

  /** Seed the anchored document with `body`, then read the anchor back. */
  const readAnchor = async (
    name: string,
    body: string,
  ): Promise<{ range: { start: number; end: number } | null; orphaned: boolean; body: string }> => {
    ws = createWriteWorkspace(name);
    ws.write("data/docs/model.md", documentFile(body));
    ws.write("data/threads/th_ladder01.md", threadOn("Is this still right?"));
    ws.reproject();

    const doc = DocSchema.parse(await (await ws.request(`/api/docs/${DOC_ID}`)).json());
    const anchor = doc.anchors.find((candidate) => candidate.anchorId === ANCHOR);
    expect(anchor).toBeDefined();
    return { range: anchor?.range ?? null, orphaned: anchor?.orphaned ?? true, body: doc.body };
  };

  it("resolves after an insertion before the quote", async () => {
    // The declared prefix is now stale, so rung 1 misses; the quote itself
    // survives verbatim and uniquely, so rung 2 carries it.
    const edited = ORIGINAL.replace("We assume", "For now we deliberately assume");
    const { range, orphaned, body } = await readAnchor("ladder-insert-before", edited);
    expect(orphaned).toBe(false);
    expect(body.slice(range?.start, range?.end)).toBe(QUOTE);
  });

  it("orphans after an insertion inside the quote, visibly and with the selector intact", async () => {
    // Both exact rungs are gone — the quoted characters no longer occur — so
    // survival cannot be proved and §6 detaches the thread rather than guess.
    // The next save repairs it (see the round trip below).
    const edited = ORIGINAL.replace("a 30-year fixed", "a 30-year fixed-rate");
    const { range, orphaned } = await readAnchor("ladder-insert-inside", edited);
    expect(orphaned).toBe(true);
    expect(range).toBeNull();
  });

  it("resolves after a deletion following the quote", async () => {
    const edited = ORIGINAL.replace(" which may be stale,", "");
    const { range, orphaned, body } = await readAnchor("ladder-delete-after", edited);
    expect(orphaned).toBe(false);
    expect(body.slice(range?.start, range?.end)).toBe(QUOTE);
  });

  it("orphans after a whitespace change inside the quote", async () => {
    // Reflowed by an external editor: the quote now carries a newline where it
    // carried a space, so no literal occurrence of it is left either. §6's
    // selectors are byte-exact by design — the price of never guessing.
    const edited = ORIGINAL.replace("a 30-year fixed at 6.1%", "a 30-year fixed\nat 6.1%");
    const { range, orphaned } = await readAnchor("ladder-whitespace", edited);
    expect(orphaned).toBe(true);
    expect(range).toBeNull();
  });

  it("orphans a quote that is genuinely gone", async () => {
    const edited = ORIGINAL.replace(
      `We ${QUOTE} which may be stale, and revisit it each quarter.`,
      "The rate assumption has been dropped from this model entirely.",
    );
    const { range, orphaned } = await readAnchor("ladder-gone", edited);
    expect(orphaned).toBe(true);
    expect(range).toBeNull();
  });

  /**
   * Seed a document whose anchor was captured against `before` while the file on
   * disk holds `after`, and read the anchor back through the API.
   */
  const readAnchorAcross = async (
    name: string,
    before: string,
    quoted: string,
    after: string,
  ): Promise<{ orphaned: boolean; range: { start: number } | null; exact: string | undefined }> => {
    const start = before.indexOf(quoted);
    expect(start).toBeGreaterThanOrEqual(0);
    const captured = { exact: quoted, ...computeContext(before, start, start + quoted.length) };

    ws = createWriteWorkspace(name);
    ws.write(
      "data/docs/model.md",
      [
        "---",
        `id: ${DOC_ID}`,
        "type: note",
        "title: Parallel items",
        "created: 2026-07-01T00:00:00Z",
        "updated: 2026-07-01T00:00:00Z",
        "tags: []",
        "status: open",
        "anchors:",
        `  ${ANCHOR}:`,
        `    exact: ${JSON.stringify(captured.exact)}`,
        `    prefix: ${JSON.stringify(captured.prefix)}`,
        `    suffix: ${JSON.stringify(captured.suffix)}`,
        "due: null",
        "reviewed: null",
        "evergreen: false",
        "---",
        after,
      ].join("\n"),
    );
    ws.write("data/threads/th_ladder01.md", threadOn("Did this ship?"));
    ws.reproject();

    const doc = DocSchema.parse(await (await ws.request(`/api/docs/${DOC_ID}`)).json());
    const anchor = doc.anchors.find((candidate) => candidate.anchorId === ANCHOR);
    return {
      orphaned: anchor?.orphaned ?? false,
      range: anchor?.range ?? null,
      exact: anchor?.selector.exact,
    };
  };

  /**
   * The shapes that decided the policy, through the real API.
   *
   * Each has **four** parallel items, not two. At two items a deletion shortens
   * the body by a whole item, so a length comparison rejects the sibling for
   * free and a fixture at that size will certify an unsafe resolver as safe —
   * how SERVER-055's own safety tests passed while the rung it wired in was
   * landing threads on neighbours.
   */
  const RENEWALS = [
    "",
    "# Renewals",
    "",
    "- Ship the Q1 renewal report by Friday afternoon",
    "- Ship the Q2 renewal report by Friday afternoon",
    "- Ship the Q3 renewal report by Friday afternoon",
    "- Ship the Q4 renewal report by Friday afternoon",
    "",
  ].join("\n");
  const REGIONS = [
    "",
    "| region | owner | status |",
    "| --- | --- | --- |",
    "| north-1 | alice | green |",
    "| north-2 | alice | green |",
    "| north-3 | alice | green |",
    "| north-4 | alice | green |",
    "",
  ].join("\n");
  const MINUTES = [
    "",
    "# Minutes",
    "",
    "Attendees agreed to revisit the pricing model in Q1.",
    "",
    "Attendees agreed to revisit the staffing model in Q2.",
    "",
    "Attendees agreed to revisit the roadmap model in Q3.",
    "",
  ].join("\n");

  it.each([
    [
      "a bulleted list",
      "sibling-bullets",
      RENEWALS,
      "- Ship the Q2 renewal report by Friday afternoon",
    ],
    ["a table", "sibling-table", REGIONS, "| north-2 | alice | green |"],
    [
      "parallel prose",
      "sibling-prose",
      MINUTES,
      "Attendees agreed to revisit the staffing model in Q2.",
    ],
  ])(
    "orphans rather than jumping to a near-identical sibling in %s",
    async (_shape, name, before, quoted) => {
      const { orphaned, range, exact } = await readAnchorAcross(
        name,
        before,
        quoted,
        before.replace(`${quoted}\n`, ""),
      );
      expect(orphaned).toBe(true);
      expect(range).toBeNull();
      // And the selector is still readable on the detached thread, byte for byte.
      expect(exact).toBe(quoted);
    },
  );

  it("orphans an edited table row rather than pointing the thread at the row below", async () => {
    // The reason the policy is not merely conservative: with the fuzzy rung on
    // this path, the anchored row is *still on the page*, edited, and the reader
    // answers with its untouched neighbour — a comment silently moved onto text
    // its author never wrote about.
    const { orphaned, range } = await readAnchorAcross(
      "sibling-edited-row",
      REGIONS,
      "| north-2 | alice | green |",
      REGIONS.replace("| north-2 | alice | green |", "| north-2 | alice | amber |"),
    );
    expect(orphaned).toBe(true);
    expect(range).toBeNull();
  });

  it("agrees with the projection column the agent's context pack reads", async () => {
    // Both when the anchor holds…
    const kept = ORIGINAL.replace("We assume", "For now we deliberately assume");
    const attached = await readAnchor("ladder-projection-agreement", kept);
    expect(attached.orphaned).toBe(false);
    const readRow = (): number | null =>
      (
        ws.db.prepare("SELECT resolved_offset FROM anchors WHERE anchor_id = ?").get(ANCHOR) as {
          resolved_offset: number | null;
        }
      ).resolved_offset;
    expect(readRow()).toBe(attached.range?.start ?? null);

    // …and when it does not: the agent must not be told a thread is detached
    // while the board draws a highlight for it, nor the reverse.
    const detached = await readAnchor(
      "ladder-projection-agreement-orphan",
      ORIGINAL.replace("a 30-year fixed", "a 30-year fixed-rate"),
    );
    expect(detached.orphaned).toBe(true);
    expect(readRow()).toBeNull();
  });

  /**
   * How an out-of-band edit inside the quote is actually repaired, and the sense
   * in which the read path and the write path agree.
   *
   * They agree on the question "is this text demonstrably still here": both ask
   * the exactness tier, so neither ever claims a passage the other calls gone.
   * Reconciliation answers *more* because it holds the diff — it can see this
   * edit rewrite the anchored bytes — and what it does with that is rewrite the
   * selector to the bytes now on the page. So the reader's orphan is temporary
   * by construction: one save later, rung 1 carries the anchor again. What the
   * reader never does is anticipate that repair by guessing at it.
   */
  it("repairs a reader-orphaned anchor on the next save, and reads back attached", async () => {
    const edited = ORIGINAL.replace("a 30-year fixed", "a 30-year fixed-rate");
    const before = await readAnchor("ladder-round-trip", edited);
    expect(before.orphaned).toBe(true);

    const saved = ORIGINAL.replace(
      "a 30-year fixed at 6.1%",
      "a 30-year fixed-rate at 6.1%, reviewed quarterly",
    );
    const response = await putDoc(
      ws,
      DOC_ID,
      { body: saved },
      { ...JSON_HEADERS, "x-corpus-actor": "user" },
    );
    expect(response.status).toBe(200);
    const outcome = (await response.json()) as { anchors: { orphaned: string[] } };
    expect(outcome.anchors.orphaned).toEqual([]);

    const doc = DocSchema.parse(await (await ws.request(`/api/docs/${DOC_ID}`)).json());
    const anchor = doc.anchors.find((candidate) => candidate.anchorId === ANCHOR);
    expect(anchor?.orphaned).toBe(false);
    // Reconciliation rewrote the quote to the bytes on the page, and the reader
    // finds exactly those bytes back at the offset it reports.
    expect(doc.body.slice(anchor?.range?.start, anchor?.range?.end)).toBe(anchor?.selector.exact);
    expect(anchor?.selector.exact).toContain("30-year fixed-rate");
  });
});
