/** @vitest-environment jsdom */
import { resetWeightChoices } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack.js";
import { readerTransport } from "../testing/readerFixture.js";
import { ASK_AGENT_LABEL, NOTE_ONLY_LABEL } from "../thread/ThreadComposer.js";
import { CommentPopover, quotePreview } from "./CommentPopover.js";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetWeightChoices();
});

function open(overrides: Partial<Parameters<typeof CommentPopover>[0]> = {}): {
  onSubmit: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  /*
   * A provider, because the composer reads the workspace's declared weight
   * levels from the ordinary document queries (SPEC.md §11's rider, UI-082).
   * This transport declares none, so no control is drawn and every assertion
   * below describes the composer exactly as it did before that feature — which
   * is also what a workspace on an older template sees (§2.4).
   */
  const harness = createCorpusTestHarness({ fetch: readerTransport({}).fetch });
  render(
    <harness.Wrapper>
      <CommentPopover
        quote="assume a 30-year fixed at 6.1%"
        top={120}
        left={80}
        pending={false}
        weightScope="doc:doc_a"
        onSubmit={onSubmit}
        onClose={onClose}
        {...overrides}
      />
    </harness.Wrapper>,
  );
  return { onSubmit, onClose };
}

function type(text: string): void {
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: text } });
}

describe("the comment composer", () => {
  it("shows what is being commented on", () => {
    open();
    expect(screen.getByText("“assume a 30-year fixed at 6.1%”")).toBeTruthy();
  });

  it("asks the agent by default, and says so", () => {
    open();
    const toggle = screen.getByRole("button", { name: ASK_AGENT_LABEL });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("submits the text and the flag the toggle is showing", () => {
    const { onSubmit } = open();
    type("Where does this number come from?");
    fireEvent.click(screen.getByRole("button", { name: /Comment/u }));
    expect(onSubmit).toHaveBeenCalledWith("Where does this number come from?", true, {});
  });

  it("sends an explicit false for note only", () => {
    const { onSubmit } = open();
    type("Just a note.");
    fireEvent.click(screen.getByRole("button", { name: ASK_AGENT_LABEL }));
    expect(screen.getByRole("button", { name: NOTE_ONLY_LABEL })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Comment/u }));
    expect(onSubmit).toHaveBeenCalledWith("Just a note.", false, {});
  });

  it("cannot submit nothing", () => {
    const { onSubmit } = open();
    const send = screen.getByRole("button", { name: /Comment/u });
    expect(send.hasAttribute("disabled")).toBe(true);
    type("   ");
    expect(send.hasAttribute("disabled")).toBe(true);
    fireEvent.click(send);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("cannot submit twice while the first one is in flight", () => {
    open({ pending: true });
    type("A comment.");
    expect(screen.getByRole("button", { name: /Comment/u }).hasAttribute("disabled")).toBe(true);
  });

  /**
   * SPEC.md §11's composer key contract, as UI-052 rebound it: `↵` is the
   * newline now — in *this* composer it always could have been, since the field
   * was already a textarea — and `⌘↵` is the submit.
   */
  it("submits on ⌘↵ and leaves ↵ and ⇧↵ to the text", () => {
    const { onSubmit } = open();
    type("A comment.");
    const input = screen.getByLabelText("Comment");

    // Neither is prevented: the textarea's own insertion is the behaviour.
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith("A comment.", true, {});
  });

  it("never submits on an IME composition commit", () => {
    const { onSubmit } = open();
    type("にほんご");
    fireEvent.keyDown(screen.getByLabelText("Comment"), {
      key: "Enter",
      metaKey: true,
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("names its key on the button", () => {
    open();
    expect(screen.getByRole("button", { name: /Comment/u }).textContent).toBe("Comment ⌘↵");
  });

  it("closes on escape from inside the field, which the chain must not consume", () => {
    const { onClose } = open();
    fireEvent.keyDown(screen.getByLabelText("Comment"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on escape from anywhere else, through the escape chain", () => {
    const { onClose } = open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is placed against the selection", () => {
    open();
    const popover = document.querySelector<HTMLElement>("[data-comment-pop]");
    expect(popover?.style.top).toBe("120px");
    expect(popover?.style.left).toBe("80px");
    expect(popover?.className).toBe("comment-pop open");
  });
});

describe("the quote preview", () => {
  it("flattens whitespace so a multi-line quote stays one line", () => {
    expect(quotePreview("a\n\n  b  ")).toBe("a b");
  });

  it("elides a quote too long to sit in a popover", () => {
    expect(quotePreview("x".repeat(200))).toHaveLength(90);
    expect(quotePreview("x".repeat(200)).endsWith("…")).toBe(true);
  });
});
