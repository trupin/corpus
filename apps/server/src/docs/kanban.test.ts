// SPEC.md §5's coupling rule and §10's default-open arbitration, through the
// real app, a real git repository and the real projection (SERVER-138).
//
// Both rules are "effects on documents the request never named" (§9.2, §11), so
// every case here asserts three surfaces rather than one: the frontmatter that
// landed on disk, the **number and content of the commits** — because "in the
// same commit" is the whole claim — and the warnings the response carried.

import { describe, expect, it, afterEach } from "vitest";
import { createDoc, createWriteWorkspace, putDoc, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

/** A kanban board over `stage`, scoped to a folder. */
const board = async (
  workspace: WriteWorkspace,
  options: {
    readonly title: string;
    readonly folder?: string;
    readonly stages?: readonly string[];
    readonly status?: Readonly<Record<string, string>>;
    readonly order?: number;
    readonly query?: Record<string, unknown>;
  },
): Promise<{ id: string; path: string }> =>
  createDoc(workspace, {
    type: "board",
    title: options.title,
    folder: options.folder ?? "views",
    order: options.order ?? 1,
    query: options.query ?? { folder: "inbox" },
    kanban: {
      field: "stage",
      stages: options.stages ?? ["triage", "doing", "done"],
      ...(options.status === undefined ? {} : { status: options.status }),
    },
  });

const statusOf = (workspace: WriteWorkspace, path: string): string | undefined =>
  workspace
    .read(path)
    .split("\n")
    .find((line) => line.startsWith("status:"));

describe("a stage decides a status while the document is in a kanban (SPEC.md §5)", () => {
  it("writes the mapped status on entry, in the same commit, and names both", async () => {
    ws = createWriteWorkspace("kanban-enter");
    await board(ws, { title: "K", status: { done: "resolved" } });
    const doc = await createDoc(ws, { type: "note", title: "Task" });
    ws.advance(60_000);
    const commitsBefore = ws.log("%s").length;

    const response = await putDoc(ws, doc.id, { stage: "done" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      doc: { frontmatter: { status: string; stage: string } };
      warnings: { code: string; detail: string }[];
    };

    expect(payload.doc.frontmatter.stage).toBe("done");
    expect(payload.doc.frontmatter.status).toBe("resolved");
    expect(ws.read(doc.path)).toContain("stage: done");
    expect(statusOf(ws, doc.path)).toBe("status: resolved");

    // One commit, holding both fields — §5 says "in the same commit".
    expect(ws.log("%s").length).toBe(commitsBefore + 1);
    expect(ws.git("show", "--stat", "--format=", "HEAD")).toContain(doc.path);
    const diff = ws.git("show", "--format=", "HEAD");
    expect(diff).toContain("+stage: done");
    expect(diff).toContain("+status: resolved");

    // §11: the caller asked for one field and got two, so the response says so.
    const warning = payload.warnings.find((entry) => entry.code === "stage_status");
    expect(warning?.detail).toContain("`done`");
    expect(warning?.detail).toContain("`resolved`");
    expect(warning?.detail).toContain("K");
  });

  it("writes `open` for a stage the board maps to nothing", async () => {
    ws = createWriteWorkspace("kanban-unmapped");
    await board(ws, { title: "K", status: { done: "resolved" } });
    const doc = await createDoc(ws, { type: "note", title: "Task", status: "resolved" });
    ws.advance(60_000);

    const response = await putDoc(ws, doc.id, { stage: "doing" });
    expect(response.status).toBe(200);
    expect(statusOf(ws, doc.path)).toBe("status: open");
    const payload = (await response.json()) as { warnings: { code: string; detail: string }[] };
    expect(payload.warnings.find((entry) => entry.code === "stage_status")?.detail).toContain(
      "maps no status to that stage",
    );
  });

  /** A cleared stage is in no `status` map, so §5's "no mapping writes `open`" covers it. */
  it("writes `open` when the stage is cleared", async () => {
    ws = createWriteWorkspace("kanban-clear");
    await board(ws, { title: "K", status: { done: "resolved" } });
    const doc = await createDoc(ws, { type: "note", title: "Task", stage: "done" });
    expect(statusOf(ws, doc.path)).toBe("status: resolved");
    ws.advance(60_000);

    expect((await putDoc(ws, doc.id, { stage: null })).status).toBe(200);
    expect(ws.read(doc.path)).not.toContain("stage:");
    expect(statusOf(ws, doc.path)).toBe("status: open");
  });

  /**
   * §5 draws its line at the **map**, not at the `stages` list: "a stage with no
   * mapping writes `open`", and a stage the board does not draw has no mapping.
   * The document is in the kanban either way, so the rider's second outcome
   * applies unchanged. (SERVER-138 once carved this case out and wrote nothing;
   * PR #58 removed the carve-out, because the rider never contained it.)
   */
  it("writes `open` for a stage the deciding board does not even draw", async () => {
    ws = createWriteWorkspace("kanban-unknown-stage");
    await board(ws, { title: "K", stages: ["triage", "done"], status: { done: "resolved" } });
    const doc = await createDoc(ws, { type: "note", title: "Task", status: "resolved" });
    ws.advance(60_000);

    const response = await putDoc(ws, doc.id, { stage: "elsewhere" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { warnings: { code: string; detail: string }[] };
    expect(statusOf(ws, doc.path)).toBe("status: open");
    const warning = payload.warnings.find((entry) => entry.code === "stage_status");
    // The message says which of the two outcomes happened, so nobody goes
    // looking in `kanban.status` for an entry that is not there.
    expect(warning?.detail).toContain("maps no status to that stage");
    expect(warning?.detail).toContain("`open`");
  });

  it("does nothing at all when no kanban's scope claims the document", async () => {
    ws = createWriteWorkspace("kanban-out-of-scope");
    await board(ws, { title: "K", query: { folder: "finance" }, status: { done: "resolved" } });
    const doc = await createDoc(ws, { type: "note", title: "Task" });
    ws.advance(60_000);

    const response = await putDoc(ws, doc.id, { stage: "done" });
    const payload = (await response.json()) as { warnings: { code: string }[] };
    expect(statusOf(ws, doc.path)).toBe("status: open");
    expect(payload.warnings.map((entry) => entry.code)).not.toContain("stage_status");
  });

  /**
   * §5: "Whether a document is 'in a kanban' is decided by the board's scope
   * query **with archived documents included**, because a document in a stage
   * mapped to `archived` is still in the kanban."
   */
  it("keeps an archived document in the kanban, so it can be moved back out", async () => {
    ws = createWriteWorkspace("kanban-archived");
    await board(ws, {
      title: "K",
      status: { done: "archived", triage: "open" },
    });
    const doc = await createDoc(ws, { type: "note", title: "Task" });
    ws.advance(60_000);
    expect((await putDoc(ws, doc.id, { stage: "done" })).status).toBe(200);
    expect(statusOf(ws, doc.path)).toBe("status: archived");

    // The document has dropped out of every default list — and must still be
    // reachable by the board that put it there.
    ws.advance(60_000);
    const back = await putDoc(ws, doc.id, { stage: "triage" });
    expect(back.status).toBe(200);
    expect(statusOf(ws, doc.path)).toBe("status: open");
  });

  /**
   * An **archived** skill's status is its folder, not its frontmatter
   * (`.claude/skills-archived/`, §7), so there is no status here for a board to
   * decide: the coupling declines rather than writing a key nothing reads, and
   * `POST /unarchive` — a filesystem move and a name release — stays the
   * operation that brings one back.
   *
   * An *enabled* skill is not in that set: its status **is** its frontmatter,
   * so a board may archive it exactly as `PUT {status: "archived"}` already
   * may, and the archive route heals the folder on its next call.
   */
  it("declines for a document whose root decides its status", async () => {
    ws = createWriteWorkspace("kanban-archived-skill");
    await board(ws, {
      title: "K",
      query: { type: "skill" },
      stages: ["triage", "done"],
      status: { triage: "open", done: "archived" },
    });
    // An archived skill is one whose folder sits here; nothing else makes it
    // archived, and its frontmatter is not consulted for status at all.
    ws.write(
      ".claude/skills-archived/demo/SKILL.md",
      [
        "---",
        "id: doc_archivedskill",
        "name: demo",
        "description: A demo skill",
        "title: Demo",
        "created: 2026-07-27T09:00:00Z",
        "updated: 2026-07-27T09:00:00Z",
        "tags: []",
        "status: open",
        "anchors: {}",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
    ws.reproject();
    ws.advance(60_000);

    const response = await putDoc(ws, "doc_archivedskill", { stage: "triage" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      doc: { frontmatter: { stage: string; status: string }; path: string };
      warnings: { code: string }[];
    };
    expect(payload.doc.frontmatter.stage).toBe("triage");
    // Still archived, and the file's own `status: open` is exactly as its
    // author left it: nothing was written that would claim otherwise.
    expect(payload.doc.frontmatter.status).toBe("archived");
    expect(ws.read(".claude/skills-archived/demo/SKILL.md")).toContain("status: open");
    expect(payload.warnings.map((entry) => entry.code)).not.toContain("stage_status");
  });

  /**
   * **SERVER-138's rule, not §5's** — the rider is silent on an archived board.
   * An archived board is out of sight, and a board nobody can see deciding a
   * status is a change with no visible cause.
   */
  it("lets a board archived after mapping decide nothing", async () => {
    ws = createWriteWorkspace("kanban-archived-board");
    const k = await board(ws, { title: "K", status: { done: "resolved" } });
    const doc = await createDoc(ws, { type: "note", title: "Task" });
    ws.advance(60_000);
    expect((await ws.post(`/api/docs/${k.id}/archive`, {})).status).toBe(200);
    ws.advance(60_000);

    expect((await putDoc(ws, doc.id, { stage: "done" })).status).toBe(200);
    expect(statusOf(ws, doc.path)).toBe("status: open");
  });

  it("lets the lowest `order` decide, and names the boards that did not", async () => {
    ws = createWriteWorkspace("kanban-two-boards");
    await board(ws, { title: "First", order: 1, status: { done: "resolved" } });
    await board(ws, { title: "Second", order: 2, status: { done: "archived" } });
    const doc = await createDoc(ws, { type: "note", title: "Task" });
    ws.advance(60_000);

    const response = await putDoc(ws, doc.id, { stage: "done" });
    const payload = (await response.json()) as { warnings: { code: string; detail: string }[] };
    expect(statusOf(ws, doc.path)).toBe("status: resolved");
    const warning = payload.warnings.find((entry) => entry.code === "stage_status");
    expect(warning?.detail).toContain("First");
    expect(warning?.detail).toContain("Second");
    expect(warning?.detail).toContain("lowest `order`");
  });

  it("couples on create, so a document born in a stage is born in its status", async () => {
    ws = createWriteWorkspace("kanban-create");
    await board(ws, { title: "K", status: { done: "resolved" } });
    ws.advance(60_000);
    const commitsBefore = ws.log("%s").length;

    const created = await createDoc(ws, { type: "note", title: "Task", stage: "done" });
    expect(statusOf(ws, created.path)).toBe("status: resolved");
    // The create is still one commit: the coupling is decided before the write.
    expect(ws.log("%s").length).toBe(commitsBefore + 1);
    expect(created.warnings.map((entry) => entry.code)).toContain("stage_status");
  });

  /** The same override, on the verb that has no stored status to compare against. */
  it("outranks a conflicting `status` on create too", async () => {
    ws = createWriteWorkspace("kanban-create-conflict");
    await board(ws, { title: "K", status: { done: "resolved" } });
    ws.advance(60_000);

    const created = await createDoc(ws, {
      type: "note",
      title: "Task",
      stage: "done",
      status: "open",
    });
    expect(statusOf(ws, created.path)).toBe("status: resolved");
    expect(created.warnings.map((entry) => entry.code)).toContain("stage_status");
  });

  /**
   * The scope is asked about the document **as this write will leave it**, not
   * as the row still holds it. A board whose own scope names a stage is the case
   * that separates the two: the stored row still carries the stage the document
   * is leaving, so a membership test against it would answer for the wrong
   * document — the create case has no row at all to be wrong about.
   */
  it("asks the scope about the stage this write is landing, not the one it is leaving", async () => {
    ws = createWriteWorkspace("kanban-pending-row");
    // A "done" board: it claims exactly the documents already in that stage.
    await board(ws, {
      title: "Done",
      query: { stage: "done" },
      stages: ["done"],
      status: { done: "resolved" },
    });
    const doc = await createDoc(ws, { type: "note", title: "Task" });
    ws.advance(60_000);

    // The row says `stage: null`, so the board does not claim this document yet.
    // The write is what puts it in scope, and the coupling has to see that.
    expect((await putDoc(ws, doc.id, { stage: "done" })).status).toBe(200);
    expect(statusOf(ws, doc.path)).toBe("status: resolved");

    // And out again: the row now says `done`, so a scope read off it would still
    // claim the document after the stage has left.
    ws.advance(60_000);
    expect((await putDoc(ws, doc.id, { stage: null })).status).toBe(200);
    expect(statusOf(ws, doc.path)).toBe("status: resolved");
  });

  it("leaves the stage alone for a write that changes only the status", async () => {
    ws = createWriteWorkspace("kanban-status-only");
    await board(ws, { title: "K", status: { done: "resolved" } });
    const doc = await createDoc(ws, { type: "note", title: "Task", stage: "doing" });
    ws.advance(60_000);

    expect((await putDoc(ws, doc.id, { status: "resolved" })).status).toBe(200);
    expect(ws.read(doc.path)).toContain("stage: doing");
    expect(statusOf(ws, doc.path)).toBe("status: resolved");
  });

  /**
   * §5: the coupling **outranks a `status` in the same patch**, and it says so
   * about the status the write is *trying to set* — not about the one the
   * document is leaving. The case that separates the two is a board that maps
   * two stages to one status: the document already carries that status, so a
   * guard comparing the coupled status against the stored one finds them equal
   * and stands aside, letting the caller's `open` land beside a stage the board
   * maps to `resolved`.
   */
  it("outranks a conflicting `status` even when the coupled status is the one already stored", async () => {
    ws = createWriteWorkspace("kanban-status-conflict-same");
    await board(ws, {
      title: "K",
      stages: ["triage", "done", "done2"],
      status: { done: "resolved", done2: "resolved" },
    });
    const doc = await createDoc(ws, { type: "note", title: "Task", stage: "done" });
    expect(statusOf(ws, doc.path)).toBe("status: resolved");
    ws.advance(60_000);

    const response = await putDoc(ws, doc.id, { stage: "done2", status: "open" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      doc: { frontmatter: { status: string; stage: string } };
      warnings: { code: string; detail: string }[];
    };

    // The stage decides, so the caller's `open` never lands.
    expect(payload.doc.frontmatter.stage).toBe("done2");
    expect(payload.doc.frontmatter.status).toBe("resolved");
    expect(ws.read(doc.path)).toContain("stage: done2");
    expect(statusOf(ws, doc.path)).toBe("status: resolved");

    // And §11: the caller asked for a status it did not get, so the response
    // names what happened instead.
    const warning = payload.warnings.find((entry) => entry.code === "stage_status");
    expect(warning?.detail).toContain("`done2`");
    expect(warning?.detail).toContain("`resolved`");
  });

  /**
   * The mirror: an **unmapped** stage writes `open` (§5's second outcome), and
   * that outranks a `resolved` in the same patch too — including when the
   * document is already `open`, which is the same equality the guard above trips
   * over, from the other side.
   */
  it("outranks a conflicting `status` for an unmapped stage, which writes `open`", async () => {
    ws = createWriteWorkspace("kanban-status-conflict-unmapped");
    await board(ws, { title: "K", status: { done: "resolved" } });
    const doc = await createDoc(ws, { type: "note", title: "Task" });
    expect(statusOf(ws, doc.path)).toBe("status: open");
    ws.advance(60_000);

    const response = await putDoc(ws, doc.id, { stage: "typo", status: "resolved" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      doc: { frontmatter: { status: string; stage: string } };
      warnings: { code: string; detail: string }[];
    };

    expect(payload.doc.frontmatter.stage).toBe("typo");
    expect(payload.doc.frontmatter.status).toBe("open");
    expect(ws.read(doc.path)).toContain("stage: typo");
    expect(statusOf(ws, doc.path)).toBe("status: open");
    const warning = payload.warnings.find((entry) => entry.code === "stage_status");
    expect(warning?.detail).toContain("maps no status to that stage");
    expect(warning?.detail).toContain("`open`");
  });

  /**
   * The other half of the same comparison, which the fix must not break: a stage
   * move whose coupled status is what the document already has, with no `status`
   * in the patch, writes nothing and says nothing. There is no override to
   * report, so a warning here would be noise on every ordinary drag between two
   * stages the board maps the same way.
   */
  it("says nothing when the coupled status is what the document already carries", async () => {
    ws = createWriteWorkspace("kanban-status-noop");
    await board(ws, {
      title: "K",
      stages: ["triage", "done", "done2"],
      status: { done: "resolved", done2: "resolved" },
    });
    const doc = await createDoc(ws, { type: "note", title: "Task", stage: "done" });
    ws.advance(60_000);

    const response = await putDoc(ws, doc.id, { stage: "done2" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { warnings: { code: string }[] };
    expect(payload.warnings.map((entry) => entry.code)).not.toContain("stage_status");
    expect(statusOf(ws, doc.path)).toBe("status: resolved");
    // The stage moved, so this is one ordinary save: `status` is context in the
    // diff rather than a line the coupling rewrote.
    const diff = ws.git("show", "--format=", "HEAD");
    expect(diff).toContain("+stage: done2");
    expect(diff).not.toMatch(/^\+status:/m);
  });

  /**
   * §10, rider 6: "the server does not enforce transitions, it enforces the
   * status map". Skipping the graph is exactly how a person or the CLI moves a
   * document a drag cannot.
   */
  it("never refuses a stage for being off the board's transitions", async () => {
    ws = createWriteWorkspace("kanban-transitions");
    await createDoc(ws, {
      type: "board",
      title: "K",
      folder: "views",
      order: 1,
      query: { folder: "inbox" },
      kanban: {
        field: "stage",
        stages: ["triage", "doing", "done"],
        transitions: { triage: ["doing"], doing: ["done"] },
        status: { done: "resolved" },
      },
    });
    const doc = await createDoc(ws, { type: "note", title: "Task", stage: "triage" });
    ws.advance(60_000);

    // triage → done is not an edge of the graph. The write lands anyway.
    expect((await putDoc(ws, doc.id, { stage: "done" })).status).toBe(200);
    expect(statusOf(ws, doc.path)).toBe("status: resolved");
  });

  it("is silent on an autosave that re-sends the stage already on disk", async () => {
    ws = createWriteWorkspace("kanban-autosave");
    await board(ws, { title: "K", status: { done: "resolved" } });
    const doc = await createDoc(ws, { type: "note", title: "Task", stage: "done" });
    ws.advance(60_000);
    const head = ws.head();

    const response = await putDoc(ws, doc.id, { stage: "done" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { warnings: { code: string }[] };
    expect(payload.warnings).toEqual([]);
    expect(ws.head()).toBe(head);
  });

  it("ignores a kanban over `status`, which is the field itself", async () => {
    ws = createWriteWorkspace("kanban-over-status");
    await createDoc(ws, {
      type: "board",
      title: "Status board",
      folder: "views",
      order: 1,
      query: { folder: "inbox" },
      kanban: { field: "status", stages: ["open", "resolved", "archived"] },
    });
    const doc = await createDoc(ws, { type: "note", title: "Task", status: "resolved" });
    ws.advance(60_000);

    const response = await putDoc(ws, doc.id, { stage: "done" });
    const payload = (await response.json()) as { warnings: { code: string }[] };
    expect(statusOf(ws, doc.path)).toBe("status: resolved");
    expect(payload.warnings.map((entry) => entry.code)).not.toContain("stage_status");
  });
});

describe("at most one board carries `default-open` (SPEC.md §10, rider 2)", () => {
  it("clears every other board in the same commit and names each one", async () => {
    ws = createWriteWorkspace("default-open-clear");
    const first = await createDoc(ws, {
      type: "board",
      title: "Attention",
      folder: "views",
      order: 1,
      defaultOpen: true,
    });
    ws.advance(60_000);
    const commitsBefore = ws.log("%s").length;

    const second = await createDoc(ws, {
      type: "board",
      title: "Files",
      folder: "views",
      order: 2,
      defaultOpen: true,
    });

    expect(ws.read(second.path)).toContain("default-open: true");
    expect(ws.read(first.path)).not.toContain("default-open");

    // One commit, holding both files — §9.2's "in the same commit".
    expect(ws.log("%s").length).toBe(commitsBefore + 1);
    const touched = ws.git("show", "--name-only", "--format=", "HEAD").trim().split("\n").sort();
    expect(touched).toEqual([first.path, second.path].sort());

    const warning = second.warnings.find((entry) => entry.code === "default_open_cleared");
    expect(warning?.detail).toContain(first.id);
    expect(warning?.detail).toContain("Attention");
    expect(second.warnings.filter((entry) => entry.code === "default_open_cleared")).toHaveLength(
      1,
    );
  });

  it("says nothing when no other board carried the flag", async () => {
    ws = createWriteWorkspace("default-open-alone");
    const only = await createDoc(ws, {
      type: "board",
      title: "Attention",
      folder: "views",
      order: 1,
      defaultOpen: true,
    });
    expect(only.warnings.map((entry) => entry.code)).not.toContain("default_open_cleared");
  });

  it("arbitrates on update too, and names one warning per board cleared", async () => {
    ws = createWriteWorkspace("default-open-update");
    const first = await createDoc(ws, {
      type: "board",
      title: "One",
      folder: "views",
      order: 1,
      defaultOpen: true,
    });
    // A second document carrying the flag on disk — the state a workspace can
    // reach out of band, and the one the invariant has to survive.
    ws.write(
      "data/docs/views/stray.md",
      [
        "---",
        "id: doc_straydefault",
        "type: board",
        "title: Stray",
        "created: 2026-07-27T09:00:00Z",
        "updated: 2026-07-27T09:00:00Z",
        "tags: []",
        "status: open",
        "anchors: {}",
        "default-open: true",
        "---",
        "",
        "Stray.",
        "",
      ].join("\n"),
    );
    ws.reproject();

    const third = await createDoc(ws, {
      type: "board",
      title: "Three",
      folder: "views",
      order: 3,
    });
    ws.advance(60_000);

    const response = await putDoc(ws, third.id, { defaultOpen: true });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { warnings: { code: string; detail: string }[] };
    const cleared = payload.warnings.filter((entry) => entry.code === "default_open_cleared");
    expect(cleared).toHaveLength(2);
    expect(cleared.map((entry) => entry.detail).join(" ")).toContain(first.id);
    expect(cleared.map((entry) => entry.detail).join(" ")).toContain("doc_straydefault");

    expect(ws.read(first.path)).not.toContain("default-open");
    expect(ws.read("data/docs/views/stray.md")).not.toContain("default-open");
    expect(ws.read(third.path)).toContain("default-open: true");
  });

  it("clears nothing when the flag is being taken away rather than given", async () => {
    ws = createWriteWorkspace("default-open-off");
    const first = await createDoc(ws, {
      type: "board",
      title: "One",
      folder: "views",
      order: 1,
      defaultOpen: true,
    });
    const second = await createDoc(ws, {
      type: "board",
      title: "Two",
      folder: "views",
      order: 2,
    });
    ws.advance(60_000);

    const response = await putDoc(ws, second.id, { defaultOpen: false });
    const payload = (await response.json()) as { warnings: { code: string }[] };
    expect(payload.warnings.map((entry) => entry.code)).not.toContain("default_open_cleared");
    expect(ws.read(first.path)).toContain("default-open: true");
  });
});

describe("`unset` removes a frontmatter key (SPEC.md §9.2)", () => {
  it("removes a core key and an extra one in the same commit as the rest of the patch", async () => {
    ws = createWriteWorkspace("unset-keys");
    const doc = await createDoc(ws, {
      type: "view",
      title: "Finance",
      folder: "views",
      order: 3,
      extra: { pinned: true, column: "board/kanban" },
    });
    ws.advance(60_000);
    const commitsBefore = ws.log("%s").length;

    const response = await putDoc(ws, doc.id, {
      unset: ["pinned", "order"],
      tags: ["migrated"],
    });
    expect(response.status).toBe(200);

    const text = ws.read(doc.path);
    expect(text).not.toContain("pinned:");
    expect(text).not.toContain("order:");
    expect(text).toContain("column: board/kanban");
    expect(text).toContain("- migrated");
    expect(ws.log("%s").length).toBe(commitsBefore + 1);
  });

  it("is a no-op for a key the document does not carry, so a migration re-runs", async () => {
    ws = createWriteWorkspace("unset-absent");
    const doc = await createDoc(ws, { type: "note", title: "Plain" });
    ws.advance(60_000);
    const head = ws.head();

    const response = await putDoc(ws, doc.id, { unset: ["pinned"] });
    expect(response.status).toBe(200);
    expect(ws.head()).toBe(head);
  });

  it.each(["id", "type", "created"])("refuses to unset `%s`, naming the key", async (key) => {
    ws = createWriteWorkspace(`unset-refuse-${key}`);
    const doc = await createDoc(ws, { type: "note", title: "Plain" });
    const before = ws.read(doc.path);
    ws.advance(60_000);

    const response = await putDoc(ws, doc.id, { unset: [key] });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(`\`${key}\` cannot be unset`);
    expect(ws.read(doc.path)).toBe(before);
  });
});
