import { useState, type ReactElement } from "react";
import { LaneDot } from "./LaneDot.js";
import type { LaneRow } from "./laneRows.js";
import type { ComposerRecipient } from "./useComposerRecipient.js";

/**
 * The control every composer that can wake an agent offers (SPEC.md §7's
 * *"the composer offers the live roster"*).
 *
 * ## Informative at rest, an override only when touched
 *
 * Most of what this is for happens without anyone clicking it: §7 says *"the
 * default is never a guess a person has to check — it follows from where they
 * are"*, and the way a surface keeps that promise is by saying who will answer
 * before anything is typed. The statement line does that; the row of lanes is
 * where a person may say otherwise, and it is only an *override* once a lane
 * other than the computed default is pressed.
 *
 * **Pressing is a fact even when it changes nothing.** Every row can be pressed,
 * including the one the default already marks, and pressing it states that lane
 * on the wire (`useComposerRecipient`). It reads like a no-op and is not: the
 * default is this build's own walk over a cached roster, and a person pressing
 * the lane it names is addressing *that lane* rather than agreeing to whatever
 * the server works out a moment later. Keyed on the effective row instead, the
 * one press that says so was the one press this control could not hear —
 * UI-118, where a released resident meant the message went to the orchestrator
 * with nothing anywhere saying so.
 *
 * ## Why it is a row and not a floating droplist
 *
 * It follows the weight control's composer-row pattern (UI-082) for one hard
 * reason beyond consistency: a popup that opens inside a composer needs `esc` to
 * close *it* rather than the surface under it, and the board's escape chain
 * (`apps/ui/src/reader/useEscapeStack.ts`) listens on `document` in the
 * **capture** phase and hands the key to the topmost registered layer — which,
 * inside a comment popover, is the popover. A control shipped from the kit
 * cannot register in that chain, so a floating list here would close the
 * composer out from under the person choosing a recipient. Every option is an
 * ordinary `<button>`: tab to it, `↵` or `space` to state it, again to clear it.
 * §11's composer key contract is untouched and this claims no key of its own.
 *
 * ## What it refuses to draw
 *
 * - **Nothing at all until the roster has answered**, and nothing at all when
 *   the roster names one lane. A workspace with no resident has no choice to
 *   offer and one possible answer, so the composer looks exactly as it did
 *   before this feature — the degradation contract `WeightPicker` states, for
 *   the same reason: an unremarkable state must not be dressed as one.
 * - **No claim about a lane it has not heard about.** A row the roster does not
 *   carry renders as `unknown` and says nothing about liveness; UI-098's rule is
 *   that absence of a status is not the absence of an agent.
 * - **No liveness gate on picking.** A lapsed lane is a legal recipient — the
 *   contract routes it and §7's fallback covers it — so the row says what lapsed
 *   means and stays pressable.
 * - **No lane drawn as sounder than it is.** A resident whose profile has been
 *   renamed or archived is reported here as it is on the board badge (`LaneRow`'s
 *   `mark` at row width, its `note` in the statement and the title) — §7 requires
 *   the miss be *"reported rather than silently substituted"*, and this is the
 *   surface on which the lane is actually chosen.
 */

export interface RecipientPickerProps {
  readonly recipient: ComposerRecipient;
  /** Names this composer in the DOM: `data-recipient-picker="<surface>"`. */
  readonly surface: string;
  /**
   * Whether the composer says sending will reach the agent
   * (`composerReachesAgent`). Presentation only, exactly as on `WeightPicker`:
   * §8 alone decides what reaches the agent, and a recipient neither asks the
   * agent nor stops it being asked.
   */
  readonly live: boolean;
}

/** The dim lead-in, in the mono voice the composer feet already speak in. */
export const RECIPIENT_PICKER_LABEL = "to";

export const RECIPIENT_GROUP_LABEL = "Recipient";

/** What the control says it is for while the composer is reaching the agent. */
export const RECIPIENT_LIVE_TITLE =
  "Who answers this message. The default follows from where you are; picking another routes this " +
  "message and nothing else.";

/** …and while it is not. Says it has nothing to act on; never that it is off. */
export const RECIPIENT_INERT_TITLE =
  "Nothing to act on — this composer is not asking the agent. The choice is kept.";

/** Said while the walk has not answered: true, and claims no lane. */
export const RECIPIENT_UNKNOWN_STATEMENT = "who answers follows from where you are";

/** Marks the row a send with nothing picked would go to. */
export const DEFAULT_ROW_NOTE = "default here";

/**
 * What the statement says about a lane the **server refused** (SPEC.md §7's
 * `422 unknown_recipient`, UI-118).
 *
 * It stays on the row after the toast has gone, because a toast that dismisses
 * itself in six seconds is not where a person finds out where their message did
 * not go. It says *nothing was sent* in the server's own words rather than
 * softening it: the send is the thing that did not happen, and the composer
 * still holds the text to prove it.
 */
export const RECIPIENT_REFUSED_STATEMENT = "is not a lane any more — nothing was sent; pick again";

/**
 * @param picked whether the person **chose** this row, rather than it being
 * where posting here happens to go. The verb changes on the act and not on the
 * difference: a pick that names the default's own lane is still a choice about
 * this one message, and UI-118 is what happens when the two are conflated.
 *
 * Three clauses, and each answers a different question: **who** answers,
 * **what is worth saying about who they are** (`note` — §7's missing-profile
 * report, empty for every other kind), and **whether they are there** (`line`).
 * Joined in that order and dropped where empty, exactly as the board badge joins
 * them, so a lane reads the same on both surfaces.
 */
export function statementFor(row: LaneRow | undefined, picked: boolean, refused = false): string {
  if (row === undefined) return RECIPIENT_UNKNOWN_STATEMENT;
  if (refused) return `${row.name} ${RECIPIENT_REFUSED_STATEMENT}`;
  const verb = picked ? "will answer this message" : "will answer";
  return [`${row.name} ${verb}`, row.note, row.line].filter((part) => part !== "").join(" — ");
}

export function RecipientPicker({
  recipient,
  surface,
  live,
}: RecipientPickerProps): ReactElement | null {
  /**
   * The row whose line the statement is showing: whatever the person is looking
   * at, else whoever will answer. It is what keeps every row's liveness and
   * summary reachable **without acting** — tabbing through the lanes reads them
   * out, so nothing here is available only to a pointer (SPEC.md §11).
   */
  const [previewed, setPreviewed] = useState<string | null>(null);
  const { rows } = recipient;

  // The degradation contract, in one line: nothing to choose between, no control.
  if (rows === undefined || rows.length < 2) return null;

  const shown = rows.find((row) => row.lane === (previewed ?? recipient.effective));

  return (
    <div
      className="recipient-pick"
      data-recipient-picker={surface}
      data-recipient-live={live ? "true" : "false"}
      data-recipient-overridden={recipient.overridden ? "true" : "false"}
      data-recipient-refused={recipient.refused ?? ""}
    >
      <div
        className="recipient-lanes"
        role="group"
        aria-label={RECIPIENT_GROUP_LABEL}
        title={live ? RECIPIENT_LIVE_TITLE : RECIPIENT_INERT_TITLE}
      >
        <span className="recipient-lead" aria-hidden="true">
          {RECIPIENT_PICKER_LABEL}
        </span>
        {rows.map((row) => {
          const effective = row.lane === recipient.effective;
          // Marked, never preselected-looking: with nothing overridden the
          // default *is* the effective row and wears the fill; once a pick moves
          // the fill away, the dashed edge is what says where sending would have
          // gone. Both are decoration over the statement line, which is the one
          // that says it in words.
          const isDefault = row.lane === recipient.computed;
          // Whether the person pressed *this* row, which is a different question
          // from whether a message would go to it (UI-118). They coincide for
          // every row but one — the default, which is where sending goes whether
          // or not anybody said so, and which is therefore the only row on which
          // pressing has ever been able to mean nothing.
          const picked = row.lane === recipient.chosen;
          return (
            <button
              key={row.lane}
              type="button"
              className={effective ? "recipient-opt on" : "recipient-opt"}
              aria-pressed={effective}
              data-recipient-lane={row.lane}
              data-recipient-default={isDefault ? "true" : "false"}
              data-recipient-chosen={picked ? "true" : "false"}
              data-recipient-refused={row.lane === recipient.refused ? "true" : "false"}
              data-recipient-liveness={row.liveness}
              data-recipient-kind={row.kind}
              title={[row.name, row.note, row.line].filter((part) => part !== "").join(" — ")}
              onFocus={() => {
                setPreviewed(row.lane);
              }}
              onBlur={() => {
                setPreviewed(null);
              }}
              onMouseEnter={() => {
                setPreviewed(row.lane);
              }}
              onMouseLeave={() => {
                setPreviewed(null);
              }}
              onClick={() => {
                // Keyed on the **pick** and never on the effective row: keyed on
                // the latter, pressing the default while nothing was chosen sent
                // `choose(undefined)` — the person's one way of saying "this
                // lane, deliberately" was the one press the control could not
                // hear (UI-118). Pressing your own pick still clears it, so
                // going back to the computed default stays one gesture away,
                // which is what §7's "never a guess" needs it to be.
                recipient.choose(picked ? undefined : row.lane);
              }}
            >
              <LaneDot liveness={row.liveness} />
              {row.name}
              {/*
               * §7's *"the missing profile is reported rather than silently
               * substituted"*, on the surface where a lane is **chosen** rather
               * than merely shown. Without it a lane whose profile has gone is
               * drawn identically to a healthy one — the report held on the
               * board badge and in `corpus agents` and nowhere here (PR #49
               * review), which is the one place the choice is actually made.
               *
               * The short form, because these rows sit side by side; the whole
               * sentence is one focus or hover away, on the statement line
               * below and on this row's own title. Empty for every other kind,
               * so no lane gains a word it did not have.
               */}
              {row.mark === "" ? null : <span className="recipient-mark">{row.mark}</span>}
            </button>
          );
        })}
      </div>
      <span className="recipient-says" data-recipient-statement={surface}>
        {statementFor(
          shown,
          shown?.lane === recipient.chosen,
          shown !== undefined && shown.lane === recipient.refused,
        )}
        {shown !== undefined &&
        shown.lane === recipient.computed &&
        shown.lane !== recipient.refused ? (
          <span className="recipient-default-note"> ({DEFAULT_ROW_NOTE})</span>
        ) : null}
      </span>
    </div>
  );
}
