import { describe, expect, it } from "vitest";
import {
  DoctorReportSchema,
  DRIFT_KINDS,
  PROJECTION_COUNT_FIELDS,
  ProjectionDriftSchema,
  RebuildResultSchema,
  SkippedFileSchema,
} from "./db.js";

const counts = {
  documents: 6,
  threads: 1,
  turns: 2,
  anchors: 1,
  links: 3,
  events: 0,
  jobs: 0,
  locks: 0,
  seen: 1,
};

const rebuild = {
  path: "/w/.corpus/cache.db",
  ...counts,
  durationMs: 42,
  skipped: [],
};

const stats = { files: 6, documents: 6, hashed: 0, parsed: 0, durationMs: 9 };

describe("RebuildResult", () => {
  it("round-trips the clean rebuild of a small workspace", () => {
    expect(RebuildResultSchema.parse(rebuild)).toEqual(rebuild);
  });

  it("carries the files a rebuild had to skip, which is how a partial rebuild is visible", () => {
    const withSkips = {
      ...rebuild,
      skipped: [{ path: "data/docs/broken.md", reason: "frontmatter is not valid YAML" }],
    };
    expect(RebuildResultSchema.parse(withSkips)).toEqual(withSkips);
  });

  /**
   * Pinned against `PopulateReport`: a projection table the server counts and
   * the contract omits would leave `corpus db rebuild` unable to report it.
   */
  it.each(PROJECTION_COUNT_FIELDS)("demands the %s count rather than defaulting it", (field) => {
    const { [field]: _omitted, ...missing } = rebuild;
    expect(RebuildResultSchema.safeParse(missing).success).toBe(false);
  });

  it("names every table `populateFromFiles` re-derives, and no other", () => {
    expect([...PROJECTION_COUNT_FIELDS]).toEqual(Object.keys(counts));
  });

  it.each([-1, 1.5])("rejects a row count of %s", (documents) => {
    expect(RebuildResultSchema.safeParse({ ...rebuild, documents }).success).toBe(false);
  });

  it("round-trips an empty workspace, where every count is zero", () => {
    const empty = {
      ...rebuild,
      documents: 0,
      threads: 0,
      turns: 0,
      anchors: 0,
      links: 0,
      seen: 0,
      durationMs: 0,
    };
    expect(RebuildResultSchema.parse(empty)).toEqual(empty);
  });
});

describe("SkippedFile", () => {
  it("round-trips a document that produced no row, and why", () => {
    const skip = { path: "data/docs/broken.md", reason: "duplicate id doc_a1b2c3" };
    expect(SkippedFileSchema.parse(skip)).toEqual(skip);
  });
});

describe("ProjectionDrift", () => {
  it.each(DRIFT_KINDS)("recognises the %s kind", (kind) => {
    const entry = { kind, path: "data/docs/mortgage.md", detail: "…" };
    expect(ProjectionDriftSchema.parse(entry)).toEqual(entry);
  });

  it("rejects a kind the server never classifies", () => {
    const entry = { kind: "vibes_mismatch", path: null, detail: "…" };
    expect(ProjectionDriftSchema.safeParse(entry).success).toBe(false);
  });

  /** `count_mismatch` concerns a whole table, not one file. */
  it("carries a null path for a drift that concerns no single file", () => {
    const entry = {
      kind: "count_mismatch" as const,
      path: null,
      detail: ".corpus/queue holds 2 evt_*.json file(s) but the projection has 1 event row(s)",
    };
    expect(ProjectionDriftSchema.parse(entry)).toEqual(entry);
  });

  /**
   * Nullable, not optional: an absent key would be ambiguous between "concerns
   * no file" and "the server forgot to say".
   */
  it("demands the path key even when there is no path", () => {
    const entry = { kind: "count_mismatch" as const, detail: "…" };
    expect(ProjectionDriftSchema.safeParse(entry).success).toBe(false);
  });
});

describe("DoctorReport", () => {
  it("round-trips a clean projection", () => {
    const clean = { ok: true, drift: [], stats };
    expect(DoctorReportSchema.parse(clean)).toEqual(clean);
  });

  it("round-trips a drifted projection with several findings", () => {
    const drifted = {
      ok: false,
      drift: [
        { kind: "missing_row" as const, path: "data/docs/new.md", detail: "no `documents` row" },
        { kind: "count_mismatch" as const, path: null, detail: "2 files, 1 row" },
      ],
      stats: { ...stats, hashed: 1, parsed: 1 },
    };
    expect(DoctorReportSchema.parse(drifted)).toEqual(drifted);
  });

  it("demands the verdict flag rather than leaving it to be re-derived", () => {
    expect(DoctorReportSchema.safeParse({ drift: [], stats }).success).toBe(false);
  });

  it("demands the stats, which is what makes a warm run's cheapness observable", () => {
    expect(DoctorReportSchema.safeParse({ ok: true, drift: [] }).success).toBe(false);
  });

  it("rejects a report whose stats omit a counter", () => {
    const { hashed: _omitted, ...partial } = stats;
    expect(DoctorReportSchema.safeParse({ ok: true, drift: [], stats: partial }).success).toBe(
      false,
    );
  });
});
