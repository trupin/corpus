import { AGENT_DEF_ROOT, MISSING_PROFILE_CAUSES, type Resident } from "@corpus/contract";

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
 * - `{name, docId: null}` — a profiled resident whose **profile is missing**.
 *   The ways in are {@link MISSING_PROFILE_CAUSES}, which is the list every
 *   surface here composes from rather than restating (SHARED-054); archiving is
 *   deliberately not among them, and the reason is on that constant. The
 *   designation stands and the resident goes on owning its scope; §7 requires
 *   the miss be *reported* rather than silently substituted, and this is that
 *   report.
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
 * **What makes a resident's profile go missing — one home, re-exported here**
 * (SHARED-054).
 *
 * These were hand-typed prose at ten sites, then composed from three separate
 * arrays, then held equal by a parity test. A test holding three lists equal is
 * not one home; it is three homes with a guard. `packages/contract` is the
 * dependency-correct home — `apps/cli` and `packages/kit` may both import it and
 * it may import neither — so the array lives there and this package re-exports
 * it under the names its own help text already uses.
 *
 * **Archiving is deliberately absent** from the list, and that is the false
 * statement PR #50 removed: an archived `agent-def` stays under
 * `.claude/agents/`, keeps resolving, and stays designatable.
 * `scripts/missing-profile-parity.test.ts` still pairs each cause with a
 * **workspace act** and asks the real projector what that act does, so a cause
 * added without an act — or an act that starts emptying the field without a
 * cause — is a failing test rather than a sentence nobody re-measures. What it
 * no longer has to do is compare copies against each other.
 */
export { AGENT_DEF_ROOT, MISSING_PROFILE_CAUSES };

/**
 * The causes as one English list, with the root code-quoted for the help
 * registry's markdown — `docs/cli.md` is generated from these strings, and a
 * bare path there reads as prose rather than as a path.
 *
 * Every site says *"has since been ${this}"* or a close variant, so what is
 * shared is the enumeration and not the whole sentence: a help paragraph in
 * which every noun is interpolated reads worse than the drift it prevents, and
 * an unreadable help text is its own defect (SHARED-054, decision 2).
 */
export const MISSING_PROFILE_CAUSES_PHRASE = ((): string => {
  const quoted = MISSING_PROFILE_CAUSES.map((cause) =>
    cause.replace(AGENT_DEF_ROOT, `\`${AGENT_DEF_ROOT}\``),
  );
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1] ?? ""}`;
})();

/**
 * The sentence every one of these surfaces then adds, composed here so the true
 * half of the claim travels with the false half's correction.
 *
 * SHARED-053 removed archiving from the causes; this is what replaced it, and
 * it has to stay beside them — a reader who has just been told three ways a
 * profile can vanish will otherwise assume archiving is a fourth.
 *
 * **`that root` rather than the path interpolated again**, deliberately: the
 * clause always follows {@link MISSING_PROFILE_CAUSES_PHRASE}, which has just
 * named `.claude/agents/`, and the same words are pinned against the contract's
 * `Resident.docId` description by `resident.test.ts`. Spelling the path twice in
 * two sentences would read worse and break that pin.
 */
export const ARCHIVING_IS_NOT_A_CAUSE =
  "**Archiving is not one of those**: an archived `agent-def` still under that root resolves " +
  "exactly as before, and is still designatable";

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
