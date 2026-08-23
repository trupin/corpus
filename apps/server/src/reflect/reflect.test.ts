// SPEC.md §7's reflection, end to end over the real server: a real workspace, a
// real git repository, the real queue directories and the real projection.
//
// Nothing here is stubbed. What a reflection *is* — an event on the orchestrator's
// lane, a clock that moves when its job lands, a count of what somebody other
// than the agent changed — is only true if the queue, the projection and the
// clock file agree, so every assertion reads one of those three.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import {
  DEFAULT_REFLECT_QUIET_MINUTES,
  ORCHESTRATOR_LANE,
  ReflectAskResultSchema,
  ReflectStatusSchema,
  WORKSPACE_REFLECT_EVENT_TYPE,
  isUnreflected,
} from "@corpus/contract";
import {
  AUTH,
  createDoc,
  createWriteWorkspace,
  type WriteWorkspace,
} from "../docs/write-fixture.js";
import { REFLECT_FILE } from "./clock.js";
import { REFLECT_ASK_SOURCE } from "./service.js";

const REFLECT_PATH = "/api/workspace/reflect";

let ws: WriteWorkspace;

const ask = async (actor?: "user" | "agent") => {
  const response = await ws.post(
    REFLECT_PATH,
    {},
    actor === undefined ? {} : { "x-corpus-author": actor },
  );
  const payload = await response.json();
  expect(response.status).toBe(202);
  return { status: response.status, result: ReflectAskResultSchema.parse(payload) };
};

const status = async () => {
  const response = await ws.request(REFLECT_PATH, { headers: AUTH });
  expect(response.status).toBe(200);
  return ReflectStatusSchema.parse(await response.json());
};

/** Every event file in one status directory, parsed. */
const eventsIn = (state: string): Record<string, unknown>[] => {
  const dir = join(ws.root, ".corpus", "queue", state);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>);
};

const clockFile = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ws.root, ".corpus", REFLECT_FILE), "utf8")) as Record<
    string,
    unknown
  >;

/** Claims everything pending, so a settle verb has an `in-progress` event to move. */
const claimAll = async (): Promise<void> => {
  const response = await ws.post("/api/queue/claim-all", {});
  expect(response.status).toBe(200);
};

const framesDuring = async (work: () => Promise<unknown>): Promise<QueryKey[][]> => {
  const frames: QueryKey[][] = [];
  const off = ws.server.bus.subscribe((keys) => frames.push(keys.map((key) => [...key])));
  await work();
  off();
  return frames;
};

beforeEach(() => {
  ws = createWriteWorkspace("reflect", { sprint: "s137" });
});

afterEach(() => {
  ws.close();
});

describe("POST /api/workspace/reflect — the ask (SPEC.md §7)", () => {
  it("enqueues one `workspace.reflect` carrying the window, on the orchestrator's lane", async () => {
    const { result } = await ask("user");

    expect(result).toEqual({
      eventId: expect.stringMatching(/^evt_/) as string,
      since: null,
      pending: false,
    });

    const pending = eventsIn("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: result.eventId,
      type: WORKSPACE_REFLECT_EVENT_TYPE,
      source: REFLECT_ASK_SOURCE,
      // §7: the event "falls in no scope and takes the orchestrator's lane".
      lane: ORCHESTRATOR_LANE,
      // One timestamp and nothing else; `null` is a corpus never reflected on,
      // and it means *everything*.
      payload: { since: null },
    });
  });

  /**
   * The critical finding of PR #56's review, and the one behaviour this route
   * exists to get right: "an ask while one is pending is answered with the
   * pending one, never doubled" — `202`, never a `409`.
   */
  it("answers a second ask with the pending one instead of doubling it", async () => {
    const first = await ask("user");

    const second = await ask("user");

    expect(second.status).toBe(202);
    expect(second.result).toEqual({
      eventId: first.result.eventId,
      since: null,
      pending: true,
    });
    expect(eventsIn("pending")).toHaveLength(1);
  });

  it("answers a reflection already in progress the same way", async () => {
    const first = await ask("user");
    await claimAll();
    expect(eventsIn("in-progress")).toHaveLength(1);

    const second = await ask("user");

    expect(second.result).toEqual({ eventId: first.result.eventId, since: null, pending: true });
    expect(eventsIn("pending")).toHaveLength(0);
  });

  /**
   * Ten people pressing Reflect in one tick. The check and the enqueue are a
   * read-modify-write, and the queue's own chain does not help — both callers
   * would already have read "nothing pending".
   */
  it("produces one reflection from ten simultaneous asks", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => ask("user")));

    const ids = new Set(results.map((each) => each.result.eventId));
    expect(ids.size).toBe(1);
    expect(results.filter((each) => !each.result.pending)).toHaveLength(1);
    expect(eventsIn("pending")).toHaveLength(1);
  });

  it("records who asked on the job's log", async () => {
    const { result } = await ask("agent");

    const response = await ws.request(`/api/jobs/${result.eventId}/log`, { headers: AUTH });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("reflection asked by agent");
  });

  it("lets a new reflection be asked for once the last one settled", async () => {
    const first = await ask("user");
    await claimAll();
    expect((await ws.post(`/api/queue/${first.result.eventId}/complete`, {})).status).toBe(200);

    const second = await ask("user");

    expect(second.result.pending).toBe(false);
    expect(second.result.eventId).not.toBe(first.result.eventId);
  });
});

describe("GET /api/workspace/reflect — the clock (SPEC.md §7)", () => {
  it("reports a corpus that has never been reflected on", async () => {
    expect(await status()).toEqual({
      reflected: null,
      pending: null,
      changed: 0,
      lastDigest: null,
      quiet: DEFAULT_REFLECT_QUIET_MINUTES,
    });
  });

  it("names the reflection that is going to run", async () => {
    const { result } = await ask("user");

    expect((await status()).pending).toBe(result.eventId);
  });

  describe("`changed`", () => {
    it("counts what a person wrote", async () => {
      await createDoc(ws, { type: "note", title: "Mine", body: "A body.\n" }, "user");
      ws.advance(60_000);
      await createDoc(ws, { type: "note", title: "Also mine", body: "A body.\n" }, "user");

      expect((await status()).changed).toBe(2);
    });

    /**
     * §7's amendment: "the digest and the changelog entries a reflection produces
     * are its output, not new work for it". SERVER-138's `last_actor` is what
     * makes it answerable.
     */
    it("never counts the agent's own writes", async () => {
      await createDoc(ws, { type: "note", title: "Agent wrote this" }, "agent");

      expect((await status()).changed).toBe(0);
    });

    it("counts a document again once a person edits what the agent wrote", async () => {
      const doc = await createDoc(ws, { type: "note", title: "Agent wrote this" }, "agent");
      expect((await status()).changed).toBe(0);
      ws.advance(60_000);

      expect((await ws.put(`/api/docs/${doc.id}`, { title: "A person renamed it" })).status).toBe(
        200,
      );

      expect((await status()).changed).toBe(1);
    });

    /**
     * "An archived document shows on no board, so a mark for it is impossible"
     * (CONTRACT-076, from PR #56's review). It is also the reason an archive
     * alone never starts a reflection.
     */
    it("never counts an archived document", async () => {
      const doc = await createDoc(ws, { type: "note", title: "Filed away" }, "user");
      ws.advance(60_000);

      expect((await ws.post(`/api/docs/${doc.id}/archive`, {})).status).toBe(200);

      expect((await status()).changed).toBe(0);
    });

    /**
     * The count and the marks a board draws are the same rule, so they are held
     * to the same function: `isUnreflected`, applied here to what
     * `GET /api/docs` hands the board.
     */
    it("agrees with the predicate the board marks each row with", async () => {
      await createDoc(ws, { type: "note", title: "Mine" }, "user");
      ws.advance(60_000);
      await createDoc(ws, { type: "note", title: "Theirs" }, "agent");
      ws.advance(60_000);
      const archived = await createDoc(ws, { type: "note", title: "Filed" }, "user");
      expect((await ws.post(`/api/docs/${archived.id}/archive`, {})).status).toBe(200);

      const reported = await status();
      const listed = (await (
        await ws.request("/api/docs?limit=200&includeArchived=true", { headers: AUTH })
      ).json()) as {
        items: { updated: string | null; lastActor: "user" | "agent"; status: string }[];
      };
      const marked = listed.items.filter((row) =>
        isUnreflected(
          { updated: row.updated, lastActor: row.lastActor, status: row.status as "open" },
          reported.reflected,
        ),
      );

      expect(reported.changed).toBe(marked.length);
      expect(reported.changed).toBe(1);
    });
  });

  it("reports the configured window, re-read from the file with no restart", async () => {
    expect((await status()).quiet).toBe(DEFAULT_REFLECT_QUIET_MINUTES);

    writeFileSync(
      join(ws.root, ".corpus", "config.json"),
      JSON.stringify({ version: 1, token: "x".repeat(32), reflect: { quiet: 5 } }),
      "utf8",
    );

    expect((await status()).quiet).toBe(5);
  });

  it("falls back to the window it booted with when the file stops parsing", async () => {
    writeFileSync(join(ws.root, ".corpus", "config.json"), "{ truncated", "utf8");

    expect((await status()).quiet).toBe(DEFAULT_REFLECT_QUIET_MINUTES);
  });
});

describe("the clock moves when a reflection lands (SPEC.md §7)", () => {
  it("writes the processed event's `created` and clears what was changed", async () => {
    await createDoc(ws, { type: "note", title: "Unreflected" }, "user");
    ws.advance(60_000);
    const { result } = await ask("user");
    const created = eventsIn("pending")[0]?.["created"] as string;
    await claimAll();

    expect((await ws.post(`/api/queue/${result.eventId}/complete`, {})).status).toBe(200);

    const after = await status();
    expect(after.reflected).toBe(created);
    expect(after.pending).toBeNull();
    expect(after.changed).toBe(0);
    expect(clockFile()).toMatchObject({ reflected: created });
  });

  // §7: "a failed job leaves the clock where it was, so a retry sees the same
  // window". The same is true of abandoning and of deferring.
  it("leaves the clock alone when the job fails", async () => {
    await createDoc(ws, { type: "note", title: "Unreflected" }, "user");
    ws.advance(60_000);
    const { result } = await ask("user");
    await claimAll();

    expect(
      (await ws.post(`/api/queue/${result.eventId}/fail`, { reason: "no model" })).status,
    ).toBe(200);

    const after = await status();
    expect(after.reflected).toBeNull();
    expect(after.changed).toBe(1);
    expect(existsSync(join(ws.root, ".corpus", REFLECT_FILE))).toBe(false);
  });

  it("leaves the clock alone when the job is abandoned", async () => {
    const { result } = await ask("user");
    await claimAll();

    expect((await ws.del(`/api/queue/${result.eventId}`)).status).toBe(200);

    expect((await status()).reflected).toBeNull();
  });

  it("keeps the same window on a retried event", async () => {
    const first = await ask("user");
    await claimAll();
    expect((await ws.post(`/api/queue/${first.result.eventId}/complete`, {})).status).toBe(200);
    const reflected = (await status()).reflected;

    ws.advance(60_000);
    await createDoc(ws, { type: "note", title: "After the reflection" }, "user");
    ws.advance(60_000);
    const second = await ask("user");
    const since = eventsIn("pending")[0]?.["payload"] as { since: string | null };
    expect(since.since).toBe(reflected);
    await claimAll();
    expect(
      (await ws.post(`/api/queue/${second.result.eventId}/fail`, { reason: "crashed" })).status,
    ).toBe(200);

    expect((await ws.post(`/api/jobs/${second.result.eventId}/retry`, {})).status).toBe(200);

    const retried = eventsIn("pending")[0]?.["payload"] as { since: string | null };
    expect(retried.since).toBe(reflected);
  });

  /**
   * The clock is server state (§4: `.corpus/` is derived and local), so it is
   * gitignored and makes no commit — the digest thread is what git holds.
   */
  it("makes no commit of its own", async () => {
    const before = ws.head();
    const { result } = await ask("user");
    await claimAll();
    await ws.post(`/api/queue/${result.eventId}/complete`, {});

    expect(ws.head()).toBe(before);
    expect(ws.git("status", "--porcelain")).toBe("");
  });
});

describe("the digest thread (SPEC.md §7)", () => {
  const createThread = async (
    body: Record<string, unknown>,
    actor: "user" | "agent" = "agent",
  ): Promise<string> => {
    const response = await ws.post("/api/threads", body, { "x-corpus-author": actor });
    const payload = (await response.json()) as { thread?: { id: string } };
    expect(response.status).toBe(201);
    return payload.thread?.id ?? "";
  };

  it("reports the standalone thread the landed reflection posted", async () => {
    const { result } = await ask("user");
    await claimAll();
    const digest = await createThread({ body: "since … until …", job: result.eventId });

    // Not yet: the reflection has not landed, so the clock and the digest still
    // describe the reflection before this one.
    expect((await status()).lastDigest).toBeNull();

    expect((await ws.post(`/api/queue/${result.eventId}/complete`, {})).status).toBe(200);

    expect((await status()).lastDigest).toBe(digest);
  });

  it("keeps the previous digest when a reflection posted none", async () => {
    const first = await ask("user");
    await claimAll();
    const digest = await createThread({ body: "the first digest", job: first.result.eventId });
    await ws.post(`/api/queue/${first.result.eventId}/complete`, {});
    ws.advance(60_000);

    const second = await ask("user");
    await claimAll();
    await ws.post(`/api/queue/${second.result.eventId}/complete`, {});

    expect((await status()).lastDigest).toBe(digest);
  });

  // A thread on a document is a comment the reflection left, not the digest of
  // it. §7 says "one **standalone** thread per reflection".
  it("never takes a parented thread for the digest", async () => {
    const doc = await createDoc(ws, { type: "note", title: "Reviewed", body: "A body.\n" });
    const { result } = await ask("user");
    await claimAll();
    await createThread({
      parent: doc.id,
      selector: { exact: "A body." },
      body: "a note on this",
      job: result.eventId,
    });

    await ws.post(`/api/queue/${result.eventId}/complete`, {});

    expect((await status()).lastDigest).toBeNull();
  });

  it("ignores a thread created against a job that is not a reflection", async () => {
    const doc = await createDoc(ws, { type: "note", title: "Reviewed", body: "A body.\n" });
    const comment = await createThread({
      parent: doc.id,
      selector: { exact: "A body." },
      body: "@agent look",
      job: undefined,
    });
    expect(comment).not.toBe("");
    const pending = eventsIn("pending");
    const commentEvent = pending.find((event) => event["type"] === "comment.created") as {
      id: string;
    };
    const { result } = await ask("user");
    await claimAll();
    await createThread({ body: "not a digest", job: commentEvent.id });

    await ws.post(`/api/queue/${result.eventId}/complete`, {});

    expect((await status()).lastDigest).toBeNull();
  });

  it("does not report a digest whose thread was deleted", async () => {
    const { result } = await ask("user");
    await claimAll();
    const digest = await createThread({ body: "the digest", job: result.eventId });
    await ws.post(`/api/queue/${result.eventId}/complete`, {});
    expect((await status()).lastDigest).toBe(digest);

    expect((await ws.del(`/api/docs/${digest}`)).status).toBe(200);

    expect((await status()).lastDigest).toBeNull();
  });
});

describe("what a reflection makes stale (SPEC.md §2.2 rule 3)", () => {
  it("names the reflection key when the event goes on the queue", async () => {
    const frames = await framesDuring(() => ask("user"));

    expect(frames.map((frame) => frame.map((key) => JSON.stringify(key)))).toContainEqual(
      expect.arrayContaining(['["reflect"]']) as string[],
    );
  });

  /**
   * Read-your-write, the reason the settlement observer runs *before* the
   * transition is announced: a client refetching on the frame that says the
   * clock changed must not read the clock from before it.
   */
  it("has already moved the clock by the time the frame goes out", async () => {
    const { result } = await ask("user");
    await claimAll();

    let clockAtFrame: string | null = "not read";
    const off = ws.server.bus.subscribe(() => {
      clockAtFrame ??= null;
      const state = clockFile();
      clockAtFrame = (state["reflected"] as string | null) ?? null;
    });
    await ws.post(`/api/queue/${result.eventId}/complete`, {});
    off();

    expect(clockAtFrame).toBe((await status()).reflected);
    expect(clockAtFrame).not.toBeNull();
  });

  it("names it on an ordinary document write too, so the count refreshes", async () => {
    const frames = await framesDuring(() =>
      createDoc(ws, { type: "note", title: "Something changed" }, "user"),
    );

    expect(frames[0]?.map((key) => JSON.stringify(key))).toContain('["reflect"]');
  });
});
