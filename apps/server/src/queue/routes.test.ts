import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  ClaimBatchSchema,
  IdleResultSchema,
  QueueEventSchema,
  QueueStatusSchema,
  ReapStaleResultSchema,
  ValidationErrorSchema,
} from "@corpus/contract";
import { createServer, type CorpusServer } from "../app.js";
import { HaltSentinelSchema, type HaltSentinel } from "./store.js";
import type { ServerConfig } from "../config.js";
import { silentLogger } from "../logger.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };

let root: string;
let server: CorpusServer;

function makeConfig(): ServerConfig {
  return {
    workspaceRoot: root,
    corpusDir: join(root, ".corpus"),
    attachments: DEFAULT_ATTACHMENT_LIMITS,
    dataDir: join(root, "data"),
    configPath: join(root, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    version: "9.9.9",
    logLevel: "silent",
    uiDistDir: undefined,
    warnings: [],
  };
}

const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
  server.app.request(path, { ...init, headers: { ...AUTH, ...init.headers } });

const halt = async (body: { reason?: string }): Promise<Response> =>
  request("/api/queue/halt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** The `.corpus/HALT` sentinel exactly as it sits on disk, parsed but not defaulted. */
const readSentinel = (): HaltSentinel =>
  HaltSentinelSchema.parse(JSON.parse(readFileSync(join(root, ".corpus", "HALT"), "utf8")));

const seed = async (count: number): Promise<string[]> => {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const event = await server.queue.enqueue({
      type: "comment.created",
      source: "cli",
      payload: { index },
    });
    ids.push(event.id);
  }
  return ids;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s008-"));
  server = createServer(makeConfig(), { logger: silentLogger });
});

afterEach(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/queue/status", () => {
  it("reports halt state and per-status counts in the contract's shape", async () => {
    await seed(2);
    const response = await request("/api/queue/status");

    expect(response.status).toBe(200);
    const parsed = QueueStatusSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      halted: false,
      pending: 2,
      inProgress: 0,
      processed: 0,
      failed: 0,
      abandoned: 0,
    });
  });
});

describe("GET /api/queue/idle", () => {
  it("returns 200 with the pending events, and does not claim them", async () => {
    const ids = await seed(2);
    const response = await request("/api/queue/idle?timeout=60");

    expect(response.status).toBe(200);
    const parsed = IdleResultSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.events.map((event) => event.id).sort()).toEqual(
      [...ids].sort(),
    );
    // Availability only: the files are still pending.
    expect((await server.queue.status()).pending).toBe(2);
  });

  it("answers 204 with an empty body when the window expires", async () => {
    const response = await request("/api/queue/idle?timeout=1");

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("parks the full window while halted, even with work pending", async () => {
    await seed(1);
    await request("/api/queue/halt", { method: "POST" });

    const started = Date.now();
    const response = await request("/api/queue/idle?timeout=1");
    expect(response.status).toBe(204);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it.each([
    ["above the declared maximum", "?timeout=600"],
    ["not a number", "?timeout=abc"],
    ["zero", "?timeout=0"],
  ])("rejects a timeout %s with a 400 naming the parameter", async (_label, query) => {
    const response = await request(`/api/queue/idle${query}`);

    expect(response.status).toBe(400);
    const parsed = ValidationErrorSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.code).toBe("bad_request");
    expect(parsed.success && parsed.data.issues.map((issue) => issue.path)).toContain(
      "query.timeout",
    );
  });

  it("releases a request whose client went away", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const parked = server.app.request("/api/queue/idle?timeout=60", {
      headers: AUTH,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();

    // The abort unwinds the handler long before its 60 s window, and the waiter
    // is gone with it — nothing is left ticking for a client that hung up.
    await parked;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(server.queue.parked).toBe(0);

    // The server is unharmed: a fresh call still answers immediately.
    await seed(1);
    expect((await request("/api/queue/idle?timeout=60")).status).toBe(200);
  });
});

describe("POST /api/queue/claim-all", () => {
  it("returns the batch and empties pending/", async () => {
    const ids = await seed(3);
    const response = await request("/api/queue/claim-all", { method: "POST" });

    expect(response.status).toBe(200);
    const parsed = ClaimBatchSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.events.map((event) => event.id).sort()).toEqual(
      [...ids].sort(),
    );
    expect(await server.queue.status()).toMatchObject({ pending: 0, inProgress: 3 });
  });

  it("responds with exactly the contract's five fields", async () => {
    await seed(1);
    const response = await request("/api/queue/claim-all", { method: "POST" });
    const body = (await response.json()) as { events: Record<string, unknown>[] };
    const event = body.events[0] ?? {};

    expect(Object.keys(event).sort()).toEqual(["created", "id", "payload", "source", "type"]);
    expect(QueueEventSchema.safeParse(event).success).toBe(true);
  });

  it("returns an empty batch while halted, leaving the files alone", async () => {
    await seed(2);
    await request("/api/queue/halt", { method: "POST" });

    const response = await request("/api/queue/claim-all", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [] });
    expect(await server.queue.status()).toMatchObject({ pending: 2, halted: true });
  });
});

describe("the transition endpoints", () => {
  it("completes, fails and abandons, each into its own directory", async () => {
    const [first, second, third] = await seed(3);
    await request("/api/queue/claim-all", { method: "POST" });

    const completed = await request(`/api/queue/${String(first)}/complete`, { method: "POST" });
    const failed = await request(`/api/queue/${String(second)}/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "boom" }),
    });
    const abandoned = await request(`/api/queue/${String(third)}`, { method: "DELETE" });

    expect([completed.status, failed.status, abandoned.status]).toEqual([200, 200, 200]);
    for (const response of [completed, failed, abandoned]) {
      expect(QueueEventSchema.safeParse(await response.json()).success).toBe(true);
    }
    expect(await server.queue.status()).toMatchObject({
      processed: 1,
      failed: 1,
      abandoned: 1,
      inProgress: 0,
    });

    const onDisk: unknown = JSON.parse(
      readFileSync(join(root, ".corpus", "queue", "failed", `${String(second)}.json`), "utf8"),
    );
    expect(onDisk).toMatchObject({ error: "boom" });
    expect(readdirSync(join(root, ".corpus", "queue", "abandoned"))).toEqual([
      `${String(third)}.json`,
    ]);
  });

  it("accepts a fail with no reason", async () => {
    const [id] = await seed(1);
    const response = await request(`/api/queue/${String(id)}/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(await server.queue.status()).toMatchObject({ failed: 1 });
  });

  it("is idempotent, and 404s an unknown id", async () => {
    const [id] = await seed(1);
    await request(`/api/queue/${String(id)}/complete`, { method: "POST" });
    const again = await request(`/api/queue/${String(id)}/complete`, { method: "POST" });
    expect(again.status).toBe(200);

    const missing = await request("/api/queue/evt_missing00000/complete", { method: "POST" });
    expect(missing.status).toBe(404);
    const parsed = ApiErrorSchema.safeParse(await missing.json());
    expect(parsed.success && parsed.data.code).toBe("not_found");
  });

  it.each([
    ["a traversal attempt", "/api/queue/..%2F..%2Fetc%2Fpasswd/complete", "POST"],
    ["an unprefixed id", "/api/queue/foo/complete", "POST"],
    ["a dotted id", "/api/queue/evt_..", "DELETE"],
  ])("rejects %s before touching the filesystem", async (_label, path, method) => {
    const before = readdirSync(join(root, ".corpus", "queue", "pending"));
    const response = await request(path, { method });

    expect(response.status).toBe(400);
    const parsed = ValidationErrorSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.issues.length).toBeGreaterThan(0);
    expect(readdirSync(join(root, ".corpus", "queue", "pending"))).toEqual(before);
  });
});

describe("POST /api/queue/reap-stale", () => {
  it("returns the ids it moved back to pending", async () => {
    const [id] = await seed(1);
    await request("/api/queue/claim-all", { method: "POST" });
    // Backdate the claim the way a crashed run leaves it behind.
    const path = join(root, ".corpus", "queue", "in-progress", `${String(id)}.json`);
    const stranded: unknown = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(
      path,
      JSON.stringify({ ...(stranded as object), updated: "2020-01-01T00:00:00Z" }),
    );

    const response = await request("/api/queue/reap-stale", { method: "POST" });
    expect(response.status).toBe(200);
    const parsed = ReapStaleResultSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reaped).toEqual([id]);
    expect(await server.queue.status()).toMatchObject({ pending: 1, inProgress: 0 });
  });

  it("reports nothing when no run is stuck", async () => {
    await seed(1);
    await request("/api/queue/claim-all", { method: "POST" });
    const response = await request("/api/queue/reap-stale", { method: "POST" });

    expect(await response.json()).toEqual({ reaped: [] });
  });
});

describe("halt and resume over HTTP", () => {
  it("writes and clears the sentinel, reporting status each time", async () => {
    const first = await request("/api/queue/halt", { method: "POST" });
    expect(first.status).toBe(200);
    expect(QueueStatusSchema.safeParse(await first.json()).success).toBe(true);

    const second = await request("/api/queue/halt", { method: "POST" });
    expect(await second.json()).toMatchObject({ halted: true });
    expect(readdirSync(join(root, ".corpus")).filter((name) => name === "HALT")).toEqual(["HALT"]);

    const resumed = await request("/api/queue/resume", { method: "POST" });
    expect(await resumed.json()).toMatchObject({ halted: false });
    const again = await request("/api/queue/resume", { method: "POST" });
    expect(again.status).toBe(200);
    expect(readdirSync(join(root, ".corpus")).includes("HALT")).toBe(false);
  });

  it("records the reason from the request body in the sentinel", async () => {
    const response = await halt({ reason: "maintenance window" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ halted: true });
    // `readSentinel` parses through `HaltSentinelSchema`, so `at` is already a
    // validated ISO instant; what is left to prove is the reason beside it.
    const sentinel = readSentinel();
    expect(sentinel.reason).toBe("maintenance window");
    expect(Object.keys(sentinel).sort()).toEqual(["at", "reason"]);
  });

  it("leaves the reason absent for a bare POST rather than recording an empty one", async () => {
    const response = await request("/api/queue/halt", { method: "POST" });

    expect(response.status).toBe(200);
    const sentinel = readSentinel();
    expect(Object.keys(sentinel)).toEqual(["at"]);
    expect("reason" in sentinel).toBe(false);
  });

  it("re-records both fields when a second halt supplies a reason", async () => {
    // The sentinel's `at` has whole-second resolution, so the two halts have to
    // land in different seconds for "advanced" to be observable at all. A
    // steerable clock buys that without a real-time sleep.
    let clock = Date.parse("2026-07-27T03:00:00Z");
    await server.close();
    server = createServer(makeConfig(), { logger: silentLogger, now: () => clock });

    await request("/api/queue/halt", { method: "POST" });
    const bare = readSentinel();
    expect(bare.reason).toBeUndefined();

    clock += 2_000;
    const second = await halt({ reason: "second-halt-reason-XYZ" });
    expect(second.status).toBe(200);

    const rewritten = readSentinel();
    expect(rewritten.reason).toBe("second-halt-reason-XYZ");
    expect(Date.parse(rewritten.at)).toBeGreaterThan(Date.parse(bare.at));
    // Rewritten in place: still exactly one sentinel, no `HALT.1` beside it.
    expect(readdirSync(join(root, ".corpus")).filter((name) => name.startsWith("HALT"))).toEqual([
      "HALT",
    ]);
  });

  it("rejects a blank reason without touching the sentinel", async () => {
    const response = await halt({ reason: "" });

    expect(response.status).toBe(400);
    const parsed = ValidationErrorSchema.safeParse(await response.json());
    expect(parsed.success && parsed.data.issues[0]?.path).toBe("json.reason");
    expect(readdirSync(join(root, ".corpus")).includes("HALT")).toBe(false);
  });
});

describe("the bearer guard", () => {
  it.each([
    ["/api/queue/status", "GET"],
    ["/api/queue/idle", "GET"],
    ["/api/queue/claim-all", "POST"],
    ["/api/queue/halt", "POST"],
    ["/api/queue/evt_aaaaaaaaaaaa/complete", "POST"],
  ])("refuses %s without a valid token", async (path, method) => {
    for (const headers of [{}, { Authorization: "Bearer wrong" }]) {
      const response = await server.app.request(path, { method, headers });
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      const parsed = ApiErrorSchema.safeParse(await response.json());
      expect(parsed.success && parsed.data.code).toBe("unauthorized");
    }
    expect(await server.queue.status()).toMatchObject({ halted: false, pending: 0 });
  });
});
