// SPEC.md §7 "A key, not a lock", end to end: every read hands one out, a
// body-replacing write presents one back, and a stale one is refused with the
// document rather than with a bare "no".
//
// Everything here goes through the real app against a real workspace and a real
// git repository. The refusal path is the one over-tested, because a check that
// refuses the wrong write is a bug you find, and one that lets a write through
// is a bug that eats somebody's edit: every conflict case asserts the payload,
// the **file on disk**, and `HEAD` — not merely the status code.

import { DocSchema, UpdateDocResponseSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { createAutoCommitter, createGit } from "../git/index.js";
import { silentLogger } from "../logger.js";
import { documentKey } from "./key.js";
import { updateDocument } from "./update.js";
import { createDocumentMutex, type DocsWorkspace } from "./write.js";
import {
  AUTH,
  createDoc,
  createWriteWorkspace,
  keyOnDisk,
  putDoc,
  readDocKey,
  type WriteWorkspace,
} from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const ANCHOR = "anc_key00001";
const QUOTE = "The rate is fixed for five years.";
const BODY = ["Intro paragraph.", "", QUOTE, "", "Closing paragraph."].join("\n");
const DOC_PATH = "data/docs/inbox/mortgage.md";

const ANCHORED_DOC = [
  "---",
  "id: doc_keydoc",
  "type: note",
  "title: Mortgage options",
  "created: 2026-07-01T00:00:00Z",
  "updated: 2026-07-01T00:00:00Z",
  "tags: []",
  "status: open",
  "anchors:",
  `  ${ANCHOR}:`,
  `    exact: ${JSON.stringify(QUOTE)}`,
  `    prefix: ${JSON.stringify("Intro paragraph.\n\n")}`,
  `    suffix: ${JSON.stringify("\n\nClosing paragraph.")}`,
  "due: null",
  "reviewed: null",
  "evergreen: false",
  "---",
  "",
  BODY,
  "",
].join("\n");

const THREAD_DOC = [
  "---",
  "id: th_keythrd1",
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
  "parent: doc_keydoc",
  `anchor: ${ANCHOR}`,
  "agent: none",
  "---",
  "",
  "## user · 2026-07-01T00:00:00Z",
  "",
  "Is this right?",
  "",
].join("\n");

/** A workspace holding the anchored document and its thread, both committed. */
function anchored(name: string): WriteWorkspace {
  ws = createWriteWorkspace(name);
  ws.write(DOC_PATH, ANCHORED_DOC);
  ws.write("data/threads/th_keythrd1.md", THREAD_DOC);
  ws.git("add", "-A", "--", "data");
  ws.git("commit", "-m", "seed the anchored document");
  ws.reproject();
  return ws;
}

/** A plain document with a body, committed, with the clock past §4's squash window. */
async function plain(name: string): Promise<{ id: string; path: string }> {
  ws = createWriteWorkspace(name);
  ws.reproject();
  const created = await createDoc(ws, { type: "note", title: "Plain", body: "before" });
  ws.advance(60_000);
  return { id: created.id, path: created.path };
}

const readDoc = async (id: string) => {
  const response = await ws.request(`/api/docs/${id}`, { headers: AUTH });
  expect(response.status).toBe(200);
  return DocSchema.parse(await response.json());
};

/** A syntactically valid key that names no version of anything. */
const NOT_THE_KEY = "b".repeat(64);

describe("a key on every read (SPEC.md §7)", () => {
  it("carries the key of the document's stored bytes, and the editing signal beside it", async () => {
    const { id, path } = await plain("key-read");

    const doc = await readDoc(id);
    expect(doc.key).toMatch(/^[0-9a-f]{64}$/);
    // The derivation is over the **file**, frontmatter and body together — not
    // over the body, and not over the parsed model re-serialized.
    expect(doc.key).toBe(documentKey(ws.read(path)));
    expect(doc.key).not.toBe(documentKey(doc.body));
    expect(doc.userEditing).toBe(false);
  });

  it("is the same key after a restart, because nothing was stored to lose", async () => {
    const { id, path } = await plain("key-restart");
    const before = await readDoc(id);

    // A second server over the same workspace — the closest a unit test gets to
    // a restart, and enough to prove the point: the key is a function of the
    // file, so there is no registry a new process could fail to inherit.
    const bytes = ws.read(path);
    ws.close();
    ws = createWriteWorkspace("key-restart-2");
    ws.write(path, bytes);
    ws.git("add", "-A", "--", "data");
    ws.git("commit", "-m", "seed");
    ws.reproject();

    const after = await readDoc(id);
    expect(after.key).toBe(before.key);
  });

  it("changes when — and only when — the stored bytes change", async () => {
    const { id, path } = await plain("key-changes");
    const first = (await readDoc(id)).key;

    // A read changes nothing.
    expect((await readDoc(id)).key).toBe(first);

    const saved = await putDoc(ws, id, { body: "after" });
    expect(saved.status).toBe(200);
    const second = (await readDoc(id)).key;
    expect(second).not.toBe(first);
    expect(second).toBe(documentKey(ws.read(path)));
  });
});

describe("what needs a key (SPEC.md §7)", () => {
  it("refuses a body write that presents none, exactly as it refuses a stale one", async () => {
    const { id, path } = await plain("key-missing");
    const before = ws.read(path);
    const head = ws.head();

    const response = await ws.put(`/api/docs/${id}`, { body: "an overwrite of nothing I read" });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      code: string;
      issues: { path: string; message: string }[];
    };
    expect(payload.code).toBe("bad_request");
    expect(payload.issues.some((issue) => issue.path.endsWith("key"))).toBe(true);

    // The whole point of "required means required": an optional check would have
    // let this land, and the lock is exactly the mechanism that let it.
    expect(ws.read(path)).toBe(before);
    expect(ws.head()).toBe(head);
  });

  it("refuses a keyless body write reaching the verb in process, past the contract", async () => {
    const { id, path } = await plain("key-missing-in-process");
    const before = ws.read(path);
    const head = ws.head();

    // The `400` above is the contract's refinement, which answers before any
    // handler runs. This is the same refusal from the other side: a caller that
    // never crosses the HTTP boundary — `docs/patch.ts` today, an in-process
    // verb written tomorrow — reaches
    // `updateDocumentLocked` directly, and **required means required there too**.
    // A check only the wire enforces is the lock again, one layer down.
    const workspace: DocsWorkspace = {
      workspaceRoot: ws.root,
      projection: ws.db,
      git: createAutoCommitter({ git: createGit(ws.root), now: () => ws.clock }),
      selfWrites: ws.server.selfWrites,
      bus: ws.server.bus,
      logger: silentLogger,
      now: () => ws.clock,
    };
    await expect(
      updateDocument(workspace, createDocumentMutex(), "user", id, { body: "no key at all" }),
    ).rejects.toMatchObject({
      status: 400,
      body: { issues: [{ path: "body.key" }] },
    });

    expect(ws.read(path)).toBe(before);
    expect(ws.head()).toBe(head);
  });

  it("refuses an explicitly empty body with no key — the most destructive spelling", async () => {
    const { id, path } = await plain("key-empty-body");
    const before = ws.read(path);

    const response = await ws.put(`/api/docs/${id}`, { body: "" });
    expect(response.status).toBe(400);
    expect(ws.read(path)).toBe(before);
  });

  it("takes no key for a write that names its own delta", async () => {
    const { id } = await plain("key-deltas");

    for (const patch of [
      { tags: ["finance"] },
      { status: "resolved" },
      { title: "Renamed" },
      { due: "2026-09-01" },
      { reviewed: "2026-07-27T09:05:00Z" },
      { evergreen: true },
      { extra: { width: 320 } },
    ]) {
      const response = await ws.put(`/api/docs/${id}`, patch);
      expect([patch, response.status]).toEqual([patch, 200]);
    }
  });

  it("takes no key on move, archive or unarchive", async () => {
    const { id } = await plain("key-routes");

    for (const path of [`/api/docs/${id}/archive`, `/api/docs/${id}/unarchive`]) {
      const response = await ws.post(path, {});
      expect([path, response.status]).toEqual([path, 200]);
    }
    const moved = await ws.post(`/api/docs/${id}/move`, { folder: "finance" });
    expect(moved.status).toBe(200);
  });

  it("still checks a key a delta write volunteers", async () => {
    const { id, path } = await plain("key-volunteered");
    const before = ws.read(path);
    const head = ws.head();

    // §7: presenting a key always means *I am writing against this version*, so
    // a caller that always sends back what it read needs no rule about which
    // fields are which — and gets told when its picture is out of date.
    const response = await ws.put(`/api/docs/${id}`, { tags: ["finance"], key: NOT_THE_KEY });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("stale_key");
    expect(ws.read(path)).toBe(before);
    expect(ws.head()).toBe(head);

    const fresh = await ws.put(`/api/docs/${id}`, {
      tags: ["finance"],
      key: await readDocKey(ws, id),
    });
    expect(fresh.status).toBe(200);
  });
});

describe("what a refusal says (SPEC.md §7)", () => {
  it("answers 409 with the document as it now stands, a fresh key, and nothing written", async () => {
    const { id, path } = await plain("key-stale");
    const stale = await readDocKey(ws, id);

    // Somebody else writes first. Its key is now the document's.
    const winner = await putDoc(ws, id, { body: "the version that landed" });
    expect(winner.status).toBe(200);
    const afterWinner = ws.read(path);
    const head = ws.head();

    const refused = await ws.put(`/api/docs/${id}`, {
      body: "the version that did not",
      key: stale,
    });
    expect(refused.status).toBe(409);
    const payload = (await refused.json()) as {
      code: string;
      message: string;
      doc: { body: string; key: string; frontmatter: { id: string } };
    };
    expect(payload.code).toBe("stale_key");
    // Never bare: the document as it now stands, whose own `key` is the fresh
    // one — one exchange rather than two.
    expect(payload.doc.frontmatter.id).toBe(id);
    expect(payload.doc.body).toBe("the version that landed");
    expect(payload.doc.key).toBe(keyOnDisk(ws, path));
    expect(payload.doc.key).not.toBe(stale);

    // **Nothing was written.** Both halves, because a 409 that had already
    // written would be the worst of both mechanisms.
    expect(ws.read(path)).toBe(afterWinner);
    expect(ws.head()).toBe(head);

    // And the refusal is never a lost edit: the content is the writer's to
    // resend, against the key it was just handed.
    const retried = await ws.put(`/api/docs/${id}`, {
      body: "the version that did not",
      key: payload.doc.key,
    });
    expect(retried.status).toBe(200);
    expect(parseDocument(ws.read(path)).body).toBe("the version that did not");
  });

  it("404s a document that does not exist — the key question never arises", async () => {
    ws = createWriteWorkspace("key-unknown");
    ws.reproject();

    const response = await ws.put("/api/docs/doc_zzzzzzzz", { body: "x", key: NOT_THE_KEY });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe("not_found");
  });

  it("treats a valid key on identical content as a no-op save, not a conflict", async () => {
    const { id, path } = await plain("key-noop");
    const doc = await readDoc(id);
    const head = ws.head();

    const response = await ws.put(`/api/docs/${id}`, { body: doc.body, key: doc.key });
    expect(response.status).toBe(200);
    const payload = UpdateDocResponseSchema.parse(await response.json());
    // §9.2: a save that rewrites nothing writes, commits and announces nothing —
    // and hands back the same key, because the same bytes are still stored.
    expect(payload.doc.key).toBe(doc.key);
    expect(ws.head()).toBe(head);
    expect(keyOnDisk(ws, path)).toBe(doc.key);
  });
});

describe("the key a write returns is the key of what was stored (SPEC.md §6, §7)", () => {
  it("names the reconciled document, not the bytes the caller sent", async () => {
    anchored("key-reconciled");
    const id = "doc_keydoc";
    const key = await readDocKey(ws, id);

    // An edit above the anchor: §6 reconciliation rewrites the anchor's
    // `prefix` inside the very same save, so the stored file is **not** the
    // frontmatter the caller last read with the body it sent appended.
    const body = ["A new opening paragraph.", "", BODY].join("\n");
    const response = await ws.put(`/api/docs/${id}`, { body, key });
    expect(response.status).toBe(200);
    const payload = UpdateDocResponseSchema.parse(await response.json());
    expect(payload.anchors.remapped).toEqual([ANCHOR]);

    const stored = ws.read(DOC_PATH);
    // Reconciliation really did move bytes the caller never sent: the anchor's
    // `prefix` now quotes the text ahead of the quote in the *new* body, which
    // is frontmatter no part of this request mentioned.
    const anchors = parseDocument(stored).data["anchors"] as Record<string, { prefix: string }>;
    expect(anchors[ANCHOR]?.prefix).not.toBe("Intro paragraph.\n\n");
    expect(anchors[ANCHOR]?.prefix).toContain("paragraph.\n\nIntro paragraph.\n\n");

    // The key names *that* file. Derived from anything the caller sent, it would
    // be stale the instant it was minted.
    expect(payload.doc.key).toBe(documentKey(stored));
    expect(payload.doc.key).not.toBe(key);
  });

  it("lets the writer's own next write land, so reconciliation is not a phantom conflict", async () => {
    anchored("key-reconciled-chain");
    const id = "doc_keydoc";

    let key = await readDocKey(ws, id);
    // Three consecutive body writes, each presenting only the key its own
    // predecessor answered with — never re-reading. Against a key derived from
    // the request, the second of these is refused by the first one's own anchor
    // reconciliation, which is indistinguishable from a real conflict.
    for (const opening of ["First rewrite.", "Second rewrite.", "Third rewrite."]) {
      ws.advance(60_000);
      const response = await ws.put(`/api/docs/${id}`, {
        body: [opening, "", BODY].join("\n"),
        key,
      });
      expect([opening, response.status]).toEqual([opening, 200]);
      key = UpdateDocResponseSchema.parse(await response.json()).doc.key;
    }
    expect(key).toBe(keyOnDisk(ws, DOC_PATH));
    expect(ws.read(DOC_PATH)).toContain("Third rewrite.");
  });
});

describe("what invalidates a key, and what does not (SPEC.md §7, §9.2)", () => {
  it("an out-of-band edit invalidates it, with no watcher involved", async () => {
    const { id, path } = await plain("key-out-of-band");
    const key = await readDocKey(ws, id);

    // No watcher runs in this fixture — `createServer` builds the app and
    // `lifecycle.ts` is what starts chokidar. So nothing at all has been told
    // about this write; the key goes stale because it is a function of the file.
    const parsed = parseDocument(ws.read(path));
    ws.write(path, ws.read(path).replace(parsed.body, "edited in another editor"));

    // The projection was not told either, and does not need to be.
    const refused = await ws.put(`/api/docs/${id}`, { body: "my version", key });
    expect(refused.status).toBe(409);
    const payload = (await refused.json()) as { code: string; doc: { body: string; key: string } };
    expect(payload.code).toBe("stale_key");
    expect(payload.doc.body).toContain("edited in another editor");
    expect(payload.doc.key).toBe(keyOnDisk(ws, path));
  });

  it("a move does not invalidate it: the path is not an input", async () => {
    const { id } = await plain("key-move");
    const key = await readDocKey(ws, id);

    const moved = await ws.post(`/api/docs/${id}/move`, { folder: "finance" });
    expect(moved.status).toBe(200);
    const movedPath = ((await moved.json()) as { doc: { path: string } }).doc.path;
    expect(movedPath).toContain("finance/");

    // §9.2: the id never changes and a move rewrites the path, not the content.
    // A writer that read before the move can still write after it, which is
    // correct — nothing it read has changed.
    const response = await ws.put(`/api/docs/${id}`, { body: "written after the move", key });
    expect(response.status).toBe(200);
    expect(parseDocument(ws.read(movedPath)).body).toBe("written after the move");
  });
});

describe("two writers, one document (SPEC.md §7)", () => {
  it("lets one of two writes on the same key through and refuses the other", async () => {
    const { id, path } = await plain("key-concurrent");
    const key = await readDocKey(ws, id);

    // Both presenting the same key, dispatched together. Serialization is the
    // document mutex the write path already holds, which is what makes the
    // comparison mean anything: read, compare and write are one critical
    // section, so the loser compares against what the winner stored.
    const [first, second] = await Promise.all([
      ws.put(`/api/docs/${id}`, { body: "written by the first", key }),
      ws.put(`/api/docs/${id}`, { body: "written by the second", key }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    // Exactly one of the two bodies is on disk, whole — never a merge of both.
    const stored = parseDocument(ws.read(path)).body;
    expect(["written by the first", "written by the second"]).toContain(stored);

    const refusal = first.status === 409 ? first : second;
    const payload = (await refusal.json()) as { code: string; doc: { body: string; key: string } };
    expect(payload.code).toBe("stale_key");
    // The loser is told, and told with what it needs: the winner's content and
    // the key that writes over it.
    expect(payload.doc.body).toBe(stored);
    const retried = await ws.put(`/api/docs/${id}`, {
      body: "merged by hand",
      key: payload.doc.key,
    });
    expect(retried.status).toBe(200);
  });
});

describe("someone is editing this — advisory, never a gate (SPEC.md §4, §7)", () => {
  it("reports a person's open edit session and stops when it is flushed", async () => {
    const { id } = await plain("key-editing");
    expect((await readDoc(id)).userEditing).toBe(false);

    // §4 opens a session on the first *user* editor save that lands a commit.
    expect((await putDoc(ws, id, { body: "the person is typing" })).status).toBe(200);
    expect((await readDoc(id)).userEditing).toBe(true);

    const flushed = await ws.post(`/api/docs/${id}/edit-session/flush`, {});
    expect(flushed.status).toBe(204);
    expect((await readDoc(id)).userEditing).toBe(false);
  });

  it("never reports the agent, whose writing is one-shot commands with no session", async () => {
    const { id } = await plain("key-editing-agent");

    const saved = await ws.put(
      `/api/docs/${id}`,
      { body: "written by the agent", key: await readDocKey(ws, id) },
      { "x-corpus-author": "agent" },
    );
    expect(saved.status).toBe(200);
    // Asymmetric on purpose (§7): the person sees the agent's writes land live
    // instead, and neither direction is a lock.
    expect((await readDoc(id)).userEditing).toBe(false);
  });

  it("refuses nothing: a document with a session open is written like any other", async () => {
    const { id, path } = await plain("key-editing-not-a-gate");
    expect((await putDoc(ws, id, { body: "the person is typing" })).status).toBe(200);
    expect((await readDoc(id)).userEditing).toBe(true);

    ws.advance(60_000);
    const agentWrite = await ws.put(
      `/api/docs/${id}`,
      { body: "the agent writes anyway", key: await readDocKey(ws, id) },
      { "x-corpus-author": "agent" },
    );
    expect(agentWrite.status).toBe(200);
    expect(parseDocument(ws.read(path)).body).toBe("the agent writes anyway");
    // Impolite, not incorrect — and the signal itself is unchanged by the write.
    expect((await readDoc(id)).userEditing).toBe(true);
  });

  it("scopes the signal to the document the session is on", async () => {
    const { id } = await plain("key-editing-scope");
    const other = await createDoc(ws, { type: "note", title: "Untouched", body: "quiet" });

    expect((await putDoc(ws, id, { body: "the person is typing" })).status).toBe(200);
    expect((await readDoc(id)).userEditing).toBe(true);
    expect((await readDoc(other.id)).userEditing).toBe(false);
  });
});
