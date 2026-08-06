/** @vitest-environment jsdom */
import type { Job } from "@corpus/contract";
import { MAX_RECENT_JOBS } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createRef, useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  docFixture,
  jobFixture,
  readerTransport,
  threadFixture,
  threadRowFixture,
  type ReaderTransport,
} from "../testing/readerFixture";
import type { AnchoredThread } from "./anchorPlacement";
import { MarginColumn } from "./AnchoredThreads";

afterEach(cleanup);

/**
 * UI-075. **The margin is the common case, not an edge one.**
 *
 * SPEC.md §11 puts anchored threads in the margin in focus mode and in a wide
 * reader, and `MarginColumn` mounts one `ThreadCard` per anchored thread,
 * ungated — so every per-card query is multiplied by the document's comment
 * count. UI-069 moved the pending indicator's lookup to a `["jobs", {originId}]`
 * key per thread on the stated grounds that the hook "runs in an open thread
 * reader, of which there are as many as the user has columns open"; this file is
 * that claim measured.
 *
 * Counted at the **transport**, because that is the only place the cost is real:
 * a test that inspected the hook would agree with whatever the hook happened to
 * do, while `wire.of("GET", "/api/jobs")` is the number of requests the server
 * would actually have answered.
 */

const DOC = "doc_m";
const THREAD_COUNT = 30;

const PARENT = docFixture({ frontmatter: { id: DOC, title: "Mortgage options" } });

function threadIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `th_${String(index)}`);
}

function marginThreads(ids: readonly string[]): AnchoredThread[] {
  return ids.map((threadId, index) => ({
    anchorId: `a_${String(index)}`,
    threadId,
    row: threadRowFixture({ id: threadId, parent: DOC, title: `Comment ${String(index)}` }),
    orphaned: false,
    quote: `quoted span ${String(index)}`,
    placement: {
      anchorId: `a_${String(index)}`,
      threadId,
      resolved: false,
      turnCount: 1,
      segments: [],
    },
  }));
}

function wireFor(ids: readonly string[], jobs: readonly Job[] = []): ReaderTransport {
  return readerTransport({
    docs: [PARENT],
    threads: ids.map((id, index) =>
      threadFixture({
        id,
        parent: DOC,
        anchor: `a_${String(index)}`,
        turns: [{ author: "user", ts: "2026-07-01T10:05:00.000Z", body: "is 6.1% right?" }],
      }),
    ),
    jobs,
  });
}

function Margin({
  transport,
  threads,
}: {
  readonly transport: ReaderTransport;
  readonly threads: readonly AnchoredThread[];
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <MarginColumn
        threads={threads}
        parentId={DOC}
        flashThread={null}
        onOpenDoc={() => undefined}
        onNotify={() => undefined}
        innerRef={createRef<HTMLDivElement>()}
      />
    </harness.Wrapper>
  );
}

/** Every card has fetched its own thread — the point at which each has asked. */
async function settled(wire: ReaderTransport, count: number): Promise<void> {
  await waitFor(() => {
    expect(wire.of("GET").filter((call) => call.path.startsWith("/api/threads/")).length) //
      .toBeGreaterThanOrEqual(count);
  });
}

describe("the margin's jobs traffic", () => {
  it("asks the queue once for a document with thirty anchored threads", async () => {
    const ids = threadIds(THREAD_COUNT);
    const wire = wireFor(ids);
    render(<Margin transport={wire} threads={marginThreads(ids)} />);

    await settled(wire, THREAD_COUNT);
    await waitFor(() => {
      expect(wire.of("GET", "/api/jobs").length).toBeGreaterThan(0);
    });

    expect(wire.of("GET", "/api/jobs")).toHaveLength(1);
    // Shared because it names no thread: one key, one entry, one request.
    expect(wire.of("GET", "/api/jobs")[0]?.search).not.toContain("originId");
  });

  /**
   * The regression's actual shape: the cost has to be flat in the number of
   * threads, not merely small for one document. Three threads and thirty issue
   * the same one request, so nothing here scales with the comment count.
   */
  it("issues the same one request whatever the thread count", async () => {
    const few = threadIds(3);
    const fewWire = wireFor(few);
    const view = render(<Margin transport={fewWire} threads={marginThreads(few)} />);
    await settled(fewWire, few.length);
    await waitFor(() => {
      expect(fewWire.of("GET", "/api/jobs").length).toBeGreaterThan(0);
    });
    view.unmount();

    const many = threadIds(THREAD_COUNT);
    const manyWire = wireFor(many);
    render(<Margin transport={manyWire} threads={marginThreads(many)} />);
    await settled(manyWire, many.length);
    await waitFor(() => {
      expect(manyWire.of("GET", "/api/jobs").length).toBeGreaterThan(0);
    });

    expect(manyWire.of("GET", "/api/jobs")).toHaveLength(fewWire.of("GET", "/api/jobs").length);
  });

  /**
   * And the shared query still answers the question. A deferred job behind a
   * console window's worth of *finished* traffic — the exact burial UI-069 was
   * filed for — is found for a margin card, because settled jobs are not in the
   * outstanding list at all.
   */
  it("still lights the pending row for a thread whose job is buried", async () => {
    const ids = threadIds(THREAD_COUNT);
    const noise = Array.from({ length: 60 }, (_, index) =>
      jobFixture({
        eventId: `evt_noise_${String(index)}`,
        status: "processed",
        originId: `th_gone_${String(index)}`,
      }),
    );
    const buried = jobFixture({
      eventId: "evt_deferred",
      status: "deferred",
      originId: "th_29",
      started: "2026-07-01T09:00:00.000Z",
      blockedOn: DOC,
    });
    const wire = wireFor(ids, [...noise, buried]);
    const { container } = render(<Margin transport={wire} threads={marginThreads(ids)} />);

    await waitFor(() => {
      expect(container.querySelector('[data-thread="th_29"] .working')).not.toBeNull();
    });
    // The one card with an outstanding job, and only that one.
    expect(container.querySelectorAll(".working")).toHaveLength(1);
    expect(wire.of("GET", "/api/jobs")).toHaveLength(1);
  });

  /**
   * The one case the shared list can be short — more unfinished events at one
   * instant than a response carries — is where the exact `?originId=` question
   * comes back, per thread and only while it holds. Thirty cards escalate here;
   * that is the price of an honest answer under a saturated queue, and it is
   * paid nowhere else.
   */
  it("escalates to the exact question only when the shared list is at the cap", async () => {
    const ids = threadIds(2);
    const saturated = Array.from({ length: MAX_RECENT_JOBS }, (_, index) =>
      jobFixture({
        eventId: `evt_busy_${String(index)}`,
        status: "pending",
        originId: `th_busy_${String(index)}`,
      }),
    );
    const buried = jobFixture({
      eventId: "evt_deferred",
      status: "deferred",
      originId: "th_1",
      started: "2026-07-01T09:00:00.000Z",
    });
    const wire = wireFor(ids, [...saturated, buried]);
    const { container } = render(<Margin transport={wire} threads={marginThreads(ids)} />);

    await waitFor(() => {
      expect(container.querySelector('[data-thread="th_1"] .working')).not.toBeNull();
    });
    const filtered = wire.of("GET", "/api/jobs").filter((call) => call.search.includes("originId"));
    expect(filtered).toHaveLength(ids.length);
  });
});
