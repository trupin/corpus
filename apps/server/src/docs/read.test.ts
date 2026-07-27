import { DocListSchema, DocSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

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
