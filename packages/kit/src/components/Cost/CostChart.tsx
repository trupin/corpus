import type { CostBucket } from "@corpus/contract";
import type { ReactElement } from "react";

/**
 * A document's cost over time, drawn (SPEC.md §9.4) — **this repository's first
 * chart, and it carries no charting dependency** (sprint-025 E1, decided by the
 * user before UI-190 was spawned).
 *
 * Hand-rolled because the picture is three marks: a stacked bar per bucket, a
 * baseline, and one horizontal reference line. A charting library would bring a
 * scale system, a layout engine and an interaction model for none of them, and
 * the repository's dependency discipline is strict enough that the CLI pins its
 * startup imports to three packages by test. `KanbanGraph` is the standing
 * precedent for drawing by hand here.
 *
 * ## What it draws, and what it refuses to draw
 *
 * Two series and a line, and the honesty rules are the interesting part:
 *
 * - **Bars, not a line chart.** A bucket is a *span* — a whole day — not a
 *   sample at an instant. A polyline between bucket midpoints would draw values
 *   between them that nobody measured, which is exactly the interpolation
 *   §9.4's panel must not perform.
 * - **A measured bucket is never drawn as nothing.** A non-zero token count
 *   whose bar rounds below a pixel is drawn at {@link MIN_BAR} instead. The
 *   reference line can be two orders of magnitude above a day's cost — which is
 *   the good news the panel exists to show — and a series flattened into the
 *   baseline would read as "nothing happened" rather than as "this was cheap".
 * - **A zero bucket draws nothing, and that is not a gap.** The server returns
 *   contiguous buckets with nothing skipped, so an empty slot is a day nobody
 *   touched the document. The baseline runs the full width so the eye reads the
 *   quiet days as quiet rather than as missing.
 * - **The reference line is in the y-domain, on purpose.** The comparison it
 *   exists to make is "does a day of working with this document cost about what
 *   the document weighs?", and a line parked off-scale would answer nothing.
 *   When the series is tiny against it the chart squashes — and the squash *is*
 *   the reading: bounded reads working.
 *
 * ## Why there is no text inside the SVG
 *
 * Every label is HTML, in the panel that hosts this component. The chart scales
 * to whatever width the reading measure gives it, and text scaled by a viewBox
 * neither matches the surrounding type nor stays selectable. Labels also carry
 * the units, the granularity and the truncation notice, which are sentences
 * rather than annotations.
 *
 * The caller supplies `sizeTokens` already converted. This component performs no
 * unit arithmetic at all: `estimateTokens` has one caller (the server), and a
 * chart that divided by four would be a second definition of the house estimate
 * (sprint-025 R1).
 */

export interface CostChartProps {
  /** The server's buckets, oldest first, exactly as they arrived. */
  readonly buckets: readonly CostBucket[];
  /**
   * The document's **current** size as a token estimate — the reference line.
   * One present-tense number and never a series (`DocumentCost.sizeBytes`).
   * Zero draws no line: an empty document has no size worth comparing against.
   */
  readonly sizeTokens: number;
  /** What a screen reader is told the picture is. The panel composes it. */
  readonly label: string;
}

/**
 * A constant drawing space, scaled uniformly to the container.
 *
 * Constant rather than a function of the bucket count, because the rendered
 * height follows the aspect ratio: a viewBox that grew with the buckets would
 * make a three-day series render three times taller than a three-month one.
 */
const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 140;
/** The baseline, with room under it for the bars' own hairline. */
const BASELINE = 126;
/** Headroom so a bar at the domain maximum does not touch the top edge. */
const PLOT_TOP = 10;
const PLOT_HEIGHT = BASELINE - PLOT_TOP;
/** The share of a bucket's slot the bar occupies; the rest is the gap. */
const BAR_FILL = 0.72;
/**
 * The floor a non-zero measurement is drawn at, in viewBox units.
 *
 * **1.5 rather than 1, and the reason is measured.** The panel's reading measure
 * gives the chart about 410 CSS pixels in a column, where 140 viewBox units
 * render as ~96 — roughly 0.69 px to the unit. A floor of `1` therefore came out
 * as a **0.68 px** sliver in a real browser against a real workspace: present in
 * the DOM, all but invisible on screen, which is the failure this floor exists
 * to prevent. 1.5 units clears one whole pixel at that scale and stays a hairline
 * at every wider one.
 */
const MIN_BAR = 1.5;

/** Bar geometry for one bucket, in viewBox units. */
interface Bar {
  readonly key: string;
  readonly x: number;
  readonly width: number;
  readonly readY: number;
  readonly readHeight: number;
  readonly wroteY: number;
  readonly wroteHeight: number;
  readonly bucket: CostBucket;
}

/**
 * The tallest thing the chart must fit — the busiest bucket's **total**, since
 * the two series are stacked, or the reference line when it is higher.
 *
 * Never zero: a domain of zero would divide by it, and a series of genuinely
 * empty buckets still needs a baseline to be drawn against.
 */
export function costDomainMax(buckets: readonly CostBucket[], sizeTokens: number): number {
  let tallest = sizeTokens;
  for (const bucket of buckets) {
    const total = bucket.readTokens + bucket.wroteTokens;
    if (total > tallest) tallest = total;
  }
  return tallest > 0 ? tallest : 1;
}

/** A measured value's height, floored at {@link MIN_BAR} so it stays visible. */
function heightOf(tokens: number, domainMax: number): number {
  if (tokens <= 0) return 0;
  return Math.max(MIN_BAR, (tokens / domainMax) * PLOT_HEIGHT);
}

export function CostChart({ buckets, sizeTokens, label }: CostChartProps): ReactElement | null {
  if (buckets.length === 0) return null;

  const domainMax = costDomainMax(buckets, sizeTokens);
  const slot = VIEW_WIDTH / buckets.length;
  const barWidth = Math.max(1, slot * BAR_FILL);

  const bars: Bar[] = buckets.map((bucket, index) => {
    const readHeight = heightOf(bucket.readTokens, domainMax);
    const wroteHeight = heightOf(bucket.wroteTokens, domainMax);
    return {
      key: bucket.from,
      x: slot * index + (slot - barWidth) / 2,
      width: barWidth,
      readY: BASELINE - readHeight,
      readHeight,
      // Stacked above the read half, which is normally the larger of the two.
      wroteY: BASELINE - readHeight - wroteHeight,
      wroteHeight,
      bucket,
    };
  });

  const sizeY = BASELINE - (sizeTokens / domainMax) * PLOT_HEIGHT;

  return (
    <svg
      className="cost-chart"
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
      role="img"
      aria-label={label}
      data-buckets={buckets.length}
      data-domain-max={domainMax}
    >
      {bars.map((bar) => (
        <g className="cost-bar" key={bar.key} data-bucket={bar.key}>
          {bar.readHeight === 0 ? null : (
            <rect
              className="cost-read"
              data-tokens={bar.bucket.readTokens}
              x={bar.x}
              y={bar.readY}
              width={bar.width}
              height={bar.readHeight}
            />
          )}
          {bar.wroteHeight === 0 ? null : (
            <rect
              className="cost-wrote"
              data-tokens={bar.bucket.wroteTokens}
              x={bar.x}
              y={bar.wroteY}
              width={bar.width}
              height={bar.wroteHeight}
            />
          )}
        </g>
      ))}

      {/*
       * Today's size, not a history of it — the panel's caption says so in
       * words, and this element carries the number for anything checking it.
       * Drawn last so it reads over the bars, and omitted entirely for an empty
       * document rather than drawn along the baseline, where it would look like
       * a measurement.
       */}
      {sizeTokens > 0 ? (
        <line
          className="cost-size"
          data-size-tokens={sizeTokens}
          x1={0}
          x2={VIEW_WIDTH}
          y1={sizeY}
          y2={sizeY}
        />
      ) : null}

      <line className="cost-baseline" x1={0} x2={VIEW_WIDTH} y1={BASELINE} y2={BASELINE} />
    </svg>
  );
}
