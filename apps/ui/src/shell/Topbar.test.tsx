/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../testing/memoryStorage";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "./theme";
import { Topbar } from "./Topbar";

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe("Topbar", () => {
  it("renders the serif wordmark with its mono eyebrow", () => {
    const { container } = render(<Topbar />);
    const wordmark = container.querySelector(".wordmark");
    expect(wordmark?.textContent).toContain("Corpus");
    expect(wordmark?.querySelector("small")?.textContent).toBe("workbench");
  });

  it("renders search as a button — not an input — with the ⌘K hint", () => {
    const { container } = render(<Topbar />);
    const search = screen.getByRole("button", { name: "Search corpus" });
    expect(search.tagName).toBe("BUTTON");
    expect(search.textContent).toContain("Search corpus — documents, threads, skills…");
    expect(search.querySelector("kbd")?.textContent).toBe("⌘K");
    expect(container.querySelector("input")).toBeNull();
  });

  it("renders the accent compose button with the c hint", () => {
    const { container } = render(<Topbar />);
    const compose = container.querySelector(".btn-compose");
    expect(compose?.textContent).toContain("＋ Ask / Capture");
    expect(compose?.querySelector("kbd")?.textContent).toBe("c");
  });

  it("leaves the not-yet-wired affordances enabled and inert", async () => {
    const user = userEvent.setup();
    const { container } = render(<Topbar />);
    const search = screen.getByRole("button", { name: "Search corpus" });
    const compose = container.querySelector(".btn-compose");
    expect(compose).not.toBeNull();

    for (const button of [search, compose]) {
      expect(button?.hasAttribute("disabled")).toBe(false);
      expect(button?.getAttribute("aria-disabled")).toBeNull();
    }

    await user.click(search);
    if (compose !== null) await user.click(compose);
    expect(container.querySelector(".topbar")).not.toBeNull();
  });

  it("exposes the theme toggle with an accessible name naming the current mode", async () => {
    const user = userEvent.setup();
    render(<Topbar />);

    await user.click(screen.getByRole("button", { name: /^Theme: system/ }));

    expect(screen.getByRole("button", { name: /^Theme: light/ })).toBeDefined();
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
