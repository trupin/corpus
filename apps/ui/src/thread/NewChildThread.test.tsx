/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readerTransport, type ReaderTransport } from "../testing/readerFixture";
import { CHILD_HINT, NewChildThread } from "./NewChildThread";

afterEach(cleanup);

function Host({
  transport,
  onDone,
  onCancel,
}: {
  readonly transport: ReaderTransport;
  readonly onDone?: () => void;
  readonly onCancel?: () => void;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <NewChildThread
        parentThreadId="th_a"
        anchorText="the line the comment hangs off"
        onDone={onDone ?? (() => undefined)}
        onCancel={onCancel ?? (() => undefined)}
        onNotify={() => undefined}
      />
    </harness.Wrapper>
  );
}

const field = (): HTMLTextAreaElement =>
  screen.getByLabelText<HTMLTextAreaElement>("Comment on this turn");

const posts = (transport: ReaderTransport): unknown[] =>
  transport.calls.filter((call) => call.method === "POST");

/**
 * A macrotask. Every "and nothing was posted" assertion below has to wait for
 * one: `create.mutate` reaches the transport through a microtask chain, so an
 * immediate assertion would pass even against the code that *does* post — which
 * is exactly how the IME defect survived having siblings that guard against it.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

describe("commenting on a turn", () => {
  it("creates a child thread on ⌘↵, anchored to the turn", async () => {
    const transport = readerTransport({});
    const onDone = vi.fn();
    render(<Host transport={transport} onDone={onDone} />);

    fireEvent.change(field(), { target: { value: "Where does this come from?" } });
    fireEvent.keyDown(field(), { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
    expect(transport.of("POST", "/api/threads")[0]?.body).toEqual({
      parent: "th_a",
      selector: { exact: "the line the comment hangs off" },
      body: "Where does this come from?",
      requestsAgent: false,
    });
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * SPEC.md §11's contract, and the reason the box is a textarea: it used to be
   * an `<input>`, where `↵` could not have inserted a newline even if it were
   * bound to.
   */
  it("takes a newline on ↵ instead of commenting", async () => {
    const transport = readerTransport({});
    render(<Host transport={transport} />);
    fireEvent.change(field(), { target: { value: "first line" } });

    expect(fireEvent.keyDown(field(), { key: "Enter" })).toBe(true);
    await settle();
    expect(posts(transport)).toEqual([]);

    fireEvent.change(field(), { target: { value: "first line\nsecond line" } });
    expect(field().value).toBe("first line\nsecond line");
    expect(field().tagName).toBe("TEXTAREA");
  });

  it("grows with the comment being written", () => {
    const { container } = render(<Host transport={readerTransport({})} />);
    const wrap = container.querySelector<HTMLElement>(".composer-grow");
    fireEvent.change(field(), { target: { value: "one\ntwo" } });
    expect(wrap?.dataset["replicatedValue"]).toBe("one\ntwo");
  });

  /**
   * **The UI-052 regression.** This composer sent on any `Enter`, with neither a
   * `shiftKey` nor an `isComposing` guard — so the keystroke that *commits an
   * IME composition* posted the comment mid-word, with whatever had been typed
   * so far. Every sibling composer already had the guard; this one was written
   * without it. The contract carries it now.
   */
  it("never comments on an IME composition commit", async () => {
    const transport = readerTransport({});
    render(<Host transport={transport} />);
    fireEvent.change(field(), { target: { value: "にほん" } });

    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(field(), { key: "Enter", metaKey: true, isComposing: true });

    await settle();
    expect(posts(transport)).toEqual([]);
  });

  it("cancels on esc without commenting, and keeps the press off the card", async () => {
    const transport = readerTransport({});
    const onCancel = vi.fn();
    render(<Host transport={transport} onCancel={onCancel} />);
    fireEvent.change(field(), { target: { value: "never mind" } });

    expect(fireEvent.keyDown(field(), { key: "Escape" })).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await settle();
    expect(posts(transport)).toEqual([]);
  });

  it("names its key on the button, and refuses an empty comment", () => {
    render(<Host transport={readerTransport({})} />);
    const send = screen.getByRole("button", { name: /Comment/u });
    expect(send.textContent).toBe("Comment ⌘↵");
    expect(send.hasAttribute("disabled")).toBe(true);
  });

  /**
   * SHARED-057 clause 2, for the one sentence that says what this box makes.
   * It shares `.composer-hint` with the reply composer, so it shares that
   * foot's decision to truncate the hint when the room runs out — and a
   * truncation has to reveal.
   */
  it("hands the whole hint back on a title", () => {
    const { container } = render(<Host transport={readerTransport({})} />);
    const hint = container.querySelector(".composer-hint");
    expect(hint?.textContent).toBe(CHILD_HINT);
    expect(hint?.getAttribute("title")).toBe(CHILD_HINT);
  });
});
