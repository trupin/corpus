import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { Button } from "../components/Controls/Button.js";
import { Popover } from "../components/Controls/Popover.js";
import { MIN_USABLE_HEIGHT_PX, ScrollArea } from "../components/Controls/ScrollArea.js";
import { LaneDot } from "../recipient/LaneDot.js";
import type { LaneRow } from "../recipient/laneRows.js";
import { DEFAULT_ROW_NOTE, statementFor } from "../recipient/statement.js";
import {
  ADDRESS_FLOOR_TITLE,
  ADDRESS_OPEN_TITLE,
  ADDRESS_RECIPIENT_TITLE,
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
 *   composer reaches the agent *and* the orchestrator answers *and* no other
 *   control on the surface already asks the question. For a **resident**
 *   recipient the weight section is one sentence naming the resident's weight
 *   — the rider signed 2026-08-19 — and no level is offered, because a choice
 *   there would be discarded in silence. For a **designating** send the whole
 *   section is absent (UI-192): the surface's own owner/"at" controls are the
 *   one home of the weight, and a second editor here — reconciled by a
 *   tooltip — was the reported defect. On the **floor** (a send that will not
 *   reach the agent) there is no weight section at all: nothing to weigh.
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
 *   measurements. **The roster's floor is `--min-usable-height`, never one
 *   row** (UI-192, UI-193): the pre-rebuild floor was a single lane row, which
 *   over a crowded roster in a short room rendered a 25px sliver that was
 *   nearly impossible to scroll or to recognise as scrollable. The kit
 *   `ScrollArea` clamps the region at `min(content, token)` — a short roster
 *   takes its own height, never the token's (phase-60's FAIL-1) — and the fit
 *   below pays for the clamp by shifting the card down into its scrollport,
 *   or, where the whole box that bounds it is shorter than even the floored
 *   card, by capping the card at that box and scrolling it as one piece.
 *
 * ## Exits and keys (rebuilt on the kit `Popover`, UI-192)
 *
 * The card is a kit {@link Popover}, so its exits are the primitive's
 * unconditional set: a **visible ✕**, **Escape** (consumed on the card's own
 * subtree, focus returned to the line), and an outside press — three paths
 * where the old card offered only the guessable third. This file used to state
 * "Escape is deliberately not handled — the app's escape chain owns that key
 * and a kit component cannot register in it". The layering half of that
 * sentence survives: kit still imports nothing from the app. What changed is
 * the contract's shape — the chain yields close keys aimed inside any
 * `[data-kit-menu]` surface, the `Popover` renders that marker, and opening
 * moves focus into the card, so the key lands where the chain yields. One
 * press closes the card and nothing behind it.
 *
 * §10's composer key contract is otherwise untouched: the line toggles on
 * click, `↵` or `space`, and every row and level is reachable by keyboard
 * while open (Tab cycles inside the card, the `Popover` trap).
 */

export interface ComposerAddressProps {
  /** From `composerAddress(...)` — the one derivation of line, rows and levels. */
  readonly address: Address;
  /** Names this composer in the DOM: `data-composer-address="<surface>"`. */
  readonly surface: string;
}

export const RECIPIENT_GROUP_LABEL = "Recipient";
export const WEIGHT_GROUP_LABEL = "Weight";

/** The popover's accessible name, and half of its close control's. */
export const ADDRESS_POP_LABEL = "Address";

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
 *
 * **The explanation matches what the popover offers** (UI-192). While the card
 * carries the level rows it says "change either"; while it carries the
 * recipient alone — a designating send, a resident recipient — it says only
 * that, because a clause reconciling this control with another one is the
 * defect UI-192 removed (`ADDRESS_DESIGNATING_TITLE`, deleted).
 */
function lineTitle(line: string, live: boolean, editsWeight: boolean): string {
  const explains = editsWeight ? ADDRESS_OPEN_TITLE : ADDRESS_RECIPIENT_TITLE;
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
 * **`floor` — how low its bottom edge may land.** The bottom of the same box,
 * clamped by the window. It exists because the ceiling alone answered only
 * half the question (the phase-60 evaluation's FAIL-1): a card whose floored
 * parts outran the room above the line was *shifted down* into its box, and a
 * box shorter than the card — the global composer's `overflow: hidden` panel,
 * 192px against a 229px card — clipped the shifted bottom, where the "no
 * owner" state's only weight editor sat, unpainted and unpressable at every
 * window size. What a clip cuts off was never available (SHARED-061), and
 * that is as true of a bottom edge as of a top one.
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
function roomFor(
  card: HTMLElement,
  host: HTMLElement | null,
): { ceiling: number; floor: number; right: number } {
  const clip = clipperOf(card);
  if (clip === null) {
    const width = document.documentElement.clientWidth;
    return {
      ceiling: 0,
      floor: document.documentElement.clientHeight,
      right: Math.min(host?.getBoundingClientRect().right ?? width, width - POP_MARGIN),
    };
  }
  const box = clip.getBoundingClientRect();
  return {
    ceiling: Math.max(box.top, 0),
    floor: Math.min(box.bottom, document.documentElement.clientHeight),
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
  const effectiveRow = useRef<HTMLButtonElement>(null);

  const offers = address.offers;
  // A popover whose last section disappeared from under it (the roster shrank,
  // the guidance stopped declaring levels) must not stay open as an empty card.
  useEffect(() => {
    if (!offers) setOpen(false);
  }, [offers]);

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
   * the room will not take the fixed parts and a usable list — a 187px
   * scrollport at 1280×400 — `--address-pop-shift` moves the card down until
   * its top is inside the scrollport instead of behind the reader's head. And
   * where the *whole* box that bounds the card will not take them — the
   * global composer's 192px `overflow: hidden` panel under a crowded no-owner
   * roster — the card is capped at that box's height and scrolls as one piece
   * (`data-address-pop-scrolls`), because a shift into a box shorter than the
   * card just moved the clipped edge from its top to its bottom, and what sat
   * past it — that state's only weight editor — was unpaintable and
   * unpressable at every window size (the phase-60 evaluation's FAIL-1).
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
   *
   * The card and the list are reached by query rather than by ref, because both
   * are the kit's now (`Popover`, `ScrollArea`) and neither primitive forwards
   * one — the class names are this file's own and stable.
   */
  useLayoutEffect(() => {
    const card = box.current?.querySelector<HTMLElement>(".address-pop") ?? null;
    if (!open || card === null) return undefined;
    const list = card.querySelector<HTMLElement>(".recipient-lanes");
    const says = card.querySelector<HTMLElement>(".recipient-says");
    const clip = clipperOf(card);
    // The row the address line was placed in — a composer foot, an action bar.
    // Read from the control's own parent rather than from a class name: the kit
    // ships this to five hosts whose foot markup is not the same (SPEC.md §10).
    const host = box.current?.parentElement ?? null;

    const fit = (): void => {
      // Measured unbounded, unshifted and unscrolled, so no previous fit can
      // bias this one.
      card.style.setProperty("--address-pop-shift", "0px");
      card.style.setProperty("--address-pop-max", "none");
      card.setAttribute("data-address-pop-scrolls", "false");

      // **The width first**, because the height depends on it: a wider card
      // re-wraps the lane list and changes what the room has to hold. Its left
      // edge is `left: 0` against the line and does not move with the width, so
      // reading it before setting the width is safe and not circular.
      const room = roomFor(card, host);
      const width = Math.max(0, room.right - card.getBoundingClientRect().left);
      card.style.setProperty("--address-pop-w", `${String(Math.round(width))}px`);

      /*
       * **The list's own floor** — `--min-usable-height`, the kit token, and
       * never one row (UI-192). The pre-rebuild floor was a single lane row:
       * "a card squeezed until its list was 0px high would clear the head and
       * offer nothing" was the argument, and it stopped one pixel past its own
       * conclusion — a 25px list over a ten-lane roster *is* a control that
       * offers nothing, it merely renders one row of it. The `ScrollArea`
       * clamps the region at the token in CSS (its dev build throws below it),
       * so the fit reserves the same number, and where the room cannot pay it
       * the card comes down over its own composer instead — the shift below.
       */
      // `+ 1` mirrors the `ScrollArea`'s own clamp: the overflow border is
      // sized into the box, so the usable inside costs the token plus the
      // border's pixel. The `min` against the content is the same reading the
      // primitive takes since the phase-60 fix — a roster shorter than the
      // token reserves its own height and no more, so a short list never
      // spends room the card does not have.
      const listFloor = Math.min(list?.scrollHeight ?? 0, MIN_USABLE_HEIGHT_PX + 1);

      /*
       * **The room's whole height** — ceiling to floor, less the margin at
       * each edge: the most card the box that bounds it can show at all
       * (the phase-60 evaluation's FAIL-1). The headroom below is how much of
       * it sits *above* the line; this is the cap on the card whatever the
       * shift moves it down over.
       */
      const available = Math.max(0, room.floor - room.ceiling - 2 * POP_MARGIN);

      /*
       * **Then the statement's reserve, at the width just set** (UI-143).
       *
       * Two readings, and both are the room's rather than the content's:
       *
       * - *What the sentences need* — {@link reserveLines}, the tallest of the
       *   closed set at this width.
       * - *What the card can spare* — the room, minus everything in the card
       *   that cannot shrink, minus the list's floor above. A card that gave
       *   the statement every line it wanted could squeeze the list under its
       *   minimum, and the minimum is the point of UI-192.
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
          // Budgeted against the room above the line *and* the room's whole
          // height: a statement line the clip cannot show is not affordable.
          const budget = Math.min(bare.bottom - room.ceiling - POP_MARGIN, available);
          const spare = budget - fixed - listFloor;
          const affordable = one > 0 ? 1 + Math.max(0, Math.floor(spare / one)) : want;
          card.style.setProperty("--says-lines", String(Math.min(want, affordable)));
        }
      }

      const free = card.getBoundingClientRect();
      const listFull = list?.scrollHeight ?? 0;

      // The card's bottom edge is `calc(100% + 6px)` above the line and never
      // moves. Everything above it, up to the top of the box that bounds it, is
      // the room — and since UI-142 that is the *only* ceiling. A constant below
      // it is what put an ordinary roster behind a scrollbar with the window
      // half empty.
      const headroom = Math.max(0, free.bottom - room.ceiling - POP_MARGIN);
      // **The floor is the fixed parts plus a usable list** — measured, because
      // the parts that cannot shrink are not all the same height (a resident's
      // weight sentence is three lines where a level row is one).
      const floor = free.height - listFull + listFloor;
      // …and the cap is the room's whole height. A card past the headroom
      // comes down over its own composer (the shift below); a card past
      // `available` has nowhere left to come down *to*, so it is capped there
      // and scrolls as one piece instead — see the attribute below.
      const height = Math.min(Math.max(floor, headroom), available);
      card.style.setProperty("--address-pop-max", `${String(Math.round(height))}px`);

      /*
       * Where even the floored parts outrun the whole box that bounds the card
       * — the global composer's 192px panel under a crowded no-owner roster, a
       * 1280×400 scrollport — the card scrolls as one piece rather than
       * letting the clip hide what falls past its edge (the phase-60
       * evaluation's FAIL-1: the "no owner" state's only weight editor laid
       * out 11px past the panel, hit-testing to the scrim). Set by this fit
       * and never at rest, so a card that fits keeps `overflow: visible` and
       * byte-identical geometry.
       */
      card.setAttribute("data-address-pop-scrolls", floor > available + 1 ? "true" : "false");

      // Whatever the floor took beyond the room, the card gives back by coming
      // down — so its top lands inside the scrollport instead of behind the
      // head. With the height capped at `available`, the shifted bottom lands
      // at most `POP_MARGIN` inside the room's floor, never past it.
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

  /**
   * Focus moves into the card the moment it opens — the effective row where
   * the roster shows, else the ✕ — and only on the open *transition*, so a
   * re-render while it is up never yanks focus back.
   *
   * This is what makes the `Popover`'s Escape unconditional in practice: its
   * listener lives on the card's own subtree (kit cannot register in the
   * app's escape chain — the dependency direction), so the key must land
   * inside for the card to answer it. It is also the ordinary dialog
   * behaviour §10 asks of every menu in the product. `preventScroll`, because
   * the browser would otherwise scroll every ancestor scrollport to reveal
   * the focused row — the fit has already placed the card inside its room,
   * and a reader that lurched under it would move the very line it anchors to.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opened) return;
    const into =
      effectiveRow.current ??
      box.current?.querySelector<HTMLElement>(".address-pop .kit-popover-close") ??
      null;
    into?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div
      className="composer-address"
      ref={box}
      data-composer-address={surface}
      data-address-live={address.live ? "true" : "false"}
      data-recipient-refused={recipient.refused ?? ""}
    >
      {offers ? (
        <Button
          className="address-line"
          data-address-line={surface}
          aria-expanded={open}
          title={lineTitle(address.line, address.live, weight.kind === "choice")}
          onClick={() => {
            // A plain toggle, and it can be one because the whole control is
            // the card's `anchor`: the Popover's outside-press dismissal
            // ignores this press, so the toggle and the dismissal never race
            // on one mousedown/click pair.
            setOpen((current) => !current);
          }}
        >
          <span className="address-line-text">{address.line}</span>
          <span className="address-caret" aria-hidden="true">
            ▾
          </span>
        </Button>
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
        <Popover
          label={ADDRESS_POP_LABEL}
          className="address-pop"
          data-address-pop={surface}
          anchor={box}
          onClose={() => {
            setOpen(false);
          }}
        >
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
              {/* The kit region (UI-193): clamped at `--min-usable-height`, so
               * the crowded roster that rendered a 25px sliver cannot be
               * expressed, and `data-overflowing` corroborates the note. */}
              <ScrollArea className="recipient-lanes">
                {rows.map((row) => (
                  <LaneButton
                    key={row.lane}
                    row={row}
                    recipient={recipient}
                    onPreview={setPreviewed}
                    innerRef={row.lane === recipient.effective ? effectiveRow : undefined}
                  />
                ))}
              </ScrollArea>
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
                    <Button
                      key={level.key}
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
                    </Button>
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
        </Popover>
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
    <Button
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
    </Button>
  );
}
