/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { docRowFixture } from "../testing/docRow.js";
import { AgeChip, NeedsYouBadge, UnreadBadge, WorkingDot, unreadBadgeProps } from "./badges.js";

afterEach(cleanup);

describe("UnreadBadge", () => {
  it("renders the accent pill with a count and an accessible label", () => {
    const { container } = render(<UnreadBadge count={3} />);
    const badge = container.querySelector(".unread");
    expect(badge?.textContent).toBe("3");
    expect(badge?.getAttribute("aria-label")).toBe("3 unread turns");
  });

  it("names threads rather than turns when the number counts conversations", () => {
    render(<UnreadBadge count={3} unit="threads" />);
    expect(screen.getByLabelText("3 unread threads").textContent).toBe("3");
  });

  it.each([
    ["threads", "1 unread thread"],
    ["turns", "1 unread turn"],
  ] as const)("says one unread %s in the singular", (unit, label) => {
    render(<UnreadBadge count={1} unit={unit} />);
    expect(screen.getByLabelText(label).textContent).toBe("1");
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

describe("unreadBadgeProps", () => {
  const thread = (unread: boolean, unreadThreads = 0) =>
    docRowFixture({ type: "thread", parent: "doc_a", unread, unreadThreads });

  it("gives a document row its server-computed aggregate, counted in threads", () => {
    expect(unreadBadgeProps(docRowFixture({ unreadThreads: 3 }))).toEqual({
      count: 3,
      unit: "threads",
    });
  });

  it("gives a document row with nothing unread no pill at all", () => {
    expect(unreadBadgeProps(docRowFixture({ unreadThreads: 0 }))).toBeNull();
  });

  it("gives an unread thread row the countless `new` pill", () => {
    expect(unreadBadgeProps(thread(true))).toEqual({ unit: "turns" });
  });

  it("gives a seen thread row no pill", () => {
    expect(unreadBadgeProps(thread(false))).toBeNull();
  });

  // The one row that could plausibly draw two: a thread that is itself unread
  // and whose `unreadThreads` is non-zero. The wire pins it to 0 for threads,
  // but the branch — not the fixture — is what guarantees a single pill.
  it("never draws both axes: a thread row ignores `unreadThreads`", () => {
    expect(unreadBadgeProps(thread(true, 4))).toEqual({ unit: "turns" });
    expect(unreadBadgeProps(thread(false, 4))).toBeNull();
  });

  it("lets a host that knows better override the count on either kind", () => {
    expect(unreadBadgeProps(thread(true), 2)).toEqual({ count: 2, unit: "turns" });
    expect(unreadBadgeProps(docRowFixture({ unreadThreads: 3 }), 9)).toEqual({
      count: 9,
      unit: "threads",
    });
  });

  it.each([null, undefined])("treats a %s override as no override", (override) => {
    expect(unreadBadgeProps(docRowFixture({ unreadThreads: 3 }), override)).toEqual({
      count: 3,
      unit: "threads",
    });
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
