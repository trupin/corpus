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
 * **The words are the contract's, not this CLI's.** `schemas/agents.ts` names
 * the first *a general resident* and is explicit that a caller must not
 * substitute a word for a null `name` and print it *as a name* — beside real
 * profile names it would be indistinguishable from one, and could collide with
 * an agent-def titled the same. So the label for a general resident is never in
 * the position a profile name occupies: a profile is always printed as
 * `name (something)`, and a general resident has no parenthesis at all.
 *
 * Borrowing the contract's vocabulary rather than inventing a CLI-local one is
 * also why this file is three lines long. The board renders the same three
 * states from the same schema; two surfaces that invented their own words for a
 * general resident would leave a person reading `corpus agents` and the board
 * unable to tell they were being told the same fact.
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
