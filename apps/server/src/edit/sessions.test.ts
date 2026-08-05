import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOC_EDITED_EVENT_TYPE,
  EMPTY_TREE_OBJECT_ID,
  parseDocEditedPayload,
} from "@corpus/contract";
import type { CommitOutcome, Git, GitCommandResult } from "../git/index.js";
import {
  EDIT_ACK_IDLE_MS,
  EDIT_EVENT_SOURCE,
  createEditSessionTracker,
  type EditEnqueueInput,
  type EditSessionTracker,
  type ObservedCommit,
} from "./sessions.js";

const IDLE_MS = 60_000;
const DOC = "doc_aaaaaaaa";
const PATH = "data/docs/notes.md";

const ok = (stdout: string): GitCommandResult => ({
  ok: true,
  code: 0,
  stdout,
  stderr: "",
  spawned: true,
});
const no = (): GitCommandResult => ({ ok: false, code: 1, stdout: "", stderr: "", spawned: true });

interface FakeRepo {
  /** sha → parent sha, or `null` for a root commit. A sha absent here does not resolve. */
  readonly parents: Map<string, string | null>;
  /** Range key `from..to` → the `--shortstat` line git would print. */
  readonly shortstat?: Map<string, string> | undefined;
  /** Range key `from..to` → the count `rev-list --count` would print. Default `"1"`. */
  readonly counts?: Map<string, string> | undefined;
}

/**
 * A `Git` that answers the four read-only plumbing questions the emitter asks,
 * from an explicit commit graph. The real repository is exercised by the
 * integration suite in `acknowledgment.test.ts`; here the point is to decide
 * *which* range the tracker names, which a fake graph states far more precisely
 * than a real one.
 */
function fakeGit(repo: FakeRepo): Git & { readonly calls: string[][] } {
  const calls: string[][] = [];
  const range = (from: string, to: string): string => `${from}..${to}`;
  return {
    root: "/workspace",
    calls,
    exec(args) {
      const argv = [...args];
      calls.push(argv);
      if (argv[0] === "rev-parse") {
        const ref = argv[3] ?? "";
        if (ref.endsWith("^{commit}")) {
          const sha = ref.slice(0, -"^{commit}".length);
          return Promise.resolve(repo.parents.has(sha) ? ok(`${sha}\n`) : no());
        }
        if (ref.endsWith("^")) {
          const parent = repo.parents.get(ref.slice(0, -1));
          return Promise.resolve(
            parent === undefined || parent === null ? no() : ok(`${parent}\n`),
          );
        }
        return Promise.resolve(no());
      }
      if (argv[0] === "diff") {
        const from = argv[4] ?? "";
        const to = argv[5] ?? "";
        return Promise.resolve(
          ok(
            repo.shortstat?.get(range(from, to)) ??
              " 1 file changed, 3 insertions(+), 1 deletion(-)\n",
          ),
        );
      }
      if (argv[0] === "rev-list") {
        const spec = argv[2] ?? "";
        return Promise.resolve(ok(`${repo.counts?.get(spec) ?? "1"}\n`));
      }
      return Promise.resolve(no());
    },
  };
}

interface Harness {
  readonly tracker: EditSessionTracker;
  readonly enqueued: EditEnqueueInput[];
  readonly git: Git & { readonly calls: string[][] };
  advance(ms: number): Promise<void>;
  settle(): Promise<void>;
}

let clock = 1_000_000;

function harness(repo: FakeRepo, enqueue?: () => Promise<{ id: string }>): Harness {
  const enqueued: EditEnqueueInput[] = [];
  const git = fakeGit(repo);
  let minted = 0;
  const tracker = createEditSessionTracker({
    git,
    enqueue: (input) => {
      enqueued.push(input);
      minted += 1;
      return enqueue?.() ?? Promise.resolve({ id: `evt_${String(minted)}` });
    },
    now: () => clock,
    idleMs: IDLE_MS,
  });
  const settle = async (): Promise<void> => {
    // Two real macrotask turns: the emitter awaits four fake-git promises, and
    // `setImmediate` is left unfaked precisely so a bounded settle exists.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    tracker,
    enqueued,
    git,
    async advance(ms) {
      clock += ms;
      await vi.advanceTimersByTimeAsync(ms);
      await settle();
    },
    settle,
  };
}

const save = (overrides: Partial<ObservedCommit> & { outcome: CommitOutcome }): ObservedCommit => ({
  docId: DOC,
  actor: "user",
  paths: [PATH],
  editPath: PATH,
  ...overrides,
});

const committed = (sha: string): CommitOutcome => ({ kind: "committed", sha });
const amended = (sha: string): CommitOutcome => ({ kind: "amended", sha });

beforeEach(() => {
  clock = 1_000_000;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("edit session tracker — the idle path (SPEC.md §4)", () => {
  it("emits one doc.edited naming the session's range after the window elapses", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));

    await h.advance(IDLE_MS - 1);
    expect(h.enqueued).toHaveLength(0);

    await h.advance(1);
    expect(h.enqueued).toHaveLength(1);
    const [event] = h.enqueued;
    expect(event?.type).toBe(DOC_EDITED_EVENT_TYPE);
    expect(event?.source).toBe(EDIT_EVENT_SOURCE);
    const payload = parseDocEditedPayload({ type: event?.type ?? "", payload: event?.payload });
    expect(payload).toMatchObject({
      docId: DOC,
      actor: "user",
      endedBy: "idle",
      from: "ba5e001",
      to: "c0ffee1",
      stats: { commits: 1, insertions: 3, deletions: 1 },
    });
    expect(payload?.sessionId).toMatch(/^es_[0-9a-f]{16}$/);
  });

  it("uses git's empty tree when the session's first commit has no parent", async () => {
    const h = harness({ parents: new Map([["0000fff", null]]) });
    h.tracker.observeCommit(save({ outcome: committed("0000fff") }));

    await h.advance(IDLE_MS);
    expect(h.enqueued[0]?.payload).toMatchObject({ from: EMPTY_TREE_OBJECT_ID, to: "0000fff" });
  });

  it("keeps one session across repeated saves inside the window", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
        ["c0ffee2", "c0ffee1"],
      ]),
      counts: new Map([["ba5e001..c0ffee2", "2"]]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));
    await h.advance(IDLE_MS - 10);
    h.tracker.observeCommit(save({ outcome: committed("c0ffee2") }));
    await h.advance(IDLE_MS - 10);
    expect(h.enqueued).toHaveLength(0);

    await h.advance(10);
    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toMatchObject({
      from: "ba5e001",
      to: "c0ffee2",
      stats: { commits: 2, insertions: 3, deletions: 1 },
    });
  });

  it("follows §4's squash when it rewrites the session's only commit", async () => {
    // `git commit --amend` replaces the sha; for a one-commit session that is
    // the session's *base* moving, so `from` has to come off the new one.
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
        ["c0ffeea", "ba5e001"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));
    h.tracker.observeCommit(save({ outcome: amended("c0ffeea") }));

    await h.advance(IDLE_MS);
    expect(h.enqueued[0]?.payload).toMatchObject({ from: "ba5e001", to: "c0ffeea" });
  });

  it("keeps the base fixed when an amend rewrites a later commit", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
        ["c0ffee2", "c0ffee1"],
        ["c0ffeeb", "c0ffee1"],
      ]),
      counts: new Map([["ba5e001..c0ffeeb", "2"]]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));
    h.tracker.observeCommit(save({ outcome: committed("c0ffee2") }));
    h.tracker.observeCommit(save({ outcome: amended("c0ffeeb") }));

    await h.advance(IDLE_MS);
    expect(h.enqueued[0]?.payload).toMatchObject({ from: "ba5e001", to: "c0ffeeb" });
  });

  it("tracks documents independently", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["aaaa001", "ba5e001"],
        ["bbbb001", "aaaa001"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("aaaa001") }));
    await h.advance(IDLE_MS / 2);
    h.tracker.observeCommit(
      save({
        docId: "doc_bbbbbbbb",
        paths: ["data/docs/b.md"],
        editPath: "data/docs/b.md",
        outcome: committed("bbbb001"),
      }),
    );

    await h.advance(IDLE_MS / 2);
    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toMatchObject({ docId: DOC, to: "aaaa001" });

    await h.advance(IDLE_MS / 2);
    expect(h.enqueued).toHaveLength(2);
    expect(h.enqueued[1]?.payload).toMatchObject({ docId: "doc_bbbbbbbb", to: "bbbb001" });
  });
});

describe("edit session tracker — the close path and idempotence", () => {
  it("flush ends the session as `close`", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));

    h.tracker.flush(DOC);
    await h.settle();

    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toMatchObject({ endedBy: "close", to: "c0ffee1" });
  });

  it("emits exactly one event when both triggers fire for one session", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));

    h.tracker.flush(DOC);
    await h.settle();
    await h.advance(IDLE_MS * 3);

    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toMatchObject({ endedBy: "close" });
  });

  it("gives distinct sessions on one document distinct ids", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
        ["c0ffee2", "c0ffee1"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));
    await h.advance(IDLE_MS);
    h.tracker.observeCommit(save({ outcome: committed("c0ffee2") }));
    await h.advance(IDLE_MS);

    expect(h.enqueued).toHaveLength(2);
    const ids = h.enqueued.map((event) => (event.payload as { sessionId: string }).sessionId);
    expect(new Set(ids).size).toBe(2);
  });

  it("flushes every open session at shutdown rather than losing the acknowledgment", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["aaaa001", "ba5e001"],
        ["bbbb001", "aaaa001"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("aaaa001") }));
    h.tracker.observeCommit(
      save({
        docId: "doc_bbbbbbbb",
        paths: ["data/docs/b.md"],
        editPath: "data/docs/b.md",
        outcome: committed("bbbb001"),
      }),
    );

    await h.tracker.close();

    expect(h.enqueued).toHaveLength(2);
    expect(h.enqueued.map((event) => (event.payload as { endedBy: string }).endedBy)).toEqual([
      "close",
      "close",
    ]);
  });

  it("records nothing after close, so a late mutation cannot open an untracked session", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
      ]),
    });
    await h.tracker.close();
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));
    await h.advance(IDLE_MS * 2);
    expect(h.enqueued).toHaveLength(0);
  });
});

describe("edit session tracker — actor scoping (the loop cannot feed itself)", () => {
  it("never opens a session for an agent-authored save", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
      ]),
    });
    h.tracker.observeCommit(save({ actor: "agent", outcome: committed("c0ffee1") }));

    await h.advance(IDLE_MS * 2);
    h.tracker.flush(DOC);
    await h.settle();

    expect(h.enqueued).toHaveLength(0);
  });

  it("never opens a session for a write that is not the editor's save", async () => {
    // A create, a move, an archive, a thread turn: things that happen *to* a
    // document rather than sessions of somebody editing it.
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
      ]),
    });
    h.tracker.observeCommit(save({ editPath: null, outcome: committed("c0ffee1") }));

    await h.advance(IDLE_MS * 2);
    expect(h.enqueued).toHaveLength(0);
  });
});

describe("edit session tracker — a session with no range emits nothing (§14)", () => {
  it("ignores a save whose auto-commit was skipped", async () => {
    const h = harness({ parents: new Map() });
    h.tracker.observeCommit(
      save({ outcome: { kind: "skipped", reason: "the workspace is not a git repository" } }),
    );
    await h.advance(IDLE_MS * 2);
    expect(h.enqueued).toHaveLength(0);
  });

  it("ignores a save whose auto-commit a hook refused", async () => {
    const h = harness({ parents: new Map() });
    h.tracker.observeCommit(
      save({ outcome: { kind: "failed", reason: "git commit failed", output: "hook said no" } }),
    );
    await h.advance(IDLE_MS * 2);
    expect(h.enqueued).toHaveLength(0);
  });

  it("drops a session whose commits are no longer in the repository", async () => {
    const h = harness({ parents: new Map() });
    h.tracker.observeCommit(save({ outcome: committed("9099999") }));
    await h.advance(IDLE_MS);
    expect(h.enqueued).toHaveLength(0);
  });

  it("says nothing about a range whose path-scoped diff is empty", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
      ]),
      shortstat: new Map([["ba5e001..c0ffee1", ""]]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));
    await h.advance(IDLE_MS);
    expect(h.enqueued).toHaveLength(0);
  });

  it("says nothing when no commit in the range touched this document", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
      ]),
      counts: new Map([["ba5e001..c0ffee1", "0"]]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));
    await h.advance(IDLE_MS);
    expect(h.enqueued).toHaveLength(0);
  });

  it("logs rather than throws when the queue refuses the event", async () => {
    const h = harness(
      {
        parents: new Map([
          ["ba5e001", null],
          ["c0ffee1", "ba5e001"],
        ]),
      },
      () => Promise.reject(new Error("queue is full")),
    );
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));
    await expect(h.tracker.close()).resolves.toBeUndefined();
  });
});

describe("edit session tracker — interleaving (CONTRACT-028's range rule)", () => {
  it("splits the session at another author's commit rather than spanning it", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["0d0d011", "ba5e001"],
        ["a9e0071", "0d0d011"],
        ["0d0d012", "a9e0071"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("0d0d011") }));
    h.tracker.observeCommit(save({ actor: "agent", outcome: committed("a9e0071") }));
    h.tracker.observeCommit(save({ outcome: committed("0d0d012") }));

    await h.tracker.close();

    expect(h.enqueued).toHaveLength(2);
    const ranges = h.enqueued.map((event) => {
      const payload = event.payload as { from: string; to: string; sessionId: string };
      return payload;
    });
    // Neither range contains `agent1`: the first ends at the commit before it,
    // the second starts from it.
    expect(ranges[0]).toMatchObject({ from: "ba5e001", to: "0d0d011" });
    expect(ranges[1]).toMatchObject({ from: "a9e0071", to: "0d0d012" });
    expect(new Set(ranges.map((entry) => entry.sessionId)).size).toBe(2);
  });

  it("seals on a commit that touches the document's file under another document's id", async () => {
    // Anchored thread creation stages the *parent document's* frontmatter while
    // committing under the thread's id, so a docId comparison alone would let it
    // through (SPEC.md §6).
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["0d0d011", "ba5e001"],
        ["7beef01", "0d0d011"],
        ["0d0d012", "7beef01"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("0d0d011") }));
    h.tracker.observeCommit({
      docId: "th_zzzzzzzz",
      actor: "agent",
      paths: ["data/threads/t.md", PATH],
      editPath: null,
      outcome: committed("7beef01"),
    });
    h.tracker.observeCommit(save({ outcome: committed("0d0d012") }));

    await h.tracker.close();
    expect(h.enqueued).toHaveLength(2);
    expect(h.enqueued[0]?.payload).toMatchObject({ to: "0d0d011" });
    expect(h.enqueued[1]?.payload).toMatchObject({ from: "7beef01", to: "0d0d012" });
  });

  it("leaves a session on another document alone", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["aaaa001", "ba5e001"],
        ["bbbb001", "aaaa001"],
        ["aaaa002", "bbbb001"],
      ]),
      counts: new Map([["ba5e001..aaaa002", "2"]]),
    });
    h.tracker.observeCommit(save({ outcome: committed("aaaa001") }));
    h.tracker.observeCommit({
      docId: "doc_bbbbbbbb",
      actor: "agent",
      paths: ["data/docs/b.md"],
      editPath: null,
      outcome: committed("bbbb001"),
    });
    h.tracker.observeCommit(save({ outcome: committed("aaaa002") }));

    await h.tracker.close();
    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toMatchObject({ from: "ba5e001", to: "aaaa002" });
  });

  it("still ends a sealed session by one of §4's two triggers, never by the sealing", async () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["0d0d011", "ba5e001"],
        ["a9e0071", "0d0d011"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("0d0d011") }));
    h.tracker.observeCommit(save({ actor: "agent", outcome: committed("a9e0071") }));

    // Sealing announced nothing: the person may still be typing.
    await h.settle();
    expect(h.enqueued).toHaveLength(0);

    await h.advance(IDLE_MS);
    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toMatchObject({ endedBy: "idle", to: "0d0d011" });
  });
});

describe("the acknowledgment window", () => {
  it("defaults to three minutes and is not the squash idle", async () => {
    expect(EDIT_ACK_IDLE_MS).toBe(180_000);
    const { SQUASH_IDLE_MS } = await import("../git/index.js");
    expect(EDIT_ACK_IDLE_MS).toBeGreaterThan(SQUASH_IDLE_MS);
  });

  it("does no git work at all on the write path", () => {
    const h = harness({
      parents: new Map([
        ["ba5e001", null],
        ["c0ffee1", "ba5e001"],
      ]),
    });
    h.tracker.observeCommit(save({ outcome: committed("c0ffee1") }));
    expect(h.git.calls).toEqual([]);
  });
});
