/** @vitest-environment jsdom */
import type { RowNotice } from "@corpus/kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionMenuItems, type SelectionClipboard } from "./SelectionMenuItems";

/**
 * SPEC.md §11's selection menu: Comment on selection first, then Copy always,
 * then Cut and Paste in editable content.
 *
 * Two halves are worth testing hardest. **The flavors** (UI-042): Copy used to
 * be `writeText`, which holds exactly one, so the right-click Copy stripped
 * every heading, bullet and bold word out of anything pasted into a word
 * processor while ⌘C two keystrokes away kept them. **The clipboard's honesty**:
 * `readText` is permission-gated in every browser that has it, and a Paste that
 * swallows the refusal is indistinguishable from a Paste of an empty clipboard
 * — the user is left believing the clipboard was empty when in fact the page
 * was never allowed to look.
 */

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
  Reflect.deleteProperty(globalThis, "ClipboardItem");
});

/** Installs a clipboard on the jsdom navigator, which ships without one. */
function stubClipboard(clipboard: Partial<SelectionClipboard> | null): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: clipboard ?? undefined,
    configurable: true,
  });
}

/** jsdom has no `ClipboardItem`; this one keeps its flavors readable. */
class FakeClipboardItem {
  constructor(readonly flavors: Record<string, Blob>) {}
}

function stubClipboardItem(): void {
  Object.defineProperty(globalThis, "ClipboardItem", {
    value: FakeClipboardItem,
    configurable: true,
  });
}

/** jsdom's `Blob` has no `text()`; `FileReader` is the reader it does ship. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const read = reader.result;
      // `readAsText` always resolves to a string; the union is `readAsArrayBuffer`'s.
      resolve(typeof read === "string" ? read : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("blob unreadable"));
    reader.readAsText(blob);
  });
}

/** The flavors of the single item a `write` call carried. */
async function flavorsOf(items: readonly unknown[]): Promise<Record<string, string>> {
  const item = items[0];
  if (!(item instanceof FakeClipboardItem)) throw new Error("no ClipboardItem was written");
  const entries = await Promise.all(
    Object.entries(item.flavors).map(async ([type, blob]) => [type, await readBlob(blob)] as const),
  );
  return Object.fromEntries(entries);
}

const HTML = "<h2>Findings</h2><ul><li><p>first <strong>bold</strong> bullet</p></li></ul>";
const TEXT = "## Findings\n\n- first **bold** bullet\n";

interface Mounted {
  readonly notices: RowNotice[];
  readonly replaced: string[];
  readonly commented: number;
  readonly close: ReturnType<typeof vi.fn>;
}

function mount(options: {
  editable: boolean;
  commentable?: boolean;
  html?: string | null;
}): Mounted {
  const notices: RowNotice[] = [];
  const replaced: string[] = [];
  const state = { commented: 0 };
  const close = vi.fn();
  render(
    <SelectionMenuItems
      copy={{
        text: options.html === undefined ? "6.4% this week" : TEXT,
        html: options.html ?? null,
      }}
      onComment={
        options.commentable === false
          ? null
          : () => {
              state.commented += 1;
            }
      }
      onReplace={
        options.editable
          ? (text) => {
              replaced.push(text);
            }
          : null
      }
      close={close}
      onNotify={(notice) => notices.push(notice)}
    />,
  );
  return {
    notices,
    replaced,
    get commented() {
      return state.commented;
    },
    close,
  };
}

function items(): string[] {
  return screen.getAllByRole("menuitem").map((item) => item.dataset["act"] ?? "");
}

/**
 * The two shapes the app actually mounts (PR #13 review, NIT 4 + MAJOR).
 *
 * The document body is either the editor's — unlocked, so commentable *and*
 * editable — or it is not the editor's at all: a thread's conversation, a
 * `view`'s query, or a document under someone else's lock, where neither
 * commenting nor editing is on offer and §11's "Copy always" is the whole menu.
 * There is no reachable state in between, which is why only these two are
 * pinned here.
 */
describe("the selection menu's item set", () => {
  it("puts Comment first and offers the clipboard basics in the editor's body", () => {
    stubClipboard({ writeText: vi.fn() });
    mount({ editable: true });
    expect(items()).toEqual(["comment", "copy", "cut", "paste"]);
  });

  it("is Copy alone where the body is neither commentable nor editable", () => {
    stubClipboard({ writeText: vi.fn() });
    mount({ editable: false, commentable: false });
    expect(items()).toEqual(["copy"]);
  });
});

describe("Comment on selection", () => {
  it("runs the captured comment action and closes", () => {
    stubClipboard({ writeText: vi.fn() });
    const mounted = mount({ editable: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
    expect(mounted.commented).toBe(1);
    expect(mounted.close).toHaveBeenCalledOnce();
  });
});

/**
 * UI-042. The reproduction: right-click → Copy put `["text/plain"]` on the
 * clipboard and no `text/html` at all, which is "loses ALL formatting" in a
 * word processor, from the gesture SPEC.md §11 puts Copy on.
 */
describe("Copy's two flavors", () => {
  it("writes rich text and the markdown together", async () => {
    const write = vi.fn<(items: readonly ClipboardItem[]) => Promise<void>>().mockResolvedValue();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    stubClipboard({ write, writeText });
    stubClipboardItem();
    const mounted = mount({ editable: true, html: HTML });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy/ }));

    await waitFor(() => {
      expect(write).toHaveBeenCalledOnce();
    });
    expect(await flavorsOf(write.mock.calls[0]?.[0] ?? [])).toEqual({
      "text/html": HTML,
      "text/plain": TEXT,
    });
    // The single-flavor path is not also taken: one copy, one clipboard state.
    expect(writeText).not.toHaveBeenCalled();
    expect(mounted.notices).toEqual([]);
  });

  it("cuts the same two flavors it copies", async () => {
    const write = vi.fn<(items: readonly ClipboardItem[]) => Promise<void>>().mockResolvedValue();
    stubClipboard({ write, writeText: vi.fn() });
    stubClipboardItem();
    const mounted = mount({ editable: true, html: HTML });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Cut/ }));

    await waitFor(() => {
      expect(mounted.replaced).toEqual([""]);
    });
    expect(await flavorsOf(write.mock.calls[0]?.[0] ?? [])).toEqual({
      "text/html": HTML,
      "text/plain": TEXT,
    });
  });

  it.each([
    ["the selection has no rich form", { writeTextOnly: false, html: null }],
    ["the browser's clipboard is text-only", { writeTextOnly: true, html: HTML }],
  ])("falls back to plain text when %s", async (_case, options) => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    const write = vi.fn<(items: readonly ClipboardItem[]) => Promise<void>>().mockResolvedValue();
    stubClipboard(options.writeTextOnly ? { writeText } : { write, writeText });
    stubClipboardItem();
    mount({ editable: true, html: options.html });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(TEXT);
    });
    expect(write).not.toHaveBeenCalled();
  });

  /**
   * Safari refuses a `ClipboardItem` built across an `await`. Losing the
   * formatting is a degradation; losing the text as well is a failed copy.
   */
  it("degrades to plain text when the multi-flavor write is refused", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    stubClipboard({
      write: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
      writeText,
    });
    stubClipboardItem();
    const mounted = mount({ editable: true, html: HTML });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(TEXT);
    });
    expect(mounted.notices).toEqual([]);
  });

  it("reports the failure when neither write works", async () => {
    stubClipboard({
      write: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
      writeText: vi.fn().mockRejectedValue(new Error("write not allowed")),
    });
    stubClipboardItem();
    const mounted = mount({ editable: true, html: HTML });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy/ }));

    await waitFor(() => {
      expect(mounted.notices).toHaveLength(1);
    });
    expect(mounted.notices[0]).toEqual({
      tone: "error",
      message: "Could not copy — write not allowed",
    });
  });
});

describe("the clipboard items", () => {
  it("copies the text captured when the menu opened", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    stubClipboard({ writeText });
    const mounted = mount({ editable: true });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("6.4% this week");
    });
    expect(mounted.notices).toEqual([]);
  });

  it("cuts by copying first and removing only once the clipboard has it", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    stubClipboard({ writeText });
    const mounted = mount({ editable: true });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Cut/ }));

    await waitFor(() => {
      expect(mounted.replaced).toEqual([""]);
    });
    expect(writeText).toHaveBeenCalledWith("6.4% this week");
  });

  it("leaves the document alone when a cut's copy is refused, and says so", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("write not allowed")) });
    const mounted = mount({ editable: true });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Cut/ }));

    await waitFor(() => {
      expect(mounted.notices).toHaveLength(1);
    });
    expect(mounted.notices[0]).toEqual({
      tone: "error",
      message: "Could not copy — write not allowed",
    });
    expect(mounted.replaced).toEqual([]);
  });

  it("pastes what the clipboard reads", async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue("pasted words") });
    const mounted = mount({ editable: true });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Paste/ }));

    await waitFor(() => {
      expect(mounted.replaced).toEqual(["pasted words"]);
    });
    expect(mounted.notices).toEqual([]);
  });

  it("fails visibly when the browser refuses to read the clipboard", async () => {
    stubClipboard({ readText: vi.fn().mockRejectedValue(new Error("Read permission denied.")) });
    const mounted = mount({ editable: true });

    fireEvent.click(screen.getByRole("menuitem", { name: /^Paste/ }));

    await waitFor(() => {
      expect(mounted.notices).toHaveLength(1);
    });
    expect(mounted.notices[0]?.tone).toBe("error");
    // The browser's own trailing stop is dropped: the sentence continues.
    expect(mounted.notices[0]?.message).toContain("Could not paste — Read permission denied.");
    expect(mounted.notices[0]?.message).not.toContain("denied..");
    expect(mounted.notices[0]?.message).toContain("needs the browser's permission");
    expect(mounted.replaced).toEqual([]);
  });

  it.each([/^Copy/, /^Paste/])(
    "says so when the browser exposes no clipboard at all (%s)",
    async (label) => {
      stubClipboard(null);
      const mounted = mount({ editable: true });

      fireEvent.click(screen.getByRole("menuitem", { name: label }));

      await waitFor(() => {
        expect(mounted.notices).toHaveLength(1);
      });
      expect(mounted.notices[0]).toEqual({
        tone: "error",
        message: "This browser gives the page no clipboard access.",
      });
      expect(mounted.replaced).toEqual([]);
    },
  );
});
