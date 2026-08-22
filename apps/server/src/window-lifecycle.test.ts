// SPEC.md §4 — "A window never outlives the server silently", at the two ends of
// the server's life (SERVER-094).
//
// A clean stop closes the open window through the disposer chain, so the last
// editing session's commit says what it was. A start commits whatever the
// previous run left uncommitted — and, on every ordinary boot, commits nothing
// and says nothing.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type CorpusServer } from "./app.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "./attachments/index.js";
import type { ServerConfig } from "./config.js";
import {
  createDoc,
  createWriteWorkspace,
  TOKEN,
  type WriteWorkspace,
  putDoc,
} from "./docs/write-fixture.js";
import type { AutoCommitter } from "./git/index.js";
import { createRecordingCommitter } from "./git/git-fixture.js";
import { openProjection, type ProjectionDb } from "./projection/index.js";

let workspace: WriteWorkspace | undefined;
let bare:
  { readonly server: CorpusServer; readonly db: ProjectionDb; readonly root: string } | undefined;

afterEach(async () => {
  if (workspace !== undefined) {
    await workspace.server.close();
    workspace.close();
    workspace = undefined;
  }
  if (bare !== undefined) {
    await bare.server.close();
    bare.db.close();
    rmSync(bare.root, { recursive: true, force: true });
    bare = undefined;
  }
});

/** A server with a projection and an injected git writer — no repository needed. */
function makeBareServer(git: AutoCommitter): CorpusServer {
  const root = mkdtempSync(join(tmpdir(), "corpus-s094-bare-"));
  const workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, ".corpus"), { recursive: true });
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  const config: ServerConfig = {
    workspaceRoot,
    corpusDir: join(workspaceRoot, ".corpus"),
    attachments: DEFAULT_ATTACHMENT_LIMITS,
    dataDir: join(workspaceRoot, "data"),
    configPath: join(workspaceRoot, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    version: "9.9.9",
    logLevel: "silent",
    uiDistDir: undefined,
    embedding: { kind: "absent" },
    warnings: [],
  };
  const db = openProjection(config, { populate: false });
  const server = createServer(config, { projection: db, git, heartbeatMs: 0 });
  bare = { server, db, root };
  return server;
}

describe("a clean stop closes the open commit window (SPEC.md §4)", () => {
  it("closes it with the shutdown reason, and awaits the git call", async () => {
    const recording = createRecordingCommitter();
    let gitFinished = false;
    const git: AutoCommitter = {
      ...recording,
      async closeWindow(reason) {
        await recording.closeWindow(reason);
        // A disposer that fires and returns before git finishes is the same as
        // not having one, so the assertion below is about `close()` waiting.
        await new Promise((resolve) => setTimeout(resolve, 20));
        gitFinished = true;
      },
    };
    const server = makeBareServer(git);

    await server.close();

    // Twice: once ahead of the acknowledgments, so a relabelled sha can still be
    // followed, and once from the disposer after the socket is shut, so a window
    // opened by a request that was still in flight is closed too.
    expect(recording.closed).toEqual(["shutdown", "shutdown"]);
    expect(gitFinished).toBe(true);
  });

  it("gives the window's commit the editing-session subject rather than the last save's", async () => {
    const ws = createWriteWorkspace("clean-stop", { sprint: "s094" });
    workspace = ws;
    // The agent's window rather than the user's: a *user* save opens an edit
    // session whose acknowledgment publishes the window's sha at shutdown, and
    // §4 will not relabel a commit a published range already names. The agent's
    // edits emit no acknowledgment, so nothing pins the window.
    const created = await createDoc(ws, { type: "note", title: "Recovery notes" }, "agent");
    await putDoc(ws, created.id, { body: "a first save" }, { "x-corpus-author": "agent" });
    await putDoc(ws, created.id, { body: "a second save" }, { "x-corpus-author": "agent" });
    expect(ws.log("%s")[0]).not.toContain("editing session");

    await ws.server.close();

    expect(ws.log("%s")[0]).toBe("editing session: 1 document by agent");
    expect(ws.log("%an")[0]).toBe("agent");
  });

  it("relabels a user's window and lets the acknowledgment follow the new sha", async () => {
    const ws = createWriteWorkspace("clean-stop-user", { sprint: "s094" });
    workspace = ws;
    const created = await createDoc(ws, { type: "note", title: "Recovery notes" }, "user");
    // `editPath` is what opens §4's edit session, so this is the path whose
    // acknowledgment publishes the window's sha at shutdown.
    await putDoc(ws, created.id, { body: "a first save" });
    await putDoc(ws, created.id, { body: "a second save" });

    await ws.server.close();

    expect(ws.log("%s")[0]).toBe("editing session: 1 document by user");
    // The relabel moved the sha; the enqueued range names where the history
    // actually ends, not the commit the amend replaced.
    const events = ws.db.sqlite
      .prepare<[], { payload_json: string }>(
        "SELECT payload_json FROM events WHERE type = 'doc.edited' ORDER BY created",
      )
      .all();
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]?.payload_json ?? "{}") as { to?: string };
    expect(payload.to).toBe(ws.head());
  });
});

describe("a start commits what a previous run left uncommitted (SPEC.md §4)", () => {
  it("commits nothing and says nothing when the tree is clean", async () => {
    const ws = createWriteWorkspace("clean-boot", { sprint: "s094" });
    workspace = ws;
    const before = ws.log("%H");

    const address = await ws.server.start();
    expect(address.port).toBeGreaterThan(0);

    expect(ws.log("%H")).toEqual(before);
  });

  it("commits an out-of-band write as one recovery commit, before the socket exists", async () => {
    const ws = createWriteWorkspace("dirty-boot", { sprint: "s094" });
    workspace = ws;
    // What a previous run left behind: a file under a document root that no
    // commit ever saw.
    ws.write("data/docs/inbox/left-behind.md", "# written while the server was down\n");
    ws.write("scratch.txt", "the operator's own dirty file, outside the roots\n");
    const before = ws.log("%H").length;

    await ws.server.start();

    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.log("%s")[0]).toBe("recovery: 1 document left uncommitted by a previous run");
    expect(ws.log("%an <%ae>")[0]).toBe("recovery <recovery@corpus.local>");
    expect(ws.git("show", "--name-only", "--format=", "HEAD").trim()).toBe(
      "data/docs/inbox/left-behind.md",
    );
    // The recovery ran before anything could be served, so the very first
    // request sees a workspace whose history is already whole.
    const response = await ws.request("/api/health");
    expect(response.status).toBe(200);
    expect(ws.git("status", "--porcelain", "--", "scratch.txt")).toBe("?? scratch.txt\n");
  });

  it("still starts when the recovery commit is refused", async () => {
    const ws = createWriteWorkspace("refused-boot", { sprint: "s094" });
    workspace = ws;
    ws.write("data/docs/inbox/left-behind.md", "# written while the server was down\n");
    const hook = join(ws.root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const before = ws.log("%H");

    const address = await ws.server.start();

    expect(address.port).toBeGreaterThan(0);
    expect(ws.log("%H")).toEqual(before);
    // SPEC.md §11: the change stands on disk, and the index is not left dirty.
    expect(ws.exists("data/docs/inbox/left-behind.md")).toBe(true);
    expect(ws.git("diff", "--cached", "--name-only")).toBe("");
  });
});
