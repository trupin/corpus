// SERVER-069 — the stated weight's whole journey, against the real app: from a
// request body, onto the queue event's payload, and into the job's log
// (SPEC.md §7, rider signed 2026-08-06; CONTRACT-039).
//
// Driven end to end rather than through the payload builder alone, because what
// this issue promises is a *journey*: every composer that can reach the agent
// carries the weight, in both media types, and every one of them is a place a
// field is silently dropped. Reading the event file and the log through the real
// server is the only way that claim is checked rather than asserted.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STATED_WEIGHT_PREFIX } from "../jobs/index.js";
import {
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  pendingEvents,
  postForm,
  type WriteWorkspace,
} from "./thread-fixture.js";

let ws: WriteWorkspace | undefined;

afterEach(() => {
  ws?.close();
  ws = undefined;
});

const open = (name: string): WriteWorkspace => {
  ws = createThreadWorkspace(name);
  return ws;
};

/**
 * The `comment.created` payload, straight off disk.
 *
 * **Named by type rather than taken as "the only one"** (SERVER-160). A
 * standalone creation that asks for the agent now enqueues two events: the
 * `resident.designated` that asks the orchestrator to launch a listener for the
 * new lane, and the message itself. Both are real, and this file is about the
 * second.
 */
function onlyPayload(workspace: WriteWorkspace): Record<string, unknown> {
  const events = pendingEvents(workspace).map(
    (file) =>
      JSON.parse(
        readFileSync(join(workspace.root, ".corpus", "queue", "pending", file), "utf8"),
      ) as { type: string; payload: Record<string, unknown> },
  );
  const comments = events.filter((event) => event.type === "comment.created");
  expect(comments).toHaveLength(1);
  return comments[0]?.payload ?? {};
}

/**
 * The loopback peer `POST /api/jobs/{id}/log` demands. The ingest endpoint is
 * the one unauthenticated mutating route and is hardened as a log sink, so a
 * test appending an orchestrator's dispatch line has to arrive as one.
 */
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

/** One line appended the way `corpus job log` appends it. */
async function appendLogLine(
  workspace: WriteWorkspace,
  eventId: string,
  line: string,
): Promise<void> {
  const response = await workspace.server.app.request(
    `/api/jobs/${eventId}/log`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workspace.server.config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ line }),
    },
    LOOPBACK,
  );
  expect(response.status).toBe(201);
}

/** A job's log lines, read the way the console reads them. */
async function logLines(workspace: WriteWorkspace, eventId: string): Promise<string[]> {
  const response = await workspace.request(`/api/jobs/${eventId}/log?cursor=0`, {
    headers: { Authorization: `Bearer ${workspace.server.config.token}` },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { lines: { ts: string; line: string }[] };
  return body.lines.map((entry) => entry.line);
}

describe("a stated weight rides the request to the queue event", () => {
  it("carries the level verbatim from `POST /api/threads`, whatever the workspace calls it", async () => {
    const workspace = open("weight-create");
    // Not a level this repository's shipped guidance defines: §2.4 lets a
    // workspace edit its own tier table, and a server that only accepted the
    // shipped names would reject that workspace's own vocabulary. The point of
    // the test is that nothing looks at the string.
    const created = await createThread(workspace, {
      body: "@agent take a look",
      weight: "Deliberative — two readers",
    });

    expect(created.eventId).not.toBeNull();
    expect(onlyPayload(workspace)["weight"]).toBe("Deliberative — two readers");
  });

  it("leaves the key off entirely when the request stated no weight", async () => {
    const workspace = open("weight-absent");
    await createThread(workspace, { body: "@agent take a look" });

    const payload = onlyPayload(workspace);
    // `toBeUndefined()` would pass on a `weight: undefined` key too, and a JSON
    // round trip turns that into the second spelling of "no choice" this
    // feature has exactly one of (§7: absence means the orchestrator decides).
    expect(Object.keys(payload)).not.toContain("weight");
  });

  it("carries it from a turn append, and from the multipart form of the same route", async () => {
    const workspace = open("weight-turn");
    const created = await createThread(workspace, { body: "opening note" });

    const appended = await appendTurn(workspace, created.id, {
      body: "@agent now please",
      weight: "Small and mechanical",
    });
    expect(appended.status).toBe(201);
    expect(onlyPayload(workspace)["weight"]).toBe("Small and mechanical");

    // The same route's other media type. A composer that attaches a file is the
    // same composer, and three of five once shipped without attachments.
    const multipart = await postForm(workspace, `/api/threads/${created.id}/turns`, [
      ["text", "@agent and again"],
      ["weight", "Heavy or judgment-laden"],
    ]);
    expect(multipart.status).toBe(201);
    const second = (await multipart.json()) as { eventId: string };
    const raw = readFileSync(
      join(workspace.root, ".corpus", "queue", "pending", `${second.eventId}.json`),
      "utf8",
    );
    expect((JSON.parse(raw) as { payload: Record<string, unknown> }).payload["weight"]).toBe(
      "Heavy or judgment-laden",
    );
  });

  it("carries it from the multipart form of thread creation", async () => {
    const workspace = open("weight-create-multipart");
    const response = await postForm(workspace, "/api/threads", [
      ["text", "@agent take a look"],
      ["weight", "Small and mechanical"],
    ]);
    expect(response.status).toBe(201);
    expect(onlyPayload(workspace)["weight"]).toBe("Small and mechanical");
  });

  it("carries it from a capture", async () => {
    const workspace = open("weight-capture");
    const response = await postForm(workspace, "/api/capture", [
      ["text", "a thought worth filing"],
      ["weight", "Standard"],
    ]);
    expect(response.status).toBe(201);
    expect(onlyPayload(workspace)["weight"]).toBe("Standard");
  });

  it("refuses a blank weight rather than reading it as no choice", async () => {
    const workspace = open("weight-blank");
    const response = await workspace.post("/api/threads", { body: "@agent hi", weight: "   " });
    expect(response.status).toBe(400);
    expect(pendingEvents(workspace)).toHaveLength(0);
  });

  it("does not reject a weight on a request that enqueues nothing — it simply governs no work", async () => {
    const workspace = open("weight-inert");
    const created = await createThread(workspace, {
      body: "a note to myself",
      requestsAgent: false,
      weight: "Standard",
    });

    expect(created.eventId).toBeNull();
    expect(pendingEvents(workspace)).toHaveLength(0);
  });
});

describe("the job log names the weight the request stated", () => {
  it("writes one server line naming it, before anything the agent appends", async () => {
    const workspace = open("weight-log");
    const created = await createThread(workspace, {
      body: "@agent take a look",
      weight: "Heavy or judgment-laden",
    });
    const eventId = created.eventId ?? "";

    // The orchestrator's own dispatch lines arrive later, through the same
    // endpoint the CLI uses. The server's line has to already be there.
    await appendLogLine(
      workspace,
      eventId,
      "dispatched to a comment-skill subagent (Opus 5 — stated by the request)",
    );

    expect(await logLines(workspace, eventId)).toEqual([
      `${STATED_WEIGHT_PREFIX}Heavy or judgment-laden`,
      "dispatched to a comment-skill subagent (Opus 5 — stated by the request)",
    ]);
  });

  it("holds a dispatch line per stage — the record is the log, not a field", async () => {
    // SHARED-023: one request may run in stages at different weights, and the
    // log shows every one. Nothing here had to be built for that; it is what a
    // per-job append-only file already is, and it is asserted so a later
    // refactor to "the weight this job ran at" fails here instead of making
    // AGENT-018's rule unobservable.
    //
    // The two lines below are AGENT-018's grammar as the skill emits it —
    // a model name, then where the weight came from (`judged, difficulty` ·
    // `judged, consequence` · `stated by the request`). The server stores them
    // and reads nothing out of them: the tier names are the workspace skill's
    // vocabulary and §7 keeps them out of here.
    const workspace = open("weight-stages");
    const created = await createThread(workspace, {
      body: "@agent gather then judge",
      weight: "Heavy or judgment-laden",
    });
    const eventId = created.eventId ?? "";

    for (const line of [
      "dispatched to a research subagent, stage 1 of 2, collecting (Haiku — material for the deciding stage)",
      "dispatched to a comment-skill subagent, stage 2 of 2, deciding (Opus 5 — stated by the request)",
    ]) {
      await appendLogLine(workspace, eventId, line);
    }

    const lines = await logLines(workspace, eventId);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`${STATED_WEIGHT_PREFIX}Heavy or judgment-laden`);
    expect(lines.filter((line) => line.startsWith("dispatched"))).toHaveLength(2);
  });

  it("says nothing at all when the request stated no weight", async () => {
    // Silence is what "the orchestrator decides" looks like everywhere else in
    // this feature; a line announcing the ordinary case on every job would be
    // noise in the surface an operator watches live.
    const workspace = open("weight-log-absent");
    const created = await createThread(workspace, { body: "@agent take a look" });

    expect(await logLines(workspace, created.eventId ?? "")).toEqual([]);
  });

  it("shows the line on the console row too, so a job is not silent until the agent speaks", async () => {
    const workspace = open("weight-row");
    const created = await createThread(workspace, {
      body: "@agent take a look",
      weight: "Standard",
    });

    const response = await workspace.request("/api/jobs?recent=10", {
      headers: { Authorization: `Bearer ${workspace.server.config.token}` },
    });
    const body = (await response.json()) as {
      jobs: { eventId: string; lastLine: string | null }[];
    };
    const row = body.jobs.find((job) => job.eventId === created.eventId);
    expect(row?.lastLine).toBe(`${STATED_WEIGHT_PREFIX}Standard`);
  });

  it("names a weight stated on a capture, on the filing thread's own job", async () => {
    const workspace = open("weight-capture-log");
    const response = await postForm(workspace, "/api/capture", [
      ["text", "a thought worth filing"],
      ["weight", "Small and mechanical"],
    ]);
    const { eventId } = (await response.json()) as { eventId: string };

    expect(await logLines(workspace, eventId)).toEqual([
      `${STATED_WEIGHT_PREFIX}Small and mechanical`,
    ]);
  });

  it("names it on an anchored thread's job, the composer a document reader uses", async () => {
    const workspace = open("weight-anchored");
    const doc = await createDoc(workspace, {
      type: "note",
      title: "Rates",
      body: "The rate is 6.2%.",
    });
    const created = await createThread(workspace, {
      parent: doc.id,
      selector: { exact: "6.2%" },
      body: "@agent check this",
      weight: "Standard",
    });

    expect(await logLines(workspace, created.eventId ?? "")).toEqual([
      `${STATED_WEIGHT_PREFIX}Standard`,
    ]);
  });
});
