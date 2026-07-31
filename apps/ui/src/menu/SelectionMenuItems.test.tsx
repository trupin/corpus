/** @vitest-environment jsdom */
import type { RowNotice } from "@corpus/kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionMenuItems, type SelectionClipboard } from "./SelectionMenuItems";

/**
 * SPEC.md §11's selection menu: Comment on selection first, then Copy always,
 * then Cut and Paste in editable content.
 *
 * The half worth testing hardest is the clipboard's honesty. `readText` is
 * permission-gated in every browser that has it, and a Paste that swallows the
 * refusal is indistinguishable from a Paste of an empty clipboard — the user is
 * left believing the clipboard was empty when in fact the page was never
 * allowed to look.
 */

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
});

/** Installs a clipboard on the jsdom navigator, which ships without one. */
function stubClipboard(clipboard: Partial<SelectionClipboard> | null): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: clipboard ?? undefined,
    configurable: true,
  });
}

interface Mounted {
  readonly notices: RowNotice[];
  readonly replaced: string[];
  readonly commented: number;
  readonly close: ReturnType<typeof vi.fn>;
}

function mount(options: { editable: boolean; commentable?: boolean }): Mounted {
  const notices: RowNotice[] = [];
  const replaced: string[] = [];
  const state = { commented: 0 };
  const close = vi.fn();
  render(
    <SelectionMenuItems
      text="6.4% this week"
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
