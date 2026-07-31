import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACTOR_HEADER,
  LockConflictErrorSchema,
  LockListSchema,
  LockReapResultSchema,
  LockSchema,
  ReleaseLockResultSchema,
  ValidationErrorSchema,
  type QueryKey,
} from "@corpus/contract";
import { createServer, type CorpusServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { silentLogger } from "../logger.js";
import { createProjectionQueueMirror } from "../projection/index.js";
import { createRecordingCommitter, type RecordingCommitter } from "./git-fixture.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const DOC = "doc_a1b2c3";
const OTHER = "doc_other1";
const START = Date.parse("2026-07-27T09:00:00Z");

let ws: Workspace;
let server: CorpusServer;
let clock: number;
let git: RecordingCommitter;
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
  server.app.request(path, { ...init, headers: { ...AUTH, ...init.headers } });

const acquire = async (docId: string, actor: string, body?: unknown): Promise<Response> =>
  request(`/api/locks/${docId}`, {
    method: "POST",
    headers: {
      [ACTOR_HEADER]: actor,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const lockFile = (docId: string): string => join(ws.config.corpusDir, "locks", `${docId}.json`);

beforeEach(() => {
  ws = createWorkspace("s009-lockroutes");
  ws.doc({ id: DOC, title: "Mortgage options" });
  ws.doc({ id: OTHER });
  ws.reproject();
  clock = START;
  git = createRecordingCommitter();
  keys = [];
  server = createServer(config(ws.config.workspaceRoot), {
    projection: ws.db,
    queueMirror: createProjectionQueueMirror(ws.db),
    invalidate: (invalidated) => keys.push(...invalidated),
    logger: silentLogger,
    git,
    now: () => clock,
  });
});

afterEach(async () => {
  await server.close();
  ws.close();
});

describe("POST /api/locks/{docId}", () => {
  it("takes the lock with 201 and the contract's Lock body", async () => {
    const response = await acquire(DOC, "agent");

    expect(response.status).toBe(201);
    const lock = LockSchema.parse(await response.json());
    expect(lock).toEqual({
      docId: DOC,
      holder: "agent",
      acquired: "2026-07-27T09:00:00Z",
      ttl: 300,
    });
    expect(JSON.parse(readFileSync(lockFile(DOC), "utf8"))).toEqual(lock);
  });

  it("takes the default lease for a bare POST and honours an explicit one", async () => {
    expect(LockSchema.parse(await (await acquire(DOC, "agent")).json()).ttl).toBe(300);
    expect(LockSchema.parse(await (await acquire(OTHER, "agent", { ttl: 30 })).json()).ttl).toBe(
      30,
    );
  });

  it("rejects a zero lease before any clamp, and clamps an unbounded one", async () => {
    const zero = await acquire(DOC, "agent", { ttl: 0 });
    expect(zero.status).toBe(400);
    expect(ValidationErrorSchema.parse(await zero.json()).issues.length).toBeGreaterThan(0);
    expect(existsSync(lockFile(DOC))).toBe(false);

    const huge = await acquire(DOC, "agent", { ttl: 86_400 });
    expect(huge.status).toBe(201);
    expect(LockSchema.parse(await huge.json()).ttl).toBe(1800);
    const onDisk: unknown = JSON.parse(readFileSync(lockFile(DOC), "utf8"));
    expect(onDisk).toMatchObject({ ttl: 1800 });
  });

  it("renews for the same holder and refuses the other party with a 409 carrying the lock", async () => {
    await acquire(DOC, "agent");
    clock += 60_000;

    const renewed = await acquire(DOC, "agent");
    expect(renewed.status).toBe(201);
    expect(LockSchema.parse(await renewed.json()).acquired).toBe("2026-07-27T09:01:00Z");
    expect(readdirSync(join(ws.config.corpusDir, "locks"))).toEqual([`${DOC}.json`]);

    const refused = await acquire(DOC, "user");
    expect(refused.status).toBe(409);
    // `lock` is required on this route's error, not optional: a client that
    // cannot see the holder cannot render the banner that explains the refusal.
    expect(LockConflictErrorSchema.parse(await refused.json())).toMatchObject({
      code: "conflict",
      lock: { docId: DOC, holder: "agent" },
    });
  });

  it("hands an expired lease to whoever asks next", async () => {
    await acquire(DOC, "agent", { ttl: 1 });
    clock += 2000;

    const response = await acquire(DOC, "user");

    expect(response.status).toBe(201);
    expect(LockSchema.parse(await response.json()).holder).toBe("user");
  });

  it("404s an unknown document and 400s a malformed id, creating no file either way", async () => {
    const unknown = await acquire("doc_zzzzzzzz", "agent");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "not_found" });

    const malformed = await acquire("not-an-id", "agent");
    expect(malformed.status).toBe(400);
    expect(ValidationErrorSchema.parse(await malformed.json()).issues.length).toBeGreaterThan(0);

    expect(readdirSync(join(ws.config.corpusDir, "locks"))).toEqual([]);
  });

  it("announces the lock keys and the document's own key", async () => {
    await acquire(DOC, "agent");

    expect(keys).toContainEqual(["locks"]);
    expect(keys).toContainEqual(["locks", DOC]);
    expect(keys).toContainEqual(["docs", DOC]);
  });
});

describe("POST /api/locks/reap", () => {
  it("is the reap route, not an acquire on a document called `reap`", async () => {
    await acquire(DOC, "agent", { ttl: 1 });
    await acquire(OTHER, "user", { ttl: 600 });
    clock += 2000;

    const response = await request("/api/locks/reap", { method: "POST" });

    expect(response.status).toBe(200);
    expect(LockReapResultSchema.parse(await response.json())).toEqual({ reaped: [DOC] });
    expect(existsSync(lockFile(DOC))).toBe(false);
    expect(existsSync(lockFile(OTHER))).toBe(true);
    expect(existsSync(join(ws.config.corpusDir, "locks", "reap.json"))).toBe(false);

    const second = await request("/api/locks/reap", { method: "POST" });
    expect(LockReapResultSchema.parse(await second.json())).toEqual({ reaped: [] });
  });
});

describe("DELETE /api/locks/{docId}", () => {
  it("lets only the holder release, with 403 for anyone else", async () => {
    await acquire(DOC, "agent");

    const refused = await request(`/api/locks/${DOC}`, {
      method: "DELETE",
      headers: { [ACTOR_HEADER]: "user" },
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "forbidden" });
    expect(existsSync(lockFile(DOC))).toBe(true);

    const released = await request(`/api/locks/${DOC}`, {
      method: "DELETE",
      headers: { [ACTOR_HEADER]: "agent" },
    });
    expect(released.status).toBe(200);
    expect(ReleaseLockResultSchema.parse(await released.json())).toEqual({
      docId: DOC,
      released: true,
      holder: "agent",
    });
    expect(existsSync(lockFile(DOC))).toBe(false);
  });

  it("404s an absent lock", async () => {
    const response = await request(`/api/locks/${DOC}`, { method: "DELETE" });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found" });
  });
});

describe("POST /api/locks/{docId}/break", () => {
  it("is user-only", async () => {
    await acquire(DOC, "user");

    const response = await request(`/api/locks/${DOC}/break`, {
      method: "POST",
      headers: { [ACTOR_HEADER]: "agent" },
    });

    expect(response.status).toBe(403);
    expect(existsSync(lockFile(DOC))).toBe(true);
    expect(git.commits).toEqual([]);
  });

  it("clears the lock, names who held it, and records the audit entry", async () => {
    await acquire(DOC, "agent");

    const response = await request(`/api/locks/${DOC}/break`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(ReleaseLockResultSchema.parse(await response.json())).toEqual({
      docId: DOC,
      released: true,
      holder: "agent",
    });
    expect(existsSync(lockFile(DOC))).toBe(false);
    expect(git.commits).toHaveLength(1);
    expect(git.commits[0]?.subject).toBe(`lock: force-break on ${DOC} (was agent) by user`);
  });

  it("404s an absent lock and makes no empty commit", async () => {
    const response = await request(`/api/locks/${DOC}/break`, { method: "POST" });

    expect(response.status).toBe(404);
    expect(git.commits).toEqual([]);
  });
});

describe("GET /api/locks", () => {
  it("hydrates banners with live locks only, and never leaks a runtime-only field", async () => {
    await acquire(DOC, "agent", { ttl: 1 });
    await acquire(OTHER, "user");
    // A lock file is gitignored runtime state and may hold more than the four
    // contract fields — `deferredEventId` did until SERVER-030 retired it.
    // Whatever it holds must not appear on any response.
    const stored: unknown = JSON.parse(readFileSync(lockFile(OTHER), "utf8"));
    writeFileSync(
      lockFile(OTHER),
      JSON.stringify({ ...(stored as Record<string, unknown>), deferredEventId: "evt_deferred01" }),
      "utf8",
    );
    clock += 2000;

    const response = await request("/api/locks");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("deferredEventId");
    expect(LockListSchema.parse(JSON.parse(body))).toEqual({
      locks: [{ docId: OTHER, holder: "user", acquired: "2026-07-27T09:00:00Z", ttl: 300 }],
    });
  });

  it("requires the workspace token", async () => {
    const response = await server.app.request("/api/locks");

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
  });
});
