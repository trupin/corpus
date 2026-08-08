/** @vitest-environment jsdom */
import type { Job, Thread } from "@corpus/contract";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import {
  docFixture,
  jobFixture,
  readerTransport,
  threadFixture,
  threadRowFixture,
  type ReaderTransport,
} from "../testing/readerFixture";
import { DELETE_ARMED_LABEL } from "./Turn";
import { ThreadCard, type ThreadHost } from "./ThreadCard";
import { ASK_AGENT_LABEL, NOTE_ONLY_LABEL, SEND_LABEL } from "./ThreadComposer";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetSeenMarks();
});

const TURNS = [
  {
    author: "user" as const,
    ts: "2026-07-01T10:05:00.000Z",
    body: "is 6.1% right?",
    model: null,
  },
  {
    author: "agent" as const,
    ts: "2026-07-01T10:07:00.000Z",
    body: "6.4% is closer.\n↳ edited the model doc — 3 lines",
    model: null,
  },
];

/** A "note only" reply: a user turn that asked the agent for nothing. */
const NOTE = {
  author: "user" as const,
  ts: "2026-07-01T10:12:00.000Z",
  body: "filing this away — no need to look at it",
  model: null,
};

const PARENT = docFixture({
  frontmatter: { id: "doc_m", title: "Mortgage options" },
  anchors: [
    {
      anchorId: "a_1",
      selector: { exact: "assume a 30-year fixed at 6.1%", prefix: "", suffix: "" },
      threadId: "th_a",
      threadStatus: "open",
      range: { start: 4, end: 33 },
      orphaned: false,
    },
  ],
});

function wire(thread: Partial<Thread> = {}, options: Parameters<typeof readerTransport>[0] = {}) {
  return readerTransport({
    docs: [PARENT],
    threads: [
      threadFixture({ id: "th_a", parent: "doc_m", anchor: "a_1", turns: TURNS, ...thread }),
    ],
    ...options,
  });
}

function Host({
  transport,
  host,
  onOpenDoc,
  onCollapse,
  onNotify,
}: {
  readonly transport: ReaderTransport;
  readonly host?: ThreadHost;
  readonly onOpenDoc?: (docId: string, anchorId?: string | null) => void;
  readonly onCollapse?: () => void;
  readonly onNotify?: (notice: { tone: string; message: string }) => void;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <ThreadCard
        threadId="th_a"
        host={host ?? "standalone"}
        onOpenDoc={onOpenDoc ?? (() => undefined)}
        {...(onCollapse ? { onCollapse } : {})}
        onNotify={onNotify ?? (() => undefined)}
      />
    </harness.Wrapper>
  );
}

async function loaded(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(container.querySelectorAll(".turn").length).toBeGreaterThan(0);
  });
}

describe("the head", () => {
  it("shows the anchor quote, the status chip and resolve", async () => {
    const { container } = render(<Host transport={wire()} />);
    await loaded(container);
    expect(container.querySelector(".t-quote")?.textContent).toBe(
      "“assume a 30-year fixed at 6.1%”",
    );
    expect(container.querySelector(".chip.t-status")?.textContent).toBe("open");
    expect(container.querySelector(".t-resolve")?.textContent).toBe("✓ resolve");
  });

  it("reads `whole-document thread` with a parent and no anchor", async () => {
    const transport = readerTransport({
      docs: [docFixture({ frontmatter: { id: "doc_m", title: "Mortgage options" } })],
      threads: [threadFixture({ id: "th_a", parent: "doc_m", anchor: null, turns: TURNS })],
    });
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    expect(container.querySelector(".t-quote")?.textContent).toBe("whole-document thread");
    expect(container.querySelector(".t-context")?.textContent).toContain("whole document");
  });

  it("reads `standalone` with no parent at all", async () => {
    const transport = readerTransport({
      threads: [threadFixture({ id: "th_a", parent: null, turns: TURNS })],
    });
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    expect(container.querySelector(".t-quote")?.textContent).toBe("standalone");
    expect(container.querySelector(".t-context")?.textContent).toBe("standalone thread · th_a");
  });

  it("dims a resolved card and offers reopen", async () => {
    const { container } = render(<Host transport={wire({ status: "resolved" })} />);
    await loaded(container);
    expect(container.querySelector(".thread-card")?.className).toContain("resolved");
    expect(container.querySelector(".t-resolve")?.textContent).toBe("reopen");
  });

  it("renders the collapse control only when the host gave it one", async () => {
    const collapse = vi.fn();
    const first = render(<Host transport={wire()} host="slot" onCollapse={collapse} />);
    await loaded(first.container);
    fireEvent.click(first.container.querySelector(".t-collapse") as HTMLElement);
    expect(collapse).toHaveBeenCalled();

    cleanup();
    resetSeenMarks();
    const second = render(<Host transport={wire()} host="margin" />);
    await loaded(second.container);
    expect(second.container.querySelector(".t-collapse")).toBeNull();
  });

  it("resolves and reopens through the thread routes", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    fireEvent.click(container.querySelector(".t-resolve") as HTMLElement);
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/resolve")).toHaveLength(1);
    });
  });

  it("reports resolving an open thread while mounted, once", async () => {
    const notices = await flipWhileMounted("open");
    expect(notices).toEqual([
      { tone: "info", message: "Thread resolved — committed. Replying reopens it." },
    ]);
  });

  it("reports reopening a resolved thread while mounted, once", async () => {
    const notices = await flipWhileMounted("resolved");
    expect(notices).toEqual([{ tone: "info", message: "Thread reopened — committed." }]);
  });
});

/** Clicks the head's resolve/reopen with the card left mounted throughout. */
async function flipWhileMounted(
  status: Thread["status"],
): Promise<readonly { tone: string; message: string }[]> {
  const notices: { tone: string; message: string }[] = [];
  const { container } = render(
    <Host
      transport={wire({ status })}
      onNotify={(notice) => {
        notices.push(notice);
      }}
    />,
  );
  await loaded(container);
  fireEvent.click(container.querySelector(".t-resolve") as HTMLElement);
  await waitFor(() => {
    expect(notices).toHaveLength(1);
  });
  // Settle the rest of the chain: a callback left in both places toasts twice,
  // and the second one arrives a tick after the first.
  await settle();
  return notices;
}

/** Lets every queued continuation and macrotask run out, inside `act`. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The flip's outcome outlives the card (UI-015).
 *
 * A per-call `onSuccess`/`onError` rides on the mutation's observer and is
 * skipped once that observer has no listeners left, so a card that goes away
 * mid-flight — a chip collapsing, a reader closing, the margin re-laying out —
 * used to rewrite and commit the thread file in silence. The callbacks are on
 * the hook now, and the direction is read off what was sent rather than off the
 * render that sent it.
 */
describe("a flip whose card went away before it settled", () => {
  /** A write held open until the test lets it answer (UI-012's gate). */
  function gate(): { readonly held: Promise<void>; readonly release: () => void } {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    return { held, release: () => release() };
  }

  async function flipAndUnmount(options: {
    readonly status: Thread["status"];
    readonly failing?: Readonly<Record<string, number>>;
  }): Promise<{ tone: string; message: string }[]> {
    const { held, release } = gate();
    const notices: { tone: string; message: string }[] = [];
    const transport = wire(
      { status: options.status },
      { holdWrites: held, ...(options.failing === undefined ? {} : { failing: options.failing }) },
    );
    const { container } = render(
      <Host
        transport={transport}
        onNotify={(notice) => {
          notices.push(notice);
        }}
      />,
    );
    await loaded(container);
    fireEvent.click(container.querySelector(".t-resolve") as HTMLElement);
    const verb = options.status === "resolved" ? "reopen" : "resolve";
    await waitFor(() => {
      expect(transport.of("POST", `/api/threads/th_a/${verb}`)).toHaveLength(1);
    });

    cleanup();
    release();
    await waitFor(() => {
      expect(notices).toHaveLength(1);
    });
    await settle();
    return notices;
  }

  it("still says the thread was resolved", async () => {
    const notices = await flipAndUnmount({ status: "open" });
    expect(notices).toEqual([
      { tone: "info", message: "Thread resolved — committed. Replying reopens it." },
    ]);
  });

  it("still says the thread was reopened", async () => {
    const notices = await flipAndUnmount({ status: "resolved" });
    expect(notices).toEqual([{ tone: "info", message: "Thread reopened — committed." }]);
  });

  it("still reports a refused resolve", async () => {
    const notices = await flipAndUnmount({
      status: "open",
      failing: { "POST /api/threads/th_a/resolve": 423 },
    });
    // The server's sentence, not the route template it arrived through
    // (`CorpusRequestError`): this string is what a person reads in a toast.
    expect(notices).toEqual([{ tone: "error", message: "Resolve failed — the server refused" }]);
  });

  it("still reports a refused reopen", async () => {
    const notices = await flipAndUnmount({
      status: "resolved",
      failing: { "POST /api/threads/th_a/reopen": 423 },
    });
    expect(notices).toEqual([{ tone: "error", message: "Reopen failed — the server refused" }]);
  });
});

describe("the context line", () => {
  it("names the parent and links back at the anchor", async () => {
    const open = vi.fn();
    const { container } = render(<Host transport={wire()} onOpenDoc={open} />);
    await waitFor(() => {
      expect(container.querySelector(".t-context .ref")).not.toBeNull();
    });
    expect(container.querySelector(".t-context")?.textContent).toBe(
      "on Mortgage options · at “assume a 30-year fixed at 6.1%”",
    );
    fireEvent.click(container.querySelector(".t-context .ref") as HTMLElement);
    expect(open).toHaveBeenCalledWith("doc_m", "a_1");
  });

  /** SPEC.md §9: a deleted parent leaves an orphaned record, not a crash. */
  it("degrades to the stored parent id when the parent is gone", async () => {
    const transport = readerTransport({
      docs: [],
      threads: [threadFixture({ id: "th_a", parent: "doc_gone", turns: TURNS })],
    });
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    await waitFor(() => {
      expect(container.querySelector(".t-context")?.textContent).toContain("doc_gone");
    });
    expect(container.querySelector(".t-context .ref")).toBeNull();
  });
});

describe("the turns", () => {
  it("marks the agent's author and renders its trace with no arrow in the text", async () => {
    const { container } = render(<Host transport={wire()} />);
    await loaded(container);
    const authors = [...container.querySelectorAll(".turn-who .who")].map((node) => node.className);
    expect(authors).toEqual(["who", "who agent"]);
    expect(container.querySelector(".turn-trace")?.textContent).toBe(
      "edited the model doc — 3 lines",
    );
    // The arrow is CSS `::before` content — never a character in the body.
    expect(container.querySelector(".turn-trace")?.textContent).not.toContain("↳");
  });

  /** SPEC.md §6: turn identity is the timestamp, never the array index. */
  it("keys turns by timestamp", async () => {
    const { container } = render(<Host transport={wire()} />);
    await loaded(container);
    expect(
      [...container.querySelectorAll(".turn")].map((node) => node.getAttribute("data-turn-ts")),
    ).toEqual([TURNS[0]?.ts, TURNS[1]?.ts]);
  });

  it("arms deletion before firing it, and never offers it on an agent turn", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    await loaded(container);

    const turns = [...container.querySelectorAll(".turn")];
    expect(turns[1]?.querySelector(".turn-del")).toBeNull();

    const control = turns[0]?.querySelector(".turn-del") as HTMLElement;
    fireEvent.click(control);
    expect(control.textContent).toBe(DELETE_ARMED_LABEL);
    expect(control.className).toContain("armed");
    // Arming reaches no network at all.
    expect(transport.of("DELETE")).toHaveLength(0);

    fireEvent.click(control);
    await waitFor(() => {
      expect(transport.of("DELETE")).toHaveLength(1);
    });
    expect(transport.of("DELETE")[0]?.path).toBe(
      `/api/threads/th_a/turns/${encodeURIComponent(TURNS[0]?.ts ?? "")}`,
    );
  });

  it("disarms on Escape without deleting", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    const control = container.querySelector(".turn-del") as HTMLElement;
    fireEvent.click(control);
    expect(control.textContent).toBe(DELETE_ARMED_LABEL);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(container.querySelector(".turn-del")?.textContent).toBe("✕");
    });
    expect(transport.of("DELETE")).toHaveLength(0);
  });

  /**
   * The press the browser actually delivers: the armed button holds focus, so
   * Escape is dispatched at the button — which, in chip mode, sits in an
   * `anchor-slot` island inside the document's contenteditable. The press was
   * being read as typing and dropped (UI-008 FAIL-1).
   */
  it("disarms on Escape pressed at the button, inside the editor's chip slot", async () => {
    const transport = wire();
    const { container } = render(
      <div contentEditable suppressContentEditableWarning>
        <div contentEditable={false} className="anchor-slot">
          <Host transport={transport} host="slot" />
        </div>
      </div>,
    );
    await loaded(container);
    const control = container.querySelector(".turn-del") as HTMLElement;
    fireEvent.click(control);
    expect(control.textContent).toBe(DELETE_ARMED_LABEL);

    control.focus();
    fireEvent.keyDown(control, { key: "Escape" });
    await waitFor(() => {
      expect(container.querySelector(".turn-del")?.textContent).toBe("✕");
    });
    expect(transport.of("DELETE")).toHaveLength(0);

    // And the disarmed button is inert again: one more click only re-arms it.
    fireEvent.click(container.querySelector(".turn-del") as HTMLElement);
    expect(container.querySelector(".turn-del")?.textContent).toBe(DELETE_ARMED_LABEL);
    expect(transport.of("DELETE")).toHaveLength(0);
  });

  it("reports the cascade honestly when the last turn goes", async () => {
    const notify = vi.fn<(notice: { tone: string; message: string }) => void>();
    const transport = readerTransport({
      docs: [PARENT],
      threads: [threadFixture({ id: "th_a", parent: "doc_m", turns: [TURNS[0] as never] })],
    });
    const { container } = render(<Host transport={transport} onNotify={notify} />);
    await loaded(container);
    const control = container.querySelector(".turn-del") as HTMLElement;
    fireEvent.click(control);
    fireEvent.click(control);
    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    expect(notify.mock.calls[0]?.[0].message).toContain("thread went with it");
  });
});

/**
 * SPEC.md §8's row reports an outstanding agent response **and nothing else**.
 * Its four corners are (ask · note) × (outstanding · settled), and the pair that
 * used to be got wrong sit on the diagonal: a note while the queue is quiet must
 * say nothing, and a note while the queue still holds a request must keep saying
 * it (UI-058).
 */
describe("the pending indicator", () => {
  /**
   * The asking turn's timestamp — the instant the clock must report, since a
   * later note must not restart it. Read once through the index guard rather
   * than at four call sites.
   */
  const ASKED_AT = TURNS[0]?.ts ?? "";

  /** The queue event a thread's ask enqueued, as `GET /api/jobs` shows it. */
  const askJob = (overrides: Partial<Job> = {}): Job =>
    jobFixture({ originId: "th_a", started: ASKED_AT, ...overrides });

  it("stays quiet after a note-only turn, whatever the thread's agent field says", async () => {
    // `agent: engaged` and a user turn last — the exact shape a "note only" reply
    // leaves behind, and what used to paint the row. Nothing is queued.
    const { container } = render(
      <Host transport={wire({ agent: "engaged", turns: [...TURNS, NOTE] })} />,
    );
    await loaded(container);
    expect(container.querySelector(".working")).toBeNull();
  });

  it("appears while the queue still holds this thread's request", async () => {
    const { container } = render(
      <Host
        transport={wire({ agent: "requested", turns: [TURNS[0] as never] }, { jobs: [askJob()] })}
      />,
    );
    await loaded(container);
    await waitFor(() => {
      expect(container.querySelector(".working")).not.toBeNull();
    });
    expect(container.querySelector(".working")?.getAttribute("data-working-since")).toBe(ASKED_AT);
  });

  it("keeps reporting a genuinely outstanding request when a note is added to it", async () => {
    const { container } = render(
      <Host
        transport={wire(
          { agent: "engaged", turns: [TURNS[0] as never, NOTE] },
          {
            jobs: [askJob()],
          },
        )}
      />,
    );
    await loaded(container);
    await waitFor(() => {
      expect(container.querySelector(".working")).not.toBeNull();
    });
    // Measured from the turn that asked, not from the note that followed it.
    expect(container.querySelector(".working")?.getAttribute("data-working-since")).toBe(ASKED_AT);
  });

  /**
   * A real console list is not one row. The lookup scans everything the server
   * returned, so a busy queue must not bury this thread's request — the answer
   * has to be as good at row 50 as at row 1. (What it *cannot* survive is the
   * server truncating the row away entirely; that bound is
   * `outstandingAgentRequest.test.ts`'s subject and CONTRACT-030's.)
   */
  it("finds this thread's request among a full window of other work", async () => {
    const others = Array.from({ length: 49 }, (_, index) =>
      jobFixture({
        eventId: `evt_other_${String(index)}`,
        status: index % 2 === 0 ? "processed" : "in-progress",
        originId: `th_other_${String(index)}`,
        started: `2026-07-01T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
      }),
    );
    const { container } = render(
      <Host
        transport={wire(
          { agent: "requested", turns: [TURNS[0] as never] },
          { jobs: [...others, askJob()] },
        )}
      />,
    );
    await loaded(container);
    await waitFor(() => {
      expect(container.querySelector(".working")).not.toBeNull();
    });
    expect(container.querySelector(".working")?.getAttribute("data-working-since")).toBe(ASKED_AT);
  });

  /**
   * `Job.started` flips from the enqueue instant to the first log line's
   * (CONTRACT-029). A note-only turn landing after that flip used to drag the
   * clock forward with it — the displayed wait jumping *down* by however long the
   * job had been queued. The ask is at 10:05, the first log at 10:07, the note at
   * 10:12, and the row still counts from 10:05.
   */
  it("does not restart the clock when a note follows the job's first log line", async () => {
    const { container } = render(
      <Host
        transport={wire(
          { agent: "engaged", turns: [TURNS[0] as never, NOTE] },
          { jobs: [askJob({ status: "in-progress", started: "2026-07-01T10:07:00.000Z" })] },
        )}
      />,
    );
    await loaded(container);
    await waitFor(() => {
      expect(container.querySelector(".working")).not.toBeNull();
    });
    expect(container.querySelector(".working")?.getAttribute("data-working-since")).toBe(ASKED_AT);
  });

  it("goes quiet once the job is settled, and never speaks for another thread's", async () => {
    const settled = render(
      <Host
        transport={wire(
          { agent: "engaged", turns: [TURNS[0] as never] },
          {
            jobs: [askJob({ status: "processed" })],
          },
        )}
      />,
    );
    await loaded(settled.container);
    expect(settled.container.querySelector(".working")).toBeNull();

    cleanup();
    resetSeenMarks();
    const elsewhere = render(
      <Host
        transport={wire(
          { agent: "engaged", turns: [TURNS[0] as never] },
          {
            jobs: [askJob({ originId: "th_other" })],
          },
        )}
      />,
    );
    await loaded(elsewhere.container);
    expect(elsewhere.container.querySelector(".working")).toBeNull();
  });

  it("still reports work parked on an edit lock — deferred is not finished", async () => {
    const { container } = render(
      <Host
        transport={wire(
          { agent: "engaged", turns: [TURNS[0] as never] },
          {
            jobs: [askJob({ status: "deferred", blockedOn: "doc_m" })],
          },
        )}
      />,
    );
    await loaded(container);
    await waitFor(() => {
      expect(container.querySelector(".working")).not.toBeNull();
    });
  });

  it("sends a note only, and says nothing about an agent that was never asked", async () => {
    const transport = wire({ agent: "engaged" });
    const { container } = render(<Host transport={transport} />);
    await loaded(container);

    fireEvent.click(screen.getByText(ASK_AGENT_LABEL));
    expect(screen.getByText(NOTE_ONLY_LABEL)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "filing this away" } });
    fireEvent.click(screen.getByText(SEND_LABEL));

    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
    });
    const sent = transport.of("POST", "/api/threads/th_a/turns")[0]?.body as {
      requestsAgent?: boolean;
    };
    expect(sent.requestsAgent).toBe(false);
    await waitFor(() => {
      expect(container.querySelectorAll(".turn")).toHaveLength(3);
    });
    expect(container.querySelector(".working")).toBeNull();
  });

  it("shows no progress bar, no percentage, no stream", async () => {
    const { container } = render(
      <Host
        transport={wire({ agent: "requested", turns: [TURNS[0] as never] }, { jobs: [askJob()] })}
      />,
    );
    await loaded(container);
    await waitFor(() => {
      expect(container.querySelector(".working")).not.toBeNull();
    });
    expect(container.querySelector("progress")).toBeNull();
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    expect(container.querySelector(".working")?.textContent).toContain("working");
  });
});

describe("read state", () => {
  it("marks the displayed conversation seen exactly once", async () => {
    const transport = wire();
    const { container, rerender } = render(<Host transport={transport} />);
    await loaded(container);
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/seen")).toHaveLength(1);
    });
    rerender(<Host transport={transport} />);
    expect(transport.of("POST", "/api/threads/th_a/seen")).toHaveLength(1);
  });
});

describe("child threads", () => {
  it("nests a child under the turn its anchor quotes", async () => {
    const transport = readerTransport({
      docs: [PARENT],
      threads: [
        threadFixture({ id: "th_a", parent: "doc_m", turns: TURNS }),
        threadFixture({
          id: "th_child",
          parent: "th_a",
          turns: [
            { author: "user", ts: "2026-07-01T10:09:00.000Z", body: "where from?", model: null },
          ],
        }),
      ],
      rows: {
        "?parent=th_a&type=thread": [
          threadRowFixture({ id: "th_child", parent: "th_a", anchorQuote: "6.4% is closer." }),
        ],
      },
    });
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    await waitFor(() => {
      expect(container.querySelector("[data-thread='th_child']")).not.toBeNull();
    });
    const child = container.querySelector("[data-thread='th_child']");
    expect(child?.closest(".turn")?.getAttribute("data-turn-ts")).toBe(TURNS[1]?.ts);
    expect(child?.getAttribute("data-depth")).toBe("1");
  });

  it("creates a child thread anchored into the turn", async () => {
    const transport = wire();
    const { container } = render(<Host transport={transport} />);
    await loaded(container);
    fireEvent.click(container.querySelector(".turn-comment") as HTMLElement);
    fireEvent.change(screen.getByLabelText("Comment on this turn"), {
      target: { value: "where from?" },
    });
    fireEvent.click(screen.getByText("Comment ⌘↵"));
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads")).toHaveLength(1);
    });
    expect(transport.of("POST", "/api/threads")[0]?.body).toMatchObject({
      parent: "th_a",
      selector: { exact: "is 6.1% right?" },
      requestsAgent: false,
    });
  });
});

/**
 * PR #10 finding 12, end to end through the card.
 *
 * Two open forms offering the same option string. The answer turn the server
 * writes names the option and not the form it answers, so the replay alone put
 * the answer on the *first* form — observed in a browser marking the wrong form
 * answered and leaving the one the user had just clicked live.
 */
describe("two forms offering the same option", () => {
  const FIRST_TS = "2026-07-01T10:10:00.000Z";
  const SECOND_TS = "2026-07-01T10:11:00.000Z";

  function formTurn(ts: string, prompt: string, options: readonly string[]) {
    return {
      author: "agent" as const,
      ts,
      body: [
        "```form",
        `prompt: ${prompt}`,
        "options:",
        ...options.map((option) => `  - ${option}`),
        "```",
      ].join("\n"),
      model: null,
    };
  }

  function twoForms(): ReaderTransport {
    return wire({
      turns: [
        { author: "user", ts: "2026-07-01T10:05:00.000Z", body: "is 6.1% right?", model: null },
        formTurn(FIRST_TS, "File the first quote?", ["Yes", "No"]),
        formTurn(SECOND_TS, "File the second quote?", ["Yes", "Later"]),
      ],
    });
  }

  const formCard = (container: HTMLElement, ts: string): HTMLElement =>
    container.querySelector(`.form-comment[data-form="${ts}"]`) as HTMLElement;

  it("marks the form the user answered, and leaves the other live", async () => {
    const transport = twoForms();
    const { container } = render(<Host transport={transport} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".form-comment")).toHaveLength(2);
    });

    const second = formCard(container, SECOND_TS);
    fireEvent.click(second.querySelectorAll(".form-opt")[0] as HTMLElement);
    fireEvent.click(second.querySelector(".form-submit") as HTMLElement);

    await waitFor(() => {
      expect(
        transport.of("POST", `/api/threads/th_a/turns/${encodeURIComponent(SECOND_TS)}/form`),
      ).toHaveLength(1);
    });
    await waitFor(() => {
      expect(formCard(container, SECOND_TS).dataset["answered"]).toBe("true");
    });
    expect(formCard(container, SECOND_TS).querySelector(".form-record-a")?.textContent).toBe("Yes");
    expect(formCard(container, FIRST_TS).dataset["answered"]).toBeUndefined();
    expect(formCard(container, FIRST_TS).querySelector(".form-submit")).not.toBeNull();
  });
});
