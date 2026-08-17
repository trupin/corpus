import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  QUERY_KEY_NAMES,
  QUERY_KEY_VOCABULARY,
  QUEUE_EVENT_STATUSES,
  type QueueEventStatus,
} from "@corpus/contract";
import { AGENTS_KEY, DOCS_KEY, JOBS_KEY, QUEUE_KEY, jobKey } from "../events/index.js";
import {
  QUEUE_QUERY_KEYS,
  QUEUE_TRANSITION_QUERY_KEYS,
  jobLogKeys,
  queueTransitionKeys,
  scanQueueSync,
} from "./project.js";
import { QueueStore, type StoredEvent } from "./store.js";

/**
 * A real store whose listing of one status fails the way a `chmod 000` status
 * directory fails. `chmod` is bypassed by root, so a test that used it would
 * pass without proving anything for whoever runs the suite as root; the
 * privilege-free equivalents (a path that is not a directory, a symlink loop)
 * all produce a *layout* that `ensureLayoutSync` refuses before the scan runs.
 * So the `EACCES` shape is injected at the one seam the reader talks to.
 */
class RefusingStore extends QueueStore {
  constructor(
    corpusDir: string,
    private readonly refused: QueueEventStatus,
  ) {
    super(corpusDir);
  }

  override listIdsSync(status: QueueEventStatus): string[] {
    if (status !== this.refused) return super.listIdsSync(status);
    throw Object.assign(new Error(`EACCES: permission denied, scandir '${this.dirFor(status)}'`), {
      code: "EACCES",
    });
  }
}

describe("the queue's invalidation key table", () => {
  it("names the queue, the job list and the document collection", () => {
    // Pinned by value, not by symbol: every call site imports the constant, so
    // only a literal assertion can catch a key going missing (SERVER-028).
    expect(QUEUE_QUERY_KEYS).toEqual([["queue"], ["jobs"], ["docs"]]);
    expect(QUEUE_QUERY_KEYS).toEqual([QUEUE_KEY, JOBS_KEY, DOCS_KEY]);
  });

  it("carries the document collection because `failed-job` reads `events.status`", () => {
    // SPEC.md §2.2: a write invalidates every query whose answer it changes.
    // `GET /api/docs?needs=me` counts documents named by a *failed* event
    // (`docs/needs.ts` FAILED_JOB_SQL), so a transition ages that collection.
    expect(QUEUE_QUERY_KEYS).toContainEqual(DOCS_KEY);
  });

  // SERVER-115. A lane's `summary` is read at response time off the newest
  // **in-progress** event on that lane and the `jobs.last_line` joined to it, so
  // a move into or out of that directory changes what `GET /api/agents` answers
  // while touching nothing anybody would call an agent.
  it("adds the roster for a move into or out of `in-progress`", () => {
    expect(QUEUE_TRANSITION_QUERY_KEYS).toEqual([["queue"], ["jobs"], ["docs"], ["agents"]]);
    expect(QUEUE_TRANSITION_QUERY_KEYS).toEqual([...QUEUE_QUERY_KEYS, AGENTS_KEY]);
  });

  /**
   * The whole rule, over the whole domain — every ordered pair of statuses plus
   * the `undefined` ends an enqueue and a removal have.
   *
   * Exhaustive rather than exemplary because the defect this fixes was a *set*
   * of call sites each deciding for itself: a table that covers every pair
   * leaves no pair for a future transition to decide differently.
   */
  it("names the roster for exactly the pairs that touch `in-progress`", () => {
    const ends = [...QUEUE_EVENT_STATUSES, undefined];
    for (const from of ends) {
      for (const to of ends) {
        const expected =
          from === "in-progress" || to === "in-progress"
            ? QUEUE_TRANSITION_QUERY_KEYS
            : QUEUE_QUERY_KEYS;
        expect(queueTransitionKeys(from, to)).toEqual(expected);
      }
    }
    // The one-ended form the reaper uses: everything it moves comes out of
    // `in-progress/`, whatever it moves into.
    expect(queueTransitionKeys("in-progress")).toEqual(QUEUE_TRANSITION_QUERY_KEYS);
    // An enqueue: no event on the `from` side, `pending` on the `to` side.
    expect(queueTransitionKeys(undefined, "pending")).toEqual(QUEUE_QUERY_KEYS);
  });

  it("names the roster for an append to a held job's log, and not to a finished one's", () => {
    expect(jobLogKeys("evt_a1b2c3d4e5f6", true)).toEqual([
      ["jobs"],
      ["jobs", "evt_a1b2c3d4e5f6"],
      ["agents"],
    ]);
    expect(jobLogKeys("evt_a1b2c3d4e5f6", false)).toEqual([["jobs"], ["jobs", "evt_a1b2c3d4e5f6"]]);
    expect(jobLogKeys("evt_a1b2c3d4e5f6", true)).toEqual([
      JOBS_KEY,
      jobKey("evt_a1b2c3d4e5f6"),
      AGENTS_KEY,
    ]);
  });
});

/**
 * The converse of the cross-check `queue/liveness.test.ts` wrote for SERVER-114:
 * there, the contract's published `emittedBy` says a presence change makes two
 * routes stale and `PRESENCE_QUERY_KEYS` is held to it; here it says a queue
 * transition and a job-log append make the **roster** stale, and these tables
 * are held to that.
 *
 * It has to live in `apps/server` and not beside the vocabulary it reads:
 * `packages/contract` may not import a consumer (CONTRACT-055), so only this
 * side can put the prose and the emitter in the same assertion. Which is the
 * whole point — between CONTRACT-055 landing and SERVER-115 landing, the
 * published description promised a frame the server did not send, and nothing
 * anywhere could fail because of it.
 */
describe("what the contract publishes about the roster, held against the emitters", () => {
  /** The keys whose published description says a queue transition emits them. */
  const claimedByTransition = QUERY_KEY_NAMES.filter((name) =>
    /queue transition/i.test(QUERY_KEY_VOCABULARY[name].emittedBy),
  );

  it("covers every key the contract says a queue transition emits", () => {
    expect(claimedByTransition).toEqual(["docs", "queue", "jobs", "agents"]);
    for (const name of claimedByTransition) {
      expect(QUEUE_TRANSITION_QUERY_KEYS).toContainEqual(QUERY_KEY_VOCABULARY[name].key(""));
    }
  });

  it("carries the coupling the `queue` and `jobs` entries spell out in prose", () => {
    // Both entries were amended by CONTRACT-055 to say a transition names
    // `["agents"]` in the *same frame* — the coupling this issue makes true.
    expect(QUERY_KEY_VOCABULARY.queue.emittedBy).toMatch(/names `\["agents"\]` in the same frame/);
    expect(QUERY_KEY_VOCABULARY.jobs.emittedBy).toMatch(/name `\["agents"\]` in the same frame/);
    expect(QUERY_KEY_VOCABULARY.agents.emittedBy).toMatch(/job-log append/);
  });

  it("names the roster on a job-log append, as the `jobs` entry promises", () => {
    expect(jobLogKeys("evt_000000000000", true)).toContainEqual(AGENTS_KEY);
  });
});

describe("scanQueueSync", () => {
  let root: string;
  let store: QueueStore;

  const event = (id: string): StoredEvent => ({
    id,
    type: "comment.created",
    created: "2026-08-06T09:00:00Z",
    source: "cli",
    payload: {},
    status: "pending",
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "corpus-s063-scan-"));
    store = new QueueStore(join(root, ".corpus"));
    store.ensureLayoutSync();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // SERVER-063: the boot scan used to rethrow whatever the read threw, which the
  // constructor above it turned into a server that would not start.
  it("skips what it cannot read and keeps scanning, across every status", async () => {
    await store.writeEvent("pending", event("evt_pending00000"));
    await store.writeEvent("processed", event("evt_processed000"));
    // `readdir` lists these as event files; every read of one fails with EISDIR,
    // for every user — a `chmod` would be bypassed by root.
    mkdirSync(store.pathFor("pending", "evt_unreadable01"));
    mkdirSync(store.pathFor("processed", "evt_unreadable02"));
    writeFileSync(store.pathFor("failed", "evt_malformed000"), "{ truncated");

    const scan = scanQueueSync(store);

    // Every readable event survives — including the ones after the failure, and
    // the ones in the status directories after it.
    expect(scan.events.map((each) => [each.id, each.status]).sort()).toEqual([
      ["evt_pending00000", "pending"],
      ["evt_processed000", "processed"],
    ]);
    // Reported as what it is: unreadable is not malformed, and neither is an
    // event — nothing here goes into the mirror.
    expect([...scan.unreadable].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      {
        id: "evt_unreadable01",
        status: "pending",
        reason: expect.stringContaining("EISDIR") as string,
      },
      {
        id: "evt_unreadable02",
        status: "processed",
        reason: expect.stringContaining("EISDIR") as string,
      },
    ]);
    expect(scan.malformed).toEqual(["evt_malformed000"]);
  });

  // SERVER-063 review round: the file-level skip above landed with a docblock
  // claiming an unlistable *directory* could never get here, because
  // `ensureLayoutSync` would fail on it first. It does not — `mkdirSync(dir,
  // { recursive: true })` succeeds on an existing directory whatever its mode —
  // so the listing threw straight out of the constructor, which is the same
  // "server exited during startup" this scan exists to prevent.
  it("skips a status directory it cannot list, and keeps scanning the others", async () => {
    await store.writeEvent("pending", event("evt_pending00000"));
    await store.writeEvent("processed", event("evt_processed000"));
    // Real, and unlistable for every user including root: `readdirSync` on a
    // path that is not a directory is `ENOTDIR` for everyone. (The failure this
    // was reported as — a `chmod 000` directory — is `EACCES`, which root
    // bypasses; the next test pins that shape at the store's seam instead.)
    rmSync(store.dirFor("processed"), { recursive: true });
    writeFileSync(store.dirFor("processed"), "not a directory\n");

    const scan = scanQueueSync(store);

    expect(scan.unlistable).toEqual([
      { status: "processed", reason: expect.stringContaining("ENOTDIR") as string },
    ]);
    // Losing one status is not a reason to stop reporting the others, and the
    // events inside the lost one are excluded rather than counted as something
    // they are not: `processed` is simply absent from the mirror.
    expect(scan.events.map((each) => [each.id, each.status])).toEqual([
      ["evt_pending00000", "pending"],
    ]);
    expect(scan.malformed).toEqual([]);
    expect(scan.unreadable).toEqual([]);
  });

  it("skips a status directory the filesystem refuses to list, whatever the reason", async () => {
    await store.writeEvent("in-progress", { ...event("evt_inprogress00"), status: "in-progress" });
    // The reported failure, at the seam it arrives through: `chmod 000` on a
    // status directory. It cannot be produced from a test that may run as root,
    // so the store is asked to throw exactly what the filesystem throws — the
    // store stays honest, the reader decides the policy.
    const refusing = new RefusingStore(join(root, ".corpus"), "pending");

    const scan = scanQueueSync(refusing);

    expect(scan.unlistable).toEqual([
      { status: "pending", reason: expect.stringContaining("EACCES") as string },
    ]);
    expect(scan.events.map((each) => each.id)).toEqual(["evt_inprogress00"]);
  });

  it("reports nothing skipped when every file reads", async () => {
    await store.writeEvent("pending", event("evt_pending00000"));

    expect(scanQueueSync(store)).toMatchObject({
      malformed: [],
      unreadable: [],
      unlistable: [],
    });
  });
});
