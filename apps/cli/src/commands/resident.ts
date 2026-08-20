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
 * - `{name, docId: null}` — a profiled resident whose **profile is missing**:
 *   renamed, deleted, or moved out of `.claude/agents/` since. The designation
 *   stands and the resident goes on owning its scope; §7 requires the miss be
 *   *reported* rather than silently substituted, and this is that report.
 *   **Archiving is not one of the ways in** — an archived `agent-def` still under
 *   that root resolves exactly as before, and is still designatable, so it prints
 *   as the second state, with its id.
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
 *
 * **A fourth field, and it is not a fourth state** (SPEC.md §7's weight rider,
 * signed 2026-08-19; CLI-053). `Resident.weight` is the level the resident runs
 * at, orthogonal to the profile pair — a general resident may run at a stated
 * weight and a profiled one at none — so it is rendered as a **suffix** on
 * whichever of the three labels applies rather than as a fourth branch. Null is
 * *none chosen*, and it prints nothing: the prohibition `name` carries applies
 * whole, and a word invented for an unstated weight would read beside real
 * level keys as one of them.
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

/**
 * The word that joins a resident to the weight it runs at — `a general resident
 * at heavy`, `researcher (doc_r1) at heavy`.
 *
 * **A preposition rather than the ` · ` CLI-053 sketched**, and the reason is
 * `corpus agents`: that verb joins a row's *cells* with ` · `, so a middle dot
 * inside the resident cell would make one row four dot-separated fields and the
 * next row three, and the row is documented as something an agent reads
 * positionally. A preposition keeps the cell one cell at every surface, and
 * reads as English in the two sentences the other surfaces build — `designated
 * a general resident at heavy on th_…`, `released researcher (doc_r1) at heavy
 * from th_…`.
 *
 * It cannot be mistaken for part of a profile name either: a profile always
 * ends in `(…)`, so what follows the parenthesis is never inside it.
 */
export const AT_WEIGHT = "at";

/**
 * A resident label with its weight, or the label alone when none was chosen.
 *
 * Exported because one caller has a label but no `Resident` to build it from:
 * `thread designate` falls back to the caller's own `--agent`/`--weight` when a
 * `200` somehow carries no resident, and that line must name the weight the
 * caller asked for rather than drop it.
 *
 * A blank weight prints nothing too. The contract rejects one
 * (`RequestedWeightSchema` is non-blank), so this cannot happen from a
 * conforming server — and a trailing bare `at` would be a worse thing to show a
 * reader than a weight that is simply absent.
 */
export function withWeight(label: string, weight: string | null): string {
  if (weight === null || weight.trim() === "") return label;
  return `${label} ${AT_WEIGHT} ${weight.trim()}`;
}

/**
 * Who is resident, in the words the contract uses for the three states it
 * publishes, and what it runs at where a weight was chosen.
 */
export function residentLabel(resident: Resident): string {
  return withWeight(profileLabel(resident), resident.weight);
}

/** The three profile states, before the weight suffix is put on. */
function profileLabel(resident: Resident): string {
  if (resident.name === null) return GENERAL_RESIDENT;
  return `${resident.name} (${resident.docId ?? PROFILE_MISSING})`;
}
