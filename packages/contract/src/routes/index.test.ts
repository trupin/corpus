import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { CONTRACT_VERSION } from "../openapi.js";
import { EMPTY_TREE_OBJECT_ID } from "../schemas/edit.js";
import { FormSchema, validateFormAnswer } from "../schemas/form.js";
import { HEADING_PATH_SEPARATOR } from "../schemas/retrieval.js";
import { ALL_CONTRACT_ROUTES, contractRoutes } from "./index.js";
import { ENDPOINT_INVENTORY, endpointSignature } from "./inventory.js";
import {
  isMultipartThreadCreate,
  MISSING_THREAD_BODY_ERROR,
  mountCreateThread,
} from "./thread-create.js";
import { mountAppendTurn } from "./turn-append.js";

const frontmatter = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
  tags: ["finance"],
  status: "open" as const,
  anchors: {},
  due: null,
  reviewed: null,
  evergreen: false,
  pinned: false,
  order: null,
  query: null,
  column: null,
  extra: {},
};

const doc = { frontmatter, body: "Body.", path: "data/docs/mortgage.md", anchors: [] };

/** Stands in for "the newest commit that touched this document" on the diff route. */
const DEFAULT_HEAD_SHA = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456";

const row = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  path: "data/docs/mortgage.md",
  status: "open" as const,
  tags: ["finance"],
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
  due: null,
  reviewed: null,
  evergreen: false,
  excerpt: "Body.",
  pinned: false,
  order: null,
  query: null,
  column: null,
  extra: {},
  stale: null,
  parent: null,
  parentTitle: null,
  agent: null,
  anchorQuote: null,
  turnCount: null,
  lastAuthor: null,
  lastTurn: null,
  unread: null,
  awaitingAgent: null,
  unreadThreads: 2,
  attention: ["unread-reply" as const, "due" as const],
  snippets: [
    {
      field: "title" as const,
      segments: [
        { text: "Mortgage ", match: false },
        { text: "options", match: true },
      ],
    },
  ],
};

const turn = { author: "user" as const, ts: "2026-07-19T10:05:00Z", body: "hi" };

const contextExcerpt = {
  id: "doc_b2c3d4",
  headingPath: `Lender comparison${HEADING_PATH_SEPARATOR}Rates`,
  excerpt: "Three lenders quoted between 5.9% and 6.4% in July.",
  relation: "linked" as const,
};

const thread = {
  id: "th_x9y8",
  title: "Re: 30-year fixed assumption",
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:07:12Z",
  status: "open" as const,
  tags: [],
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "engaged" as const,
  turns: [turn],
};

const threadSummary = {
  id: "th_x9y8",
  title: "Re: 30-year fixed assumption",
  status: "open" as const,
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "engaged" as const,
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:07:12Z",
  turnCount: 1,
  lastAuthor: "user" as const,
  lastTs: "2026-07-19T10:05:00Z",
};

/** The form the stub thread's last agent turn carries, parsed from its fence. */
const STUB_FORM = FormSchema.parse({
  prompt: "Which rate should the model assume?",
  options: ["6.1%", "6.4%"],
});

const queueEvent = {
  id: "evt_7c1d",
  type: "comment.created",
  created: "2026-07-19T10:05:01Z",
  source: "ui",
  payload: {},
};

/**
 * What the server was already holding when the claim arrived (CONTRACT-033).
 * Deliberately a *different* event from `queueEvent`: the two fields answer
 * different questions, and a stub that reused the same id could not show them
 * staying apart.
 */
const inProgressSet = {
  events: [
    {
      id: "evt_held",
      type: "comment.created",
      heldSince: "2026-07-19T09:41:00Z",
      originId: "th_x9y8",
      originTitle: "Re: 30-year fixed assumption",
    },
  ],
  total: 1,
  truncated: false,
};

const queueStatus = {
  halted: false,
  pending: 0,
  inProgress: 0,
  deferred: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

const lock = {
  docId: "doc_a1b2c3",
  holder: "user" as const,
  acquired: "2026-07-19T10:05:00Z",
  ttl: 300,
};

/** Stands in for a job whose log file has reached its size cap. */
const CAPPED_JOB_ID = "evt_full";

const job = {
  eventId: "evt_7c1d",
  type: "comment.created",
  status: "in-progress" as const,
  started: "2026-07-19T10:05:02Z",
  updated: "2026-07-19T10:05:40Z",
  lastLine: null,
  originId: "th_x9y8",
  originTitle: "Re: 30-year fixed assumption",
  blockedOn: null,
  blockedOnTitle: null,
};

/** Shaped exactly as `apps/server`'s `rebuild()` returns it (SERVER-004). */
const rebuildResult = {
  path: "/w/.corpus/cache.db",
  documents: 6,
  threads: 1,
  turns: 2,
  anchors: 1,
  links: 0,
  events: 0,
  jobs: 0,
  locks: 0,
  seen: 1,
  durationMs: 42,
  skipped: [{ path: "data/docs/broken.md", reason: "frontmatter is not valid YAML" }],
};

/** Shaped exactly as `apps/server`'s `doctor()` returns it, with drift to report. */
const doctorReport = {
  ok: false,
  drift: [
    {
      kind: "orphan_row" as const,
      path: "data/docs/gone.md",
      detail: "data/docs/gone.md is projected as doc_a1b2c3 but no such file exists under any root",
    },
    // The one kind that concerns no single file, so it carries a null path.
    {
      kind: "count_mismatch" as const,
      path: null,
      detail: ".corpus/queue holds 2 evt_*.json file(s) but the projection has 1 event row(s)",
    },
  ],
  stats: { files: 6, documents: 7, hashed: 1, parsed: 0, durationMs: 9 },
};

/** A caught-up semantic index: the shape both index routes answer with. */
const indexStatus = {
  indexed: 154,
  pending: 0,
  failed: 0,
  identity: "ollama/nomic-embed-text@768",
  rebuilding: false,
  state: "current" as const,
};

/**
 * Registers **every** contract route against a real handler, exactly the way
 * `apps/server` will (SPEC.md §9.3). The handlers are canned, but the
 * registration is the assertion: a response shape the contract does not declare
 * is a compile error here, and the route table's ordering is exercised by real
 * requests rather than asserted in a comment.
 */
function createStubApp() {
  const app = new OpenAPIHono();

  app.openapi(contractRoutes.getHealth, (c) =>
    c.json(
      { status: "ok" as const, version: CONTRACT_VERSION, uptimeSeconds: 1, workspace: "/w" },
      200,
    ),
  );

  app.openapi(contractRoutes.listDocs, (c) => {
    const { limit, offset, sort } = c.req.valid("query");
    return c.json({ items: [{ ...row, excerpt: sort }], page: { total: 1, limit, offset } }, 200);
  });
  app.openapi(contractRoutes.createDoc, (c) => {
    const body = c.req.valid("json");
    const author = c.req.valid("header")[ACTOR_HEADER];
    return c.json(
      {
        doc: { ...doc, frontmatter: { ...frontmatter, title: `${body.title} by ${author}` } },
        warnings: [],
      },
      201,
    );
  });
  app.openapi(contractRoutes.getDoc, (c) => c.json(doc, 200));
  app.openapi(contractRoutes.updateDoc, (c) =>
    c.json({ doc, anchors: { remapped: [], orphaned: [] }, warnings: [] }, 200),
  );
  app.openapi(contractRoutes.deleteDoc, (c) =>
    c.json(
      { deletedId: c.req.valid("param").id, orphanedThreadIds: ["th_x9y8"], warnings: [] },
      200,
    ),
  );
  app.openapi(contractRoutes.moveDoc, (c) =>
    c.json(
      {
        doc: { ...doc, path: `data/docs/${c.req.valid("json").folder}/mortgage.md` },
        warnings: [],
      },
      200,
    ),
  );
  app.openapi(contractRoutes.archiveDoc, (c) =>
    c.json(
      {
        doc: { ...doc, frontmatter: { ...frontmatter, status: "archived" as const } },
        warnings: [],
      },
      200,
    ),
  );
  app.openapi(contractRoutes.unarchiveDoc, (c) => c.json({ doc, warnings: [] }, 200));

  // The two retrieval reads. Their handlers echo the parsed query back through
  // the frugal shapes, which is what proves a request reaches *them*:
  // `/api/docs/{id}/related` must not be swallowed by `/api/docs/{id}`, and
  // `/api/search` answers hits rather than rows.
  app.openapi(contractRoutes.relatedDocs, (c) => {
    const { id } = c.req.valid("param");
    const { limit, includeArchived } = c.req.valid("query");
    return c.json(
      {
        related: [
          {
            id: "doc_b2c3d4",
            title: `related to ${id}`,
            excerpt: `limit=${String(limit)} includeArchived=${String(includeArchived ?? false)}`,
            relation: "linked" as const,
          },
        ],
      },
      200,
    );
  });
  // The third one-segment read off a document (CONTRACT-028), and the same
  // routing hazard: the echoed range proves the request reached *this* handler
  // rather than the document read, and proves which defaults the validator left
  // for the server to fill in.
  app.openapi(contractRoutes.getDocDiff, (c) => {
    const { id } = c.req.valid("param");
    const { from, to } = c.req.valid("query");
    return c.json(
      {
        id,
        path: doc.path,
        from: from ?? EMPTY_TREE_OBJECT_ID,
        to: to ?? DEFAULT_HEAD_SHA,
        stats: { commits: 1, insertions: 3, deletions: 1 },
        diff: `from=${from ?? "default"} to=${to ?? "default"}`,
        truncated: false,
        totalChars: 24,
      },
      200,
    );
  });
  // §4's other end (CONTRACT-031). Body-less in both directions, so the status
  // is the whole answer; what the flush does to a session is exercised against a
  // real tracker's semantics in `./edit-session.test.ts`.
  app.openapi(contractRoutes.flushEditSession, (c) => {
    c.req.valid("param");
    return c.body(null, 204);
  });
  app.openapi(contractRoutes.searchCorpus, (c) => {
    const { q, limit, type } = c.req.valid("query");
    return c.json(
      {
        hits: [
          {
            id: "doc_a1b2c3",
            title: "Mortgage options",
            headingPath: `Mortgage options${HEADING_PATH_SEPARATOR}Rates`,
            snippet: `${q} · limit=${String(limit)} · type=${type ?? "any"}`,
          },
        ],
        semanticIndex: "current" as const,
      },
      200,
    );
  });

  app.openapi(contractRoutes.getTree, (c) =>
    c.json(
      {
        folders: [
          {
            path: "finance",
            name: "finance",
            count: 1,
            totalCount: 2,
            children: [
              { path: "finance/loans", name: "loans", count: 1, totalCount: 1, children: [] },
            ],
          },
        ],
      },
      200,
    ),
  );
  app.openapi(contractRoutes.capture, (c) => {
    const body = c.req.valid("form");
    return c.json(
      {
        docId: "doc_a1b2c3",
        threadId: "th_x9y8",
        eventId: body.requestsAgent === false ? null : "evt_7c1d",
        warnings: [],
      },
      201,
    );
  });

  // Dual-media, so it is mounted rather than `app.openapi`-ed: the echoed
  // `title` proves which form the validator actually saw.
  mountCreateThread(app, (c) => {
    const body = c.req.valid("json");
    const multipart = isMultipartThreadCreate(body);
    return c.json(
      {
        thread: {
          ...thread,
          title: multipart ? `multipart:${String(body.files.length)}` : `json:${body.body}`,
          parent: body.parent ?? null,
        },
        anchorId: body.selector ? "anc_k4f7" : null,
        eventId: null,
        warnings: [],
      },
      201,
    );
  });
  app.openapi(contractRoutes.getThread, (c) => c.json(thread, 200));
  // The context pack (CONTRACT-024). The handler branches on the id so the
  // mounted route proves the discriminated response actually serialises — a
  // union answer is the one shape a single stub reply would not exercise.
  app.openapi(contractRoutes.getThreadContext, (c) => {
    const { id } = c.req.valid("param");
    const base = { threadId: id, excerpts: [contextExcerpt], semanticIndex: "current" as const };
    if (id === "th_standalone") return c.json({ shape: "standalone" as const, ...base }, 200);
    if (id === "th_gone") {
      return c.json(
        { shape: "parent-deleted" as const, ...base, deletedParent: "doc_a1b2c3" },
        200,
      );
    }
    return c.json(
      {
        shape: "anchored" as const,
        ...base,
        parent: {
          id: "doc_a1b2c3",
          title: "Mortgage options",
          headingPath: `Mortgage options${HEADING_PATH_SEPARATOR}Rates`,
          quote: "the 30-year fixed rate assumption is 6.1%",
          section: "## Rates\n\nWe assume the 30-year fixed rate assumption is 6.1%.",
          truncated: false,
        },
      },
      200,
    );
  });
  mountAppendTurn(app, (c) =>
    c.json({ thread: threadSummary, turn, eventId: null, warnings: [] }, 201),
  );
  app.openapi(contractRoutes.deleteTurn, (c) =>
    c.json(
      {
        deletedTurn: true as const,
        deletedThread: false,
        removedAnchor: null,
        parentId: c.req.valid("param").ts === turn.ts ? "doc_a1b2c3" : null,
        // A turn deletion that cascades to the parent's frontmatter is exactly
        // where a rejected auto-commit has to surface (SPEC.md §14).
        warnings: [{ code: "commit_failed" as const, detail: "pre-commit hook exited 1" }],
      },
      200,
    ),
  );
  // Resolving rewrites and auto-commits the thread file, which is exactly where a
  // rejected hook has to surface (SPEC.md §14) — so the stub warns here rather
  // than returning the tidy empty array.
  app.openapi(contractRoutes.resolveThread, (c) =>
    c.json(
      {
        thread: { ...threadSummary, status: "resolved" as const },
        warnings: [{ code: "commit_failed" as const, detail: "pre-commit hook exited 1" }],
      },
      200,
    ),
  );
  app.openapi(contractRoutes.reopenThread, (c) =>
    c.json({ thread: threadSummary, warnings: [] }, 200),
  );

  // The answer is validated against the form it answers, which no static schema
  // can express: the legal values are whatever the agent wrote into the fence.
  app.openapi(contractRoutes.respondToForm, (c) => {
    const answer = c.req.valid("json");
    const rejection = validateFormAnswer(STUB_FORM, answer);
    if (rejection) return c.json(rejection, 400);
    return c.json(
      {
        thread: threadSummary,
        turn: {
          ...turn,
          // Prose naming every field and what was given for it — the shape §6
          // requires; the server owns its exact wording (SERVER-068).
          body: [
            ...answer.answers.map(
              (entry) =>
                `${entry.question} — ${entry.option ?? entry.options?.join(", ") ?? entry.text ?? "(blank)"}`,
            ),
            ...(answer.note === undefined ? [] : ["", answer.note]),
          ].join("\n"),
        },
        eventId: "evt_7c1d",
        warnings: [],
      },
      201,
    );
  });
  // `unread` is a plain boolean, so the partial read is expressible: a mark
  // before the thread's last turn leaves later turns unseen, and the badge stays
  // lit. The stub thread's last turn is `turn.ts`.
  app.openapi(contractRoutes.markThreadSeen, (c) => {
    const lastSeenTs = c.req.valid("json")?.lastSeenTs ?? turn.ts;
    return c.json(
      { threadId: c.req.valid("param").id, lastSeenTs, unread: lastSeenTs < turn.ts },
      200,
    );
  });

  app.openapi(contractRoutes.getQueueStatus, (c) => c.json(queueStatus, 200));
  app.openapi(contractRoutes.idleQueue, (c) =>
    c.req.valid("query").timeout === 1
      ? c.body(null, 204)
      : c.json({ events: [queueEvent], inProgress: inProgressSet }, 200),
  );
  // The claimed batch and the held set are distinct fields carrying distinct
  // events (CONTRACT-033) — a handler that merged them would still satisfy the
  // route, so the stub keeps them visibly disjoint and the assertions check it.
  app.openapi(contractRoutes.claimAll, (c) =>
    c.json({ events: [queueEvent], inProgress: inProgressSet }, 200),
  );
  app.openapi(contractRoutes.reapStale, (c) =>
    c.json({ reaped: ["evt_7c1d"], failed: ["evt_dead"] }, 200),
  );
  app.openapi(contractRoutes.haltQueue, (c) =>
    // `pending` doubles as the echo of the optional reason's length: the status
    // shape carries no string field, and the length proves the annotation
    // reached the handler intact.
    c.json({ ...queueStatus, halted: true, pending: c.req.valid("json").reason?.length ?? 0 }, 200),
  );
  app.openapi(contractRoutes.resumeQueue, (c) => c.json(queueStatus, 200));
  app.openapi(contractRoutes.completeEvent, (c) => c.json(queueEvent, 200));
  app.openapi(contractRoutes.failEvent, (c) => c.json(queueEvent, 200));
  // The deferral's blocking document is echoed through the event payload, which
  // is the only field of the wire event a handler may shape: it proves the
  // mandatory `blockedOn` reached the handler rather than being dropped.
  app.openapi(contractRoutes.deferEvent, (c) => {
    const { blockedOn, reason } = c.req.valid("json");
    return c.json({ ...queueEvent, payload: { blockedOn, reason: reason ?? null } }, 200);
  });
  app.openapi(contractRoutes.abandonEvent, (c) => c.json(queueEvent, 200));

  app.openapi(contractRoutes.listLocks, (c) => c.json({ locks: [lock] }, 200));
  app.openapi(contractRoutes.reapLocks, (c) => c.json({ reaped: ["doc_a1b2c3"] }, 200));
  app.openapi(contractRoutes.acquireLock, (c) =>
    c.json({ ...lock, docId: c.req.valid("param").docId }, 201),
  );
  app.openapi(contractRoutes.releaseLock, (c) =>
    c.json(
      { docId: c.req.valid("param").docId, released: true as const, holder: "user" as const },
      200,
    ),
  );
  app.openapi(contractRoutes.breakLock, (c) =>
    c.json(
      { docId: c.req.valid("param").docId, released: true as const, holder: "agent" as const },
      200,
    ),
  );

  app.openapi(contractRoutes.listJobs, (c) => c.json({ jobs: [job] }, 200));
  app.openapi(contractRoutes.getJobLog, (c) =>
    c.json({ lines: [{ ts: job.updated, line: "step" }], nextCursor: 1 }, 200),
  );
  // `appended` is a plain boolean, so the capped case is expressible: the
  // sentinel id below stands in for a log that has reached its size cap.
  app.openapi(contractRoutes.appendJobLog, (c) => {
    const eventId = c.req.valid("param").id;
    return c.json({ eventId, appended: eventId !== CAPPED_JOB_ID }, 201);
  });
  app.openapi(contractRoutes.retryJob, (c) => c.json({ ...job, status: "pending" as const }, 200));
  app.openapi(contractRoutes.abandonJob, (c) =>
    c.json({ ...job, status: "abandoned" as const }, 200),
  );

  app.openapi(contractRoutes.rebuildDb, (c) => c.json(rebuildResult, 200));
  app.openapi(contractRoutes.doctorDb, (c) => c.json(doctorReport, 200));

  // The semantic-index pair answers with one shape under two status codes: the
  // status read is a `200`, the rebuild's post-queue acknowledgement a `202`.
  app.openapi(contractRoutes.getIndexStatus, (c) => c.json(indexStatus, 200));
  app.openapi(contractRoutes.rebuildIndex, (c) =>
    c.json({ ...indexStatus, pending: 12, rebuilding: true, state: "indexing" as const }, 202),
  );

  // The report echoes which branch of the XOR the validator actually saw: `ids`
  // reports nothing, `documents` reports one finding per submitted pair, so a
  // request that reached the wrong branch is visible rather than plausible.
  app.openapi(contractRoutes.checkDocuments, (c) => {
    const body = c.req.valid("json");
    if ("ids" in body) return c.json({ ok: true, errors: [], warnings: [] }, 200);
    return c.json(
      {
        ok: false,
        errors: body.documents.map((entry) => ({
          code: "frontmatter-unparseable" as const,
          severity: "error" as const,
          docId: null,
          path: entry.path,
          detail: `${String(entry.content.length)} bytes staged`,
        })),
        warnings: [],
      },
      200,
    );
  });
  // A skill is an ordinary document, so its creation returns the ordinary
  // mutation response — the same shape `POST /api/docs` answers with.
  app.openapi(contractRoutes.createSkill, (c) => {
    const { name, title } = c.req.valid("json");
    return c.json(
      {
        doc: {
          ...doc,
          frontmatter: { ...frontmatter, type: "skill", title: title ?? name },
          path: `.claude/skills/${name}/SKILL.md`,
        },
        warnings: [],
      },
      201,
    );
  });
  app.openapi(contractRoutes.rollbackSkill, (c) => {
    const { name } = c.req.valid("param");
    return c.json(
      {
        name,
        docId: "doc_a1b2c3",
        commit: "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456",
        path: `.claude/skills/${name}/SKILL.md`,
        // The revert is an auto-commit like any other, so the hook-rejection
        // channel has to be expressible here (SPEC.md §14).
        warnings:
          c.req.valid("json")?.to === undefined
            ? []
            : [{ code: "commit_failed" as const, detail: "pre-commit hook exited 1" }],
      },
      200,
    );
  });

  // The check reaches GitHub only when called and keeps nothing between calls,
  // so a stub is a whole implementation of its contract minus the fetch.
  app.openapi(contractRoutes.checkUpgrade, (c) =>
    c.json(
      {
        installed: "0.3.0",
        latest: "0.4.0",
        upgradeAvailable: true,
        verifiable: true,
        notesUrl: "https://github.com/trupin/corpus/releases/tag/v0.4.0",
        reachable: true,
        detail: null,
      },
      200,
    ),
  );
  // `202`, and a body that reports only what is already true: a process exists,
  // and here is where it will write its report.
  app.openapi(contractRoutes.startUpgrade, (c) =>
    c.json({ started: true as const, logPath: ".corpus/upgrade.log" }, 202),
  );

  app.openapi(contractRoutes.streamEvents, (c) =>
    c.newResponse("event: invalidate\ndata: {}\n\n", 200, {
      "content-type": "text/event-stream",
    }),
  );
  app.openapi(contractRoutes.getAttachment, (c) =>
    c.newResponse(c.req.valid("param").path, 200, {
      "content-type": "application/octet-stream",
    }),
  );

  return app;
}

describe("contract route registry", () => {
  it("exposes every declared route in the flat list", () => {
    expect(ALL_CONTRACT_ROUTES).toHaveLength(Object.keys(contractRoutes).length);
  });

  it("gives each route a distinct method and path", () => {
    const signatures = ALL_CONTRACT_ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("declares exactly the pinned endpoint inventory", () => {
    const declared = ALL_CONTRACT_ROUTES.map((route) =>
      endpointSignature(route.method, route.path),
    );
    expect([...declared].sort()).toEqual([...ENDPOINT_INVENTORY].sort());
  });

  /**
   * Static-before-parameter is load-bearing: `/api/locks/reap` and
   * `/api/locks/{docId}` compete for the same position, and a `docId` of `reap`
   * would otherwise be indistinguishable. The failure mode is silent misrouting,
   * so the order is held by a test rather than by a comment.
   */
  it.each([
    ["/api/locks/reap", "/api/locks/{docId}"],
    ["/api/queue/reap-stale", "/api/queue/{id}/complete"],
    ["/api/queue/claim-all", "/api/queue/{id}/complete"],
    ["/api/queue/halt", "/api/queue/{id}"],
    ["/api/queue/resume", "/api/queue/{id}"],
  ])("registers %s before its parameterised peer %s", (staticPath, parameterisedPath) => {
    const paths: string[] = ALL_CONTRACT_ROUTES.map((route) => route.path);
    expect(paths.indexOf(staticPath)).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf(staticPath)).toBeLessThan(paths.indexOf(parameterisedPath));
  });
});

describe("routes mounted on a Hono app", () => {
  it("serves the OpenAPI document from the mounted definitions", async () => {
    const app = createStubApp();
    app.doc31("/doc", {
      openapi: "3.1.0",
      info: { title: "Corpus API", version: CONTRACT_VERSION },
    });

    const response = await app.request("/doc");
    expect(response.status).toBe(200);

    const document = (await response.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    };
    expect(document.openapi).toBe("3.1.0");

    const mounted: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of ["get", "post", "put", "delete"]) {
        if (method in item) mounted.push(endpointSignature(method, path));
      }
    }
    expect(mounted.sort()).toEqual([...ENDPOINT_INVENTORY].sort());
  });

  it("answers the unauthenticated health probe", async () => {
    const response = await createStubApp().request("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("applies the declared pagination and sort defaults to a bare list request", async () => {
    const response = await createStubApp().request("/api/docs");
    const list = (await response.json()) as {
      items: { excerpt: string }[];
      page: { limit: number; offset: number };
    };
    expect(list.page).toEqual({ total: 1, limit: 50, offset: 0 });
    expect(list.items[0]?.excerpt).toBe("-updated");
  });

  /**
   * CONTRACT-012's rider. The string-boolean is validated at the route, not
   * coerced: `includeArchived=maybe` would otherwise read as `true` and quietly
   * widen a result set the caller never asked to widen.
   */
  it.each(["true", "false", "1", "0"])(
    "accepts includeArchived=%s on the collection query",
    async (raw) => {
      expect((await createStubApp().request(`/api/docs?includeArchived=${raw}`)).status).toBe(200);
    },
  );

  it.each(["maybe", "archived", ""])("rejects includeArchived=%s with a 400", async (raw) => {
    expect((await createStubApp().request(`/api/docs?includeArchived=${raw}`)).status).toBe(400);
  });

  it("rejects sort=relevance without a query, rather than falling back", async () => {
    const app = createStubApp();
    expect((await app.request("/api/docs?sort=relevance")).status).toBe(400);
    expect((await app.request("/api/docs?sort=relevance&q=rates")).status).toBe(200);
  });

  it("validates path parameters against the id pattern", async () => {
    const app = createStubApp();
    expect((await app.request("/api/docs/doc_a1b2c3")).status).toBe(200);
    expect((await app.request("/api/docs/not-an-id")).status).toBe(400);
  });

  /**
   * The routing half of CONTRACT-022: `/api/docs/{id}/related` sits one segment
   * below `/api/docs/{id}`, so a real request has to prove it reaches the
   * related handler rather than the document read. Asserted by the *answer*,
   * since both routes are `200`s on the same id.
   */
  it("routes /api/docs/{id}/related to the related handler, not the document read", async () => {
    const app = createStubApp();
    const response = await app.request("/api/docs/doc_a1b2c3/related");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { related: { title: string; excerpt: string }[] };
    expect(body.related[0]?.title).toBe("related to doc_a1b2c3");
    expect(body.related[0]?.excerpt).toBe("limit=10 includeArchived=false");

    const read = (await (await app.request("/api/docs/doc_a1b2c3")).json()) as {
      body: string;
    };
    expect(read.body).toBe("Body.");
  });

  /**
   * The same routing hazard once more (CONTRACT-028): `/api/docs/{id}/diff` is
   * a `GET` a segment below `/api/docs/{id}`, and both answer `200` on the same
   * id, so the *answer* is the assertion. It also pins the shape of the bare
   * call SPEC.md §4 spells — `corpus doc diff <id>` with no range — reaching the
   * handler with both query values absent, for the server to default.
   */
  it("routes /api/docs/{id}/diff to the diff handler, not the document read", async () => {
    const app = createStubApp();
    const response = await app.request("/api/docs/doc_a1b2c3/diff");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { id: string; diff: string; from: string };
    expect(body.id).toBe("doc_a1b2c3");
    expect(body.diff).toBe("from=default to=default");
    expect(body.from).toBe(EMPTY_TREE_OBJECT_ID);

    const read = (await (await app.request("/api/docs/doc_a1b2c3")).json()) as { body: string };
    expect(read.body).toBe("Body.");
  });

  /**
   * The static segment below `{id}` (CONTRACT-031) shares its depth with `move`,
   * `archive` and `unarchive`, so nothing competes with the parameter — but
   * misrouting here would be silent, and the flush answers `204` where the
   * document read answers `200`, so the status alone separates them.
   */
  it("routes /api/docs/{id}/edit-session/flush to the flush, not the document read", async () => {
    const app = createStubApp();

    const flushed = await app.request("/api/docs/doc_a1b2c3/edit-session/flush", {
      method: "POST",
    });
    expect(flushed.status).toBe(204);
    expect(await flushed.text()).toBe("");

    const read = await app.request("/api/docs/doc_a1b2c3");
    expect(read.status).toBe(200);
    expect(((await read.json()) as { body: string }).body).toBe("Body.");
  });

  it("applies the retrieval caps and rejects a limit past the maximum", async () => {
    const app = createStubApp();
    expect((await app.request("/api/docs/doc_a1b2c3/related?limit=50")).status).toBe(200);
    expect((await app.request("/api/docs/doc_a1b2c3/related?limit=51")).status).toBe(400);
    expect((await app.request("/api/search?q=rates&limit=51")).status).toBe(400);
    expect((await app.request("/api/search?q=rates&limit=0")).status).toBe(400);
  });

  /**
   * The routing half of CONTRACT-024, and the same hazard one resource over:
   * `/api/threads/{id}/context` sits a segment below `/api/threads/{id}`, so a
   * real request has to prove it reaches the pack rather than the thread read.
   * Both are `200`s on the same id, so the *answer* is the assertion.
   */
  it("routes /api/threads/{id}/context to the pack, not the thread read", async () => {
    const app = createStubApp();
    const response = await app.request("/api/threads/th_x9y8/context");
    expect(response.status).toBe(200);
    const pack = (await response.json()) as {
      shape: string;
      threadId: string;
      parent: { section: string };
      excerpts: { headingPath: string }[];
    };
    expect(pack.shape).toBe("anchored");
    expect(pack.threadId).toBe("th_x9y8");
    expect(pack.parent.section).toContain("6.1%");
    expect(pack.excerpts[0]?.headingPath).toBe(`Lender comparison${HEADING_PATH_SEPARATOR}Rates`);

    const read = (await (await app.request("/api/threads/th_x9y8")).json()) as {
      turns: unknown[];
    };
    expect(read.turns).toHaveLength(1);
  });

  /**
   * The union answers over the wire, not just in the document: three requests,
   * three different shapes off one mounted route. The parent-deleted case is the
   * one worth a live request — it is a `200` about a thread whose parent is
   * gone, and a naive server answers `404` there.
   */
  it.each([
    ["th_standalone", "standalone"],
    ["th_gone", "parent-deleted"],
    ["th_x9y8", "anchored"],
  ])("serialises %s as the %s shape", async (id, shape) => {
    const response = await createStubApp().request(`/api/threads/${id}/context`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { shape: string }).shape).toBe(shape);
  });

  it("validates the thread id on the pack route, and takes no query parameters", async () => {
    const app = createStubApp();
    expect((await app.request("/api/threads/doc_a1b2c3/context")).status).toBe(400);
    // Tolerant reads: an undeclared parameter is stripped, never a 400 — but the
    // route declares none at all, which is what makes `--json` the CLI's only flag.
    expect((await app.request("/api/threads/th_x9y8/context?limit=50")).status).toBe(200);
  });

  it("refuses a search with no query and answers hits with one", async () => {
    const app = createStubApp();
    expect((await app.request("/api/search")).status).toBe(400);
    expect((await app.request("/api/search?q=")).status).toBe(400);

    const response = await app.request("/api/search?q=rates&type=note");
    expect(response.status).toBe(200);
    const results = (await response.json()) as {
      hits: { snippet: string; headingPath: string }[];
    };
    expect(results.hits[0]?.snippet).toBe("rates · limit=10 · type=note");
    expect(results.hits[0]?.headingPath).toBe(`Mortgage options${HEADING_PATH_SEPARATOR}Rates`);
  });

  /**
   * Queries are tolerant by policy (`schemas/index.ts`), so the three
   * `GET /api/docs` parameters `/api/search` does not declare are **stripped,
   * not rejected**. Written down as a real request because "an agent that
   * passes it and gets silence deserves to have been told" — the telling is the
   * route description, and this is the behaviour it describes.
   */
  it("ignores pinned, sort and offset on a search rather than rejecting them", async () => {
    const response = await createStubApp().request(
      "/api/search?q=rates&sort=relevance&offset=10&pinned=true",
    );
    expect(response.status).toBe(200);
    const results = (await response.json()) as { hits: { snippet: string }[] };
    expect(results.hits[0]?.snippet).toBe("rates · limit=10 · type=any");
  });

  it("defaults the acting party to the user when the header is absent", async () => {
    const response = await createStubApp().request("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", title: "New" }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { doc: { frontmatter: { title: string } } };
    expect(created.doc.frontmatter.title).toBe("New by user");
  });

  it("carries an explicit agent attribution through to the handler", async () => {
    const response = await createStubApp().request("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json", [ACTOR_HEADER]: "agent" },
      body: JSON.stringify({ type: "note", title: "New" }),
    });
    const created = (await response.json()) as { doc: { frontmatter: { title: string } } };
    expect(created.doc.frontmatter.title).toBe("New by agent");
  });

  it("rejects an actor outside the two parties", async () => {
    const response = await createStubApp().request("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json", [ACTOR_HEADER]: "robot" },
      body: JSON.stringify({ type: "note", title: "New" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a request body the contract does not accept", async () => {
    const response = await createStubApp().request("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", title: "" }),
    });
    expect(response.status).toBe(400);
  });

  /** A `docId` literally named `reap` must not swallow the reap verb, and vice versa. */
  it.each([
    ["/api/locks/reap", '{"reaped":["doc_a1b2c3"]}'],
    ["/api/queue/reap-stale", '{"reaped":["evt_7c1d"],"failed":["evt_dead"]}'],
  ])("routes %s to its own handler, not to the parameterised peer", async (path, expected) => {
    const response = await createStubApp().request(path, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expected);
  });

  it("still reaches the parameterised lock route for a real document id", async () => {
    const response = await createStubApp().request("/api/locks/doc_a1b2c3", { method: "POST" });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ docId: "doc_a1b2c3" });
  });

  /** The turn timestamp is an ISO instant, so it carries `:` and must arrive percent-encoded. */
  it("matches a URL-encoded ISO timestamp in the turn-deletion path", async () => {
    const encoded = encodeURIComponent(turn.ts);
    expect(encoded).toBe("2026-07-19T10%3A05%3A00Z");
    const response = await createStubApp().request(`/api/threads/th_x9y8/turns/${encoded}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedTurn: true,
      deletedThread: false,
      removedAnchor: null,
      parentId: "doc_a1b2c3",
      warnings: [{ code: "commit_failed", detail: "pre-commit hook exited 1" }],
    });
  });

  it("rejects a turn timestamp that is not an instant", async () => {
    const response = await createStubApp().request("/api/threads/th_x9y8/turns/yesterday", {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
  });

  /**
   * CONTRACT-009. *Ask* with a screenshot: before it, `POST /api/threads` was
   * JSON-only and the only attachment ingest in the product was Capture.
   */
  const createThreadRequest = (init: RequestInit) =>
    createStubApp().request("/api/threads", { method: "POST", ...init });

  it("still accepts the JSON form of thread creation, unchanged", async () => {
    const response = await createThreadRequest({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "why 6.1%?" }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      thread: { title: "json:why 6.1%?", parent: null },
      anchorId: null,
    });
  });

  it("accepts a multipart thread whose first turn is attachment-only", async () => {
    const form = new FormData();
    form.append("files", new File(["bytes"], "shot.png", { type: "image/png" }));
    const response = await createThreadRequest({ body: form });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      thread: { title: "multipart:1" },
      anchorId: null,
    });
  });

  it("carries a JSON-encoded selector through the multipart form", async () => {
    const form = new FormData();
    form.append("text", "why this figure?");
    form.append("parent", "doc_a1b2c3");
    form.append("selector", JSON.stringify({ exact: "a 30-year fixed at 6.1%" }));
    form.append("files", new File(["bytes"], "shot.png", { type: "image/png" }));
    const response = await createThreadRequest({ body: form });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      thread: { parent: "doc_a1b2c3" },
      anchorId: "anc_k4f7",
    });
  });

  it("rejects a multipart selector that is not a selector", async () => {
    const form = new FormData();
    form.append("text", "why this figure?");
    form.append("selector", "not json at all");
    expect((await createThreadRequest({ body: form })).status).toBe(400);

    const empty = new FormData();
    empty.append("text", "why this figure?");
    empty.append("selector", JSON.stringify({ prefix: "no quote" }));
    expect((await createThreadRequest({ body: empty })).status).toBe(400);
  });

  it("rejects a multipart thread carrying neither text nor files", async () => {
    expect((await createThreadRequest({ body: new FormData() })).status).toBe(400);
  });

  it("rejects a thread creation with no body and no content type at all", async () => {
    const response = await createThreadRequest({});
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(MISSING_THREAD_BODY_ERROR);
  });

  it("accepts a multipart turn with a file and no text", async () => {
    const form = new FormData();
    form.append("files", new File(["bytes"], "shot.png", { type: "image/png" }));
    const response = await createStubApp().request("/api/threads/th_x9y8/turns", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(201);
  });

  it("rejects a multipart turn carrying neither text nor files", async () => {
    const response = await createStubApp().request("/api/threads/th_x9y8/turns", {
      method: "POST",
      body: new FormData(),
    });
    expect(response.status).toBe(400);
  });

  it("still accepts the JSON form of the same turn-append route", async () => {
    const response = await createStubApp().request("/api/threads/th_x9y8/turns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "hi" }),
    });
    expect(response.status).toBe(201);
  });

  /**
   * The forms surface, exercised through the mounted route rather than asserted
   * against the schema: the answer is validated against the *fence's* options,
   * which is the half a static schema cannot express (SPEC.md §6).
   */
  const answerForm = (body: unknown, ts = turn.ts) =>
    createStubApp().request(`/api/threads/th_x9y8/turns/${encodeURIComponent(ts)}/form`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  /** The stub form is the *shorthand* spelling, so this exercises it end to end. */
  const QUESTION = "Which rate should the model assume?";

  it("accepts an option the answered form offers", async () => {
    const response = await answerForm({ answers: [{ question: QUESTION, option: "6.4%" }] });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      turn: { body: `${QUESTION} — 6.4%` },
      eventId: "evt_7c1d",
      warnings: [],
    });
  });

  it("carries the optional note into the answer turn", async () => {
    const response = await answerForm({
      answers: [{ question: QUESTION, option: "6.1%" }],
      note: "matches the Q2 sheet",
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      turn: { body: `${QUESTION} — 6.1%\n\nmatches the Q2 sheet` },
    });
  });

  it("rejects an option the form does not offer, naming the field", async () => {
    const response = await answerForm({ answers: [{ question: QUESTION, option: "5.0%" }] });
    expect(response.status).toBe(400);
    const rejection = (await response.json()) as {
      code: string;
      issues: { path: string; message: string }[];
    };
    expect(rejection.code).toBe("bad_request");
    expect(rejection.issues).toHaveLength(1);
    expect(rejection.issues[0]?.path).toBe("body.answers[0].option");
    expect(rejection.issues[0]?.message).toContain("6.1%");
  });

  /** The required field is unanswered in every one of these, spelled three ways. */
  it("rejects an answer that chooses nothing at all", async () => {
    expect((await answerForm({ answers: [], note: "hmm" })).status).toBe(400);
    expect((await answerForm({ note: "hmm" })).status).toBe(400);
    expect((await answerForm({ answers: [{ question: QUESTION }] })).status).toBe(400);
    expect((await answerForm({ answers: [{ question: QUESTION, option: "" }] })).status).toBe(400);
  });

  it("rejects a form timestamp that is not an instant", async () => {
    const body = { answers: [{ question: QUESTION, option: "6.1%" }] };
    expect((await answerForm(body, "yesterday")).status).toBe(400);
  });

  it("reports both halves of a reap, keeping the given-up events out of `reaped`", async () => {
    const response = await createStubApp().request("/api/queue/reap-stale", { method: "POST" });
    const result = (await response.json()) as { reaped: string[]; failed: string[] };
    expect(result.reaped).not.toContain("evt_dead");
    expect(result.failed).toEqual(["evt_dead"]);
  });

  it("carries a thread mutation's warnings on the wrapper, not on the summary", async () => {
    const response = await createStubApp().request("/api/threads/th_x9y8/resolve", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      thread: Record<string, unknown>;
      warnings: { code: string }[];
    };
    expect(body.warnings).toEqual([{ code: "commit_failed", detail: "pre-commit hook exited 1" }]);
    expect(body.thread.status).toBe("resolved");
    expect(body.thread).not.toHaveProperty("warnings");
  });

  it("labels a job row with its origin's title", async () => {
    const response = await createStubApp().request("/api/jobs");
    const list = (await response.json()) as { jobs: { originId: string; originTitle: string }[] };
    expect(list.jobs[0]?.originId).toBe("th_x9y8");
    expect(list.jobs[0]?.originTitle).toBe("Re: 30-year fixed assumption");
  });

  /** CONTRACT-012's rider: the console row is `<event type> · <title>`. */
  it("carries the event type on a job row, so the console can say what is running", async () => {
    const response = await createStubApp().request("/api/jobs");
    const list = (await response.json()) as { jobs: { type: string }[] };
    expect(list.jobs[0]?.type).toBe("comment.created");
  });

  it('preserves an explicit "note only" through the multipart capture body', async () => {
    const form = new FormData();
    form.append("text", "a thought");
    form.append("requestsAgent", "false");
    const response = await createStubApp().request("/api/capture", { method: "POST", body: form });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ eventId: null });
  });

  it("enqueues by default when the capture leaves the signal unset", async () => {
    const form = new FormData();
    form.append("text", "a thought");
    const response = await createStubApp().request("/api/capture", { method: "POST", body: form });
    await expect(response.json()).resolves.toMatchObject({ eventId: "evt_7c1d" });
  });

  it("answers the long-poll timeout with a bodiless 204", async () => {
    const response = await createStubApp().request("/api/queue/idle?timeout=1");
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("answers a live long-poll with the pending events", async () => {
    const response = await createStubApp().request("/api/queue/idle");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ events: [{ id: "evt_7c1d" }] });
  });

  /**
   * CONTRACT-033. The point of the field is that an agent can tell the two
   * lists apart, so the assertion is about separation as much as presence: the
   * claimed event is in `events` and only there, the held one is in
   * `inProgress.events` and only there.
   */
  it("hands the agent the in-progress set beside the events it just claimed", async () => {
    const response = await createStubApp().request("/api/queue/claim-all", { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: { id: string }[];
      inProgress: { events: { id: string; heldSince: string; originTitle: string }[] };
    };
    expect(body.events.map((event) => event.id)).toEqual(["evt_7c1d"]);
    expect(body.inProgress.events.map((event) => event.id)).toEqual(["evt_held"]);
    expect(body.inProgress.events[0]?.heldSince).toBe("2026-07-19T09:41:00Z");
    expect(body.inProgress.events[0]?.originTitle).toBe("Re: 30-year fixed assumption");
  });

  /** The rider's resolved Q1: the list rides on `idle` too, whenever it returns work. */
  it("reports the in-progress set on a live long-poll too", async () => {
    const response = await createStubApp().request("/api/queue/idle");
    await expect(response.json()).resolves.toMatchObject({
      inProgress: { events: [{ id: "evt_held" }], total: 1, truncated: false },
    });
  });

  /**
   * The kill switch must stay reachable with nothing but a verb and a URL, so
   * the annotation had to be added without making the body mandatory.
   */
  it("halts on a bare POST that sends no body and no content type", async () => {
    const response = await createStubApp().request("/api/queue/halt", { method: "POST" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ halted: true, pending: 0 });
  });

  it("halts on an explicitly empty JSON body", async () => {
    const response = await createStubApp().request("/api/queue/halt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ halted: true, pending: 0 });
  });

  it("carries an optional halt reason through to the handler", async () => {
    const response = await createStubApp().request("/api/queue/halt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "deploying" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ halted: true, pending: 9 });
  });

  it("rejects a blank halt reason", async () => {
    const response = await createStubApp().request("/api/queue/halt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "" }),
    });
    expect(response.status).toBe(400);
  });

  /**
   * CONTRACT-021. The mandatory half of the defer body is what makes automatic
   * re-entry possible at all, so the route is exercised from both sides: the
   * blocking document reaches the handler, and a deferral without one never
   * gets that far.
   */
  const defer = (body: unknown) =>
    createStubApp().request("/api/queue/evt_7c1d/defer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("carries the blocking document and note through to the defer handler", async () => {
    const response = await defer({ blockedOn: "doc_a1b2c3", reason: "user is editing" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      payload: { blockedOn: "doc_a1b2c3", reason: "user is editing" },
    });
  });

  it("defers with no note at all", async () => {
    const response = await defer({ blockedOn: "th_x9y8" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      payload: { blockedOn: "th_x9y8", reason: null },
    });
  });

  it.each([
    {},
    { reason: "locked" },
    { blockedOn: "evt_7c1d" },
    { blockedOn: "doc_a1b2c3", docId: "doc_a1b2c3" },
  ])("rejects the unusable defer body %j before any handler runs", async (body) => {
    expect((await defer(body)).status).toBe(400);
  });

  /**
   * The whole point of relaxing `appended` from `literal(true)`: a log at its
   * size cap answers `201` and has to be able to say the line was dropped.
   */
  it("lets the job-log ingest answer 201 while reporting the line was not appended", async () => {
    const app = createStubApp();
    const ingest = (id: string) =>
      app.request(`/api/jobs/${id}/log`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ line: "step" }),
      });

    const accepted = await ingest("evt_7c1d");
    expect(accepted.status).toBe(201);
    await expect(accepted.json()).resolves.toEqual({ eventId: "evt_7c1d", appended: true });

    const capped = await ingest(CAPPED_JOB_ID);
    expect(capped.status).toBe(201);
    await expect(capped.json()).resolves.toEqual({ eventId: CAPPED_JOB_ID, appended: false });
  });

  /**
   * The whole point of relaxing `unread` from `literal(false)`: a mark placed
   * before the thread's last turn is a partial read (SPEC.md §7), and the
   * response has to be able to say the thread is still unread rather than have
   * the client clear a badge the next `GET /api/docs` re-raises.
   */
  it("reports a partial mark as still unread, and a full one as read", async () => {
    const markSeen = (body?: string) =>
      createStubApp().request("/api/threads/th_x9y8/seen", {
        method: "POST",
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body }),
      });

    const partial = await markSeen(JSON.stringify({ lastSeenTs: "2026-07-19T10:00:00Z" }));
    expect(partial.status).toBe(200);
    await expect(partial.json()).resolves.toEqual({
      threadId: "th_x9y8",
      lastSeenTs: "2026-07-19T10:00:00Z",
      unread: true,
    });

    // A bare POST means "I opened it": the mark lands on the last turn.
    const full = await markSeen();
    expect(full.status).toBe(200);
    await expect(full.json()).resolves.toEqual({
      threadId: "th_x9y8",
      lastSeenTs: turn.ts,
      unread: false,
    });
  });

  /** A bodiless `POST`: no content type, no bytes, and still a valid call. */
  it("rebuilds the projection from a bare POST that sends no body at all", async () => {
    const response = await createStubApp().request("/api/db/rebuild", { method: "POST" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(rebuildResult);
  });

  it("reports drift from doctor as a 200, not as an error status", async () => {
    const response = await createStubApp().request("/api/db/doctor");
    expect(response.status).toBe(200);
    const report = (await response.json()) as { ok: boolean; drift: { path: string | null }[] };
    expect(report.ok).toBe(false);
    expect(report.drift.map((entry) => entry.path)).toEqual(["data/docs/gone.md", null]);
  });

  it("serves the SSE route as an event stream, not as JSON", async () => {
    const response = await createStubApp().request("/events?token=t");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("serves attachment bytes as an opaque stream", async () => {
    const response = await createStubApp().request("/attachments/shot.png");
    expect(response.headers.get("content-type")).toContain("application/octet-stream");
    expect(await response.text()).toBe("shot.png");
  });
});
