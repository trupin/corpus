import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
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
 * - **The card has a ceiling, and the lane list is what gives way** (UI-130).
 *   It grows upward out of a composer that sits inside a scrollport, so a long
 *   roster used to push its top rows behind the reader's head, which then took
 *   the pointer events aimed at them. The list scrolls inside the bound instead,
 *   the statement and the weight section stay outside it, and a list that
 *   reached the bound says so — see {@link lanesCappedNote} and `address.css`.
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

/** How far inside its scrollport a clamped card's top edge lands, in px. */
const POP_MARGIN = 6;

/**
 * What a lane list says when it has reached its ceiling (UI-130).
 *
 * A capped list that looked complete would be a **silent** cap, and a person
 * choosing a recipient from what they can see would be choosing from a list
 * whose end they never reached. So the count is said out loud beside the lead,
 * on the one line the lead already occupies — the note therefore costs the card
 * no height, which is what keeps it inside SPEC.md §11's rider rather than an
 * exception to it.
 */
export function lanesCappedNote(count: number): string {
  return `${String(count)} lanes · scroll for the rest`;
}

/**
 * What the pill reveals: **the whole statement, then what pressing it does.**
 *
 * The line's slot is a property of the footer and not of the sentence in it
 * (UI-137, `address.css`), so a statement wider than 22ch truncates there —
 * `agent will answer · Heavy or judgment-laden` is 302px against a 139px slot.
 * SPEC.md §11's rider signed 2026-08-20 allows that only where the whole of it
 * is reachable, so the sentence leads the title and the explanation follows it.
 *
 * **One title and not two.** UI-127 put the popover statement's own sentence on
 * its own element because the truncation happened *there*, and the same
 * argument would put this one on `.address-line-text`. It is on the pill
 * instead: the text fills the pill, the two boxes differ by 10px of padding,
 * and a person whose pointer landed on that padding would get the explanation
 * where the sentence should have been. Nested titles do not merge, so the outer
 * one has to be the complete answer.
 */
function lineTitle(line: string, live: boolean): string {
  return `${line} — ${live ? ADDRESS_OPEN_TITLE : ADDRESS_FLOOR_TITLE}`;
}

/**
 * The card's declared ceiling, in px — `--address-pop-cap` in `address.css`,
 * which is where the number is measured and written down. Read rather than
 * duplicated: a constant kept in both places is a constant that drifts.
 */
function capOf(card: HTMLElement): number {
  const declared = Number.parseFloat(
    window.getComputedStyle(card).getPropertyValue("--address-pop-cap"),
  );
  return Number.isFinite(declared) ? declared : Number.POSITIVE_INFINITY;
}

/**
 * The nearest **scrollport** above the card, or `null` for a card the window
 * itself bounds.
 *
 * The composers this control ships in do not agree about which that is, and the
 * difference is the whole of UI-130: a reply composer sits **inside**
 * `.reader-scroll`, so the card's ceiling is that scrollport's top edge and not
 * the window's, while the comment popover is portaled to `document.body` and
 * genuinely has the window. Asking the layout rather than naming a host is what
 * makes one rule serve both — and any composer a plugin contributes.
 *
 * **A scrollport, and not every box that clips.** `overflow: hidden` clips just
 * as hard, and the global composer's panel (`.search-panel`) is one — measured,
 * its card is 157px against 132px of panel above the line, so it has always lost
 * its top padding and lead to that edge. Bounding to it would trade a clipped
 * edge for a three-lane list showing one row at a time, which is a worse control
 * than the one being repaired. A scrollport is different in kind: what leaves it
 * is not merely cropped but **unreachable**, because the chrome outside takes
 * the pointer events aimed at it — `elementFromPoint` answered `DIV.reader-head`
 * at the centre of three rows. That is the defect this measures, so that is the
 * box it measures against, and the panel's clipped edge stays what it was.
 */
function clipperOf(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent !== null) {
    const overflow = window.getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return parent;
    parent = parent.parentElement;
  }
  return null;
}

export function ComposerAddress({ address, surface }: ComposerAddressProps): ReactElement {
  const [open, setOpen] = useState(false);
  /**
   * The row whose full statement the popover is showing: whatever the person is
   * looking at, else whoever will answer. Tabbing through the lanes reads them
   * out, so nothing here is available only to a pointer (SPEC.md §11).
   */
  const [previewed, setPreviewed] = useState<string | null>(null);
  /** True once the lane list has more rows than the ceiling lets it show. */
  const [capped, setCapped] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const effectiveRow = useRef<HTMLButtonElement>(null);

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

  /**
   * Fits the open card into the space above the line, and says so when the lane
   * list had to give (UI-130).
   *
   * `address.css` holds the ceiling and says what all three numbers are for; the
   * one thing CSS cannot ask is how much room this composer actually has,
   * because the answer is a scrollport's top edge and not the window's. So this
   * measures it and hands the fitted bound back as `--address-pop-max`. Where
   * even one row will not fit in that room — a 187px scrollport at 1280×400 —
   * `--address-pop-shift` moves the card down until its top is inside the
   * scrollport instead of behind the reader's head.
   *
   * **It runs on opening and never on previewing.** Its dependencies are the
   * open flag and the roster's length: hovering or focusing a row changes
   * neither, so nothing here can move a row out from under a pointer, which is
   * the loop UI-127 closed and SPEC.md §11's rider forbids.
   */
  useLayoutEffect(() => {
    const card = pop.current;
    if (!open || card === null) return undefined;
    const list = lanes.current;
    const clip = clipperOf(card);

    const fit = (): void => {
      // Measured unbounded and unshifted, so no previous fit can bias this one.
      card.style.setProperty("--address-pop-shift", "0px");
      card.style.setProperty("--address-pop-max", "none");
      const free = card.getBoundingClientRect();
      const listFull = list?.scrollHeight ?? 0;
      const row = list?.firstElementChild?.getBoundingClientRect().height ?? 0;

      // The card's bottom edge is `calc(100% + 6px)` above the line and never
      // moves. Everything above it, down to the scrollport's top, is the room.
      const ceiling = clip === null ? 0 : Math.max(clip.getBoundingClientRect().top, 0);
      const room = Math.max(0, free.bottom - ceiling - POP_MARGIN);
      // **One row is the floor**, and it is measured rather than declared: the
      // parts that cannot shrink are not all the same height — a resident's
      // weight sentence is three lines where a level row is one — so the
      // smallest useful card is a reading and not a constant. A card squeezed
      // until its list was 0px high would clear the head and offer nothing,
      // which is this defect wearing different clothes.
      const floor = free.height - listFull + row;
      const height = Math.max(floor, Math.min(capOf(card), room));
      card.style.setProperty("--address-pop-max", `${String(Math.round(height))}px`);

      // Whatever the floor took beyond the room, the card gives back by coming
      // down — so its top lands inside the scrollport instead of behind the head.
      const over = card.getBoundingClientRect().height - room;
      card.style.setProperty("--address-pop-shift", `${String(Math.max(0, Math.round(over)))}px`);
      if (list !== null) setCapped(list.scrollHeight > list.clientHeight + 1);
    };

    fit();

    // The person's own pick must not open off the top of a list that now
    // scrolls — `.recipient-opt[data-recipient-refused]`'s comment says a row
    // that vanished takes the pick off the screen with it, and a list scrolled
    // away from it is the same loss by another route. Scrolled list-locally, so
    // the document underneath does not move.
    const target = effectiveRow.current;
    if (list !== null && target !== null) {
      const listBox = list.getBoundingClientRect();
      const rowBox = target.getBoundingClientRect();
      if (rowBox.top < listBox.top) list.scrollTop += rowBox.top - listBox.top;
      else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
    }

    window.addEventListener("resize", fit);
    clip?.addEventListener("scroll", fit, { passive: true });
    return () => {
      window.removeEventListener("resize", fit);
      clip?.removeEventListener("scroll", fit);
    };
  }, [open, rows.length]);

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
          title={lineTitle(address.line, address.live)}
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
        // offered. Plain text so it neither focuses nor pretends to open — and
        // the sentence alone on the title, because there is no gesture here to
        // explain and the slot truncates this line exactly as it does the other.
        <span
          className="address-line address-said"
          data-address-line={surface}
          title={address.line}
        >
          <span className="address-line-text">{address.line}</span>
        </span>
      )}

      {open && offers ? (
        <div className="address-pop" data-address-pop={surface} ref={pop}>
          {showRows ? (
            <div
              className="address-section address-recipient"
              role="group"
              aria-label={RECIPIENT_GROUP_LABEL}
            >
              <div className="address-head">
                <span className="address-lead" aria-hidden="true">
                  {RECIPIENT_LEAD}
                </span>
                {/* Said rather than left to the scrollbar: a list that stopped
                 * at the ceiling and looked complete would be a silent cap. */}
                {capped ? (
                  <span className="address-more" data-address-more={surface}>
                    {lanesCappedNote(rows.length)}
                  </span>
                ) : null}
              </div>
              <div className="recipient-lanes" ref={lanes}>
                {rows.map((row) => (
                  <LaneButton
                    key={row.lane}
                    row={row}
                    recipient={recipient}
                    onPreview={setPreviewed}
                    innerRef={row.lane === recipient.effective ? effectiveRow : undefined}
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
  /** Set on the effective row only, so the card can open showing the pick. */
  readonly innerRef?: RefObject<HTMLButtonElement | null> | undefined;
}

function LaneButton({ row, recipient, onPreview, innerRef }: LaneButtonProps): ReactElement {
  const effective = row.lane === recipient.effective;
  const isDefault = row.lane === recipient.computed;
  // Whether the person pressed *this* row — a different question from whether a
  // message would go to it (UI-118): the two coincide for every row but the
  // default, the only row on which pressing could otherwise mean nothing.
  const picked = row.lane === recipient.chosen;
  return (
    <button
      type="button"
      ref={innerRef}
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
