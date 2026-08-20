/** @vitest-environment jsdom */
import type { Doc } from "@corpus/contract";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness, resetWeightChoices } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { anchorHighlightCount, resetAnchorHighlights } from "../anchors/textHighlight";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import {
  docFixture,
  readerTransport,
  threadFixture,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture";
import { weightWiring } from "../testing/weightFixture";
import { ThreadCard } from "./ThreadCard";

/**
 * SPEC.md §11's rider, end to end through the card (UI-051): select words inside
 * a turn, right-click, comment — and get a child thread anchored to *those*
 * words, framed well enough that the repeated phrase beside them is not what the
 * server resolves to.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetSeenMarks();
  resetWeightChoices();
  resetAnchorHighlights();
  globalThis.getSelection?.()?.removeAllRanges();
});

const TURN_BODY =
  "Let's revisit the rate assumption.\n\n" +
  "I said revisit the rate assumption because 6.1% looks stale.";

const TURNS = [
  { author: "user" as const, ts: "2026-08-03T10:00:00.000Z", body: TURN_BODY, model: null },
];

/** The thread's own file: the heading the server writes, then the turn. */
const THREAD_BODY = `## user · 2026-08-03T10:00:00.000Z\n\n${TURN_BODY}\n`;

function threadDoc(overrides: Partial<Doc> = {}): Doc {
  return docFixture({
    frontmatter: { id: "th_a", type: "thread", title: "Re: the rate" },
    body: THREAD_BODY,
    ...overrides,
  });
}

function wire(options: Parameters<typeof readerTransport>[0] = {}): ReaderTransport {
  return readerTransport({
    docs: [threadDoc()],
    threads: [threadFixture({ id: "th_a", parent: null, anchor: null, turns: TURNS })],
    ...options,
  });
}

function Host({ transport }: { readonly transport: ReaderTransport }): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <ContextMenuProvider>
        <ThreadCard
          threadId="th_a"
          host="standalone"
          onOpenDoc={() => undefined}
          onNotify={() => undefined}
        />
      </ContextMenuProvider>
    </harness.Wrapper>
  );
}

async function loaded(container: HTMLElement): Promise<Element> {
  await waitFor(() => {
    expect(container.querySelector(".turn-markdown")).not.toBeNull();
  });
  const root = container.querySelector(".turn-markdown");
  if (root === null) throw new Error("no rendered turn");
  return root;
}

/** Selects the `nth` occurrence of a phrase and right-clicks on it. */
function selectAndRightClick(root: Element, phrase: string, nth: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (let from = 0; ;) {
      const at = text.indexOf(phrase, from);
      if (at === -1) break;
      if (seen === nth) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + phrase.length);
        const selection = globalThis.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const host = node.parentElement;
        if (host === null) throw new Error("detached text node");
        fireEvent.contextMenu(host, { clientX: 40, clientY: 60 });
        return;
      }
      seen += 1;
      from = at + phrase.length;
    }
  }
  throw new Error(`no occurrence ${String(nth)} of "${phrase}"`);
}

const PHRASE = "revisit the rate assumption";

/** A screenshot, as a drop hands one over. */
const shot = (): File => new File(["x"], "shot.png", { type: "image/png" });

describe("commenting on a selection inside a turn", () => {
  it("offers Comment on selection in the turn's own menu", async () => {
    const { container } = render(<Host transport={wire()} />);
    selectAndRightClick(await loaded(container), PHRASE, 1);
    expect(screen.getByRole("menuitem", { name: /Comment on selection/ })).toBeDefined();
    // …and the clipboard basics stay where §11 puts them.
    expect(screen.getByRole("menuitem", { name: /^Copy/ })).toBeDefined();
  });

  it("opens the composer with the selection quoted as a citation", async () => {
    const { container } = render(<Host transport={wire()} />);
    selectAndRightClick(await loaded(container), PHRASE, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    const popover = await screen.findByRole("dialog", { name: "New comment" });
    expect(popover.querySelector(".cm-quote")?.textContent).toBe(`“${PHRASE}”`);
  });

  it("creates a child thread anchored to the occurrence that was selected", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    selectAndRightClick(await loaded(container), PHRASE, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    await screen.findByRole("dialog", { name: "New comment" });

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Still true?" } });
    const send = document.querySelector("[data-comment-send]");
    if (send === null) throw new Error("no send control");
    fireEvent.click(send);

    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
    const sent = transport.of("POST", "/api/threads")[0]?.body as {
      parent: string;
      body: string;
      selector: { exact: string; prefix: string; suffix: string };
    };
    expect(sent.parent).toBe("th_a");
    expect(sent.body).toBe("Still true?");
    expect(sent.selector.exact).toBe(PHRASE);
    // The framing is what makes the *second* occurrence resolvable: the server
    // matches `prefix + exact + suffix` first (SPEC.md §6 rung 1).
    expect(sent.selector.prefix.endsWith("I said ")).toBe(true);
    expect(sent.selector.suffix).toBe(" because 6.1% looks stale.");
    const framed = THREAD_BODY.indexOf(sent.selector.prefix + sent.selector.exact);
    expect(framed + sent.selector.prefix.length).toBe(
      THREAD_BODY.indexOf(PHRASE, THREAD_BODY.indexOf(PHRASE) + 1),
    );
  });

  /**
   * SPEC.md §11's rider (UI-082): the popover this path opens offers the weight,
   * scoped to **this conversation** — the same starting point the card's reply
   * box uses — and what it states rides out on the comment's own request.
   */
  it("states the weight the composer chose, on the child thread's request", async () => {
    const declaring = weightWiring();
    const transport = wire({ docs: [threadDoc(), ...declaring.docs], rows: declaring.rows });
    const { container } = render(<Host transport={transport} />);
    selectAndRightClick(await loaded(container), PHRASE, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    const popover = await screen.findByRole("dialog", { name: "New comment" });

    // The popover's own control — the card's reply box has one too, and they
    // share this conversation's standing choice. The levels sit behind the
    // address line since UI-126, so the comment popover is opened first and
    // then the address popover inside it.
    const addressLine = await within(popover).findByRole("button", { name: /will answer/u });
    fireEvent.click(addressLine);
    const picker = await within(popover).findByRole("group", { name: "Weight" });
    expect([...picker.querySelectorAll("[data-weight-key]")].map((o) => o.textContent)).toEqual([
      "Small and mechanical",
      "Standard",
      "Heavy or judgment-laden",
    ]);
    fireEvent.click(within(popover).getByRole("button", { name: "Heavy or judgment-laden" }));

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Still true?" } });
    const send = document.querySelector("[data-comment-send]");
    if (send === null) throw new Error("no send control");
    fireEvent.click(send);

    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
    expect((transport.of("POST", "/api/threads")[0]?.body as { weight?: string }).weight).toBe(
      "heavy",
    );
  });

  it("closes on Escape and posts nothing", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    selectAndRightClick(await loaded(container), PHRASE, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    const input = await screen.findByLabelText("Comment");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New comment" })).toBeNull();
    });
    expect(transport.of("POST", "/api/threads")).toHaveLength(0);
  });

  it("leaves the whole-turn 💬 anchoring to the turn", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    fireEvent.click(screen.getByRole("button", { name: /Comment on the user turn/ }));
    fireEvent.change(screen.getByLabelText("Comment on this turn"), {
      target: { value: "About all of it." },
    });
    const send = container.querySelector(".child-composer .send");
    if (send === null) throw new Error("no send control");
    fireEvent.click(send);
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
    const sent = transport.of("POST", "/api/threads")[0]?.body as {
      selector: { exact: string };
    };
    // `turnAnchorText`: the turn's first line of prose, unchanged by UI-051.
    expect(sent.selector.exact).toBe("Let's revisit the rate assumption.");
  });

  /**
   * SPEC.md §11's rider, signed 2026-08-05: *"a comment on a turn or on a
   * selection within one"* is in the list of surfaces that take files. Driven
   * through the real popover with a real drop, and asserted on the wire — the
   * multipart parts the fixture records (UI-111).
   */
  it("carries a dropped file onto the child thread's first turn", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    selectAndRightClick(await loaded(container), PHRASE, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    const popover = await screen.findByRole("dialog", { name: "New comment" });

    fireEvent.drop(popover, { dataTransfer: { files: [shot()] } });
    expect(popover.querySelectorAll(".att-chip")).toHaveLength(1);

    // No text at all: §6 allows a first turn that is the file.
    const send = document.querySelector("[data-comment-send]");
    if (send === null) throw new Error("no send control");
    expect(send.hasAttribute("disabled")).toBe(false);
    fireEvent.click(send);

    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
    const call = transport.of("POST", "/api/threads")[0];
    expect(call?.files).toEqual(["shot.png"]);
    expect(call?.parts?.["parent"]).toBe("th_a");
    expect(call?.parts?.["selector"]).toContain(PHRASE);
    expect(call?.parts?.["text"]).toBeUndefined();
  });

  it("gives the file back when the server refuses the comment", async () => {
    const transport = wire({ failing: { "POST /api/threads": 409 } });
    const { container } = render(<Host transport={transport} />);
    selectAndRightClick(await loaded(container), PHRASE, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    const popover = await screen.findByRole("dialog", { name: "New comment" });

    fireEvent.drop(popover, { dataTransfer: { files: [shot()] } });
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Look at this." } });
    const send = document.querySelector("[data-comment-send]");
    if (send === null) throw new Error("no send control");
    fireEvent.click(send);

    // It closes on send, as it always has, and comes back holding both halves
    // of what was refused rather than nothing.
    const reopened = await screen.findByRole("dialog", { name: "New comment" });
    await waitFor(() => {
      expect(reopened.querySelectorAll(".att-chip")).toHaveLength(1);
    });
    expect(screen.getByLabelText<HTMLTextAreaElement>("Comment").value).toBe("Look at this.");
    expect(reopened.querySelector(".att-chip")?.textContent).toContain("shot.png");
  });

  /** The other surface the rider names: the whole-turn 💬 box (UI-111). */
  it("attaches a file to a comment on the whole turn", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    fireEvent.click(screen.getByRole("button", { name: /Comment on the user turn/ }));
    const composer = container.querySelector<HTMLElement>(".child-composer");
    if (composer === null) throw new Error("no child composer");

    fireEvent.dragEnter(composer);
    expect(composer.className).toContain("dropping");
    fireEvent.drop(composer, { dataTransfer: { files: [shot()] } });
    expect(composer.querySelectorAll(".att-chip")).toHaveLength(1);

    const send = composer.querySelector(".send");
    if (send === null) throw new Error("no send control");
    expect(send.hasAttribute("disabled")).toBe(false);
    fireEvent.click(send);

    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
    const call = transport.of("POST", "/api/threads")[0];
    expect(call?.files).toEqual(["shot.png"]);
    expect(call?.parts?.["requestsAgent"]).toBe("false");
    // Accepted, so the box closes — the chips go with it rather than lingering
    // over a comment that has already been made.
    await waitFor(() => {
      expect(container.querySelector(".child-composer")).toBeNull();
    });
  });

  it("declines when the right-click lands outside any turn body", async () => {
    const { container } = render(<Host transport={wire()} />);
    await loaded(container);
    const head = container.querySelector(".t-head");
    if (head === null) throw new Error("no head");
    fireEvent.contextMenu(head, { clientX: 5, clientY: 5 });
    expect(screen.queryByRole("menuitem", { name: /Comment on selection/ })).toBeNull();
  });
});

describe("the anchor's highlight", () => {
  it("paints the words the server resolved the anchor to", async () => {
    const at = THREAD_BODY.indexOf(PHRASE, THREAD_BODY.indexOf(PHRASE) + 1);
    const transport = wire({
      docs: [
        threadDoc({
          anchors: [
            {
              anchorId: "a_1",
              selector: { exact: PHRASE, prefix: "I said ", suffix: " because" },
              threadId: "th_child",
              threadStatus: "open",
              range: { start: at, end: at + PHRASE.length },
              orphaned: false,
            },
          ],
        }),
      ],
      rows: { [threadsSearch("th_a")]: [] },
    });
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    await waitFor(() => {
      expect(anchorHighlightCount()).toBe(1);
    });
  });

  /**
   * UI-112, in a turn: SPEC.md §11 says a selection commented on inside a turn
   * "is highlighted in the turn the way an anchor is highlighted in a document",
   * and until now it was highlighted only once the server had resolved it — after
   * the comment was posted, which is the moment it stops being useful. The
   * browser's own selection is gone as soon as focus reaches the composer, so
   * while writing there was nothing marking the words at all.
   */
  it("lights the selection the moment the composer opens, before anything is posted", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    selectAndRightClick(await loaded(container), PHRASE, 1);
    expect(anchorHighlightCount()).toBe(0);

    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    await screen.findByRole("dialog", { name: "New comment" });
    expect(anchorHighlightCount()).toBe(1);
    expect(transport.of("POST", "/api/threads")).toHaveLength(0);

    // Nothing about the browser's selection is what holds it: the composer has
    // the focus, and the mark is painted from the offsets that were captured.
    globalThis.getSelection?.()?.removeAllRanges();
    expect(anchorHighlightCount()).toBe(1);
  });

  it("keeps it lit across the send, and puts it out when the comment is abandoned", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    selectAndRightClick(await loaded(container), PHRASE, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    const input = await screen.findByLabelText("Comment");
    expect(anchorHighlightCount()).toBe(1);

    // Abandoned: the mark goes with the composer, leaving nothing behind.
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New comment" })).toBeNull();
    });
    expect(anchorHighlightCount()).toBe(0);

    // Sent: the mark stays up, and is still up while the request is in flight.
    selectAndRightClick(container.querySelector(".turn-markdown") as Element, PHRASE, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    fireEvent.change(await screen.findByLabelText("Comment"), { target: { value: "Still true?" } });
    const send = document.querySelector("[data-comment-send]");
    if (send === null) throw new Error("no send control");
    fireEvent.click(send);
    expect(anchorHighlightCount()).toBe(1);
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
  });

  it("paints nothing for an orphaned anchor", async () => {
    const transport = wire({
      docs: [
        threadDoc({
          anchors: [
            {
              anchorId: "a_1",
              selector: { exact: "words that are gone", prefix: "", suffix: "" },
              threadId: "th_child",
              threadStatus: "open",
              range: null,
              orphaned: true,
            },
          ],
        }),
      ],
    });
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    expect(anchorHighlightCount()).toBe(0);
  });
});
