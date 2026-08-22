import { z } from "@hono/zod-openapi";
import { DocumentIdSchema } from "./id.js";

/**
 * The wire form of the corpus validator (SPEC.md §11) — the shapes behind
 * `POST /api/check` and, through it, `corpus doc check`.
 *
 * §11's requirement is that "the same validator behind `corpus doc check` runs
 * on every save": hooks and API share one implementation. That implementation
 * ships in `apps/server/src/core/check.ts`, and this module is deliberately a
 * transcription of its vocabulary rather than a second description of it:
 *
 * - {@link CHECK_CODES} is `CHECK_CODES`' fourteen values, verbatim.
 * - {@link CheckFindingSchema}'s fields are `CheckFinding`'s field names,
 *   verbatim (`code`, `severity`, `docId`, `path`, `detail`).
 * - {@link CheckReportSchema}'s `errors`/`warnings` are `CheckReport`'s, plus
 *   the `ok` verdict a caller would otherwise have to re-derive.
 * - {@link CheckDocumentInputSchema} is `toCheckDocument(path, raw)`'s argument
 *   list, so a handler is `documents.map((d) => toCheckDocument(d.path, d.content))`.
 *
 * The transcription is duplication on purpose: the dependency direction runs
 * `packages/contract` ← `apps/server`, so the contract cannot import the
 * validator, and a server that drifts from these codes fails its own tests
 * against the enum published here.
 *
 * **Not the §11 commit warning.** `CheckReport.warnings` is the validator's
 * severity split — findings that do not fail the check. It is unrelated to
 * `Warning` (`./warning.ts`), which reports an auto-commit that a workspace git
 * hook rejected. `/api/check` writes nothing and produces no commit, so it can
 * carry no `Warning` at all.
 */

/**
 * Every code the validator can emit, in the order `apps/server`'s `CHECK_CODES`
 * declares them. A closed enum rather than an open string: the CLI's exit-6
 * decision and the UI's rendering both switch on it, and a code nobody can
 * narrow is a code nobody can act on.
 */
export const CHECK_CODES = [
  "frontmatter-unparseable",
  "frontmatter-invalid",
  "id-prefix-mismatch",
  "duplicate-id",
  "anchor-malformed",
  "duplicate-anchor-id",
  "thread-parent-missing",
  "thread-anchor-missing",
  "anchor-claimed-twice",
  "anchor-unused",
  "duplicate-turn-timestamp",
  "unterminated-fence",
  "anchor-unresolved",
  "ref-unresolved",
] as const;

/**
 * Exactly the two states §11 carves out as warnings: an anchor that is
 * well-formed but no longer resolves (an orphaned thread — a normal outcome of
 * editing, §6), and a `[[ref]]` whose target does not exist *yet* (how a corpus
 * grows, §5). Every other code is an error.
 *
 * `anchor-unused` is deliberately **not** here: §11 lists "every anchor belongs
 * to an existing thread" among the rules a mutation must satisfy, so a highlight
 * pointing at no conversation is structural drift, not an evolving-corpus state.
 * Nor is `unterminated-fence`: an unclosed fence swallows everything after it,
 * a thread's later turns included, so it destroys content rather than describing
 * a corpus mid-growth. Like `anchor-unused` it fails a check without blocking a
 * save — the two families here are about the *verdict*, not about what the write
 * path refuses.
 */
export const CHECK_WARNING_CODES = ["anchor-unresolved", "ref-unresolved"] as const;

/** Widened so the partition below reads as a set membership test, not a tuple search. */
const WARNING_CODES: ReadonlySet<string> = new Set(CHECK_WARNING_CODES);

/** The twelve codes that fail a check — the exit-6 class. */
export const CHECK_ERROR_CODES: readonly CheckCode[] = CHECK_CODES.filter(
  (code) => !WARNING_CODES.has(code),
);

export const CHECK_SEVERITIES = ["error", "warning"] as const;

export const CheckCodeSchema = z.enum(CHECK_CODES).openapi({
  description:
    "Which §11 rule the finding reports. Warnings are exactly `anchor-unresolved` (an orphaned " +
    "thread) and `ref-unresolved` (a `[[ref]]` whose target does not exist yet); the other twelve " +
    "are errors, `anchor-unused` and `unterminated-fence` among them.",
  example: "ref-unresolved",
});

export const CheckSeveritySchema = z.enum(CHECK_SEVERITIES).openapi({
  description:
    "`error` fails the check (the CLI's exit 6); `warning` is reported and does not. Derivable " +
    "from `code`, and sent anyway so a consumer never has to hold the partition itself.",
});

export const CheckFindingSchema = z
  .object({
    code: CheckCodeSchema,
    severity: CheckSeveritySchema,
    // A plain nullable string, never a validated id: `id-prefix-mismatch` and
    // `frontmatter-invalid` exist precisely to report an id that is malformed or
    // of the wrong kind, so validating this field would make the report
    // unserializable in exactly the cases it is written for. Null when the file
    // could not be read at all.
    docId: z
      .string()
      .nullable()
      .describe(
        "Id of the offending document as written in its frontmatter, or null when the file " +
          "could not be read. Reported verbatim and deliberately unvalidated — a malformed id is " +
          "one of the things a finding reports.",
      ),
    path: z.string().describe("Workspace-relative path of the offending file."),
    detail: z
      .string()
      .describe("Human-readable specifics, rendered verbatim by `corpus doc check`; never parsed."),
  })
  .openapi("CheckFinding");

export const CheckReportSchema = z
  .object({
    ok: z
      .boolean()
      .describe(
        "True exactly when `errors` is empty — the verdict `corpus doc check` turns into its exit " +
          "code (0, or 6 for a check-style failure). Warnings never affect it.",
      ),
    errors: z.array(CheckFindingSchema).describe("Findings that fail the check. Empty when `ok`."),
    warnings: z
      .array(CheckFindingSchema)
      .describe(
        "Findings that do not fail the check: orphaned anchors and unresolved `[[refs]]` (§11). " +
          "Unrelated to the `Warning` shape mutation responses carry for a rejected auto-commit — " +
          "this route writes nothing and can produce none.",
      ),
  })
  .openapi("CheckReport");

/**
 * One document handed to the checker as bytes rather than by id — the `--staged`
 * form, where the content to validate is in git's index and not yet on disk.
 *
 * Named `…Input` rather than `CheckDocument` on purpose: the server's
 * `CheckDocument` is the *parsed* union (`{ok: true, document}` /
 * `{ok: false, error}`), which is what `toCheckDocument` returns. This is what
 * it takes.
 */
export const CheckDocumentInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe(
        "Workspace-relative path the content would be saved at. Used for path-derived rules and " +
          "echoed on every finding, so it must be the real destination path even when the bytes " +
          "come from the index.",
      ),
    content: z
      .string()
      .describe(
        "The whole file, frontmatter and body, exactly as it would be written. Empty is legal and " +
          "reports as unparseable frontmatter, which is what saving it would do.",
      ),
  })
  .openapi("CheckDocumentInput");

/**
 * Ids **exclusive-or** content pairs, enforced by the schema itself rather than
 * by a handler: both branches are closed objects, so naming both keys matches
 * neither branch and naming neither matches neither. The rejection is the
 * standard `400` + `issues[]` every other route produces, and it is a
 * compile-time error in the generated client besides.
 *
 * The union carries its own message because Zod reports a failed union as one
 * top-level issue: the default "Invalid input" would tell a caller nothing about
 * *which* rule it broke, and the whole point of a schema-level XOR is that the
 * refusal explains itself without a handler.
 */
export const CHECK_REQUEST_XOR_MESSAGE =
  "Provide exactly one of `ids` (documents to read from the workspace) or `documents` " +
  "(unsaved `{path, content}` pairs) — never both, never neither, and no other key.";

export const CheckRequestSchema = z.union(
  [
    z.strictObject({
      ids: z
        .array(DocumentIdSchema)
        .describe(
          "Documents to read from the workspace and check. An empty array checks nothing and " +
            "returns an empty report. Ids naming no document contribute no findings — the report " +
            "describes what was read; use `GET /api/docs/{id}` to ask whether a document exists.",
        ),
    }),
    z.strictObject({
      documents: z
        .array(CheckDocumentInputSchema)
        .describe(
          "Content to check without saving it — `corpus doc check --staged`, whose bytes come " +
            "from `git diff --cached`. An empty array checks nothing and returns an empty report.",
        ),
    }),
  ],
  { error: CHECK_REQUEST_XOR_MESSAGE },
);

export type CheckCode = (typeof CHECK_CODES)[number];
export type CheckSeverity = (typeof CHECK_SEVERITIES)[number];
export type CheckFinding = z.infer<typeof CheckFindingSchema>;
export type CheckReport = z.infer<typeof CheckReportSchema>;
export type CheckDocumentInput = z.infer<typeof CheckDocumentInputSchema>;
export type CheckRequest = z.infer<typeof CheckRequestSchema>;
