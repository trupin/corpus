import { useEffect, useRef, useState, type ReactElement } from "react";
import { LaneDot } from "../recipient/LaneDot.js";
import type { LaneRow } from "../recipient/laneRows.js";
import { DEFAULT_ROW_NOTE, statementFor } from "../recipient/statement.js";
import {
  ADDRESS_FLOOR_TITLE,
  ADDRESS_OPEN_TITLE,
  residentWeightSentence,
  type ComposerAddress as Address,
} from "./addressModel.js";

/**
 * The control every composer offers (SPEC.md §11, UI-126): **one line stating
 * the outcome** — who answers, at what weight — that opens to change either.
 *
 * It ships from `@corpus/kit` for the reason the two controls it replaces did:
 * §11's enumeration binds "any composer a plugin contributes", and kit is how a
 * plugin gets a first-party affordance with one import and no copy.
 *
 * ## What it renders, and what it refuses to
 *
 * - **At rest, the line and nothing else.** `↵` and `⌘↵` are for writing; the
 *   address is one short sentence until somebody asks for more.
 * - **The popover offers only what can act.** The recipient rows appear when
 *   the roster names more than one lane; the weight levels appear when the
 *   composer reaches the agent *and* the orchestrator answers. For a
 *   **resident** recipient the weight section is one sentence naming the
 *   resident's weight — the rider signed 2026-08-19 — and no level is offered,
 *   because a choice there would be discarded in silence. On the **floor** (a
 *   send that will not reach the agent) there is no weight section at all:
 *   nothing to weigh.
 * - **Nothing preselected, nothing invented.** The rows and levels are the same
 *   derivations the old controls read (`useComposerRecipient`,
 *   `useComposerWeight`), untouched: the default travels by absence, a pick
 *   routes one message, pressing a standing choice clears it.
 * - **A line with nothing behind it does not pretend to open.** When there is
 *   neither a lane to choose nor a level to state, the line renders as plain
 *   text — the §11 recipient statement, still true, still there.
 *
 * ## Keys
 *
 * It claims none — §11's composer key contract is untouched, and the popover
 * adds no binding of its own. Everything here is an ordinary `<button>`: the
 * line toggles on click, `↵` or `space`, and closes on a click outside; every
 * row and level is tabbable while open. Escape is deliberately not handled —
 * the app's escape chain owns that key at the surface grain, and a kit
 * component cannot register in it (`RecipientPicker` learned this; the reason
 * survives it).
 */

export interface ComposerAddressProps {
  /** From `composerAddress(...)` — the one derivation of line, rows and levels. */
  readonly address: Address;
  /** Names this composer in the DOM: `data-composer-address="<surface>"`. */
  readonly surface: string;
}

export const RECIPIENT_GROUP_LABEL = "Recipient";
export const WEIGHT_GROUP_LABEL = "Weight";

/** The dim lead-ins, in the mono voice the composer feet speak in. */
export const RECIPIENT_LEAD = "to";
export const WEIGHT_LEAD = "weight";

/** The title on an option the workspace's guidance no longer declares. */
export const WEIGHT_UNKNOWN_TITLE =
  "This workspace's guidance no longer declares this level. It is still what the request will state.";

export function ComposerAddress({ address, surface }: ComposerAddressProps): ReactElement {
  const [open, setOpen] = useState(false);
  /**
   * The row whose full statement the popover is showing: whatever the person is
   * looking at, else whoever will answer. Tabbing through the lanes reads them
   * out, so nothing here is available only to a pointer (SPEC.md §11).
   */
  const [previewed, setPreviewed] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const offers = address.offers;
  // A popover whose last section disappeared from under it (the roster shrank,
  // the guidance stopped declaring levels) must not stay open as an empty card.
  useEffect(() => {
    if (!offers) setOpen(false);
  }, [offers]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent): void => {
      const host = box.current;
      if (host === null || !(event.target instanceof Node) || host.contains(event.target)) return;
      setOpen(false);
    };
    // Capture, so a click that some surface swallows in the bubble phase still
    // closes the popover: an open card floating over a composer whose host ate
    // the click would need a second click to dismiss.
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const { recipient, weight } = address;
  const rows = recipient.rows ?? [];
  const showRows = rows.length >= 2;
  const shown = rows.find((row) => row.lane === (previewed ?? recipient.effective));
  const says = statementFor(
    shown,
    shown?.lane === recipient.chosen,
    shown !== undefined && shown.lane === recipient.refused,
  );
  // Marks the row a send with nothing picked would go to — a clause of the same
  // sentence, so it is composed here and not only rendered, or the title would
  // reveal less than the box it stands in for.
  const defaultNote =
    shown !== undefined && shown.lane === recipient.computed && shown.lane !== recipient.refused
      ? ` (${DEFAULT_ROW_NOTE})`
      : "";

  return (
    <div
      className="composer-address"
      ref={box}
      data-composer-address={surface}
      data-address-live={address.live ? "true" : "false"}
      data-recipient-refused={recipient.refused ?? ""}
    >
      {offers ? (
        <button
          type="button"
          className="address-line"
          data-address-line={surface}
          aria-expanded={open}
          title={address.live ? ADDRESS_OPEN_TITLE : ADDRESS_FLOOR_TITLE}
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          <span className="address-line-text">{address.line}</span>
          <span className="address-caret" aria-hidden="true">
            ▾
          </span>
        </button>
      ) : (
        // §11's recipient statement with nothing to change behind it: said, not
        // offered. Plain text so it neither focuses nor pretends to open.
        <span className="address-line address-said" data-address-line={surface}>
          <span className="address-line-text">{address.line}</span>
        </span>
      )}

      {open && offers ? (
        <div className="address-pop" data-address-pop={surface}>
          {showRows ? (
            <div className="address-section" role="group" aria-label={RECIPIENT_GROUP_LABEL}>
              <span className="address-lead" aria-hidden="true">
                {RECIPIENT_LEAD}
              </span>
              <div className="recipient-lanes">
                {rows.map((row) => (
                  <LaneButton
                    key={row.lane}
                    row={row}
                    recipient={recipient}
                    onPreview={setPreviewed}
                  />
                ))}
              </div>
              {/* The box is reserved (SPEC.md §11's rider signed 2026-08-20):
               * previewing a lane changes these words and never this height,
               * because a popover anchored by its bottom edge that grew on
               * hover moved the row out from under the cursor. A statement
               * longer than the reserve truncates in place, and the whole of
               * it is on this title and on the row's. */}
              <span
                className="recipient-says"
                data-recipient-statement={surface}
                title={`${says}${defaultNote}`}
              >
                {says}
                {defaultNote === "" ? null : (
                  <span className="recipient-default-note">{defaultNote}</span>
                )}
              </span>
            </div>
          ) : null}

          {weight.kind === "choice" ? (
            <div className="address-section" role="group" aria-label={WEIGHT_GROUP_LABEL}>
              <span className="address-lead" aria-hidden="true">
                {WEIGHT_LEAD}
              </span>
              <div className="weight-opts">
                {weight.options.map((level) => {
                  const chosen = weight.weight.chosen === level.key;
                  const known = weight.weight.levels.some((have) => have.key === level.key);
                  return (
                    <button
                      key={level.key}
                      type="button"
                      className={chosen ? "weight-opt on" : "weight-opt"}
                      aria-pressed={chosen}
                      data-weight-key={level.key}
                      {...(known
                        ? {}
                        : { "data-weight-undeclared": "true", title: WEIGHT_UNKNOWN_TITLE })}
                      onClick={() => {
                        // Pressing the standing choice clears it — "changed in
                        // one gesture" includes changing it back to nothing,
                        // which is the ordinary case.
                        weight.weight.choose(chosen ? undefined : level.key);
                      }}
                    >
                      {level.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {weight.kind === "resident" ? (
            /* The rider signed 2026-08-19: where the control would be, the
             * answer — never a control whose choice is discarded. */
            <p className="address-resident" data-resident-weight={weight.weight.kind}>
              {residentWeightSentence(weight.name, weight.weight)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface LaneButtonProps {
  readonly row: LaneRow;
  readonly recipient: Address["recipient"];
  readonly onPreview: (lane: string | null) => void;
}

function LaneButton({ row, recipient, onPreview }: LaneButtonProps): ReactElement {
  const effective = row.lane === recipient.effective;
  const isDefault = row.lane === recipient.computed;
  // Whether the person pressed *this* row — a different question from whether a
  // message would go to it (UI-118): the two coincide for every row but the
  // default, the only row on which pressing could otherwise mean nothing.
  const picked = row.lane === recipient.chosen;
  return (
    <button
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
        onPreview(row.lane);
      }}
      onBlur={() => {
        onPreview(null);
      }}
      onMouseEnter={() => {
        onPreview(row.lane);
      }}
      onMouseLeave={() => {
        onPreview(null);
      }}
      onClick={() => {
        // Keyed on the pick and never on the effective row (UI-118): pressing
        // the default while nothing was chosen is the person's one way of
        // saying "this lane, deliberately". Pressing your own pick clears it,
        // so the computed default stays one gesture away.
        recipient.choose(picked ? undefined : row.lane);
      }}
    >
      <LaneDot liveness={row.liveness} />
      {row.name}
      {/* §7's missing-profile report at row width; the sentence is on the
       * statement line and this row's own title. */}
      {row.mark === "" ? null : <span className="recipient-mark">{row.mark}</span>}
    </button>
  );
}
