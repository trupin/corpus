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
// **`weight` is the one key whose absence is legal** (SERVER-129). Every
// designation written before §7's weight rider has no such key, and none is what
// "no level was chosen" has always looked like on disk, so the stored shape
// takes an absent `weight` and the wire shape reports `null` for it. See
// `withStoredWeight`.

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
const withStoredWeight = (value: unknown): unknown =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !Object.hasOwn(value, "weight")
    ? { ...value, weight: null }
    : value;

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
  const parsed = ResidentSchema.safeParse(withStoredWeight(value));
  return parsed.success
    ? { name: parsed.data.name, docId: parsed.data.docId, weight: parsed.data.weight }
    : null;
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
