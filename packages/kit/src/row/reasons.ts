import type { NeedsReason, StaleTier } from "@corpus/contract";
import { stalenessLevel } from "./staleness.js";

/**
 * Attention reason code → chip, as one table (SPEC.md §10 — "each row carries a
 * reason chip").
 *
 * A table rather than a chain of conditions in the component, for two reasons
 * that are both correctness rather than taste: the chips must correspond
 * *exactly* to the row's own `attention` array as the server computed it (no
 * sniffing of titles, bodies or timestamps to guess a reason), and a code the
 * table has never heard of must still render — plugins extend the system
 * (SPEC.md §10) and a reason line that silently drops a row's only explanation
 * is worse than an ugly one.
 *
 * ## The vocabulary delta, recorded rather than papered over
 *
 * The server ships five codes (`NEEDS_REASONS`). `design/index.html` shows six
 * labels over three chip classes, and two of its choices are deliberate here:
 *
 * - **`due` uses `.r-form`**, not a class of its own. The prototype puts "due
 *   today" on the signal wash beside "awaiting your answer", and inventing a
 *   fourth class for one label would be a design change, not a transcription.
 * - **`stale` has two labels**, chosen from the row's tier — the prototype shows
 *   both "getting stale" and "review: archive or act" and never says which is
 *   which. The tier is exactly that information, and it is already on the wire.
 * - **`failed-job` has no chip in the prototype at all.** It gets the neutral
 *   `.r-chip` with no modifier: `--signal` is the needs-you axis, `--accent` is
 *   the agent/unread axis and `--sepia` is the staleness axis (UI-001), so a
 *   fourth meaning may not borrow any of the three.
 *
 * ## Why a label may be a function of the row
 *
 * Two of the five codes cannot be spelled by the code alone, and both numbers
 * they need are already on the row rather than derivable here: `stale` chooses
 * its wording from the tier, and `form` says **how many** forms are still open
 * (SPEC.md §10 — "a thread holding more than one unanswered form says how many
 * are still open"). Neither is sniffed: the tier is `DocRow.stale` and the count
 * is `DocRow.unansweredForms`, both computed by the server, and the second is
 * derived from the same predicate as the `form` reason itself, so the chip's
 * number and the chip's existence can never disagree (CONTRACT-040).
 */

export interface ReasonChip {
  /** The reason code, verbatim — including one this table does not know. */
  readonly code: string;
  readonly label: string;
  /** `.r-chip`'s modifier, or `""` for the neutral chip. */
  readonly chipClass: string;
}

/** The three modifier classes `design/index.html` declares, and the neutral fourth. */
export const REASON_CHIP_CLASSES = {
  reply: "r-reply",
  form: "r-form",
  stale: "r-stale",
  neutral: "",
} as const;

/**
 * What a label may read off the row beyond its own code. Internal: the public
 * functions take the two values positionally, so a plugin never has to build
 * this object to ask for a chip.
 */
interface ReasonContext {
  /** `DocRow.stale` — the staleness tier (SPEC.md §5); `null` is fresh. */
  readonly tier: StaleTier | null;
  /**
   * `DocRow.unansweredForms` — required, never null and never absent on the wire
   * (CONTRACT-040), which is what lets the threshold below be a bare `> 1` with
   * no coalesce. `0` always means "none", never "unknown", including on every
   * non-thread row.
   */
  readonly unansweredForms: number;
}

interface ReasonEntry {
  readonly label: string | ((context: ReasonContext) => string);
  readonly chipClass: string;
}

const REASON_TABLE: Readonly<Record<NeedsReason, ReasonEntry>> = {
  "unread-reply": { label: "agent replied", chipClass: REASON_CHIP_CLASSES.reply },
  /*
   * §10 asks for the number only above one: one unanswered form reads exactly as
   * it always has, and "1 awaiting your answer" would be a count nobody needed
   * and a second wording for the ordinary case.
   */
  form: {
    label: ({ unansweredForms }) =>
      unansweredForms > 1
        ? `${String(unansweredForms)} awaiting your answer`
        : "awaiting your answer",
    chipClass: REASON_CHIP_CLASSES.form,
  },
  due: { label: "due today", chipClass: REASON_CHIP_CLASSES.form },
  stale: {
    label: ({ tier }) => (stalenessLevel(tier) === 3 ? "review: archive or act" : "getting stale"),
    chipClass: REASON_CHIP_CLASSES.stale,
  },
  "failed-job": { label: "failed job", chipClass: REASON_CHIP_CLASSES.neutral },
};

function isKnownReason(code: string): code is NeedsReason {
  return Object.hasOwn(REASON_TABLE, code);
}

/**
 * One code → one chip. An unknown code keeps its raw text on a neutral chip:
 * the user learns that *something* wants them, and the code is the lead.
 *
 * `tier` and `unansweredForms` are the row's own `stale` and `unansweredForms`.
 * Both default to the "nothing to report" value, so a caller that only has a
 * code still gets the chip every code has always had.
 */
export function reasonChip(
  code: string,
  tier: StaleTier | null = null,
  unansweredForms = 0,
): ReasonChip {
  if (!isKnownReason(code)) return { code, label: code, chipClass: REASON_CHIP_CLASSES.neutral };
  const entry = REASON_TABLE[code];
  return {
    code,
    label: typeof entry.label === "string" ? entry.label : entry.label({ tier, unansweredForms }),
    chipClass: entry.chipClass,
  };
}

/** A row's whole reason line, in the order the server listed it. */
export function reasonChips(
  attention: readonly string[],
  tier: StaleTier | null = null,
  unansweredForms = 0,
): readonly ReasonChip[] {
  return attention.map((code) => reasonChip(code, tier, unansweredForms));
}
