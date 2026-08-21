/** @vitest-environment jsdom */
import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readerTransport,
  threadFixture,
  threadRowFixture,
  type ReaderTransport,
} from "../testing/readerFixture";
import { ThreadCollapseProvider } from "../thread/ThreadCollapseContext";
import { CommentsTab } from "./CommentsTab";
import { ALL_COMMENTS, type CommentFilters } from "./commentsModel";

/**
 * The Comments tab as a surface (SPEC.md §11's rider, signed 2026-08-04).
 *
 * The model's own arithmetic is pinned in `commentsModel.test.ts`; what is here
 * is what only a mounted tab can answer — that a row reaches the reveal seam,
 * that an orphan is offered a way back, that a conversation is repliable where
 * it stands, and that the composer starts a **new** thread with no selector
 * rather than joining the one above it.
 */

afterEach(cleanup);

const ANCHORED_ROW = threadRowFixture({
  id: "th_anchored",
  parent: "doc_m",
  status: "open",
  anchorQuote: "lender spreads",
});

const ORPHAN_ROW = threadRowFixture({
  id: "th_orphan",
  parent: "doc_m",
  status: "open",
  anchorQuote: "a phrase since deleted",
});

const WHOLE_ROW = threadRowFixture({
  id: "th_whole",
  parent: "doc_m",
  status: "resolved",
  anchorQuote: null,
});

const ANCHORS: readonly ResolvedAnchor[] = [
  {
    anchorId: "anc_live",
    threadId: "th_anchored",
    selector: { exact: "lender spreads", prefix: "", suffix: "" },
    threadStatus: "open",
    range: { start: 0, end: 14 },
    orphaned: false,
  },
  {
    anchorId: "anc_gone",
    threadId: "th_orphan",
    selector: { exact: "a phrase since deleted", prefix: "", suffix: "" },
    threadStatus: "open",
    range: null,
    orphaned: true,
  },
];

const BODY = "lender spreads are wide this week.";

function wire(): ReaderTransport {
  return readerTransport({
    threads: [
      threadFixture({
        id: "th_anchored",
        parent: "doc_m",
        turns: [
          { author: "user", ts: "2026-07-01T09:00:00.000Z", body: "Which lenders?", model: null },
        ],
      }),
      threadFixture({
        id: "th_orphan",
        parent: "doc_m",
        turns: [
          { author: "user", ts: "2026-07-01T09:01:00.000Z", body: "Still true?", model: null },
        ],
      }),
      threadFixture({
        id: "th_whole",
        parent: "doc_m",
        status: "resolved",
        turns: [
          { author: "user", ts: "2026-07-01T09:02:00.000Z", body: "Nice memo.", model: null },
        ],
      }),
    ],
  });
}

interface HostProps {
  readonly transport?: ReaderTransport;
  readonly threads?: readonly DocRow[];
  readonly anchors?: readonly ResolvedAnchor[];
  readonly onReveal?: (threadId: string) => void;
}

function Host({ transport, threads, anchors, onReveal }: HostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: (transport ?? wire()).fetch }));
  const [filters, setFilters] = useState<CommentFilters>(ALL_COMMENTS);
  return (
    <harness.Wrapper>
      <ThreadCollapseProvider surfaceKey="test-surface">
        <CommentsTab
          docId="doc_m"
          threads={threads ?? [ANCHORED_ROW, ORPHAN_ROW, WHOLE_ROW]}
          anchors={anchors ?? ANCHORS}
          body={BODY}
          filters={filters}
          onFilters={setFilters}
          flashThread={null}
          onReveal={onReveal ?? (() => undefined)}
          onOpenDoc={() => undefined}
          onNotify={() => undefined}
        />
      </ThreadCollapseProvider>
    </harness.Wrapper>
  );
}

const rowIds = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("[data-comment-row]")].map(
    (node) => node.getAttribute("data-comment-row") ?? "",
  );

function choose(container: HTMLElement, filter: string): void {
  const input = container.querySelector<HTMLInputElement>(`[data-filter="${filter}"] input`);
  if (input === null) throw new Error(`no filter ${filter}`);
  fireEvent.click(input);
}

describe("the comments list", () => {
  it("holds every thread on the document, anchored or not", () => {
    const { container } = render(<Host />);
    expect(rowIds(container)).toEqual(["th_anchored", "th_orphan", "th_whole"]);
  });

  it("says why each unanchored row has no anchor, and tells the two reasons apart", () => {
    const { container } = render(<Host />);
    const why = (id: string): string =>
      container.querySelector(`[data-comment-row="${id}"] .cm-why-text`)?.textContent ?? "";
    expect(why("th_anchored")).toBe("anchored to “lender spreads”");
    expect(why("th_orphan")).toBe(
      "detached — the document no longer contains “a phrase since deleted”",
    );
    expect(why("th_whole")).toBe("about the whole document — it never had an anchor");
  });

  it("filters on the two axes independently", () => {
    const { container } = render(<Host />);
    choose(container, "status:open");
    expect(rowIds(container)).toEqual(["th_anchored", "th_orphan"]);
    choose(container, "anchor:unanchored");
    expect(rowIds(container)).toEqual(["th_orphan"]);
    choose(container, "status:all");
    expect(rowIds(container)).toEqual(["th_orphan", "th_whole"]);
  });

  it("names the filter that emptied the list rather than going blank", () => {
    const { container } = render(<Host />);
    choose(container, "status:resolved");
    choose(container, "anchor:anchored");
    expect(rowIds(container)).toEqual([]);
    expect(container.querySelector(".cm-empty")?.textContent).toBe(
      "No resolved, anchored comments. 3 comments are hidden by these filters.",
    );
  });

  it("says so when the document has no comments at all", () => {
    const { container } = render(<Host threads={[]} anchors={[]} />);
    expect(container.querySelector(".cm-empty")?.textContent).toBe(
      "No comments on this document yet. Write the first one below — no text selection needed.",
    );
    // …and the composer is still there, which is what that sentence points at.
    expect(container.querySelector("[data-new-comment]")).not.toBeNull();
  });

  /**
   * Counts are over the whole list, so moving one axis never renumbers the
   * other — SHARED-057's rule is about width, and this is the reading half of
   * it: a number that changed under the pointer would be answering a different
   * question from the one its label asks.
   */
  it("keeps each axis's counts steady while the other axis moves", () => {
    const { container } = render(<Host />);
    const count = (filter: string): string =>
      container.querySelector(`[data-filter="${filter}"] .cm-count`)?.textContent ?? "";
    expect(count("anchor:anchored")).toBe("1");
    expect(count("anchor:unanchored")).toBe("2");
    choose(container, "status:resolved");
    expect(count("anchor:anchored")).toBe("1");
    expect(count("anchor:unanchored")).toBe("2");
  });
});

describe("what a row leads to", () => {
  it("offers the reveal on an anchored row only", () => {
    const { container } = render(<Host />);
    expect(
      container.querySelector('[data-comment-row="th_anchored"] [data-reveal-thread]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-comment-row="th_orphan"] [data-reveal-thread]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-comment-row="th_whole"] [data-reveal-thread]'),
    ).toBeNull();
  });

  it("hands the reveal to the host, which is what leaves this list for the body", () => {
    const onReveal = vi.fn();
    const { container } = render(<Host onReveal={onReveal} />);
    fireEvent.click(container.querySelector("[data-reveal-thread]") as HTMLElement);
    expect(onReveal).toHaveBeenCalledWith("th_anchored");
  });

  it("offers a detached row its way back, and offers it to nobody else", () => {
    const { container } = render(<Host />);
    const offer = (id: string): Element | null =>
      container.querySelector(`[data-comment-row="${id}"] [data-reattach]`);
    expect(offer("th_orphan")).not.toBeNull();
    expect(offer("th_anchored")).toBeNull();
    expect(offer("th_whole")).toBeNull();
  });

  it("renders each row as the same conversation panel every other placement uses", () => {
    const { container } = render(<Host />);
    expect(
      container.querySelector('[data-comment-row="th_anchored"] [data-thread-panel="th_anchored"]'),
    ).not.toBeNull();
  });

  /**
   * SPEC.md §11: "every thread in the list can be replied to in place". It is
   * the panel's own reply box rather than a second one — the assertion is that
   * the list reaches it, and that a reply goes to *that* thread.
   */
  it("replies in place, on the thread the row is about", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    const composer = await waitFor(() => {
      const field = container.querySelector<HTMLTextAreaElement>(
        '[data-comment-row="th_anchored"] [data-composer="th_anchored"]',
      );
      expect(field).not.toBeNull();
      return field as HTMLTextAreaElement;
    });
    fireEvent.change(composer, { target: { value: "Three of them." } });
    fireEvent.keyDown(composer, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_anchored/turns")).toHaveLength(1);
    });
    // …and nothing was created: a reply is a turn, not a child thread.
    expect(transport.of("POST", "/api/threads")).toHaveLength(0);
  });
});

describe("the composer at the foot", () => {
  it("starts a NEW thread with no selector, whatever is already listed", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    const field = container.querySelector<HTMLTextAreaElement>("[data-new-comment] textarea");
    if (field === null) throw new Error("no composer");
    fireEvent.change(field, { target: { value: "A remark about the whole thing." } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
    const body = transport.of("POST", "/api/threads")[0]?.body as Record<string, unknown>;
    expect(body["parent"]).toBe("doc_m");
    expect(body["selector"]).toBeNull();
    expect(body["body"]).toBe("A remark about the whole thing.");
  });

  it("starts a second thread rather than joining the first", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    const field = container.querySelector<HTMLTextAreaElement>("[data-new-comment] textarea");
    if (field === null) throw new Error("no composer");

    fireEvent.change(field, { target: { value: "First remark." } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });

    fireEvent.change(field, { target: { value: "Second, unrelated remark." } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(2);
    });
    // Two creations, no turn appended to the first: topics stay separately
    // resolvable (SPEC.md §11, rider signed 2026-08-04).
    expect(transport.of("POST").filter((call) => call.path.endsWith("/turns"))).toHaveLength(0);
  });

  /**
   * The signed key contract (SPEC.md §11, SHARED-009 Amendment 1): `↵` is a
   * newline, `⌘↵` sends. It comes from the kit's `handleComposerKeyDown`, and
   * this is what would catch a sixth composer hand-rolling it.
   */
  it("takes a newline on plain ↵ and sends on ⌘↵", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    const field = container.querySelector<HTMLTextAreaElement>("[data-new-comment] textarea");
    if (field === null) throw new Error("no composer");
    fireEvent.change(field, { target: { value: "One line." } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(transport.of("POST", "/api/threads")).toHaveLength(0);

    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
  });

  it("carries the ask-agent toggle, and sends an explicit false for a note", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    const field = container.querySelector<HTMLTextAreaElement>("[data-new-comment] textarea");
    const toggle = container.querySelector<HTMLButtonElement>("[data-new-comment] .toggle");
    if (field === null || toggle === null) throw new Error("no composer");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.change(field, { target: { value: "Just a note." } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
    const body = transport.of("POST", "/api/threads")[0]?.body as Record<string, unknown>;
    expect(body["requestsAgent"]).toBe(false);
  });
});
