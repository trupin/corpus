import { ORCHESTRATOR_LANE } from "@corpus/contract";
import { unknownLaneRow, type LaneRow } from "../recipient/laneRows.js";
import {
  RECIPIENT_REFUSED_STATEMENT,
  RECIPIENT_UNKNOWN_STATEMENT,
} from "../recipient/statement.js";
import type { ComposerRecipient } from "../recipient/useComposerRecipient.js";
import type { ComposerWeight } from "../weight/weightChoice.js";
import type { WeightLevel } from "../weight/weightLevels.js";

/**
 * One composer's **address**: who answers, and at what weight — the single
 * derivation behind the line every composer shows and the popover it opens
 * (SPEC.md §10: the recipient statement, the weight control, and the rider
 * signed 2026-08-19 that makes the second not live for a resident's lane; §7's
 * *"a resident's weight is set when it is designated, not per message"*;
 * UI-126).
 *
 * ## Why one derivation and not two controls
 *
 * The weight and the recipient were two always-expanded rows on every composer,
 * and one of them was live and inert at once: reaching a resident's lane
 * reaches the agent, so the weight control lit up, and the resident — a running
 * session that cannot change its own model — discarded the choice in silence.
 * The two questions are not independent, so they are answered together, here,
 * and the surface shows the **outcome** first: *"Ana will answer · heavy"*.
 * Anything a person may still change is one gesture behind that line.
 *
 * ## The floor
 *
 * A composer that says sending will **not** reach the agent has nothing to
 * weigh, so it says {@link NOBODY_ASKED} and offers nothing about weight — not
 * a dimmed control, not a kept-but-inert choice. The standing choice survives
 * in its scope (`weightChoice.ts`) and comes back the moment the composer
 * reaches the agent again; while it cannot be *seen* it is also not **sent**,
 * because a value the surface no longer shows is exactly §10's "a setting that
 * acts on you unseen". A recipient pick standing on the floor is still said on
 * the line, for the same reason in the other direction.
 *
 * ## The resident rule, and what it does to the wire
 *
 * Where the effective recipient is a resident's lane, {@link AddressWeight} is
 * `resident` and names the resident's own weight. No level is offered, and the
 * standing choice is **not sent**: {@link ComposerAddress.weightRequest}
 * carries `weight` only from the `choice` kind. That is the one place this
 * module touches what leaves — and it touches it by *withholding* a field the
 * person was never offered for that recipient, never by adding one. A weight
 * stated on a message that reaches a resident would govern only what the
 * resident hands off (§7), and a composer that quietly sent one to a running
 * session would be offering a control whose choice is discarded — the exact
 * sentence the rider forbids.
 *
 * A lane that is not the orchestrator's is a designated conversation and so a
 * resident's lane by construction (§7) — which is why the rule keys on the
 * lane, not on whether this build's roster has heard who sits on it: a lane the
 * roster has not listed yet (`unknownLaneRow`) still gets no weight control,
 * and the sentence says the weight is not known here rather than inventing one.
 *
 * ## What it does not decide
 *
 * `composerReach.ts`'s contract holds: `live` is an **input**, read from the
 * composer's own ask-agent state, and nothing here writes back to it. Whether
 * sending asks the agent is §8's alone, and the recipient's default is the
 * walk's (`useComposerRecipient`). This module only says what the two together
 * mean for the weight, and what the line should read.
 */

/** The weight a resident's lane works at, as far as this build can say. */
export type ResidentWeight =
  /** Designated at a level: the key it was recorded as, and the label to show. */
  | { readonly kind: "set"; readonly key: string; readonly label: string }
  /** `Resident.weight` is null: the launcher chose, and no level is reported. */
  | { readonly kind: "launch" }
  /** The roster has not listed this lane, so nothing is known about its resident. */
  | { readonly kind: "unheard" };

export type AddressWeight =
  /**
   * Nothing to weigh: the composer is not reaching the agent, the workspace
   * declares no levels, or the walk has not said who answers yet. Nothing is
   * offered and nothing is sent.
   */
  | { readonly kind: "unweighed" }
  /** The orchestrator answers: the levels are offered, and the choice travels. */
  | {
      readonly kind: "choice";
      readonly weight: ComposerWeight;
      /**
       * The options to draw: the declared levels, plus the standing choice when
       * the guidance stopped declaring it. Never a level the guidance does not
       * declare *and* nobody chose.
       */
      readonly options: readonly WeightLevel[];
    }
  /** A resident answers: no level is offered, and the resident's is named. */
  | { readonly kind: "resident"; readonly name: string; readonly weight: ResidentWeight };

export interface ComposerAddress {
  /** Whether the composer says sending reaches the agent (`composerReachesAgent`). */
  readonly live: boolean;
  readonly recipient: ComposerRecipient;
  /**
   * The lane that answers, as a row — the effective one, or `undefined` while
   * the walk has not answered. A lane the roster has not listed is still a row
   * (`unknownLaneRow`), so the line can name it without claiming liveness.
   */
  readonly answering: LaneRow | undefined;
  readonly weight: AddressWeight;
  /** The one line the composer shows at rest. */
  readonly line: string;
  /**
   * The weight this composer **states** — `{}` unless a level is both offered
   * and chosen. The resident rule and the floor both live here: see the
   * docblock.
   */
  readonly weightRequest: { readonly weight?: string };
  /**
   * Ready to spread onto the request: the recipient only when one was picked
   * (`useComposerRecipient`), and {@link ComposerAddress.weightRequest}.
   */
  readonly request: { readonly weight?: string; readonly recipient?: string };
  /** Whether there is anything behind the line worth opening. */
  readonly offers: boolean;
}

export interface ComposerAddressInput {
  /**
   * This composer's weight, from `useComposerWeight(scope)`, or omitted by a
   * composer that never reaches the agent and so never has a level to offer.
   */
  readonly weight?: ComposerWeight | undefined;
  readonly recipient: ComposerRecipient;
  /** Presentation only — see `composerReach.ts` for the one derivation. */
  readonly live: boolean;
}

/* -------------------------------------------------------------------------- */
/* Wording                                                                    */
/* -------------------------------------------------------------------------- */

/** The floor: a composer whose send will not reach the agent. */
export const NOBODY_ASKED = "Nobody is asked";

/** Joins the floor to a pick that still stands on it, so a pick is never hidden. */
export const ADDRESSED_TO = "addressed to";

/** The clause after a resident's name when it was designated with no level. */
export const LAUNCH_WEIGHT_CLAUSE = "weight set at launch";

/** Between the recipient and the weight on the line. */
export const LINE_SEPARATOR = " · ";

/**
 * What the composer says **where the weight control would be**, for a resident
 * (SPEC.md §10, rider signed 2026-08-19: *"The composer says so where the
 * control would be, naming the resident's weight, so a person learns the answer
 * rather than losing the question."*).
 *
 * The second clause is §7's boundary — a weight stated on a message still
 * governs what the resident hands off — said as what a control here *would*
 * have done, so a person who reached for it learns both halves of the answer.
 */
export function residentWeightSentence(name: string, weight: ResidentWeight): string {
  const handoff = `a weight set here would govern only what ${name} hands off`;
  switch (weight.kind) {
    case "set":
      return `${name} works at ${weight.label} — ${handoff}`;
    case "launch":
      return `${name} works at the weight chosen at launch — ${handoff}`;
    case "unheard":
      return `${name} works at the weight set when it was designated — ${handoff}`;
  }
}

/** The title on the line while it opens to something. */
export const ADDRESS_OPEN_TITLE =
  "Who answers this message, and how much thought the work gets. Open to change either.";

/** …and on the floor, where the popover offers the recipient alone. */
export const ADDRESS_FLOOR_TITLE =
  "This composer is not asking the agent, so there is nothing to weigh.";

/* -------------------------------------------------------------------------- */
/* Derivation                                                                 */
/* -------------------------------------------------------------------------- */

/** The label the guidance gives a key, or the key itself when it no longer declares it. */
export function weightLabel(levels: readonly WeightLevel[], key: string): string {
  return levels.find((level) => level.key === key)?.label ?? key;
}

function residentWeightOf(row: LaneRow, levels: readonly WeightLevel[]): ResidentWeight {
  if (row.weight !== null) {
    return { kind: "set", key: row.weight, label: weightLabel(levels, row.weight) };
  }
  // `null` on a row the roster described is the launcher's choice, recorded as
  // such (CONTRACT-067). On a row nobody has described it is no claim at all —
  // UI-098's rule: absence of an answer is never presented as one.
  return row.kind === "unknown" ? { kind: "unheard" } : { kind: "launch" };
}

function weightOptions(weight: ComposerWeight): readonly WeightLevel[] {
  const { levels, chosen } = weight;
  if (chosen === undefined || levels.some((level) => level.key === chosen)) return levels;
  return [...levels, { label: chosen, key: chosen }];
}

function addressWeight(
  live: boolean,
  answering: LaneRow | undefined,
  weight: ComposerWeight | undefined,
): AddressWeight {
  if (!live || answering === undefined) return { kind: "unweighed" };
  if (answering.lane !== ORCHESTRATOR_LANE) {
    return {
      kind: "resident",
      name: answering.name,
      weight: residentWeightOf(answering, weight?.levels ?? []),
    };
  }
  if (weight === undefined || weight.levels.length === 0) return { kind: "unweighed" };
  return { kind: "choice", weight, options: weightOptions(weight) };
}

/** The line's weight clause: what will run, or nothing when nothing is stated. */
function weightClause(weight: AddressWeight): string {
  switch (weight.kind) {
    case "unweighed":
      return "";
    case "choice":
      return weight.weight.chosen === undefined
        ? ""
        : weightLabel(weight.weight.levels, weight.weight.chosen);
    case "resident":
      switch (weight.weight.kind) {
        case "set":
          return weight.weight.label;
        case "launch":
          return LAUNCH_WEIGHT_CLAUSE;
        case "unheard":
          return "";
      }
  }
}

/**
 * The line, short on purpose: it sits in a composer's footer beside the send
 * button, so it names the outcome — who, then what weight — and leaves the
 * full sentences (the lane's liveness, §7's missing-profile report in full) to
 * the popover's statement and the titles, one gesture away. The mark rides
 * along because this is the at-rest surface and §7 wants the missing profile
 * *reported*, not discoverable.
 */
function lineOf(
  live: boolean,
  recipient: ComposerRecipient,
  answering: LaneRow | undefined,
  weight: AddressWeight,
): string {
  if (!live) {
    // A pick standing on the floor is still said: the line is the only place it
    // shows while the popover is closed, and a pick the surface hides is a
    // choice acting unseen.
    const picked = recipient.chosen !== undefined ? answering : undefined;
    return picked === undefined ? NOBODY_ASKED : `${NOBODY_ASKED} — ${ADDRESSED_TO} ${picked.name}`;
  }
  if (answering === undefined) return RECIPIENT_UNKNOWN_STATEMENT;
  if (answering.lane === recipient.refused) {
    return `${answering.name} ${RECIPIENT_REFUSED_STATEMENT}`;
  }
  const name = answering.mark === "" ? answering.name : `${answering.name} (${answering.mark})`;
  const who = `${name} will answer`;
  const clause = weightClause(weight);
  return clause === "" ? who : `${who}${LINE_SEPARATOR}${clause}`;
}

/** The row that answers: the effective lane's, or an unknown row naming it. */
export function answeringRow(recipient: ComposerRecipient): LaneRow | undefined {
  const lane = recipient.effective;
  if (lane === undefined) return undefined;
  return recipient.rows?.find((row) => row.lane === lane) ?? unknownLaneRow(lane);
}

export function composerAddress({
  weight,
  recipient,
  live,
}: ComposerAddressInput): ComposerAddress {
  const answering = answeringRow(recipient);
  const addressed = addressWeight(live, answering, weight);
  const rows = recipient.rows ?? [];
  const weightRequest = addressed.kind === "choice" ? addressed.weight.request : {};
  return {
    live,
    recipient,
    answering,
    weight: addressed,
    line: lineOf(live, recipient, answering, addressed),
    weightRequest,
    request: { ...recipient.request, ...weightRequest },
    offers: rows.length >= 2 || addressed.kind !== "unweighed",
  };
}
