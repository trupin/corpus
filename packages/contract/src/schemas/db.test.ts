import { describe, expect, it } from "vitest";
import {
  CoreDoctorWarningKindSchema,
  DOCTOR_WARNING_KINDS,
  DoctorReportSchema,
  DoctorWarningSchema,
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

describe("DoctorWarning", () => {
  const warning = {
    kind: "unindexable_file" as const,
    path: "data/docs/.claude/skills/invisible-doc.md",
    detail: "the projection will never index this file; move it out of `.claude/` to recover it",
    commit: "a1b2c3d",
  };

  it("round-trips a finding through JSON, which is the only way it travels", () => {
    expect(DoctorWarningSchema.parse(JSON.parse(JSON.stringify(warning)))).toEqual(warning);
  });

  it.each(DOCTOR_WARNING_KINDS)("recognises the shipped %s kind", (kind) => {
    expect(DoctorWarningSchema.parse({ ...warning, kind }).kind).toBe(kind);
  });

  /**
   * The whole point of the open kind space: SERVER-038 adds a report-only pass,
   * a later one adds another, and neither costs a contract release. A closed
   * enum here would make this test the thing that has to be edited each time.
   */
  it("accepts a kind this file has never heard of", () => {
    const future = { ...warning, kind: "orphaned_attachment" };
    expect(DoctorWarningSchema.parse(future)).toEqual(future);
  });

  it.each(["Unindexable_File", "unindexable-file", "9lives", "_leading", "unindexable file", ""])(
    "rejects %o, which is not a token a consumer can switch on",
    (kind) => {
      expect(DoctorWarningSchema.safeParse({ ...warning, kind }).success).toBe(false);
    },
  );

  it("rejects a kind long enough to be prose rather than a key", () => {
    expect(DoctorWarningSchema.safeParse({ ...warning, kind: "a".repeat(65) }).success).toBe(false);
    expect(DoctorWarningSchema.safeParse({ ...warning, kind: "a".repeat(64) }).success).toBe(true);
  });

  /** Openness is on the wire; the narrowing helper stays closed for consumers that switch. */
  it("offers a closed narrowing schema over the kinds the product ships", () => {
    expect(CoreDoctorWarningKindSchema.safeParse("unindexable_file").success).toBe(true);
    expect(CoreDoctorWarningKindSchema.safeParse("orphaned_attachment").success).toBe(false);
  });

  /**
   * Nullable, not optional — `ProjectionDrift.path`'s convention, and the reason
   * a future kind concerning no single file needs no contract edit.
   */
  it("carries a null path for a finding that concerns no single file", () => {
    const entry = { ...warning, path: null };
    expect(DoctorWarningSchema.parse(entry)).toEqual(entry);
  });

  it.each(["path", "commit"] as const)("demands the %s key even when there is none", (field) => {
    const { [field]: _omitted, ...missing } = warning;
    expect(DoctorWarningSchema.safeParse(missing).success).toBe(false);
  });

  it("carries a null commit when nothing committed the file it names", () => {
    const entry = { ...warning, commit: null };
    expect(DoctorWarningSchema.parse(entry)).toEqual(entry);
  });

  it("rejects a commit that is not a sha, so the audit-trail field stays usable", () => {
    expect(DoctorWarningSchema.safeParse({ ...warning, commit: "HEAD~1" }).success).toBe(false);
  });

  it("requires a detail, since a kind and a path alone tell nobody what to do", () => {
    const { detail: _omitted, ...missing } = warning;
    expect(DoctorWarningSchema.safeParse(missing).success).toBe(false);
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

  /**
   * CONTRACT-025. The pass/fail half of the rider: a clean projection carrying
   * report-only findings is still clean, because §11's standing `rebuild &&
   * doctor` invariant is about drift. A warning that moved `ok` would fail a
   * routine check on precisely the workspaces that need the report.
   */
  it("stays `ok` while carrying warnings, because a warning is not drift", () => {
    const reported = {
      ok: true,
      drift: [],
      stats,
      warnings: [
        {
          kind: "unindexable_file" as const,
          path: "data/docs/node_modules/ignored-dir-doc.md",
          detail: "under `node_modules/`, which the document walk skips",
          commit: "0f1e2d3",
        },
      ],
    };
    const parsed = DoctorReportSchema.parse(reported);
    expect(parsed).toEqual(reported);
    expect(parsed.ok).toBe(true);
  });

  it("carries several findings at once, alongside real drift", () => {
    const both = {
      ok: false,
      drift: [{ kind: "orphan_row" as const, path: "data/docs/gone.md", detail: "no file" }],
      stats,
      warnings: [
        {
          kind: "unindexable_file" as const,
          path: "data/docs/.hidden/a.md",
          detail: "…",
          commit: null,
        },
        {
          kind: "unindexable_file" as const,
          path: "data/docs/node_modules/b.md",
          detail: "…",
          commit: "abcdef1",
        },
      ],
    };
    expect(DoctorReportSchema.parse(both)).toEqual(both);
  });

  /**
   * Optional, unlike `warningsField` on every mutation response: this field is
   * ahead of its producer by construction, so a report built before SERVER-038
   * exists must still validate. Absence and emptiness are the same statement.
   */
  it("omits the key entirely when the server runs no warning pass", () => {
    const parsed = DoctorReportSchema.parse({ ok: true, drift: [], stats });
    expect("warnings" in parsed).toBe(false);
  });

  it("accepts an explicitly empty warnings array as the same statement", () => {
    expect(DoctorReportSchema.parse({ ok: true, drift: [], stats, warnings: [] })).toEqual({
      ok: true,
      drift: [],
      stats,
      warnings: [],
    });
  });

  it("rejects a malformed warning rather than passing it through unvalidated", () => {
    const bad = { ok: true, drift: [], stats, warnings: [{ kind: "unindexable_file" }] };
    expect(DoctorReportSchema.safeParse(bad).success).toBe(false);
  });

  /** The two families are separate vocabularies; a §11 mutation warning is not one of these. */
  it("does not accept a §11 mutation warning in the doctor warnings list", () => {
    const wrongFamily = {
      ok: true,
      drift: [],
      stats,
      warnings: [{ code: "commit_failed", detail: "hook rejected" }],
    };
    expect(DoctorReportSchema.safeParse(wrongFamily).success).toBe(false);
  });
});
