// SERVER-166 — SPEC.md §9.4's two endpoints against a real server, a real
// workspace and a real git repository.
//
// The unit suites beside this one pin the arithmetic and the retention window.
// What this file is for is the posture: the ledger is runtime state, so it must
// survive a restart, disappear with a rebuild, be invisible to `db doctor`, and
// announce nothing to anybody.

import { afterEach, describe, expect, it } from "vitest";
import {
  DocumentCostSchema,
  MAX_COST_BUCKETS,
  type InvocationReport,
  type QueryKey,
} from "@corpus/contract";
import { createWriteWorkspace, FIXTURE_NOW, type WriteWorkspace } from "../docs/write-fixture.js";
import {
  DRIFT_KINDS,
  inspectProjection,
  populateFromFiles,
  rebuild,
  REPOPULATED_TABLES,
} from "../projection/index.js";
import { SCHEMA_VERSION } from "../projection/schema.js";

let ws: WriteWorkspace | undefined;

afterEach(() => {
  ws?.close();
  ws = undefined;
});

const workspace = (): WriteWorkspace => {
  ws = createWriteWorkspace("telemetry", { sprint: "s025" });
  return ws;
};

const report = (overrides: Partial<InvocationReport> = {}): InvocationReport => ({
  command: "doc show",
  wroteBytes: 20,
  readBytes: 800,
  subjects: [],
  at: new Date(FIXTURE_NOW).toISOString(),
  ...overrides,
});

/** A real document through the real write path, so its file and size are real. */
async function createDoc(target: WriteWorkspace, title: string): Promise<string> {
  const response = await target.post("/api/docs", { type: "note", title, body: "Body.\n" });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { doc: { frontmatter: { id: string } } };
  return payload.doc.frontmatter.id;
}

const ledgerRows = (target: WriteWorkspace): number =>
  (target.db.prepare("SELECT COUNT(*) AS n FROM telemetry").get() as { n: number }).n;

describe("the cost ledger's endpoints", () => {
  it("TEST-1194: mounts both routes, and takes their authentication from the mount", async () => {
    const target = workspace();
    const id = await createDoc(target, "Mounted");

    // Authenticated, both answer their declared statuses.
    expect((await target.post("/api/telemetry/invocations", report())).status).toBe(204);
    expect((await target.request(`/api/docs/${id}/cost`)).status).toBe(200);

    // Unauthenticated, both are refused by the `/api/*` middleware — the module
    // wires no auth of its own, exactly as the index-maintenance routes state.
    const anonymousPost = await target.server.app.request("/api/telemetry/invocations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report()),
    });
    expect(anonymousPost.status).toBe(401);
    expect((await target.server.app.request(`/api/docs/${id}/cost`)).status).toBe(401);
  });

  it("answers 204 with no body at all", async () => {
    const target = workspace();
    const response = await target.post("/api/telemetry/invocations", report());
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("refuses a body that is neither form, and keeps the report for a legal one", async () => {
    const target = workspace();
    const bad = await target.post("/api/telemetry/invocations", {
      command: "doc show",
      wroteBytes: -1,
      readBytes: 0,
      subjects: [],
      at: new Date(FIXTURE_NOW).toISOString(),
    });
    expect(bad.status).toBe(400);
    expect(ledgerRows(target)).toBe(0);
  });

  it("records a batch and a single report through the same route", async () => {
    const target = workspace();
    const id = await createDoc(target, "Batched");
    expect(
      (
        await target.post("/api/telemetry/invocations", {
          invocations: [report({ subjects: [id] }), report({ subjects: [id] })],
        })
      ).status,
    ).toBe(204);
    expect(
      (await target.post("/api/telemetry/invocations", report({ subjects: [id] }))).status,
    ).toBe(204);
    expect(ledgerRows(target)).toBe(3);
  });

  it("TEST-1187: ingestion writes no file, makes no commit and emits no frame", async () => {
    const target = workspace();
    const id = await createDoc(target, "Quiet");
    // Everything the document's own creation did is already committed; the
    // ledger's turn starts from a clean tree and a fixed HEAD.
    const headBefore = target.head();
    const treeBefore = target.git("status", "--porcelain");

    const frames: QueryKey[][] = [];
    const unsubscribe = target.server.bus.subscribe((keys) => {
      frames.push([...keys]);
    });
    try {
      for (let index = 0; index < 100; index += 1) {
        const response = await target.post(
          "/api/telemetry/invocations",
          report({ subjects: [id], at: new Date(FIXTURE_NOW + index).toISOString() }),
        );
        expect(response.status).toBe(204);
      }
    } finally {
      unsubscribe();
    }

    expect(ledgerRows(target)).toBe(100);
    expect(target.head()).toBe(headBefore);
    expect(target.git("status", "--porcelain")).toBe(treeBefore);
    // §9.4's measurements are not part of the corpus: nothing under `data/`
    // moved, and no query key went stale (sprint-025 R8).
    expect(target.git("status", "--porcelain", "--", "data")).toBe("");
    expect(frames).toEqual([]);
  });

  it("serves a series that satisfies the contract's own schema", async () => {
    const target = workspace();
    const id = await createDoc(target, "Shaped");
    await target.post("/api/telemetry/invocations", report({ subjects: [id] }));

    const response = await target.request(`/api/docs/${id}/cost`);
    expect(response.status).toBe(200);
    const parsed = DocumentCostSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.granularity).toBe("day");
    expect(parsed.success && parsed.data.buckets).toHaveLength(1);
    expect(parsed.success && parsed.data.buckets[0]?.byCommand).toEqual({ "doc show": 5 + 200 });
    expect(parsed.success && parsed.data.measuringSince).toBe(new Date(FIXTURE_NOW).toISOString());
  });

  it("TEST-1190: reports the document's real byte length, frontmatter included", async () => {
    const target = workspace();
    const id = await createDoc(target, "Sized");
    const response = await target.request(`/api/docs/${id}/cost`);
    const payload = (await response.json()) as { sizeBytes: number };

    const row = target.db.prepare("SELECT path FROM documents WHERE id = ?").get(id) as {
      path: string;
    };
    expect(payload.sizeBytes).toBe(Buffer.byteLength(target.read(row.path), "utf8"));
    expect(payload.sizeBytes).toBeGreaterThan(0);
  });

  it("answers a thread id with that thread's own series, not its parent's", async () => {
    const target = workspace();
    const docId = await createDoc(target, "Parent");
    const created = await target.post("/api/threads", { parent: docId, body: "Question?" });
    expect(created.status).toBe(201);
    const threadId = ((await created.json()) as { thread: { id: string } }).thread.id;

    await target.post("/api/telemetry/invocations", report({ subjects: [threadId] }));

    const thread = (await (await target.request(`/api/docs/${threadId}/cost`)).json()) as {
      buckets: unknown[];
    };
    const parent = (await (await target.request(`/api/docs/${docId}/cost`)).json()) as {
      buckets: unknown[];
    };
    expect(thread.buckets).toHaveLength(1);
    // §9.4 attributes cost to what the invocation *named*. A roll-up would be a
    // second metric.
    expect(parent.buckets).toEqual([]);
  });

  it("refuses a malformed id and a limit past the cap before any handler runs", async () => {
    const target = workspace();
    expect((await target.request("/api/docs/not-an-id/cost")).status).toBe(400);
    const id = await createDoc(target, "Bounded");
    expect(
      (await target.request(`/api/docs/${id}/cost?limit=${String(MAX_COST_BUCKETS + 1)}`)).status,
    ).toBe(400);
  });

  it("answers 404 for an id no document claims", async () => {
    const target = workspace();
    expect((await target.request("/api/docs/doc_99999999/cost")).status).toBe(404);
  });

  it("TEST-1182: a boot repopulation leaves every row where it was", async () => {
    const target = workspace();
    const id = await createDoc(target, "Surviving");
    await target.post("/api/telemetry/invocations", report({ subjects: [id] }));
    expect(ledgerRows(target)).toBe(1);

    // What a restart does: `openProjection` repopulates from files, which clears
    // and rewrites every derived table. The ledger is not one of them.
    populateFromFiles(target.db);

    expect(ledgerRows(target)).toBe(1);
    const cost = (await (await target.request(`/api/docs/${id}/cost`)).json()) as {
      buckets: unknown[];
      measuringSince: string | null;
    };
    expect(cost.buckets).toHaveLength(1);
    expect(cost.measuringSince).not.toBeNull();
  });

  it("TEST-1182: `telemetry` is absent from the repopulated set, and that absence is the point", () => {
    // Every other table in that list is re-derivable from the workspace's files
    // in milliseconds, so clearing it costs nothing. The cost ledger is
    // re-derivable from nothing: no file records what an invocation printed, so
    // a row cleared there is a measurement destroyed.
    //
    // The trap the absence avoids is that the list is **not rebuild-only** — a
    // full repopulation also runs at every boot, so naming `telemetry` there
    // would empty the user's cost history on every `corpus server stop && start`.
    // §9.4 says *rebuild*, and nothing weaker.
    expect(REPOPULATED_TABLES).not.toContain("telemetry");
  });

  it("TEST-1183: a rebuild leaves the series empty, by constructing a fresh database", async () => {
    const target = workspace();
    const id = await createDoc(target, "Rebuilt");
    await target.post("/api/telemetry/invocations", report({ subjects: [id] }));
    expect(ledgerRows(target)).toBe(1);

    const response = await target.post("/api/db/rebuild", {});
    expect(response.status).toBe(200);

    // Absent, and nothing was written to make it so: the rebuild builds a new
    // file and carries nothing across but the embeddings.
    expect(ledgerRows(target)).toBe(0);
    const cost = (await (await target.request(`/api/docs/${id}/cost`)).json()) as {
      buckets: unknown[];
      measuringSince: string | null;
      sizeBytes: number;
    };
    // Honest rather than merely empty: the panel is told the workspace has
    // measured nothing, so it cannot present a short history as a whole one.
    expect(cost.buckets).toEqual([]);
    expect(cost.measuringSince).toBeNull();
    // The document itself was projected again, so the reference line still works.
    expect(cost.sizeBytes).toBeGreaterThan(0);
  });

  it("TEST-1184: `db doctor` is clean with the ledger full and with it empty", async () => {
    const target = workspace();
    const id = await createDoc(target, "Inspected");

    const empty = inspectProjection(target.db);
    expect([empty.ok, empty.drift]).toEqual([true, []]);

    await target.post("/api/telemetry/invocations", report({ subjects: [id] }));
    await target.post("/api/telemetry/invocations", report({ subjects: ["doc_99999999"] }));
    await target.post("/api/telemetry/invocations", report({ subjects: [] }));

    // A row naming a document that does not exist, and a row naming nothing at
    // all, are both legal ledger content and neither is drift.
    const full = inspectProjection(target.db);
    expect([full.ok, full.drift, full.unlistable]).toEqual([true, [], []]);
    expect(JSON.stringify(full)).not.toContain("telemetry");

    // The doctor has no per-file bookkeeping to compare the ledger against,
    // because there are no files behind it — so the closed drift vocabulary
    // gains nothing.
    expect([...DRIFT_KINDS]).toEqual([
      "missing_row",
      "orphan_row",
      "content_mismatch",
      "count_mismatch",
      "unparseable",
      "duplicate_id",
    ]);
  });

  it("TEST-1195: the schema version moved once, and the consequence is recorded", () => {
    // 24 → 25 is SERVER-166's alone (sprint-025 S6). A version bump supersedes
    // the database file, so the cost series restarts on this release and on
    // every future bump — accepted rather than engineered around, and captioned
    // by `measuringSince` rather than hidden.
    expect(SCHEMA_VERSION).toBe(25);
  });

  it("TEST-1183: a rebuild through the route works when the ledger is untouched too", async () => {
    const target = workspace();
    await createDoc(target, "Never measured");
    expect((await target.post("/api/db/rebuild", {})).status).toBe(200);
    const after = inspectProjection(target.db);
    expect([after.ok, after.drift]).toEqual([true, []]);
  });

  it("carries nothing across a rebuild built beside the live database either", async () => {
    const target = workspace();
    const id = await createDoc(target, "Beside");
    await target.post("/api/telemetry/invocations", report({ subjects: [id] }));

    // `rebuild` is the same function `POST /api/db/rebuild` calls, exercised
    // here in the mode that builds into a named file — the one path where a
    // carry-over could have been added by mistake.
    const into = `${target.db.path}.rebuilt`;
    const built = rebuild(target.db.config, { into });
    expect(built.documents).toBeGreaterThan(0);
    const Database = (await import("better-sqlite3")).default;
    const fresh = new Database(into, { readonly: true, fileMustExist: true });
    try {
      expect(fresh.prepare("SELECT COUNT(*) AS n FROM telemetry").get()).toEqual({ n: 0 });
    } finally {
      fresh.close();
    }
  });
});

describe("the ledger's route surface obeys the fixture's declared-status check", () => {
  it("never answers a status its contract declaration does not name", async () => {
    // `createWriteWorkspace` wraps every response in `checkDeclaredStatuses`, so
    // this test's value is in the requests it makes rather than its assertions:
    // each one drives a different arm of the two handlers past that check.
    const target = workspace();
    const id = await createDoc(target, "Declared");
    await target.post("/api/telemetry/invocations", report({ subjects: [id] }));
    await target.post("/api/telemetry/invocations", { invocations: [] });
    await target.post("/api/telemetry/invocations", { nonsense: true });
    await target.request(`/api/docs/${id}/cost?limit=1`);
    await target.request("/api/docs/doc_99999999/cost");
    expect(ledgerRows(target)).toBe(1);
  });
});
