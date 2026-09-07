import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BYTES_PER_TOKEN,
  COMMAND_PATH_MAX_LENGTH,
  COMMAND_PATH_PATTERN,
  COST_BUCKET_GRANULARITIES,
  CostBucketSchema,
  CostQuerySchema,
  DEFAULT_COST_BUCKETS,
  DocumentCostSchema,
  estimateTokens,
  INVOCATION_REPORT_FORM_MESSAGE,
  InvocationReportRequestSchema,
  InvocationReportSchema,
  MAX_COST_BUCKETS,
  MAX_REPORT_BATCH,
  MAX_REPORT_SUBJECTS,
} from "./telemetry.js";

const report = {
  command: "thread show",
  wroteBytes: 42,
  readBytes: 1600,
  subjects: ["th_x9y8"],
  at: "2026-09-06T10:05:00Z",
};

describe("the house token estimate (CONTRACT-097)", () => {
  it("is four bytes to a token, the number SPEC.md §9.4's rider is built on", () => {
    expect(BYTES_PER_TOKEN).toBe(4);
  });

  /**
   * TEST-1169. The rounding mode is a decision this issue took rather than
   * inherited, so it is pinned at the boundaries where the three candidates
   * disagree: `1` separates ceil from round and floor, `2` separates round from
   * floor, `6` and `4001` catch a mode swapped after the fact.
   */
  it.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [5, 2],
    [6, 2],
    [4000, 1000],
    [4001, 1001],
  ])("rounds %i bytes up to %i tokens", (bytes, tokens) => {
    expect(estimateTokens(bytes)).toBe(tokens);
  });

  /**
   * The property the mode was chosen for, stated as a property rather than as a
   * table: a zero in the panel must mean *nothing was measured*, never
   * *measured and rounded away*. Floor loses every measurement under four bytes
   * and nearest-rounding loses one-byte measurements; this loses none.
   */
  it("returns zero only for zero bytes, so a zero can only mean nothing was measured", () => {
    for (let bytes = 0; bytes <= 4 * BYTES_PER_TOKEN; bytes += 1) {
      expect(estimateTokens(bytes) === 0, `${String(bytes)} bytes`).toBe(bytes === 0);
    }
  });

  it("never reads low: the estimate is at least the exact quotient, by less than a token", () => {
    for (const bytes of [1, 7, 999, 4001, 123456]) {
      const exact = bytes / BYTES_PER_TOKEN;
      expect(estimateTokens(bytes)).toBeGreaterThanOrEqual(exact);
      expect(estimateTokens(bytes) - exact).toBeLessThan(1);
    }
  });

  /**
   * The reproducibility rule is the estimate's whole reason to exist (P2), so
   * the docblock has to state it and state which way it rounds. Asserted
   * against the source, because a comment is the only place this promise lives
   * and a later edit that drops it would leave a number nobody can check.
   */
  it("says in its own docblock why the rule matters and which way it goes", () => {
    const source = readFileSync(new URL("./telemetry.ts", import.meta.url), "utf8");
    const docblock = source.slice(0, source.indexOf("export function estimateTokens"));
    expect(docblock).toContain("wc -c");
    expect(docblock).toContain("Math.ceil");
    expect(docblock).toContain("**rounded up**");
    expect(docblock).toContain("Convert at one grain");
  });

  /**
   * TEST-1168, the half that is this package's to hold. Product code has one
   * definition of the number and one conversion; the repo-wide half — that
   * nothing under `apps/` divides by four on its own, and that
   * `scripts/skill-budget.ts` stays development tooling nothing imports — is a
   * cross-workspace fact, recorded in the issue's E2E log with the grep that
   * establishes it and re-asserted by the server lane's own sweep (TEST-1189).
   */
  it("is declared exactly once in this package, and divided in exactly one place", () => {
    const root = new URL("../", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(50);

    const declaring = files.filter((file) =>
      /export const BYTES_PER_TOKEN/.test(readFileSync(file, "utf8")),
    );
    const converting = files.filter((file) =>
      /export function estimateTokens/.test(readFileSync(file, "utf8")),
    );
    const dividing = files.filter((file) => /\/ BYTES_PER_TOKEN/.test(readFileSync(file, "utf8")));

    const telemetry = join(root, "schemas", "telemetry.ts");
    expect(declaring).toEqual([telemetry]);
    expect(converting).toEqual([telemetry]);
    expect(dividing).toEqual([telemetry]);
  });

  it("reaches for no repo tooling: the contract imports nothing from `scripts/`", () => {
    const source = readFileSync(new URL("./telemetry.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ".*scripts\//);
  });
});

describe("the invocation report (CONTRACT-097)", () => {
  it("accepts one invocation naming a document", () => {
    expect(InvocationReportSchema.parse(report)).toEqual(report);
  });

  /** TEST-1173: a verb that names nothing reports nothing, and that is legal. */
  it("accepts an invocation that named no document at all", () => {
    const listing = { ...report, command: "doc list", subjects: [] };
    expect(InvocationReportSchema.parse(listing).subjects).toEqual([]);
  });

  it("says in `subjects` why a search and a listing report zero of them", () => {
    const description = InvocationReportSchema.shape.subjects.description ?? "";
    expect(description).toContain("empty array is legal");
    expect(description).toContain("corpus search");
    expect(description).toContain("doc list");
    expect(description).toContain("returned");
  });

  it("takes a thread id, because threads are documents", () => {
    expect(
      InvocationReportSchema.parse({ ...report, subjects: ["th_x9y8", "doc_a1b2c3"] }),
    ).toEqual({ ...report, subjects: ["th_x9y8", "doc_a1b2c3"] });
  });

  it("refuses an unknown top-level key, naming it (CONTRACT-017)", () => {
    const parsed = InvocationReportSchema.safeParse({ ...report, argv: ["corpus", "thread"] });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("argv");
  });

  it.each([
    ["a negative byte count", { ...report, readBytes: -1 }],
    ["a fractional byte count", { ...report, wroteBytes: 1.5 }],
    ["a raw argv string", { ...report, command: "corpus thread show th_x9y8" }],
    ["an upper-case command", { ...report, command: "Thread show" }],
    ["a three-word path", { ...report, command: "a b c" }],
    ["an instant that is not one", { ...report, at: "yesterday" }],
    ["an id of the wrong kind", { ...report, subjects: ["evt_1"] }],
  ])("refuses %s", (_case, body) => {
    expect(InvocationReportSchema.safeParse(body).success).toBe(false);
  });

  /**
   * The pattern is the CLI registry's own `NAME_PATTERN` applied to a topic and
   * its verb, so no legal invocation can fail it. Checked here against the
   * spellings the CLI really produces, because a rejected report is silently
   * lost — the failure would be missing measurements, not a visible error.
   */
  it.each(["health", "search", "thread show", "doc list", "queue claim-all", "db doctor"])(
    "admits the resolved command path %s",
    (command) => {
      expect(COMMAND_PATH_PATTERN.test(command)).toBe(true);
      expect(InvocationReportSchema.safeParse({ ...report, command }).success).toBe(true);
    },
  );

  it("bounds both arrays, so one request cannot write an unbounded ledger", () => {
    const subjects = Array.from({ length: MAX_REPORT_SUBJECTS + 1 }, () => "doc_a1b2c3");
    expect(InvocationReportSchema.safeParse({ ...report, subjects }).success).toBe(false);
    expect(
      InvocationReportSchema.safeParse({ ...report, subjects: subjects.slice(1) }).success,
    ).toBe(true);

    const invocations = Array.from({ length: MAX_REPORT_BATCH + 1 }, () => report);
    expect(InvocationReportRequestSchema.safeParse({ invocations }).success).toBe(false);
  });
});

describe("the ingestion body's two forms (CONTRACT-097)", () => {
  /** TEST-1170: one invocation, or a batch, and nothing else. */
  it("accepts a single invocation", () => {
    expect(InvocationReportRequestSchema.parse(report)).toEqual(report);
  });

  it("accepts a batch, including an empty one", () => {
    expect(InvocationReportRequestSchema.parse({ invocations: [report, report] })).toEqual({
      invocations: [report, report],
    });
    expect(InvocationReportRequestSchema.parse({ invocations: [] })).toEqual({ invocations: [] });
  });

  it("refuses a body that is neither form, and the refusal names the key that decided it", () => {
    const parsed = InvocationReportRequestSchema.safeParse({ ...report, invocations: [report] });
    expect(parsed.success).toBe(false);
    expect(INVOCATION_REPORT_FORM_MESSAGE).toContain("invocations");
    expect(JSON.stringify(parsed.error?.issues)).toContain("invocations");
  });

  it.each([
    ["an empty object", {}],
    ["a bare array", [report]],
    ["a batch of malformed entries", { invocations: [{ command: "thread show" }] }],
  ])("refuses %s", (_case, body) => {
    expect(InvocationReportRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("a document's cost series (CONTRACT-097)", () => {
  const bucket = {
    from: "2026-09-05T00:00:00Z",
    to: "2026-09-06T00:00:00Z",
    wroteTokens: 3,
    readTokens: 400,
    invocations: 2,
    byCommand: { "thread show": 400, "doc show": 3 },
  };
  const series = {
    granularity: "day" as const,
    buckets: [bucket],
    total: 1,
    truncated: false,
    sizeBytes: 2048,
    measuringSince: "2026-09-01T00:00:00Z",
  };

  it("parses a whole series", () => {
    expect(DocumentCostSchema.parse(series)).toEqual(series);
  });

  it("names the granularity from a closed set the panel can label", () => {
    expect(COST_BUCKET_GRANULARITIES).toEqual(["hour", "day", "week"]);
    expect(DocumentCostSchema.safeParse({ ...series, granularity: "fortnight" }).success).toBe(
      false,
    );
  });

  /** TEST-1175: every field a bucket owes its reader, including the breakdown. */
  it("describes a bucket completely", () => {
    expect(Object.keys(CostBucketSchema.shape)).toEqual([
      "from",
      "to",
      "wroteTokens",
      "readTokens",
      "invocations",
      "byCommand",
    ]);
  });

  it("keys the breakdown by the same command path the report carries", () => {
    expect(
      CostBucketSchema.safeParse({ ...bucket, byCommand: { "corpus thread show": 1 } }).success,
    ).toBe(false);
    expect(CostBucketSchema.parse({ ...bucket, byCommand: {} }).byCommand).toEqual({});
  });

  /**
   * The identity the panel draws, stated on the wire and asserted here on the
   * fixture: `byCommand` sums to `wroteTokens + readTokens` exactly. It holds
   * only because the estimate is taken once per command per direction — see the
   * component's own note — so this is the assertion that would fail first if
   * somebody converted the bucket's summed bytes instead.
   */
  it("publishes a breakdown that sums to the bucket's own total", () => {
    const parsed = CostBucketSchema.parse(bucket);
    const sum = Object.values(parsed.byCommand).reduce((a, b) => a + b, 0);
    expect(sum).toBe(parsed.wroteTokens + parsed.readTokens);
    expect(CostBucketSchema.shape.byCommand.description).toContain(
      "sum to `wroteTokens + readTokens` exactly",
    );
    expect(CostBucketSchema.shape.wroteTokens.description).toContain(
      "rather than converted from the bucket's total bytes",
    );
  });

  it("counts invocations rather than ledger rows", () => {
    expect(CostBucketSchema.shape.invocations.description).toContain(
      "Invocations, not ledger rows",
    );
  });

  /** TEST-1176: one present-tense number, never a second series. */
  it("carries the document's current size, and says it is not a history", () => {
    const description = DocumentCostSchema.shape.sizeBytes.description ?? "";
    expect(description).toContain("**current**");
    expect(description).toContain("frontmatter included");
    expect(description).toContain("not a history");
    expect(description).toContain("reference line");
  });

  /** TEST-1177: `total` and `truncated`, per `JobList`, and the newest kept. */
  it("bounds itself in the vocabulary the surface already uses", () => {
    expect(DocumentCostSchema.shape.total.description).toContain("JobList.total");
    expect(DocumentCostSchema.shape.truncated.description).toContain("**oldest**");
    expect(CostQuerySchema.shape.limit.meta()?.description).toContain("**newest**");
  });

  it("distinguishes an unmeasured document from a free one", () => {
    const empty = { ...series, buckets: [], total: 0, measuringSince: null };
    expect(DocumentCostSchema.parse(empty).measuringSince).toBeNull();
    expect(DocumentCostSchema.shape.buckets.description).toContain("never that it cost nothing");
  });

  it("bounds `limit` and defaults it without making a caller send one", () => {
    expect(CostQuerySchema.parse({})).toEqual({ limit: DEFAULT_COST_BUCKETS });
    expect(CostQuerySchema.parse({ limit: "12" })).toEqual({ limit: 12 });
    expect(CostQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(CostQuerySchema.safeParse({ limit: MAX_COST_BUCKETS + 1 }).success).toBe(false);
  });

  it("keeps the command path's cap the same on both halves of the wire", () => {
    const long = `${"a".repeat(COMMAND_PATH_MAX_LENGTH)} b`;
    expect(InvocationReportSchema.safeParse({ ...report, command: long }).success).toBe(false);
  });
});
