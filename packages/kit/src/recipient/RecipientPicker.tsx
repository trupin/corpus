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
 * the override, and it is only an override once a lane other than the computed
 * default is pressed.
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

export function statementFor(row: LaneRow | undefined, overridden: boolean): string {
  if (row === undefined) return RECIPIENT_UNKNOWN_STATEMENT;
  const verb = overridden ? "will answer this message" : "will answer";
  return row.line === "" ? `${row.name} ${verb}` : `${row.name} ${verb} — ${row.line}`;
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
          return (
            <button
              key={row.lane}
              type="button"
              className={effective ? "recipient-opt on" : "recipient-opt"}
              aria-pressed={effective}
              data-recipient-lane={row.lane}
              data-recipient-default={isDefault ? "true" : "false"}
              data-recipient-liveness={row.liveness}
              title={row.line === "" ? row.name : `${row.name} — ${row.line}`}
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
                // Pressing the standing pick clears it — going back to the
                // computed default has to stay one gesture away, because that is
                // the ordinary case and the one §7 calls "never a guess".
                recipient.choose(effective ? undefined : row.lane);
              }}
            >
              <LaneDot liveness={row.liveness} />
              {row.name}
            </button>
          );
        })}
      </div>
      <span className="recipient-says" data-recipient-statement={surface}>
        {statementFor(shown, recipient.overridden && shown?.lane === recipient.chosen)}
        {shown !== undefined && shown.lane === recipient.computed ? (
          <span className="recipient-default-note"> ({DEFAULT_ROW_NOTE})</span>
        ) : null}
      </span>
    </div>
  );
}
