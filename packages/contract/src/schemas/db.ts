import { z } from "@hono/zod-openapi";

/**
 * The projection's two maintenance operations (SPEC.md §11, §12 M1).
 *
 * The projection is a **derived** SQLite cache: "the whole database is
 * reconstructible from the workspace at any time" (§9.1). Two operations make
 * that claim checkable rather than aspirational, and §11 names both — `db
 * doctor` "fails when files and projection rows drift", `db rebuild`
 * "reconstructs the projection from files alone", and "`rebuild && doctor` clean
 * is the standing invariant" that v1's definition of done gates on.
 *
 * Both shapes mirror the server's shipped `rebuild()` / `doctor()` return types
 * exactly (`apps/server/src/projection/{rebuild,populate,doctor}.ts`) so the
 * handlers stay a serialization of an existing value rather than a second,
 * drifting description of one. The two deliberate wire-level adaptations are
 * noted where they occur.
 *
 * `DoctorReport.warnings` (CONTRACT-025) is the one field that deliberately runs
 * *ahead* of the server rather than mirroring it: it is optional precisely so
 * this rider can land before the pass that fills it (SERVER-038), leaving the
 * existing handler compiling untouched. See the field for the rest.
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
    "`unparseable`: the file is a document by location but neither it nor its frontmatter can be " +
    "read — the bytes are unreadable (an unreadable file, a permission error) or the frontmatter " +
    "they carry is not valid. " +
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

/**
 * Report-only doctor findings (CONTRACT-025), and the second half of a
 * deliberate asymmetry with {@link DriftKindSchema} directly above.
 *
 * A **drift** kind is the pass/fail vocabulary: `ok` is derived from `drift`, so
 * a kind a client cannot recognise is a verdict it cannot render. That is why
 * `DRIFT_KINDS` is closed, and why it stays closed.
 *
 * A **warning** kind carries no verdict at all. The only thing a consumer must
 * do with one is render its `detail` verbatim, exactly as `corpus db doctor`
 * already renders a drift line — so an unrecognised kind degrades to a printed
 * line rather than to a broken report. The wire type is therefore an open
 * string, following `QueueEvent.type`'s precedent in `queue.ts`: known values
 * are published as a constant and a narrowing enum ({@link DOCTOR_WARNING_KINDS},
 * {@link CoreDoctorWarningKindSchema}) for consumers that want to switch
 * exhaustively, while the wire itself accepts kinds this file has never heard
 * of. A new report-only pass on the server is then a server change, not a
 * contract release plus a lockstep client upgrade.
 *
 * Openness is bounded rather than total: a kind is a lowercase snake_case token
 * of at most 64 characters, so it stays a key a consumer can switch on, group by
 * or map to an icon, instead of quietly becoming a second prose field beside
 * `detail`.
 *
 * These are **not** SPEC.md §11's mutation warnings (`schemas/warning.ts`).
 * Those describe a write that partly failed — a rejected auto-commit — and their
 * `code` set is closed because it enumerates the ways one pipeline can fail.
 * Doctor writes nothing and can produce no commit warning at all; this is a
 * different vocabulary that happens to share the word, the same way
 * `CheckReport.warnings` does.
 */
export const DOCTOR_WARNING_KINDS = ["unindexable_file"] as const;

/** Narrowing helper for consumers that handle only the kinds the product ships. */
export const CoreDoctorWarningKindSchema = z.enum(DOCTOR_WARNING_KINDS);

export const DoctorWarningKindSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/)
  .openapi({
    description:
      "What kind of report-only finding this is. **Open by design**, unlike `ProjectionDrift.kind`: " +
      "a warning carries no verdict, so a consumer that does not recognise the kind still renders " +
      "`detail` and loses nothing, and the server can add a finding without a contract release. " +
      `Core values: ${DOCTOR_WARNING_KINDS.join(", ")}. ` +
      "`unindexable_file`: a markdown file the projection will never index because its path lies " +
      "under a segment the document walk skips, so the corpus can never show it (SPEC.md §5). " +
      "Constrained to a lowercase snake_case token of at most 64 characters — it is a key to " +
      "switch on, not prose.",
  });

export const DoctorWarningSchema = z
  .object({
    kind: DoctorWarningKindSchema,
    // Nullable, not optional — the same response-side convention `ProjectionDrift`
    // uses, and load-bearing here for a second reason: the kind space is open, so
    // a kind that concerns no single file must be expressible without a contract
    // edit. Null says "no one file" unambiguously, rather than leaving a consumer
    // to guess between that and a server that forgot the key.
    path: z
      .string()
      .nullable()
      .describe(
        "Workspace-relative path this warning concerns. Null when it concerns no single file.",
      ),
    detail: z
      .string()
      .describe(
        "Human-readable specifics — what was found and what a person can do about it. Rendered " +
          "verbatim by `corpus db doctor`; never parsed. Named `detail` to match " +
          "`ProjectionDrift.detail` and `Warning.detail`, so the render-verbatim string has one " +
          "name across the whole contract.",
      ),
    // Nullable because there are honest outcomes with no sha. Inline (never a
    // registered component), so `.nullable()` cannot rewrite a shared schema.
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/)
      .nullable()
      .describe(
        "Sha of the commit that introduced whatever this warning names — `git show <commit>` is " +
          "where it came from, which is the difference between a finding a person can act on and " +
          "a path they must go hunting for. `null` when there is no such commit: the file is " +
          "uncommitted, the workspace has no git, or the kind concerns no single file.",
      ),
  })
  .openapi("DoctorWarning");

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
          "exit code, so a caller never has to re-derive the verdict from the list. `warnings` " +
          "never moves it.",
      ),
    drift: z
      .array(ProjectionDriftSchema)
      .describe("Every disagreement found between the files and the projection. Empty when `ok`."),
    stats: DoctorStatsSchema,
    // Optional rather than required-and-empty, which is the opposite of
    // `warningsField`'s choice for mutation responses, and the difference is
    // deliberate. That field is required because one carrier is spread into every
    // mutation response at once, so no handler can be behind it. This one is
    // ahead of its producer by construction: the rider ships so SERVER-038 has
    // somewhere to put its findings, and a required key would make this contract
    // change a compile error in the shipped doctor handler until that lands. It
    // is also what makes the change additive for a client generated before it —
    // an argument that does not apply to a field that has always existed.
    warnings: z
      .array(DoctorWarningSchema)
      .optional()
      .describe(
        "Report-only findings that are not drift: things worth a person's attention that the " +
          "projection is nonetheless correct about. **Never moves `ok` and never changes the exit " +
          "code** — SPEC.md §11's standing `rebuild && doctor` clean invariant is about drift, and " +
          "a warning that flipped the verdict would fail a routine check on workspaces where " +
          "nothing is wrong with the projection. Absent and empty mean the same thing: a server " +
          "that runs no warning pass omits the key entirely, which is what keeps this field " +
          "additive for clients generated before it existed.",
      ),
  })
  .openapi("DoctorReport");

export type SkippedFile = z.infer<typeof SkippedFileSchema>;
export type RebuildResult = z.infer<typeof RebuildResultSchema>;
export type DriftKind = z.infer<typeof DriftKindSchema>;
export type ProjectionDrift = z.infer<typeof ProjectionDriftSchema>;
export type DoctorWarningKind = z.infer<typeof DoctorWarningKindSchema>;
export type CoreDoctorWarningKind = z.infer<typeof CoreDoctorWarningKindSchema>;
export type DoctorWarning = z.infer<typeof DoctorWarningSchema>;
export type DoctorStats = z.infer<typeof DoctorStatsSchema>;
export type DoctorReport = z.infer<typeof DoctorReportSchema>;
