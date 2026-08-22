// SPEC.md §12's closing promise, at the write path (SERVER-085 for `status`,
// SERVER-134 for `due`): "the derived value is written into the document's
// frontmatter whenever the server writes the document, so reading the file,
// querying the projection and looking at the board all give one answer."
//
// Every assertion here reads a real surface — the file on disk, `git log`, or
// the projection — through the real app. The derivations are stand-ins, for the
// reason `projection/derived-fields.test.ts` gives: `apps/server` may not import
// `plugins/*`, and what is under test is the write path, not the todos plugin's
// reading of a checkbox.

import { afterEach, describe, expect, it } from "vitest";
import {
  createDerivedFieldsRegistry,
  type DeriveInput,
  type DerivedDocDue,
} from "../plugins/derived-fields.js";
import { createDoc, createWriteWorkspace, putDoc, type WriteWorkspace } from "./write-fixture.js";

const deriveStatus = (input: DeriveInput): "open" | "resolved" | null => {
  if (input.status === "archived") return null;
  const items = input.body.match(/^- \[[ x]\]/gm) ?? [];
  return items.length > 0 && items.every((item) => item === "- [x]") ? "resolved" : "open";
};

/** PLUGINS-018's rule, as a stand-in: the earliest **open** item's deadline. */
const deriveDue = (input: DeriveInput): DerivedDocDue | null => {
  if (input.status === "archived") return null;
  const dates = [...input.body.matchAll(/^- \[ \] .*\(due: (\d{4}-\d{2}-\d{2})\)\s*$/gm)].map(
    (match) => match[1] ?? "",
  );
  return { due: dates.length === 0 ? null : (dates.sort()[0] ?? null) };
};

const derivedFields = createDerivedFieldsRegistry([
  {
    dir: "todos",
    types: [{ type: "todo", derivedStatus: true, derivedDue: true }],
    deriveStatus,
    deriveDue,
  },
]);

let ws: WriteWorkspace;

const openWorkspace = (options: { plugins?: boolean } = {}): WriteWorkspace => {
  ws = createWriteWorkspace("derived", {
    sprint: "s040",
    ...(options.plugins === false ? {} : { derivedFields }),
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

const storedDue = (path: string): string | undefined => /^due: (.+)$/m.exec(ws.read(path))?.[1];

const rowStatus = (id: string): string | undefined =>
  (
    ws.db.prepare("SELECT status FROM documents WHERE id = ?").get(id) as
      { status: string } | undefined
  )?.status;

const rowDue = (id: string): string | null | undefined =>
  (
    ws.db.prepare("SELECT due FROM documents WHERE id = ?").get(id) as
      { due: string | null } | undefined
  )?.due;

const pathOf = (id: string): string =>
  (ws.db.prepare("SELECT path FROM documents WHERE id = ?").get(id) as { path: string }).path;

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
    const archivedPath = pathOf(todo.id);

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

describe("a derived due date converges into the file too (PLUGINS-018, SERVER-134)", () => {
  const DATED =
    "- [ ] call the dentist (due: 2026-07-09)\n- [ ] renew the passport (due: 2026-09-30)\n";

  it("writes the earliest open item's date into the frontmatter a create lands", async () => {
    openWorkspace();
    const todo = await seedTodo(DATED);

    expect(storedDue(todo.path)).toBe("2026-07-09");
    expect(rowDue(todo.id)).toBe("2026-07-09");
    // The reporter's own case, from the row the three queries read.
    expect(ws.log("%s").filter((subject) => subject.includes(todo.id))).toHaveLength(1);
  });

  it("moves the date to the next item when the earliest is checked, in one commit", async () => {
    openWorkspace();
    const todo = await seedTodo(DATED);
    ws.advance(60_000);
    const before = commitCount();

    const response = await putDoc(ws, todo.id, {
      body: "- [x] call the dentist (due: 2026-07-09)\n- [ ] renew the passport (due: 2026-09-30)\n",
    });
    expect(response.status).toBe(200);

    expect(storedDue(todo.path)).toBe("2026-09-30");
    expect(rowDue(todo.id)).toBe("2026-09-30");
    expect(commitCount()).toBe(before + 1);
  });

  it("clears the date when the last dated item is checked, in the row and in the file", async () => {
    openWorkspace();
    const todo = await seedTodo(DATED);
    ws.advance(60_000);

    await putDoc(ws, todo.id, {
      body: "- [x] call the dentist (due: 2026-07-09)\n- [x] renew the passport (due: 2026-09-30)\n",
    });

    // Core's own empty spelling, not a removed key and never the string "null".
    expect(storedDue(todo.path)).toBe("null");
    expect(rowDue(todo.id)).toBeNull();
    // …and the same write carried the status, which is the point of one patch.
    expect(storedStatus(todo.path)).toBe("resolved");
  });

  it("resolves the list and clears its deadline in ONE commit and one `updated`", async () => {
    openWorkspace();
    const todo = await seedTodo("- [ ] call the dentist (due: 2026-07-09)\n");
    ws.advance(60_000);
    const before = commitCount();

    await putDoc(ws, todo.id, { body: "- [x] call the dentist (due: 2026-07-09)\n" });

    expect(storedStatus(todo.path)).toBe("resolved");
    expect(storedDue(todo.path)).toBe("null");
    expect(commitCount()).toBe(before + 1);
    expect(ws.read(todo.path).match(/^updated: /gm) ?? []).toHaveLength(1);
  });

  it("leaves an undated list with no deadline — never today's date", async () => {
    openWorkspace();
    const todo = await seedTodo("- [ ] buy milk\n- [ ] water the plants\n");

    expect(storedDue(todo.path)).toBe("null");
    expect(rowDue(todo.id)).toBeNull();
  });

  it("keeps an archived list's stored deadline, and returns to the items on unarchive", async () => {
    openWorkspace();
    const todo = await seedTodo(DATED);
    ws.advance(60_000);
    expect((await ws.post(`/api/docs/${todo.id}/archive`, {})).status).toBe(200);
    expect(storedDue(pathOf(todo.id))).toBe("2026-07-09");

    // Checking every item on an archived list disturbs neither field.
    ws.advance(60_000);
    await putDoc(ws, todo.id, {
      body: "- [x] call the dentist (due: 2026-07-09)\n- [x] renew the passport (due: 2026-09-30)\n",
    });
    expect(storedDue(pathOf(todo.id))).toBe("2026-07-09");
    expect(rowDue(todo.id)).toBe("2026-07-09");

    ws.advance(60_000);
    expect((await ws.post(`/api/docs/${todo.id}/unarchive`, {})).status).toBe(200);
    // Every item is checked now, so the items say there is no deadline.
    expect(storedDue(pathOf(todo.id))).toBe("null");
    expect(rowDue(todo.id)).toBeNull();
  });

  it("refuses to be set by hand: a `due` a PUT carries is the items' to answer", async () => {
    // PLUGINS-018 decision 3 — the derived value wins, and "hand-written wins"
    // is not implementable for a shadow field. A person puts a deadline on an
    // item, which is what §12's model already asks of them. What changed with
    // PR #55's review is only *how* the caller is told: this used to answer 200
    // and quietly overwrite them.
    openWorkspace();
    const todo = await seedTodo(DATED);
    ws.advance(60_000);

    const response = await putDoc(ws, todo.id, { due: "2030-01-01" });
    expect(response.status).toBe(400);
    expect(storedDue(todo.path)).toBe("2026-07-09");
    expect(rowDue(todo.id)).toBe("2026-07-09");
  });

  it("leaves the stored date alone for a type no plugin declares", async () => {
    openWorkspace();
    const note = await seedTodo("- [ ] one (due: 2026-07-09)\n", "note");
    ws.advance(60_000);
    await putDoc(ws, note.id, { due: "2030-01-01" });

    expect(storedDue(note.path)).toBe("2030-01-01");
    expect(rowDue(note.id)).toBe("2030-01-01");
  });

  it("leaves every deadline alone when the plugin is gone (§15 M6)", async () => {
    openWorkspace({ plugins: false });
    const todo = await seedTodo(DATED);

    expect(storedDue(todo.path)).toBe("null");
    expect(rowDue(todo.id)).toBeNull();

    ws.advance(60_000);
    await putDoc(ws, todo.id, { due: "2030-01-01" });
    expect(storedDue(todo.path)).toBe("2030-01-01");
    expect(rowDue(todo.id)).toBe("2030-01-01");
  });

  it("reads the derived deadline off the row, not off a stale shadow in the file", async () => {
    // The single-document read is the one surface a person is looking at the
    // document through. `GET /api/docs/{id}` used to take `due` from the file's
    // frontmatter while `status` came from the row, so between an out-of-band
    // edit and the next server write the reader and the board disagreed about
    // one document's deadline. Both come from the row now (SERVER-134).
    openWorkspace();
    const todo = await seedTodo(DATED);
    ws.write(todo.path, ws.read(todo.path).replace(/^due: .*$/m, "due: 2033-03-03"));
    ws.reproject();

    expect(storedDue(todo.path)).toBe("2033-03-03");
    const response = await ws.request(`/api/docs/${todo.id}`);
    const payload = (await response.json()) as { frontmatter: { due: string | null } };
    expect(payload.frontmatter.due).toBe("2026-07-09");
    expect(rowDue(todo.id)).toBe("2026-07-09");
  });

  it("finds the reporter's document through `?due=overdue`, `?needs=due` and `?needs=me`", async () => {
    openWorkspace();
    const overdue = await seedTodo(DATED);
    const undated = await seedTodo("- [ ] buy milk\n");

    const listed = async (query: string): Promise<string[]> => {
      const response = await ws.request(`/api/docs?${query}`);
      const payload = (await response.json()) as { items: { id: string }[] };
      return payload.items.map((row) => row.id);
    };

    // The fixture clock is well past 2026-07-09, so the earliest open item is
    // late — which is the only thing the reporter's case turns on.
    for (const query of ["due=overdue", "needs=due", "needs=me"]) {
      expect(await listed(query), query).toContain(overdue.id);
      expect(await listed(query), query).not.toContain(undated.id);
    }
    // An undated list is not due today either.
    expect(await listed("due=today")).not.toContain(undated.id);
  });
});

// PR #55 review, MINOR. A `PUT` naming a derived field used to answer 200 while
// `convergeDerivedFields` put the derived value back before the bytes landed —
// so the caller was told it had succeeded, the only thing in the commit was the
// `updated` stamp, and §5's staleness clock reset for a request nothing acted
// on. The refusal is `assertNotUnarchivingByPut`'s sibling, and everything here
// turns on one question: can it tell *asking to change the field* from *echoing
// it back*, which is what the board does on every save.
describe("a save may not set a field §12 makes the document's own (PR #55)", () => {
  const DATED = "- [ ] call the dentist (due: 2026-07-09)\n";

  const issuePaths = async (response: Response): Promise<string[]> => {
    const payload = (await response.json()) as { issues?: { path: string }[] };
    return (payload.issues ?? []).map((issue) => issue.path);
  };

  it("refuses a `status` the items answer for, and writes nothing at all", async () => {
    openWorkspace();
    const todo = await seedTodo();
    ws.advance(60_000);
    const bytes = ws.read(todo.path);
    const before = commitCount();

    const response = await putDoc(ws, todo.id, { status: "resolved" });

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["body.status"]);
    // Byte-for-byte: not even the `updated` stamp moved, which is the half of
    // this defect that fed the Attention view.
    expect(ws.read(todo.path)).toBe(bytes);
    expect(commitCount()).toBe(before);
    expect(rowStatus(todo.id)).toBe("open");
  });

  it("refuses a `due` the items answer for, and writes nothing at all", async () => {
    openWorkspace();
    const todo = await seedTodo(DATED);
    ws.advance(60_000);
    const bytes = ws.read(todo.path);
    const before = commitCount();

    const response = await putDoc(ws, todo.id, { due: "2030-01-01" });

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["body.due"]);
    expect(ws.read(todo.path)).toBe(bytes);
    expect(commitCount()).toBe(before);
  });

  it("refuses a `due: null` that would clear a deadline the items still carry", async () => {
    // The clearing spelling, which is a different value from every date and had
    // to be compared as one: `due` is a §5 canonical-block field whose `null` is
    // written rather than removed, so the guard asks the convergence about a
    // `null` exactly as it asks about a date.
    openWorkspace();
    const todo = await seedTodo(DATED);
    ws.advance(60_000);
    const bytes = ws.read(todo.path);

    const response = await putDoc(ws, todo.id, { due: null });

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["body.due"]);
    expect(ws.read(todo.path)).toBe(bytes);
  });

  it("lets a `due: null` through once the items carry no deadline", async () => {
    openWorkspace();
    const todo = await seedTodo("- [ ] buy milk\n");
    ws.advance(60_000);
    expect(storedDue(todo.path)).toBe("null");

    // Nothing to overwrite, so nothing to refuse — and nothing to write either.
    const before = commitCount();
    const response = await putDoc(ws, todo.id, { due: null });

    expect(response.status).toBe(200);
    expect(commitCount()).toBe(before);
  });

  it("names both fields when a patch sets both", async () => {
    openWorkspace();
    const todo = await seedTodo(DATED);
    ws.advance(60_000);

    const response = await putDoc(ws, todo.id, { status: "resolved", due: "2030-01-01" });

    expect(response.status).toBe(400);
    expect(await issuePaths(response)).toEqual(["body.status", "body.due"]);
  });

  it("refuses nothing a title edit carries alongside an unchanged status", async () => {
    // The board publishes whole documents, so this is the common save. It never
    // reaches the guard — `changedFields` drops a value equal to the file's,
    // and every server write has already converged the file.
    openWorkspace();
    const todo = await seedTodo();
    ws.advance(60_000);

    const response = await putDoc(ws, todo.id, {
      title: "Errands and more",
      status: "open",
      due: null,
    });

    expect(response.status).toBe(200);
    expect(/^title: (.+)$/m.exec(ws.read(todo.path))?.[1]).toBe("Errands and more");
  });

  it("lets an echo through when the file is stale, and heals the file with it", async () => {
    // The one case where a value the reader was shown is *not* the stored one:
    // an out-of-band edit moved the items and no server write has converged the
    // file since. The caller sends what it was shown, the convergence agrees
    // with it, and nothing it asked for is being ignored — so the save stands.
    openWorkspace();
    const todo = await seedTodo();
    ws.write(todo.path, ws.read(todo.path).replace("- [ ] renew", "- [x] renew"));
    ws.reproject();
    expect(storedStatus(todo.path)).toBe("open");
    expect(rowStatus(todo.id)).toBe("resolved");

    ws.advance(60_000);
    const response = await putDoc(ws, todo.id, { status: "resolved" });

    expect(response.status).toBe(200);
    expect(storedStatus(todo.path)).toBe("resolved");
    expect(rowStatus(todo.id)).toBe("resolved");
  });

  it("still lets a PUT archive a derived document (SERVER-039)", async () => {
    // §12's own carve-out: archiving says where a document is kept, which no
    // reading of its items can imply. Handed a stored `archived` every
    // derivation declines, so the requested value stands and the guard is silent.
    openWorkspace();
    const todo = await seedTodo();
    ws.advance(60_000);

    const response = await putDoc(ws, todo.id, { status: "archived" });

    expect(response.status).toBe(200);
    expect(storedStatus(todo.path)).toBe("archived");
    expect(rowStatus(todo.id)).toBe("archived");
  });

  it("lets a `due` through on an archived list, where the derivation declines", async () => {
    openWorkspace();
    const todo = await seedTodo(DATED);
    ws.advance(60_000);
    expect((await ws.post(`/api/docs/${todo.id}/archive`, {})).status).toBe(200);

    ws.advance(60_000);
    const response = await putDoc(ws, todo.id, { due: "2030-01-01" });

    expect(response.status).toBe(200);
    expect(storedDue(pathOf(todo.id))).toBe("2030-01-01");
  });

  it("refuses nothing on a type no plugin declares", async () => {
    openWorkspace();
    const note = await seedTodo(DATED, "note");
    ws.advance(60_000);

    const response = await putDoc(ws, note.id, { status: "resolved", due: "2030-01-01" });

    expect(response.status).toBe(200);
    expect(storedStatus(note.path)).toBe("resolved");
    expect(storedDue(note.path)).toBe("2030-01-01");
  });

  it("refuses nothing when the plugin is gone (§15 M6)", async () => {
    openWorkspace({ plugins: false });
    const todo = await seedTodo(DATED);
    ws.advance(60_000);

    const response = await putDoc(ws, todo.id, { status: "resolved", due: "2030-01-01" });

    expect(response.status).toBe(200);
    expect(storedStatus(todo.path)).toBe("resolved");
    expect(storedDue(todo.path)).toBe("2030-01-01");
  });
});
