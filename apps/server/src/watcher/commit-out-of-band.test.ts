// SERVER-090. Real chokidar, real files, a real git repository and the server's
// real `AutoCommitter`: what is being asserted is what `git log` says about a
// change nobody asked the server to make, so a test that stubbed git would only
// prove the stub. The unit block at the bottom uses the recording committer for
// the questions that are about the *request* rather than about the repository.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeContext } from "../anchors/index.js";
import { createInvalidationBus, type InvalidationBus } from "../events/index.js";
import {
  createAutoCommitter,
  createGit,
  disableAutoMaintenance,
  sanitizeGitEnv,
  type AutoCommitter,
} from "../git/index.js";
import { createRecordingCommitter } from "../git/git-fixture.js";
import { silentLogger } from "../logger.js";
import { openProjection, populateFromFiles, type ProjectionDb } from "../projection/index.js";
import { createOutOfBandCommitter, outOfBandSubject } from "./commit-out-of-band.js";
import { createSelfWriteRegistry, type SelfWriteRegistry } from "./self-writes.js";
import { startWatcher, type WatcherHandle } from "./watcher.js";

const WAIT = { timeout: 15_000, interval: 40 } as const;

// Every assertion waits on a real filesystem event through chokidar's
// `awaitWriteFinish` window, the watcher's debounce and then a git process.
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

let root: string;
let workspace: string;
let db: ProjectionDb;
let bus: InvalidationBus;
let selfWrites: SelfWriteRegistry;
let committer: AutoCommitter;
let watcher: WatcherHandle | undefined;

const abs = (relativePath: string): string => join(workspace, ...relativePath.split("/"));

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspace,
    env: sanitizeGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(relativePath: string, content: string): void {
  const path = abs(relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const doc = (id: string, title: string, body: string): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${title}\n---\n\n${body}\n`;

/** Commits whatever is on disk as the workspace's own bootstrap, exactly as `corpus init` does. */
function seedCommit(message: string): void {
  git("add", "-A");
  git(
    "-c",
    "user.email=test@corpus.local",
    "-c",
    "user.name=Corpus Test",
    "commit",
    "-q",
    "-m",
    message,
  );
}

/** `author|subject` per commit, newest first. */
const log = (): string[] =>
  git("log", "--format=%an|%s")
    .split("\n")
    .filter((line) => line !== "");

/**
 * Uncommitted state under the document roots. Scoped there for the reason
 * `git/recovery.ts` scopes itself there — `.corpus/` is runtime state and is
 * gitignored in a real workspace, which the fixture reproduces below.
 */
const porcelain = (): string => git("status", "--porcelain", "--", "data").trim();

/**
 * Boots as the real server does: repopulate the projection from what the test
 * seeded, then watch — with the same out-of-band committer `app.ts` builds over
 * the server's one git writer.
 */
async function startWatching(): Promise<void> {
  populateFromFiles(db);
  committer = createAutoCommitter({ git: createGit(workspace), logger: silentLogger });
  watcher = startWatcher({
    db,
    bus,
    selfWrites,
    logger: silentLogger,
    debounceMs: 25,
    maxBatchMs: 150,
    commitOutOfBand: createOutOfBandCommitter({ git: committer, logger: silentLogger }),
  });
  await watcher.ready;
  // chokidar's `ready` says the initial scan finished, not that every
  // per-directory OS watch is armed.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/** Waits until the batch a change belongs to has been flushed *and* its commit has landed. */
async function waitForLog(assert: (lines: string[]) => void): Promise<void> {
  await vi.waitFor(async () => {
    await watcher?.settled();
    assert(log());
  }, WAIT);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s090-oob-"));
  workspace = join(root, "ws");
  mkdirSync(join(workspace, "data", "docs"), { recursive: true });
  mkdirSync(join(workspace, "data", "threads"), { recursive: true });
  // What `corpus init` writes: the projection and the rest of `.corpus/` are
  // derived runtime state and are never committed (SPEC.md §4's layout).
  writeFileSync(join(workspace, ".gitignore"), ".corpus/\n", "utf8");
  db = openProjection({ workspaceRoot: workspace, corpusDir: join(workspace, ".corpus") });
  bus = createInvalidationBus();
  selfWrites = createSelfWriteRegistry();
  watcher = undefined;
  git("init", "-q", "--initial-branch=main");
  disableAutoMaintenance(git);
  git("config", "user.email", "workspace@corpus.local");
  git("config", "user.name", "Workspace");
});

afterEach(async () => {
  await watcher?.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("an out-of-band edit is committed for itself (SPEC.md §4, SERVER-090)", () => {
  it("commits an external editor's change with no later mutation, authored `user`", async () => {
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));
    seedCommit("seed");
    await startWatching();

    // The bug's own shape: a person edits the file in an external editor and
    // nothing else happens. Before SERVER-090 this stayed dirty indefinitely and
    // reached git only inside whatever mutation touched the document next.
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.4%."));

    await waitForLog((lines) => {
      expect(lines[0]).toBe("user|doc edit: Mortgage (doc_mortgage) by user");
    });
    expect(porcelain()).toBe("");
    expect(git("show", "HEAD:data/docs/mortgage.md")).toContain("Rate is 6.4%.");
  });

  it("never lets a later mutation carry the person's bytes under its own author", async () => {
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));
    seedCommit("seed");
    await startWatching();

    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%.\n\nMine."));
    await waitForLog((lines) => {
      expect(lines[0]).toContain("user|");
    });

    // Now the agent writes — the mutation that used to sweep the paragraph
    // above into its own commit, under its own name.
    write(
      "data/docs/mortgage.md",
      doc("doc_mortgage", "Mortgage", "Rate is 6.1%.\n\nMine.\n\nIts."),
    );
    selfWrites.record(
      abs("data/docs/mortgage.md"),
      doc("doc_mortgage", "Mortgage", "Rate is 6.1%.\n\nMine.\n\nIts."),
    );
    const outcome = await committer.commit({
      docId: "doc_mortgage",
      actor: "agent",
      subject: "doc edit: Mortgage (doc_mortgage) by agent",
      paths: ["data/docs/mortgage.md"],
    });
    expect(outcome.kind).toBe("committed");

    // The agent's commit holds its own sentence and not the person's — the
    // person's is already one commit down, authored `user`.
    const agentDiff = git("show", "HEAD", "--", "data/docs/mortgage.md");
    expect(agentDiff).toContain("+Its.");
    expect(agentDiff).not.toContain("+Mine.");
    const [agent, person] = log();
    expect(agent).toBe("agent|doc edit: Mortgage (doc_mortgage) by agent");
    // The agent's write closed the person's window, which relabels it (§4).
    expect(person).toBe("user|editing session: 1 document by user");
  });

  it("lands the anchor reconciliation's rewrite and the person's edit as one change", async () => {
    const exact = "assume a 30-year fixed at 6.1%";
    const body = `We should refinance.\n\nLet us ${exact} which is the going rate.\n\nThen review.`;
    const context = computeContext(body, body.indexOf(exact), body.indexOf(exact) + exact.length);
    write(
      "data/docs/mortgage.md",
      [
        "---",
        "id: doc_mortgage",
        "type: note",
        "title: Mortgage",
        "anchors:",
        "  anc_one:",
        `    exact: ${exact}`,
        `    prefix: ${JSON.stringify(context.prefix)}`,
        `    suffix: ${JSON.stringify(context.suffix)}`,
        "---",
        "",
        body,
        "",
      ].join("\n"),
    );
    seedCommit("seed");
    await startWatching();

    const before = git("rev-parse", "HEAD").trim();
    writeFileSync(
      abs("data/docs/mortgage.md"),
      git("show", "HEAD:data/docs/mortgage.md").replace("at 6.1% which", "at 6.4% which"),
      "utf8",
    );

    await waitForLog((lines) => {
      expect(lines[0]).toBe("user|doc edit: Mortgage (doc_mortgage) by user");
    });

    // One commit, not two: the remapped selector was written by reconciliation
    // *before* the commit, so the commit takes both at once.
    expect(git("rev-list", "--count", `${before}..HEAD`).trim()).toBe("1");
    const committed = git("show", "HEAD:data/docs/mortgage.md");
    expect(committed).toContain("exact: assume a 30-year fixed at 6.4%");
    expect(committed).toContain("at 6.4% which is the going rate.");
    // The committed content is exactly what the watcher left on disk, which is
    // also what §7's key is a digest of — so committing moves no key.
    expect(committed).toBe(git("show", ":data/docs/mortgage.md"));
    expect(porcelain()).toBe("");
    expect(git("log", "-1", "--format=%b")).toContain("Corpus-Anchors: remapped=1 orphaned=0");
  });

  it("folds repeated external saves into one commit, as an editing session", async () => {
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "One."));
    seedCommit("seed");
    await startWatching();
    const before = git("rev-parse", "HEAD").trim();

    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Two."));
    await waitForLog((lines) => {
      expect(lines[0]).toContain("user|");
    });
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Three."));
    await waitForLog(() => {
      expect(git("show", "HEAD:data/docs/mortgage.md")).toContain("Three.");
    });

    // §4: "An external editor that saves as you type therefore produces a commit
    // per editing session, as the board does, and not one per save."
    expect(git("rev-list", "--count", `${before}..HEAD`).trim()).toBe("1");
  });

  it("carries a rename made outside the server as a rename", async () => {
    write("data/docs/inbox/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));
    seedCommit("seed");
    await startWatching();

    renameSync(abs("data/docs/inbox/mortgage.md"), abs("data/docs/mortgage.md"));

    await waitForLog(() => {
      expect(porcelain()).toBe("");
    });
    // Both halves of the rename folded into one `user` commit, which is what
    // makes git report it as a rename rather than as a deletion and a creation.
    expect(git("show", "--name-status", "--format=", "HEAD").trim()).toBe(
      "R100\tdata/docs/inbox/mortgage.md\tdata/docs/mortgage.md",
    );
    expect(log()[0]).toContain("user|");
  });

  it("commits a deletion made outside the server, naming what was deleted", async () => {
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));
    write(
      "data/threads/th_aaa111.md",
      `---\nid: th_aaa111\ntype: thread\ntitle: Q\nparent: null\n---\n\n### user — 2026-07-19T10:00:00Z\n\nWhy?\n`,
    );
    seedCommit("seed");
    await startWatching();

    unlinkSync(abs("data/threads/th_aaa111.md"));

    await waitForLog((lines) => {
      expect(lines[0]).toBe("user|thread delete: Q (th_aaa111) by user");
    });
    expect(porcelain()).toBe("");
    // §7: git preserves history — the seed commit still holds the file.
    expect(git("show", "HEAD~1:data/threads/th_aaa111.md")).toContain("Why?");
  });

  it("says nothing about a path the projection names no document for", async () => {
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));
    seedCommit("seed");
    await startWatching();
    const before = git("rev-parse", "HEAD").trim();

    // Unparseable frontmatter: no row, so no `Corpus-Doc` to name. Boot recovery
    // is what covers this file (`git/recovery.ts`), not a guessed id.
    write("data/docs/broken.md", "---\nid: [unclosed\n---\n\nNope.\n");

    await vi.waitFor(async () => {
      await watcher?.settled();
      expect(porcelain()).toBe("?? data/docs/broken.md");
    }, WAIT);
    expect(git("rev-parse", "HEAD").trim()).toBe(before);
  });

  it("projects and announces as before when the server has no git writer", async () => {
    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.1%."));
    seedCommit("seed");
    populateFromFiles(db);
    const keys: unknown[] = [];
    bus.subscribe((batch) => keys.push(...batch));
    watcher = startWatcher({ db, bus, selfWrites, logger: silentLogger, debounceMs: 25 });
    await watcher.ready;
    await new Promise((resolve) => setTimeout(resolve, 300));

    write("data/docs/mortgage.md", doc("doc_mortgage", "Mortgage", "Rate is 6.4%."));

    await vi.waitFor(() => {
      expect(JSON.stringify(keys)).toContain("doc_mortgage");
    }, WAIT);
    await watcher.settled();
    expect(log()).toHaveLength(1);
  });
});

describe("the out-of-band committer's request (SPEC.md §4)", () => {
  const change = {
    docId: "doc_mortgage",
    paths: ["data/docs/mortgage.md"],
    title: "Mortgage",
    type: "note",
    removed: false,
  } as const;

  it("is an ordinary save by `user`: no act, no named set, no opt-out of folding", async () => {
    const recording = createRecordingCommitter();
    await createOutOfBandCommitter({ git: recording })([change]);

    expect(recording.commits).toHaveLength(1);
    const request = recording.commits[0];
    expect(request?.actor).toBe("user");
    expect(request?.paths).toEqual(["data/docs/mortgage.md"]);
    // §4: "Nothing about it is an act and nothing announces it, so the idle
    // window is what commits it." Each of these three would say otherwise.
    expect(request?.act).toBeUndefined();
    expect(request?.docIds).toBeUndefined();
    expect(request?.squash).toBeUndefined();
    expect(recording.closed).toEqual([]);
  });

  it("carries what reconciliation moved, and nothing when it did not run", async () => {
    const recording = createRecordingCommitter();
    await createOutOfBandCommitter({ git: recording })([
      { ...change, anchors: { remapped: ["anc_one"], orphaned: [] } },
      change,
    ]);

    expect(recording.commits[0]?.anchors).toEqual({ remapped: ["anc_one"], orphaned: [] });
    expect(recording.commits[1]?.anchors).toBeUndefined();
  });

  it("commits each document on its own, in order, so they fold into one window", async () => {
    const recording = createRecordingCommitter();
    await createOutOfBandCommitter({ git: recording })([
      change,
      { ...change, docId: "doc_other", paths: ["data/docs/other.md"], title: "Other" },
    ]);

    expect(recording.commits.map((request) => request.docId)).toEqual([
      "doc_mortgage",
      "doc_other",
    ]);
    expect(recording.commits.every((request) => request.docIds === undefined)).toBe(true);
  });

  it("does not throw when git refuses (SPEC.md §14 — the change stands on disk)", async () => {
    const recording = createRecordingCommitter();
    recording.setOutcome({ kind: "failed", reason: "a hook refused", output: "no" });
    await expect(createOutOfBandCommitter({ git: recording })([change])).resolves.toBeUndefined();
  });

  it("names a removal by what it removed, and a thread as a thread", () => {
    expect(outOfBandSubject({ ...change, removed: true })).toBe(
      "doc delete: Mortgage (doc_mortgage) by user",
    );
    expect(outOfBandSubject({ ...change, type: "thread", removed: true })).toBe(
      "thread delete: Mortgage (doc_mortgage) by user",
    );
    expect(outOfBandSubject(change)).toBe("doc edit: Mortgage (doc_mortgage) by user");
  });
});
