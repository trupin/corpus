/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createCorpusTestHarness } from "../testing/harness.js";
import { useAppendTurn } from "./useAppendTurn.js";
import { useDeleteTurn } from "./useDeleteTurn.js";
import { hasSeenMark, resetSeenMarks, useMarkSeenOnce } from "./useMarkSeenOnce.js";
import { useRespondToForm } from "./useRespondToForm.js";

afterEach(() => {
  cleanup();
  resetSeenMarks();
});

const TS = "2026-07-19T10:05:00.000Z";

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly contentType: string | null;
  /** The `body` init as given to `fetch`, before any realm converts it. */
  readonly rawBody: unknown;
  /** The serialised body, for the JSON routes `openapi-fetch` builds itself. */
  readonly text: string;
}

function wire(options: { readonly failSeen?: boolean } = {}) {
  const calls: Recorded[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request
      .clone()
      .text()
      .catch(() => "");
    calls.push({
      method: request.method,
      path: url.pathname,
      contentType: request.headers.get("content-type"),
      // jsdom's `FormData` and Node's `Request` are different realms, so the
      // multipart content-type is not observable through a constructed
      // `Request` here (the same environment defect the client's
      // `canForwardAbortSignal` documents). The `init` is, and it is the honest
      // record of which branch the hook took.
      rawBody: init?.body,
      text,
    });
    if (options.failSeen === true && url.pathname.endsWith("/seen")) {
      return new Response("{}", { status: 500 });
    }
    return new Response(
      JSON.stringify({
        threadId: "th_a",
        lastSeenTs: TS,
        unread: false,
        deletedTurn: true,
        deletedThread: false,
        removedAnchor: null,
        parentId: "doc_m",
        warnings: [],
        eventId: null,
        turn: { author: "user", ts: TS, body: "x" },
        thread: {
          id: "th_a",
          title: "t",
          status: "open",
          parent: null,
          anchor: null,
          agent: "none",
          created: TS,
          updated: TS,
          turnCount: 1,
          lastAuthor: "user",
          lastTs: TS,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { fetch, calls };
}

function Seen({
  wired,
  lastTs,
}: {
  readonly wired: ReturnType<typeof wire>;
  readonly lastTs: string;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: wired.fetch }));
  return (
    <harness.Wrapper>
      <SeenButton lastTs={lastTs} />
    </harness.Wrapper>
  );
}

function SeenButton({ lastTs }: { readonly lastTs: string }): ReactElement {
  const { markSeen } = useMarkSeenOnce();
  return (
    <button
      type="button"
      onClick={() => {
        markSeen("th_a", lastTs);
      }}
    >
      mark
    </button>
  );
}

describe("useMarkSeenOnce", () => {
  it("posts once per (thread, last turn) no matter how often it is displayed", async () => {
    const wired = wire();
    const { rerender } = render(<Seen wired={wired} lastTs={TS} />);
    fireEvent.click(screen.getByText("mark"));
    fireEvent.click(screen.getByText("mark"));
    fireEvent.click(screen.getByText("mark"));
    await waitFor(() => {
      expect(wired.calls.filter((call) => call.path.endsWith("/seen"))).toHaveLength(1);
    });
    expect(hasSeenMark("th_a", TS)).toBe(true);

    // A new turn re-arms it: the pair changed.
    rerender(<Seen wired={wired} lastTs="2026-07-19T11:00:00.000Z" />);
    fireEvent.click(screen.getByText("mark"));
    await waitFor(() => {
      expect(wired.calls.filter((call) => call.path.endsWith("/seen"))).toHaveLength(2);
    });
  });

  it("sends no body, so the contract's partial-read parameter stays unused", async () => {
    const wired = wire();
    render(<Seen wired={wired} lastTs={TS} />);
    fireEvent.click(screen.getByText("mark"));
    await waitFor(() => {
      expect(wired.calls.some((call) => call.path.endsWith("/seen"))).toBe(true);
    });
    const seen = wired.calls.find((call) => call.path.endsWith("/seen"));
    expect(seen?.contentType).toBeNull();
  });

  /** A thread with no turns cannot be unread: there is nothing to have read. */
  it("marks nothing when there is no last turn", async () => {
    const wired = wire();
    render(<Seen wired={wired} lastTs="" />);
    fireEvent.click(screen.getByText("mark"));
    await waitFor(() => {
      expect(screen.getByText("mark")).toBeDefined();
    });
    expect(wired.calls.filter((call) => call.path.endsWith("/seen"))).toHaveLength(0);
    expect(hasSeenMark("th_a", "")).toBe(false);
  });

  it("forgets a failed mark rather than claiming the badge cleared", async () => {
    const wired = wire({ failSeen: true });
    render(<Seen wired={wired} lastTs={TS} />);
    fireEvent.click(screen.getByText("mark"));
    await waitFor(() => {
      expect(hasSeenMark("th_a", TS)).toBe(false);
    });
    fireEvent.click(screen.getByText("mark"));
    await waitFor(() => {
      expect(wired.calls.filter((call) => call.path.endsWith("/seen")).length).toBe(2);
    });
  });
});

function Writes({ wired }: { readonly wired: ReturnType<typeof wire> }): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: wired.fetch }));
  return (
    <harness.Wrapper>
      <WriteButtons />
    </harness.Wrapper>
  );
}

function WriteButtons(): ReactElement {
  const remove = useDeleteTurn("th_a");
  const respond = useRespondToForm("th_a");
  const append = useAppendTurn("th_a");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          remove.mutate(TS);
        }}
      >
        delete
      </button>
      <button
        type="button"
        onClick={() => {
          respond.mutate({ ts: TS, option: "Lemonade" });
        }}
      >
        answer
      </button>
      <button
        type="button"
        onClick={() => {
          append.mutate({ body: "", files: [new File(["a"], "shot.png", { type: "image/png" })] });
        }}
      >
        attach
      </button>
      <button
        type="button"
        onClick={() => {
          append.mutate({ body: "hello", requestsAgent: false });
        }}
      >
        reply
      </button>
    </>
  );
}

describe("the turn write hooks", () => {
  it("targets the URL-encoded timestamp on delete", async () => {
    const wired = wire();
    render(<Writes wired={wired} />);
    fireEvent.click(screen.getByText("delete"));
    await waitFor(() => {
      expect(wired.calls.some((call) => call.method === "DELETE")).toBe(true);
    });
    expect(wired.calls.find((call) => call.method === "DELETE")?.path).toBe(
      `/api/threads/th_a/turns/${encodeURIComponent(TS)}`,
    );
  });

  /** Open Conflict 1: the form route, never a hand-built turn on `/turns`. */
  it("answers a form through the form route", async () => {
    const wired = wire();
    render(<Writes wired={wired} />);
    fireEvent.click(screen.getByText("answer"));
    await waitFor(() => {
      expect(wired.calls.some((call) => call.path.endsWith("/form"))).toBe(true);
    });
    expect(wired.calls.find((call) => call.path.endsWith("/form"))?.path).toBe(
      `/api/threads/th_a/turns/${encodeURIComponent(TS)}/form`,
    );
    expect(wired.calls.filter((call) => call.path === "/api/threads/th_a/turns")).toHaveLength(0);
  });

  it("switches the append to multipart when files are present", async () => {
    const wired = wire();
    render(<Writes wired={wired} />);
    fireEvent.click(screen.getByText("attach"));
    await waitFor(() => {
      expect(wired.calls.some((call) => call.path === "/api/threads/th_a/turns")).toBe(true);
    });
    const post = wired.calls.find((call) => call.path === "/api/threads/th_a/turns");
    expect(post?.rawBody).toBeInstanceOf(FormData);
    const form = post?.rawBody as FormData;
    // Attachment-only: no `text` part at all, and the file rides `files`.
    expect(form.has("text")).toBe(false);
    expect(form.getAll("files")).toHaveLength(1);
  });

  it("keeps a text-only append on the JSON route", async () => {
    const wired = wire();
    render(<Writes wired={wired} />);
    fireEvent.click(screen.getByText("reply"));
    await waitFor(() => {
      expect(wired.calls.some((call) => call.path === "/api/threads/th_a/turns")).toBe(true);
    });
    const post = wired.calls.find((call) => call.path === "/api/threads/th_a/turns");
    expect(JSON.parse(post?.text ?? "")).toEqual({ body: "hello", requestsAgent: false });
  });
});
