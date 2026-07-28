/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack.js";
import { ASK_AGENT_LABEL, NOTE_ONLY_LABEL } from "../thread/ThreadComposer.js";
import { CommentPopover, quotePreview } from "./CommentPopover.js";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

function open(overrides: Partial<Parameters<typeof CommentPopover>[0]> = {}): {
  onSubmit: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <CommentPopover
      quote="assume a 30-year fixed at 6.1%"
      top={120}
      left={80}
      pending={false}
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />,
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
    expect(onSubmit).toHaveBeenCalledWith("Where does this number come from?", true);
  });

  it("sends an explicit false for note only", () => {
    const { onSubmit } = open();
    type("Just a note.");
    fireEvent.click(screen.getByRole("button", { name: ASK_AGENT_LABEL }));
    expect(screen.getByRole("button", { name: NOTE_ONLY_LABEL })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Comment/u }));
    expect(onSubmit).toHaveBeenCalledWith("Just a note.", false);
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

  it("submits on ↵ and takes a newline on ⇧↵", () => {
    const { onSubmit } = open();
    type("A comment.");
    const input = screen.getByLabelText("Comment");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("A comment.", true);
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
