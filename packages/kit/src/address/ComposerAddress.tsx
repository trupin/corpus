import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { LaneDot } from "../recipient/LaneDot.js";
import type { LaneRow } from "../recipient/laneRows.js";
import { DEFAULT_ROW_NOTE, statementFor } from "../recipient/statement.js";
import {
  ADDRESS_DESIGNATING_TITLE,
  ADDRESS_FLOOR_TITLE,
  ADDRESS_OPEN_TITLE,
  designationWeightSentence,
  residentWeightSentence,
  type ComposerAddress as Address,
} from "./addressModel.js";

/**
 * The control every composer offers (SPEC.md §10, UI-126): **one line stating
 * the outcome** — who answers, at what weight — that opens to change either.
 *
 * It ships from `@corpus/kit` for the reason the two controls it replaces did:
 * §10's enumeration binds every composer, and kit is how each of them gets the
 * same affordance with one import and no copy.
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
 *   text — the §10 recipient statement, still true, still there.
 * - **The card is as large as its place allows** (UI-130, then UI-142). It grows
 *   upward out of a composer that sits inside a scrollport, so a long roster
 *   used to push its top rows behind the reader's head, which then took the
 *   pointer events aimed at them. It is bounded by the **room** — the space
 *   above the line and the width of the row the line sits in — and by nothing
 *   else: the `280px` ceiling and the unreachable `330px` measure that stood
 *   beside it drew the same 240×280 card at 1280×720 and at 1728×1080, which
 *   put an ordinary nine-lane roster behind a scrollbar with 502px of window
 *   above it. Where the roster really does outrun the room the list scrolls and
 *   says so — see {@link lanesCappedNote} and `address.css`, which carries the
 *   measurements.
 *
 * ## Keys
 *
 * It claims none — §10's composer key contract is untouched, and the popover
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

/**
 * How far inside the room a clamped card's edge lands, in px.
 *
 * One number for both axes deliberately: it is the card's own offset from the
 * line (`bottom: calc(100% + 6px)` in `address.css`) read back as a margin, so
 * a card pressed against the top or the right of its room sits the same
 * hairline inside it that it sits above its own anchor.
 */
const POP_MARGIN = 6;

/**
 * What a lane list says when the room ran out before the roster did (UI-130).
 *
 * A capped list that looked complete would be a **silent** cap, and a person
 * choosing a recipient from what they can see would be choosing from a list
 * whose end they never reached. So the count is said out loud beside the lead,
 * on the one line the lead already occupies — the note therefore costs the card
 * no height, which is what keeps it inside SPEC.md §10's rider rather than an
 * exception to it.
 *
 * Since UI-142 it is also the *rare* case rather than the fourth-lane case:
 * the bound is the room now, so this sentence appears only where the surface
 * genuinely cannot be given what its content needs — which is the state
 * SHARED-061 asks a surface to state rather than hide.
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
 * SPEC.md §10's rider signed 2026-08-20 allows that only where the whole of it
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
function lineTitle(line: string, live: boolean, designating: boolean): string {
  const explains = designating ? ADDRESS_DESIGNATING_TITLE : ADDRESS_OPEN_TITLE;
  return `${line} — ${live ? explains : ADDRESS_FLOOR_TITLE}`;
}

/**
 * The nearest ancestor that **bounds** the card, or `null` for one the window
 * itself bounds.
 *
 * The composers this control ships in do not agree about which that is, and the
 * difference is the whole of UI-130: a reply composer sits **inside**
 * `.reader-scroll`, so the card's ceiling is that scrollport's top edge and not
 * the window's, while the comment popover is portaled to `document.body` and
 * genuinely has the window. Asking the layout rather than naming a host is what
 * makes one rule serve both — and every other composer besides.
 *
 * ## Why this walk stops at a clip and not only at a scrollport
 *
 * **It used to stop only at a scrollport, and UI-142 changed that.** The reason
 * it did is recorded here rather than deleted, because the reasoning was sound
 * and it is the *premise* that expired:
 *
 * > `overflow: hidden` clips just as hard, and the global composer's panel
 * > (`.search-panel`) is one — measured, its card is 157px against 132px of
 * > panel above the line, so it has always lost its top padding and lead to that
 * > edge. Bounding to it would trade a clipped edge for a three-lane list
 * > showing one row at a time, which is a worse control than the one being
 * > repaired.
 *
 * That trade was real while the card was **240px wide at every host**, because a
 * 218px measure fits one lane per line and a bound that took 80px of height took
 * three rows with it. The card takes its width from the room now, so inside that
 * panel it is 588px and three lanes share a single row: the same 80px of height
 * costs nothing. The rejection was a consequence of the width constant, and the
 * width constant is what UI-142 removed.
 *
 * Leaving the walk alone was not neutral either. The card is bounded by the room
 * above it and that room got larger, so a nineteen-lane roster in the global
 * composer drew a 212px card into 186px of panel — **80px cropped**, against the
 * 25px the old constant produced. A fix that made an existing defect worse is
 * not a fix, and clipping and scrolling are the same fact for a bound: SHARED-061
 * says a surface is bounded against *what is actually available*, and what a clip
 * cuts off was never available.
 *
 * What a scrollport still adds is the *severity* — what leaves it is not merely
 * cropped but **unreachable**, because the chrome outside takes the pointer
 * events aimed at it (`elementFromPoint` answered `DIV.reader-head` at the
 * centre of three rows). That is why the walk was written for UI-130 at all, and
 * it is unchanged: `.reader-scroll` is still the first box this finds from a
 * reply composer, because the walk goes outward and the scrollport is inside
 * `.col`.
 *
 * `overflow: clip` is included for the same reason `hidden` is, and neither
 * `visible` nor an unset value stops the walk.
 */
function clipperOf(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent !== null) {
    const overflow = window.getComputedStyle(parent).overflowY;
    if (overflow !== "visible") return parent;
    parent = parent.parentElement;
  }
  return null;
}

/**
 * The room the card has, in both axes — SPEC.md §10's rider of 2026-08-21
 * (SHARED-061): *"a bound is derived from the room, not chosen as a number."*
 *
 * Two readings, and each answers a different question the layout asks.
 *
 * **`ceiling` — how high the card may reach.** The top of the nearest box that
 * bounds it — a scrollport or a clip — or the top of the window where there is
 * none. See {@link clipperOf}, which records why the walk stops at both.
 *
 * **`right` — how wide it may be drawn.** The trailing edge of `host`, which is
 * the element the address line was placed in: a composer foot, the global
 * panel's action bar, the comment popover's foot. That row **is** the card's
 * place, in the sense §10 gives the word — a property of the layout, never of
 * the roster — so a card as wide as its row is as wide as the surface it
 * belongs to, and a column dragged wider or a window that narrows the panel
 * moves it. It is clamped by the room's own right edge so a host wider than the
 * box that bounds it cannot push the card under a scrollbar or past a clip.
 *
 * `clientWidth` rather than the border-box right, because a scrollport's
 * scrollbar is room the card does not have.
 */
/**
 * How tall the statement box has to be to hold **any** sentence this roster can
 * put in it, at the width the card currently has — in lines, and `null` where
 * there is no layout to ask (UI-143).
 *
 * ## Why this is a reading and not a constant
 *
 * The reserve exists so that previewing a lane changes the words and never the
 * height (SHARED-057, UI-127). It was four lines, measured once at the 240px
 * card UI-142 removed; at the room-derived widths that replaced it no §7
 * statement reaches four, so an ordinary card reserved about two lines of white
 * space. SHARED-061 answers that directly — *"a bound is derived from the room,
 * not chosen as a number"* — and the room here is a width, so the honest reserve
 * is the height these sentences occupy **at that width**.
 *
 * ## Why measuring the content is not the thing SHARED-057 forbids
 *
 * The rule bans a box that follows **what it is showing**: that box grows on
 * hover, the row under the pointer moves out from under it, and the surface
 * oscillates. This measures the *closed set* of sentences the roster can
 * produce, none of which changes while a pointer travels over the list — so the
 * answer is the same before, during and after every preview. SHARED-057's own
 * clause 3 asks for exactly this: *"the box is sized for the text people
 * actually have, measured against real content"*.
 *
 * ## How
 *
 * A probe carrying `.recipient-says`' own class, appended beside the real
 * element so every ancestor rule that styles it applies, given the real
 * element's width and released from the clamp. Each candidate sentence in turn,
 * then one short word for the height of a single line — measured rather than
 * computed from `line-height`, so a fallback font that rounds differently
 * cannot make the count and the reserved height disagree.
 *
 * It is `position: absolute` and `visibility: hidden`, so it is out of flow and
 * cannot itself change the card it is measuring inside.
 */
function reserveLines(says: HTMLElement, statements: readonly string[]): number | null {
  const probe = document.createElement("span");
  probe.className = says.className;
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;height:auto;max-height:none;-webkit-line-clamp:none;";
  probe.style.width = `${String(says.getBoundingClientRect().width)}px`;
  const host = says.parentElement;
  if (host === null) return null;
  host.appendChild(probe);
  try {
    probe.textContent = "x";
    const line = probe.getBoundingClientRect().height;
    // No layout to ask — jsdom, a server render. The CSS floor stands, and the
    // card is not measured into a shape nobody can see.
    if (line <= 0) return null;
    let tallest = line;
    for (const text of statements) {
      probe.textContent = text;
      tallest = Math.max(tallest, probe.getBoundingClientRect().height);
    }
    return Math.max(1, Math.round(tallest / line));
  } finally {
    probe.remove();
  }
}

function roomFor(card: HTMLElement, host: HTMLElement | null): { ceiling: number; right: number } {
  const clip = clipperOf(card);
  if (clip === null) {
    const width = document.documentElement.clientWidth;
    return {
      ceiling: 0,
      right: Math.min(host?.getBoundingClientRect().right ?? width, width - POP_MARGIN),
    };
  }
  const box = clip.getBoundingClientRect();
  return {
    ceiling: Math.max(box.top, 0),
    right: Math.min(
      host?.getBoundingClientRect().right ?? box.left + clip.clientWidth,
      box.left + clip.clientWidth - POP_MARGIN,
    ),
  };
}

export function ComposerAddress({ address, surface }: ComposerAddressProps): ReactElement {
  const [open, setOpen] = useState(false);
  /**
   * The row whose full statement the popover is showing: whatever the person is
   * looking at, else whoever will answer. Tabbing through the lanes reads them
   * out, so nothing here is available only to a pointer (SPEC.md §10).
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
   * **Every sentence the statement box can be asked to hold** — the closed set
   * the reserve is measured against (UI-143).
   *
   * Composed exactly as the rendered statement is, one row at a time, plus the
   * no-row sentence for a preview naming a lane the roster has stopped listing.
   * Deliberately independent of `previewed`: a set that changed with the pointer
   * would put the measurement back inside the loop the reserve exists to break.
   *
   * A **pick** does change it — `statementFor`'s verb differs for a lane the
   * person chose — and that is a deliberate act with no pointer feedback, so
   * refitting on it moves nothing out from under anybody.
   */
  const statements = useMemo(
    () => [
      statementFor(undefined, false),
      ...rows.map((row) => {
        const text = statementFor(
          row,
          row.lane === recipient.chosen,
          row.lane === recipient.refused,
        );
        const note =
          row.lane === recipient.computed && row.lane !== recipient.refused
            ? ` (${DEFAULT_ROW_NOTE})`
            : "";
        return `${text}${note}`;
      }),
    ],
    [rows, recipient.chosen, recipient.computed, recipient.refused],
  );
  /** The fit's dependency on that set: its contents, never its identity. */
  const saysKey = statements.join(" ");
  // Read through a ref, so the fit depends on what the sentences say rather
  // than on the array identity a render happened to build.
  const candidates = useRef(statements);
  candidates.current = statements;

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
   * open flag, the roster's length and the sentences the roster can say:
   * hovering or focusing a row changes none of them, so nothing here can move a
   * row out from under a pointer, which is the loop UI-127 closed and SPEC.md
   * §10's rider forbids.
   *
   * **The statement's reserve is fitted here too, since UI-143.** It belongs in
   * this pass rather than in CSS for the same reason the other three bounds do:
   * it is a height at the card's own width, and the width is a reading of the
   * room that CSS cannot take. See {@link reserveLines} for what is measured and
   * why measuring it is not the content-driven sizing SHARED-057 forbids.
   */
  useLayoutEffect(() => {
    const card = pop.current;
    if (!open || card === null) return undefined;
    const list = lanes.current;
    const says = card.querySelector<HTMLElement>(".recipient-says");
    const clip = clipperOf(card);
    // The row the address line was placed in — a composer foot, an action bar.
    // Read from the control's own parent rather than from a class name: the kit
    // ships this to five hosts whose foot markup is not the same (SPEC.md §10).
    const host = box.current?.parentElement ?? null;

    const fit = (): void => {
      // Measured unbounded and unshifted, so no previous fit can bias this one.
      card.style.setProperty("--address-pop-shift", "0px");
      card.style.setProperty("--address-pop-max", "none");

      // **The width first**, because the height depends on it: a wider card
      // re-wraps the lane list and changes what the room has to hold. Its left
      // edge is `left: 0` against the line and does not move with the width, so
      // reading it before setting the width is safe and not circular.
      const room = roomFor(card, host);
      const width = Math.max(0, room.right - card.getBoundingClientRect().left);
      card.style.setProperty("--address-pop-w", `${String(Math.round(width))}px`);

      /*
       * **Then the statement's reserve, at the width just set** (UI-143).
       *
       * Two readings, and both are the room's rather than the content's:
       *
       * - *What the sentences need* — {@link reserveLines}, the tallest of the
       *   closed set at this width. Below UI-127's old four on a wide card,
       *   above it on a narrow one, and right at both.
       * - *What the card can spare* — the room, minus everything in the card
       *   that cannot shrink, minus one lane row. It is the same floor the
       *   height fit takes below, for the same reason: a card that gave the
       *   statement every line it wanted could squeeze the list to nothing, and
       *   a list with no rows is a recipient control that offers no recipients.
       *
       * The smaller wins, and a statement past it truncates in place with the
       * whole of it on this element's title and the row's — SHARED-057's
       * reveal, which is what makes capping honest. `AgentLane.summary` is free
       * text, so the cap is not hypothetical: without it one long summary would
       * decide the card.
       */
      if (says !== null) {
        const want = reserveLines(says, candidates.current);
        if (want !== null) {
          // Measured at the floor, so the card's own height carries exactly one
          // line of statement and the spare below is the room for the rest.
          card.style.setProperty("--says-lines", "1");
          const one = says.getBoundingClientRect().height;
          const bare = card.getBoundingClientRect();
          const fixed = bare.height - (list?.scrollHeight ?? 0);
          const bareRow = list?.firstElementChild?.getBoundingClientRect().height ?? 0;
          const spare = bare.bottom - room.ceiling - POP_MARGIN - fixed - bareRow;
          const affordable = one > 0 ? 1 + Math.max(0, Math.floor(spare / one)) : want;
          card.style.setProperty("--says-lines", String(Math.min(want, affordable)));
        }
      }

      const free = card.getBoundingClientRect();
      const listFull = list?.scrollHeight ?? 0;
      const row = list?.firstElementChild?.getBoundingClientRect().height ?? 0;

      // The card's bottom edge is `calc(100% + 6px)` above the line and never
      // moves. Everything above it, up to the top of the box that bounds it, is
      // the room — and since UI-142 that is the *only* ceiling. A constant below
      // it is what put an ordinary roster behind a scrollbar with the window
      // half empty.
      const headroom = Math.max(0, free.bottom - room.ceiling - POP_MARGIN);
      // **One row is the floor**, and it is measured rather than declared: the
      // parts that cannot shrink are not all the same height — a resident's
      // weight sentence is three lines where a level row is one — so the
      // smallest useful card is a reading and not a constant. A card squeezed
      // until its list was 0px high would clear the head and offer nothing,
      // which is this defect wearing different clothes.
      const floor = free.height - listFull + row;
      const height = Math.max(floor, headroom);
      card.style.setProperty("--address-pop-max", `${String(Math.round(height))}px`);

      // Whatever the floor took beyond the room, the card gives back by coming
      // down — so its top lands inside the scrollport instead of behind the head.
      const over = card.getBoundingClientRect().height - headroom;
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
  }, [open, rows.length, saysKey]);

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
          title={lineTitle(
            address.line,
            address.live,
            address.weight.kind === "choice" && address.weight.designating !== undefined,
          )}
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
        // §10's recipient statement with nothing to change behind it: said, not
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
              {/* The box is reserved (SPEC.md §10's rider signed 2026-08-20):
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
              {weight.designating !== undefined ? (
                /* The rider of 2026-08-19, met the other way round (UI-185):
                 * here the rows stay live — the choice rides the message,
                 * which §7 gives a real job and Capture shares — so the
                 * section says out loud what they do not govern: the resident
                 * this send designates, whose own level is the owner
                 * control's. */
                <p className="address-resident" data-designation-boundary={weight.designating}>
                  {designationWeightSentence(weight.designating)}
                </p>
              ) : null}
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
