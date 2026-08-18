import type { Resident } from "@corpus/contract";

/**
 * **How this CLI says who is resident** — one function, so four surfaces cannot
 * come to call the same thing four things (SPEC.md §7, rider SHARED-048).
 *
 * A `Resident` carries two independent fields and therefore three states, and
 * the whole point of rendering it in one place is that they stay three:
 *
 * - `{name: null, docId: null}` — a **general resident**: the designation named
 *   no profile. §7 calls this the ordinary case, and it required nothing to
 *   exist in the workspace first.
 * - `{name, docId}` — a **profiled resident**: an `agent-def` document a reader
 *   can open to see what the agent is.
 * - `{name, docId: null}` — a profiled resident whose **profile is missing**,
 *   renamed or archived since. The designation stands and the resident goes on
 *   owning its scope; §7 requires the miss be *reported* rather than silently
 *   substituted, and this is that report.
 *
 * **The rule is the contract's; the word is this CLI's, and deliberately.**
 * `schemas/agents.ts` states the binding part — a caller must never substitute a
 * word for a null `name` and print it *as a name*, because beside real profile
 * names it would be indistinguishable from one and could collide with an
 * agent-def titled the same — and then says outright that *"a caller that wants
 * a word for a general resident picks its own"*. So what is borrowed here is the
 * prohibition, not the vocabulary.
 *
 * This file obeys the prohibition by position: a profile always prints as
 * `name (something)`, and a general resident has no parenthesis at all, so the
 * label can never be read as occupying a profile name's slot.
 *
 * **`@corpus/kit` says it differently, and that is not drift.** The board's badge
 * reads *"resident, no profile"* where a row here reads *"a general resident"* —
 * one is a label under a title, the other a noun phrase in a list, and a single
 * string would read badly in one of them. What must agree between the two
 * surfaces is the *fact* and the prohibition, and those are stated once, in the
 * schema. Restating the schema's rule is right; sharing its wording was never
 * required, and claiming to share it when we do not is what would mislead the
 * next reader here.
 */

/**
 * A general resident, with its article: every use site puts it where a noun
 * phrase goes — `designated a general resident on th_…`, `released a general
 * resident from th_…` — and a bare "general resident" reads there as a name.
 */
export const GENERAL_RESIDENT = "a general resident";

/**
 * What stands where the profile document's id would be, when the name resolves
 * to nothing. It occupies the *same slot* as a `doc_…` on purpose: that is what
 * makes "the profile has gone" legible as a fact about the profile rather than
 * as a fact about the resident, who is unchanged.
 */
export const PROFILE_MISSING = "profile missing";

/** Who is resident, in the words the contract uses for the three states it publishes. */
export function residentLabel(resident: Resident): string {
  if (resident.name === null) return GENERAL_RESIDENT;
  return `${resident.name} (${resident.docId ?? PROFILE_MISSING})`;
}
