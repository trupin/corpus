import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../openapi.js";
import { DocumentIdSchema } from "../schemas/id.js";
import { BYTES_PER_TOKEN, MAX_COST_BUCKETS } from "../schemas/telemetry.js";
import { flushEditSession } from "./edit-session.js";
import { contractRoutes } from "./index.js";
import { ENDPOINT_INVENTORY } from "./inventory.js";
import { getDocCost, reportInvocations } from "./telemetry.js";

/**
 * Cost telemetry's two route definitions (CONTRACT-097, SPEC.md §9.4).
 *
 * `createRoute` returns its own argument object, so these assertions read the
 * declarations directly; `../openapi.test.ts` covers what the *generated
 * document* says about them. What is checked here is what the declaration
 * promises a caller — chiefly the ingestion route's absences, which no positive
 * assertion elsewhere would catch.
 */

const document = buildOpenApiDocument();

describe("the telemetry pair's shape (CONTRACT-097)", () => {
  it("declares the two endpoints the inventory names, spelled as it spells them", () => {
    expect([reportInvocations.method, reportInvocations.path]).toEqual([
      "post",
      "/api/telemetry/invocations",
    ]);
    expect([getDocCost.method, getDocCost.path]).toEqual(["get", "/api/docs/{id}/cost"]);
    expect(ENDPOINT_INVENTORY).toContain("POST /api/telemetry/invocations");
    expect(ENDPOINT_INVENTORY).toContain("GET /api/docs/{id}/cost");
  });

  it("registers both in the route registry the server mounts handlers against", () => {
    expect(contractRoutes.reportInvocations).toBe(reportInvocations);
    expect(contractRoutes.getDocCost).toBe(getDocCost);
  });

  it("tags both as telemetry, so the ledger is one subject in the document", () => {
    expect(reportInvocations.tags).toEqual(["telemetry"]);
    expect(getDocCost.tags).toEqual(["telemetry"]);
  });

  /**
   * TEST-1180. Every tag a route uses must be a tag the document declares, or
   * an OpenAPI consumer renders an operation under a heading with no
   * description. Written as a sweep rather than as a lookup on the two new
   * routes: a tag typo is exactly the kind of thing that arrives with a route
   * copied from a neighbour.
   */
  it("uses no tag the document has not registered", () => {
    const registered = new Set((document.tags ?? []).map((tag) => tag.name));
    const used = new Set(Object.values(contractRoutes).flatMap((route) => route.tags ?? []));
    expect([...used].filter((tag) => !registered.has(tag))).toEqual([]);
    expect(used.has("telemetry")).toBe(true);
  });

  it("describes the telemetry tag as derived runtime state, in the `index` tag's own terms", () => {
    const tag = (document.tags ?? []).find((entry) => entry.name === "telemetry");
    expect(tag?.description).toContain("Derived runtime state only");
    expect(tag?.description).toContain("no files, no commits");
    expect(tag?.description).toContain("§9.4");
  });
});

describe("ingestion is a channel that promises nothing (CONTRACT-097)", () => {
  const description = reportInvocations.description ?? "";

  /**
   * TEST-1172. §9.4's guarantee is the reason this route may be called on every
   * invocation of the CLI, so the four halves of it are published rather than
   * left in an issue file: a client author reading only the generated document
   * must learn that a failure here is not theirs to handle.
   */
  it.each([
    ["cites the rider", "SPEC.md §9.4"],
    ["says loss is acceptable", "**loss is acceptable**"],
    ["says the report is never retried", "never retried"],
    ["refuses to promise idempotency", "**Idempotency is not promised**"],
    ["forbids any verb from depending on it", "**No verb's outcome may depend on this route.**"],
  ])("%s", (_case, phrase) => {
    expect(description).toContain(phrase);
  });

  it("says a spool file is the property the channel is defined not to have", () => {
    expect(description).toContain("buffering it to disk");
  });

  it("names the batch form as a future caller's, not today's", () => {
    expect(description).toContain("a CLI which later buffers reports needs no second route");
    expect(description).toContain("not because today's CLI");
  });

  it("states that the estimate is derived server-side, from bytes it is sent", () => {
    expect(description).toContain(`${String(BYTES_PER_TOKEN)} bytes to a token`);
    expect(description).toContain("the CLI counts and converts nothing");
  });

  /**
   * TEST-1171. The success answer is a bare description with no content, the
   * way `POST /api/docs/{id}/edit-session/flush` declares its own — asserted
   * against that route rather than against a literal, so the two cannot drift
   * into two spellings of "nothing to say".
   */
  it("answers 204 with no body at all, exactly as the edit-session flush does", () => {
    const ok = reportInvocations.responses[204];
    expect(Object.keys(ok)).toEqual(Object.keys(flushEditSession.responses[204]));
    expect(ok).not.toHaveProperty("content");
    expect(ok.description).toContain("carries no body");
  });

  it("declares no other 2xx, so nothing on this route ever returns a shape", () => {
    const success = Object.keys(reportInvocations.responses).filter((status) =>
      status.startsWith("2"),
    );
    expect(success).toEqual(["204"]);
  });

  it("declares exactly the refusals a shape check can produce", () => {
    expect(Object.keys(reportInvocations.responses).sort()).toEqual(["204", "400", "401"]);
  });

  /**
   * A `404` would make an unknown subject a refusal, and fire-and-forget would
   * swallow it — the measurement would be lost for the one document most likely
   * to be interesting, one that was just deleted or renamed. The ledger is
   * deliberately not referential.
   */
  it("declares no 404, because a subject naming no document is kept rather than refused", () => {
    expect(reportInvocations.responses).not.toHaveProperty("404");
    expect(description).toContain("A subject naming no document is kept");
  });

  it("names no acting party: it authors nothing and commits nothing", () => {
    expect(reportInvocations.request.body).toBeDefined();
    expect(reportInvocations.request).not.toHaveProperty("headers");
    expect(description).toContain("No acting party");
  });

  it("requires the body: a report with none would be a measurement of nothing", () => {
    expect(reportInvocations.request.body.required).toBe(true);
  });
});

describe("the cost series is an ordinary bounded read (CONTRACT-097)", () => {
  const description = getDocCost.description ?? "";

  /**
   * TEST-1174. The path parameter is built from the shared document id shape
   * and declared locally, exactly as its `/api/docs/{id}/…` siblings declare
   * theirs — so a malformed id is a `400` from the validator before any handler
   * runs, and a `th_*` id is legal because threads are documents.
   */
  it("takes the shared document id, so a thread id is legal and a malformed one is a 400", () => {
    const parameter = getDocCost.request.params.shape.id;
    expect(parameter.safeParse("th_x9y8").success).toBe(true);
    expect(parameter.safeParse("doc_a1b2c3").success).toBe(true);
    expect(parameter.safeParse("evt_1").success).toBe(false);
    expect(parameter.safeParse("../etc/passwd").success).toBe(false);
    expect(DocumentIdSchema.safeParse("th_x9y8").success).toBe(true);
    expect(getDocCost.responses[400]).toBeDefined();
  });

  it("says a thread has its own series and is never rolled up into its parent", () => {
    expect(description).toContain("`th_*` id is legal here");
    expect(description).toContain("not rolled up into its parent");
  });

  it("says the server chooses the granularity and states it", () => {
    expect(description).toContain("chooses the bucket granularity and says which it chose");
    expect(description).toContain("an empty bucket is a real answer");
  });

  it("states the bound in the vocabulary `GET /api/jobs` already uses", () => {
    expect(description).toContain(String(MAX_COST_BUCKETS));
    expect(description).toContain("`truncated`");
    expect(description).toContain("not a third spelling");
  });

  it("keeps the size a present-tense number rather than a second series", () => {
    expect(description).toContain("**right now**");
    expect(description).toContain("never a second series");
    expect(description).toContain("no filesystem read");
  });

  it("answers an unmeasured document honestly rather than with an error", () => {
    expect(description).toContain("An empty series is an honest answer, not an error");
    expect(description).toContain("measuringSince");
  });

  it("declares the refusals a document subresource has, and no more", () => {
    expect(Object.keys(getDocCost.responses).sort()).toEqual(["200", "400", "401", "404"]);
  });

  it("names no acting party: the read authors nothing", () => {
    expect(getDocCost.request).not.toHaveProperty("headers");
    expect(description).toContain("no acting party");
  });
});

/**
 * TEST-1179, from the side that would catch a well-meaning addition: telemetry
 * announces nothing over the stream (sprint-025 R8). A frame per `corpus`
 * invocation would put the telemetry channel on the hot path it exists to
 * measure, and the panel refetches on the document frames that already exist.
 */
describe("telemetry announces nothing (CONTRACT-097)", () => {
  it("adds no query key and no SSE shape", () => {
    const events = document.paths?.["/events"]?.get as { description?: string } | undefined;
    expect(events?.description).not.toContain("cost");
    expect(events?.description).not.toContain("telemetry");
  });

  it("says so on the route module, so the omission does not read as an oversight", () => {
    expect(getDocCost.description).toContain("does not update an open panel");
  });
});
