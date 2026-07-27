import { mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  DocListSchema,
  DoctorReportSchema,
  RebuildResultSchema,
  type QueryKey,
} from "@corpus/contract";
import { createServer, type CorpusServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { silentLogger } from "../logger.js";
import { attachProjection, openWorkspaceProjection } from "./attach.js";
import { cacheDbPath } from "./db.js";
import { REBUILD_QUERY_KEYS } from "./routes.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };

let root: string;
let workspaceRoot: string;
let server: CorpusServer;
let keys: QueryKey[][];

const doc = (id: string, title = id): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${title}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n\nBody of ${id}.\n`;

function write(relative: string, content: string): string {
  const abs = join(workspaceRoot, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

function makeConfig(): ServerConfig {
  return {
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
    warnings: [],
  };
}

/** The lifecycle seam, exactly as `runServerProcess` runs it. */
function boot(): void {
  const config = makeConfig();
  const projection = openWorkspaceProjection(config, silentLogger);
  server = createServer(config, { logger: silentLogger, projection, heartbeatMs: 0 });
  attachProjection(server);
  keys = [];
  server.bus.subscribe((batch) => {
    keys.push(batch.map((key) => [...key]));
  });
}

const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
  server.app.request(path, { ...init, headers: { ...AUTH, ...init.headers } });

const rebuildRequest = async (headers: Record<string, string> = {}): Promise<Response> =>
  request("/api/db/rebuild", { method: "POST", headers });

/** What the *server's own* handle can see — the question a rebuild puts at risk. */
const projectedIds = (): string[] =>
  (
    server.projection?.prepare("SELECT id FROM documents ORDER BY id").all() as { id: string }[]
  ).map((row) => row.id);

/** What the file on disk holds right now, read through a connection nobody shares. */
function idsOnDisk(): string[] {
  const sqlite = new Database(cacheDbPath(server.config), { readonly: true, fileMustExist: true });
  try {
    return (sqlite.prepare("SELECT id FROM documents ORDER BY id").all() as { id: string }[]).map(
      (row) => row.id,
    );
  } finally {
    sqlite.close();
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s017-routes-"));
  workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  write("data/docs/a.md", doc("doc_aaa"));
});

afterEach(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe("POST /api/db/rebuild", () => {
  it("answers the contract's RebuildResult", async () => {
    boot();
    write("data/docs/b.md", doc("doc_bbb"));

    const response = await rebuildRequest();
    expect(response.status).toBe(200);

    const body = RebuildResultSchema.parse(await response.json());
    expect(body.path).toBe(cacheDbPath(server.config));
    expect(body.documents).toBe(2);
    expect(body.skipped).toEqual([]);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports the files it had to skip rather than failing on them", async () => {
    boot();
    write("data/docs/broken.md", `---\nid: doc_x\ntitle: [unclosed\n---\n\nBody.\n`);

    const body = RebuildResultSchema.parse(await (await rebuildRequest()).json());
    expect(body.documents).toBe(1);
    expect(body.skipped.map((entry) => entry.path)).toEqual(["data/docs/broken.md"]);
  });

  /**
   * The SERVER-004 handoff: `rebuild()` commits by renaming a new database over
   * `cache.db`, so a server that did not reopen would keep answering from the
   * inode the rename unlinked. Proven both ways round — a document that only
   * the new file knows about, and one that only the old file still believed in.
   */
  it("answers from the new file, not the inode the rename unlinked", async () => {
    boot();
    const before = statSync(cacheDbPath(server.config)).ino;
    expect(projectedIds()).toEqual(["doc_aaa"]);

    // Out-of-band edits the live projection has not seen: one added, one removed.
    write("data/docs/b.md", doc("doc_bbb"));
    unlinkSync(join(workspaceRoot, "data", "docs", "a.md"));

    expect((await rebuildRequest()).status).toBe(200);

    const after = statSync(cacheDbPath(server.config)).ino;
    expect(after).not.toBe(before);
    expect(idsOnDisk()).toEqual(["doc_bbb"]);
    // The captured handle — the same object the docs routes, the lock and job
    // services and the watcher hold — now reads that same file.
    expect(projectedIds()).toEqual(["doc_bbb"]);
  });

  it("serves the rebuilt rows over the routes that captured the handle at mount time", async () => {
    boot();
    write("data/docs/b.md", doc("doc_bbb", "Bee"));

    const stale = DocListSchema.parse(await (await request("/api/docs")).json());
    expect(stale.items.map((entry) => entry.id)).toEqual(["doc_aaa"]);

    await rebuildRequest();

    const fresh = DocListSchema.parse(await (await request("/api/docs")).json());
    expect(fresh.items.map((entry) => entry.id).sort()).toEqual(["doc_aaa", "doc_bbb"]);
    expect((await request("/api/tree")).status).toBe(200);
  });

  it("rebinds the queue's events mirror, so later transitions still land in the table", async () => {
    boot();
    const event = await server.queue.enqueue({
      type: "comment.created",
      source: "cli",
      payload: {},
    });

    await rebuildRequest();

    // Survived the swap: the rebuild re-derived the row from the pending file.
    expect(server.projection?.prepare("SELECT id, status FROM events").all()).toEqual([
      { id: event.id, status: "pending" },
    ]);

    await server.queue.claimAll();
    expect(
      server.projection?.prepare("SELECT status FROM events WHERE id = ?").get(event.id),
    ).toEqual({ status: "in-progress" });
    expect(idsOnDisk()).toEqual(["doc_aaa"]);
  });

  it("announces the coarse vocabulary once, not one key per row", async () => {
    boot();
    write("data/docs/b.md", doc("doc_bbb"));
    write("data/docs/c.md", doc("doc_ccc"));
    keys = [];

    await rebuildRequest();

    expect(keys).toEqual([[["docs"], ["tree"], ["queue"], ["jobs"], ["locks"]]]);
    expect(REBUILD_QUERY_KEYS).toHaveLength(5);
  });

  it("takes the actor header without making it an author", async () => {
    boot();
    expect((await rebuildRequest({ "x-corpus-author": "agent" })).status).toBe(200);
    expect((await rebuildRequest({ "x-corpus-author": "user" })).status).toBe(200);
    // Any actor may rebuild: it derives state rather than mutating truth, so
    // there is no file to author and nothing to attribute.
    expect((await rebuildRequest()).status).toBe(200);
  });

  it("rejects an actor the contract does not name", async () => {
    boot();
    const response = await rebuildRequest({ "x-corpus-author": "robot" });
    expect(response.status).toBe(400);
    expect(ApiErrorSchema.parse(await response.json()).code).toBe("bad_request");
  });

  it("needs the bearer token", async () => {
    boot();
    const response = await server.app.request("/api/db/rebuild", { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("leaves a workspace rebuildable twice in a row", async () => {
    boot();
    await rebuildRequest();
    const second = RebuildResultSchema.parse(await (await rebuildRequest()).json());
    expect(second.documents).toBe(1);
    expect(projectedIds()).toEqual(["doc_aaa"]);
  });
});

describe("GET /api/db/doctor", () => {
  it("reports a freshly projected workspace as clean", async () => {
    boot();
    const response = await request("/api/db/doctor");
    expect(response.status).toBe(200);

    const body = DoctorReportSchema.parse(await response.json());
    expect(body).toMatchObject({ ok: true, drift: [] });
    expect(body.stats.files).toBe(1);
    expect(body.stats.documents).toBe(1);
    expect(body.stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a file with no row as missing_row", async () => {
    boot();
    write("data/docs/b.md", doc("doc_bbb"));

    const body = DoctorReportSchema.parse(await (await request("/api/db/doctor")).json());
    expect(body.ok).toBe(false);
    expect(body.drift).toEqual([
      expect.objectContaining({ kind: "missing_row", path: "data/docs/b.md" }),
    ]);
  });

  it("reports a row with no file as orphan_row, and a rebuild clears it", async () => {
    boot();
    unlinkSync(join(workspaceRoot, "data", "docs", "a.md"));

    const drifted = DoctorReportSchema.parse(await (await request("/api/db/doctor")).json());
    expect(drifted.drift.map((entry) => entry.kind)).toEqual(["orphan_row"]);

    await rebuildRequest();

    const healed = DoctorReportSchema.parse(await (await request("/api/db/doctor")).json());
    expect(healed).toMatchObject({ ok: true, drift: [] });
  });

  it("reports edited bytes as content_mismatch", async () => {
    boot();
    write("data/docs/a.md", doc("doc_aaa", "Renamed by hand"));

    const body = DoctorReportSchema.parse(await (await request("/api/db/doctor")).json());
    expect(body.drift).toEqual([
      expect.objectContaining({ kind: "content_mismatch", path: "data/docs/a.md" }),
    ]);
    expect(body.stats.hashed).toBe(1);
  });

  /**
   * The one drift kind that concerns no single file. The server's own `Drift`
   * leaves `path` absent; on the wire the key is always present and `null` says
   * so (CONTRACT-006's deliberate adaptation).
   */
  it("sends null, not an absent key, for a drift that names no file", async () => {
    boot();
    write(
      ".corpus/queue/pending/evt_seed00000000.json",
      JSON.stringify({
        id: "evt_seed00000000",
        type: "comment.created",
        created: "2026-07-19T10:05:00Z",
        source: "cli",
        payload: {},
      }),
    );

    const raw = (await (await request("/api/db/doctor")).json()) as {
      drift: { kind: string; path: unknown }[];
    };
    const entry = raw.drift.find((item) => item.kind === "count_mismatch");
    expect(entry).toBeDefined();
    expect(entry && "path" in entry).toBe(true);
    expect(entry?.path).toBeNull();
    expect(DoctorReportSchema.parse(raw).ok).toBe(false);
  });

  it("mutates nothing — two consecutive checks report the same drift", async () => {
    boot();
    write("data/docs/b.md", doc("doc_bbb"));

    const first = await (await request("/api/db/doctor")).json();
    const second = await (await request("/api/db/doctor")).json();
    expect((second as { drift: unknown }).drift).toEqual((first as { drift: unknown }).drift);
    expect(projectedIds()).toEqual(["doc_aaa"]);
  });

  it("needs the bearer token", async () => {
    boot();
    expect((await server.app.request("/api/db/doctor")).status).toBe(401);
  });
});
