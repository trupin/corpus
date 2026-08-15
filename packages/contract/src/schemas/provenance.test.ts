import { describe, expect, it } from "vitest";
import {
  CreateDocRequestSchema,
  DocFrontmatterSchema,
  JobOnlyRequestSchema,
  MoveDocRequestSchema,
  UpdateDocRequestSchema,
} from "./doc.js";
import { PatchDocRequestSchema } from "./doc-patch.js";
import { FormAnswerRequestSchema } from "./form.js";
import { jobField, originField, UnknownJobErrorSchema } from "./provenance.js";
import {
  AppendTurnRequestSchema,
  CreateThreadRequestSchema,
  MultipartAppendTurnRequestSchema,
  MultipartCreateThreadRequestSchema,
} from "./thread.js";

const JOB = "evt_a1b2c3d4";
const THREAD = "th_x9y8z7";

describe("`job` — the write names the work it serves", () => {
  it("is accepted on every mutating shape the rider names", () => {
    // SPEC.md §9.2: "any write may carry the event id it is doing the work of".
    // Listed one by one rather than looped over a registry, so a shape that
    // quietly loses the field fails here rather than being silently skipped.
    expect(CreateDocRequestSchema.parse({ type: "note", title: "T", job: JOB }).job).toBe(JOB);
    expect(UpdateDocRequestSchema.parse({ title: "T", job: JOB }).job).toBe(JOB);
    expect(MoveDocRequestSchema.parse({ folder: "f", job: JOB }).job).toBe(JOB);
    expect(PatchDocRequestSchema.parse({ old: "a", new: "b", job: JOB }).job).toBe(JOB);
    expect(JobOnlyRequestSchema.parse({ job: JOB }).job).toBe(JOB);
    expect(FormAnswerRequestSchema.parse({ answers: [], job: JOB }).job).toBe(JOB);
  });

  it("is optional on every one of them, because forgetting it costs only provenance", () => {
    // §9.2 draws the contrast with §7's key deliberately: a key had to be
    // enforced in the write path because forgetting it cost a lost edit. Here
    // forgetting costs an unfiled document, so nothing is refused.
    expect(CreateDocRequestSchema.parse({ type: "note", title: "T" }).job).toBeUndefined();
    expect(UpdateDocRequestSchema.parse({ title: "T" }).job).toBeUndefined();
    expect(MoveDocRequestSchema.parse({ folder: "f" }).job).toBeUndefined();
    expect(PatchDocRequestSchema.parse({ old: "a", new: "b" }).job).toBeUndefined();
    expect(JobOnlyRequestSchema.parse({}).job).toBeUndefined();
  });

  it("travels on the multipart twins too, which is where fields go missing", () => {
    // The multipart shapes are hand-maintained alongside their JSON twins, so a
    // field added to one and not the other is the standing failure mode.
    for (const schema of [CreateThreadRequestSchema, MultipartCreateThreadRequestSchema]) {
      expect("job" in schema.shape).toBe(true);
    }
    for (const schema of [AppendTurnRequestSchema, MultipartAppendTurnRequestSchema]) {
      expect("job" in schema.shape).toBe(true);
    }
  });

  it("refuses an id that is not an event id", () => {
    // A thread id here would be a caller asserting its own scope, which is the
    // whole thing the job/origin split exists to prevent.
    expect(jobField.safeParse(THREAD).success).toBe(false);
    expect(jobField.safeParse("doc_a1b2c3").success).toBe(false);
    expect(jobField.safeParse("").success).toBe(false);
    expect(jobField.safeParse(JOB).success).toBe(true);
  });
});

describe("`origin` — the document names the conversation it came from", () => {
  it("rides on the document's frontmatter, nullable", () => {
    expect(originField.parse(THREAD)).toBe(THREAD);
    expect(originField.parse(null)).toBeNull();
    expect("origin" in DocFrontmatterSchema.shape).toBe(true);
  });

  it("accepts null on the doc edit — detach, the one request that touches it", () => {
    // §9.2: an origin is server-assigned, and detach is the single exception.
    expect(UpdateDocRequestSchema.parse({ origin: null }).origin).toBeNull();
  });

  it("carries the id shape on the wire, and leaves clear-only to the write path", () => {
    // The wire type is the ordinary nullable id rather than `z.null()`, which
    // would have made `origin: "th_…"` a compile error: a JSON Schema
    // `{"type":"null"}` reaches `openapi-fetch` as `origin?: never`, and the
    // generated client then rejects the one value the field exists to accept.
    // So this parses, and the server refuses it — which is what CONTRACT-050
    // asked for ("clear only, never set, user actor only, enforced
    // server-side"). The guarantee is unchanged; only where it is enforced.
    expect(UpdateDocRequestSchema.safeParse({ origin: THREAD }).success).toBe(true);
  });

  it("is absent from every other mutating request shape", () => {
    // Detach is the one exception, and it lives on the doc edit. A second
    // request that accepted an origin would be the back door reopened.
    expect("origin" in CreateDocRequestSchema.shape).toBe(false);
    expect("origin" in MoveDocRequestSchema.shape).toBe(false);
    expect("origin" in PatchDocRequestSchema.shape).toBe(false);
    expect("origin" in JobOnlyRequestSchema.shape).toBe(false);
    expect("origin" in CreateThreadRequestSchema.shape).toBe(false);
    expect("origin" in AppendTurnRequestSchema.shape).toBe(false);
  });

  it("refuses a non-thread id, since a scope root is always a thread", () => {
    expect(originField.safeParse("doc_a1b2c3").success).toBe(false);
    expect(originField.safeParse(JOB).success).toBe(false);
  });
});

describe("the unknown-job refusal", () => {
  it("names the id it could not resolve", () => {
    // The point of the shape: a caller that mistyped a job id gets told which
    // id, rather than a generic validation failure it has to guess at.
    const parsed = UnknownJobErrorSchema.parse({
      code: "unknown_job",
      message: "no event has that id",
      job: JOB,
    });
    expect(parsed.job).toBe(JOB);
  });

  it("is its own code, distinct from an ordinary validation failure", () => {
    expect(
      UnknownJobErrorSchema.safeParse({ code: "bad_request", message: "x", job: JOB }).success,
    ).toBe(false);
  });
});
