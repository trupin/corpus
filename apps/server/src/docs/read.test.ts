import { DocListSchema, DocSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { computeContext } from "../anchors/index.js";
import {
  createDoc,
  createWriteWorkspace,
  JSON_HEADERS,
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
 * SPEC.md §6's resolution ladder, end to end on the read path (SERVER-055).
 *
 * Every case here edits the file **out of band** — the state where the ladder is
 * the only thing standing between a comment and detachment, because no
 * reconciliation pass has refreshed the selector. Before SERVER-055 this path
 * stopped at rungs 1–2, so the two shapes that touch the quote itself came back
 * `orphaned` although the commented sentence is plainly still on the page.
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

  it("resolves after an insertion inside the quote", async () => {
    // Both exact rungs are gone — the quoted characters no longer occur — and
    // this is the shape that used to detach the comment.
    const edited = ORIGINAL.replace("a 30-year fixed", "a 30-year fixed-rate");
    const { range, orphaned, body } = await readAnchor("ladder-insert-inside", edited);
    expect(orphaned).toBe(false);
    expect(body.slice(range?.start, range?.end)).toContain("30-year fixed-rate");
  });

  it("resolves after a deletion following the quote", async () => {
    const edited = ORIGINAL.replace(" which may be stale,", "");
    const { range, orphaned, body } = await readAnchor("ladder-delete-after", edited);
    expect(orphaned).toBe(false);
    expect(body.slice(range?.start, range?.end)).toBe(QUOTE);
  });

  it("resolves after a whitespace change inside the quote", async () => {
    // Reflowed by an external editor: the quote now carries a newline where it
    // carried a space, so no literal occurrence of it is left either.
    const edited = ORIGINAL.replace("a 30-year fixed at 6.1%", "a 30-year fixed\nat 6.1%");
    const { range, orphaned, body } = await readAnchor("ladder-whitespace", edited);
    expect(orphaned).toBe(false);
    expect(body.slice(range?.start, range?.end)).toContain("30-year fixed\nat 6.1%");
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

  it("orphans rather than jumping to a near-identical sibling of the deleted line", async () => {
    // The rung's whole risk, in the shape that motivated keeping it off this
    // path: delete the commented line and leave a sibling that scores well above
    // the similarity threshold against it. Its neighbours are not the declared
    // ones, so the rung refuses it and the thread detaches honestly.
    const bullets = [
      "",
      "# Renewals",
      "",
      "- Ship the Q3 renewal report by Friday afternoon",
      "- Ship the Q4 renewal report by Friday afternoon",
      "",
    ].join("\n");
    const doomed = "- Ship the Q3 renewal report by Friday afternoon";
    const start = bullets.indexOf(doomed);
    const bulletSelector = {
      exact: doomed,
      ...computeContext(bullets, start, start + doomed.length),
    };

    ws = createWriteWorkspace("ladder-sibling");
    const after = bullets.replace(`${doomed}\n`, "");
    ws.write(
      "data/docs/model.md",
      [
        "---",
        `id: ${DOC_ID}`,
        "type: note",
        "title: Renewals",
        "created: 2026-07-01T00:00:00Z",
        "updated: 2026-07-01T00:00:00Z",
        "tags: []",
        "status: open",
        "anchors:",
        `  ${ANCHOR}:`,
        `    exact: ${JSON.stringify(bulletSelector.exact)}`,
        `    prefix: ${JSON.stringify(bulletSelector.prefix)}`,
        `    suffix: ${JSON.stringify(bulletSelector.suffix)}`,
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
    expect(anchor?.orphaned).toBe(true);
    expect(anchor?.range).toBeNull();
    // And the selector is still readable on the detached thread, byte for byte.
    expect(anchor?.selector.exact).toBe(doomed);
  });

  it("agrees with the projection column the agent's context pack reads", async () => {
    const edited = ORIGINAL.replace("a 30-year fixed", "a 30-year fixed-rate");
    const { range } = await readAnchor("ladder-projection-agreement", edited);
    const row = ws.db
      .prepare("SELECT resolved_offset FROM anchors WHERE anchor_id = ?")
      .get(ANCHOR) as { resolved_offset: number | null };
    expect(row.resolved_offset).toBe(range?.start ?? null);
  });

  /**
   * The divergence the issue names as worse than either half alone: an anchor
   * that reconciles cleanly on save and then reads back orphaned. Both sides now
   * ask `resolveAnchor`, so a selector the reader resolves fuzzily is a selector
   * reconciliation locates too — and the save rewrites it to the edited bytes,
   * after which the reader is back on rung 1.
   */
  it("round-trips a fuzzy-resolved anchor through the real save path", async () => {
    const edited = ORIGINAL.replace("a 30-year fixed", "a 30-year fixed-rate");
    const before = await readAnchor("ladder-round-trip", edited);
    expect(before.orphaned).toBe(false);

    const saved = ORIGINAL.replace(
      "a 30-year fixed at 6.1%",
      "a 30-year fixed-rate at 6.1%, reviewed quarterly",
    );
    const response = await ws.put(
      `/api/docs/${DOC_ID}`,
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
