/** @vitest-environment jsdom */
import type { DocumentCost } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  costBucketFixture,
  costFixture,
  costPath,
  docFixture,
  readerTransport,
} from "../testing/readerFixture";
import { byCommandTotals, CostPanel, groupDigits, windowTotal } from "./CostPanel";

afterEach(cleanup);

const DOC_ID = "doc_costly";

function renderPanel(cost?: DocumentCost): { readonly container: HTMLElement } {
  const transport = readerTransport({
    docs: [docFixture({ frontmatter: { id: DOC_ID } })],
    ...(cost === undefined ? {} : { cost: { [DOC_ID]: cost } }),
  });
  const harness = createCorpusTestHarness({ fetch: transport.fetch });
  const Wrapped = (): ReactElement => (
    <harness.Wrapper>
      <CostPanel docId={DOC_ID} />
    </harness.Wrapper>
  );
  return { container: render(<Wrapped />).container };
}

/** Waits for the panel to have settled into one of its terminal states. */
async function settled(container: HTMLElement, state: string): Promise<HTMLElement> {
  return waitFor(() => {
    const note = container.querySelector<HTMLElement>(`.cost-note[data-state="${state}"]`);
    expect(note).not.toBeNull();
    return note as HTMLElement;
  });
}

describe("the measurements panel", () => {
  it("names the four unit helpers without a locale", () => {
    // `Intl` output moves with the machine's locale, and a panel figure that
    // renders `1 234` on one laptop and `1,234` on another is a figure no
    // e2e assertion can pin.
    expect(groupDigits(0)).toBe("0");
    expect(groupDigits(999)).toBe("999");
    expect(groupDigits(1000)).toBe("1,000");
    expect(groupDigits(1234567)).toBe("1,234,567");
  });

  it("sums a window over both directions and every bucket", () => {
    const buckets = [
      costBucketFixture({ from: "2026-09-01T00:00:00.000Z", readTokens: 100, wroteTokens: 10 }),
      costBucketFixture({ from: "2026-09-02T00:00:00.000Z", readTokens: 40, wroteTokens: 4 }),
    ];
    expect(windowTotal(buckets)).toBe(154);
  });

  /**
   * The contract fixes the conversion grain so that a breakdown adds up to its
   * own total exactly. This is the assertion that would fail if the panel ever
   * re-converted bytes instead of adding the server's whole tokens.
   */
  it("adds the by-command breakdown up to the window total, dearest first", () => {
    const buckets = [
      costBucketFixture({
        from: "2026-09-01T00:00:00.000Z",
        readTokens: 100,
        wroteTokens: 10,
        byCommand: { "doc show": 100, "thread show": 10 },
      }),
      costBucketFixture({
        from: "2026-09-02T00:00:00.000Z",
        readTokens: 40,
        wroteTokens: 4,
        byCommand: { "thread show": 44 },
      }),
    ];
    const totals = byCommandTotals(buckets);
    expect(totals).toEqual([
      ["doc show", 100],
      ["thread show", 54],
    ]);
    expect(totals.reduce((sum, [, tokens]) => sum + tokens, 0)).toBe(windowTotal(buckets));
  });

  it("keeps loading distinguishable from an empty ledger", async () => {
    const { container } = renderPanel();
    // Before the answer lands: a heading and a loading note, never a claim.
    expect(container.querySelector('.cost-note[data-state="loading"]')).not.toBeNull();
    expect(container.querySelector('.cost-note[data-state="unmeasured"]')).toBeNull();
    await settled(container, "unmeasured");
    expect(container.querySelector('.cost-note[data-state="loading"]')).toBeNull();
  });

  /**
   * The deviation from `RelatedPanel`'s render-nothing rule, asserted. A panel
   * that vanished here would let an unmeasured document read as a free one.
   */
  it("says measurement has not started, rather than drawing an empty chart", async () => {
    const { container } = renderPanel({
      granularity: "day",
      buckets: [],
      total: 0,
      truncated: false,
      sizeBytes: 900,
      measuringSince: null,
    });
    const note = await settled(container, "unmeasured");
    expect(note.textContent).toContain("Measurement has not started");
    expect(container.querySelector(".cost h3")?.textContent).toBe("Measurements");
    expect(container.querySelector(".cost-chart")).toBeNull();
  });

  /**
   * *This workspace has measured nothing* and *nothing here has named this
   * document* are different sentences, and only `measuringSince` tells them
   * apart. A panel deriving emptiness from `buckets.length` alone would say the
   * first one in both cases.
   */
  it("tells an unmeasured workspace from an unmeasured document", async () => {
    const { container } = renderPanel(
      costFixture({ buckets: [], total: 0, measuringSince: "2026-08-28T09:14:00.000Z" }),
    );
    const note = await settled(container, "empty");
    expect(note.textContent).toContain("No measurements for this document");
    expect(note.textContent).toContain("2026-08-28");
    expect(container.querySelector(".cost-chart")).toBeNull();
  });

  it("draws both series against the size line, and labels the line as today's size", async () => {
    const { container } = renderPanel(
      costFixture({
        sizeBytes: 4000,
        buckets: [
          costBucketFixture({ from: "2026-09-01T00:00:00.000Z", readTokens: 120, wroteTokens: 12 }),
          costBucketFixture({ from: "2026-09-02T00:00:00.000Z", readTokens: 90, wroteTokens: 8 }),
          costBucketFixture({ from: "2026-09-03T00:00:00.000Z", readTokens: 110, wroteTokens: 10 }),
        ],
      }),
    );
    const chart = await waitFor(() => {
      const svg = container.querySelector(".cost-chart");
      expect(svg).not.toBeNull();
      return svg as SVGElement;
    });

    expect(chart.getAttribute("data-buckets")).toBe("3");
    expect(chart.querySelectorAll(".cost-read")).toHaveLength(3);
    expect(chart.querySelectorAll(".cost-wrote")).toHaveLength(3);

    // 4000 bytes ÷ 4, rounded up — the contract's own conversion, and the
    // number the reference line is drawn at.
    const size = chart.querySelector(".cost-size");
    expect(size?.getAttribute("data-size-tokens")).toBe("1000");
    // One line, not a series: exactly one, spanning the whole width.
    expect(chart.querySelectorAll(".cost-size")).toHaveLength(1);

    const legend = container.querySelector(".cost-key.size");
    expect(legend?.textContent).toContain("current size");
    expect(legend?.textContent).toContain("1,000");

    const note = container.querySelector('.cost-note[data-state="series"]');
    expect(note?.textContent).toContain("Tokens are this workspace’s estimate");
    expect(note?.textContent).toContain("3 daily buckets");
    expect(note?.textContent).toContain("today");
    // read 320 + wrote 30
    expect(note?.textContent).toContain("350 tokens");
  });

  /**
   * The size line is in the y-domain even when it dwarfs the series — that is
   * the comparison the panel exists to make. What must never happen is a
   * measured day drawn as nothing.
   */
  it("keeps a measured bucket visible under a size line that dwarfs it", async () => {
    const { container } = renderPanel(
      costFixture({
        // 400,000 bytes ⇒ 100,000 tokens, against buckets costing 11.
        sizeBytes: 400_000,
        buckets: [costBucketFixture({ readTokens: 10, wroteTokens: 1 })],
      }),
    );
    const chart = await waitFor(() => {
      const svg = container.querySelector(".cost-chart");
      expect(svg).not.toBeNull();
      return svg as SVGElement;
    });
    expect(chart.getAttribute("data-domain-max")).toBe("100000");
    for (const rect of chart.querySelectorAll(".cost-read, .cost-wrote")) {
      expect(Number(rect.getAttribute("height"))).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("draws nothing for a bucket that cost nothing, and no size line for an empty document", async () => {
    const { container } = renderPanel(
      costFixture({
        sizeBytes: 0,
        buckets: [
          costBucketFixture({ from: "2026-09-01T00:00:00.000Z", readTokens: 10, wroteTokens: 0 }),
          costBucketFixture({
            from: "2026-09-02T00:00:00.000Z",
            readTokens: 0,
            wroteTokens: 0,
            invocations: 0,
            byCommand: {},
          }),
        ],
      }),
    );
    const chart = await waitFor(() => {
      const svg = container.querySelector(".cost-chart");
      expect(svg).not.toBeNull();
      return svg as SVGElement;
    });
    expect(chart.querySelectorAll(".cost-read")).toHaveLength(1);
    expect(chart.querySelectorAll(".cost-wrote")).toHaveLength(0);
    expect(chart.querySelectorAll(".cost-size")).toHaveLength(0);
  });

  it("says the series is a window, in the server's own numbers", async () => {
    const { container } = renderPanel(
      costFixture({
        buckets: [costBucketFixture(), costBucketFixture({ from: "2026-09-02T00:00:00.000Z" })],
        total: 180,
        truncated: true,
      }),
    );
    const note = await settled(container, "truncated");
    expect(note.textContent).toContain("Older buckets are not shown");
    expect(note.textContent).toContain("2 of 180");
  });

  it("does not claim a window when the server says the history is whole", async () => {
    const { container } = renderPanel(costFixture({ truncated: false, total: 1 }));
    await settled(container, "series");
    expect(container.querySelector('.cost-note[data-state="truncated"]')).toBeNull();
  });

  it("names the verb that paid, on demand, with a total the rows add up to", async () => {
    const { container } = renderPanel(
      costFixture({
        buckets: [
          costBucketFixture({
            from: "2026-09-01T00:00:00.000Z",
            readTokens: 100,
            wroteTokens: 10,
            byCommand: { "doc show": 100, search: 10 },
          }),
        ],
      }),
    );
    await settled(container, "series");
    const details = container.querySelector(".cost-commands");
    expect(details).not.toBeNull();
    expect(details?.querySelector("summary")?.textContent).toBe("By command (2)");
    const rows = [...(details?.querySelectorAll("tr[data-command]") ?? [])].map((row) => [
      row.getAttribute("data-command"),
      row.querySelector("td")?.getAttribute("data-tokens"),
    ]);
    expect(rows).toEqual([
      ["doc show", "100"],
      ["search", "10"],
    ]);
    expect(details?.querySelector(".cost-commands-total td")?.getAttribute("data-tokens")).toBe(
      "110",
    );
  });

  /**
   * A failed read is not an answer of zero. The advisory channel may go down,
   * and a panel that vanished with it would be indistinguishable from the
   * honest "nothing measured" — which is a claim a failed request cannot make.
   */
  it("states a failed read rather than falling back to an empty state", async () => {
    const transport = readerTransport({ docs: [] });
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    render(
      <harness.Wrapper>
        <CostPanel docId="doc_missing" />
      </harness.Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/measurements could not be read/i)).toBeTruthy();
    });
    expect(document.querySelector('.cost-note[data-state="unmeasured"]')).toBeNull();
  });

  /**
   * The regression this guard was written for, kept.
   *
   * `boardFixture` answered this route from a `{}` catch-all, `cost.buckets.length`
   * threw, and **thirteen** unrelated `Board` and `Explorer` tests went red — in a
   * component that renders on every document, where a throw is a blank board. An
   * answer that is not a series must read as *nothing was received*, which is
   * what a failed request means, and never as an empty ledger, which is a claim
   * about the workspace.
   */
  it("survives a response that is not a series, and calls it unread rather than empty", async () => {
    const malformed: readonly unknown[] = [{}, { buckets: null }, { buckets: [], total: 3 }];
    for (const body of malformed) {
      const transport = readerTransport({
        docs: [docFixture({ frontmatter: { id: DOC_ID } })],
        // Deliberately past the fixture's own type: the whole point is a server
        // that sent something the contract says it cannot.
        cost: { [DOC_ID]: body as DocumentCost },
      });
      const harness = createCorpusTestHarness({ fetch: transport.fetch });
      const { container } = render(
        <harness.Wrapper>
          <CostPanel docId={DOC_ID} />
        </harness.Wrapper>,
      );
      const note = await settled(container, "error");
      expect(note.textContent).toContain("could not be read");
      expect(container.querySelector('.cost-note[data-state="unmeasured"]')).toBeNull();
      expect(container.querySelector('.cost-note[data-state="empty"]')).toBeNull();
      cleanup();
    }
  });

  /**
   * A client is routinely older than its server, and this vocabulary is closed
   * precisely so a fourth span is a change the UI must follow. Until it does,
   * the honest label is the server's own word — not a dropped clause.
   */
  it("prints a granularity this build has never heard of, rather than nothing", async () => {
    const { container } = renderPanel(
      costFixture({ granularity: "fortnight" as never, buckets: [costBucketFixture()] }),
    );
    const note = await settled(container, "series");
    expect(note.textContent).toContain("1 fortnight bucket");
  });

  it("reads the document's own series, not a shared one", async () => {
    const transport = readerTransport({
      docs: [docFixture({ frontmatter: { id: DOC_ID } })],
      cost: { [DOC_ID]: costFixture() },
    });
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { container } = render(
      <harness.Wrapper>
        <CostPanel docId={DOC_ID} />
      </harness.Wrapper>,
    );
    await settled(container, "series");
    expect(transport.calls.some((call) => call.path === costPath(DOC_ID))).toBe(true);
  });
});
