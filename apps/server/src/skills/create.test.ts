// `POST /api/skills` against a real workspace with a real git repository
// (SERVER-036). Nothing is stubbed: the verb's whole claim is that a skill is
// created *through the ordinary write path*, so every assertion reads one of the
// four surfaces that claim is about — the file on disk, `git log`, the
// projection, and the invalidation bus.

import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocMutationResponseSchema, type QueryKey } from "@corpus/contract";
import { createDocumentMutex, type DocsWorkspace } from "../docs/index.js";
import { AUTH, createWriteWorkspace, type WriteWorkspace } from "../docs/write-fixture.js";
import { createAutoCommitter, createGit } from "../git/index.js";
import { silentLogger } from "../logger.js";
import { createSkill } from "./create.js";
import { archivedSkillFolderPath, skillDocumentPath, skillFolderPath } from "./paths.js";

let ws: WriteWorkspace;
let keys: QueryKey[][];
let unsubscribe: () => void;

const NAME = "weekly-review";
const PATH = skillDocumentPath(NAME);

beforeEach(() => {
  ws = createWriteWorkspace("skill-create", { sprint: "s015" });
  keys = [];
  unsubscribe = ws.server.bus.subscribe((frame) => {
    keys.push([...frame]);
  });
});

afterEach(() => {
  unsubscribe();
  ws.close();
});

async function create(
  body: Record<string, unknown> = { name: NAME, description: "Run the weekly review." },
  actor = "agent",
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await ws.server.app.request("/api/skills", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json", "x-corpus-author": actor },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

const rowFor = (path: string): { id: string; type: string; title: string } | undefined =>
  ws.db.prepare("SELECT id, type, title FROM documents WHERE path = ?").get(path) as
    { id: string; type: string; title: string } | undefined;

describe("creating a skill", () => {
  it("writes SKILL.md into the skills root with both frontmatter vocabularies", async () => {
    const { status, payload } = await create();

    expect(status).toBe(201);
    const { doc, warnings } = DocMutationResponseSchema.parse(payload);
    expect(warnings).toEqual([]);
    expect(doc.path).toBe(PATH);
    expect(doc.frontmatter.type).toBe("skill");
    expect(doc.frontmatter.title).toBe(NAME);

    const text = ws.read(PATH);
    // Claude Code's two discovery keys lead, then §5's canonical block — the
    // shape the shipped `orchestrate`/`comment` skills already have.
    expect(text.split("\n").slice(0, 11)).toEqual([
      "---",
      `name: ${NAME}`,
      "description: Run the weekly review.",
      `id: ${doc.frontmatter.id}`,
      "type: skill",
      `title: ${NAME}`,
      "created: 2026-07-27T09:00:00Z",
      "updated: 2026-07-27T09:00:00Z",
      "tags: []",
      "status: open",
      "anchors: {}",
    ]);
  });

  it("mints a real document id rather than leaving the path to synthesize one", async () => {
    const { payload } = await create();
    const id = DocMutationResponseSchema.parse(payload).doc.frontmatter.id;

    // Not `doc_skill<hex>`: a synthesized id is a function of where the file
    // sits, so archiving the skill (which moves its folder) would turn it into a
    // different document. The shipped skills carry a real id for the same reason.
    expect(id).toMatch(/^doc_[a-z2-7]{8}$/);
    expect(rowFor(PATH)).toEqual({ id, type: "skill", title: NAME });
  });

  it("lands as a normal auto-commit attributed to the acting party", async () => {
    const before = ws.head();
    const { payload } = await create({ name: NAME, description: "Run it." }, "user");
    const id = DocMutationResponseSchema.parse(payload).doc.frontmatter.id;

    expect(ws.head()).not.toBe(before);
    const [author, subject] = ws.git("log", "-1", "--format=%an <%ae>%n%s").trim().split("\n");
    expect(author).toBe("user <user@corpus.local>");
    expect(subject).toBe(`skill create: ${NAME} (${id}) by user`);
    // The file is committed, not merely written: `.claude/` is tracked in a
    // workspace, which is what makes `corpus skill rollback` possible at all.
    expect(ws.git("show", "--name-only", "--format=", "HEAD").trim()).toBe(PATH);
  });

  it("re-projects before responding and announces the document's keys, but not the tree", async () => {
    keys.length = 0;
    const { payload } = await create();
    const id = DocMutationResponseSchema.parse(payload).doc.frontmatter.id;

    // Read-your-write: the row is there by the time the response is built.
    expect(rowFor(PATH)?.id).toBe(id);
    expect(keys).toEqual([[["docs"], ["docs", id]]]);
    // Skills live outside `data/docs/`, the only tree `GET /api/tree` describes.
    expect(keys.flat().some(([head]) => head === "tree")).toBe(false);
  });

  it("is immediately discoverable as a skill document, without a restart", async () => {
    const { payload } = await create();
    const id = DocMutationResponseSchema.parse(payload).doc.frontmatter.id;

    const response = await ws.request("/api/docs?type=skill", { headers: AUTH });
    const listed = (await response.json()) as { items: { id: string; path: string }[] };
    expect(listed.items.map((row) => row.id)).toContain(id);
    expect(listed.items.find((row) => row.id === id)?.path).toBe(PATH);
  });

  it("passes the §14 validator it was written through", async () => {
    await create();

    const response = await ws.post("/api/check", {
      documents: [{ path: PATH, content: ws.read(PATH) }],
    });
    const report = (await response.json()) as { errors: unknown[]; warnings: unknown[] };
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});

describe("what the request may choose", () => {
  it("takes an explicit title, tags and body", async () => {
    const { payload } = await create({
      name: NAME,
      description: "Run the weekly review.",
      title: "Weekly Review",
      tags: ["core", "cadence"],
      body: "## Steps\n\nRead the inbox.\n",
    });

    const { doc } = DocMutationResponseSchema.parse(payload);
    expect(doc.frontmatter.title).toBe("Weekly Review");
    expect(doc.frontmatter.tags).toEqual(["core", "cadence"]);
    expect(doc.body).toBe("## Steps\n\nRead the inbox.\n");
    expect(rowFor(PATH)?.title).toBe("Weekly Review");
  });

  it("pre-fills the body from the workspace's skill template when one exists", async () => {
    ws.write(
      "data/docs/templates/skill.md",
      "---\nid: doc_tmplskil\ntype: template\ntitle: Skill\nfor: skill\n" +
        "created: 2026-07-27T09:00:00Z\nupdated: 2026-07-27T09:00:00Z\n---\n\n## When this runs\n",
    );
    ws.reproject();

    const { payload } = await create();
    // Verbatim, leading blank line and all: a template contributes its body and
    // nothing else (`docs/templates.ts`), and this route follows that rule
    // rather than inventing a second one.
    expect(DocMutationResponseSchema.parse(payload).doc.body).toBe("\n## When this runs\n");
  });

  it("leaves the body empty when the workspace defines no skill template", async () => {
    const { payload } = await create();
    expect(DocMutationResponseSchema.parse(payload).doc.body).toBe("");
  });

  it("reports §14 warnings without failing the write", async () => {
    const { status, payload } = await create({
      name: NAME,
      description: "Run it.",
      body: "See [[doc_absent01]].\n",
    });

    expect(status).toBe(201);
    const { warnings } = DocMutationResponseSchema.parse(payload);
    expect(warnings.map((warning) => warning.code)).toContain("unresolved_ref");
    expect(ws.exists(PATH)).toBe(true);
  });
});

describe("refusing a name that is taken", () => {
  it("refuses an installed skill with 409 and writes nothing", async () => {
    await create();
    const text = ws.read(PATH);
    const head = ws.head();

    const { status, payload } = await create({ name: NAME, description: "A second one." });

    expect(status).toBe(409);
    expect(payload["code"]).toBe("conflict");
    expect(String(payload["message"])).toContain(skillFolderPath(NAME));
    expect(ws.read(PATH)).toBe(text);
    expect(ws.head()).toBe(head);
  });

  // SERVER-036's open question, decided here: an archived skill keeps its name.
  // Archiving is §7's reversible act, and creating over the name would strand
  // the archived folder — `docs/archive.ts`'s unarchive guard would then refuse
  // with a 400 about a directory the operator never mentioned.
  it("refuses a name held by an archived skill, and says how to get it back", async () => {
    const archived = archivedSkillFolderPath(NAME);
    ws.write(`${archived}/SKILL.md`, `---\nname: ${NAME}\ndescription: Archived.\n---\n\nOld.\n`);
    ws.reproject();
    const head = ws.head();

    const { status, payload } = await create();

    expect(status).toBe(409);
    expect(payload["code"]).toBe("conflict");
    expect(String(payload["message"])).toContain(archived);
    expect(String(payload["message"])).toContain("unarchive");
    expect(ws.exists(PATH)).toBe(false);
    expect(ws.head()).toBe(head);
  });

  it("refuses a name occupied by a symlink, broken or not", async () => {
    // §10 symlinks a plugin's skill into `.claude/skills/<name>`, and a link
    // whose target has gone is invisible to `existsSync` while still being an
    // entry no `mkdir` can create through.
    mkdirSync(join(ws.root, ".claude", "skills"), { recursive: true });
    symlinkSync(join(ws.root, "nowhere"), join(ws.root, ".claude", "skills", NAME));

    const { status, payload } = await create();
    expect(status).toBe(409);
    expect(String(payload["message"])).toContain("already installed");
  });

  it("hands one of two concurrent creates of the same name the conflict", async () => {
    const [first, second] = await Promise.all([create(), create()]);

    // One lane for every create: the loser sees the winner's file, never a
    // half-written one, and never silently edits it.
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(ws.git("log", "--format=%s", "--", PATH).trim().split("\n")).toHaveLength(1);
  });
});

describe("refusing a name that could escape the skills root", () => {
  it.each([
    ["a traversal segment", "../evil"],
    ["a nested path", "a/b"],
    ["an absolute path", "/etc/passwd"],
    ["a bare dot-dot", ".."],
    ["an encoded traversal", "%2e%2e"],
    ["a backslash", "a\\b"],
    ["upper case", "Weekly"],
    ["an empty name", ""],
    ["a name past the length bound", "a".repeat(65)],
  ])("refuses %s with 400 and writes nothing", async (_label, name) => {
    const { status, payload } = await create({ name, description: "Nope." });

    expect(status).toBe(400);
    expect(payload["code"]).toBe("bad_request");
    // Nothing was created anywhere under the skills root.
    expect(ws.exists(".claude/skills")).toBe(false);
  });

  it("refuses a hostile name handed straight to the function, not only over the wire", async () => {
    // The route validates against the same schema, so this is the only way to
    // reach the guard — and the guard exists so a future caller cannot skip the
    // boundary and have the path derivation trust the string.
    const workspaceRoot = ws.server.config.workspaceRoot;
    const workspace: DocsWorkspace = {
      workspaceRoot,
      projection: ws.db,
      git: createAutoCommitter({
        git: createGit(workspaceRoot),
        logger: silentLogger,
        now: () => ws.clock,
      }),
      selfWrites: ws.server.selfWrites,
      bus: ws.server.bus,
      logger: silentLogger,
      now: () => ws.clock,
    };
    await expect(
      createSkill(workspace, createDocumentMutex(), "agent", {
        name: "../escape",
        description: "Nope.",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(ws.exists(".claude/skills")).toBe(false);
  });
});

describe("what a created skill composes with", () => {
  it("is rollbackable: the verb §7 promises works on a skill the server created", async () => {
    const { payload } = await create({
      name: NAME,
      description: "Run the weekly review.",
      body: "Version one.\n",
    });
    const id = DocMutationResponseSchema.parse(payload).doc.frontmatter.id;
    const original = ws.read(PATH);

    // An out-of-band edit, committed — the case §7's escape hatch is for.
    writeFileSync(join(ws.root, PATH), original.replace("Version one.", "Broken."), "utf8");
    ws.git("add", "-A", "--", PATH);
    ws.git("commit", "-m", "break the skill");
    ws.reproject();

    const response = await ws.server.app.request(`/api/skills/${NAME}/rollback`, {
      method: "POST",
      headers: { ...AUTH, "x-corpus-author": "agent" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: NAME, docId: id, path: PATH });
    expect(ws.read(PATH)).toBe(original);
  });
});
