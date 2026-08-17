// SPEC.md §7's roster (SERVER-112): `GET /api/agents` — every lane, who is
// resident on it, and whether anybody is listening.
//
// Driven through the real route against a real workspace, real files and the
// real projection, for the reason the thread suites are: a lane exists because a
// designation was written to a file and projected, and liveness exists because
// the server is holding an `idle` request open. Neither is observable against a
// stub of the other.

import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRosterSchema, LANE_SUMMARY_MAX_LENGTH, type AgentLane } from "@corpus/contract";
import {
  AUTH,
  createThread,
  createThreadWorkspace,
  type WriteWorkspace,
} from "../threads/thread-fixture.js";
import { LANE_GRACE_MS } from "../queue/liveness.js";
import { capSummary, relativeAge } from "./roster.js";

/**
 * The bindings `@hono/node-server` supplies, which `Hono#request` takes as its
 * third argument: `POST /api/jobs/{id}/log` is the tokenless hook path and is
 * guarded by the peer's address, so a test that wants to write a job log line
 * has to look like a loopback caller.
 */
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("roster");
  ws.write(
    ".claude/agents/researcher.md",
    "---\nid: doc_researcher\nname: researcher\ndescription: digs things up\n---\nBody.\n",
  );
  ws.reproject();
});

afterEach(() => {
  ws.close();
});

const roster = async (): Promise<AgentLane[]> => {
  const response = await ws.request("/api/agents");
  expect(response.status).toBe(200);
  const parsed = AgentRosterSchema.safeParse(await response.json());
  expect(parsed.success).toBe(true);
  return parsed.success ? parsed.data.agents : [];
};

const laneRow = async (lane: string): Promise<AgentLane> => {
  const row = (await roster()).find((entry) => entry.lane === lane);
  if (row === undefined) throw new Error(`no roster row for ${lane}`);
  return row;
};

/** A designated standalone thread, which is what makes a lane. */
async function designatedThread(body: string): Promise<string> {
  const created = await createThread(ws, { body });
  expect(
    (await ws.post(`/api/threads/${created.id}/resident`, { name: "researcher" })).status,
  ).toBe(200);
  return created.id;
}

/**
 * Parks a scoped `idle` and hands back the abort that ends it — the only way to
 * become present, and the only way to stop being.
 */
function park(scope?: string): { done: Promise<Response>; leave: () => void } {
  const controller = new AbortController();
  const query = scope === undefined ? "" : `&scope=${scope}`;
  const done = ws.request(`/api/queue/idle?timeout=60${query}`, {
    headers: AUTH,
    signal: controller.signal,
  });
  return {
    done: done.catch(() => new Response(null, { status: 499 })),
    leave: () => {
      controller.abort();
    },
  };
}

/** The park has to reach the handler before the roster is read. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50));
};

/** One line on a job's log, through the loopback hook path the guard expects. */
const logLine = async (eventId: string, line: string): Promise<Response> =>
  ws.server.app.request(
    `/api/jobs/${eventId}/log`,
    {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ line }),
    },
    LOOPBACK,
  );

/** The event a lane's claim just handed over. */
async function claimOne(lane: string): Promise<string> {
  const response = await ws.post(`/api/queue/claim-all?scope=${lane}`, {});
  expect(response.status).toBe(200);
  const claimed = (await response.json()) as { events: { id: string }[] };
  const first = claimed.events[0];
  if (first === undefined) throw new Error(`nothing claimable on ${lane}`);
  return first.id;
}

describe("the shape of the roster", () => {
  it("always carries the orchestrator's row, before anything is designated", async () => {
    const rows = await roster();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      lane: "orchestrator",
      resident: null,
      live: false,
      since: null,
      summary: null,
      origin: null,
    });
  });

  it("is behind the bearer guard like every other /api read", async () => {
    expect((await ws.request("/api/agents", { headers: {} })).status).toBe(401);
  });

  it("adds one row per designated thread, naming the conversation and its resident", async () => {
    const id = await designatedThread("let us talk about the archive");
    const rows = await roster();

    expect(rows.map((row) => row.lane)).toEqual(["orchestrator", id]);
    expect(rows[1]).toMatchObject({
      lane: id,
      resident: { name: "researcher", docId: "doc_researcher" },
      live: false,
      since: null,
      origin: { id, title: "let us talk about the archive" },
    });
  });

  it("drops the row when the resident is released, and the orchestrator's stays", async () => {
    const id = await designatedThread("temporary");
    expect((await roster()).map((row) => row.lane)).toEqual(["orchestrator", id]);

    expect((await ws.del(`/api/threads/${id}/resident`)).status).toBe(200);
    expect((await roster()).map((row) => row.lane)).toEqual(["orchestrator"]);
  });

  it("names the conversation as it now stands, not as it was designated", async () => {
    const id = await designatedThread("first title");
    ws.advance(61_000);
    expect((await ws.put(`/api/docs/${id}`, { title: "renamed while resident" })).status).toBe(200);

    expect((await laneRow(id)).origin).toEqual({ id, title: "renamed while resident" });
  });

  it("still names the resident after its agent-def is deleted", async () => {
    const id = await designatedThread("archive");
    // §7's designation survives its persona going missing: the name is the
    // durable half, and showing it is how a person sees *who* was designated
    // rather than a blank. Handling the gone persona is the converse skill's
    // job, not the roster's.
    rmSync(join(ws.root, ".claude/agents/researcher.md"));
    ws.reproject();

    expect((await laneRow(id)).resident).toEqual({ name: "researcher", docId: "doc_researcher" });
  });
});

describe("liveness on the roster", () => {
  it("flips live while a scoped idle is parked, and records when", async () => {
    const id = await designatedThread("live one");
    const parked = park(id);
    await settle();

    const row = await laneRow(id);
    expect(row.live).toBe(true);
    expect(row.since).not.toBeNull();
    // The orchestrator's row is untouched: presence is per lane.
    expect((await laneRow("orchestrator")).live).toBe(false);

    parked.leave();
    await parked.done;
  });

  it("stays live inside the grace window after the park ends, and lapses past it", async () => {
    const id = await designatedThread("comes and goes");
    const parked = park(id);
    await settle();
    parked.leave();
    await parked.done;

    ws.advance(LANE_GRACE_MS - 1_000);
    expect((await laneRow(id)).live).toBe(true);

    ws.advance(2_000);
    const lapsed = await laneRow(id);
    expect(lapsed.live).toBe(false);
    // The evidence survives the verdict: the row still says when it was heard
    // from, which is what a lane waiting to be picked up looks like.
    expect(lapsed.since).not.toBeNull();
  });

  it("reports the orchestrator's own lane from an unscoped park", async () => {
    const parked = park();
    await settle();

    expect((await laneRow("orchestrator")).live).toBe(true);

    parked.leave();
    await parked.done;
  });
});

describe("the summary line", () => {
  it("says when a quiet lane was last heard from", async () => {
    const id = await designatedThread("quiet");
    const parked = park(id);
    await settle();
    parked.leave();
    await parked.done;

    ws.advance(300_000);
    expect((await laneRow(id)).summary).toBe("idle — last active 5m ago");
  });

  it("says what the work is about once the lane holds an event", async () => {
    const id = await designatedThread("about the mortgage");
    // A turn on the thread enqueues on its own lane, and claiming it is what
    // makes the lane hold work.
    expect(
      (await ws.post(`/api/threads/${id}/turns`, { body: "@agent please read this" })).status,
    ).toBe(201);
    await claimOne(id);

    expect((await laneRow(id)).summary).toBe("working about the mortgage");
  });

  it("prefers what the job itself said over anything derived", async () => {
    const id = await designatedThread("about the mortgage");
    expect(
      (await ws.post(`/api/threads/${id}/turns`, { body: "@agent please read this" })).status,
    ).toBe(201);
    const eventId = await claimOne(id);
    expect((await logLine(eventId, "reading the mortgage docs")).status).toBe(201);

    expect((await laneRow(id)).summary).toBe("reading the mortgage docs");
  });

  it("says nothing about a lane with no work and no history", async () => {
    const id = await designatedThread("never started");
    expect((await laneRow(id)).summary).toBeNull();
  });
});

describe("summary rendering", () => {
  it("reads an age in the largest unit that still says something", () => {
    expect(relativeAge(0)).toBe("just now");
    expect(relativeAge(59_999)).toBe("just now");
    expect(relativeAge(60_000)).toBe("1m ago");
    expect(relativeAge(59 * 60_000)).toBe("59m ago");
    expect(relativeAge(60 * 60_000)).toBe("1h ago");
    expect(relativeAge(47 * 60 * 60_000)).toBe("1d ago");
  });

  it("cuts to the contract's bound, measured the way the schema measures it", () => {
    const long = "x".repeat(LANE_SUMMARY_MAX_LENGTH + 50);
    expect(capSummary(long)).toHaveLength(LANE_SUMMARY_MAX_LENGTH);
    expect(capSummary("short")).toBe("short");
    // An astral character straddling the cut would leave a lone surrogate, which
    // no reader can render; the cut drops it rather than emitting it.
    const astral = `${"y".repeat(LANE_SUMMARY_MAX_LENGTH - 1)}😀tail`;
    const capped = capSummary(astral);
    expect(capped).toHaveLength(LANE_SUMMARY_MAX_LENGTH - 1);
    expect(capped.endsWith("y")).toBe(true);
  });

  it("caps a job's own line, however much it says", async () => {
    const id = await designatedThread("chatty");
    expect((await ws.post(`/api/threads/${id}/turns`, { body: "@agent go" })).status).toBe(201);
    const eventId = await claimOne(id);
    expect((await logLine(eventId, "z".repeat(400))).status).toBe(201);

    expect((await laneRow(id)).summary).toHaveLength(LANE_SUMMARY_MAX_LENGTH);
  });
});

// SPEC.md §7's fallback, end to end and in both directions: while a lane is
// live the orchestrator's unscoped claim never sees its events; once it has
// lapsed it does; and a resident that comes back finds its lane exactly as it
// left it, because nothing about the lapse was written into an event.
describe("the fallback a lapse creates", () => {
  /** One `comment.created` on `lane`, stamped by the walk. */
  async function workOn(lane: string): Promise<void> {
    expect(
      (await ws.post(`/api/threads/${lane}/turns`, { body: "@agent please look" })).status,
    ).toBe(201);
  }

  const claimed = async (scope?: string): Promise<string[]> => {
    const query = scope === undefined ? "" : `?scope=${scope}`;
    const response = await ws.post(`/api/queue/claim-all${query}`, {});
    expect(response.status).toBe(200);
    return ((await response.json()) as { events: { id: string }[] }).events.map(
      (event) => event.id,
    );
  };

  it("hides a live lane's work from the orchestrator and hands it over once lapsed", async () => {
    const id = await designatedThread("the resident's own conversation");
    // A designation announces itself on the *orchestrator's* lane whoever is
    // designated (§7's carve-out), so that event is the orchestrator's and has
    // to be off the board before this measures the partition.
    expect(await claimed()).toHaveLength(1);
    const parked = park(id);
    await settle();
    await workOn(id);

    // Live: the unscoped claim sees nothing of it. Two agents at once are
    // reading disjoint sets.
    expect(await claimed()).toEqual([]);

    parked.leave();
    await parked.done;
    // Inside the grace window a rearm is still a rearm, not a departure.
    ws.advance(LANE_GRACE_MS - 1_000);
    expect(await claimed()).toEqual([]);

    ws.advance(2_000);
    expect(await claimed()).toHaveLength(1);
  });

  it("leaves the lane exactly as it was, so a resident that comes back sees its own work", async () => {
    const id = await designatedThread("interrupted");
    expect(await claimed()).toHaveLength(1);
    await workOn(id);
    ws.advance(LANE_GRACE_MS * 2);

    // Lapsed, so the orchestrator could have taken it — but it did not, and the
    // fallback was never written down.
    const back = park(id);
    await settle();
    expect(await claimed()).toEqual([]);
    expect(await claimed(id)).toHaveLength(1);

    back.leave();
    await back.done;
  });
});

// §7: "who is running is a read, never a push". Every transition announces the
// key and nothing else; the roster arrives over HTTP.
describe("what a presence change announces", () => {
  const framesDuring = async (run: () => Promise<unknown>): Promise<string[][]> => {
    const frames: string[][] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) =>
      frames.push(keys.map((key) => JSON.stringify(key))),
    );
    try {
      await run();
    } finally {
      unsubscribe();
    }
    return frames;
  };

  it("names the roster's key on the park and on the release, and carries no data", async () => {
    const id = await designatedThread("announced");

    const frames = await framesDuring(async () => {
      const parked = park(id);
      await settle();
      parked.leave();
      await parked.done;
      await settle();
    });

    const announced = frames.flat().filter((key) => key === '["agents"]');
    expect(announced.length).toBeGreaterThanOrEqual(2);
  });
});

// CONTRACT-045: `QueueStatus.agent` is this same observation aggregated over
// every lane, so the console strip and the recipient picker cannot disagree.
describe("the queue status's aggregate", () => {
  const agentOf = async (): Promise<{ live: boolean; since: string | null }> => {
    const response = await ws.request("/api/queue/status", { headers: AUTH });
    expect(response.status).toBe(200);
    return ((await response.json()) as { agent: { live: boolean; since: string | null } }).agent;
  };

  it("says nobody is there until something parks, then agrees with the roster", async () => {
    const id = await designatedThread("aggregated");
    expect(await agentOf()).toEqual({ live: false, since: null });

    const parked = park(id);
    await settle();
    const status = await agentOf();
    const row = await laneRow(id);
    expect(status.live).toBe(true);
    expect(row.live).toBe(true);
    expect(status.since).toBe(row.since);

    parked.leave();
    await parked.done;
    ws.advance(LANE_GRACE_MS + 1);
    // The verdict expires with the lane's; the evidence behind it does not.
    const after = await agentOf();
    expect(after.live).toBe(false);
    expect(after.since).not.toBeNull();
  });
});
