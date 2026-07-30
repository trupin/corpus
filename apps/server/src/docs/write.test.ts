// The pipeline's own invariants: ordering, atomicity, containment, the lock
// seam, self-write registration, and what a hook failure does and does not do.

import { chmodSync, existsSync, readdirSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { QueryKey } from "@corpus/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";
import { createAutoCommitter, createGit } from "../git/index.js";
import { silentLogger } from "../logger.js";
import { classifyPath } from "../projection/index.js";
import { createSelfWriteRegistry, type SelfWriteRegistry } from "../watcher/index.js";
import { setArchived } from "./archive.js";
import { createDocument } from "./create.js";
import { deleteDocument } from "./delete.js";
import { moveDocument } from "./move.js";
import { updateDocument } from "./update.js";
import {
  allowAllWrites,
  assertContained,
  createDocumentMutex,
  resolveFolder,
  validateBeforeWrite,
  validationError,
  warningDetail,
  writeFileAtomically,
  type DocsWorkspace,
  type WriteGuard,
} from "./write.js";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

function workspaceFor(
  fixture: WriteWorkspace,
  overrides: { guard?: WriteGuard; selfWrites?: SelfWriteRegistry } = {},
): DocsWorkspace {
  return {
    workspaceRoot: fixture.root,
    projection: fixture.db,
    git: createAutoCommitter({
      git: createGit(fixture.root),
      now: () => fixture.clock,
    }),
    selfWrites: overrides.selfWrites ?? fixture.server.selfWrites,
    bus: fixture.server.bus,
    logger: silentLogger,
    now: () => fixture.clock,
    assertWritable: overrides.guard ?? allowAllWrites,
  };
}

describe("writeFileAtomically", () => {
  it("leaves no temp file behind, and none a document walk would see", () => {
    ws = createWriteWorkspace("atomic");
    const target = join(ws.root, "data", "docs", "inbox", "atomic.md");

    writeFileAtomically(target, "---\nid: doc_atomic01\n---\n\nbody\n");
    expect(ws.read("data/docs/inbox/atomic.md")).toContain("body");

    const entries = readdirSync(join(ws.root, "data", "docs", "inbox"));
    expect(entries.filter((entry) => entry.includes("tmp"))).toEqual([]);
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("creates missing directories and overwrites in place", () => {
    ws = createWriteWorkspace("atomic-nested");
    const target = join(ws.root, "data", "docs", "deep", "nested", "file.md");

    writeFileAtomically(target, "first");
    writeFileAtomically(target, "second");
    expect(ws.read("data/docs/deep/nested/file.md")).toBe("second");
  });
});

describe("the mutation pipeline", () => {
  it("registers every self-write before the bytes reach the filesystem", async () => {
    ws = createWriteWorkspace("self-writes");
    ws.reproject();
    const recorded: { path: string; existedAtRecordTime: boolean }[] = [];
    const real = createSelfWriteRegistry();
    const spy: SelfWriteRegistry = {
      get size() {
        return real.size;
      },
      record(path, content) {
        recorded.push({ path, existedAtRecordTime: existsSync(path) });
        real.record(path, content);
      },
      claim: (path, content) => real.claim(path, content),
    };

    const workspace = workspaceFor(ws, { selfWrites: spy });
    const mutex = createDocumentMutex();
    const created = await createDocument(workspace, mutex, "user", {
      type: "note",
      title: "Registered",
    });

    const entry = recorded.find((item) => item.path.endsWith("registered.md"));
    expect(entry).toBeDefined();
    // Registration ran while the target still did not exist: the watcher can
    // see a write the instant it lands, and losing that race surfaces as a
    // spurious out-of-band reconciliation.
    expect(entry?.existedAtRecordTime).toBe(false);
    // And the registered digest is the digest of what actually landed, so the
    // watcher's content-matched claim succeeds.
    const abs = join(ws.root, created.doc.path);
    expect(spy.claim(abs, Buffer.from(ws.read(created.doc.path)))).toBe(true);
  });

  it("registers a removal for a delete and both sides of a move", async () => {
    ws = createWriteWorkspace("self-writes-move");
    ws.reproject();
    const workspace = workspaceFor(ws);
    const mutex = createDocumentMutex();

    const created = await createDocument(workspace, mutex, "user", {
      type: "note",
      title: "Travelling",
    });
    const moved = await moveDocument(
      workspace,
      mutex,
      "user",
      created.doc.frontmatter.id,
      "finance",
    );
    expect(workspace.selfWrites.claim(join(ws.root, created.doc.path), null)).toBe(true);
    expect(
      workspace.selfWrites.claim(
        join(ws.root, moved.doc.path),
        Buffer.from(ws.read(moved.doc.path)),
      ),
    ).toBe(true);

    await deleteDocument(workspace, mutex, "user", created.doc.frontmatter.id);
    expect(workspace.selfWrites.claim(join(ws.root, moved.doc.path), null)).toBe(true);
  });

  it("broadcasts keys only, and only after the projection is current", async () => {
    ws = createWriteWorkspace("invalidations");
    ws.reproject();
    const frames: QueryKey[][] = [];
    const rowsAtFrame: number[] = [];
    const off = ws.server.bus.subscribe((keys) => {
      frames.push(keys as QueryKey[]);
      const counted = ws.db.prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number };
      rowsAtFrame.push(counted.n);
    });

    const created = await createDoc(ws, { type: "note", title: "Announced" });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual([["docs"], ["docs", created.id], ["tree"]]);
    // The row already existed when the frame went out, so a client refetching
    // on the frame cannot read a stale collection.
    expect(rowsAtFrame[0]).toBe(1);

    ws.advance(60_000);
    await ws.put(`/api/docs/${created.id}`, { body: "edited" });
    expect(frames[1]).toEqual([["docs"], ["docs", created.id]]);

    ws.advance(60_000);
    await ws.post(`/api/docs/${created.id}/archive`, {});
    // Archived documents are counted in no folder, so archiving moves the badge
    // the tree draws — the same claim creation and deletion make (SERVER-018).
    expect(frames[2]).toEqual([["docs"], ["docs", created.id], ["tree"]]);

    ws.advance(60_000);
    await ws.post(`/api/docs/${created.id}/unarchive`, {});
    expect(frames[3]).toEqual([["docs"], ["docs", created.id], ["tree"]]);

    // Live again, so the move carries its count from one folder to another. An
    // archived document's move announces nothing, because it was counted in
    // neither folder — `tree-key.test.ts` holds that case and the rest of the
    // invariant.
    ws.advance(60_000);
    await ws.post(`/api/docs/${created.id}/move`, { folder: "finance" });
    expect(frames[4]).toEqual([["docs"], ["docs", created.id], ["tree"]]);

    ws.advance(60_000);
    await ws.del(`/api/docs/${created.id}`);
    expect(frames[5]).toEqual([["docs"], ["docs", created.id], ["tree"]]);

    off();
    // Every payload is keys and nothing else — §2.2 rule 3.
    for (const keys of frames) {
      for (const key of keys) {
        expect(Array.isArray(key)).toBe(true);
        expect(key.every((segment) => typeof segment === "string")).toBe(true);
      }
    }
  });

  it("calls the lock guard once for every write verb, before it reads or writes", async () => {
    ws = createWriteWorkspace("guard");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Guarded" });
    const id = created.id;

    const guard = vi.fn<WriteGuard>(() => undefined);
    const workspace = workspaceFor(ws, { guard });
    const mutex = createDocumentMutex();

    await updateDocument(workspace, mutex, "user", id, { body: "one" });
    await moveDocument(workspace, mutex, "agent", id, "finance");
    await setArchived(workspace, mutex, "user", id, true);
    await setArchived(workspace, mutex, "agent", id, false);
    await deleteDocument(workspace, mutex, "user", id);

    expect(guard.mock.calls).toEqual([
      [id, "user"],
      [id, "agent"],
      [id, "user"],
      [id, "agent"],
      [id, "user"],
    ]);
  });

  it("refuses the mutation when the guard does, before anything is written", async () => {
    ws = createWriteWorkspace("guard-refuses");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Locked" });
    const before = ws.read(created.path);
    ws.advance(60_000);
    const head = ws.head();

    const workspace = workspaceFor(ws, {
      guard: () => {
        throw new Error("held by the other party");
      },
    });
    await expect(
      updateDocument(workspace, createDocumentMutex(), "user", created.id, { body: "nope" }),
    ).rejects.toThrow("held by the other party");

    expect(ws.read(created.path)).toBe(before);
    expect(ws.head()).toBe(head);
  });

  it("keeps the file, the projection and the announcement when a hook rejects the commit", async () => {
    ws = createWriteWorkspace("hook-failure");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Hooked", body: "before" });
    ws.advance(60_000);

    const hook = join(ws.root, ".git", "hooks", "pre-commit");
    mkdirSync(join(ws.root, ".git", "hooks"), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\necho 'doc check: refusing' >&2\nexit 1\n", "utf8");
    chmodSync(hook, 0o755);

    const frames: unknown[] = [];
    const off = ws.server.bus.subscribe((keys) => frames.push(keys));
    const workspace = workspaceFor(ws);
    const outcome = await updateDocument(workspace, createDocumentMutex(), "user", created.id, {
      body: "after the hook refused",
    });
    off();

    // The mutation stands: SPEC.md §14 — the server never rolls back a file
    // write because a commit failed.
    expect(ws.read(created.path)).toContain("after the hook refused");
    expect(ws.git("status", "--porcelain")).toContain(created.path);
    expect(outcome.result.warnings).toHaveLength(1);
    expect(outcome.result.warnings[0]?.code).toBe("commit_failed");
    expect(outcome.result.warnings[0]?.detail).toContain("doc check: refusing");
    // The projection and the SSE frame still happened, so the UI shows it.
    const row = ws.db
      .prepare("SELECT body_excerpt FROM documents WHERE id = ?")
      .get(created.id) as { body_excerpt: string };
    expect(row.body_excerpt).toContain("after the hook refused");
    expect(frames).toHaveLength(1);
  });

  it("stays fully usable in a workspace with no git repository", async () => {
    ws = createWriteWorkspace("no-git", { git: false });
    ws.reproject();

    const created = await createDoc(ws, { type: "note", title: "Gitless" });
    expect(ws.exists(created.path)).toBe(true);

    for (const call of [
      () => ws.put(`/api/docs/${created.id}`, { body: "edited" }),
      () => ws.post(`/api/docs/${created.id}/move`, { folder: "finance" }),
      () => ws.post(`/api/docs/${created.id}/archive`, {}),
      () => ws.post(`/api/docs/${created.id}/unarchive`, {}),
      () => ws.del(`/api/docs/${created.id}`),
    ]) {
      ws.advance(60_000);
      const response = await call();
      expect(response.status).toBe(200);
    }
    expect(ws.exists("data/docs/finance/gitless.md")).toBe(false);

    const workspace = workspaceFor(ws);
    const outcome = await createDocument(workspace, createDocumentMutex(), "user", {
      type: "note",
      title: "Still working",
    });
    expect(outcome.result.warnings).toEqual([
      { code: "commit_skipped", detail: "the workspace is not a git repository" },
    ]);
  });

  it("refuses a path that leaves the workspace through a symlink", async () => {
    ws = createWriteWorkspace("symlink");
    ws.reproject();
    symlinkSync("/tmp", join(ws.root, "data", "docs", "escape"), "dir");

    const response = await ws.post("/api/docs", {
      type: "note",
      title: "Escaping",
      folder: "escape",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; issues: { message: string }[] };
    expect(body.code).toBe("bad_request");
    expect(body.issues[0]?.message).toContain("outside the workspace");
    expect(existsSync("/tmp/escaping.md")).toBe(false);
  });
});

describe("validateBeforeWrite", () => {
  const doc = (id: string, body: string, extra: string[] = []): string =>
    [
      "---",
      `id: ${id}`,
      "type: note",
      "title: Subject",
      "created: 2026-07-01T00:00:00Z",
      "updated: 2026-07-01T00:00:00Z",
      ...extra,
      "---",
      "",
      body,
      "",
    ].join("\n");

  const validating = (name: string): WriteWorkspace => {
    ws = createWriteWorkspace(name);
    ws.reproject();
    return ws;
  };

  it("rejects a document whose frontmatter would not parse", () => {
    validating("validate-unparseable");
    expect(() =>
      validateBeforeWrite(
        { logger: silentLogger, projection: ws.db },
        "data/docs/inbox/x.md",
        "no fence at all",
      ),
    ).toThrow();
  });

  it("rejects a malformed anchor entry", () => {
    validating("validate-anchor");
    const text = doc("doc_bad00001", "body", ["anchors:", "  anc_bad00001: not-a-selector"]);
    expect(() =>
      validateBeforeWrite(
        { logger: silentLogger, projection: ws.db },
        "data/docs/inbox/x.md",
        text,
      ),
    ).toThrow();
  });

  it("accepts a sparse skill file that carries no Corpus frontmatter", () => {
    validating("validate-skill");
    expect(() =>
      validateBeforeWrite(
        { logger: silentLogger, projection: ws.db },
        ".claude/skills/demo/SKILL.md",
        "---\nname: demo\n---\n\nDo the thing.\n",
      ),
    ).not.toThrow();
  });

  it("returns no warnings for a document with nothing wrong with it", () => {
    validating("validate-clean");
    expect(
      validateBeforeWrite(
        { logger: silentLogger, projection: ws.db },
        "data/docs/inbox/x.md",
        doc("doc_clean001", "Nothing to see."),
      ),
    ).toEqual([]);
  });

  it("reports an unresolved ref, and logs it, without blocking the save", () => {
    validating("validate-ref");
    const logged: string[] = [];
    const logger = { ...silentLogger, info: (message: string) => logged.push(message) };
    const text = doc("doc_warn0001", "A [[doc_absent1]] reference to nothing.");

    const warnings = validateBeforeWrite(
      { logger, projection: ws.db },
      "data/docs/inbox/x.md",
      text,
    );

    expect(warnings).toEqual([
      { code: "unresolved_ref", detail: expect.stringContaining("doc_absent1") as string },
    ]);
    expect(logged).toContain("document saved with validation warnings");
  });

  it("judges a ref against the whole corpus, not against the one file it is handed", async () => {
    validating("validate-ref-corpus");
    const target = await createDoc(ws, { type: "note", title: "Target" });
    // Without the projection seam the checker sees a one-document corpus and
    // reports every cross-document reference — including this one, which is
    // perfectly resolvable.
    expect(
      validateBeforeWrite(
        { logger: silentLogger, projection: ws.db },
        "data/docs/inbox/x.md",
        doc("doc_refok001", `See [[${target.id}]].`),
      ),
    ).toEqual([]);
  });

  it("reports an anchor whose quote no longer resolves as an orphan", () => {
    validating("validate-orphan");
    const text = doc("doc_orph0001", "The body says something else entirely.", [
      "anchors:",
      "  anc_orph0001:",
      "    exact: a sentence that is not in the body",
      "    prefix: ''",
      "    suffix: ''",
    ]);

    expect(
      validateBeforeWrite(
        { logger: silentLogger, projection: ws.db },
        "data/docs/inbox/x.md",
        text,
      ),
    ).toEqual([
      { code: "orphaned_anchor", detail: expect.stringContaining("anc_orph0001") as string },
    ]);
  });
});

describe("warningDetail", () => {
  it("keeps the first lines and caps the length", () => {
    const output = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
    expect(warningDetail(output)).toBe("line 0\nline 1\nline 2\nline 3\nline 4");
    expect(warningDetail("x".repeat(2000)).length).toBe(600);
    expect(warningDetail("\n\n  \n")).toBe("");
  });
});

describe("resolveFolder", () => {
  it("accepts both spellings and defaults to the inbox", () => {
    expect(resolveFolder(undefined)).toBe("data/docs/inbox");
    expect(resolveFolder("finance")).toBe("data/docs/finance");
    expect(resolveFolder("data/docs/finance")).toBe("data/docs/finance");
    expect(resolveFolder("data/docs")).toBe("data/docs");
  });

  it("refuses an absolute path, a drive letter, and anything that escapes", () => {
    for (const folder of ["/etc", "C:\\Windows", "../..", "data/docs/../../.."]) {
      let thrown: unknown;
      try {
        resolveFolder(folder);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, folder).toBeInstanceOf(HttpError);
      const body = (thrown as HttpError).body;
      expect(body.code, folder).toBe("bad_request");
      expect(body.code === "bad_request" && body.issues.length, folder).toBeGreaterThan(0);
    }
  });

  // SERVER-037. Every one of these produced the same shipped bug through a
  // different door: written, auto-committed, then `404` from the read-back,
  // because `classifyPath` skips a path with a dot-prefixed segment *or* an
  // ignored-directory segment. Both halves are refused, and both name `folder`.
  it("refuses a folder the projection would skip, naming the field", () => {
    for (const folder of [
      ".claude/skills",
      ".foo",
      "notes/.hidden/x",
      "data/docs/.claude",
      "node_modules",
      "notes/node_modules/x",
    ]) {
      let thrown: unknown;
      try {
        resolveFolder(folder);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, folder).toBeInstanceOf(HttpError);
      const body = (thrown as HttpError).body;
      expect(body.code, folder).toBe("bad_request");
      expect(
        body.code === "bad_request" && body.issues.map((issue) => issue.path),
        folder,
      ).toContain("folder");
    }
  });

  it("accepts folders whose dots do not lead a segment", () => {
    for (const folder of ["my.notes", "v1.2", "notes/2026.07", "a.b/c.d", "finance/2026"]) {
      expect(resolveFolder(folder), folder).toBe(`data/docs/${folder}`);
    }
  });

  // The rule is *derived* from `classifyPath`, never copied out of it: this
  // asserts the equivalence rather than a list of names, so a name added to the
  // projection's ignore set is refused here on the same day. A second,
  // hand-maintained list is how SERVER-037 comes back.
  it("refuses exactly the folders the projection declines to index", () => {
    const segments = [
      "finance",
      "my.notes",
      "2026.07",
      ".claude",
      ".hidden",
      "node_modules",
      "node_modules.md",
    ];
    for (const segment of segments) {
      const indexed = classifyPath(`data/docs/notes/${segment}/anything.md`) !== null;
      let accepted = true;
      try {
        resolveFolder(`notes/${segment}`);
      } catch {
        accepted = false;
      }
      expect(accepted, segment).toBe(indexed);
    }
  });
});

describe("validationError", () => {
  it("always carries at least one issue, because the contract requires it", () => {
    try {
      validationError("something is wrong", []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const body = (error as HttpError).body;
      expect(body.code === "bad_request" && body.issues).toEqual([
        { path: "", message: "something is wrong" },
      ]);
    }
  });
});

describe("assertContained", () => {
  it("accepts a path whose parent directories do not exist yet", () => {
    ws = createWriteWorkspace("contained");
    expect(() => {
      assertContained(ws.root, "data/docs/not/created/yet.md");
    }).not.toThrow();
    expect(() => {
      assertContained(ws.root, ".");
    }).not.toThrow();
  });

  it("refuses a path that resolves outside the workspace", () => {
    ws = createWriteWorkspace("contained-escape");
    symlinkSync("/tmp", join(ws.root, "data", "docs", "out"), "dir");
    expect(() => {
      assertContained(ws.root, "data/docs/out/file.md");
    }).toThrow();
  });
});

describe("createDocumentMutex", () => {
  it("serializes tasks per key and survives a rejection", async () => {
    const mutex = createDocumentMutex();
    const order: string[] = [];
    const slow = mutex.run("a", async () => {
      await new Promise((done) => setTimeout(done, 20));
      order.push("first");
    });
    const failing = mutex.run("a", () => {
      order.push("second");
      return Promise.reject(new Error("boom"));
    });
    const after = mutex.run("a", () => {
      order.push("third");
      return Promise.resolve();
    });
    // A different key does not queue behind them.
    const other = mutex.run("b", () => {
      order.push("other");
      return Promise.resolve();
    });

    await expect(failing).rejects.toThrow("boom");
    await Promise.all([slow, after, other]);
    expect(order.slice(order.indexOf("first"))).toEqual(["first", "second", "third"]);
  });
});
