// SPEC.md §10, rider 2 — "reordering boards writes `order` on every board, **in
// one commit**" — asserted against a real workspace, a real git repository and
// the real Hono app.
//
// **The claim is about git, so the assertions read git.** A test that counted
// requests would pass for the implementation this route replaced: four `PUT`s
// are one gesture on the wire's own terms and four commits in the history, and
// the history is what the rider is about. So every case here counts commits with
// `git log`, names the files in the one commit with `git show --name-only`, and
// reads the `order` back off the file on disk.

import { chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "@corpus/contract";
import { AUTH, createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

const asAgent: Record<string, string> = { [ACTOR_HEADER]: "agent" };

/** Comfortably past §4's 30 s idle window, so a preceding window has gone quiet. */
const QUIET = 60_000;

beforeEach(() => {
  ws = createWriteWorkspace("board-order", { sprint: "s079" });
});

afterEach(() => {
  ws.close();
});

const commitCount = (): number => ws.log("%H").length;
const subjectOf = (rev: string): string => ws.git("log", "-1", "--format=%s", rev).trim();
const authorOf = (rev: string): string => ws.git("log", "-1", "--format=%an", rev).trim();

/** The files one commit contains, from git itself, sorted. */
const filesIn = (rev: string): string[] =>
  ws
    .git("show", "--name-only", "--no-renames", "--format=", rev)
    .split("\n")
    .filter((line) => line !== "")
    .sort();

/** A `type: board` document at a position, settled into its own commit. */
async function board(title: string, order: number): Promise<{ id: string; path: string }> {
  const doc = await createDoc(ws, { type: "board", title, folder: "boards", order, columns: [] });
  return { id: doc.id, path: doc.path };
}

/** The `order` the file on disk carries, which is the only answer that counts. */
function orderOnDisk(path: string): number | null {
  const line = /^order:\s*(.+)$/m.exec(ws.read(path));
  return line === null ? null : Number(line[1]);
}

const reorder = (ids: readonly string[], headers: Record<string, string> = {}) =>
  ws.post("/api/boards/order", { boards: [...ids] }, headers);

/** Three boards on a settled bar, and the commit count once they are all in. */
async function bar(): Promise<{
  readonly ids: readonly string[];
  readonly paths: readonly string[];
  readonly before: number;
}> {
  const one = await board("Attention", 1);
  const two = await board("Notes", 2);
  const three = await board("Files", 3);
  // Creation is an editing session of its own; let it go quiet so the commit
  // counted below is the reorder's and nothing else.
  ws.advance(QUIET);
  return {
    ids: [one.id, two.id, three.id],
    paths: [one.path, two.path, three.path],
    before: commitCount(),
  };
}

describe("a reorder is one commit (SPEC.md §10, rider 2)", () => {
  it("writes every board that moved, in exactly one commit naming them", async () => {
    const { ids, paths, before } = await bar();

    // Files dragged to the front: all three boards change position.
    const response = await reorder([ids[2] ?? "", ids[0] ?? "", ids[1] ?? ""]);
    expect(response.status).toBe(200);

    // **One** commit, whatever number of boards moved. This is the assertion the
    // per-document loop could not pass: it produced three.
    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toBe("board reorder: 3 boards by user");
    expect(authorOf("HEAD")).toBe("user");
    expect(filesIn("HEAD")).toEqual([...paths].sort());

    // And the order the bar asked for is the order on disk.
    expect(orderOnDisk(paths[2] ?? "")).toBe(1);
    expect(orderOnDisk(paths[0] ?? "")).toBe(2);
    expect(orderOnDisk(paths[1] ?? "")).toBe(3);
  });

  it("reports that one commit, and the position every board now carries", async () => {
    const { ids, before } = await bar();

    const response = await reorder([ids[1] ?? "", ids[0] ?? "", ids[2] ?? ""]);
    const result = (await response.json()) as {
      boards: { id: string; order: number; changed: boolean }[];
      commit: string | null;
      warnings: unknown[];
    };

    expect(result.boards).toEqual([
      { id: ids[1], order: 1, changed: true },
      { id: ids[0], order: 2, changed: true },
      // Third before, third after: nothing to write, and nothing about it in the
      // commit.
      { id: ids[2], order: 3, changed: false },
    ]);
    expect(result.commit).toBe(ws.head());
    expect(commitCount()).toBe(before + 1);
    expect(result.warnings).toEqual([]);
  });

  /**
   * §4: "the commit contains exactly the documents the action **changed**". A
   * board that keeps its number contributes nothing, so `git show` must not list
   * it — a `PUT` that changed nothing would still have stamped `updated` and put
   * a line in the log the agent reads.
   */
  it("leaves a board already at its number out of the commit entirely", async () => {
    const { ids, paths, before } = await bar();

    // The last two swap; the first stays exactly where it is.
    const response = await reorder([ids[0] ?? "", ids[2] ?? "", ids[1] ?? ""]);
    expect(response.status).toBe(200);

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toBe("board reorder: 2 boards by user");
    expect(filesIn("HEAD")).toEqual([paths[1], paths[2]].sort());
    expect(ws.read(paths[0] ?? "")).toContain("order: 1");
  });

  it("commits nothing at all when the bar is dragged back where it started", async () => {
    const { ids, before } = await bar();

    const response = await reorder(ids);
    expect(response.status).toBe(200);
    const result = (await response.json()) as { commit: string | null; boards: unknown[] };

    expect(result.commit).toBeNull();
    expect(result.boards).toHaveLength(3);
    expect(commitCount()).toBe(before);
  });

  /**
   * §4's "two acts commit alone", which this joins for the reason a bulk Save
   * does. The window is what a *party's editing session* folds into; an act over
   * a set is not a save, so it must neither join an open window nor be joined by
   * a later one — otherwise reverting "the reorder" takes somebody's prose with
   * it.
   */
  it("folds in neither direction: not into an open window, and not joined by a later save", async () => {
    const { ids, paths, before } = await bar();

    // An open editing session on one of the boards, by the same party.
    const edit = await ws.put(`/api/docs/${ids[0] ?? ""}`, { title: "Attention, renamed" });
    expect(edit.status).toBe(200);
    expect(commitCount()).toBe(before + 1);

    const response = await reorder([ids[2] ?? "", ids[1] ?? "", ids[0] ?? ""]);
    expect(response.status).toBe(200);

    // The session's commit stands, and the reorder is its own entry beside it.
    // Two boards, not three: the middle one is second before and after, so it
    // is not written and is not in the commit.
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD")).toBe("board reorder: 2 boards by user");
    expect(filesIn("HEAD")).toEqual([paths[0], paths[2]].sort());

    // And nothing later folds into it.
    const after = await ws.put(`/api/docs/${ids[1] ?? ""}`, { title: "Notes, renamed" });
    expect(after.status).toBe(200);
    expect(commitCount()).toBe(before + 3);
    expect(subjectOf("HEAD^")).toBe("board reorder: 2 boards by user");
  });

  it("is authored by the acting party, like every other write", async () => {
    const { ids } = await bar();

    const response = await reorder([ids[1] ?? "", ids[2] ?? "", ids[0] ?? ""], asAgent);
    expect(response.status).toBe(200);
    expect(authorOf("HEAD")).toBe("agent");
    expect(subjectOf("HEAD")).toBe("board reorder: 3 boards by agent");
  });
});

describe("a reorder never half-applies", () => {
  /**
   * The failure the per-document loop could not rule out: a sequence that dies
   * partway leaves some boards renumbered and some not, and git holds the half.
   * Here the refusal happens before any write, so the workspace is byte-for-byte
   * what it was.
   */
  it("refuses the whole reorder when an id names no document, writing nothing", async () => {
    const { ids, paths, before } = await bar();
    const bytes = paths.map((path) => ws.read(path));

    const response = await reorder([ids[2] ?? "", "doc_gone", ids[0] ?? "", ids[1] ?? ""]);
    expect(response.status).toBe(404);

    expect(commitCount()).toBe(before);
    expect(paths.map((path) => ws.read(path))).toEqual(bytes);
  });

  /**
   * Rider 2: a view document "has no `pinned` and no `order`". A route that
   * wrote a bar position onto one would be the general write path this route
   * exists not to be, so a non-board id refuses the whole request — and the
   * boards named beside it are untouched.
   */
  it("refuses a document that is not a board, naming it, and writes nothing", async () => {
    const { ids, paths } = await bar();
    const view = await createDoc(ws, { type: "view", title: "Unresolved", folder: "views" });
    const bytes = paths.map((path) => ws.read(path));
    // After the view's own create commit, so the count below is the reorder's.
    ws.advance(QUIET);
    const before = commitCount();

    const response = await reorder([view.id, ids[0] ?? "", ids[1] ?? "", ids[2] ?? ""]);
    expect(response.status).toBe(400);
    const error = (await response.json()) as { code: string; message: string };
    expect(error.code).toBe("bad_request");
    expect(error.message).toContain(view.id);
    expect(error.message).toContain("not a board");

    expect(commitCount()).toBe(before);
    expect(paths.map((path) => ws.read(path))).toEqual(bytes);
    expect(orderOnDisk(view.path)).toBeNull();
  });

  /**
   * The other half of "never half-applies", and the one a pre-flight check
   * cannot deliver: the first board's file is already written when the second
   * one's write fails. `applyOperations` takes the whole reorder as **one
   * group**, so the group unwinds and the bar is exactly as it was — which is
   * the state a loop of `PUT`s could not reach, because each of its writes had
   * already committed.
   */
  it("rolls the whole group back when a write fails partway, leaving no half order", async () => {
    const first = await board("Attention", 1);
    const second = await createDoc(ws, {
      type: "board",
      title: "Locked",
      folder: "locked",
      order: 2,
      columns: [],
    });
    ws.advance(QUIET);
    const before = commitCount();
    const bytes = [ws.read(first.path), ws.read(second.path)];

    // The second board's directory refuses new files, so its write throws after
    // the first board's has landed.
    const locked = dirname(join(ws.root, second.path));
    chmodSync(locked, 0o500);
    try {
      const response = await reorder([second.id, first.id]);
      expect(response.status).toBe(500);
    } finally {
      chmodSync(locked, 0o700);
    }

    expect([ws.read(first.path), ws.read(second.path)]).toEqual(bytes);
    expect(orderOnDisk(first.path)).toBe(1);
    expect(orderOnDisk(second.path)).toBe(2);
    expect(commitCount()).toBe(before);
  });

  it("refuses a bar naming one board twice, before anything is written", async () => {
    const { ids, paths, before } = await bar();
    const bytes = paths.map((path) => ws.read(path));

    const response = await reorder([ids[2] ?? "", ids[0] ?? "", ids[2] ?? ""]);
    expect(response.status).toBe(400);

    expect(commitCount()).toBe(before);
    expect(paths.map((path) => ws.read(path))).toEqual(bytes);
  });

  it("refuses a bar with no boards on it", async () => {
    const { before } = await bar();
    const response = await ws.post("/api/boards/order", { boards: [] });
    expect(response.status).toBe(400);
    expect(commitCount()).toBe(before);
  });

  it("refuses an unknown key in the body (CONTRACT-017)", async () => {
    const { ids } = await bar();
    const response = await ws.post("/api/boards/order", { boards: ids, order: [1, 2, 3] });
    expect(response.status).toBe(400);
  });

  it("refuses a caller with no token", async () => {
    const { ids } = await bar();
    const response = await ws.server.app.request("/api/boards/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boards: ids }),
    });
    expect(response.status).toBe(401);
  });
});

describe("what a reorder leaves alone", () => {
  /**
   * The request states **the bar**, which on a browser excludes archived boards.
   * Renumbering the whole corpus instead would rewrite documents nobody dragged
   * and put them in a commit the caller never asked for.
   */
  it("does not touch a board the request did not name", async () => {
    const { ids, paths } = await bar();
    const hidden = await board("Archived", 9);
    ws.advance(QUIET);
    const before = commitCount();

    const response = await reorder([ids[2] ?? "", ids[1] ?? "", ids[0] ?? ""]);
    expect(response.status).toBe(200);

    expect(commitCount()).toBe(before + 1);
    expect(filesIn("HEAD")).toEqual([paths[0], paths[2]].sort());
    expect(orderOnDisk(hidden.path)).toBe(9);
  });

  /** The reorder writes `order` and nothing else — the rest of the file is bytes. */
  it("changes one line of a board document and leaves the rest byte for byte", async () => {
    const { ids, paths } = await bar();
    const untouched = ws
      .read(paths[0] ?? "")
      .split("\n")
      .filter((line) => !line.startsWith("order:") && !line.startsWith("updated:"));

    const response = await reorder([ids[1] ?? "", ids[0] ?? "", ids[2] ?? ""]);
    expect(response.status).toBe(200);

    expect(
      ws
        .read(paths[0] ?? "")
        .split("\n")
        .filter((line) => !line.startsWith("order:") && !line.startsWith("updated:")),
    ).toEqual(untouched);
    expect(orderOnDisk(paths[0] ?? "")).toBe(2);
  });

  /** A bar of one is a legal reorder, and one that has nothing to do. */
  it("takes a bar of one board", async () => {
    const only = await board("Only", 1);
    ws.advance(QUIET);
    const before = commitCount();

    const response = await reorder([only.id]);
    expect(response.status).toBe(200);
    const result = (await response.json()) as { commit: string | null };
    expect(result.commit).toBeNull();
    expect(commitCount()).toBe(before);
  });

  /**
   * A bar whose boards share a number, which a hand-edited file can be in: the
   * reorder is what resolves it, and it resolves it in one commit like any
   * other.
   */
  it("resolves a bar whose boards all carry the same number", async () => {
    const one = await board("A", 1);
    const two = await board("B", 1);
    const three = await board("C", 1);
    ws.advance(QUIET);
    const before = commitCount();

    const response = await reorder([one.id, two.id, three.id]);
    expect(response.status).toBe(200);

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toBe("board reorder: 2 boards by user");
    expect(orderOnDisk(one.path)).toBe(1);
    expect(orderOnDisk(two.path)).toBe(2);
    expect(orderOnDisk(three.path)).toBe(3);
  });

  /** The collection read agrees with the write, which is what the bar renders from. */
  it("is visible to `GET /api/docs?type=board&sort=order` immediately", async () => {
    const { ids } = await bar();

    expect((await reorder([ids[2] ?? "", ids[1] ?? "", ids[0] ?? ""])).status).toBe(200);

    const listed = await ws.request("/api/docs?type=board&sort=order", { headers: AUTH });
    const payload = (await listed.json()) as { items: { id: string; order: number }[] };
    expect(payload.items.map((item) => item.id)).toEqual([ids[2], ids[1], ids[0]]);
    expect(payload.items.map((item) => item.order)).toEqual([1, 2, 3]);
  });
});
