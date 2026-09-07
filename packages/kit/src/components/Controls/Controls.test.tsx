/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, buttonClassName } from "./Button.js";
import { Chip, chipClassName } from "./Chip.js";
import { IconButton } from "./IconButton.js";
import { Modal } from "./Modal.js";
import { Popover } from "./Popover.js";
import { MIN_USABLE_HEIGHT_PX, MIN_USABLE_HEIGHT_TOKEN, ScrollArea } from "./ScrollArea.js";

afterEach(cleanup);

describe("Button", () => {
  it("defaults to type=button, so a form cannot be submitted by accident", () => {
    render(<Button>go</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("keeps an explicit submit type", () => {
    render(<Button type="submit">save</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  it.each([
    ["primary", undefined, "btn btn-primary"],
    ["outline", "btn-capture", "btn btn-outline btn-capture"],
    ["quiet", undefined, "btn btn-quiet"],
    ["bare", "job sel", "job sel"],
    [undefined, "job", "job"],
  ] as const)("variant %s merges classes as %s → %s", (variant, className, expected) => {
    expect(buttonClassName(variant, className)).toBe(expected);
  });

  it("passes data attributes and disabled through", () => {
    render(
      <Button variant="quiet" data-lane-release="th_1" disabled>
        Release
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("data-lane-release")).toBe("th_1");
    expect(button).toHaveProperty("disabled", true);
  });
});

describe("IconButton", () => {
  it("requires and renders the accessible name, echoed as title", () => {
    render(<IconButton label="Toggle explorer">☰</IconButton>);
    const button = screen.getByRole("button", { name: "Toggle explorer" });
    expect(button.getAttribute("title")).toBe("Toggle explorer");
  });

  it("lets a richer title stand without touching the name", () => {
    render(
      <IconButton label="Toggle explorer" title="Explorer (⌘B)">
        ☰
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Toggle explorer" });
    expect(button.getAttribute("title")).toBe("Explorer (⌘B)");
  });
});

describe("Chip", () => {
  it.each([
    [undefined, "chip"],
    ["default", "chip"],
    ["on", "chip on"],
    ["warn", "chip warn"],
    ["good", "chip good"],
    ["ghost", "chip ghost"],
  ] as const)("variant %s renders the mockup's %s classes", (variant, expected) => {
    expect(chipClassName(variant, undefined)).toBe(expected);
  });

  it("is a real button with the variant recorded for the suites", () => {
    render(
      <Chip variant="ghost" data-save-view="">
        ＋ save view
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "＋ save view" });
    expect(chip.getAttribute("type")).toBe("button");
    expect(chip.getAttribute("data-chip-variant")).toBe("ghost");
    expect(chip.className).toBe("chip ghost");
  });
});

describe("Popover", () => {
  it("always renders a close affordance — no prop can remove it", () => {
    render(
      <Popover label="Send options" onClose={() => undefined}>
        <p>content</p>
      </Popover>,
    );
    expect(screen.getByRole("button", { name: "Close Send options" })).toBeTruthy();
  });

  it("Escape closes, is consumed before the document, and focus returns to the opener", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const outside = vi.fn();
    document.addEventListener("keydown", outside);
    const onClose = vi.fn();
    try {
      const { unmount } = render(
        <Popover label="Send options" onClose={onClose}>
          <button type="button">inner</button>
        </Popover>,
      );
      const inner = screen.getByRole("button", { name: "inner" });
      inner.focus();
      fireEvent.keyDown(inner, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(outside).not.toHaveBeenCalled();
      unmount();
      expect(document.activeElement).toBe(opener);
    } finally {
      document.removeEventListener("keydown", outside);
      opener.remove();
    }
  });

  it("an outside press dismisses; an inside press does not", () => {
    const onClose = vi.fn();
    render(
      <Popover label="Send options" onClose={onClose}>
        <button type="button">inner</button>
      </Popover>,
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: "inner" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("carries the chain marker and a real dialog role", () => {
    render(
      <Popover label="Send options" onClose={() => undefined}>
        <p>content</p>
      </Popover>,
    );
    const dialog = screen.getByRole("dialog", { name: "Send options" });
    expect(dialog.hasAttribute("data-kit-menu")).toBe(true);
    expect(dialog.hasAttribute("data-kit-popover")).toBe(true);
  });

  it("Tab wraps from the last focusable back to the first", () => {
    render(
      <Popover label="Send options" onClose={() => undefined}>
        <button type="button">inner</button>
      </Popover>,
    );
    const last = screen.getByRole("button", { name: "inner" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close Send options" }));
  });
});

describe("Modal", () => {
  it("renders the .overlay.open scrim — the DOM contract overlays.ts reads", () => {
    const { container } = render(
      <Modal label="New kanban" onClose={() => undefined}>
        <p>form</p>
      </Modal>,
    );
    expect(container.querySelector(".overlay.open")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "New kanban" }).getAttribute("aria-modal")).toBe(
      "true",
    );
  });

  it("Escape closes and a scrim press closes; the ✕ is unconditional", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal label="New kanban" onClose={onClose}>
        <p>form</p>
      </Modal>,
    );
    fireEvent.keyDown(screen.getByRole("dialog", { name: "New kanban" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    const scrim = container.querySelector(".overlay.open");
    if (scrim === null) throw new Error("no scrim");
    fireEvent.mouseDown(scrim);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Close New kanban" })).toBeTruthy();
  });
});

describe("ScrollArea", () => {
  it("renders the region with the overflow report", () => {
    const { container } = render(
      <ScrollArea aria-label="roster">
        <p>rows</p>
      </ScrollArea>,
    );
    const region = container.querySelector(".scroll-region");
    // jsdom has no layout, so heights are 0: unmeasurable is not too short,
    // and the report says "not overflowing" rather than throwing.
    expect(region?.getAttribute("data-overflowing")).toBe("false");
  });

  it("pins its constant to the token tokens.css declares", () => {
    const tokens = readFileSync(join(import.meta.dirname, "..", "..", "tokens.css"), "utf8");
    expect(tokens).toContain(`${MIN_USABLE_HEIGHT_TOKEN}: ${String(MIN_USABLE_HEIGHT_PX)}px;`);
  });
});
