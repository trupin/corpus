/** @vitest-environment jsdom */
import { createCorpusTestHarness, resetWeightChoices } from "@corpus/kit/testing";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack.js";
import { readerTransport } from "../testing/readerFixture.js";
import { ASK_AGENT_LABEL, NOTE_ONLY_LABEL } from "../thread/ThreadComposer.js";
import { CommentPopover, COMMENT_MOVE_LABEL, quotePreview } from "./CommentPopover.js";
import { POPOVER_DRAG_STEP, POPOVER_DRAG_STEP_COARSE, POPOVER_EDGE_MARGIN } from "./popoverDrag.js";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetWeightChoices();
});

function open(overrides: Partial<Parameters<typeof CommentPopover>[0]> = {}): {
  onSubmit: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  /** Re-renders with different props — a second selection, or the same one. */
  reopen: (next: Partial<Parameters<typeof CommentPopover>[0]>) => void;
} {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  /*
   * A provider, because the composer reads the workspace's declared weight
   * levels from the ordinary document queries (SPEC.md §10's rider, UI-082).
   * This transport declares none, so no control is drawn and every assertion
   * below describes the composer exactly as it did before that feature — which
   * is also what a workspace on an older template sees (§2.4).
   */
  const harness = createCorpusTestHarness({ fetch: readerTransport({}).fetch });
  const tree = (extra: Partial<Parameters<typeof CommentPopover>[0]>): ReactElement => (
    <harness.Wrapper>
      <CommentPopover
        quote="assume a 30-year fixed at 6.1%"
        top={120}
        left={80}
        pending={false}
        weightScope="doc:doc_a"
        recipientScope="doc_a"
        onSubmit={onSubmit}
        onClose={onClose}
        {...overrides}
        {...extra}
      />
    </harness.Wrapper>
  );
  const { rerender } = render(tree({}));
  return {
    onSubmit,
    onClose,
    reopen: (next) => {
      rerender(tree(next));
    },
  };
}

function type(text: string): void {
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: text } });
}

/** The popover, wherever it portalled to. */
function popover(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-comment-pop]");
  if (element === null) throw new Error("the popover is not open");
  return element;
}

function chips(): readonly string[] {
  return [...popover().querySelectorAll(".att-chip")].map((chip) => chip.textContent ?? "");
}

const png = (name = "shot.png"): File => new File(["x"], name, { type: "image/png" });
const pdf = (): File => new File(["x"], "policy.pdf", { type: "application/pdf" });

function send(): void {
  fireEvent.click(screen.getByRole("button", { name: /Comment/u }));
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
    expect(onSubmit).toHaveBeenCalledWith("Where does this number come from?", true, {}, []);
  });

  it("sends an explicit false for note only", () => {
    const { onSubmit } = open();
    type("Just a note.");
    fireEvent.click(screen.getByRole("button", { name: ASK_AGENT_LABEL }));
    expect(screen.getByRole("button", { name: NOTE_ONLY_LABEL })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Comment/u }));
    expect(onSubmit).toHaveBeenCalledWith("Just a note.", false, {}, []);
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
   * SPEC.md §10's composer key contract, as UI-052 rebound it: `↵` is the
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
    expect(onSubmit).toHaveBeenCalledWith("A comment.", true, {}, []);
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

/**
 * SPEC.md §10's rider, signed 2026-08-05: *"Every composer takes attachments.
 * Wherever a comment can be written — … a comment on a document selection … —
 * files can be added by picker, paste or drag-and-drop, and appear as chip
 * previews before sending (§6)."*
 *
 * Every test below drives the **route**, not the markup: a `change` on the real
 * picker, a real paste event carrying files, a real drop. An assertion about the
 * handler props or the class list would pass against a dropzone whose events
 * never reach the intake, which is precisely the failure mode (UI-111).
 */
describe("the comment composer's attachments", () => {
  const revoked: string[] = [];

  beforeEach(() => {
    revoked.length = 0;
    let sequence = 0;
    // jsdom implements neither half of the object-URL API, so a thumbnail can
    // only be asserted with these in place.
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => {
        sequence += 1;
        return `blob:preview-${String(sequence)}`;
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: (url: string) => {
        revoked.push(url);
      },
    });
  });

  it("takes a file from the 📎 picker and previews it as a chip", () => {
    open();
    const picker = popover().querySelector<HTMLInputElement>('[data-attach-input="comment"]');
    expect(picker).not.toBeNull();
    fireEvent.change(picker as HTMLInputElement, { target: { files: [png(), pdf()] } });

    expect(chips()).toHaveLength(2);
    expect(chips()[0]).toContain("shot.png");
    expect(popover().querySelector(".att-chip img")?.getAttribute("src")).toBe("blob:preview-1");
  });

  it("attaches a pasted image and still lets a text-only paste type", () => {
    open();
    const field = screen.getByLabelText("Comment");

    const pasted = fireEvent.paste(field, {
      clipboardData: { files: [png()], getData: () => "data:image/png;base64,AAAA" },
    });
    // Consumed: the data URL beside the file must not land in the field.
    expect(pasted).toBe(false);
    expect(chips()).toHaveLength(1);

    const plain = fireEvent.paste(field, {
      clipboardData: { files: [], getData: () => "plain words" },
    });
    expect(plain).toBe(true);
    expect(chips()).toHaveLength(1);
  });

  it("lights up while a file is dragged over it and takes the drop", () => {
    open();
    fireEvent.dragEnter(popover());
    expect(popover().className).toContain("dropping");

    fireEvent.drop(popover(), { dataTransfer: { files: [pdf()] } });
    expect(popover().className).not.toContain("dropping");
    expect(chips()[0]).toContain("policy.pdf");
  });

  it("removes a pending attachment before sending, and never sends it", () => {
    const { onSubmit } = open();
    fireEvent.drop(popover(), { dataTransfer: { files: [png(), pdf()] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove shot.png" }));

    expect(chips()).toHaveLength(1);
    type("Only the policy.");
    send();
    const attachments = onSubmit.mock.calls[0]?.[3] as readonly { file: File }[];
    expect(attachments.map((held) => held.file.name)).toEqual(["policy.pdf"]);
  });

  /** §6: a first turn may be a file and no words at all. */
  it("sends a comment that is only an attachment", () => {
    const { onSubmit } = open();
    expect(screen.getByRole("button", { name: /Comment/u }).hasAttribute("disabled")).toBe(true);

    fireEvent.drop(popover(), { dataTransfer: { files: [png()] } });
    expect(screen.getByRole("button", { name: /Comment/u }).hasAttribute("disabled")).toBe(false);

    send();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [body, requestsAgent, weight, attachments] = onSubmit.mock.calls[0] as [
      string,
      boolean,
      object,
      readonly { file: File }[],
    ];
    expect(body).toBe("");
    expect(requestsAgent).toBe(true);
    expect(weight).toEqual({});
    expect(attachments.map((held) => held.file.name)).toEqual(["shot.png"]);
  });

  /**
   * The composer closes on submit, so the snapshot has to outlive it: whoever
   * posts it owns the previews and puts them back if the server refuses. A
   * revoke on the way out would leave a restored chip showing a dead thumbnail.
   */
  it("hands its previews over rather than revoking them on the way out", () => {
    const { onSubmit } = open();
    fireEvent.drop(popover(), { dataTransfer: { files: [png()] } });
    send();
    // The chips leave the composer the moment the send does.
    expect(chips()).toHaveLength(0);
    cleanup();

    expect(revoked).toEqual([]);
    const attachments = onSubmit.mock.calls[0]?.[3] as readonly { previewUrl: string | null }[];
    expect(attachments[0]?.previewUrl).toBe("blob:preview-1");
  });

  it("comes back holding the words and the files a refused send was carrying", () => {
    const held = { id: "att-restored", file: png(), name: "shot.png", previewUrl: "blob:kept" };
    const { onSubmit } = open({
      restore: { text: "Look at this.", attachments: [held] },
    });

    expect(screen.getByLabelText<HTMLTextAreaElement>("Comment").value).toBe("Look at this.");
    expect(chips()[0]).toContain("shot.png");
    expect(popover().querySelector(".att-chip img")?.getAttribute("src")).toBe("blob:kept");

    send();
    expect(onSubmit).toHaveBeenCalledWith("Look at this.", true, {}, [held]);
  });
});

/**
 * UI-112: *"I want to be able to move the comment modal (sometimes, it is above
 * content I need for the comment)."*
 *
 * Every test below drives the **gesture** and reads the position off the box —
 * an assertion about a handler prop or a class would pass against a popover
 * that cannot actually move, which is the failure mode.
 */
describe("moving the comment composer", () => {
  /** jsdom lays nothing out, and the clamp is made of the box's own size. */
  function sized(width: number, height: number): void {
    popover().getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height }) as DOMRect;
  }

  function grip(): HTMLElement {
    return screen.getByRole("button", { name: COMMENT_MOVE_LABEL });
  }

  /**
   * jsdom ships no `PointerEvent`, so `fireEvent.pointerDown` degrades to a bare
   * `Event` and drops `clientX` — the one field a drag is made of. A `MouseEvent`
   * typed `pointerdown` carries it and React dispatches it identically, which is
   * the trick `useColumnWidth.test.tsx` and `useConsoleLayout.test.ts` both use.
   */
  function drag(from: readonly [number, number], to: readonly [number, number][]): void {
    act(() => {
      fireEvent(
        grip(),
        new MouseEvent("pointerdown", { clientX: from[0], clientY: from[1], bubbles: true }),
      );
    });
    for (const [x, y] of to) {
      act(() => {
        window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
      });
    }
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup", {}));
    });
  }

  function at(): { top: string; left: string } {
    return { top: popover().style.top, left: popover().style.left };
  }

  it("follows the pointer and stays where it was dropped", () => {
    open();
    sized(320, 200);
    expect(at()).toEqual({ top: "120px", left: "80px" });

    drag(
      [100, 100],
      [
        [140, 130],
        [300, 260],
      ],
    );

    // The box moved by the pointer's own displacement, not to the pointer.
    expect(at()).toEqual({ top: `${String(120 + 160)}px`, left: `${String(80 + 200)}px` });
    // And it is still there once the gesture is over.
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 900, clientY: 900 }));
    });
    expect(at()).toEqual({ top: "280px", left: "280px" });
  });

  it("cannot be dragged off the screen in any direction", () => {
    open();
    sized(320, 200);

    drag([100, 100], [[-9000, -9000]]);
    expect(at()).toEqual({
      top: `${String(POPOVER_EDGE_MARGIN)}px`,
      left: `${String(POPOVER_EDGE_MARGIN)}px`,
    });

    drag([100, 100], [[9000, 9000]]);
    expect(at()).toEqual({
      top: `${String(window.innerHeight - 200 - POPOVER_EDGE_MARGIN)}px`,
      left: `${String(window.innerWidth - 320 - POPOVER_EDGE_MARGIN)}px`,
    });
  });

  /** §10 adds no exclusive-pointer capability: the grip is a real button. */
  it("moves from the keyboard, and takes the key rather than letting it through", () => {
    const { onClose } = open();
    sized(320, 200);

    expect(fireEvent.keyDown(grip(), { key: "ArrowRight" })).toBe(false);
    expect(at()).toEqual({ top: "120px", left: `${String(80 + POPOVER_DRAG_STEP)}px` });

    fireEvent.keyDown(grip(), { key: "ArrowUp" });
    expect(at().top).toBe(`${String(120 - POPOVER_DRAG_STEP)}px`);

    fireEvent.keyDown(grip(), { key: "ArrowDown", shiftKey: true });
    expect(at().top).toBe(`${String(120 - POPOVER_DRAG_STEP + POPOVER_DRAG_STEP_COARSE)}px`);

    // A key that is not a move is not swallowed: Escape from the grip still
    // reaches the chain and closes the composer.
    const moved = at();
    fireEvent.keyDown(grip(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(at()).toEqual(moved);
  });

  it("is clamped by the keyboard too", () => {
    open({ top: 20, left: 20 });
    sized(320, 200);
    for (let press = 0; press < 10; press += 1) {
      fireEvent.keyDown(grip(), { key: "ArrowLeft", shiftKey: true });
    }
    expect(at().left).toBe(`${String(POPOVER_EDGE_MARGIN)}px`);
  });

  it("keeps the position it was given through a re-render for the same selection", () => {
    const { reopen } = open();
    sized(320, 200);
    drag([100, 100], [[160, 100]]);
    expect(at().left).toBe("140px");

    // The host re-renders for its own reasons — a pending flag, a restored
    // draft — and the box must not jump back onto the words.
    reopen({ pending: true });
    expect(at().left).toBe("140px");
  });

  /**
   * A position chosen because it cleared *that* paragraph means nothing for the
   * next one, so a new selection places the composer afresh (UI-112).
   */
  it("goes back to the default place when it opens on a different selection", () => {
    const { reopen } = open();
    sized(320, 200);
    drag([100, 100], [[400, 400]]);
    expect(at()).not.toEqual({ top: "120px", left: "80px" });

    reopen({ top: 640, left: 300, quote: "another passage entirely" });
    expect(at()).toEqual({ top: "640px", left: "300px" });
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
