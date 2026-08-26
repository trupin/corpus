/** @vitest-environment jsdom */
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { isOverlayOpen } from "../shell/overlays";
import {
  ASK_LABEL,
  CAPTURE_LABEL,
  COMPOSE_HINT,
  COMPOSE_PLACEHOLDER,
  ComposeOverlay,
} from "./ComposeOverlay";
import { composeTransport, type ComposeTransport } from "./composeFixture";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

interface Mounted extends RenderResult {
  readonly notices: RowNotice[];
  readonly onClose: () => void;
}

function mount(
  wire: ComposeTransport = composeTransport(),
  onClose: () => void = () => undefined,
): Mounted {
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const notices: RowNotice[] = [];
  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return <harness.Wrapper>{children}</harness.Wrapper>;
  }
  const rendered = render(
    <ComposeOverlay
      onClose={onClose}
      onNotify={(notice) => {
        notices.push(notice);
      }}
    />,
    { wrapper: Wrapper },
  );
  return { ...rendered, notices, onClose };
}

const textareaOf = (container: HTMLElement): HTMLTextAreaElement =>
  container.querySelector("textarea") as HTMLTextAreaElement;

const button = (container: HTMLElement, className: string): HTMLButtonElement =>
  container.querySelector(`.${className}`) as HTMLButtonElement;

const type = (container: HTMLElement, value: string): void => {
  fireEvent.change(textareaOf(container), { target: { value } });
};

const file = (name: string): File => new File(["bytes"], name, { type: "image/png" });

/**
 * A macrotask, so that "and nothing was submitted" is a claim about what the
 * composer did rather than about how fast the assertion ran: the submit reaches
 * the transport through a microtask chain.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

describe("ComposeOverlay", () => {
  describe("the panel", () => {
    it("is the prototype's: a scrim, a 640px compose panel, and the actions in order", () => {
      const { container } = mount();
      expect(container.querySelector(".overlay.open")).not.toBeNull();
      const panel = container.querySelector(".search-panel.compose-panel");
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute("role")).toBe("dialog");
      expect(panel?.getAttribute("aria-label")).toBe("Ask or capture");
      expect(panel?.getAttribute("data-dropzone")).toBe("compose");

      const actions = [...(panel?.querySelectorAll(".compose-actions > *") ?? [])].map(
        (node) => node.className || node.tagName.toLowerCase(),
      );
      // The address line (UI-126) sits between the 📎 and the hint, and the
      // owner picker (UI-173) beside it — two acts, two controls, adjacent
      // because a person choosing one is deciding about the other. The two
      // submits keep the bar's tail, which is the key contract's order.
      expect(actions).toEqual([
        "clip",
        "input",
        "composer-address",
        "compose-resident",
        "hint",
        "spacer",
        "btn-capture",
        "btn-ask",
      ]);
      expect(button(container, "btn-capture").textContent).toBe(CAPTURE_LABEL);
      expect(button(container, "btn-ask").textContent).toBe(ASK_LABEL);
      expect(panel?.querySelector(".compose-actions .hint")?.textContent).toBe(COMPOSE_HINT);
      expect(panel?.querySelector(".pending-atts")).not.toBeNull();
    });

    it("carries the prototype's placeholder as one attribute, both lines exactly", () => {
      const { container } = mount();
      expect(textareaOf(container).placeholder).toBe(COMPOSE_PLACEHOLDER);
      expect(COMPOSE_PLACEHOLDER.split("\n")).toEqual([
        "Ask the agent anything, or capture a thought…",
        "@ routes to a subagent · / invokes a skill · [[ links a document · paste/drop files",
      ]);
    });

    it("carries `.overlay.open`, so `isOverlayOpen()` tells the truth about it", () => {
      mount();
      expect(isOverlayOpen()).toBe(true);
    });

    it("puts the caret in the textarea", () => {
      const { container } = mount();
      expect(document.activeElement).toBe(textareaOf(container));
    });
  });

  describe("submitting", () => {
    it("⌘↵ asks: a standalone thread with the text as its first turn", async () => {
      const wire = composeTransport();
      const onClose = vi.fn();
      const { container, notices } = mount(wire, onClose);
      type(container, "What is due this week?");
      fireEvent.keyDown(textareaOf(container), { key: "Enter", metaKey: true });

      await waitFor(() => {
        expect(wire.to("/api/threads")).toHaveLength(1);
      });
      expect(wire.to("/api/threads")[0]?.json).toEqual({
        parent: null,
        selector: null,
        body: "What is due this week?",
        requestsAgent: true,
      });
      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      expect(notices.at(-1)?.message).toContain("standalone thread");
    });

    /**
     * Capture is the *secondary* submit under SPEC.md §10's contract, so it
     * moved off `⌘↵` — which the primary action now owns in every composer —
     * onto `⇧⌘↵`.
     */
    it("⇧⌘↵ captures, and so does ⇧Ctrl+↵ where the chord is claimed", async () => {
      const wire = composeTransport();
      const { container } = mount(wire);
      type(container, "a thought");
      fireEvent.keyDown(textareaOf(container), { key: "Enter", metaKey: true, shiftKey: true });
      await waitFor(() => {
        expect(wire.to("/api/capture")).toHaveLength(1);
      });

      cleanup();
      const second = composeTransport();
      const next = mount(second);
      type(next.container, "another thought");
      fireEvent.keyDown(textareaOf(next.container), {
        key: "Enter",
        ctrlKey: true,
        shiftKey: true,
      });
      await waitFor(() => {
        expect(second.to("/api/capture")).toHaveLength(1);
      });
    });

    it.each([
      ["↵", {}],
      ["⇧↵", { shiftKey: true }],
    ])("%s inserts a newline and issues nothing", async (_name, modifier) => {
      const wire = composeTransport();
      const { container } = mount(wire);
      type(container, "line one");
      const event = fireEvent.keyDown(textareaOf(container), { key: "Enter", ...modifier });
      // Not prevented: the textarea's own newline is the behaviour.
      expect(event).toBe(true);
      await settle();
      expect(wire.calls.filter((call) => call.method === "POST")).toEqual([]);
    });

    it.each([
      ["a bare commit", {}],
      ["an Ask chord", { metaKey: true }],
      ["a Capture chord", { metaKey: true, shiftKey: true }],
    ])("never treats an IME composition as a submit — %s", async (_name, modifier) => {
      const wire = composeTransport();
      const { container } = mount(wire);
      type(container, "にほん");
      fireEvent.keyDown(textareaOf(container), { key: "Enter", isComposing: true, ...modifier });
      await settle();
      expect(wire.calls.filter((call) => call.method === "POST")).toEqual([]);
    });

    it("the buttons and the keys build the same request", async () => {
      const wire = composeTransport();
      const { container } = mount(wire);
      type(container, "clicked");
      fireEvent.click(button(container, "btn-ask"));
      await waitFor(() => {
        expect(wire.to("/api/threads")).toHaveLength(1);
      });
      expect(wire.to("/api/threads")[0]?.json).toMatchObject({
        parent: null,
        requestsAgent: true,
        body: "clicked",
      });
    });
  });

  describe("what can be submitted", () => {
    it("disables both buttons while there is nothing to send, and ⌘↵ does nothing", async () => {
      const wire = composeTransport();
      const { container } = mount(wire);
      expect(button(container, "btn-ask").disabled).toBe(true);
      expect(button(container, "btn-capture").disabled).toBe(true);
      fireEvent.keyDown(textareaOf(container), { key: "Enter", metaKey: true });
      await settle();
      expect(wire.calls.filter((call) => call.method === "POST")).toEqual([]);
    });

    it("treats whitespace as nothing", () => {
      const { container } = mount();
      type(container, "   \n  ");
      expect(button(container, "btn-ask").disabled).toBe(true);
    });

    /**
     * An attachment-only Ask is legal — a first turn may be attachment-only.
     * Capture is not, and the button says why: `POST /api/capture` requires
     * `text`, because the capture *becomes a document's body*.
     */
    it("allows an attachment-only Ask and explains why Capture needs a line", () => {
      const { container } = mount();
      fireEvent.change(container.querySelector("input[type=file]") as HTMLInputElement, {
        target: { files: [file("shot.png")] },
      });
      expect(button(container, "btn-ask").disabled).toBe(false);
      expect(button(container, "btn-capture").disabled).toBe(true);
      expect(button(container, "btn-capture").title).toContain("needs a line of text");
    });
  });

  describe("attachments", () => {
    it("takes files from the 📎 picker and shows a chip each", () => {
      const { container } = mount();
      fireEvent.change(container.querySelector("input[type=file]") as HTMLInputElement, {
        target: { files: [file("a.png"), file("b.png")] },
      });
      expect(container.querySelectorAll(".pending-atts .att-chip")).toHaveLength(2);
    });

    it("takes a pasted screenshot", () => {
      const { container } = mount();
      fireEvent.paste(textareaOf(container), {
        clipboardData: { files: [file("clip.png")] },
      });
      expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
      expect(container.querySelector(".att-chip")?.textContent).toContain("clip.png");
    });

    it("takes a drop, and lights the panel while the drag is over it", () => {
      const { container } = mount();
      const panel = container.querySelector(".compose-panel") as HTMLElement;
      fireEvent.dragEnter(panel, { dataTransfer: { files: [] } });
      expect(panel.className).toContain("dropping");
      fireEvent.drop(panel, { dataTransfer: { files: [file("drop.png")] } });
      expect(panel.className).not.toContain("dropping");
      expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
    });

    it("sends the chips with an Ask, and clears them when the send lands", async () => {
      const wire = composeTransport();
      const { container } = mount(wire);
      type(container, "look at this");
      fireEvent.change(container.querySelector("input[type=file]") as HTMLInputElement, {
        target: { files: [file("shot.png")] },
      });
      fireEvent.click(button(container, "btn-ask"));

      await waitFor(() => {
        expect(wire.to("/api/threads")).toHaveLength(1);
      });
      expect(wire.to("/api/threads")[0]?.files).toEqual(["shot.png"]);
      expect(wire.to("/api/threads")[0]?.form).toEqual({
        text: "look at this",
        requestsAgent: "true",
      });
    });

    it("sends them to the capture's filing thread on ⇧⌘↵", async () => {
      const wire = composeTransport();
      const { container } = mount(wire);
      type(container, "file this");
      fireEvent.change(container.querySelector("input[type=file]") as HTMLInputElement, {
        target: { files: [file("shot.png")] },
      });
      fireEvent.keyDown(textareaOf(container), { key: "Enter", metaKey: true, shiftKey: true });
      await waitFor(() => {
        expect(wire.to("/api/capture")).toHaveLength(1);
      });
      expect(wire.to("/api/capture")[0]?.files).toEqual(["shot.png"]);
    });

    it("removes a chip on request", () => {
      const { container } = mount();
      fireEvent.change(container.querySelector("input[type=file]") as HTMLInputElement, {
        target: { files: [file("a.png")] },
      });
      fireEvent.click(container.querySelector(".att-chip button") as HTMLElement);
      expect(container.querySelectorAll(".att-chip")).toHaveLength(0);
    });
  });

  describe("the autocompletes", () => {
    it("opens the kit's menu on `@`, listing agent documents", async () => {
      const wire = composeTransport({
        rows: [
          docRowFixture({
            id: "doc_a",
            title: "Researcher",
            type: "agent-def",
            // Under the agent root, because only a document there is addressable
            // at all and therefore only one there is offered (UI-123).
            path: ".claude/agents/researcher.md",
          }),
        ],
      });
      const { container } = mount(wire);
      fireEvent.change(textareaOf(container), {
        target: { value: "@res", selectionStart: 4 },
      });
      await waitFor(() => {
        expect(container.querySelector(".ac-menu")).not.toBeNull();
      });
      expect(container.querySelector(".ac-item .k")?.textContent).toBeDefined();
    });

    /**
     * The composer that has both claims on `↵` — a menu that owns the bare key
     * and a contract that owns the chords (SPEC.md §10: "the primary action is
     * always `⌘↵`"). All four combinations, because the defect PR #20's review
     * found lived in exactly one of them: an open menu answered *any* `Enter`,
     * so `⌘↵` accepted a completion instead of asking.
     */
    describe("the menu's claim on ↵ against the contract's on ⌘↵", () => {
      /** Types `Ask @rate` with the caret at the end, and waits for the menu. */
      async function openMenu(container: HTMLElement): Promise<void> {
        fireEvent.change(textareaOf(container), {
          target: { value: "Ask @rate", selectionStart: 9 },
        });
        await waitFor(() => {
          expect(container.querySelector(".ac-menu")).not.toBeNull();
        });
      }

      const withMenu = (): ComposeTransport =>
        composeTransport({
          rows: [
            docRowFixture({
              id: "doc_r",
              title: "rate",
              type: "agent-def",
              path: ".claude/agents/rate.md",
            }),
          ],
        });

      it("menu closed · ↵ — inserts a newline and submits nothing", async () => {
        const wire = withMenu();
        const { container } = mount(wire);
        type(container, "Ask something");
        expect(container.querySelector(".ac-menu")).toBeNull();
        expect(fireEvent.keyDown(textareaOf(container), { key: "Enter" })).toBe(true);
        await settle();
        expect(wire.calls.filter((call) => call.method === "POST")).toEqual([]);
      });

      it("menu closed · ⌘↵ — asks", async () => {
        const wire = withMenu();
        const { container } = mount(wire);
        type(container, "Ask something");
        fireEvent.keyDown(textareaOf(container), { key: "Enter", metaKey: true });
        await waitFor(() => {
          expect(wire.to("/api/threads")).toHaveLength(1);
        });
      });

      it("menu open · ↵ — accepts the completion, submits nothing", async () => {
        const wire = withMenu();
        const { container } = mount(wire);
        await openMenu(container);
        expect(fireEvent.keyDown(textareaOf(container), { key: "Enter" })).toBe(false);
        await settle();
        expect(wire.calls.filter((call) => call.method === "POST")).toEqual([]);
        expect(textareaOf(container).value).toBe("Ask @rate ");
      });

      it("menu open · ⌘↵ — asks, on the first press, with the text as typed", async () => {
        const wire = withMenu();
        const { container } = mount(wire);
        await openMenu(container);
        fireEvent.keyDown(textareaOf(container), { key: "Enter", metaKey: true });
        await waitFor(() => {
          expect(wire.to("/api/threads")).toHaveLength(1);
        });
        expect(wire.to("/api/threads")[0]?.json).toMatchObject({ body: "Ask @rate" });
      });

      it("menu open · ⇧⌘↵ — captures, on the first press", async () => {
        const wire = withMenu();
        const { container } = mount(wire);
        await openMenu(container);
        fireEvent.keyDown(textareaOf(container), { key: "Enter", metaKey: true, shiftKey: true });
        await waitFor(() => {
          expect(wire.to("/api/capture")).toHaveLength(1);
        });
      });

      /**
       * `⇧⇥` is the browser's reverse-focus key and has no accept semantics;
       * SPEC.md §10 gives the menu `⇥`.
       */
      it("menu open · ⇧⇥ — leaves the field, accepting nothing", async () => {
        const wire = withMenu();
        const { container } = mount(wire);
        await openMenu(container);
        expect(fireEvent.keyDown(textareaOf(container), { key: "Tab", shiftKey: true })).toBe(true);
        expect(textareaOf(container).value).toBe("Ask @rate");
      });

      it("menu open · ⇥ — accepts", async () => {
        const wire = withMenu();
        const { container } = mount(wire);
        await openMenu(container);
        expect(fireEvent.keyDown(textareaOf(container), { key: "Tab" })).toBe(false);
        expect(textareaOf(container).value).toBe("Ask @rate ");
      });
    });
  });

  describe("failure and dismissal", () => {
    it("keeps the text, the chips and the panel when a submit fails", async () => {
      const wire = composeTransport({ failing: { "/api/threads": 500 } });
      const onClose = vi.fn();
      const { container, notices } = mount(wire, onClose);
      type(container, "will not land");
      fireEvent.change(container.querySelector("input[type=file]") as HTMLInputElement, {
        target: { files: [file("shot.png")] },
      });
      fireEvent.click(button(container, "btn-ask"));

      await waitFor(() => {
        expect(notices.some((notice) => notice.tone === "error")).toBe(true);
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(textareaOf(container).value).toBe("will not land");
      expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
    });

    it("closes on escape from the textarea, where the escape chain cannot see it", () => {
      const onClose = vi.fn();
      const { container } = mount(composeTransport(), onClose);
      fireEvent.keyDown(textareaOf(container), { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes on escape from the one chain when the caret is elsewhere", () => {
      const onClose = vi.fn();
      const { container } = mount(composeTransport(), onClose);
      button(container, "btn-ask").focus();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes when the scrim is pressed, and not when the panel is", () => {
      const onClose = vi.fn();
      const { container } = mount(composeTransport(), onClose);
      fireEvent.mouseDown(container.querySelector(".compose-panel") as Element);
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.mouseDown(container.querySelector(".overlay") as Element);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Who will own the conversation (UI-173; SPEC.md §7's rider A, §10's rider B).
   */
  describe("the owner picker", () => {
    const picker = (container: HTMLElement): HTMLSelectElement => {
      const found = container.querySelector<HTMLSelectElement>(".compose-resident select");
      if (found === null) throw new Error("no owner picker");
      return found;
    };

    /**
     * Rider A makes a general resident what happens if a person does nothing,
     * so the control shows that rather than an unchosen state. A picker reading
     * "choose an owner…" would misdescribe what pressing Ask is about to do.
     */
    it("shows the default as the default, not as an empty choice", () => {
      const { container } = mount(composeTransport());
      expect(picker(container).value).toBe("");
      expect(picker(container).options[0]?.textContent).toBe("its own agent");
    });

    it("sends nothing at all when the default stands", async () => {
      const wire = composeTransport();
      const { container } = mount(wire);
      type(container, "a question");
      fireEvent.click(button(container, "btn-ask"));

      await waitFor(() => {
        expect(wire.to("/api/threads")).toHaveLength(1);
      });
      // Absence is the spelling of the default, so the key is not on the body.
      expect(Object.keys(wire.to("/api/threads")[0]?.json ?? {})).not.toContain("resident");
    });

    it("sends an explicit null for no owner, which is a value and not an absence", async () => {
      const wire = composeTransport();
      const { container } = mount(wire);
      fireEvent.change(picker(container), { target: { value: "@none" } });
      type(container, "a question");
      fireEvent.click(button(container, "btn-ask"));

      await waitFor(() => {
        expect(wire.to("/api/threads")).toHaveLength(1);
      });
      expect(wire.to("/api/threads")[0]?.json).toMatchObject({ resident: null });
    });

    /**
     * The two are different acts and are never collapsed (§10's rider): a
     * recipient routes one message and rewires nothing, a designation hands
     * over the conversation. Both may ride one request, and this is what says
     * the controls did not learn to imply each other.
     */
    it("is a separate control from the recipient, and neither implies the other", () => {
      const { container } = mount(composeTransport());
      expect(container.querySelector(".composer-address")).not.toBeNull();
      expect(container.querySelector(".compose-resident")).not.toBeNull();
      expect(picker(container).getAttribute("aria-label")).toBe("Who will own this conversation");
    });
  });
});
