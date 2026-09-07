/** @vitest-environment jsdom */
import type { CostBucket } from "@corpus/contract";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CostChart, costDomainMax } from "./CostChart.js";

afterEach(cleanup);

function bucket(overrides: Partial<CostBucket> = {}): CostBucket {
  const readTokens = overrides.readTokens ?? 100;
  const wroteTokens = overrides.wroteTokens ?? 10;
  return {
    from: overrides.from ?? "2026-09-01T00:00:00.000Z",
    to: overrides.to ?? "2026-09-02T00:00:00.000Z",
    readTokens,
    wroteTokens,
    invocations: overrides.invocations ?? 1,
    byCommand: overrides.byCommand ?? { "doc show": readTokens + wroteTokens },
  };
}

function draw(buckets: readonly CostBucket[], sizeTokens: number): SVGElement | null {
  const { container } = render(
    <CostChart buckets={buckets} sizeTokens={sizeTokens} label="cost over time" />,
  );
  return container.querySelector<SVGElement>(".cost-chart");
}

describe("costDomainMax", () => {
  it("fits the busiest bucket's stacked total", () => {
    expect(costDomainMax([bucket({ readTokens: 100, wroteTokens: 10 })], 0)).toBe(110);
  });

  /**
   * The reference line is inside the domain on purpose: the comparison it exists
   * to make is between a day's cost and what the document weighs, and a line
   * parked off-scale would answer nothing.
   */
  it("fits the reference line too, even when it dwarfs the series", () => {
    expect(costDomainMax([bucket({ readTokens: 1, wroteTokens: 0 })], 9000)).toBe(9000);
  });

  it("never returns zero, so nothing divides by it", () => {
    expect(costDomainMax([bucket({ readTokens: 0, wroteTokens: 0 })], 0)).toBe(1);
    expect(costDomainMax([], 0)).toBe(1);
  });
});

describe("CostChart", () => {
  it("draws nothing at all with no buckets — the panel says why instead", () => {
    expect(draw([], 100)).toBeNull();
  });

  it("draws one stacked bar per bucket, wrote above read", () => {
    const chart = draw(
      [
        bucket({ from: "2026-09-01T00:00:00.000Z", readTokens: 100, wroteTokens: 10 }),
        bucket({ from: "2026-09-02T00:00:00.000Z", readTokens: 50, wroteTokens: 5 }),
      ],
      0,
    );
    expect(chart?.getAttribute("data-buckets")).toBe("2");
    const read = chart?.querySelector<SVGRectElement>(
      '[data-bucket="2026-09-01T00:00:00.000Z"] .cost-read',
    );
    const wrote = chart?.querySelector<SVGRectElement>(
      '[data-bucket="2026-09-01T00:00:00.000Z"] .cost-wrote',
    );
    expect(read?.getAttribute("data-tokens")).toBe("100");
    expect(wrote?.getAttribute("data-tokens")).toBe("10");

    // Stacked: the wrote rect's bottom edge is the read rect's top edge.
    const readY = Number(read?.getAttribute("y"));
    const wroteY = Number(wrote?.getAttribute("y"));
    const wroteHeight = Number(wrote?.getAttribute("height"));
    expect(wroteY + wroteHeight).toBeCloseTo(readY, 6);
  });

  it("puts the buckets in the order they arrived, left to right", () => {
    const chart = draw(
      [
        bucket({ from: "2026-09-01T00:00:00.000Z" }),
        bucket({ from: "2026-09-02T00:00:00.000Z" }),
        bucket({ from: "2026-09-03T00:00:00.000Z" }),
      ],
      0,
    );
    const xs = [...(chart?.querySelectorAll(".cost-read") ?? [])].map((rect) =>
      Number(rect.getAttribute("x")),
    );
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeLessThan(xs[1] ?? 0);
    expect(xs[1] ?? 0).toBeLessThan(xs[2] ?? 0);
  });

  /**
   * The honesty rule that survives the squash. A day that cost eleven tokens
   * against a hundred-thousand-token document is a *cheap* day, not an absent
   * one, and a bar rounded to nothing would say the opposite.
   */
  it("never draws a measured bucket as nothing", () => {
    const chart = draw([bucket({ readTokens: 1, wroteTokens: 1 })], 100_000);
    const rects = [...(chart?.querySelectorAll(".cost-read, .cost-wrote") ?? [])];
    expect(rects).toHaveLength(2);
    for (const rect of rects) {
      /*
       * 1.5 viewBox units, not 1. The panel renders 140 units as ~96 CSS pixels
       * in a column, so a floor of 1 came out as a 0.68 px sliver in a real
       * browser — in the DOM, invisible on screen. This threshold is the pixel.
       */
      expect(Number(rect.getAttribute("height"))).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("draws no rect at all for a direction that cost nothing", () => {
    const chart = draw([bucket({ readTokens: 40, wroteTokens: 0 })], 0);
    expect(chart?.querySelectorAll(".cost-read")).toHaveLength(1);
    expect(chart?.querySelectorAll(".cost-wrote")).toHaveLength(0);
  });

  it("draws the reference line once, across the whole span, and never for an empty document", () => {
    const measured = draw([bucket()], 500);
    const line = measured?.querySelector(".cost-size");
    expect(line?.getAttribute("data-size-tokens")).toBe("500");
    expect(line?.getAttribute("x1")).toBe("0");
    expect(Number(line?.getAttribute("y1"))).toBe(Number(line?.getAttribute("y2")));

    cleanup();
    expect(draw([bucket()], 0)?.querySelectorAll(".cost-size")).toHaveLength(0);
  });

  it("is one image to a screen reader, labelled by the panel", () => {
    const chart = draw([bucket()], 500);
    expect(chart?.getAttribute("role")).toBe("img");
    expect(chart?.getAttribute("aria-label")).toBe("cost over time");
    // No text inside the drawing: every word is HTML in the panel around it.
    expect(chart?.querySelectorAll("text")).toHaveLength(0);
  });
});
