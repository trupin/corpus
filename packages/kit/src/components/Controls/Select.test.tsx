/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select, type SelectItem } from "./Select.js";

afterEach(cleanup);

/** The three states the composer's owner control needs — `null` included. */
const OWNER_ITEMS: readonly SelectItem<string | null | undefined>[] = [
  { value: undefined, label: "its own agent" },
  { value: null, label: "no owner — the main agent" },
  { value: "researcher", label: "researcher" },
  {
    value: "a-methodical-researcher-of-long-standing",
    label: "a-methodical-researcher-of-long-standing",
  },
];

function Harness({
  onChange,
  start,
}: {
  readonly onChange?: (value: string | null | undefined) => void;
  readonly start?: string | null | undefined;
}): ReactElement {
  const [value, setValue] = useState<string | null | undefined>(start);
  return (
    <Select
      items={OWNER_ITEMS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      label="Who will own this conversation"
      name="owner"
    />
  );
}

function trigger(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Who will own this conversation" });
}

function menu(): HTMLElement {
  return screen.getByRole("menu");
}

function options(): HTMLButtonElement[] {
  return screen.getAllByRole("menuitemradio");
}

describe("Select", () => {
  it("renders no native select anywhere", () => {
    const { container } = render(<Harness />);
    fireEvent.click(trigger());
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("option")).toBeNull();
  });

  it("shows the selected label on the closed pill, with the full value on title", () => {
    render(<Harness start="a-methodical-researcher-of-long-standing" />);
    const value = trigger().querySelector(".select-value");
    expect(value?.textContent).toBe("a-methodical-researcher-of-long-standing");
    expect(value?.getAttribute("title")).toBe("a-methodical-researcher-of-long-standing");
  });

  it("opens on click with the chosen option focused and checked", () => {
    render(<Harness start="researcher" />);
    fireEvent.click(trigger());
    const checked = options().filter((option) => option.getAttribute("aria-checked") === "true");
    expect(checked.map((option) => option.textContent)).toEqual(["researcher"]);
    expect(document.activeElement).toBe(checked[0]);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("carries real values — choosing the null item hands back null, not a string", () => {
    const seen = vi.fn();
    render(<Harness onChange={seen} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "no owner — the main agent" }));
    expect(seen).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is fully operable from the keyboard: arrows move, Enter's default chooses", () => {
    const seen = vi.fn();
    render(<Harness onChange={seen} />);
    const pill = trigger();
    pill.focus();
    fireEvent.keyDown(pill, { key: "ArrowDown" });
    expect(menu()).toBeTruthy();
    const rows = options();
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(menu(), { key: "End" });
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    fireEvent.keyDown(menu(), { key: "Home" });
    expect(document.activeElement).toBe(rows[0]);
    // `↵` activates through the button's own default action — the same
    // contract every menu in the product leans on — so the unit asserts the
    // wiring (a click on the focused row) rather than re-testing the browser.
    fireEvent.click(rows[1] as HTMLButtonElement);
    expect(seen).toHaveBeenCalledWith(null);
  });

  it("type-ahead lands on the first label starting with what was typed", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.keyDown(menu(), { key: "r" });
    expect((document.activeElement as HTMLElement).textContent).toBe("researcher");
    fireEvent.keyDown(menu(), { key: "n" });
    // A fresh buffer only after the type-ahead window; within it, "rn"
    // matches nothing and focus stays put.
    expect((document.activeElement as HTMLElement).textContent).toBe("researcher");
  });

  it("Escape closes with the value unchanged, focus on the trigger, and the key consumed", () => {
    const seen = vi.fn();
    const outside = vi.fn();
    render(<Harness onChange={seen} />);
    document.addEventListener("keydown", outside);
    try {
      fireEvent.click(trigger());
      fireEvent.keyDown(menu(), { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(seen).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger());
      // The press never reached the document — a layer behind this menu
      // cannot act on it (the P5 guarantee).
      expect(outside).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", outside);
    }
  });

  it("marks its open menu for the app's escape chain and as a menu surface", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    expect(menu().hasAttribute("data-kit-menu")).toBe(true);
    // `overlays.ts` watches `[role="menu"]` — the open dropdown takes the
    // board's keys out of scope by being what it claims to be.
    expect(menu().getAttribute("role")).toBe("menu");
  });

  it("an outside press dismisses", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("focuses the trigger before announcing the change, so a caller may move focus last", () => {
    const order: string[] = [];
    render(
      <Harness
        onChange={() => {
          order.push(
            document.activeElement?.getAttribute("aria-label") ??
              document.activeElement?.tagName ??
              "",
          );
        }}
      />,
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "researcher" }));
    expect(order).toEqual(["Who will own this conversation"]);
  });

  /**
   * UI-198, the v0.36.0 P0: WebKit does not focus a button on mousedown — it
   * blurs the focused option to `body` with `relatedTarget: null`, mid-press.
   * The blur-dismiss then unmounted the menu between the option's mousedown
   * and its mouseup, so the `click` that chooses never fired: Safari users
   * could not pick a level at all, and Chromium (which focuses buttons on
   * mousedown) could never show the defect. These tests replay WebKit's exact
   * event order in jsdom, where the engine difference is ours to script.
   */
  describe("WebKit's blur-to-nowhere press (UI-198)", () => {
    it("an option press is not a dismissal: the menu survives to the click, and the click chooses", () => {
      const seen = vi.fn();
      render(<Harness onChange={seen} />);
      fireEvent.click(trigger());
      const row = screen.getByRole("menuitemradio", { name: "researcher" });
      // WebKit's sequence: mousedown on the row, then the focused option
      // blurs to `body` — no related target, document still focused.
      fireEvent.mouseDown(row);
      fireEvent.focusOut(document.activeElement ?? row, { relatedTarget: null });
      expect(screen.queryByRole("menu")).not.toBeNull();
      // The mouseup's click now lands on a row that still exists.
      fireEvent.click(row);
      expect(seen).toHaveBeenCalledWith("researcher");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(trigger().querySelector(".select-value")?.textContent).toBe("researcher");
    });

    it("cancels an option's mousedown, so no engine moves focus for the press at all", () => {
      render(<Harness />);
      fireEvent.click(trigger());
      // `fireEvent` returns false when a handler called preventDefault.
      expect(fireEvent.mouseDown(screen.getByRole("menuitemradio", { name: "researcher" }))).toBe(
        false,
      );
    });

    it("pressing the trigger of an open menu closes it once, with focus on the trigger", () => {
      render(<Harness />);
      fireEvent.click(trigger());
      // WebKit again: the press blurs the focused option to nowhere first. If
      // that blur closed the menu, the click's toggle would re-open it — the
      // blink-and-stay-open defect.
      fireEvent.mouseDown(trigger());
      fireEvent.focusOut(document.activeElement ?? trigger(), { relatedTarget: null });
      expect(screen.queryByRole("menu")).not.toBeNull();
      fireEvent.click(trigger());
      expect(screen.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(trigger());
    });

    it("still dismisses when focus really leaves — a blur with an outside target", () => {
      render(
        <>
          <Harness />
          <button type="button">elsewhere</button>
        </>,
      );
      fireEvent.click(trigger());
      const away = screen.getByRole("button", { name: "elsewhere" });
      fireEvent.focusOut(document.activeElement ?? trigger(), { relatedTarget: away });
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  it("a disabled trigger opens nothing", () => {
    render(
      <Select
        items={OWNER_ITEMS}
        value={undefined}
        onChange={() => undefined}
        label="Who will own this conversation"
        disabled
      />,
    );
    fireEvent.click(trigger());
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
