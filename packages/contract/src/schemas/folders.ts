import { z } from "zod";
import { DocStatusSchema } from "./doc.js";
import { DocumentIdSchema } from "./id.js";
import { warningsField } from "./warning.js";
import { openapi } from "./openapi-metadata.js";

/**
 * **Folder acts** (SPEC.md §9.2, rider 7 signed 2026-08-22): rename, archive,
 * unarchive and delete, over `data/docs/<path>`.
 *
 * The explorer offers standard actions on a directory and the server had none —
 * every write path takes one document id. These four take a **folder path in a
 * JSON body** rather than in the URL, because a folder path carries slashes and
 * a path parameter that must be escaped is a path parameter callers get wrong.
 *
 * Each is a **bulk act**, so each names every document it changed: §9.2's rule
 * that an act names what it touched, applied to an act whose subject is a
 * directory. A result row is the minimum that lets a client update itself
 * without a refetch — the id, plus the field that changed and nothing else.
 */

/** The document root every folder path here is relative to (SPEC.md §4). */
export const DOCS_FOLDER_ROOT = "data/docs";

/**
 * A control character in a path is the traversal-adjacent input this grammar
 * refuses, and it is checked by code point rather than by a regex so no rule has
 * to be suppressed to write the range down.
 */
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });

const FOLDER_PATH_DESCRIPTION =
  `A folder under \`${DOCS_FOLDER_ROOT}/\`, relative to it: \`finance\`, ` +
  "`finance/mortgage`. No leading or trailing slash, no empty segment, and no segment " +
  "beginning with a dot — which rules out `.` and `..` and every document root outside this " +
  `one. The \`${DOCS_FOLDER_ROOT}/\` prefix is refused rather than accepted, so the path can ` +
  "never be ambiguous. A malformed path is `400` naming the reason; a well-formed path this " +
  "workspace does not hold is `404`.";

/**
 * The path grammar, spelled as a refinement rather than as a regex because the
 * refusals have to be readable: a caller who sent `finance/` gets told about the
 * trailing slash, not shown a pattern.
 *
 * **Relative to `data/docs/`, and the prefix is refused rather than accepted.**
 * `POST /api/docs`'s `folder` takes either spelling, and this deliberately does
 * not: that field files a document *into* a root the server may resolve, while
 * this one names a directory to act on, and the filter it matches
 * (`GET /api/docs?folder=`) has always been relative. Silently accepting both
 * would make `data/docs/finance` ambiguous between the finance folder and a
 * literal `data/docs/data/docs/finance`, and a rename that resolved that guess
 * wrongly moves files. A `data/docs/` prefix is therefore a `400` that says to
 * drop it.
 *
 * **A dot-leading segment is refused outright**, which covers `.` and `..`
 * together with every root outside `data/docs/`. That is what makes the §9.2
 * edge case a refusal rather than a surprise: `.claude/skills/...` is not under
 * this root, and a skill is archived by document (`POST /api/docs/{id}/archive`,
 * which moves its whole folder) rather than by folder.
 */
export const FolderPathSchema = openapi(
  z
    .string()
    .min(1)
    .superRefine((path, ctx) => {
      const fail = (message: string): void => {
        ctx.addIssue({ code: "custom", message });
      };
      if (path.startsWith("/") || path.endsWith("/")) {
        fail(
          "a folder path carries no leading or trailing slash: it is relative to " +
            `\`${DOCS_FOLDER_ROOT}/\`, so write \`finance/mortgage\`.`,
        );
        return;
      }
      if (path.includes("\\")) {
        fail("a folder path separates segments with `/`, never `\\`.");
        return;
      }
      if (hasControlCharacter(path)) {
        fail("a folder path carries no control characters.");
        return;
      }
      if (path === DOCS_FOLDER_ROOT || path.startsWith(`${DOCS_FOLDER_ROOT}/`)) {
        fail(
          `a folder path here is relative to \`${DOCS_FOLDER_ROOT}/\` — drop the prefix and write ` +
            "`finance/mortgage`. (`POST /api/docs`'s `folder` accepts both spellings; this one does " +
            "not, because a rename that guessed wrong moves files.)",
        );
        return;
      }
      for (const segment of path.split("/")) {
        if (segment.length === 0) {
          fail(
            "a folder path has no empty segment: `finance//mortgage` names nothing under " +
              `\`${DOCS_FOLDER_ROOT}/\`.`,
          );
          return;
        }
        if (segment.startsWith(".")) {
          fail(
            `\`${segment}\` is not a folder under \`${DOCS_FOLDER_ROOT}/\`: a path segment does not ` +
              "begin with a dot, which rules out `.` and `..` and every root outside this one. " +
              "Skills are archived by document, not by folder.",
          );
          return;
        }
      }
    }),
  { description: FOLDER_PATH_DESCRIPTION, example: "finance/mortgage" },
);

/**
 * One field carrying {@link FolderPathSchema}, with the grammar kept and the
 * field's own sentence appended. `.describe()` alone would replace the grammar,
 * which is the half a caller getting a `400` needs to read.
 */
const folderPathField = (role: string) =>
  FolderPathSchema.describe(`${role} ${FOLDER_PATH_DESCRIPTION}`);

const RESULT_DOCUMENTS_DESCRIPTION =
  "**Every document this act changed**, including ones the request never named individually " +
  "(SPEC.md §9.2): a folder act is a bulk act, and threads inherit their parent document's " +
  "folder (§6), so a folder's threads are listed beside its documents. Empty when the folder held " +
  "nothing. Each row carries the id and the field that changed and nothing else — enough to " +
  "update a client in place, so no refetch is needed.";

export const RenameFolderRequestSchema = openapi(
  z
    .strictObject({
      from: folderPathField("The folder to rename, as it stands now."),
      to: folderPathField(
        "The folder's new path. **Compared exactly**: a rename that differs only in case is a " +
          "rename, and what a case-insensitive filesystem then does with it is the server's " +
          "problem, not a different request. `409` when `to` already exists — a rename never " +
          "merges two folders, because merging is an act nobody asked for and cannot be undone by " +
          "renaming back.",
      ),
    })
    /**
     * Refused in the schema rather than in the server, because it needs no state:
     * a folder cannot become its own descendant, and the two paths in front of us
     * are the whole of the question.
     */
    .refine(
      (request) => request.to !== request.from && !request.to.startsWith(`${request.from}/`),
      {
        message:
          "`to` is inside `from`: a folder cannot be renamed into itself or into one of its own " +
          "descendants, because the destination moves with the source and there would be nothing " +
          "left to land in.",
        path: ["to"],
      },
    ),
  "RenameFolderRequest",
);

/**
 * The body of archive, unarchive and delete — one shape, shared, because it is
 * one shape. The description is subject-neutral for that reason: which act it is
 * is the operation you called.
 */
export const FolderPathRequestSchema = openapi(
  z.strictObject({ path: folderPathField("The folder to act on.") }),
  "FolderPathRequest",
);

export const MovedFolderDocSchema = openapi(
  z.object({
    id: DocumentIdSchema,
    path: z
      .string()
      .describe("The document's path after the rename, relative to the workspace root."),
  }),
  "MovedFolderDoc",
);

/**
 * One document the act could not apply to (CONTRACT-078).
 *
 * **Why an array on the result rather than a warning code.** A warning's
 * `detail` is prose and is explicitly never parsed — "every distinction a client
 * must act on lives in `code`" — and the distinction a client must act on here
 * is *which document*, which cannot live in an enum. The explorer's folder menu
 * has to be able to say "eleven of twelve", name the twelfth, and leave that
 * row alone; a count and an id are structure, not prose. `POST /api/docs/bulk`
 * already reports its refusals this way, for the same reason.
 *
 * **Why no reason class beside the message**, where the bulk result carries one.
 * Bulk's four classes exist because a bulk request *names* its rows, so two of
 * them (`not-found`, `not-applicable`) are facts about the caller's own request.
 * A folder act names a folder and the server enumerates what is under it, so no
 * refusal here is the caller's mistake and every one has the same remedy: read
 * the message, fix that document, run the act again. A class would also have to
 * be guessed from a caught error — a document whose file has vanished and a
 * document the validator refused arrive as the same kind of throw — and a
 * misclassification published as a fact is worse than a message that is true.
 */
export const FolderRefusalSchema = openapi(
  z.object({
    id: DocumentIdSchema.describe("The document the act could not apply to."),
    message: z
      .string()
      .min(1)
      .describe(
        "Human-readable specifics for this document — the validator's finding, the write error, " +
          "the reason the file could not be read. Rendered verbatim beside the document; never " +
          "parsed. Always present: an entry with no reason tells a person nothing to do next.",
      ),
  }),
  "FolderRefusal",
);

const RESULT_REFUSED_DESCRIPTION =
  "**Every document under the folder the act could not apply to**, each with why (SPEC.md §9.2, " +
  "§10's bulk rule: an act applies to what it can and reports what it could not, and never " +
  "refuses the whole set because of one document). Empty in the ordinary case. A document named " +
  "here **did not change** — nothing about it reached the commit — and the act stands for every " +
  "other document in the folder. It is listed here whether or not it also appears in " +
  "`documents`, which each result defines for itself: the two halves together say what the " +
  "document is now and why it is still that.";

/**
 * A rename carries no `refused`, and that is a property of the act rather than
 * an omission: it is **one directory move**, so it applies to every document
 * under the folder or to none of them, and a failure is the request's `4xx`
 * rather than a document's. A field no producer can fill is not free — a client
 * author would write a recovery that can never run — so it is absent until an
 * act exists that can refuse one document out of a rename.
 */
export const RenameFolderResultSchema = openapi(
  z.object({
    documents: z.array(MovedFolderDocSchema).describe(RESULT_DOCUMENTS_DESCRIPTION),
    warnings: warningsField,
  }),
  "RenameFolderResult",
);

export const FolderStatusChangeSchema = openapi(
  z.object({
    id: DocumentIdSchema,
    status: DocStatusSchema.describe("The document's status after the act."),
  }),
  "FolderStatusChange",
);

export const FolderStatusResultSchema = openapi(
  z.object({
    documents: z
      .array(FolderStatusChangeSchema)
      .describe(
        `${RESULT_DOCUMENTS_DESCRIPTION} A status act lists **every** document under the folder ` +
          "with the status it now has, so one the act was refused is listed here too, carrying " +
          "the status it kept — `refused` is what says why it kept it.",
      ),
    refused: z.array(FolderRefusalSchema).describe(RESULT_REFUSED_DESCRIPTION),
    warnings: warningsField,
  }),
  "FolderStatusResult",
);

export const DeletedFolderDocSchema = openapi(
  z.object({ id: DocumentIdSchema }),
  "DeletedFolderDoc",
);

export const DeleteFolderResultSchema = openapi(
  z.object({
    documents: z
      .array(DeletedFolderDocSchema)
      .describe(
        `${RESULT_DOCUMENTS_DESCRIPTION} Deletion reports ids alone, because there is no field ` +
          "left to report: the client drops these rows. A document the delete was refused is " +
          "**not** here — it still exists — and is in `refused` instead.",
      ),
    refused: z.array(FolderRefusalSchema).describe(RESULT_REFUSED_DESCRIPTION),
    warnings: warningsField,
  }),
  "DeleteFolderResult",
);

export type FolderPath = z.infer<typeof FolderPathSchema>;
export type FolderRefusal = z.infer<typeof FolderRefusalSchema>;
export type RenameFolderRequest = z.infer<typeof RenameFolderRequestSchema>;
export type FolderPathRequest = z.infer<typeof FolderPathRequestSchema>;
export type MovedFolderDoc = z.infer<typeof MovedFolderDocSchema>;
export type RenameFolderResult = z.infer<typeof RenameFolderResultSchema>;
export type FolderStatusChange = z.infer<typeof FolderStatusChangeSchema>;
export type FolderStatusResult = z.infer<typeof FolderStatusResultSchema>;
export type DeletedFolderDoc = z.infer<typeof DeletedFolderDocSchema>;
export type DeleteFolderResult = z.infer<typeof DeleteFolderResultSchema>;
