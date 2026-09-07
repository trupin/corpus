import {
  estimateTokens,
  type CostBucket,
  type CostGranularity,
  type DocumentCost,
} from "@corpus/contract";
import { CostChart, useDocCost } from "@corpus/kit";
import type { ReactElement, ReactNode } from "react";

/**
 * "Measurements" (SPEC.md §9.4): what this document has cost over time, beside
 * what it currently weighs — the panel the rider asks for, in the words it uses.
 *
 * > *Each document's view can show its own cost over time (§10), beside its
 * > size, so "is working with this document getting more expensive as it
 * > grows?" is answered by looking rather than by feeling.*
 *
 * It is **on the document and deliberately not in the console** (SHARED-079's
 * recorded placement). The console answers questions about the queue; this
 * answers one about a document, and it is asked while reading that document.
 *
 * It renders from the single call site beside {@link Backlinks} and
 * {@link RelatedPanel}, below the body, which is what makes one insertion serve
 * an ordinary document and a `type: thread` document, in a column reader and in
 * full screen alike — threads are documents (SPEC.md §6) and the series route
 * takes a `th_*` id like any other. Below the body for the reason
 * `DocView.tsx` records at length: a panel that renders *above* it and arrives
 * after the editor has painted moved the body 77.86px, on the surface where
 * text is selected in order to comment on it.
 *
 * ## It says "nothing measured", where `RelatedPanel` says nothing at all
 *
 * `RelatedPanel` and `Backlinks` render `null` when empty, and their rule is a
 * good one: a heading over nothing claims the corpus was searched and found
 * wanting, which for a document nobody has linked yet is noise. **This panel
 * deviates on purpose, and the deviation is the point of the panel.**
 *
 * "Nothing is related to this document" and "nothing has been measured about
 * this document" are different sentences. The first is a finding. The second is
 * an admission that the instrument has not run — and §9.4 makes the instrument
 * *lossy by design*: telemetry is runtime state beside the queue, absent after
 * a rebuild and none the worse for it. A panel that vanished in that state
 * would let a reader take an unmeasured document for a free one, which is
 * exactly the "feeling" the rider replaces with "looking". So the three states
 * below are all rendered, and each says which one it is:
 *
 * 1. **the workspace has measured nothing** (`measuringSince` is `null`) — a
 *    fresh workspace, or one whose ledger a rebuild cleared;
 * 2. **the workspace is measuring, and this document has no entries**;
 * 3. **a series** — and then the truncation notice, if the server cut one.
 *
 * Loading is a fourth render and is kept distinguishable from all three: an
 * unanswered request is not an answer of zero.
 *
 * ## What it does not do
 *
 * No arithmetic on the estimate. `sizeBytes` is converted to tokens by the one
 * conversion the contract publishes, and every other figure on screen is a sum
 * of whole tokens the server already rounded (sprint-025 R1, and
 * `CostBucketSchema`'s note on where the rounding happens). No poll, no SSE key:
 * telemetry announces nothing, so this refreshes on the document frames the
 * reader already receives, and the panel is knowingly not live to the ledger.
 */

export interface CostPanelProps {
  /** The open document, or a thread — the series route takes either. */
  readonly docId: string;
}

/**
 * How the wire's granularity reads in a sentence — mid-sentence, so lower case.
 *
 * **A total `Record`, and a runtime fallback, and the two are not in tension.**
 * The `Record` is what makes a fourth span a compile error here rather than a
 * silent hole: the contract closes this vocabulary precisely so the UI has to
 * follow it. The fallback is for the other direction, which no type can reach —
 * a client is routinely older than the server it is talking to, and this build
 * will meet a granularity it has never heard of. Showing the server's own word
 * is the honest answer there. Dropping the clause would hide that the axis had
 * changed under the reader.
 */
const GRANULARITY_WORD: Record<CostGranularity, string> = {
  hour: "hourly",
  day: "daily",
  week: "weekly",
};

/** The word for a span, or the server's own when this build does not know it. */
export function granularityWord(granularity: string): string {
  return GRANULARITY_WORD[granularity as CostGranularity] ?? granularity;
}

/**
 * The unit, in one clause, wherever the panel names it.
 *
 * **The same words the CLI's help note uses** (sprint-025 R1): the whole value
 * of the house estimate is that a person can reproduce a figure here by hand,
 * and two spellings of one rule would make them wonder whether they are two
 * rules. The rounding is named because it is a decision — `Math.ceil`, so a
 * measured invocation is never published as free.
 */
export const TOKEN_UNIT_NOTE = "Tokens are this workspace’s estimate: bytes ÷ 4, rounded up.";

/** The `Intl`-free thousands separator: identical output in every locale, and in a test. */
export function groupDigits(value: number): string {
  const digits = String(Math.trunc(Math.abs(value)));
  let out = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ",";
    out += digits[index];
  }
  return value < 0 ? `-${out}` : out;
}

/**
 * A wire timestamp as a plain date, the way the frontmatter chips already spell
 * one — `updated {doc.frontmatter.updated.slice(0, 10)}`.
 *
 * Locale-free on purpose. A bucket boundary is a UTC day (`series.ts` aligns
 * them to the epoch), and formatting it in the reader's locale would shift the
 * label off the bucket it names for every reader west of Greenwich.
 */
export function bucketDay(iso: string): string {
  return iso.slice(0, 10);
}

/** The tokens the whole shown window cost — both directions, every bucket. */
export function windowTotal(buckets: readonly CostBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + bucket.readTokens + bucket.wroteTokens, 0);
}

/**
 * Every command that spent anything in the shown window, dearest first.
 *
 * A plain sum of the server's own per-bucket figures, which is what keeps the
 * breakdown adding up to the window total exactly: the contract fixes the grain
 * at one conversion per command per direction, so everything coarser than that
 * is whole-token addition and nothing here re-converts (`CostBucketSchema`).
 */
export function byCommandTotals(
  buckets: readonly CostBucket[],
): readonly (readonly [string, number])[] {
  const totals = new Map<string, number>();
  for (const bucket of buckets) {
    for (const [command, tokens] of Object.entries(bucket.byCommand)) {
      totals.set(command, (totals.get(command) ?? 0) + tokens);
    }
  }
  return [...totals.entries()].sort(
    ([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName),
  );
}

/**
 * The document's current size as the workspace's token estimate — the height
 * the reference line is drawn at.
 *
 * **The contract's own conversion, called rather than restated.** `sizeBytes`
 * is the one figure on this panel the server publishes in bytes, so the UI is
 * the second consumer of the house estimate and a `/ 4` written here would be
 * its second *definition* (sprint-025 R1). `estimateTokens` also carries the
 * rounding decision — `Math.ceil`, so a non-empty document never reads as
 * weighing nothing — which a hand-rolled division would silently drop.
 */
function sizeInTokens(cost: DocumentCost): number {
  return estimateTokens(cost.sizeBytes);
}

function Frame({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div className="cost">
      <h3>Measurements</h3>
      {children}
    </div>
  );
}

/**
 * The answer, only if it **is** one.
 *
 * The contract requires every field here, and the client does not validate a
 * JSON response, so "required" is a promise about a well-behaved server and not
 * a guarantee about the bytes that arrive. This panel always renders, on every
 * document, in a column and in full screen — so a `TypeError` in it is a blank
 * board, not a missing chart. That is not a theory: it happened while UI-190 was
 * being written. `boardFixture` answered this route from a `{}` catch-all,
 * `cost.buckets.length` threw, and **thirteen** unrelated `Board` and `Explorer`
 * tests went red at once. The same shape of gap has bitten `stubCorpus` twice
 * before.
 *
 * So the read is checked, and anything that is not a series is treated as
 * *nothing was received* rather than as an answer. `measuringSince` is the one
 * field allowed to be `null`, because `null` is a real answer there — the ledger
 * holds nothing — and `undefined` is not.
 */
function seriesOf(data: unknown): DocumentCost | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Partial<DocumentCost>;
  if (!Array.isArray(row.buckets)) return null;
  if (typeof row.total !== "number" || typeof row.truncated !== "boolean") return null;
  if (typeof row.sizeBytes !== "number") return null;
  if (row.measuringSince !== null && typeof row.measuringSince !== "string") return null;
  if (typeof row.granularity !== "string") return null;
  return row as DocumentCost;
}

export function CostPanel({ docId }: CostPanelProps): ReactElement {
  const query = useDocCost(docId);
  const cost = query.data === undefined ? undefined : seriesOf(query.data);

  if (query.isError || cost === null) {
    /*
     * Stated rather than hidden. The read is advisory and its failure costs the
     * document nothing — but a panel that disappeared on an error would be
     * indistinguishable from the honest "nothing measured" below it, and one of
     * those two is a claim about the workspace that a failed request cannot
     * support. An answer that is not a series (see {@link seriesOf}) lands here
     * for the same reason and says the same thing.
     */
    return (
      <Frame>
        <p className="cost-note" data-state="error" role="status">
          This document’s measurements could not be read.{" "}
          {query.error === null ? "" : query.error.message}
        </p>
      </Frame>
    );
  }

  if (cost === undefined) {
    return (
      <Frame>
        <p className="cost-note" data-state="loading">
          Loading measurements…
        </p>
      </Frame>
    );
  }

  if (cost.measuringSince === null) {
    /*
     * The whole ledger is empty — a fresh workspace, or one rebuilt since. Said
     * as a property of the workspace, because that is what `measuringSince` is:
     * "this document has cost nothing" would be a claim about the document, and
     * nothing here supports it.
     */
    return (
      <Frame>
        <p className="cost-note" data-state="unmeasured">
          Measurement has not started in this workspace. Nothing has been recorded yet — cost is
          measured per <code>corpus</code> invocation, and it is runtime state, so it is empty again
          after the workspace is rebuilt.
        </p>
      </Frame>
    );
  }

  const since = bucketDay(cost.measuringSince);

  if (cost.buckets.length === 0) {
    return (
      <Frame>
        <p className="cost-note" data-state="empty">
          No measurements for this document. This workspace has been measuring since {since} —
          nothing in that time has named this document.
        </p>
      </Frame>
    );
  }

  const sizeTokens = sizeInTokens(cost);
  const total = windowTotal(cost.buckets);
  const first = cost.buckets[0];
  const last = cost.buckets[cost.buckets.length - 1];
  const span = cost.buckets.length;
  const commands = byCommandTotals(cost.buckets);
  const granularity = granularityWord(cost.granularity);

  return (
    <Frame>
      <CostChart
        buckets={cost.buckets}
        sizeTokens={sizeTokens}
        label={
          `Cost over time: ${groupDigits(total)} tokens across ${String(span)} ` +
          `${granularity} buckets, against a current document size of ` +
          `${groupDigits(sizeTokens)} tokens.`
        }
      />

      <div className="cost-axis" aria-hidden="true">
        <span>{first === undefined ? "" : bucketDay(first.from)}</span>
        <span>{last === undefined ? "" : bucketDay(last.from)}</span>
      </div>

      <div className="cost-legend">
        <span className="cost-key read">
          read <b>{groupDigits(cost.buckets.reduce((sum, b) => sum + b.readTokens, 0))}</b>
        </span>
        <span className="cost-key wrote">
          wrote <b>{groupDigits(cost.buckets.reduce((sum, b) => sum + b.wroteTokens, 0))}</b>
        </span>
        {/*
         * The reference line, named as what it is. §9.4 asks for cost "beside
         * its size" and the projection keeps exactly one size per file, so this
         * is today's number drawn across a history it was not part of — which
         * the word *current* is carrying, and which is why it is not in the
         * legend as a third series.
         */}
        <span className="cost-key size" data-size-tokens={sizeTokens}>
          current size <b>{groupDigits(sizeTokens)}</b>
        </span>
      </div>

      {/*
       * The granularity is named in the sentence rather than left to be read off
       * two boundaries: a bucket may legitimately hold nothing, and an empty
       * bucket read as a gap turns a quiet week into a hole in the chart. It is
       * the server's own word (`DocumentCost.granularity`), never inferred here.
       */}
      <p className="cost-note" data-state="series">
        <b>{groupDigits(total)} tokens</b> over {span} {granularity}{" "}
        {span === 1 ? "bucket" : "buckets"}, ending {last === undefined ? "" : bucketDay(last.from)}
        . {TOKEN_UNIT_NOTE} The dashed line is the document’s size <b>today</b>, not a history of
        it. Measuring since {since}.
      </p>

      {/*
       * The window is not the history, and it must say so in the server's own
       * numbers rather than in a derived guess (`DocumentCost.truncated`). The
       * buckets that were cut are the oldest, so a panel presenting a window as
       * a whole history would say the document has been cheap since a date it
       * invented.
       */}
      {cost.truncated ? (
        <p className="cost-note" data-state="truncated" role="status">
          Older buckets are not shown: {span} of {cost.total} {granularity} buckets. The ones cut
          are the oldest, so this window starts later than the history does.
        </p>
      ) : null}

      {/*
       * Which verb paid, on demand. Collapsed by default because the question
       * the panel exists to answer is the shape above it, and a table of command
       * paths under every document would compete with it.
       *
       * The figures are sums of the server's own per-command numbers, so they
       * add up to the window total exactly — the one arithmetic error a reader
       * is guaranteed to notice.
       */}
      {commands.length === 0 ? null : (
        <details className="cost-commands">
          <summary>By command ({commands.length})</summary>
          <table>
            <tbody>
              {commands.map(([command, tokens]) => (
                <tr key={command} data-command={command}>
                  <th scope="row">
                    <code>corpus {command}</code>
                  </th>
                  <td data-tokens={tokens}>{groupDigits(tokens)}</td>
                </tr>
              ))}
              <tr className="cost-commands-total">
                <th scope="row">total</th>
                <td data-tokens={total}>{groupDigits(total)}</td>
              </tr>
            </tbody>
          </table>
        </details>
      )}
    </Frame>
  );
}
