import { type ReactElement } from "react";
import type { ComposerWeight } from "./weightChoice.js";
import type { WeightLevel } from "./weightLevels.js";

/**
 * The control every composer offers (SPEC.md §11 — "Every composer can choose
 * how much thought the work gets", rider signed 2026-08-06).
 *
 * It ships from `@corpus/kit` rather than being written five times, for the
 * reason the plugin row of §11's enumeration states: a composer a plugin
 * contributes must offer the same levels a first-party one does, and kit is how
 * a plugin gets a first-party affordance with one import and no copy.
 *
 * ## What it renders, and what it refuses to
 *
 * - **Nothing preselected.** With no choice standing, no option is pressed and
 *   the composer sends no `weight` at all. This is the ordinary case, not an
 *   empty state, so it is not announced or decorated as one.
 * - **No control at all when the workspace declares no levels.** Not a fallback
 *   list, not a disabled control, not a hint: the composer looks exactly as it
 *   does today. A workspace whose skill predates AGENT-015 is a real, shipping
 *   state (§2.4), and it must be indistinguishable from before this feature.
 * - **The Weight cell, never the Model cell.** {@link WeightLevel} carries no
 *   model name to render — "no model names in the UI" is a signed non-goal, kept
 *   by the type rather than by a filter here.
 * - **A standing choice the guidance no longer declares is still shown**, by its
 *   key, and still travels. Silently rewriting it to a surviving level would be
 *   the composer lying about the request; the disclosure of an unhonourable
 *   weight is the agent's job (§7's unhonourable path, AGENT-015).
 *
 * ## Liveness is presentation
 *
 * `live` says whether the composer it sits in claims sending will reach the
 * agent ({@link composerReachesAgent}). When it does not, the control dims and
 * says so — it does **not** disable itself, clear the choice, or touch the
 * ask-agent toggle. A choice made before flipping to note only survives the
 * flip: clearing it would be the control acting on the person unseen, and §8
 * alone decides what reaches the agent.
 *
 * ## Keys
 *
 * It claims none. §11's composer key contract — `↵` newline, `⌘↵` primary,
 * `⇧⌘↵` secondary, and the autocomplete keys — is untouched, and this control
 * adds no binding of its own anywhere. It is nonetheless fully operable from the
 * keyboard, because every option is an ordinary `<button>`: tab to it, `↵` or
 * `space` to state it, again to clear it. §11 adds no pointer-exclusive
 * capability, and a picker only a mouse could reach would be one.
 */

export interface WeightPickerProps {
  /** This composer's weight, from `useComposerWeight(scope)`. */
  readonly weight: ComposerWeight;
  /**
   * Whether the composer says sending will reach the agent. Presentation only —
   * see the docblock, and `composerReach.ts` for the one derivation.
   */
  readonly live: boolean;
  /** Names this composer in the DOM: `data-weight-picker="<surface>"`. */
  readonly surface: string;
}

/** The dim lead-in, in the mono voice the composer feet already speak in. */
export const WEIGHT_PICKER_LABEL = "weight";

/** What the control says it is for while the composer is reaching the agent. */
export const WEIGHT_LIVE_TITLE =
  "How much thought this work gets. Choosing nothing lets the agent decide.";

/** …and while it is not. Says it has nothing to act on; never that it is off. */
export const WEIGHT_INERT_TITLE =
  "Nothing to act on — this composer is not asking the agent. The choice is kept.";

/** The title on an option the workspace's guidance no longer declares. */
export const WEIGHT_UNKNOWN_TITLE =
  "This workspace's guidance no longer declares this level. It is still what the request will state.";

/**
 * The options to draw: the declared levels, plus the standing choice when the
 * guidance stopped declaring it. Never a level the guidance does not declare
 * *and* nobody chose.
 */
function options(weight: ComposerWeight): readonly WeightLevel[] {
  const { levels, chosen } = weight;
  if (chosen === undefined || levels.some((level) => level.key === chosen)) return levels;
  return [...levels, { label: chosen, key: chosen }];
}

export function WeightPicker({ weight, live, surface }: WeightPickerProps): ReactElement | null {
  // The whole degradation contract, in one line: no declared levels, no control.
  if (weight.levels.length === 0) return null;

  const declared = new Set(weight.levels.map((level) => level.key));

  return (
    <div
      className="weight-pick"
      role="group"
      aria-label="Weight"
      data-weight-picker={surface}
      data-weight-live={live ? "true" : "false"}
      title={live ? WEIGHT_LIVE_TITLE : WEIGHT_INERT_TITLE}
    >
      <span className="weight-lead" aria-hidden="true">
        {WEIGHT_PICKER_LABEL}
      </span>
      {options(weight).map((level) => {
        const chosen = weight.chosen === level.key;
        const known = declared.has(level.key);
        return (
          <button
            key={level.key}
            type="button"
            className={chosen ? "weight-opt on" : "weight-opt"}
            aria-pressed={chosen}
            data-weight-key={level.key}
            {...(known ? {} : { "data-weight-undeclared": "true", title: WEIGHT_UNKNOWN_TITLE })}
            onClick={() => {
              // Pressing the standing choice clears it — "changed in one
              // gesture" has to include changing it back to nothing, which is
              // the ordinary case and must stay one click away.
              weight.choose(chosen ? undefined : level.key);
            }}
          >
            {level.label}
          </button>
        );
      })}
    </div>
  );
}
