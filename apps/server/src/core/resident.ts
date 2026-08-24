// SPEC.md §7's resident (SHARED-043, SERVER-109): the agent a standalone thread
// belongs to, as it is stored in that thread's frontmatter.
//
// One reader, for the same reason `provenance.ts` is one reader of `origin`:
// three paths ask this question of raw frontmatter — the file parser (§11
// validation), the thread read that answers the wire, and the projection — and
// three spellings of "is this a resident" is how they come to disagree about a
// hand-written file.
//
// **Lenient, like every other read of a file the server did not write.** A
// `resident:` key that is not `{name, docId}` reads as *no resident* rather than
// failing the document: `resident` was a legal frontmatter key before it meant
// anything here (§5 lets a document carry any key the core does not define), so
// a workspace may already hold a thread whose `resident:` means something else
// entirely, and a corpus that predates a field must not become unreadable
// because of it. What the value cannot do is be *half* honoured: the wire
// promises `{name, docId}` or null, so anything else is null.
//
// **Both keys present with null values is a designation, not the absence of
// one** (SPEC.md §7's SHARED-048 rider, SERVER-121). Since a designation may
// name no profile, `{name: null, docId: null}` is how a *general* resident
// spells itself on disk — a conversation that is designated and has no persona
// document — and it is the one shape a reader must not fold into "nobody".
// Releasing still **removes the key**, which is why absence and this are
// different states and why nothing here has to tell a third one apart. Both keys
// are still required to be present: `{}` and `{name: null}` are not the shape,
// so a bare mapping under `resident:` stays whatever it already meant to the
// workspace that wrote it.
//
// **`weight` and `designationId` are the keys whose absence is legal**
// (SERVER-129, SERVER-147). Every designation written before §7's weight rider
// has no `weight`, and every designation written before CONTRACT-071 has no
// `designationId`; in both cases absence is what "none" has always looked like
// on disk, so the stored shape takes the key as missing and the wire shape
// reports `null` for it. See `withStoredWeight` and `withStoredDesignationId`.

import { ResidentSchema, type Resident } from "@corpus/contract";

/**
 * The `weight` key as the *stored* shape spells it: **absent when none was
 * chosen** (SERVER-129, SPEC.md §7's rider signed 2026-08-19).
 *
 * The wire's `Resident.weight` is required and nullable, because a response
 * field that is sometimes missing is a field every consumer has to guard. A
 * *file* is the opposite case: `weight: null` on disk would be a second spelling
 * of "none chosen" beside the absent key, and every designation written before
 * this rider existed already spells it the absent way. So the two shapes differ
 * by exactly this normalization, applied at the one place a file becomes a
 * `Resident`.
 *
 * It fills the key in rather than making it optional, so the value that reaches
 * {@link ResidentSchema} is the contract's own shape and nothing here restates
 * what a weight may be. A mapping that *does* carry the key — including
 * `weight:` with no value, which YAML reads as null — passes through untouched.
 */
const withStoredKey = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !Object.hasOwn(value, key)
    ? { ...value, [key]: null }
    : value;

const withStoredWeight = (value: unknown): unknown => withStoredKey(value, "weight");

/**
 * The `designationId` key as the *stored* shape spells it: **absent when the
 * designation predates CONTRACT-071** (SERVER-147).
 *
 * Exactly {@link withStoredWeight}'s case, for exactly its reason, and the
 * duplication is why both now go through one helper. The wire field is required
 * and nullable so no consumer has to guard a missing key; a file has one
 * spelling of absence, and every designation written before this field existed
 * spells it by not being there. Those are the designations in every workspace on
 * disk today, and none of them may become unreadable.
 */
const withStoredDesignationId = (value: unknown): unknown => withStoredKey(value, "designationId");

/**
 * The resident stored on a frontmatter mapping, or `null`.
 *
 * Validated with the contract's own `Resident` schema rather than a hand-written
 * predicate, so "what the file may say" and "what the wire carries" are the same
 * shape by construction — including the name's bounds, which exist precisely so
 * an unbounded string never reaches a lookup.
 *
 * **The weight is read, never interpreted** (SERVER-129). It is a level key from
 * the workspace's own tier table — skill text this server never reads — so the
 * only check is the contract's shape check. What the value governs is stated
 * once, in the contract's `RESIDENT_WEIGHT_BOUNDARY`, and is not restated here:
 * the rule has one wording, so it cannot drift site by site.
 *
 * An **ill-shaped** weight (a number, a blank string, two lines) fails the parse
 * and takes the whole block with it, exactly as half a designation does: the
 * block is one value, and honouring the profile while dropping the weight would
 * silently substitute "none chosen" for a choice somebody made — the one thing
 * §7's weight rider forbids.
 */
export const residentOrNull = (value: unknown): Resident | null => {
  const parsed = ResidentSchema.safeParse(withStoredDesignationId(withStoredWeight(value)));
  return parsed.success
    ? {
        name: parsed.data.name,
        docId: parsed.data.docId,
        weight: parsed.data.weight,
        designationId: parsed.data.designationId,
      }
    : null;
};

/**
 * Why a `resident:` block that is **there** did not parse, or `null` when there
 * is nothing to say — the block is absent, or it read as a designation
 * (SERVER-132).
 *
 * {@link residentOrNull} answers one question and discards the reason, which is
 * right for a reader: a thread whose block does not parse has no designation,
 * and that is the whole of what a reader needs. It is wrong for a **report**.
 * The designation disappears from the roster, the resident's next park is
 * refused, work reroutes to the orchestrator, and before this function nothing
 * anywhere said why. The docblock above defends failing the whole block by
 * saying that honouring half of it would substitute "none chosen" for a choice
 * somebody made — and failing it silently substitutes *nobody* for that choice,
 * which is the louder of the two. The parse rule is unchanged; only the silence
 * is.
 *
 * **Asked of the same normalized value the reader parses**, through the same two
 * helpers, so the two can never disagree about which blocks are ill-shaped. An
 * absent key and an explicit `resident: null` are both "nobody designated this",
 * which is the ordinary state of nearly every thread and is not a finding.
 *
 * The message names the failing keys rather than restating what a designation
 * may be: the shape has one wording, in the contract's `ResidentSchema`, and a
 * second wording here is a rule that drifts.
 */
export const residentProblem = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const normalized = withStoredDesignationId(withStoredWeight(value));
  const parsed = ResidentSchema.safeParse(normalized);
  if (parsed.success) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    return "`resident` is not a mapping";
  }
  const faults = parsed.error.issues.map((issue) => {
    const key = issue.path.map(String).join(".");
    return key === "" ? issue.message : `\`${key}\`: ${issue.message}`;
  });
  // Deduplicated and ordered: a union member can report the same key twice, and
  // a report a person reads should not repeat itself.
  return [...new Set(faults)].join("; ");
};

/**
 * The frontmatter value a designation writes — {@link residentOrNull}'s inverse,
 * and the one place the stored shape is produced (SERVER-129).
 *
 * `weight` is spread in rather than written as a key, for the reason
 * `requestedWeightPayload` spreads its own: *absent stays absent structurally*.
 * A hand-written `weight: resident.weight` would put a `null` on disk for every
 * designation that chose no level, and a reader would then meet two spellings of
 * the same nothing forever.
 */
export const residentToStored = (resident: Resident): Record<string, unknown> => ({
  name: resident.name,
  docId: resident.docId,
  ...(resident.weight === null ? {} : { weight: resident.weight }),
  // `designationId` is spread in for the same reason and with one difference:
  // every designation this server writes from now on *has* one, so the absent
  // case here is only ever a caller handing over a resident that carries none —
  // a release's `null`, or a hand-written block. Writing `designationId: null`
  // would still be a second spelling of the nothing an absent key already means
  // in every file on disk today (SERVER-147).
  ...(resident.designationId === null ? {} : { designationId: resident.designationId }),
});

/**
 * The resident a thread's frontmatter designates: {@link residentOrNull} of the
 * `resident` key, and `null` for a thread that has a parent.
 *
 * §7 allows the designation only on a **standalone** thread — "a thread on a
 * document is *about* that document, and a resident owns a conversation rather
 * than a passage" — and the contract states the consequence as a promise about
 * every response: `resident` is always null on an anchored or whole-document
 * thread. The routes refuse to write one there, so this is about the other way
 * in: a hand-edited file, which §5 makes the source of truth. Filtering it here,
 * where both the wire read and the projection ask, is what keeps the promise
 * true of a workspace the server did not write.
 */
export const storedResident = (value: unknown, parent: string | null): Resident | null =>
  parent === null ? residentOrNull(value) : null;
