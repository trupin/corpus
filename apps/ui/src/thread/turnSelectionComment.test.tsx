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
    // share this conversation's standing choice.
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
