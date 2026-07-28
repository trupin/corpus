/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgeChip, LockChip, NeedsYouBadge, UnreadBadge, WorkingDot } from "./badges.js";

afterEach(cleanup);

describe("UnreadBadge", () => {
  it("renders the accent pill with a count and an accessible label", () => {
    const { container } = render(<UnreadBadge count={3} />);
    const badge = container.querySelector(".unread");
    expect(badge?.textContent).toBe("3");
    expect(badge?.getAttribute("aria-label")).toBe("3 unread turns");
  });

  it("reads `new` when the wire carries no count, and still names itself", () => {
    // `DocRow.unread` is a boolean; a number would be an invention.
    const { container } = render(<UnreadBadge />);
    const badge = container.querySelector(".unread");
    expect(badge?.textContent).toBe("new");
    expect(badge?.getAttribute("aria-label")).toContain("Unread");
  });

  it.each([0, null])("treats %s as no count", (count) => {
    render(<UnreadBadge count={count} />);
    expect(screen.getByTitle(/Unread/)).toHaveProperty("textContent", "new");
  });
});

describe("NeedsYouBadge", () => {
  it("renders the signal pill with the short text", () => {
    const { container } = render(<NeedsYouBadge text="form" />);
    const badge = container.querySelector(".needs-you");
    expect(badge?.textContent).toBe("form");
    expect(badge?.getAttribute("aria-label")).toBe("form");
  });

  it("takes a longer accessible label when the short text is cryptic", () => {
    render(<NeedsYouBadge text="3 due" label="Three items are due today" />);
    expect(screen.getByLabelText("Three items are due today").textContent).toBe("3 due");
  });
});

describe("WorkingDot", () => {
  it("names what is running — a bare pulsing dot is invisible to a screen reader", () => {
    const { container } = render(<WorkingDot title="Agent is filing this document" />);
    const dot = container.querySelector(".working-dot");
    expect(dot?.getAttribute("title")).toBe("Agent is filing this document");
    expect(dot?.getAttribute("role")).toBe("status");
  });
});

describe("AgeChip", () => {
  it("renders the mono age chip", () => {
    const { container } = render(<AgeChip label="stale · 8mo" />);
    expect(container.querySelector(".age")?.textContent).toBe("stale · 8mo");
  });
});

describe("LockChip", () => {
  it("renders the warn chip naming the holder", () => {
    const { container } = render(<LockChip holder="agent" />);
    const chip = container.querySelector(".chip.warn");
    expect(chip?.textContent).toContain("🔒");
    expect(chip?.textContent).toContain("agent editing");
    expect(chip?.getAttribute("aria-label")).toBe("agent is editing this document");
  });
});
