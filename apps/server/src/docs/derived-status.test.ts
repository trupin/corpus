// SPEC.md §12's closing promise, at the write path (SERVER-085): "the derived
// value is written into the document's frontmatter whenever the server writes
// the document, so reading the file, querying the projection and looking at the
// board all give one answer."
//
// Every assertion here reads a real surface — the file on disk, `git log`, or
// the projection — through the real app. The derivation is a stand-in, for the
// reason `projection/derived-status.test.ts` gives: `apps/server` may not import
// `plugins/*`, and what is under test is the write path, not the todos plugin's
// reading of a checkbox.

import { afterEach, describe, expect, it } from "vitest";
import { createDerivedStatusRegistry } from "../plugins/derived-status.js";
import { createDoc, createWriteWorkspace, putDoc, type WriteWorkspace } from "./write-fixture.js";

const derivedStatus = createDerivedStatusRegistry([
  {
    dir: "todos",
    types: [{ type: "todo", derivedStatus: true }],
    deriveStatus: (input) => {
      if (input.status === "archived") return null;
      const items = input.body.match(/^- \[[ x]\]/gm) ?? [];
      return items.length > 0 && items.every((item) => item === "- [x]") ? "resolved" : "open";
    },
  },
]);

let ws: WriteWorkspace;

const openWorkspace = (options: { plugins?: boolean } = {}): WriteWorkspace => {
  ws = createWriteWorkspace("derived", {
    sprint: "s040",
    ...(options.plugins === false ? {} : { derivedStatus }),
  });
  return ws;
};

afterEach(() => {
  ws.close();
});

/** A todo document with one open item, created through the real route. */
async function seedTodo(
  body = "- [ ] renew the passport\n",
  type = "todo",
): Promise<{ id: string; path: string }> {
  const created = await createDoc(ws, { type, title: "Errands", folder: "inbox", body });
  return { id: created.id, path: created.path };
}

const storedStatus = (path: string): string | undefined =>
  /^status: (.+)$/m.exec(ws.read(path))?.[1];

const rowStatus = (id: string): string | undefined =>
  (
    ws.db.prepare("SELECT status FROM documents WHERE id = ?").get(id) as
      { status: string } | undefined
  )?.status;

const commitCount = (): number => ws.log("%s").length;

describe("a derived status converges into the file the server writes (SPEC.md §12)", () => {
  it("writes the derived value in the same write as the body edit, and in one commit", async () => {
    openWorkspace();
    const todo = await seedTodo();
    expect(storedStatus(todo.path)).toBe("open");

    // A minute on, so §4's commit window is closed and the next write is its
    // own commit rather than an amend of the create.
    ws.advance(60_000);
    const before = commitCount();
    const response = await putDoc(ws, todo.id, { body: "- [x] renew the passport\n" });
    expect(response.status).toBe(200);

    expect(storedStatus(todo.path)).toBe("resolved");
    expect(rowStatus(todo.id)).toBe("resolved");
    // One commit, never two: the convergence rides the write it belongs to.
    expect(commitCount()).toBe(before + 1);
    expect(ws.log("%s")[0]).toContain(`doc edit: Errands (${todo.id})`);
  });

  it("stamps `updated` once — the convergence is not a second edit", async () => {
    openWorkspace();
    const todo = await seedTodo();
    const created = /^updated: (.+)$/m.exec(ws.read(todo.path))?.[1];
    ws.advance(60_000);
    await putDoc(ws, todo.id, { body: "- [x] renew the passport\n" });

    // One `updated:` key, moved exactly once — a convergence that wrote a
    // second time would have stamped a second instant over the first.
    const stamps = ws.read(todo.path).match(/^updated: (.+)$/gm) ?? [];
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).not.toBe(`updated: ${created ?? ""}`);
    // And the row agrees with the file it was projected from.
    expect(
      (
        ws.db.prepare("SELECT updated FROM documents WHERE id = ?").get(todo.id) as {
          updated: string;
        }
      ).updated,
    ).toBe(stamps[0]?.replace("updated: ", ""));
  });

  it("reopens the list when an item is unchecked again, file and row together", async () => {
    openWorkspace();
    const todo = await seedTodo();
    ws.advance(60_000);
    await putDoc(ws, todo.id, { body: "- [x] renew the passport\n" });
    ws.advance(60_000);
    await putDoc(ws, todo.id, { body: "- [ ] renew the passport\n" });

    expect(storedStatus(todo.path)).toBe("open");
    expect(rowStatus(todo.id)).toBe("open");
  });

  it("converges a status stale on disk in the same write as an unrelated field", async () => {
    openWorkspace();
    const todo = await seedTodo();
    // What an out-of-band edit leaves behind: the items say resolved, the file
    // still says open, and the projection is already right about it.
    ws.write(todo.path, ws.read(todo.path).replace("- [ ] renew", "- [x] renew"));
    ws.reproject();
    expect(storedStatus(todo.path)).toBe("open");
    expect(rowStatus(todo.id)).toBe("resolved");

    ws.advance(60_000);
    const before = commitCount();
    await putDoc(ws, todo.id, { tags: ["errands"] });

    expect(storedStatus(todo.path)).toBe("resolved");
    expect(commitCount()).toBe(before + 1);
  });

  it("never opens a write of its own: a save that changes nothing changes nothing", async () => {
    openWorkspace();
    const todo = await seedTodo();
    ws.write(todo.path, ws.read(todo.path).replace("- [ ] renew", "- [x] renew"));
    ws.reproject();

    ws.advance(60_000);
    const before = commitCount();
    const bytes = ws.read(todo.path);
    // The autosave §4 describes: the same title, no body, nothing moved.
    const response = await putDoc(ws, todo.id, { title: "Errands" });

    expect(response.status).toBe(200);
    // The file is left exactly as the person's editor left it. Its status is
    // stale and stays stale; the row is the one every surface reads.
    expect(ws.read(todo.path)).toBe(bytes);
    expect(commitCount()).toBe(before);
    expect(rowStatus(todo.id)).toBe("resolved");
  });

  it("never overwrites `archived`, however the items read", async () => {
    openWorkspace();
    const todo = await seedTodo();
    ws.advance(60_000);
    expect((await ws.post(`/api/docs/${todo.id}/archive`, {})).status).toBe(200);
    const archivedPath = (
      ws.db.prepare("SELECT path FROM documents WHERE id = ?").get(todo.id) as { path: string }
    ).path;

    ws.advance(60_000);
    const response = await putDoc(ws, todo.id, { body: "- [x] renew the passport\n" });
    expect(response.status).toBe(200);

    expect(storedStatus(archivedPath)).toBe("archived");
    expect(rowStatus(todo.id)).toBe("archived");
  });

  it("unarchives to whatever the items say at that moment (SPEC.md §5)", async () => {
    openWorkspace();
    const done = await seedTodo("- [x] renew the passport\n");
    const undone = await seedTodo("- [ ] file the taxes\n");

    for (const todo of [done, undone]) {
      ws.advance(60_000);
      expect((await ws.post(`/api/docs/${todo.id}/archive`, {})).status).toBe(200);
    }
    for (const todo of [done, undone]) {
      ws.advance(60_000);
      expect((await ws.post(`/api/docs/${todo.id}/unarchive`, {})).status).toBe(200);
    }

    // `resolved` is what unarchiving writes for every type (§5); for a derived
    // type the convergence then answers the items instead, in the same write.
    expect(rowStatus(done.id)).toBe("resolved");
    expect(rowStatus(undone.id)).toBe("open");
    const pathOf = (id: string): string =>
      (ws.db.prepare("SELECT path FROM documents WHERE id = ?").get(id) as { path: string }).path;
    expect(storedStatus(pathOf(done.id))).toBe("resolved");
    expect(storedStatus(pathOf(undone.id))).toBe("open");
  });

  it("converges the document a create writes", async () => {
    openWorkspace();
    const todo = await seedTodo("- [x] already done\n");

    expect(storedStatus(todo.path)).toBe("resolved");
    expect(rowStatus(todo.id)).toBe("resolved");
    // One commit for the create, not a create plus a convergence.
    expect(ws.log("%s").filter((subject) => subject.includes(todo.id))).toHaveLength(1);
  });

  it("leaves a type no plugin declares exactly as its file states it", async () => {
    openWorkspace();
    const note = await seedTodo("- [x] a checkbox in a note\n", "note");

    expect(storedStatus(note.path)).toBe("open");
    expect(rowStatus(note.id)).toBe("open");
  });

  it("leaves every document alone when the plugin is gone (§15 M6)", async () => {
    openWorkspace({ plugins: false });
    const todo = await seedTodo("- [x] already done\n");

    expect(storedStatus(todo.path)).toBe("open");
    expect(rowStatus(todo.id)).toBe("open");

    ws.advance(60_000);
    await putDoc(ws, todo.id, { body: "- [ ] not done after all\n" });
    expect(storedStatus(todo.path)).toBe("open");
  });

  it("keeps `GET /api/docs?status=` and the file in step", async () => {
    openWorkspace();
    const done = await seedTodo("- [x] renew the passport\n");
    const open = await seedTodo("- [ ] file the taxes\n");

    const listed = async (status: string): Promise<string[]> => {
      const response = await ws.request(`/api/docs?status=${status}&type=todo`);
      const payload = (await response.json()) as { items: { id: string }[] };
      return payload.items.map((row) => row.id);
    };

    expect(await listed("resolved")).toEqual([done.id]);
    expect(await listed("open")).toEqual([open.id]);
  });
});
