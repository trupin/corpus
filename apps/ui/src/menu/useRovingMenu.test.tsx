/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { menuItems, useRovingMenu } from "./useRovingMenu";

/**
 * The extracted mechanism on its own, over a menu nobody ships: three surfaces
 * now depend on it, and the cases they cannot all arrange — a disabled item in
 * the middle, a menu with no items at all — belong here rather than being
 * proved once in whichever consumer happens to be able to produce them.
 *
 * What the consumers prove instead is that they actually use it, in their own
 * suites and in the real browser.
 */

afterEach(cleanup);

interface HarnessProps {
  readonly autoFocus?: boolean;
  readonly empty?: boolean;
  readonly onDismiss: () => void;
}

function Menu({ autoFocus, empty, onDismiss }: HarnessProps): ReactElement {
  const menu = useRef<HTMLDivElement>(null);
  const roving = useRovingMenu(menu, { autoFocus, onDismiss });
  return (
    <div ref={menu} role="menu" aria-label="Harness" {...roving}>
      {empty === true ? (
        <div className="cp-empty">Nothing here yet</div>
      ) : (
        ["one", "two", "three"].map((id) => (
          <button key={id} type="button" role="menuitem" data-act={id} disabled={id === "two"}>
            {id}
          </button>
        ))
      )}
    </div>
  );
}

function Harness(
  props: Omit<HarnessProps, "onDismiss"> & { onDismiss?: () => void },
): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-opener
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        open
      </button>
      {open ? (
        <Menu
          {...props}
          onDismiss={() => {
            props.onDismiss?.();
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function opener(): HTMLElement {
  return screen.getByRole("button", { name: "open" });
}

function open(props: Omit<HarnessProps, "onDismiss"> & { onDismiss?: () => void } = {}): void {
  render(<Harness {...props} />);
  opener().focus();
  fireEvent.click(opener());
}

const act = (): string | undefined =>
  document.activeElement instanceof HTMLElement ? document.activeElement.dataset["act"] : undefined;

describe("useRovingMenu", () => {
  it("lists the enabled items in document order and tolerates no menu at all", () => {
    open();
    const menu = screen.getByRole("menu");
    expect(menuItems(menu).map((item) => item.dataset["act"])).toEqual(["one", "three"]);
    expect(menuItems(null)).toEqual([]);
  });

  it("takes focus onto the menu when a pointer opened it, and onto the first item for a key", () => {
    open();
    expect(document.activeElement).toBe(screen.getByRole("menu"));
    cleanup();

    open({ autoFocus: true });
    expect(act()).toBe("one");
  });

  it("walks the enabled items with the arrows, Home and End, skipping the disabled one", () => {
    open();
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(act()).toBe("one");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(act()).toBe("three");
    // Clamps rather than wrapping, at both ends.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(act()).toBe("three");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(act()).toBe("one");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(act()).toBe("one");
    fireEvent.keyDown(menu, { key: "End" });
    expect(act()).toBe("three");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(act()).toBe("one");
  });

  it("starts at the last item when ↑ opens the walk", () => {
    open();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(act()).toBe("three");
  });

  it("dismisses on Tab and returns focus to whatever opened it", () => {
    const onDismiss = vi.fn();
    open({ onDismiss });
    const event = fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(event).toBe(false); // preventDefault() was called.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it("hands focus back on any unmount, not only the one it caused", () => {
    open();
    expect(document.activeElement).not.toBe(opener());
    cleanup();
    // `cleanup` unmounts the whole tree, so there is nothing left to focus and
    // the restore must not throw on the detached opener.
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves an empty menu alone: no throw, no trapped focus, keys pass through", () => {
    const onDismiss = vi.fn();
    open({ empty: true, onDismiss });
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(menu);

    const arrow = fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(arrow).toBe(true); // Not prevented — nothing to move to.
    expect(document.activeElement).toBe(menu);
    expect(menuItems(menu)).toEqual([]);

    // Tab still gets the surface out of the way.
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores keys that are not its own", () => {
    open();
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    const prevented = !fireEvent.keyDown(menu, { key: "a" });
    expect(prevented).toBe(false);
    expect(act()).toBe("one");
  });
});
