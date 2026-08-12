/** @vitest-environment jsdom */
import { COMPOSER_PRIMARY_KEY } from "@corpus/kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transport, wrapperFor, type Transport } from "./testing.js";
import { quotePreview, TodoItemComposer } from "./TodoItemComposer.js";
import type { TodoItemTarget } from "./TodoItemMenu.js";

afterEach(cleanup);

/**
 * The composer *Comment on item* opens, and the request it sends: an ordinary
 * `POST /api/threads` with a §6 selector (sprint-023 TEST-1070). "No new thread
 * shape" is asserted as the wire body, because that is where a new shape would
 * appear.
 */

const SELECTOR = {
  exact: "Call the plumber",
  prefix: "appointment (due: 2026-08-01)\n- [ ] ",
  suffix: "\n- [x] Send the signed form\n",
};

const TARGET: TodoItemTarget = {
  docId: "doc_week",
  listTitle: "Week of Jul 20",
  index: 1,
  item: { text: "Call the plumber", done: false },
};

interface Mounted {
  /** Every `POST /api/threads` body the composer sent, parsed. */
  readonly posted: readonly Record<string, unknown>[];
  readonly container: HTMLElement;
  readonly onCreated: ReturnType<typeof vi.fn>;
  readonly onClose: ReturnType<typeof vi.fn>;
}

function mount(threadsAnswer?: { readonly status: number; readonly body: unknown }): Mounted {
  const wire = transport({});
  const answer = threadsAnswer ?? {
    status: 201,
    body: { thread: { id: "th_new1" }, anchorId: "anc_new1", warnings: [] },
  };
  // `openapi-fetch` — which every core kit hook goes through — hands `fetch` a
  // `Request`, so the body is in the request rather than in an init.
  const posted: Record<string, unknown>[] = [];
  const wired: Transport = {
    ...wire,
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url).pathname !== "/api/threads") return wire.fetch(input, init);
      const raw =
        input instanceof Request
          ? await input.clone().text()
          : typeof init?.body === "string"
            ? init.body
            : "{}";
      posted.push(JSON.parse(raw) as Record<string, unknown>);
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const handlers = { onCreated: vi.fn(), onClose: vi.fn() };
  const { container } = render(
    <TodoItemComposer
      target={TARGET}
      selector={SELECTOR}
      clientX={20}
      clientY={30}
      {...handlers}
    />,
    { wrapper: wrapperFor(wired).Wrapper },
  );
  return { posted, container, ...handlers };
}

const input = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>("Comment");
/**
 * Spelled out rather than imported from the component: the acceptance criterion
 * is the glyph a user reads on the button, and a test that re-used the constant
 * would pass whatever the constant said.
 */
const send = (): HTMLButtonElement => screen.getByText<HTMLButtonElement>("Comment ⌘↵");

describe("TodoItemComposer", () => {
  it("shows the quote it will anchor to, and takes focus", () => {
    mount();
    expect(screen.getByText("“Call the plumber”")).toBeTruthy();
    expect(document.activeElement).toBe(input());
  });

  it("sends nothing until there is something to say", () => {
    const { posted } = mount();
    expect(send().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "   " } });
    expect(send().disabled).toBe(true);
    expect(posted).toEqual([]);
  });

  /** TEST-1070: parent, selector, first turn — the ordinary §6 request. */
  it("creates an ordinary anchored thread on the parent document", async () => {
    const { posted, onCreated } = mount();
    fireEvent.change(input(), { target: { value: "  who was the plumber again?  " } });
    fireEvent.click(send());
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(TARGET, "th_new1");
    });
    expect(posted[0]).toEqual({
      parent: "doc_week",
      selector: SELECTOR,
      body: "who was the plumber again?",
      requestsAgent: true,
    });
  });

  it("sends an explicit false for a note, so a note never becomes a job", async () => {
    const { posted, onCreated } = mount();
    fireEvent.change(input(), { target: { value: "note to self" } });
    fireEvent.click(screen.getByText("◉ ask agent"));
    expect(screen.getByText("○ note only").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(send());
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(posted[0]?.["requestsAgent"]).toBe(false);
  });

  /**
   * PLUGINS-011. This composer sent on `↵` with `⇧↵` for a newline, which was
   * the convention SPEC.md §11 replaced. The contract binds "any composer a
   * plugin contributes", so the reference plugin demonstrates it: `↵` belongs to
   * the text, `⌘↵` sends. The handler is the kit's `handleComposerKeyDown` — its
   * own unit tests cover the contract, and what is asserted here is that this
   * composer is wired to it and to nothing else.
   */
  it("sends on ⌘↵ and leaves ↵ to the text", async () => {
    const { onCreated } = mount();
    fireEvent.change(input(), { target: { value: "first line" } });
    // `fireEvent` returns false once `preventDefault` has been called, so a
    // `true` here is the proof the browser's own newline insertion still runs —
    // in jsdom nothing types into the field, and un-prevented is the behaviour.
    expect(fireEvent.keyDown(input(), { key: "Enter" })).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();
    // ⇧↵ was the old newline chord; it stays a newline and never sends.
    expect(fireEvent.keyDown(input(), { key: "Enter", shiftKey: true })).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(input(), { key: "Enter", metaKey: true })).toBe(false);
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(TARGET, "th_new1");
    });
  });

  /** The chord on the button is the kit's, so it cannot drift from the app's. */
  it("names the key it answers to", () => {
    mount();
    expect(send().textContent).toBe(`Comment ${COMPOSER_PRIMARY_KEY}`);
  });

  /**
   * The keystroke that *commits* an IME composition arrives as `Enter`, and on
   * macOS a user may well be holding ⌘ from the chord before it. Committing
   * "プランを" must put those characters in the field, not post them.
   */
  it("never sends on an IME composition commit", async () => {
    const { posted, onCreated } = mount();
    fireEvent.change(input(), { target: { value: "プランを" } });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true, isComposing: true });
    await Promise.resolve();
    expect(onCreated).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
    // And the composition is still there to be sent deliberately.
    expect(input().value).toBe("プランを");
  });

  /** The field grows with the draft; the mirror that measures it carries it. */
  it("mirrors the draft so the field grows with it", () => {
    const { container } = mount();
    const grow = container.querySelector(".todo-cm-grow");
    expect(grow?.getAttribute("data-replicated-value")).toBe("");
    fireEvent.change(input(), { target: { value: "first line\nsecond line" } });
    expect(grow?.getAttribute("data-replicated-value")).toBe("first line\nsecond line");
  });

  it("closes on Escape from inside the field", () => {
    const { onClose } = mount();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * PR #19 review. The composer used to answer Escape only from its textarea,
   * so pressing the agent toggle first — which moves focus to a button — left
   * the key to the app's own escape chain: the reader **underneath** closed
   * while this popover stayed open, over nothing.
   */
  it("closes on Escape once focus has left the field", () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByText("◉ ask agent"));
    fireEvent.keyDown(screen.getByText("○ note only"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes Escape before the layer behind it can act on it", () => {
    const behind = vi.fn();
    // The app's escape chain listens on `document` in the capture phase; this
    // popover listens on `window`, which captures first.
    document.addEventListener("keydown", behind, true);
    const { onClose } = mount();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener("keydown", behind, true);
  });

  it("dismisses on a click outside, and not on one inside", () => {
    const { onClose } = mount();
    fireEvent.mouseDown(input());
    fireEvent.mouseDown(screen.getByText("“Call the plumber”"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The refusal is one `POST /api/threads` actually declares — a `404` for a
   * parent document that went away while the popover was open (the route's
   * responses are `400`, `401`, `404`). A payload the system cannot produce
   * would prove only that this composer treats every failure alike.
   */
  it("keeps the words and reports the refusal when the server says no", async () => {
    const { onCreated } = mount({
      status: 404,
      body: { code: "not_found", message: "no document doc_week" },
    });
    fireEvent.change(input(), { target: { value: "who was the plumber again?" } });
    fireEvent.click(send());
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Comment failed");
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(input().value).toBe("who was the plumber again?");
  });
});

describe("quotePreview", () => {
  it("flattens whitespace and stops a long quote from becoming the popover", () => {
    expect(quotePreview("  Call   the\nplumber ")).toBe("Call the plumber");
    expect(quotePreview("abcdefghij", 5)).toBe("abcd…");
  });
});
