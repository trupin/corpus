/** @vitest-environment jsdom */
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavEntry } from "../board/useBoardLocalState";
import {
  backlinksSearch,
  docFixture,
  readerTransport,
  threadFixture,
  threadRowFixture,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture";
import { Reader } from "./Reader";
import { resetEscapeLayers } from "./useEscapeStack";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetSeenMarks();
  // The reveal flash is drawn outside the reader's subtree (UI-037), so RTL's
  // own teardown cannot see it.
  for (const layer of document.querySelectorAll("[data-reveal-flash]")) layer.remove();
});

const MORTGAGE = docFixture({
  frontmatter: { id: "doc_m", title: "Mortgage options", tags: ["finance"] },
  body: "Compare against [[doc_r]] and [[doc_missing]].",
});

const RATES = docFixture({
  frontmatter: { id: "doc_r", title: "Rates" },
  body: "6.4% this week.",
  path: "data/docs/finance/rates.md",
});

const THREAD_DOC = docFixture({
  frontmatter: { id: "th_rate", type: "thread", title: "Rate assumption", status: "open" },
  path: "data/threads/th_rate.md",
  body: "## user · 2026-07-01\n\nis 6.1% right?",
});

interface HostProps {
  readonly wire: ReaderTransport;
  readonly initial?: readonly NavEntry[];
  readonly isActive?: boolean;
  readonly onFocusMode?: (docId: string) => void;
  readonly onNav?: (nav: readonly NavEntry[]) => void;
}

/** A column, reduced to the state it actually owns: the navigation stack. */
function Host({ wire, initial, isActive, onFocusMode, onNav }: HostProps): ReactElement {
  const [nav, setNav] = useState<readonly NavEntry[]>(initial ?? [{ docId: "doc_m", scrollY: 0 }]);
  // Built once: a harness rebuilt per render would be a new component type
  // every time, remounting the whole reader and quietly making every
  // scroll-restoration assertion below vacuous.
  const [harness] = useState(() => createCorpusTestHarness({ fetch: wire.fetch }));
  return (
    <harness.Wrapper>
      <div className={nav.length === 0 ? "col" : "col reading"}>
        <Reader
          columnId="doc_col"
          columnTitle="Finance"
          nav={nav}
          setNav={(next) => {
            setNav(next);
            onNav?.(next);
          }}
          selectTitle={false}
          isActive={isActive ?? true}
          onFocusMode={onFocusMode ?? (() => undefined)}
          onNotify={() => undefined}
        />
      </div>
    </harness.Wrapper>
  );
}

type FullWireOptions = Partial<Parameters<typeof readerTransport>[0]> & {
  /** Resolves `th_rate`, which is what makes it collapse by rule (SPEC.md §11). */
  readonly resolvedThread?: boolean;
};

function fullWire({ resolvedThread = false, ...overrides }: FullWireOptions = {}): ReaderTransport {
  const status = resolvedThread ? "resolved" : "open";
  return readerTransport({
    docs: [MORTGAGE, RATES, THREAD_DOC],
    threads: [
      threadFixture({
        id: "th_rate",
        parent: "doc_m",
        status,
        // A thread always has at least one turn — it is created with its first
        // one — and the seen mark is keyed on the last turn, so a turnless
        // fixture would be testing a state the server cannot produce.
        turns: [
          { author: "user", ts: "2026-07-01T10:05:00.000Z", body: "is 6.1% right?", model: null },
        ],
      }),
    ],
    rows: {
      [threadsSearch("doc_m")]: [
        threadRowFixture({
          id: "th_rate",
          parent: "doc_m",
          status,
          anchorQuote: "assume a 30-year fixed at 6.1%",
        }),
      ],
      [backlinksSearch("doc_r")]: [docFixtureRow()],
    },
    ...overrides,
  });
}

function docFixtureRow() {
  return threadRowFixture({
    id: "doc_m",
    type: "note",
    title: "Mortgage options",
    turnCount: null,
    lastAuthor: null,
    lastTurn: null,
    unread: null,
  });
}

/** The title is an input (it is editable), so it is read by value, not by text. */
function titleOf(container: HTMLElement): string {
  return container.querySelector<HTMLTextAreaElement>(".doc-title")?.value ?? "";
}

async function showsTitle(container: HTMLElement, text: string): Promise<void> {
  await waitFor(() => {
    expect(titleOf(container)).toBe(text);
  });
}

async function showsDoc(container: HTMLElement, docId: string): Promise<void> {
  await waitFor(() => {
    expect(container.querySelector("[data-reader-doc]")?.getAttribute("data-reader-doc")).toBe(
      docId,
    );
  });
}

describe("Reader", () => {
  it("renders the prototype's head, in order", async () => {
    const { container } = render(<Host wire={fullWire()} />);
    await showsTitle(container, "Mortgage options");

    const head = container.querySelector(".reader-head");
    expect(head?.querySelector(".back")?.textContent).toBe("‹ Finance");
    expect(head?.querySelector(".reader-id")?.textContent).toBe("doc_m · git ✓");
    // Present and empty: UI-006's slot.
    expect(head?.querySelector(".save-chip")?.textContent).toBe("");
    await waitFor(() => {
      expect(head?.querySelector(".comments-btn")?.textContent).toBe("💬 1");
    });
    expect(head?.querySelector("[data-doc-menu]")?.className).toBe("expand");
    expect(head?.querySelector("[data-expand]")?.className).toBe("expand");
  });

  it("hides 💬 entirely for a document with no threads", async () => {
    const wire = readerTransport({ docs: [MORTGAGE] });
    const { container } = render(<Host wire={wire} />);
    await showsTitle(container, "Mortgage options");
    await waitFor(() => {
      expect(container.querySelector(".doc-body")).not.toBeNull();
    });
    expect(container.querySelector(".comments-btn")).toBeNull();
  });

  it("renders a ref as the target's current title and follows it in place", async () => {
    const wire = fullWire();
    const { container } = render(<Host wire={wire} />);
    const link = await screen.findByText("Rates");
    expect(link.className).toBe("ref");

    fireEvent.click(link);
    await showsDoc(container, "doc_r");
    // The back button now names where Back actually goes.
    await waitFor(() => {
      expect(container.querySelector(".back")?.textContent).toBe("‹ Mortgage options");
    });
  });

  it("renders an unresolved ref broken and inert", async () => {
    const { container } = render(<Host wire={fullWire()} />);
    await waitFor(() => {
      expect(container.querySelector(".ref-broken")).not.toBeNull();
    });
    const broken = container.querySelector(".ref-broken");
    expect(broken?.tagName).toBe("SPAN");
    expect(broken?.textContent).toBe("doc_missing");
  });

  it("restores the exact scroll offset when Back pops", async () => {
    const wire = fullWire();
    const { container } = render(<Host wire={wire} />);
    await screen.findByText("Rates");

    const scroller = container.querySelector(".reader-scroll") as HTMLElement;
    // jsdom has no layout, so the offset is set directly — which is exactly
    // what the surface reads on navigation.
    scroller.scrollTop = 420;
    fireEvent.click(screen.getByText("Rates"));

    await showsTitle(container, "Rates");
    expect(scroller.scrollTop).toBe(0);

    fireEvent.click(container.querySelector(".back") as HTMLElement);
    await showsTitle(container, "Mortgage options");
    // The exact prior offset, not "roughly".
    expect(scroller.scrollTop).toBe(420);
  });

  it("does not re-restore when the body's height changes later", async () => {
    const wire = fullWire();
    const { container } = render(<Host wire={wire} />);
    await showsTitle(container, "Mortgage options");
    const scroller = container.querySelector(".reader-scroll") as HTMLElement;

    scroller.scrollTop = 300;
    // Backlinks and threads resolve after the first paint; the surface must not
    // yank the reader back to the restore offset when they do.
    await waitFor(() => {
      expect(container.querySelector("[data-thread-panel]")).not.toBeNull();
    });
    expect(scroller.scrollTop).toBe(300);
  });

  it("returns to the list when the last entry is popped", async () => {
    const { container } = render(<Host wire={fullWire()} />);
    await showsTitle(container, "Mortgage options");
    fireEvent.click(container.querySelector(".back") as HTMLElement);
    await waitFor(() => {
      expect(container.querySelector(".reader")).toBeNull();
    });
  });

  it("empties a deep stack in one act when Back is shift-clicked", async () => {
    const stacks: (readonly NavEntry[])[] = [];
    const { container } = render(
      <Host
        wire={fullWire()}
        initial={[
          { docId: "doc_r", scrollY: 0 },
          { docId: "doc_m", scrollY: 0 },
        ]}
        onNav={(next) => stacks.push(next)}
      />,
    );
    await showsTitle(container, "Mortgage options");

    fireEvent.click(container.querySelector(".back") as HTMLElement, { shiftKey: true });
    await waitFor(() => {
      expect(container.querySelector(".reader")).toBeNull();
    });
    // One state change, so no intermediate document ever rendered.
    expect(stacks).toEqual([[]]);
  });

  it("documents the shift-click shortcut on the button itself", async () => {
    const { container } = render(
      <Host
        wire={fullWire()}
        initial={[
          { docId: "doc_r", scrollY: 0 },
          { docId: "doc_m", scrollY: 0 },
        ]}
      />,
    );
    await showsTitle(container, "Mortgage options");
    expect(container.querySelector(".back")?.getAttribute("title")).toBe(
      "Back (shift-click, or ⇧esc: straight to list)",
    );
  });

  it("pops on Escape only while its column is the active one", async () => {
    const { container, rerender } = render(<Host wire={fullWire()} isActive={false} />);
    await showsTitle(container, "Mortgage options");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".reader")).not.toBeNull();

    rerender(<Host wire={fullWire()} isActive />);
    await showsTitle(container, "Mortgage options");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(container.querySelector(".reader")).toBeNull();
    });
  });

  it("empties the stack on ⇧esc, the keyboard form of shift-clicking Back", async () => {
    const { container } = render(
      <Host
        wire={fullWire()}
        initial={[
          { docId: "doc_r", scrollY: 0 },
          { docId: "doc_m", scrollY: 0 },
        ]}
      />,
    );
    await showsTitle(container, "Mortgage options");

    fireEvent.keyDown(document, { key: "Escape", shiftKey: true });
    await waitFor(() => {
      expect(container.querySelector(".reader")).toBeNull();
    });
  });

  it("leaves Escape to the title field while a draft is unsaved", async () => {
    const { container } = render(<Host wire={fullWire()} />);
    await showsTitle(container, "Mortgage options");

    const title = container.querySelector(".doc-title") as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: "Half a thought" } });
    fireEvent.keyDown(title, { key: "Escape" });

    // The draft reverted; the reader did not close underneath the user.
    expect(container.querySelector(".reader")).not.toBeNull();
    expect(titleOf(container)).toBe("Mortgage options");
  });

  it("lists backlinks from the references filter, and pushes when one is followed", async () => {
    const wire = fullWire();
    const { container } = render(<Host wire={wire} initial={[{ docId: "doc_r", scrollY: 0 }]} />);
    await showsTitle(container, "Rates");

    const backlink = await screen.findByText("Mortgage options");
    expect(backlink.getAttribute("data-backlink")).toBe("doc_m");
    expect(container.querySelector(".backlinks h3")?.textContent).toBe("Referenced by");
    expect(container.querySelector(".backlink .type-glyph")?.textContent).toBe("note");
    // One request for the whole panel, not one per candidate.
    expect(wire.calls.filter((call) => call.search === backlinksSearch("doc_r"))).toHaveLength(1);

    fireEvent.click(backlink);
    await showsDoc(container, "doc_m");
  });

  /**
   * UI-037. The reveal is an instruction the open carries, honoured once the
   * document is on screen and then **gone from the entry** — which is what
   * makes Back a restoration rather than a second flash.
   */
  describe("a reveal on the entry", () => {
    function flashes(): number {
      return document.querySelectorAll("[data-reveal-flash]").length;
    }

    it("flashes the item it names, and clears the instruction", async () => {
      const stacks: (readonly NavEntry[])[] = [];
      const { container } = render(
        <Host
          wire={fullWire()}
          initial={[
            { docId: "doc_m", scrollY: 0, reveal: { kind: "item", exact: "Compare against" } },
          ]}
          onNav={(next) => stacks.push(next)}
        />,
      );
      await showsTitle(container, "Mortgage options");
      await waitFor(() => {
        expect(flashes()).toBe(1);
      });
      // The flash traces the rendered text, so it is outside the reader's own
      // subtree: nothing was added to a DOM ProseMirror believes it owns.
      expect(container.querySelector("[data-reveal-flash]")).toBeNull();
      await waitFor(() => {
        expect(stacks.at(-1)?.at(-1)).toEqual({ docId: "doc_m", scrollY: 0 });
      });
    });

    /**
     * The regression that shipped with the first cut of UI-037.
     *
     * Revealing scrolls the reader, and the scroll capture that follows is
     * debounced — so it wrote its entry from a snapshot taken *before* the
     * reveal was consumed, putting the instruction back. The entry then carried
     * it in `localStorage` for good, re-flashing the document on every later
     * load. What is pinned here is the end state: a scroll after a reveal
     * persists an offset and nothing else.
     */
    it("keeps the entry clean when the reveal's own scroll is captured", async () => {
      const stacks: (readonly NavEntry[])[] = [];
      const { container } = render(
        <Host
          wire={fullWire()}
          initial={[
            { docId: "doc_m", scrollY: 0, reveal: { kind: "item", exact: "Compare against" } },
          ]}
          onNav={(next) => stacks.push(next)}
        />,
      );
      await waitFor(() => {
        expect(flashes()).toBe(1);
      });

      const scroller = container.querySelector(".reader-scroll") as HTMLElement;
      scroller.scrollTop = 512;
      fireEvent.scroll(scroller);

      await waitFor(() => {
        expect(stacks.at(-1)?.at(-1)).toEqual({ docId: "doc_m", scrollY: 512 });
      });
      // Spelled as keys too: an entry with `reveal: undefined` on it would
      // serialise into storage and read back as a pending instruction.
      expect(Object.keys(stacks.at(-1)?.at(-1) ?? {})).toEqual(["docId", "scrollY"]);
    });

    it("does not flash again when Back returns to the same entry", async () => {
      const { container } = render(
        <Host
          wire={fullWire()}
          initial={[
            { docId: "doc_m", scrollY: 0, reveal: { kind: "item", exact: "Compare against" } },
          ]}
        />,
      );
      await waitFor(() => {
        expect(flashes()).toBe(1);
      });
      for (const layer of document.querySelectorAll("[data-reveal-flash]")) layer.remove();

      fireEvent.click(await screen.findByText("Rates"));
      await showsDoc(container, "doc_r");
      fireEvent.click(container.querySelector(".back") as HTMLElement);
      await showsTitle(container, "Mortgage options");

      // The restoration ran; the reveal did not.
      expect(flashes()).toBe(0);
    });

    it("delegates a thread reveal to the 💬 jump, in the same act as the open", async () => {
      const { container } = render(
        <Host
          wire={fullWire()}
          initial={[
            { docId: "doc_m", scrollY: 0, reveal: { kind: "thread", threadId: "th_rate" } },
          ]}
        />,
      );
      await waitFor(() => {
        expect(container.querySelector(".thread-slot.expanded")).not.toBeNull();
      });
      expect(container.querySelector(".thread-card.flash")).not.toBeNull();
      // One mechanism: a thread reveal draws no box of its own.
      expect(flashes()).toBe(0);
    });

    /**
     * UI-095. The reveal above was only ever reachable from the 💬 popover,
     * because the **thread-context link** — "on «Parent» · at «quote»" — handed
     * its host an `anchorId` that every wiring of `onOpenDoc` dropped on the
     * floor. So the link that promises to take you to a passage opened the
     * parent at the top of the document, however far down the passage was.
     *
     * What is pinned is the whole path in one act: the entry the follow pushes
     * carries the instruction, and the arriving reader has the conversation
     * expanded and flashing rather than merely present.
     */
    it("follows a thread's context link to the conversation, not to the top", async () => {
      const stacks: (readonly NavEntry[])[] = [];
      const { container } = render(
        <Host
          wire={fullWire()}
          initial={[{ docId: "th_rate", scrollY: 0 }]}
          onNav={(next) => stacks.push(next)}
        />,
      );
      await waitFor(() => {
        expect(container.querySelector(".t-context .ref")).not.toBeNull();
      });

      fireEvent.click(container.querySelector(".t-context .ref") as HTMLElement);

      await showsDoc(container, "doc_m");
      // The push itself — read from the history rather than from the live
      // stack, because the reader honours the instruction and takes it off the
      // entry, which is UI-037's one-shot rule and not this issue's business.
      expect(stacks[0]).toEqual([
        { docId: "th_rate", scrollY: 0 },
        { docId: "doc_m", scrollY: 0, reveal: { kind: "thread", threadId: "th_rate" } },
      ]);
      await waitFor(() => {
        expect(container.querySelector(".thread-slot.expanded")).not.toBeNull();
      });
      expect(container.querySelector(".thread-card.flash")).not.toBeNull();
      // Honoured once: Back onto this entry is an ordinary restoration.
      await waitFor(() => {
        expect(stacks.at(-1)?.at(-1)).toEqual({ docId: "doc_m", scrollY: 0 });
      });
    });

    /**
     * A quote the document no longer contains — edited between the click and
     * the open. Giving up counts as honouring it: a pending instruction left on
     * the entry would fire on the next reload, against a document that has
     * moved on even further.
     */
    it("gives up on text the document does not contain, and still clears it", async () => {
      const stacks: (readonly NavEntry[])[] = [];
      const { container } = render(
        <Host
          wire={fullWire()}
          initial={[
            { docId: "doc_m", scrollY: 0, reveal: { kind: "item", exact: "an item long deleted" } },
          ]}
          onNav={(next) => stacks.push(next)}
        />,
      );
      await showsTitle(container, "Mortgage options");
      await waitFor(() => {
        expect(stacks.at(-1)?.at(-1)).toEqual({ docId: "doc_m", scrollY: 0 });
      });
      expect(flashes()).toBe(0);
    });
  });

  it("expands, scrolls to and flashes the thread the 💬 popover chose", async () => {
    const { container } = render(<Host wire={fullWire()} />);
    await waitFor(() => {
      expect(container.querySelector(".comments-btn")).not.toBeNull();
    });

    fireEvent.click(container.querySelector(".comments-btn") as HTMLElement);
    fireEvent.click(container.querySelector(".cp-item") as HTMLElement);

    await waitFor(() => {
      expect(container.querySelector(".thread-slot.expanded")).not.toBeNull();
    });
    expect(container.querySelector(".thread-card.flash")).not.toBeNull();
  });

  /**
   * SPEC.md §7: displayed content only. Opening a parent marks nothing; opening
   * the thread itself does.
   */
  /**
   * SPEC.md §7's read rule, restated for the collapse UI-077 built.
   *
   * What counts as read is **displayed** content, so the question is no longer
   * "is this a parent document" but "is this conversation folded". A resolved
   * thread is collapsed by the one rule (§11) and its collapsed line displays
   * nothing, so the parent's reader marks nothing seen — and the same thread
   * opened as a document does.
   */
  it("marks a thread document seen, and a collapsed conversation nothing", async () => {
    const parentWire = fullWire({ resolvedThread: true });
    const { container } = render(<Host wire={parentWire} />);
    await showsTitle(container, "Mortgage options");
    // Its collapsed line is on screen, and it has displayed nothing.
    await waitFor(() => {
      expect(container.querySelector("[data-thread-expand]")).not.toBeNull();
    });
    expect(parentWire.of("POST").filter((call) => call.path.endsWith("/seen"))).toHaveLength(0);

    cleanup();
    // The de-duplication record is module state and outlives the unmount, which
    // is the point of it — a second host reading the same thread would not post
    // again. This half of the test is about the *first* read.
    resetSeenMarks();

    const threadWire = fullWire();
    render(<Host wire={threadWire} initial={[{ docId: "th_rate", scrollY: 0 }]} />);
    await waitFor(() => {
      expect(threadWire.of("POST", "/api/threads/th_rate/seen")).toHaveLength(1);
    });
  });

  it("reads a thread document as its conversation", async () => {
    const wire = readerTransport({
      docs: [THREAD_DOC],
      threads: [
        threadFixture({
          id: "th_rate",
          parent: "doc_m",
          turns: [
            {
              author: "user",
              ts: "2026-07-01T10:05:00.000Z",
              body: "is 6.1% right?",
              model: null,
            },
            {
              author: "agent",
              ts: "2026-07-01T10:07:00.000Z",
              body: "6.4% is closer.",
              model: null,
            },
          ],
        }),
      ],
    });
    const { container } = render(<Host wire={wire} initial={[{ docId: "th_rate", scrollY: 0 }]} />);

    await waitFor(() => {
      expect(container.querySelectorAll(".thread-conversation .turn")).toHaveLength(2);
    });
    expect(screen.getByText("is 6.1% right?")).toBeDefined();
    /*
     * The standalone host is the same card, composer included — and it now
     * carries the fold too. SPEC.md §11 lists "a `type: thread` document open in
     * a reader in a column or in full screen" among the places a conversation
     * can be collapsed, and the control used to be absent here because there was
     * no chip to fold back into. There is one now, in every placement.
     */
    expect(container.querySelector(".thread-conversation .composer")).not.toBeNull();
    expect(container.querySelector(".thread-conversation .t-collapse")).not.toBeNull();
  });

  it("degrades honestly when the open document was deleted out of band", async () => {
    const wire = readerTransport({ docs: [] });
    const { container } = render(<Host wire={wire} />);
    await waitFor(() => {
      expect(container.querySelector(".reader-gone")).not.toBeNull();
    });
    expect(screen.getByText("This document no longer exists")).toBeDefined();
    expect(container.querySelector(".back")).not.toBeNull();
  });

  it("says a document is archived rather than pretending it is ordinary", async () => {
    const archived = docFixture({
      frontmatter: { id: "doc_m", title: "Mortgage options", status: "archived" },
    });
    const { container } = render(<Host wire={readerTransport({ docs: [archived] })} />);
    await waitFor(() => {
      expect(container.querySelector(".archived-banner")).not.toBeNull();
    });
  });

  it("drops a restored stack entry naming a deleted document instead of stranding on it", async () => {
    const wire = readerTransport({ docs: [MORTGAGE] });
    const { container } = render(
      <Host
        wire={wire}
        initial={[
          { docId: "doc_m", scrollY: 0 },
          { docId: "doc_gone", scrollY: 0 },
        ]}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("[data-reader-doc]")?.getAttribute("data-reader-doc")).toBe(
        "doc_m",
      );
    });
    expect(container.querySelector(".reader-gone")).toBeNull();
  });

  /**
   * SPEC.md §11, amended by SHARED-041: **the board is never read-only.** There
   * is no banner to raise, no holder to name and no Force unlock, because there
   * is no lock — a document the agent is writing is the same editable surface as
   * any other, and the reader asks nobody's permission to show it that way.
   */
  it("renders no lock banner and never freezes the title", async () => {
    const wire = readerTransport({ docs: [MORTGAGE] });
    const { container } = render(<Host wire={wire} />);
    await showsTitle(container, "Mortgage options");
    expect(container.querySelector(".lock-banner")).toBeNull();
    expect(screen.getByLabelText("Document title")).toHaveProperty("readOnly", false);
    // And nothing on this surface asked the server about locks at all.
    expect(wire.calls.some((call) => call.path.startsWith("/api/locks"))).toBe(false);
  });

  it("hands ⤢ up to the board rather than opening focus itself", async () => {
    const onFocusMode = vi.fn();
    const { container } = render(<Host wire={fullWire()} onFocusMode={onFocusMode} />);
    await showsTitle(container, "Mortgage options");
    fireEvent.click(container.querySelector("[data-expand]") as HTMLElement);
    expect(onFocusMode).toHaveBeenCalledWith("doc_m");
  });
});
