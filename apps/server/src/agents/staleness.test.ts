// **When the roster goes stale, and whether the frame said so** (SERVER-115).
//
// SPEC.md §7 makes who is running *"a read, never a push"*: what reaches a
// client is the name of a key it should ask again on, so a reader whose key is
// never named never learns. The UI caches with `staleTime: Infinity` and
// refetches on neither focus nor reconnect, which means an unnamed key is stale
// until something unrelated happens to invalidate it — there is no poll to fall
// back on.
//
// A lane row is **computed at read time and never stored**, so the roster moves
// on writes named after other resources: a queue transition, a job-log append, a
// designated conversation being retitled or deleted, an agent-def being renamed.
// SERVER-114 fixed one such emitter; this suite is the invariant that would have
// caught the whole family, stated the way SERVER-020 states the tree's:
//
//   **every frame reporting a mutation carries `["agents"]` exactly when
//   `GET /api/agents`'s response changed.**
//
// {@link observe} asserts both halves of that at once — it drives the real route
// against a real workspace, records what the server's own bus actually
// broadcast, and reads the roster before and after. The "exactly when" is what
// makes it more than a blanket addition: a test that only checked the key was
// present would pass a server that named it on every save of every note.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import {
  AUTH,
  createDoc,
  createThread,
  createThreadWorkspace,
  type WriteWorkspace,
} from "../threads/thread-fixture.js";

/**
 * The bindings `@hono/node-server` supplies: `POST /api/jobs/{id}/log` is the
 * tokenless hook path, guarded by the peer's address.
 */
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("roster-staleness");
  ws.write(
    ".claude/agents/researcher.md",
    "---\nid: doc_researcher\nname: researcher\ndescription: digs things up\n---\nBody.\n",
  );
  ws.reproject();
});

afterEach(() => {
  ws.close();
});

/** The roster exactly as a client would hold it, bytes and all. */
const rosterBody = async (): Promise<string> => {
  const response = await ws.request("/api/agents");
  expect(response.status).toBe(200);
  return response.text();
};

interface Observation {
  /** Every frame the server's own bus broadcast, in order, whole key lists. */
  readonly frames: QueryKey[][];
  /** Whether `GET /api/agents` answers differently than it did before. */
  readonly rosterMoved: boolean;
  /** Whether any frame named the roster. */
  readonly namedAgents: boolean;
}

/**
 * Runs an action against the real server and reports what it broadcast next to
 * what it actually changed.
 *
 * Subscribed to `server.bus` rather than to `GET /events`: the bus is the single
 * in-process emitter every write path publishes on and the SSE hub is one of its
 * subscribers, so this sees precisely the frames a connected browser would,
 * without a socket in the test.
 */
async function observe(action: () => Promise<void>): Promise<Observation> {
  const before = await rosterBody();
  const frames: QueryKey[][] = [];
  const unsubscribe = ws.server.bus.subscribe((keys) => frames.push([...keys]));
  try {
    await action();
  } finally {
    unsubscribe();
  }
  const after = await rosterBody();
  return {
    frames,
    rosterMoved: before !== after,
    namedAgents: frames.some((frame) => frame.some((key) => JSON.stringify(key) === '["agents"]')),
  };
}

/** The invariant itself, asserted on every case below. */
const expectLawful = (observation: Observation): void => {
  expect(observation.namedAgents).toBe(observation.rosterMoved);
};

/** A designated standalone thread, which is what makes a lane. */
async function designatedThread(body: string, title?: string): Promise<string> {
  const created = await createThread(ws, { body, ...(title === undefined ? {} : { title }) });
  expect(
    (await ws.post(`/api/threads/${created.id}/resident`, { name: "researcher" })).status,
  ).toBe(200);
  return created.id;
}

/** Enqueues work on a lane by mentioning the agent in a turn on its thread. */
async function enqueueOn(threadId: string): Promise<void> {
  const response = await ws.post(`/api/threads/${threadId}/turns`, {
    body: "@agent please look at this.",
  });
  expect(response.status).toBe(201);
}

/** The event a lane's claim just handed over. */
async function claimOne(lane: string): Promise<string> {
  const response = await ws.post(`/api/queue/claim-all?scope=${lane}`, {});
  expect(response.status).toBe(200);
  const claimed = (await response.json()) as { events: { id: string }[] };
  const first = claimed.events[0];
  if (first === undefined) throw new Error(`nothing claimable on ${lane}`);
  return first.id;
}

describe("a queue transition and the roster", () => {
  /**
   * The reproduction, as a test. Before the fix this frame was
   * `[["queue"],["jobs"],["docs"]]` while the lane's summary moved from `null`
   * to `working <title>` — measured on a real server, and measured through a
   * real browser by UI-108, which watched a claim change the roster and saw the
   * page issue no second `/api/agents` request in the six seconds that followed.
   */
  it("names the roster when a claim gives a lane work to report", async () => {
    const id = await designatedThread("let us review the claims", "Claims review");
    await enqueueOn(id);
    ws.advance(61_000);

    const observed = await observe(async () => {
      await claimOne(id);
    });

    expect(observed.frames).toEqual([[["queue"], ["jobs"], ["docs"], ["agents"]]]);
    expect(observed.rosterMoved).toBe(true);
    expectLawful(observed);
    expect(await rosterBody()).toContain("working Claims review");
  });

  it("names it again when the work is settled and the lane falls quiet", async () => {
    const id = await designatedThread("settle me");
    await enqueueOn(id);
    const eventId = await claimOne(id);
    ws.advance(61_000);

    const observed = await observe(async () => {
      expect((await ws.post(`/api/queue/${eventId}/complete`, {})).status).toBe(200);
    });

    expect(observed.frames).toEqual([[["queue"], ["jobs"], ["docs"], ["agents"]]]);
    expectLawful(observed);
  });

  /**
   * The other half of the acceptance criterion: an enqueue is a queue frame that
   * must **not** name the roster. A lane reports the work it is *holding*, and
   * nobody is holding a `pending` event — so adding `["agents"]` to every queue
   * frame would send every open client to refetch a response that cannot have
   * moved. Falsified rather than assumed: the roster body is compared.
   */
  it("does not name it for an enqueue, which leaves the event unheld", async () => {
    const id = await designatedThread("nothing claimed yet");
    ws.advance(61_000);

    const observed = await observe(async () => {
      await enqueueOn(id);
    });

    expect(observed.frames).toContainEqual([["queue"], ["jobs"], ["docs"]]);
    expect(observed.rosterMoved).toBe(false);
    expectLawful(observed);
  });

  /**
   * `halt`/`resume` was left to this issue to decide, and the decision is *no*:
   * a halt writes a sentinel, not an event. It moves no `events` row and no
   * `jobs` row, and the roster reads neither the sentinel nor anything derived
   * from it — a resident holding work is still holding it. What a halt changes
   * is `QueueStatus.halted`, which is `["queue"]`, and the frame says exactly
   * that.
   */
  it("does not name it for halt or resume, which move no event at all", async () => {
    const id = await designatedThread("halted world");
    await enqueueOn(id);
    await claimOne(id);
    ws.advance(61_000);

    const halted = await observe(async () => {
      expect((await ws.post("/api/queue/halt", { reason: "maintenance" })).status).toBe(200);
    });
    expect(halted.frames).toEqual([[["queue"], ["jobs"], ["docs"]]]);
    expect(halted.rosterMoved).toBe(false);
    expectLawful(halted);

    const resumed = await observe(async () => {
      expect((await ws.post("/api/queue/resume", {})).status).toBe(200);
    });
    expect(resumed.frames).toEqual([[["queue"], ["jobs"], ["docs"]]]);
    expect(resumed.rosterMoved).toBe(false);
    expectLawful(resumed);
  });
});

describe("a document write and the roster", () => {
  it("names the roster when a designated conversation is retitled", async () => {
    const id = await designatedThread("first body", "First title");
    ws.advance(61_000);

    const observed = await observe(async () => {
      expect((await ws.put(`/api/docs/${id}`, { title: "Renamed while resident" })).status).toBe(
        200,
      );
    });

    expect(observed.frames).toEqual([[["docs"], ["docs", id], ["agents"]]]);
    expect(observed.rosterMoved).toBe(true);
    expectLawful(observed);
    expect(await rosterBody()).toContain("Renamed while resident");
  });

  it("names it when the designated conversation is deleted and its lane goes", async () => {
    const id = await designatedThread("doomed");
    ws.advance(61_000);

    const observed = await observe(async () => {
      expect((await ws.del(`/api/docs/${id}`)).status).toBe(200);
    });

    expect(observed.frames).toEqual([[["docs"], ["docs", id], ["threads", id], ["agents"]]]);
    expect(observed.rosterMoved).toBe(true);
    expectLawful(observed);
  });

  /**
   * The measurement's whole point. A note is retitled with a designated lane
   * standing right beside it, and the frame stays exactly what it was — a
   * blanket `["agents"]` on every mutation is a different defect, not this fix.
   */
  it("leaves an unrelated document's frame alone", async () => {
    await designatedThread("a lane that is watching");
    const doc = await createDoc(ws, {
      type: "note",
      title: "Unrelated note",
      body: "Nothing to do with it.",
    });
    ws.advance(61_000);

    const observed = await observe(async () => {
      expect((await ws.put(`/api/docs/${doc.id}`, { title: "Still unrelated" })).status).toBe(200);
    });

    expect(observed.frames).toEqual([[["docs"], ["docs", doc.id]]]);
    expect(observed.rosterMoved).toBe(false);
    expectLawful(observed);
  });

  /**
   * A turn is the highest-frequency write in the system and it changes no row
   * the roster reads — the lane's title, resident and held work are all where
   * they were. The enqueue that rides along with the mention is a separate
   * frame, and is checked above.
   */
  it("leaves a turn on the designated conversation alone", async () => {
    const id = await designatedThread("chatty");
    ws.advance(61_000);

    const observed = await observe(async () => {
      expect((await ws.post(`/api/threads/${id}/turns`, { body: "no mention here" })).status).toBe(
        201,
      );
    });

    expect(observed.frames).toEqual([[["docs"], ["docs", id], ["threads", id]]]);
    expect(observed.rosterMoved).toBe(false);
    expectLawful(observed);
  });

  /**
   * Designation and release already named the roster before this issue
   * (`threads/resident.ts`), and the measurement agrees with them rather than
   * doubling them — `dedupeKeys` sees one `["agents"]` either way.
   */
  it("names it once when a resident is released", async () => {
    const id = await designatedThread("released");
    ws.advance(61_000);

    const observed = await observe(async () => {
      expect((await ws.del(`/api/threads/${id}/resident`)).status).toBe(200);
    });

    expect(observed.frames).toEqual([[["docs"], ["docs", id], ["threads", id], ["agents"]]]);
    expect(observed.rosterMoved).toBe(true);
    expectLawful(observed);
  });
});

describe("a job-log append and the roster", () => {
  /**
   * The append itself deliberately broadcasts nothing — the watcher tails
   * `.corpus/jobs/` and its debounce is what keeps a chatty job from becoming a
   * frame per line (`jobs/service.ts`). So the *frame* for this is the watcher's
   * and is asserted in `watcher/watcher.test.ts`; what belongs here is the fact
   * that makes naming the roster necessary at all: the line the job wrote is
   * what the lane now reports.
   */
  it("changes what the lane reports, which is why the watcher names it", async () => {
    const id = await designatedThread("logging");
    await enqueueOn(id);
    const eventId = await claimOne(id);

    const response = await ws.server.app.request(
      `/api/jobs/${eventId}/log`,
      {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ line: "reading the claims table" }),
      },
      LOOPBACK,
    );
    expect(response.status).toBe(201);

    expect(await rosterBody()).toContain("reading the claims table");
  });
});
