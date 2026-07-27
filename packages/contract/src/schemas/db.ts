import { z } from "@hono/zod-openapi";

/**
 * The projection's two maintenance operations (SPEC.md §14, §15 M1).
 *
 * The projection is a **derived** SQLite cache: "the whole database is
 * reconstructible from the workspace at any time" (§9.1). Two operations make
 * that claim checkable rather than aspirational, and §14 names both — `db
 * doctor` "fails when files and projection rows drift", `db rebuild`
 * "reconstructs the projection from files alone", and "`rebuild && doctor` clean
 * is the standing invariant" that v1's definition of done gates on.
 *
 * Both shapes mirror the server's shipped `rebuild()` / `doctor()` return types
 * exactly (`apps/server/src/projection/{rebuild,populate,doctor}.ts`) so the
 * handlers stay a serialization of an existing value rather than a second,
 * drifting description of one. The two deliberate wire-level adaptations are
 * noted where they occur.
 */

/** Every table `populateFromFiles` re-derives, in the order it derives them. */
export const PROJECTION_COUNT_FIELDS = [
  "documents",
  "threads",
  "turns",
  "anchors",
  "links",
  "events",
  "jobs",
  "locks",
  "seen",
] as const;

export type ProjectionCountField = (typeof PROJECTION_COUNT_FIELDS)[number];

const rowCount = (what: string) =>
  z.number().int().min(0).describe(`Rows written to \`${what}\` by this rebuild.`);

const projectionCounts = {
  documents: rowCount("documents"),
  threads: rowCount("threads"),
  turns: rowCount("turns"),
  anchors: rowCount("anchors"),
  links: rowCount("links"),
  events: rowCount("events"),
  jobs: rowCount("jobs"),
  locks: rowCount("locks"),
  seen: rowCount("seen"),
} as const satisfies Record<ProjectionCountField, z.ZodType>;

/**
 * A file that is a document by location but produced no row. Reported rather
 * than thrown: §9.1's rebuild is not allowed to fail because one document is
 * broken, and a caller that cannot see what was skipped would read a partial
 * rebuild as a complete one.
 */
export const SkippedFileSchema = z
  .object({
    path: z.string().describe("Workspace-relative path of the file that produced no row."),
    reason: z.string().describe("Why it was skipped. Rendered verbatim; never parsed."),
  })
  .openapi("SkippedFile");

export const RebuildResultSchema = z
  .object({
    path: z
      .string()
      .describe(
        "Absolute path of the database this rebuild produced — `.corpus/cache.db`, which the " +
          "rebuild replaced atomically by rename.",
      ),
    ...projectionCounts,
    durationMs: z
      .number()
      .int()
      .min(0)
      .describe("Wall-clock time the rebuild took, so `corpus db rebuild` can report it."),
    skipped: z
      .array(SkippedFileSchema)
      .describe(
        "Files that are documents by location but produced no row. Empty is the good case.",
      ),
  })
  .openapi("RebuildResult");

/**
 * The ways a projection can disagree with the files, as
 * `apps/server/src/projection/doctor.ts` classifies them.
 */
export const DRIFT_KINDS = [
  "missing_row",
  "orphan_row",
  "content_mismatch",
  "count_mismatch",
  "unparseable",
  "duplicate_id",
] as const;

export const DriftKindSchema = z.enum(DRIFT_KINDS).openapi({
  description:
    "`missing_row`: a document file exists but the projection has no row for it. " +
    "`orphan_row`: the projection has a row for a path that no longer exists. " +
    "`content_mismatch`: the file's bytes no longer hash to what was projected. " +
    "`count_mismatch`: a table the projection keeps no per-item detail for disagrees with the " +
    "files by count. " +
    "`unparseable`: the file is a document by location but its frontmatter cannot be read. " +
    "`duplicate_id`: two files claim one id; only the first by path order is projected.",
});

export const ProjectionDriftSchema = z
  .object({
    kind: DriftKindSchema,
    // Nullable, not optional — the response-side convention this contract uses
    // everywhere (see `query.ts`'s thread-row shape). The server's own `Drift`
    // leaves `path` absent on the one kind that concerns no single file
    // (`count_mismatch`); on the wire the key is always there and `null` says so
    // unambiguously, rather than leaving a consumer to guess between "no path"
    // and "the server forgot".
    path: z
      .string()
      .nullable()
      .describe(
        "Workspace-relative path this drift concerns. Null when it concerns no single file, " +
          "which today is exactly `count_mismatch`.",
      ),
    detail: z
      .string()
      .describe("Human-readable specifics, rendered verbatim by `corpus db doctor`; never parsed."),
  })
  .openapi("ProjectionDrift");

export const DoctorStatsSchema = z
  .object({
    files: z.number().int().min(0).describe("Document files found under the workspace roots."),
    documents: z.number().int().min(0).describe("`documents` rows the projection holds."),
    hashed: z
      .number()
      .int()
      .min(0)
      .describe(
        "Files whose bytes had to be read and hashed. Zero on a warm, untouched workspace — " +
          "doctor skips any file whose size and mtime are unchanged, which is what keeps it " +
          "inside a pre-commit hook's budget.",
      ),
    parsed: z
      .number()
      .int()
      .min(0)
      .describe("Files that had to be parsed, i.e. those with no row to explain them."),
    durationMs: z.number().int().min(0).describe("Wall-clock time the check took."),
  })
  .openapi("DoctorStats");

export const DoctorReportSchema = z
  .object({
    ok: z
      .boolean()
      .describe(
        "True exactly when `drift` is empty. The single flag `corpus db doctor` turns into its " +
          "exit code, so a caller never has to re-derive the verdict from the list.",
      ),
    drift: z
      .array(ProjectionDriftSchema)
      .describe("Every disagreement found between the files and the projection. Empty when `ok`."),
    stats: DoctorStatsSchema,
  })
  .openapi("DoctorReport");

export type SkippedFile = z.infer<typeof SkippedFileSchema>;
export type RebuildResult = z.infer<typeof RebuildResultSchema>;
export type DriftKind = z.infer<typeof DriftKindSchema>;
export type ProjectionDrift = z.infer<typeof ProjectionDriftSchema>;
export type DoctorStats = z.infer<typeof DoctorStatsSchema>;
export type DoctorReport = z.infer<typeof DoctorReportSchema>;
