/** @vitest-environment jsdom */
import type { AgentLane } from "@corpus/contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { laneRow } from "../recipient/laneRows.js";
import { DEFAULT_ROW_NOTE } from "../recipient/statement.js";
import type { ComposerRecipient } from "../recipient/useComposerRecipient.js";
import type { ComposerWeight } from "../weight/weightChoice.js";
import {
  ADDRESS_FLOOR_TITLE,
  ADDRESS_OPEN_TITLE,
  composerAddress,
  residentWeightSentence,
  NOBODY_ASKED,
} from "./addressModel.js";
import { ComposerAddress, lanesCappedNote, WEIGHT_GROUP_LABEL } from "./ComposerAddress.js";

/**
 * The control (UI-126): the line, the popover, and what the popover refuses to
 * offer. The wording and the wire are `addressModel.test.ts`'s; what is pinned
 * here is the surface — including the one assertion the issue exists for:
 * **a resident recipient gets no weight control**, falsifiable by making
 * `addressWeight` return a `choice` for a resident and watching the pin below
 * go red on its own.
 */

afterEach(cleanup);

const NOW = new Date().toISOString();

const ORCHESTRATOR: AgentLane = {
  lane: "orchestrator",
  resident: null,
  live: true,
  since: NOW,
  summary: null,
  origin: null,
};

const RESIDENT: AgentLane = {
  lane: "th_a",
  resident: { name: "Ana", docId: "doc_ana", weight: "heavy" },
  live: true,
  since: NOW,
  summary: "reviewing the draft",
  origin: { id: "th_a", title: "The claims conversation" },
};

const LEVELS = [
  { label: "Small and mechanical", key: "light" },
  { label: "Standard", key: "standard" },
  { label: "Heavy or judgment-laden", key: "heavy" },
] as const;

interface HostProps {
  readonly lanes: readonly AgentLane[];
  readonly levels?: readonly { label: string; key: string }[];
  readonly live?: boolean;
  readonly computed?: string;
  readonly onWire?: (request: { weight?: string; recipient?: string }) => void;
}

/**
 * A minimal composer: real `ComposerAddress` over hand-held recipient and
 * weight state, so the test drives the same `choose` seams the hooks expose
 * without a transport.
 */
function Host({
  lanes,
  levels = LEVELS,
  live = true,
  computed = "orchestrator",
  onWire,
}: HostProps) {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [level, setLevel] = useState<string | undefined>(undefined);
  const recipient: ComposerRecipient = {
    rows: lanes.map((lane) => laneRow(lane, new Date())),
    computed,
    chosen,
    effective: chosen ?? computed,
    overridden: chosen !== undefined && chosen !== computed,
    choose: setChosen,
    request: chosen === undefined ? {} : { recipient: chosen },
    refused: undefined,
    clear: () => {
      setChosen(undefined);
    },
    refuse: () => undefined,
  };
  const weight: ComposerWeight = {
    levels,
    chosen: level,
    request: level === undefined ? {} : { weight: level },
    choose: setLevel,
  };
  const address = composerAddress({ weight, recipient, live });
  onWire?.(address.request);
  return <ComposerAddress address={address} surface="probe" />;
}

const line = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-address-line="probe"]');
  if (found === null) throw new Error("no address line");
  return found;
};

const pop = (): HTMLElement | null => document.querySelector('[data-address-pop="probe"]');

const weightKeys = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-weight-key]")].map(
    (option) => option.dataset["weightKey"] ?? "",
  );

describe("the line", () => {
  it("is the only thing rendered at rest — no rows, no levels, no popover", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} />);
    expect(line().textContent).toContain("will answer");
    expect(pop()).toBeNull();
    expect(document.querySelectorAll("[data-recipient-lane]")).toHaveLength(0);
    expect(weightKeys()).toEqual([]);
  });

  it("opens on click and closes on a second click", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} />);
    fireEvent.click(line());
    expect(pop()).not.toBeNull();
    expect(line().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(line());
    expect(pop()).toBeNull();
  });

  it("closes on a pointer landing outside, and not on one inside", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} />);
    fireEvent.click(line());
    const inside = document.querySelector('[data-recipient-lane="orchestrator"]');
    if (inside === null) throw new Error("no row");
    fireEvent.pointerDown(inside);
    expect(pop()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(pop()).toBeNull();
  });

  it("does not pretend to open when there is nothing behind it", () => {
    render(<Host lanes={[ORCHESTRATOR]} levels={[]} />);
    expect(line().tagName).toBe("SPAN");
    fireEvent.click(line());
    expect(pop()).toBeNull();
  });
});

/**
 * The line's own reveal (SPEC.md §10's rider signed 2026-08-20, UI-137).
 *
 * Its **width** is the browser spec's — `apps/ui/e2e/address-geometry.spec.ts`,
 * because the slot is a flex basis and jsdom implements no layout. What is
 * pinned here is the half jsdom can see: the slot truncates the line by CSS, so
 * the pill's own title has to carry the whole sentence, or a statement wider
 * than 22ch is lost rather than revealed.
 */
describe("the line's title", () => {
  it("leads with the whole statement, then says what pressing it does", () => {
    // A resident recipient, whose line carries a weight clause and so is the
    // statement the 22ch slot actually truncates.
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} computed="th_a" />);
    const title = line().getAttribute("title") ?? "";
    // The caret is not part of the sentence, so the text element is the one
    // compared: it is what the slot truncates and what the title stands in for.
    const said = line().querySelector(".address-line-text")?.textContent ?? "";
    expect(said).not.toBe("");
    expect(title.startsWith(said)).toBe(true);
    expect(title).toContain(ADDRESS_OPEN_TITLE);
  });

  it("says the floor's own explanation there instead", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} live={false} />);
    const title = line().getAttribute("title") ?? "";
    expect(title).toContain(NOBODY_ASKED);
    expect(title).toContain(ADDRESS_FLOOR_TITLE);
  });

  it("reveals the sentence alone where there is no gesture to explain", () => {
    render(<Host lanes={[ORCHESTRATOR]} levels={[]} />);
    expect(line().tagName).toBe("SPAN");
    expect(line().getAttribute("title")).toBe(
      line().querySelector(".address-line-text")?.textContent,
    );
  });
});

describe("the two sections", () => {
  it("offers the lanes and the levels, each row an ordinary button", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} />);
    fireEvent.click(line());
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-recipient-lane]")].map(
        (row) => row.dataset["recipientLane"],
      ),
    ).toEqual(["orchestrator", "th_a"]);
    expect(weightKeys()).toEqual(["light", "standard", "heavy"]);
    for (const option of document.querySelectorAll("[data-recipient-lane], [data-weight-key]")) {
      expect(option.tagName).toBe("BUTTON");
      expect(option.getAttribute("type")).toBe("button");
    }
  });

  it("routes a pick and a level through the same seams the old controls used", () => {
    const wire = vi.fn();
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} onWire={wire} />);
    fireEvent.click(line());
    fireEvent.click(screen.getByRole("button", { name: "Heavy or judgment-laden" }));
    expect(wire).toHaveBeenLastCalledWith({ weight: "heavy" });
    // Pressing the standing choice clears it — one gesture back to nothing.
    fireEvent.click(screen.getByRole("button", { name: "Heavy or judgment-laden" }));
    expect(wire).toHaveBeenLastCalledWith({});
  });

  it("keeps a pick of the resident's lane on the wire, and shows its weight on the line", () => {
    const wire = vi.fn();
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} onWire={wire} />);
    fireEvent.click(line());
    const resident = document.querySelector<HTMLElement>('[data-recipient-lane="th_a"]');
    if (resident === null) throw new Error("no resident row");
    fireEvent.click(resident);
    expect(wire).toHaveBeenLastCalledWith({ recipient: "th_a" });
    expect(line().textContent).toContain("Ana will answer · Heavy or judgment-laden");
  });
});

describe("the resident rule (SPEC.md §7 and §10, rider signed 2026-08-19)", () => {
  /**
   * THE pin. A composer addressing a resident's lane offers **no weight
   * control** — the section is one sentence naming the resident's weight.
   * Falsified on 2026-08-19 by making `addressWeight` return the `choice` kind
   * for a resident lane: this test alone went red (see the issue's log).
   */
  it("offers no weight control for a resident recipient — a sentence instead", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} computed="th_a" />);
    fireEvent.click(line());
    expect(pop()).not.toBeNull();
    expect(weightKeys()).toEqual([]);
    expect(screen.queryByRole("group", { name: WEIGHT_GROUP_LABEL })).toBeNull();
    const sentence = document.querySelector('[data-resident-weight="set"]');
    expect(sentence?.textContent).toBe(
      residentWeightSentence("Ana", {
        kind: "set",
        key: "heavy",
        label: "Heavy or judgment-laden",
      }),
    );
    expect(sentence?.textContent).toContain("hands off");
  });

  it("says the launcher chose when the designation named no level", () => {
    const launched: AgentLane = {
      ...RESIDENT,
      resident: { name: "Ana", docId: "doc_ana", weight: null },
    };
    render(<Host lanes={[ORCHESTRATOR, launched]} computed="th_a" />);
    fireEvent.click(line());
    expect(weightKeys()).toEqual([]);
    expect(document.querySelector('[data-resident-weight="launch"]')?.textContent).toContain(
      "the weight chosen at launch",
    );
  });

  it("switches the section as the pick moves, with nothing carried across", () => {
    const wire = vi.fn();
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} onWire={wire} />);
    fireEvent.click(line());
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    expect(wire).toHaveBeenLastCalledWith({ weight: "standard" });

    const resident = document.querySelector<HTMLElement>('[data-recipient-lane="th_a"]');
    if (resident === null) throw new Error("no resident row");
    fireEvent.click(resident);
    // The standing choice is not sent — it was never offered for this
    // recipient, so it is not made rather than silently discarded.
    expect(wire).toHaveBeenLastCalledWith({ recipient: "th_a" });
    expect(weightKeys()).toEqual([]);

    fireEvent.click(resident);
    // Back on the orchestrator, the choice is still standing and travels again.
    expect(wire).toHaveBeenLastCalledWith({ weight: "standard" });
    expect(weightKeys()).toEqual(["light", "standard", "heavy"]);
  });
});

describe("the floor", () => {
  it("says nobody is asked and offers the recipient alone", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} live={false} />);
    expect(line().textContent).toContain(NOBODY_ASKED);
    fireEvent.click(line());
    expect(pop()).not.toBeNull();
    expect(document.querySelectorAll("[data-recipient-lane]")).toHaveLength(2);
    expect(weightKeys()).toEqual([]);
    expect(document.querySelector("[data-resident-weight]")).toBeNull();
  });
});

/**
 * The statement under the rows (SPEC.md §10's rider signed 2026-08-20, UI-127).
 *
 * Its **height** is the browser spec's — `apps/ui/e2e/address-geometry.spec.ts`,
 * because jsdom implements no layout and the defect was a layout loop. What is
 * pinned here is the half jsdom can see: the sentence is truncated by CSS, so
 * the title has to carry the *whole* of it, clause for clause, or the reveal
 * SHARED-057 asks for reveals less than the box it stands in for.
 */
describe("the statement", () => {
  const statement = (): HTMLElement => {
    const found = document.querySelector<HTMLElement>('[data-recipient-statement="probe"]');
    if (found === null) throw new Error("no statement");
    return found;
  };
  const row = (lane: string): HTMLElement => {
    const found = document.querySelector<HTMLElement>(`[data-recipient-lane="${lane}"]`);
    if (found === null) throw new Error(`no row for ${lane}`);
    return found;
  };

  it("carries the whole sentence on its title, the default note included", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} />);
    fireEvent.click(line());
    // At rest it states the effective recipient, which here is the computed
    // default — so the note is part of the sentence and part of the title.
    expect(statement().textContent).toContain(`(${DEFAULT_ROW_NOTE})`);
    expect(statement().title).toBe(statement().textContent);
  });

  it("changes words and title together as the pointer previews a lane", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} />);
    fireEvent.click(line());
    const atRest = statement().title;

    fireEvent.mouseEnter(row("th_a"));
    expect(statement().textContent).toContain("Ana will answer");
    expect(statement().textContent).toContain("reviewing the draft");
    expect(statement().title).toBe(statement().textContent);
    expect(statement().title).not.toBe(atRest);

    fireEvent.mouseLeave(row("th_a"));
    expect(statement().title).toBe(atRest);
  });

  it("does the same for the keyboard, which drives the identical state", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} />);
    fireEvent.click(line());
    const atRest = statement().title;

    fireEvent.focus(row("th_a"));
    expect(statement().textContent).toContain("Ana will answer");
    expect(statement().title).toBe(statement().textContent);

    fireEvent.blur(row("th_a"));
    expect(statement().title).toBe(atRest);
  });
});

/**
 * The half of UI-130 that does not need layout. **The geometry is
 * `apps/ui/e2e/address-geometry.spec.ts`'s** — jsdom reports every box as
 * `0×0`, so a bound, a scroll and an overlap are all invisible here, and a unit
 * test that asserted them would be asserting nothing.
 *
 * What is left is worth pinning anyway: the words, and that the fitting effect
 * runs at all without a layout under it. A `useLayoutEffect` that threw on a
 * `null` box would take every composer down with it.
 */
describe("the capped lane list", () => {
  it("says the count and how to reach the rest", () => {
    expect(lanesCappedNote(20)).toBe("20 lanes · scroll for the rest");
  });

  it("opens without a layout under it, and offers no note when nothing is capped", () => {
    render(<Host lanes={[ORCHESTRATOR, RESIDENT]} />);
    fireEvent.click(screen.getByRole("button", { name: /answer/i }));
    // jsdom measures every box as zero, so the list can never be short of its
    // content — the note is absent, and nothing threw on the way there.
    expect(document.querySelector("[data-address-more]")).toBeNull();
    expect(document.querySelector(".recipient-lanes")).not.toBeNull();
  });
});
