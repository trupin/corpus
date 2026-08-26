import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppendLogResultSchema,
  JobListSchema,
  JobLogSchema,
  JobSchema,
  ValidationErrorSchema,
  type QueryKey,
} from "@corpus/contract";
import { createServer, type CorpusServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { silentLogger } from "../logger.js";
import { createProjectionQueueMirror } from "../projection/index.js";
import {
  FILE_CAP_NOTICE,
  MAX_LOG_FILE_BYTES,
  MAX_LOG_LINE_BYTES,
  StoredLogLineSchema,
} from "./store.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const DOC = "doc_a1b2c3";
const THREAD = "th_x9y8";
const THREAD_TITLE = 'Re: "a 30-year fixed at 6.1%"';
const START = Date.parse("2026-07-27T09:00:00Z");

/** The bindings `@hono/node-server` supplies; `Hono#request`'s third argument is that same hook. */
interface PeerEnv {
  readonly incoming: { readonly socket: { readonly remoteAddress: string } };
}
const peer = (remoteAddress: string): PeerEnv => ({ incoming: { socket: { remoteAddress } } });
const LOOPBACK = peer("127.0.0.1");
const LAN = peer("10.0.0.5");

let ws: Workspace;
let server: CorpusServer;
let clock: number;
let keys: QueryKey[];

const config = (workspaceRoot: string): ServerConfig => ({
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
});

const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
  server.app.request(path, { ...init, headers: { ...AUTH, ...init.headers } }, LOOPBACK);

/** The Claude Code hook's call: loopback, no token, no `Origin`. */
const ingest = async (
  eventId: string,
  line: string,
  options: { headers?: Record<string, string>; env?: PeerEnv } = {},
): Promise<Response> =>
  server.app.request(
    `/api/jobs/${eventId}/log`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...options.headers },
      body: JSON.stringify({ line }),
    },
    options.env ?? LOOPBACK,
  );

const enqueue = async (payload: Record<string, unknown> = {}): Promise<string> =>
  (await server.queue.enqueue({ type: "comment.created", source: "ui", payload })).id;

const logPath = (eventId: string): string => join(ws.config.corpusDir, "jobs", `${eventId}.jsonl`);

/**
 * Puts a job's log at its size cap. The filler is deliberately not JSON — the
 * reader skips what it cannot parse, so the read-back below shows only the
 * lines the server itself wrote.
 */
const fillLogToCap = (eventId: string): void => {
  mkdirSync(join(ws.config.corpusDir, "jobs"), { recursive: true });
  writeFileSync(logPath(eventId), `${"x".repeat(MAX_LOG_FILE_BYTES - 1)}\n`, "utf8");
};

interface StoredLine {
  readonly ts: string;
  readonly source: string;
  readonly line: string;
}

const logLines = (eventId: string): StoredLine[] =>
  readFileSync(logPath(eventId), "utf8")
    .split("\n")
    .filter((text) => text.trim() !== "")
    .map((text) => StoredLogLineSchema.parse(JSON.parse(text)) as StoredLine);

beforeEach(() => {
  ws = createWorkspace("s009-jobroutes");
  ws.doc({ id: DOC, title: "Mortgage options" });
  ws.thread({ id: THREAD, parent: DOC, title: THREAD_TITLE });
  ws.reproject();
  clock = START;
  keys = [];
  server = createServer(config(ws.config.workspaceRoot), {
    projection: ws.db,
    queueMirror: createProjectionQueueMirror(ws.db),
    invalidate: (invalidated) => keys.push(...invalidated),
    logger: silentLogger,
    now: () => clock,
  });
});

afterEach(async () => {
  await server.close();
  ws.close();
});

describe("POST /api/jobs/{id}/log — the tokenless loopback ingest", () => {
  it("appends from loopback with no Authorization header at all", async () => {
    const id = await enqueue({ threadId: THREAD });

    const response = await ingest(id, "reading thread");

    expect(response.status).toBe(201);
    expect(AppendLogResultSchema.parse(await response.json())).toEqual({
      eventId: id,
      appended: true,
    });
    expect(logLines(id)).toEqual([
      { ts: "2026-07-27T09:00:00Z", source: "hook", line: "reading thread" },
    ]);
  });

  it("answers 201 with `appended: false` when the file cap dropped the line", async () => {
    const id = await enqueue();
    fillLogToCap(id);

    // Both callers of the one append implementation: the tokenless hook and
    // `corpus job log`. Neither wrote anything, and neither is told it did.
    for (const headers of [undefined, AUTH]) {
      const response = await ingest(id, "one line too many", { ...(headers ? { headers } : {}) });

      expect(response.status).toBe(201);
      expect(AppendLogResultSchema.parse(await response.json())).toEqual({
        eventId: id,
        appended: false,
      });
    }

    // And the log really is missing the line: what the reader gets back past the
    // filler is the cap notice, written once, and nothing the callers sent.
    const log = JobLogSchema.parse(await (await request(`/api/jobs/${id}/log`)).json());
    expect(log.lines.map((entry) => entry.line)).toEqual([FILE_CAP_NOTICE]);
  });

  it("refuses a non-loopback peer, whatever it claims in a header", async () => {
    const id = await enqueue();

    const response = await ingest(id, "from the LAN", {
      env: LAN,
      headers: { "X-Forwarded-For": "127.0.0.1" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "forbidden" });
    expect(existsSync(logPath(id))).toBe(false);
  });

  it("refuses any request carrying an Origin header, including a same-origin-looking one", async () => {
    const id = await enqueue();

    for (const origin of ["http://evil.example", "http://127.0.0.1:8875"]) {
      const response = await ingest(id, "cross-origin", { headers: { Origin: origin } });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "forbidden" });
    }
    // The check is on presence, not value: a same-origin-looking `Origin` is
    // exactly what an attacker sends.
    expect(existsSync(logPath(id))).toBe(false);
  });

  it("refuses an unknown job id, and a malformed one before touching the filesystem", async () => {
    const unknown = await ingest("evt_nosuchjob", "orphan line");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "not_found" });

    for (const id of ["evt_a%2Fb", "not-an-id", "evt_"]) {
      const malformed = await ingest(id, "traversal");
      expect(malformed.status).toBe(400);
      expect(ValidationErrorSchema.parse(await malformed.json()).issues.length).toBeGreaterThan(0);
    }

    // A `..` segment never even addresses this route: URL normalization collapses
    // it before routing, so the request lands on a path that does not exist.
    const dotdot = await request("/api/jobs/%2e%2e/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line: "traversal" }),
    });
    expect(dotdot.status).toBe(404);

    expect(existsSync(join(ws.config.corpusDir, "jobs"))).toBe(false);
  });

  it("resolves the job against the queue store, so a hook can outrun the mirror", async () => {
    // The file exists; the projection's `events` mirror does not know it yet.
    const id = "evt_aheadofmirror";
    ws.write(
      `.corpus/queue/pending/${id}.json`,
      JSON.stringify({
        id,
        type: "comment.created",
        created: "2026-07-27T09:00:00Z",
        source: "ui",
        payload: {},
      }),
    );
    expect(ws.db.prepare("SELECT 1 FROM events WHERE id = ?").get(id)).toBeUndefined();

    expect((await ingest(id, "early line")).status).toBe(201);
    expect(logLines(id)).toHaveLength(1);
  });

  it("caps the line length and rejects an empty one", async () => {
    const id = await enqueue();

    const response = await ingest(id, "y".repeat(64 * 1024));
    expect(response.status).toBe(201);
    expect(Buffer.byteLength(logLines(id)[0]?.line ?? "", "utf8")).toBe(MAX_LOG_LINE_BYTES);

    const empty = await ingest(id, "");
    expect(empty.status).toBe(400);
    expect(ValidationErrorSchema.parse(await empty.json()).issues.length).toBeGreaterThan(0);
  });

  it("writes the authenticated CLI append into the same file, marked as its own path", async () => {
    const id = await enqueue();

    await ingest(id, "from the hook");
    const authenticated = await ingest(id, "from the cli", { headers: AUTH });

    expect(authenticated.status).toBe(201);
    expect(logLines(id)).toEqual([
      { ts: "2026-07-27T09:00:00Z", source: "hook", line: "from the hook" },
      { ts: "2026-07-27T09:00:00Z", source: "cli", line: "from the cli" },
    ]);
  });

  it("updates the console row without broadcasting a frame per line", async () => {
    const id = await enqueue({ threadId: THREAD });
    // The enqueue itself announced the queue; what is under test is what the
    // fifty appends add to that.
    keys.length = 0;

    for (let index = 0; index < 50; index += 1) {
      await ingest(id, `step ${index}`);
    }

    // The row is current immediately — a listing straight after an append shows
    // the line, with no watcher involvement.
    expect(ws.db.prepare("SELECT last_line FROM jobs WHERE event_id = ?").get(id)).toEqual({
      last_line: "step 49",
    });
    // And nothing was pushed: the watcher's debounced tail carries the
    // invalidation, so 50 appends are not 50 frames (SPEC.md §2.2 rule 3, §9.1).
    expect(keys).toEqual([]);
  });
});

describe("the auth exemption", () => {
  it("is method-and-path exact", async () => {
    const id = await enqueue();
    const bare = async (path: string, init: RequestInit = {}): Promise<number> =>
      (await server.app.request(path, init, LOOPBACK)).status;

    expect(
      await bare(`/api/jobs/${id}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line: "tokenless" }),
      }),
    ).toBe(201);
    // The read of the same path is not exempt: an unauthenticated caller must
    // not get the agent's console output.
    expect(await bare(`/api/jobs/${id}/log`)).toBe(401);
    expect(await bare("/api/jobs")).toBe(401);
    expect(await bare("/api/queue/status")).toBe(401);
  });

  it("still challenges with WWW-Authenticate on the guarded half", async () => {
    const id = await enqueue();

    const response = await server.app.request(`/api/jobs/${id}/log`, {}, LOOPBACK);

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("leaves the authenticated read unguarded by the loopback rule", async () => {
    const id = await enqueue();

    // A GET from a non-loopback peer is refused by *auth*, not by the ingest
    // guards — the two hardening rules are scoped to the POST alone.
    const response = await server.app.request(`/api/jobs/${id}/log`, { headers: AUTH }, LAN);

    expect(response.status).toBe(200);
  });
});

describe("GET /api/jobs/{id}/log", () => {
  it("reads back incrementally with the `cursor` parameter", async () => {
    const id = await enqueue();
    for (let index = 0; index < 20; index += 1) await ingest(id, `line ${index}`);

    const first = JobLogSchema.parse(await (await request(`/api/jobs/${id}/log`)).json());
    expect(first.lines).toHaveLength(20);
    expect(first.nextCursor).toBe(20);
    // The wire shape is `{ts, line}` and nothing more — `source` stays in the file.
    expect(Object.keys(first.lines[0] ?? {}).sort()).toEqual(["line", "ts"]);

    for (let index = 20; index < 25; index += 1) await ingest(id, `line ${index}`);
    const next = JobLogSchema.parse(
      await (await request(`/api/jobs/${id}/log?cursor=${first.nextCursor}`)).json(),
    );
    expect(next.lines.map((line) => line.line)).toEqual([
      "line 20",
      "line 21",
      "line 22",
      "line 23",
      "line 24",
    ]);
    expect(next.nextCursor).toBe(25);

    const beyond = JobLogSchema.parse(
      await (await request(`/api/jobs/${id}/log?cursor=999`)).json(),
    );
    expect(beyond).toEqual({ lines: [], nextCursor: 25 });
  });

  it("reads a job that never logged as empty, and an unknown job as 404", async () => {
    const id = await enqueue();

    const empty = await request(`/api/jobs/${id}/log`);
    expect(empty.status).toBe(200);
    expect(JobLogSchema.parse(await empty.json())).toEqual({ lines: [], nextCursor: 0 });

    const unknown = await request("/api/jobs/evt_nosuchjob/log");
    expect(unknown.status).toBe(404);
  });
});

describe("GET /api/jobs", () => {
  it("returns the console rows in the contract's shape", async () => {
    const id = await enqueue({ threadId: THREAD });
    await ingest(id, "working");
    // Claimed before it is settled: a settle is defined for claimed work only
    // (SERVER-145).
    await server.queue.claimAll();
    await server.queue.fail(id, "boom");

    const response = await request("/api/jobs");

    expect(response.status).toBe(200);
    const body = JobListSchema.parse(await response.json());
    expect(body.jobs).toHaveLength(1);
    expect(Object.keys(body.jobs[0] ?? {}).sort()).toEqual([
      // `blockedOn`/`blockedOnTitle` are on the wire from the day the contract
      // declares them, null until SERVER-030 populates them (CONTRACT-021): a
      // key the console can read as "not waiting" beats a key that appears
      // halfway through a release.
      "blockedOn",
      "blockedOnTitle",
      // The enqueue instant, which `started` used to stand in for
      // (CONTRACT-029). Both are on the row now, and they mean two things.
      "enqueued",
      "eventId",
      // The lane the event was stamped with (SERVER-156, CONTRACT-056). A
      // client cannot derive it — the scope walk is wrong for §7's two
      // carve-outs — so it rides the row it is about.
      "lane",
      "lastLine",
      "originId",
      "originTitle",
      "started",
      "status",
      "type",
      "updated",
    ]);
    expect(body.jobs[0]).toMatchObject({
      eventId: id,
      // The queue event's own type, so the console can say what kind of work is
      // running and not only what it runs on (CONTRACT-012, UI-011's row).
      type: "comment.created",
      status: "failed",
      lastLine: "working",
      originId: THREAD,
      // Populated, not merely present: the console labels the row without a
      // second fetch (CONTRACT-007's rider, UI-011's consumer).
      originTitle: THREAD_TITLE,
    });
  });

  it("defaults to 50, caps at 200, and rejects anything outside the range", async () => {
    for (let index = 0; index < 3; index += 1) {
      clock += 1000;
      await enqueue();
    }

    const bare = JobListSchema.parse(await (await request("/api/jobs")).json());
    expect(bare.jobs).toHaveLength(3);
    // Nothing was cut, and the response says so rather than leaving the caller
    // to guess from the length (CONTRACT-035).
    expect({ total: bare.total, truncated: bare.truncated }).toEqual({
      total: 3,
      truncated: false,
    });

    const windowed = JobListSchema.parse(await (await request("/api/jobs?recent=1")).json());
    expect(windowed.jobs).toHaveLength(1);
    // The two the window cut are reachable, and the reader is told they exist.
    expect({ total: windowed.total, truncated: windowed.truncated }).toEqual({
      total: 3,
      truncated: true,
    });
    expect((await request("/api/jobs?recent=200")).status).toBe(200);

    for (const recent of [0, 201]) {
      const rejected = await request(`/api/jobs?recent=${recent}`);
      expect(rejected.status).toBe(400);
      expect(ValidationErrorSchema.parse(await rejected.json()).issues.length).toBeGreaterThan(0);
    }
  });

  /** CONTRACT-030's predicate, over the wire rather than in the projection. */
  describe("asked about one document", () => {
    it("answers completely, past the window the console would have applied", async () => {
      const wanted = await enqueue({ threadId: THREAD });
      for (let index = 0; index < 55; index += 1) {
        clock += 1000;
        await enqueue({ docId: DOC });
      }

      const console_ = JobListSchema.parse(await (await request("/api/jobs?recent=50")).json());
      expect(console_.jobs.map((job) => job.eventId)).not.toContain(wanted);

      const asked = JobListSchema.parse(
        await (
          await request(`/api/jobs?originId=${THREAD}&status=pending,in-progress,deferred`)
        ).json(),
      );
      expect(asked.jobs.map((job) => job.eventId)).toEqual([wanted]);
      // The console's own answer was cut at 50 of 56 and says so; the origin
      // query dropped the window, so it is complete however small `recent` is.
      expect({ total: console_.total, truncated: console_.truncated }).toEqual({
        total: 56,
        truncated: true,
      });
      expect({ total: asked.total, truncated: asked.truncated }).toEqual({
        total: 1,
        truncated: false,
      });
    });

    it("refuses an unknown status instead of quietly matching nothing", async () => {
      const rejected = await request("/api/jobs?status=in_progress");

      expect(rejected.status).toBe(400);
      expect(ValidationErrorSchema.parse(await rejected.json()).issues.length).toBeGreaterThan(0);
    });

    it("refuses an origin that is not a document id", async () => {
      expect((await request("/api/jobs?originId=nonsense")).status).toBe(400);
    });
  });
});

describe("POST /api/jobs/{id}/retry", () => {
  it("returns a failed job to pending, keeps its log, and says so in the log", async () => {
    const id = await enqueue({ threadId: THREAD });
    await ingest(id, "it broke");
    await server.queue.claimAll();
    await server.queue.fail(id, "boom");
    keys.length = 0;

    const response = await request(`/api/jobs/${id}/retry`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(JobSchema.parse(await response.json())).toMatchObject({
      eventId: id,
      status: "pending",
      lastLine: "retry requested",
    });
    expect(existsSync(join(ws.config.corpusDir, "queue", "pending", `${id}.json`))).toBe(true);
    const pendingFile: unknown = JSON.parse(
      readFileSync(join(ws.config.corpusDir, "queue", "pending", `${id}.json`), "utf8"),
    );
    expect(pendingFile).toMatchObject({ attempts: 0 });
    // The log is evidence of why it failed: kept, and appended to.
    expect(logLines(id).map((entry) => entry.line)).toEqual(["it broke", "retry requested"]);
    expect(keys).toContainEqual(["queue"]);
    expect(keys).toContainEqual(["jobs"]);
  });

  it("refuses a job that is not failed, and 404s one that does not exist", async () => {
    const id = await enqueue();

    const pending = await request(`/api/jobs/${id}/retry`, { method: "POST" });
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ code: "conflict" });

    const unknown = await request("/api/jobs/evt_nosuchjob/retry", { method: "POST" });
    expect(unknown.status).toBe(404);
  });
});

describe("POST /api/jobs/{id}/abandon", () => {
  it("moves the event to abandoned and deletes nothing", async () => {
    const id = await enqueue({ parentId: DOC });
    await ingest(id, "gave up here");

    const response = await request(`/api/jobs/${id}/abandon`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(JobSchema.parse(await response.json())).toMatchObject({
      eventId: id,
      status: "abandoned",
    });
    expect(existsSync(join(ws.config.corpusDir, "queue", "abandoned", `${id}.json`))).toBe(true);
    expect(existsSync(join(ws.config.corpusDir, "queue", "pending", `${id}.json`))).toBe(false);
    // The `.jsonl` survives: the queue moves event files rather than deleting
    // them because the file is evidence, and the log is the same kind of thing.
    expect(readdirSync(join(ws.config.corpusDir, "jobs"))).toEqual([`${id}.jsonl`]);
  });

  it("404s an event that does not exist", async () => {
    expect((await request("/api/jobs/evt_nosuchjob/abandon", { method: "POST" })).status).toBe(404);
  });
});
