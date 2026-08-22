import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import type { paths } from "../client/schema.generated.js";
import { buildOpenApiDocument } from "../openapi.js";
import {
  PATCH_REFUSAL_REASONS,
  PatchDocRequestSchema,
  type PatchRefusalReason,
} from "../schemas/doc-patch.js";
import { isApiError } from "../schemas/error.js";
import { patchDoc } from "./doc-patch.js";
import { ENDPOINT_INVENTORY } from "./inventory.js";

const PATCH_PATH = "/api/docs/{id}/patch";

/** `openapi3-ts` types a path item with an `any`-valued index signature. */
interface PublishedOperation {
  readonly description?: string;
  readonly parameters?: { name: string }[];
  readonly requestBody?: { required?: boolean };
  readonly responses?: Record<string, unknown>;
}

interface SchemaNode {
  readonly additionalProperties?: unknown;
  readonly required?: string[];
  readonly properties?: Record<string, Record<string, unknown>>;
}

function published(): PublishedOperation {
  const item = buildOpenApiDocument().paths?.[PATCH_PATH] as
    Record<string, PublishedOperation> | undefined;
  const found = item?.["post"];
  if (!found) throw new Error(`No post ${PATCH_PATH} in the generated document.`);
  return found;
}

/**
 * A body with one excerpt that occurs once and one that occurs twice, because
 * uniqueness is the whole precondition. The trailing `Rate:` line differs from
 * its neighbour only in whitespace, which is what the byte-exactness tests
 * quote: a matcher that trimmed would find it and land the edit a line away.
 */
const BODY = [
  "# Mortgage options",
  "",
  "- Review the Q1 report by Friday",
  "- Review the Q1 report by Friday",
  "",
  "Rate:  4.25%",
  "",
].join("\n");

const DOC_KEY = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcde";
/** A write that lands answers with a **fresh** key (SPEC.md §7), never the one it was read at. */
const NEXT_DOC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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
  origin: null,
  pinned: false,
  order: null,
  query: null,
  column: null,
  extra: {},
};

/**
 * The route mounted the way a server must mount it, with a handler that makes
 * exactly the decisions the contract declares — the count, the uniqueness
 * refusal, the left-to-right non-overlapping scan, and the no-op. It is not a
 * double for the server: it is the demonstration that the declared request
 * carries **enough** to decide all of them, which is the claim CONTRACT-046
 * makes about the shape.
 *
 * `split`/`join` is the non-overlapping left-to-right scan the contract fixes,
 * spelled in one line — so the count the refusal reports and the sites `all`
 * rewrites cannot drift apart.
 */
function createApp(body = BODY) {
  // Mirrors the server's own `defaultHook`, so a rejection renders as the
  // contract's `ValidationError` rather than the library's raw dump.
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

  app.openapi(patchDoc, (c) => {
    const { id } = c.req.valid("param");
    const { old, new: replacement, all } = c.req.valid("json");

    if (id !== frontmatter.id) {
      return c.json({ code: "not_found" as const, message: "no such document" }, 404);
    }

    const segments = body.split(old);
    const matches = segments.length - 1;

    const refuse = (reason: PatchRefusalReason, message: string) =>
      c.json({ code: "conflict" as const, message, reason, matches }, 409);

    if (matches === 0) return refuse("no-match", "that text is not in the body");
    if (matches > 1 && all !== true) {
      return refuse("multiple-matches", `that text occurs ${String(matches)} times`);
    }

    const replaced = all === true ? matches : 1;
    const patched =
      all === true ? segments.join(replacement) : body.replace(old, () => replacement);

    return c.json(
      {
        doc: {
          frontmatter,
          body: patched,
          path: "data/docs/mortgage.md",
          anchors: [],
          // A no-op writes nothing, but the response still carries the
          // document's current key — which is the key it already had.
          key: patched === body ? DOC_KEY : NEXT_DOC_KEY,
          userEditing: false,
        },
        anchors: { remapped: [], orphaned: [] },
        warnings: [],
        replaced,
      },
      200,
    );
  });

  return app;
}

const patch = (docId: string, requestBody: unknown, options: { body?: string } = {}) =>
  createApp(options.body).request(`/api/docs/${docId}/patch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });

interface Applied {
  readonly doc: { readonly body: string; readonly key: string };
  readonly anchors: { readonly remapped: string[]; readonly orphaned: string[] };
  readonly warnings: unknown[];
  readonly replaced: number;
}

interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly reason?: string;
  readonly matches?: number;
}

interface Rejection {
  readonly code: string;
  readonly issues: readonly { readonly path: string; readonly message: string }[];
}

const applied = async (response: Response) => (await response.json()) as Applied;
const refused = async (response: Response) => (await response.json()) as Refusal;

describe("an edit that names the text it changes", () => {
  it("replaces the unique occurrence and answers with the saved document", async () => {
    const response = await patch("doc_a1b2c3", { old: "Rate:  4.25%", new: "Rate:  3.90%" });
    expect(response.status).toBe(200);

    const body = await applied(response);
    expect(body.doc.body).toContain("Rate:  3.90%");
    expect(body.doc.body).not.toContain("4.25%");
    expect(body.replaced).toBe(1);
  });

  /**
   * The operation exists so an edit costs the length of the change rather than
   * the length of the document — and, with it, so that an edit which never
   * carries the rest of the body cannot destroy the rest of the body.
   */
  it("leaves every line it did not quote byte-for-byte alone", async () => {
    const body = await applied(
      await patch("doc_a1b2c3", { old: "Rate:  4.25%", new: "Rate:  3.90%" }),
    );
    expect(body.doc.body.replace("3.90", "4.25")).toBe(BODY);
  });

  /** An empty `new` is the spelling of a deletion, not a malformed request. */
  it("deletes the quoted text when `new` is empty", async () => {
    const response = await patch("doc_a1b2c3", { old: "\nRate:  4.25%", new: "" });
    expect(response.status).toBe(200);
    expect((await applied(response)).doc.body).not.toContain("Rate:");
  });

  /** SPEC.md §7: a write that lands hands back a fresh key, so a writer never re-reads. */
  it("hands back a fresh key, which is where the next write reads one", async () => {
    const body = await applied(
      await patch("doc_a1b2c3", { old: "Rate:  4.25%", new: "Rate:  3.90%" }),
    );
    expect(body.doc.key).toBe(NEXT_DOC_KEY);
  });

  /** A patch is an ordinary write once applied: §6's report rides on it like any save. */
  it("reports anchor reconciliation and §11 warnings, like every other write", async () => {
    const body = await applied(
      await patch("doc_a1b2c3", { old: "Rate:  4.25%", new: "Rate:  3.90%" }),
    );
    expect(body.anchors).toEqual({ remapped: [], orphaned: [] });
    expect(body.warnings).toEqual([]);
  });

  /**
   * SPEC.md §9.2: "a patch whose result is the unchanged body is a no-op that
   * writes nothing" — a `200`, not a refusal. A caller asking for a change the
   * document already carries has got what it asked for.
   */
  it("treats `new` equal to `old` as a no-op that writes nothing", async () => {
    const response = await patch("doc_a1b2c3", { old: "Rate:  4.25%", new: "Rate:  4.25%" });
    expect(response.status).toBe(200);

    const body = await applied(response);
    expect(body.doc.body).toBe(BODY);
    expect(body.replaced).toBe(1);
  });

  it("answers 404 for a document that does not exist", async () => {
    const response = await patch("doc_zzzzzz", { old: "Rate:  4.25%", new: "x" });
    expect(response.status).toBe(404);
  });
});

describe("matching is byte-exact against the body as stored", () => {
  it.each([
    ["a collapsed run of whitespace", "Rate: 4.25%"],
    ["a trimmed quote", " Rate:  4.25% "],
    ["a different case", "rate:  4.25%"],
    ["a CRLF line ending", "- Review the Q1 report by Friday\r\n"],
  ])("refuses %s rather than matching it approximately", async (_label, old) => {
    const response = await patch("doc_a1b2c3", { old, new: "x" });
    expect(response.status).toBe(409);

    const body = await refused(response);
    expect(body.reason).toBe("no-match");
    expect(body.matches).toBe(0);
  });

  /** `old` is text, never a pattern: a regex-looking quote is looked for literally. */
  it("takes `old` literally rather than as a regular expression", async () => {
    const dotted = await patch("doc_a1b2c3", { old: "Rate:..4.25%", new: "x" });
    expect((await refused(dotted)).reason).toBe("no-match");

    const literal = await patch("doc_a1b2c3", { old: "4.25%", new: "3.90%" });
    expect(literal.status).toBe(200);
  });

  /**
   * `$&` and `$1` are replacement-pattern syntax in JavaScript's own `replace`,
   * and a server that reaches for it without care will expand them. `new` is
   * text: what it says is what lands.
   */
  it("takes `new` literally too, expanding no replacement patterns", async () => {
    const body = await applied(await patch("doc_a1b2c3", { old: "4.25%", new: "$& and $1" }));
    expect(body.doc.body).toContain("Rate:  $& and $1");
  });

  /**
   * The operation is body-only. `Doc.body` excludes the frontmatter block, so a
   * quote reaching into frontmatter finds nothing — no special case, and no
   * route by which a patch could rewrite a key it was never shown.
   */
  it("finds nothing when the quote reaches into the frontmatter", async () => {
    const response = await patch("doc_a1b2c3", { old: "title: Mortgage options", new: "title: x" });
    expect(response.status).toBe(409);
    expect((await refused(response)).reason).toBe("no-match");
  });
});

describe("the two refusals, which want opposite things", () => {
  it("names zero matches as its own refusal, with the count", async () => {
    const response = await patch("doc_a1b2c3", { old: "a line that was never here", new: "x" });
    expect(response.status).toBe(409);

    const body = await refused(response);
    expect(body.reason).toBe("no-match");
    expect(body.matches).toBe(0);
  });

  it("names several matches as a different refusal, with how many", async () => {
    const response = await patch("doc_a1b2c3", {
      old: "- Review the Q1 report by Friday",
      new: "- Review the Q1 report by Monday",
    });
    expect(response.status).toBe(409);

    const body = await refused(response);
    expect(body.reason).toBe("multiple-matches");
    expect(body.matches).toBe(2);
  });

  /**
   * The load-bearing property of the pair (SPEC.md §9.2): the recoveries are
   * opposite — re-read the document, versus quote more context — so a caller
   * that could only see "it did not apply" would have to guess.
   */
  it("distinguishes them by a machine-readable field, not by prose", async () => {
    const zero = await refused(await patch("doc_a1b2c3", { old: "nowhere", new: "x" }));
    const several = await refused(
      await patch("doc_a1b2c3", { old: "- Review the Q1 report by Friday", new: "x" }),
    );

    expect(zero.reason).not.toBe(several.reason);
    expect(new Set(PATCH_REFUSAL_REASONS).size).toBe(PATCH_REFUSAL_REASONS.length);
  });

  /** Quoting more context is the documented recovery, so it has to actually work. */
  it("lets a caller recover from a multiple match by quoting more context", async () => {
    const response = await patch("doc_a1b2c3", {
      old: "- Review the Q1 report by Friday\n\nRate:",
      new: "- Review the Q1 report by Monday\n\nRate:",
    });
    expect(response.status).toBe(200);
    expect((await applied(response)).replaced).toBe(1);
  });

  /**
   * `409` rather than `400`: the body is well formed, the identical request
   * would succeed against a different version of the document, and retrying it
   * unchanged cannot help. A `400` would send the caller in circles.
   */
  it("still parses as an ApiError, so no consumer has to learn a new code", async () => {
    const body: unknown = await (await patch("doc_a1b2c3", { old: "nowhere", new: "x" })).json();
    expect(isApiError(body)).toBe(true);
    expect((body as Refusal).code).toBe("conflict");
  });
});

describe("`all`, and the scan it commits to", () => {
  it("replaces every occurrence when asked", async () => {
    const response = await patch("doc_a1b2c3", {
      old: "- Review the Q1 report by Friday",
      new: "- Review the Q1 report by Monday",
      all: true,
    });
    expect(response.status).toBe(200);

    const body = await applied(response);
    expect(body.replaced).toBe(2);
    expect(body.doc.body).not.toContain("Friday");
  });

  /**
   * Left to right, never overlapping — the rule exists so the server's count and
   * a caller's own count of its own quote agree. `"aa"` occurs once in `"aaa"`
   * under this scan and twice under an overlapping one.
   */
  it.each([
    ["aaa", 1, "Xa"],
    ["aaaa", 2, "XX"],
    ["aaaaa", 2, "XXa"],
  ])("scans %s left to right without overlap", async (body, replaced, expected) => {
    const response = await patch("doc_a1b2c3", { old: "aa", new: "X", all: true }, { body });
    expect(response.status).toBe(200);

    const result = await applied(response);
    expect(result.replaced).toBe(replaced);
    expect(result.doc.body).toBe(expected);
  });

  it("counts a refusal with the same scan it would have replaced with", async () => {
    const response = await patch("doc_a1b2c3", { old: "aa", new: "X" }, { body: "aaaaa" });
    expect(response.status).toBe(409);
    expect((await refused(response)).matches).toBe(2);
  });

  /** It lifts uniqueness, never the requirement to match at all. */
  it("still refuses zero occurrences when `all` is set", async () => {
    const response = await patch("doc_a1b2c3", { old: "nowhere", new: "x", all: true });
    expect(response.status).toBe(409);
    expect((await refused(response)).reason).toBe("no-match");
  });

  it("is content with a single occurrence, replacing it", async () => {
    const response = await patch("doc_a1b2c3", { old: "4.25%", new: "3.90%", all: true });
    expect(response.status).toBe(200);
    expect((await applied(response)).replaced).toBe(1);
  });
});

describe("the request body's shape", () => {
  const issuesOf = async (response: Response) => ((await response.json()) as Rejection).issues;

  it("rejects an empty `old`, since replacing nothing is not an edit", async () => {
    const response = await patch("doc_a1b2c3", { old: "", new: "x" });
    expect(response.status).toBe(400);
    expect((await issuesOf(response)).map((issue) => issue.path)).toContain("json.old");
  });

  it("demands both `old` and `new`", async () => {
    expect((await patch("doc_a1b2c3", { old: "4.25%" })).status).toBe(400);
    expect((await patch("doc_a1b2c3", { new: "3.90%" })).status).toBe(400);
  });

  /** CONTRACT-017: an unknown key would mean performing a different edit in silence. */
  it("rejects an unknown key rather than ignoring it", async () => {
    const response = await patch("doc_a1b2c3", { old: "4.25%", new: "3.90%", global: true });
    expect(response.status).toBe(400);
    expect((await issuesOf(response)).some((issue) => issue.message.includes("global"))).toBe(true);
  });

  /**
   * SPEC.md §7 exempts this operation from presenting a key: it names the text
   * it expects to find, which is the same staleness check by another route. The
   * request is strict, so a caller sending one out of symmetry is told rather
   * than left believing the server checked it.
   */
  it("takes no key, and says so by refusing one", async () => {
    const response = await patch("doc_a1b2c3", { old: "4.25%", new: "3.90%", key: DOC_KEY });
    expect(response.status).toBe(400);
    expect((await issuesOf(response)).some((issue) => issue.message.includes("key"))).toBe(true);
  });

  it("rejects a non-boolean `all`", async () => {
    expect((await patch("doc_a1b2c3", { old: "4.25%", new: "x", all: "yes" })).status).toBe(400);
  });

  it("publishes a strict body with no server-applied default", () => {
    const schema = buildOpenApiDocument().components?.schemas?.["PatchDocRequest"] as
      SchemaNode | undefined;
    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.required).toEqual(["old", "new"]);
    for (const property of Object.values(schema?.properties ?? {})) {
      expect(property).not.toHaveProperty("default");
    }
  });

  it("parses a well-formed body straight from the schema", () => {
    const parsed = PatchDocRequestSchema.parse({ old: "a", new: "" });
    expect(parsed).toEqual({ old: "a", new: "" });
    expect(parsed.all).toBeUndefined();
  });
});

describe("the published operation", () => {
  it("is in the pinned endpoint inventory", () => {
    expect(ENDPOINT_INVENTORY).toContain("POST /api/docs/{id}/patch");
  });

  it("declares exactly the codes a patch can answer with", () => {
    expect(Object.keys(published().responses ?? {}).sort()).toEqual([
      "200",
      "400",
      "401",
      "404",
      "409",
      // CONTRACT-050: a `job` naming no event. Deliberately not folded into the
      // 400 — the body is well-formed, the id simply resolves to nothing, and a
      // caller that mistyped a job id wanted the attribution it asked for
      // (SPEC.md §9.2).
      "422",
    ]);
  });

  /** The agent is the caller this exists for; nothing about it is user-only. */
  it("declares no 403, because the agent is exactly who patches", () => {
    expect(published().responses?.["403"]).toBeUndefined();
  });

  it("declares the acting-party header, which becomes the git author", () => {
    expect(published().parameters?.map((parameter) => parameter.name)).toEqual([
      "id",
      ACTOR_HEADER,
    ]);
  });

  it("mandates the body, since a patch that names no text is not an edit", () => {
    expect(published().requestBody?.required).toBe(true);
  });

  /**
   * The reasoning has to survive without this issue file: a reader of
   * `openapi.json` alone must learn the exactness rule, the two refusals, the
   * absent key and the no-op, because each is a decision they would otherwise
   * make differently.
   */
  it.each([
    "byte-exact",
    "exactly and uniquely",
    "name the count",
    "without overlap",
    "no key",
    "no-op",
    "§11",
    "§6",
    "§4",
  ])("says %s in its own description", (phrase) => {
    expect(published().description ?? "").toContain(phrase);
  });
});

/** Compile-time probes over the generated `paths`; they fail under `tsc --noEmit`. */
describe("the generated client's view of the patch", () => {
  type JsonBody<Body> = Body extends { content: { "application/json": infer Shape } }
    ? Shape
    : never;
  type Operation = paths["/api/docs/{id}/patch"]["post"];
  type PatchBody = JsonBody<NonNullable<Operation["requestBody"]>>;
  type PatchOk = JsonBody<Operation["responses"][200]>;
  type PatchConflict = JsonBody<Operation["responses"][409]>;

  const body: PatchBody = { old: "Rate:  4.25%", new: "Rate:  3.90%" };

  it("types the body as the two strings plus the optional flag", () => {
    expect(Object.keys(body).sort()).toEqual(["new", "old"]);
    const everywhere: PatchBody = { ...body, all: true };
    expect(everywhere.all).toBe(true);
  });

  it("types the 409 as the conflict envelope narrowed by a reason and a count", () => {
    const refusal: PatchConflict = {
      code: "conflict",
      message: "that text occurs twice",
      reason: "multiple-matches",
      matches: 2,
    };
    expect(PATCH_REFUSAL_REASONS).toContain(refusal.reason);
    expect(refusal.matches).toBe(2);
  });

  it("types the 200 as the ordinary write response plus the count", () => {
    const ok: Pick<PatchOk, "replaced" | "warnings"> = { replaced: 1, warnings: [] };
    expect(ok.replaced).toBe(1);
    // The reconciliation report and the saved document are on the same response
    // `PUT /api/docs/{id}` answers with — a patch is an ordinary write.
    const reconciliation: PatchOk["anchors"] = { remapped: [], orphaned: [] };
    expect(reconciliation.orphaned).toEqual([]);
  });

  it("rejects a wrong-shaped body at compile time", () => {
    // @ts-expect-error §7 exempts a patch from presenting a key; the body has no field for one.
    const keyed: PatchBody = { ...body, key: DOC_KEY };
    // @ts-expect-error `old` is the excerpt to find, not a range into the body.
    const ranged: PatchBody = { range: { start: 0, end: 4 }, new: "x" };
    // @ts-expect-error a patch replaces text, never the whole body.
    const whole: PatchBody = { ...body, body: "everything, again" };

    expect([keyed, ranged, whole]).toHaveLength(3);
  });
});
