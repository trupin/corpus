/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readerTransport, threadFixture, type ReaderTransport } from "../testing/readerFixture";
import {
  ASK_AGENT_LABEL,
  COMPOSER_PLACEHOLDER,
  NOTE_ONLY_LABEL,
  OPEN_HINT,
  RESOLVED_HINT,
  SEND_LABEL,
  ThreadComposer,
} from "./ThreadComposer";

afterEach(cleanup);

function wire(failing?: Record<string, number>): ReaderTransport {
  return readerTransport({
    threads: [threadFixture({ id: "th_a", turns: [] })],
    ...(failing ? { failing } : {}),
  });
}

function Host({
  transport,
  resolved,
  onNotify,
}: {
  readonly transport: ReaderTransport;
  readonly resolved?: boolean;
  readonly onNotify?: (notice: { tone: string; message: string }) => void;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <ThreadComposer
        threadId="th_a"
        resolved={resolved ?? false}
        onNotify={onNotify ?? (() => undefined)}
      />
    </harness.Wrapper>
  );
}

const input = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>("Reply");
const send = (): HTMLElement => screen.getByText(SEND_LABEL);

describe("ThreadComposer", () => {
  it("is the prototype's, character for character", () => {
    const { container } = render(<Host transport={wire()} />);
    expect(input().placeholder).toBe(COMPOSER_PLACEHOLDER);
    expect(container.querySelector(".clip")?.textContent).toBe("📎");
    expect(container.querySelector(".toggle")?.textContent).toBe(ASK_AGENT_LABEL);
    expect(container.querySelector(".toggle")?.className).toBe("toggle on");
    expect(container.querySelector(".composer-hint")?.textContent).toBe(OPEN_HINT);
    expect(container.querySelector(".send")?.textContent).toBe(SEND_LABEL);
  });

  it("warns that a resolved thread reopens on reply, before the reply", () => {
    const { container } = render(<Host transport={wire()} resolved />);
    expect(container.querySelector(".composer-hint")?.textContent).toBe(RESOLVED_HINT);
  });

  /**
   * SHARED-057 clause 2. The foot truncates this hint when it runs out of room
   * (`thread.css` chose it as the item that yields), and these two sentences
   * are the only place the product says either thing — so the whole of each has
   * to be reachable from the clipped span. jsdom lays nothing out, so the clip
   * itself is asserted in `address-geometry.spec.ts`; what is pinned here is
   * that the reveal exists and matches the words, in both states.
   */
  it("hands the whole hint back on a title, in both states", () => {
    for (const [resolved, words] of [
      [false, OPEN_HINT],
      [true, RESOLVED_HINT],
    ] as const) {
      const { container, unmount } = render(<Host transport={wire()} resolved={resolved} />);
      const hint = container.querySelector(".composer-hint");
      expect(hint?.textContent).toBe(words);
      expect(hint?.getAttribute("title")).toBe(words);
      unmount();
    }
  });

  it("cannot send an empty turn, and can send an attachment-only one", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    expect((send() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.drop(container.querySelector(".composer") as HTMLElement, {
      dataTransfer: { files: [new File(["x"], "shot.png", { type: "image/png" })] },
    });
    await waitFor(() => {
      expect((send() as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(send());
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
    });
    const call = transport.of("POST", "/api/threads/th_a/turns")[0];
    expect(call?.files).toEqual(["shot.png"]);
    expect(call?.parts?.["text"]).toBeUndefined();
  });

  /** TEST-52: "note only" is an explicit `false`, never an omission. */
  it("maps the toggle to the tri-state requestsAgent", async () => {
    const transport = wire();
    render(<Host transport={transport} />);

    fireEvent.change(input(), { target: { value: "asking" } });
    fireEvent.click(send());
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
    });
    expect(transport.of("POST", "/api/threads/th_a/turns")[0]?.body).toEqual({
      body: "asking",
      requestsAgent: true,
    });

    fireEvent.click(screen.getByText(ASK_AGENT_LABEL));
    expect(screen.getByText(NOTE_ONLY_LABEL)).toBeDefined();
    fireEvent.change(input(), { target: { value: "just a note" } });
    fireEvent.click(send());
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(2);
    });
    expect(transport.of("POST", "/api/threads/th_a/turns")[1]?.body).toEqual({
      body: "just a note",
      requestsAgent: false,
    });
  });

  /**
   * TEST-53: an `@mention` under "note only". The toggle is an explicit
   * instruction and the UI does not overrule it — it sends `false` and lets the
   * server decide what a mention means (§8), which for an explicit `false` is
   * "suppress the enqueue".
   */
  it("still sends note-only when the text carries a mention", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    fireEvent.click(screen.getByText(ASK_AGENT_LABEL));
    fireEvent.change(input(), { target: { value: "@agent look at this" } });
    fireEvent.click(send());
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
    });
    expect(transport.of("POST", "/api/threads/th_a/turns")[0]?.body).toEqual({
      body: "@agent look at this",
      requestsAgent: false,
    });
  });

  it("sends once when Reply is pressed twice", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    fireEvent.change(input(), { target: { value: "twice" } });
    fireEvent.click(send());
    fireEvent.click(send());
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns").length).toBeGreaterThan(0);
    });
    expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
  });

  /** SPEC.md §11's composer key contract, as UI-052 rebound it. */
  it("sends on ⌘↵ and clears the field", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    fireEvent.change(input(), { target: { value: "by keyboard" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
    });
    expect(input().value).toBe("");
  });

  it("takes a newline on ↵ instead of sending, in a field that can hold one", () => {
    const transport = wire();
    render(<Host transport={transport} />);
    fireEvent.change(input(), { target: { value: "line one" } });

    // Not prevented: the textarea's own insertion is the behaviour.
    expect(fireEvent.keyDown(input(), { key: "Enter" })).toBe(true);
    expect(transport.calls.filter((call) => call.method === "POST")).toEqual([]);

    fireEvent.change(input(), { target: { value: "line one\nline two" } });
    expect(input().value).toBe("line one\nline two");
    expect(input().tagName).toBe("TEXTAREA");
  });

  /** The mirror `.composer-grow` measures with — the field's height *is* its text. */
  it("grows with the text it is holding", () => {
    const { container } = render(<Host transport={wire()} />);
    const wrap = container.querySelector<HTMLElement>(".composer-grow");
    expect(wrap?.dataset["replicatedValue"]).toBe("");
    fireEvent.change(input(), { target: { value: "one\ntwo\nthree" } });
    expect(wrap?.dataset["replicatedValue"]).toBe("one\ntwo\nthree");
  });

  it("never sends on an IME composition commit", () => {
    const transport = wire();
    render(<Host transport={transport} />);
    fireEvent.change(input(), { target: { value: "にほんご" } });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true, isComposing: true });
    expect(transport.calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("restores the text and the chips when the send fails", async () => {
    const notify = vi.fn();
    const transport = wire({ "POST /api/threads/th_a/turns": 413 });
    const { container } = render(<Host transport={transport} onNotify={notify} />);

    fireEvent.change(input(), { target: { value: "with a file" } });
    fireEvent.drop(container.querySelector(".composer") as HTMLElement, {
      dataTransfer: { files: [new File(["x"], "big.bin")] },
    });
    await waitFor(() => {
      expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
    });

    fireEvent.click(send());
    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    expect(input().value).toBe("with a file");
    expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ tone: "error" });
  });

  /** SPEC.md §11's smart input: one menu, from `GET /api/docs`. */
  it("opens the shared autocomplete on @", async () => {
    const { container } = render(<Host transport={wire()} />);
    fireEvent.change(input(), { target: { value: "@" } });
    await waitFor(() => {
      expect(container.querySelector(".ac-menu")).not.toBeNull();
    });
    expect(container.querySelector(".ac-item .k")?.textContent).toBe("agent");
  });
});
