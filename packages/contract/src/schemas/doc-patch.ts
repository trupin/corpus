import { z } from "zod";
import { jobField } from "./provenance.js";
import { docWriteResponseShape } from "./doc.js";
import { openapi } from "./openapi-metadata.js";

/**
 * The **anchored patch**: editing a document's body by naming the text it
 * expects to find, rather than by sending a whole new body (SPEC.md §9.2, rider
 * SHARED-037 signed 2026-08-12; SPEC.md §7's "What needs a key").
 *
 * ---
 *
 * ## Why the operation exists
 *
 * The write path's unit was the whole body, which priced a one-line edit at the
 * length of the document. Every agent edit therefore cost the document twice —
 * once to read it, once to send it back — and that is the cost this operation
 * removes: a patch costs the length of the change.
 *
 * It also removes a failure the whole-body write cannot avoid. A body a caller
 * never saw cannot survive a body the caller sends: an edit written against a
 * stale read silently drops whatever arrived in between, and an edit written by
 * something that does not understand every marker in the file (styled text,
 * SHARED-035) drops the markers it never saw. **A patch that never carries the
 * rest of the body cannot destroy the rest of the body.**
 *
 * ## Exactly and uniquely, and why the two refusals are separate
 *
 * `old` must match the body exactly and uniquely. Zero matches and multiple
 * matches are both refusals, and they are **distinguishable refusals that name
 * the count**, because the recoveries are opposite:
 *
 *   - **zero** — the text is not there. Re-read the document; what you quoted is
 *     out of date, or was never in the body at all.
 *   - **several** — the text is there more than once. Quote more context so the
 *     excerpt is unique, or say `all` and mean it.
 *
 * A single "it did not apply" collapses the two and leaves the caller guessing
 * between "look again" and "quote more", which is the one thing an agent editing
 * at a distance cannot afford to get wrong. See
 * {@link PatchRefusalReasonSchema}.
 *
 * ## Byte-exact, deliberately unhelpful
 *
 * Matching is against the body **as stored**, exactly as `GET /api/docs/{id}`
 * returned it in `Doc.body`: no trimming, no whitespace collapsing, no
 * line-ending translation, no case folding, no regular expressions. What a
 * caller read is what a caller quotes. "Close enough" matching is precisely how
 * a patch lands somewhere the caller did not mean, and a refusal a caller can
 * fix beats a silent success in the wrong place.
 *
 * ## Body only
 *
 * `Doc.body` is the markdown **without** the frontmatter block, so an `old` that
 * quotes frontmatter simply finds nothing and is refused as a zero-match — no
 * special case, and no route by which a patch could rewrite a key it was never
 * shown. Frontmatter keeps its field-named semantics on `PUT /api/docs/{id}`,
 * which is a write that names its own delta.
 *
 * ## No key, and that is not an omission
 *
 * SPEC.md §7 exempts this operation from presenting a key: **it names the text
 * it expects to find, which is the same staleness check by another route.** A
 * patch whose text has moved is refused on its own terms, with a better message
 * than a key mismatch could give — it says *which* text is gone rather than
 * *that* the document changed. Adding a key here would refuse patches that are
 * still perfectly well anchored merely because an unrelated paragraph moved,
 * which on a corpus two writers share is a refusal with no recovery worth
 * performing. `./key.ts`'s `KEYED_UPDATE_FIELDS` records the same rule from the
 * other side.
 */

/** The excerpt a patch anchors on. Non-empty: replacing nothing is not an edit. */
const OLD_DESCRIPTION =
  "The excerpt of the document's body to replace, quoted **exactly** as it is stored — the same " +
  "bytes `GET /api/docs/{id}` returned in `body`. Matching is byte-exact: no trimming, no " +
  "whitespace collapsing, no line-ending translation, no case folding, and no regular " +
  "expressions. Whitespace and indentation are significant.\n\n" +
  "It must match **exactly once**, or the patch is refused with `409` naming how many times it " +
  "did match — `0` means re-read the document, more than one means quote more surrounding " +
  "context until the excerpt is unique (or pass `all`). The body here is the markdown **without " +
  "the frontmatter block**, so an excerpt that quotes frontmatter matches nothing; frontmatter is " +
  "changed by naming its fields on `PUT /api/docs/{id}`.";

const NEW_DESCRIPTION =
  "What to put in `old`'s place. **May be empty**, which deletes the quoted text — that is the " +
  "spelling of a deletion, and it is not a refusal.\n\n" +
  "Sending it equal to `old` is a **no-op**: the resulting body is the body it started as, so " +
  "nothing is written and no commit is made (SPEC.md §9.2). It is answered `200` rather than " +
  "refused, because a caller that asks for a change already present has got what it asked for.";

const ALL_DESCRIPTION =
  "Replace **every** occurrence of `old` instead of requiring it to be unique. Defaults to " +
  "`false` — the server applies the default, so omit the field rather than sending `false`.\n\n" +
  "Occurrences are found **left to right and never overlap**: after a match, scanning resumes at " +
  'the end of the text that matched, so `old: "aa"` finds one occurrence in `"aaa"` and two ' +
  'in `"aaaa"`. The same scan is what counts matches for a refusal, so the number the server ' +
  "reports and the number a caller counts for itself agree.\n\n" +
  "**It lifts uniqueness, never the requirement to match at all**: an `old` that occurs zero " +
  "times is refused with `409` whether or not `all` is set.";

/**
 * Strict, like every request body (CONTRACT-017). It matters more here than
 * most: the three fields are short common words, and an unknown key silently
 * ignored would mean performing a *different* edit from the one asked for —
 * `replace` for `new`, or `global` for `all`, landing as an unannounced deletion
 * of `old`.
 *
 * There is deliberately **no `key`** (SPEC.md §7; see this module's docblock).
 */
export const PatchDocRequestSchema = openapi(
  z.strictObject({
    job: jobField,
    old: z.string().min(1).describe(OLD_DESCRIPTION),
    new: z.string().describe(NEW_DESCRIPTION),
    all: z.boolean().optional().describe(ALL_DESCRIPTION),
  }),
  "PatchDocRequest",
);

/**
 * Why a well-formed patch was refused by the document's own text. Machine
 * readable, because the two refusals want opposite things from the caller — look
 * at the document again, or quote more of it — and a client that had to match on
 * prose would get it wrong the first time the prose was improved.
 *
 * The count is carried beside it ({@link PatchConflictErrorSchema}), so a caller
 * never has to infer one from the other: `reason` says what happened, `matches`
 * says how much.
 */
export const PATCH_REFUSAL_REASONS = ["no-match", "multiple-matches"] as const;

export const PatchRefusalReasonSchema = openapi(z.enum(PATCH_REFUSAL_REASONS), {
  description:
    "Which state refused the patch: the status code says the document's text did, this says how. " +
    "`no-match`: `old` does not occur in the body at all (`matches` is `0`) — the document is not " +
    "what you last read, or the excerpt was never in the body (frontmatter is not part of it). " +
    "Re-read the document and quote from what it says now. `multiple-matches`: `old` occurs more " +
    "than once (`matches` says how many) and the patch did not ask for `all` — quote more " +
    "surrounding context until the excerpt is unique, or send `all: true` if replacing every " +
    "occurrence is genuinely what you meant.",
});

/**
 * The `409` body of `POST /api/docs/{id}/patch`.
 *
 * ## Why `409` and not `400`
 *
 * The rule this repo already applies everywhere it answers `409`: **`400` tells
 * a client "fix the body and retry"; when retrying with any body cannot help, a
 * `400` sends the caller in circles.** Both refusals here are about the
 * *document*, not the request — `old` is a perfectly valid non-empty string, the
 * body passed every check the schema can make, and the identical request would
 * succeed against a different version of the document. That is the definition of
 * a conflict, and it joins the repo's existing ones (a taken skill name,
 * deferring unclaimed work, re-answering an answered form, a re-attach whose
 * range moved).
 *
 * `422` was rejected for the same reason plus one more: nothing in this contract
 * uses it, and a fourth status family introduced for one route buys a
 * distinction the `code`/`reason` pair already carries.
 *
 * ## Why it narrows `ConflictError` rather than adding an error code
 *
 * Exactly as `ReattachConflictError` does: it adds fields to `{code, message}`
 * instead of a new member of `ERROR_CODES`, so it still parses as an
 * `ApiError` and no consumer that switches on `code` grows a branch. `409`
 * already carries two shapes — `stale_key` (its own code, because it carries a
 * whole document) and the re-attach conflict — and the rule that keeps them
 * apart is that **one `code` never means two things**: `conflict` means "the
 * state refused a well-formed request", and `reason` says which state, per
 * route. A patch refusal reaching a caller as `conflict` is therefore already
 * correctly classified before it is read in detail.
 *
 * ## Why the count is a field and not prose
 *
 * The rider makes naming the count load-bearing, and a number a client has to
 * parse out of a sentence is a number a client will parse wrong. `matches` is
 * counted with the same left-to-right non-overlapping scan `all` replaces with,
 * so the server's count and a caller's own count of its own quote agree.
 */
export const PatchConflictErrorSchema = openapi(
  z.object({
    code: z.literal("conflict"),
    message: z.string(),
    reason: PatchRefusalReasonSchema,
    matches: z
      .number()
      .int()
      .min(0)
      .describe(
        "How many times `old` occurs in the document's body, counted left to right without " +
          "overlap — the count both refusals name, because the two have different recoveries and " +
          "a caller must be able to tell them apart without reading English. `0` for `no-match`; " +
          "two or more for `multiple-matches`. Nothing was written.",
      ),
  }),
  "PatchConflictError",
);

/**
 * What an applied patch answers with.
 *
 * **The same shape every content write answers with** ({@link
 * docWriteResponseShape} — the saved document with its fresh key, the anchor
 * reconciliation report, §11's warnings), because SPEC.md §9.2 says a patch is
 * an ordinary write once applied and that has to be true of the response too. A
 * leaner reply was considered and rejected on two counts: the fresh key is
 * published in exactly one place, on `Doc` (`./key.ts` — a sibling `key` field
 * would be a second copy that could disagree with the first), and a caller that
 * has just changed a document it did not send has *more* need of the resulting
 * body than a caller that sent one, not less. The saved body is also the
 * caller's proof the edit landed where it thought.
 *
 * **Plus the one fact the caller cannot derive**: `replaced`. Every other datum
 * on this response either was in the request or is the server's; the number of
 * occurrences an `all` patch touched is neither — it is the blast radius of an
 * operation whose whole point is that the caller did not enumerate the sites.
 * A success that hid the count while both refusals name it would be the odd one
 * out.
 */
export const PatchDocResponseSchema = openapi(
  z.object({
    ...docWriteResponseShape,
    replaced: z
      .number()
      .int()
      .min(1)
      .describe(
        "How many occurrences of `old` were replaced, counted left to right without overlap. " +
          "Always `1` unless the request set `all`, and never `0` — a patch that matched nothing " +
          "is the `409` refusal, not a `200` that changed nothing.\n\n" +
          "A **no-op** (`new` equal to `old`) still reports the occurrences it covered and " +
          "writes nothing: no file change, no commit. The caller can see that case in its own " +
          "request, so nothing here has to name it separately.",
      ),
  }),
  "PatchDocResponse",
);

export type PatchDocRequest = z.infer<typeof PatchDocRequestSchema>;
export type PatchRefusalReason = z.infer<typeof PatchRefusalReasonSchema>;
export type PatchConflictError = z.infer<typeof PatchConflictErrorSchema>;
export type PatchDocResponse = z.infer<typeof PatchDocResponseSchema>;
