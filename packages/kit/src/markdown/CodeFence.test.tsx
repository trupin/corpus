/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/harness.js";
import { MarkdownView } from "./MarkdownView.js";

/**
 * Fences as copyable canvases (SPEC.md §10's rider). What is worth testing hard
 * is the **bytes**: a prompt block exists to be pasted into another agent, so a
 * copy that drops a blank line, adds a newline, or smuggles the fence markers in
 * is a wrong answer that looks like a right one.
 */

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
  Reflect.deleteProperty(HTMLPreElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLPreElement.prototype, "clientHeight");
  vi.useRealTimers();
});

/**
 * jsdom lays nothing out: every box is 0 high, so the overflow the collapse
 * decision reads would never be seen. Stubbing the two lengths the component
 * asks for is what puts a *tall* block in front of it — the geometry itself is
 * `fences.spec.ts`'s job, in a browser that actually has one.
 */
function stubHeights(scrollHeight: number, clientHeight: number): void {
  for (const [name, value] of [
    ["scrollHeight", scrollHeight],
    ["clientHeight", clientHeight],
  ] as const) {
    Object.defineProperty(HTMLPreElement.prototype, name, {
      configurable: true,
      get: () => value,
    });
  }
}

/** A block several times the collapse threshold. */
const TALL = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n");

function moreButton(): HTMLElement {
  return screen.getByRole("button", { name: /^(Show all|Show the whole|Collapse)/ });
}

/** jsdom's navigator ships without a clipboard; `null` installs none at all. */
function stubClipboard(writeText: ((text: string) => Promise<void>) | null): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: writeText === null ? undefined : { writeText },
    configurable: true,
    writable: true,
  });
}

function renderMarkdown(markdown: string): HTMLElement {
  const harness = createCorpusTestHarness({
    fetch: () => Promise.resolve(new Response("{}", { status: 404 })),
  });
  return render(<MarkdownView markdown={markdown} />, { wrapper: harness.Wrapper }).container;
}

function copyButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Copy the/ });
}

describe("a fenced block in rendered markdown", () => {
  it("copies the fence's raw text — no markers, no info string, no trailing newline", async () => {
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    renderMarkdown("before\n\n```prompt\nline one\n  indented\n\nline four\n```\n\nafter");

    fireEvent.click(copyButton());

    await waitFor(() => {
      expect(written).toEqual(["line one\n  indented\n\nline four"]);
    });
  });

  /**
   * `mdast-util-to-hast` appends one newline to a code node's value. Exactly
   * that one comes off — a fence whose author left a blank final line keeps it,
   * because that value already ends in "\n" and gains a second.
   */
  it("keeps a deliberately blank final line", async () => {
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    renderMarkdown("```\ntext\n\n```");

    fireEvent.click(copyButton());

    await waitFor(() => {
      expect(written).toEqual(["text\n"]);
    });
  });

  it.each([
    ["backticks and dollars", '```sh\necho "$HOME" `pwd`\n```', 'echo "$HOME" `pwd`'],
    [
      "markdown that must not render",
      "```md\n# not a heading\n- [ ] not a checkbox\n```",
      "# not a heading\n- [ ] not a checkbox",
    ],
    ["a ref that must stay literal", "```\nsee [[doc_a]]\n```", "see [[doc_a]]"],
    ["an empty fence", "```\n```", ""],
  ])("copies %s verbatim", async (_case, markdown, expected) => {
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    renderMarkdown(markdown);

    fireEvent.click(copyButton());

    await waitFor(() => {
      expect(written).toEqual([expected]);
    });
  });

  it("renders the info string as the block's label, and nothing when absent", () => {
    const labelled = renderMarkdown("```prompt\nhi\n```");
    expect(labelled.querySelector(".fence-label")?.textContent).toBe("prompt");

    cleanup();

    const bare = renderMarkdown("```\nhi\n```");
    expect(bare.querySelector(".fence")).not.toBeNull();
    expect(bare.querySelector(".fence-label")).toBeNull();
  });

  it("names the block it copies, so two fences in one turn are told apart", () => {
    renderMarkdown("```prompt\na\n```\n\n```\nb\n```");
    expect(screen.getByRole("button", { name: "Copy the prompt block" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy the code block" })).toBeDefined();
  });

  it("confirms the copy, then restores itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubClipboard(() => Promise.resolve());
    renderMarkdown("```prompt\nhi\n```");
    const button = copyButton();

    fireEvent.click(button);

    await waitFor(() => {
      expect(button.textContent).toBe("Copied");
    });
    expect(button.getAttribute("aria-label")).toBe("Copied the prompt block to the clipboard");

    await act(async () => {
      vi.advanceTimersByTime(1400);
      await Promise.resolve();
    });
    expect(button.textContent).toBe("Copy");
  });

  /** A refusal that looked like a copy would be a promise the app cannot keep. */
  it("says so when the browser refuses the clipboard", async () => {
    stubClipboard(() => Promise.reject(new Error("Write permission denied.")));
    renderMarkdown("```prompt\nhi\n```");
    const button = copyButton();

    fireEvent.click(button);

    await waitFor(() => {
      expect(button.textContent).toBe("Copy failed");
    });
    expect(button.getAttribute("aria-label")).toBe(
      "Could not copy the prompt block — Write permission denied",
    );
    expect(button.getAttribute("title")).toBe("Could not copy — Write permission denied");
  });

  it("says so when the browser exposes no clipboard at all", async () => {
    stubClipboard(null);
    renderMarkdown("```\nhi\n```");
    const button = copyButton();

    fireEvent.click(button);

    await waitFor(() => {
      expect(button.textContent).toBe("Copy failed");
    });
    expect(button.getAttribute("aria-label")).toBe(
      "Could not copy the code block — this browser gives the page no clipboard access",
    );
  });

  it("recovers: a failed copy that is retried succeeds", async () => {
    const written: string[] = [];
    let allowed = false;
    stubClipboard((text) => {
      if (!allowed) return Promise.reject(new Error("denied"));
      written.push(text);
      return Promise.resolve();
    });
    renderMarkdown("```\nhi\n```");
    const button = copyButton();

    fireEvent.click(button);
    await waitFor(() => {
      expect(button.textContent).toBe("Copy failed");
    });

    allowed = true;
    fireEvent.click(button);
    await waitFor(() => {
      expect(button.textContent).toBe("Copied");
    });
    expect(written).toEqual(["hi"]);
    expect(button.getAttribute("title")).toBeNull();
  });

  /** Keyboard reachable: a real `button`, in the tab order, activated by `↵`. */
  it("is a focusable button the keyboard can activate", async () => {
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    renderMarkdown("```prompt\nhi\n```");
    const button = copyButton();

    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("tabindex")).toBeNull();

    button.focus();
    expect(document.activeElement).toBe(button);
    // jsdom does not synthesise the click a browser fires for `↵` on a button;
    // what is asserted here is that the same handler runs with no pointer.
    fireEvent.click(button);
    await waitFor(() => {
      expect(written).toEqual(["hi"]);
    });
  });

  /**
   * The defect a real browser found: `apps/ui` binds `↵` globally on a
   * document-level listener that calls `preventDefault()`, which cancelled the
   * button's activation before the browser could synthesise its click. The
   * button claims its own activation keys — stopped, never prevented.
   */
  it("keeps its activation keys away from a host's global shortcuts", () => {
    stubClipboard(() => Promise.resolve());
    renderMarkdown("```\nhi\n```");
    const button = copyButton();
    const heard: string[] = [];
    const listener = (event: KeyboardEvent): void => {
      heard.push(event.key);
    };
    document.addEventListener("keydown", listener);

    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    fireEvent.keyDown(button, { key: "j" });

    document.removeEventListener("keydown", listener);
    // The host still hears every key that is not this button's to act on.
    expect(heard).toEqual(["j"]);
  });

  it("leaves inline code alone", () => {
    const container = renderMarkdown("a `snippet` in a sentence");
    expect(container.querySelector(".fence")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  /**
   * ── Collapsing a tall block (UI-050) ────────────────────────────────
   *
   * **The invariant, and the reason the feature is safe to have at all**: the
   * copy button puts the *whole* block on the clipboard, collapsed or not. A
   * copy that silently yielded the visible portion would be worse than no
   * collapse — the paste would look complete and be truncated. It holds by
   * construction (the bytes are read off the hast tree, and the DOM the user
   * cannot see is not consulted), and this is what pins it there.
   */
  it("copies the entire block while it is collapsed — and again once expanded", async () => {
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    stubHeights(1230, 420);
    const container = renderMarkdown(`\`\`\`prompt\n${TALL}\n\`\`\``);

    // Located by its hook, not by its name: the name carries the button's
    // state, and the second copy happens while the first is still confirming.
    const copy = container.querySelector("[data-fence-copy]");
    if (copy === null) throw new Error("a copy button was expected");

    expect(container.querySelector("[data-fence-collapsed]")).not.toBeNull();
    fireEvent.click(copy);
    await waitFor(() => {
      expect(written).toEqual([TALL]);
    });
    // 60 lines, of which the collapsed box shows perhaps twenty.
    expect(written[0]?.split("\n")).toHaveLength(60);

    fireEvent.click(moreButton());
    expect(container.querySelector("[data-fence-collapsed]")).toBeNull();

    fireEvent.click(copy);
    await waitFor(() => {
      expect(written).toEqual([TALL, TALL]);
    });
  });

  it("says how much more there is, and goes back", () => {
    stubHeights(1230, 420);
    renderMarkdown(`\`\`\`prompt\n${TALL}\n\`\`\``);
    const toggle = moreButton();

    expect(toggle.textContent).toBe("Show all 60 lines");
    expect(toggle.getAttribute("aria-label")).toBe("Show all 60 lines of the prompt block");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Show less");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse the prompt block");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // Reversible, and back to the same state it started in.
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /^Show all/ })).toBe(toggle);
  });

  /**
   * The block the reports started from: one 400-column prompt line, which is a
   * single line until wrapping turns it into twenty.
   */
  it("counts a single wrapped line as one line", () => {
    stubHeights(600, 420);
    renderMarkdown(`\`\`\`prompt\n${"x".repeat(400)}\n\`\`\``);
    const toggle = moreButton();

    expect(toggle.textContent).toBe("Show the whole line");
    expect(toggle.getAttribute("aria-label")).toBe("Show the whole prompt block");
  });

  /** Per block: expanding one long fence says nothing about the next one. */
  it("keeps the expanded state per block", () => {
    stubHeights(1230, 420);
    renderMarkdown(`\`\`\`prompt\n${TALL}\n\`\`\`\n\n\`\`\`sh\n${TALL}\n\`\`\``);
    const toggles = screen.getAllByRole("button", { name: /^Show all/ });
    expect(toggles).toHaveLength(2);

    const [first, second] = toggles;
    if (first === undefined || second === undefined) throw new Error("two toggles expected");
    fireEvent.click(first);

    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(second.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves a block that fits alone — no toggle, nothing collapsed", () => {
    stubHeights(120, 420);
    const container = renderMarkdown("```prompt\nshort\n```");

    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
    expect(container.querySelector("[data-fence-collapsed]")).toBeNull();
    // The label and the copy button are never what a collapse takes away.
    expect(container.querySelector(".fence-label")?.textContent).toBe("prompt");
    expect(copyButton()).toBeDefined();
  });

  /** The collapse hides no chrome: label above, copy button over the corner. */
  it("keeps the label and the copy button while collapsed", () => {
    stubHeights(1230, 420);
    const container = renderMarkdown(`\`\`\`prompt\n${TALL}\n\`\`\``);
    expect(container.querySelector(".fence-label")?.textContent).toBe("prompt");
    expect(copyButton().getAttribute("aria-label")).toBe("Copy the prompt block");
  });

  /**
   * The block's height is a function of the column's width, and the board's
   * columns are resizable — a block that fits at one width overflows at
   * another, and the affordance has to arrive when it does.
   */
  it("notices a block that only overflows once the column narrows", () => {
    let scroll = 120;
    Object.defineProperty(HTMLPreElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => scroll,
    });
    Object.defineProperty(HTMLPreElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 420,
    });
    renderMarkdown(`\`\`\`prompt\n${TALL}\n\`\`\``);
    expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();

    scroll = 1230;
    fireEvent(globalThis.window, new Event("resize"));
    expect(screen.getByRole("button", { name: /^Show all/ })).toBeDefined();
  });

  /** Same reason the copy button claims them: the host binds `↵` globally. */
  it("keeps the toggle's activation keys away from a host's global shortcuts", () => {
    stubHeights(1230, 420);
    renderMarkdown(`\`\`\`prompt\n${TALL}\n\`\`\``);
    const heard: string[] = [];
    const listener = (event: KeyboardEvent): void => {
      heard.push(event.key);
    };
    document.addEventListener("keydown", listener);

    fireEvent.keyDown(moreButton(), { key: "Enter" });
    fireEvent.keyDown(moreButton(), { key: " " });
    fireEvent.keyDown(moreButton(), { key: "j" });

    document.removeEventListener("keydown", listener);
    expect(heard).toEqual(["j"]);
  });

  it("gives each fence its own button and its own state", async () => {
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    renderMarkdown("```prompt\nfirst\n```\n\n```sh\nsecond\n```");

    const buttons = screen.getAllByRole("button", { name: /^Copy the/ });
    expect(buttons).toHaveLength(2);

    const [first, second] = buttons;
    if (first === undefined || second === undefined) throw new Error("two buttons expected");
    fireEvent.click(second);

    await waitFor(() => {
      expect(second.textContent).toBe("Copied");
    });
    expect(first.textContent).toBe("Copy");
    expect(written).toEqual(["second"]);
  });
});
