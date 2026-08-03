/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/harness.js";
import { MarkdownView } from "./MarkdownView.js";

/**
 * Fences as copyable canvases (SPEC.md §11's rider). What is worth testing hard
 * is the **bytes**: a prompt block exists to be pasted into another agent, so a
 * copy that drops a blank line, adds a newline, or smuggles the fence markers in
 * is a wrong answer that looks like a right one.
 */

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
  vi.useRealTimers();
});

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
