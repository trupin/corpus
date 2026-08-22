import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { createCorpusClient } from "../client/index.js";
import {
  DOC_DIFF_MAX_CHARS,
  DocEditedPayloadSchema,
  EMPTY_TREE_OBJECT_ID,
} from "../schemas/edit.js";
import { contractRoutes } from "./index.js";

/**
 * `GET /api/docs/{id}/diff` (CONTRACT-028) exercised through the real route
 * definition and the generated typed client. The handler is canned; what is
 * asserted is the contract's own work — the optional range, the sha-only
 * grammar, the published bound, and which failure earns which envelope.
 */

const BASE_URL = "http://127.0.0.1:8765";

const KNOWN = "doc_a1b2c3";
/** A document the workspace has, with no commit behind it (SPEC.md §11). */
const UNCOMMITTED = "doc_fresh1";
/** A document that does not exist — the only thing a `404` on this route means. */
const MISSING = "doc_gone99";

const HEAD_SHA = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456";
const BASE_SHA = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
/** Well-formed, and in no repository: the case the route answers `400` for. */
const UNKNOWN_SHA = "dddddddddddddddddddddddddddddddddddddddd";

/** Longer than the bound, so the handler has something real to truncate. */
const FULL_DIFF_CHARS = DOC_DIFF_MAX_CHARS * 3;

interface Rejection {
  readonly code: string;
  readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/** Mirrors the server's own `defaultHook`, so a rejection renders as `ValidationError`. */
function createApp(): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) =>
      result.success
        ? undefined
        : c.json(
            {
              code: "bad_request" as const,
              message: "request failed validation",
              issues: result.error.issues.map((issue) => ({
                path: [result.target, ...issue.path.map(String)].join("."),
                message: issue.message,
              })),
            },
            400,
          ),
  });

  app.openapi(contractRoutes.getDocDiff, (c) => {
    const { id } = c.req.valid("param");
    const { from, to } = c.req.valid("query");

    if (id === MISSING) {
      return c.json({ code: "not_found" as const, message: `No document \`${id}\`.` }, 404);
    }

    // A sha the repository does not contain is a `400` naming the parameter,
    // never a `404`: the `404` here means the document is unknown.
    for (const [name, value] of [
      ["from", from],
      ["to", to],
    ] as const) {
      if (value === UNKNOWN_SHA) {
        return c.json(
          {
            code: "bad_request" as const,
            message: "request failed validation",
            issues: [
              { path: `query.${name}`, message: `\`${value}\` is not a commit in this workspace.` },
            ],
          },
          400,
        );
      }
    }

    if (id === UNCOMMITTED) {
      return c.json(
        {
          id,
          path: "data/docs/inbox/fresh.md",
          from: null,
          to: null,
          stats: { commits: 0, insertions: 0, deletions: 0 },
          diff: "",
          truncated: false,
          totalChars: 0,
        },
        200,
      );
    }

    // The echo is the assertion: it proves which values the validator handed
    // over, and therefore which halves of the range the server must default.
    const body = `range ${from ?? "<default>"}..${to ?? "<default>"}`;
    const truncated = from === EMPTY_TREE_OBJECT_ID;
    return c.json(
      {
        id,
        path: "data/docs/finance/mortgage.md",
        from: from ?? BASE_SHA,
        to: to ?? HEAD_SHA,
        stats: { commits: 1, insertions: 12, deletions: 3 },
        diff: truncated ? "@".repeat(DOC_DIFF_MAX_CHARS) : body,
        truncated,
        totalChars: truncated ? FULL_DIFF_CHARS : body.length,
      },
      200,
    );
  });

  return app;
}

function createTestClient() {
  return createCorpusClient({
    baseUrl: BASE_URL,
    token: "workspace-token",
    fetch: async (input, init) => createApp().fetch(new Request(input, init)),
  });
}

const readDiff = async (id: string, query: { from?: string; to?: string } = {}) =>
  createTestClient().api.GET("/api/docs/{id}/diff", { params: { path: { id }, query } });

describe("the doc-diff route (CONTRACT-028)", () => {
  it("is declared where SPEC.md §4's verb needs it", async () => {
    const { data, error } = await readDiff(KNOWN, { from: BASE_SHA, to: HEAD_SHA });

    expect(error).toBeUndefined();
    expect(data?.id).toBe(KNOWN);
    expect(data?.path).toBe("data/docs/finance/mortgage.md");
    expect(data?.diff).toBe(`range ${BASE_SHA}..${HEAD_SHA}`);
    expect(data?.stats).toEqual({ commits: 1, insertions: 12, deletions: 3 });
  });

  /**
   * The rider names the verb without flags — "`corpus doc diff <id>` fetches the
   * actual diff on demand" — so the bare call has to be a legal request that
   * reaches the handler with both halves for the server to fill in.
   */
  it("takes no range at all, leaving both defaults to the server", async () => {
    const { data, error } = await readDiff(KNOWN);

    expect(error).toBeUndefined();
    expect(data?.diff).toBe("range <default>..<default>");
    // Resolved values still come back, because a caller that omitted them must
    // be able to say what it read.
    expect(data?.from).toBe(BASE_SHA);
    expect(data?.to).toBe(HEAD_SHA);
  });

  it("takes either half of the range alone", async () => {
    expect((await readDiff(KNOWN, { to: HEAD_SHA })).data?.diff).toBe(
      `range <default>..${HEAD_SHA}`,
    );
    expect((await readDiff(KNOWN, { from: BASE_SHA })).data?.diff).toBe(
      `range ${BASE_SHA}..<default>`,
    );
  });

  /**
   * The event's range, passed straight back with no parsing or resolution
   * anywhere in the loop — the property that makes the frugal event usable.
   */
  it("accepts a `doc.edited` payload's range verbatim", async () => {
    const payload = DocEditedPayloadSchema.parse({
      docId: KNOWN,
      sessionId: "sess_7c1d",
      actor: "user",
      endedBy: "idle",
      from: BASE_SHA,
      to: HEAD_SHA,
      stats: { commits: 1, insertions: 12, deletions: 3 },
    });

    const { data, error } = await readDiff(payload.docId, {
      from: payload.from,
      to: payload.to,
    });

    expect(error).toBeUndefined();
    expect(data?.from).toBe(payload.from);
    expect(data?.to).toBe(payload.to);
  });

  it("diffs a document introduced by a parentless commit against the empty tree", async () => {
    const { data } = await readDiff(KNOWN, { from: EMPTY_TREE_OBJECT_ID });
    expect(data?.from).toBe(EMPTY_TREE_OBJECT_ID);
  });
});

describe("the range grammar is enforced before a git process could exist", () => {
  it.each([
    "HEAD",
    "HEAD~1",
    "main",
    "v1.0.0",
    "--output=/tmp/x",
    "-C/etc",
    "abc123",
    "z".repeat(8),
  ])("rejects from=%s with a 400 naming the parameter", async (from) => {
    const response = await createApp().request(
      `/api/docs/${KNOWN}/diff?from=${encodeURIComponent(from)}`,
    );

    expect(response.status).toBe(400);
    const rejection = (await response.json()) as Rejection;
    expect(rejection.code).toBe("bad_request");
    expect(rejection.issues?.[0]?.path).toBe("query.from");
  });

  it("rejects a bad `to` the same way, naming that parameter instead", async () => {
    const response = await createApp().request(`/api/docs/${KNOWN}/diff?to=HEAD`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as Rejection).issues?.[0]?.path).toBe("query.to");
  });

  it("validates the document id in the path", async () => {
    const app = createApp();
    expect((await app.request(`/api/docs/${KNOWN}/diff`)).status).toBe(200);
    expect((await app.request("/api/docs/not-an-id/diff")).status).toBe(400);
  });
});

describe("the two failures a caller must be able to tell apart", () => {
  /**
   * A well-formed sha the repository does not contain is a mistyped *range*, not
   * a missing document. Answering `404` would have a caller believe its document
   * had been deleted.
   */
  it("answers 400 naming the parameter for a sha this workspace does not have", async () => {
    const { data, error } = await readDiff(KNOWN, { from: UNKNOWN_SHA });

    expect(data).toBeUndefined();
    expect(error?.code).toBe("bad_request");
    expect((error as Rejection).issues?.[0]?.path).toBe("query.from");
  });

  it("answers 404 in the shared envelope only when the document is unknown", async () => {
    const { data, error } = await readDiff(MISSING);

    expect(data).toBeUndefined();
    expect(error).toEqual({ code: "not_found", message: `No document \`${MISSING}\`.` });
  });
});

describe("the bound", () => {
  it("truncates rather than refusing, and says by how much", async () => {
    const { data, error } = await readDiff(KNOWN, { from: EMPTY_TREE_OBJECT_ID });

    expect(error).toBeUndefined();
    expect(data?.truncated).toBe(true);
    expect(data?.diff).toHaveLength(DOC_DIFF_MAX_CHARS);
    expect(data?.totalChars).toBe(FULL_DIFF_CHARS);
    // The stats describe the whole range even when the body was cut, which is
    // what lets a caller measure what it is not looking at.
    expect(data?.stats.insertions).toBe(12);
  });

  it("reports the untruncated case honestly", async () => {
    const { data } = await readDiff(KNOWN, { from: BASE_SHA, to: HEAD_SHA });

    expect(data?.truncated).toBe(false);
    expect(data?.totalChars).toBe(data?.diff.length);
  });
});

/**
 * SPEC.md §11: a workspace whose git rejected or skipped the commit degrades
 * visibly rather than failing. A document that has never been committed has a
 * null range and an empty diff — an answer, not an error.
 */
describe("a document with no committed history", () => {
  it("answers 200 with a null range, an empty diff and zero stats", async () => {
    const { data, error } = await readDiff(UNCOMMITTED);

    expect(error).toBeUndefined();
    expect(data?.from).toBeNull();
    expect(data?.to).toBeNull();
    expect(data?.diff).toBe("");
    expect(data?.truncated).toBe(false);
    expect(data?.stats).toEqual({ commits: 0, insertions: 0, deletions: 0 });
  });
});
