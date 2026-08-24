/** @vitest-environment jsdom */
import type { Thread, ThreadSummary } from "@corpus/contract";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppendTurn } from "../query/useAppendTurn.js";
import { useCapture } from "../query/useCapture.js";
import { useCreateThread } from "../query/useCreateThread.js";
import { createCorpusTestHarness, type CorpusTestHarness } from "../testing/harness.js";

/**
 * A stated weight, on **all five** composer request bodies (CONTRACT-039) —
 * JSON and multipart alike.
 *
 * Enumerated rather than sampled, because sampling is exactly how three of five
 * composers ended up without attachments (UI-070, SHARED-012's lesson): a
 * `weight` that survived only the JSON branch would be silently dropped the
 * first time someone attached a file to a request they had chosen a level for.
 *
 * The assertions are at the transport, because the claim is about the bytes: the
 * key is named `weight`, its value is the Key token verbatim, and **absence is
 * an absent key** — never `null`, never `""`, which the contract answers with a
 * `400`.
 */

afterEach(cleanup);

interface Sent {
  readonly path: string;
  readonly json: Record<string, unknown> | undefined;
  readonly form: Record<string, string> | undefined;
}

function wire(): { fetch: typeof globalThis.fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input : new Request(String(input), { method: "GET" });
    const url = new URL(raw.url);
    const body = init?.body ?? null;

    let json: Record<string, unknown> | undefined;
    let form: Record<string, string> | undefined;
    if (body instanceof FormData) {
      form = {};
      for (const [name, value] of body) if (typeof value === "string") form[name] = value;
    } else {
      const text = body === null ? await raw.clone().text() : typeof body === "string" ? body : "";
      json = text === "" ? undefined : (JSON.parse(text) as Record<string, unknown>);
    }
    sent.push({ path: url.pathname, json, form });

    /*
     * `satisfies Thread` rather than a bare literal: the multipart routes parse
     * their answers with the contract's own schema and the JSON ones do not, so
     * a missing required field is a `ZodError` on exactly one branch and
     * invisible on the other. The annotation moves that gap to compile time.
     */
    const thread = {
      id: "th_1",
      title: "T",
      parent: null,
      anchor: null,
      status: "open",
      tags: [],
      agent: "requested",
      resident: null,
      unread: false,
      turns: [],
      created: "2026-08-08T10:00:00Z",
      updated: "2026-08-08T10:00:00Z",
    } satisfies Thread;
    const payload =
      url.pathname === "/api/capture"
        ? { docId: "doc_1", threadId: "th_1", eventId: "evt_1", warnings: [] }
        : url.pathname === "/api/threads"
          ? { thread, anchorId: null, eventId: "evt_1", warnings: [] }
          : {
              // The multipart turn route parses its answer with the contract's
              // own schema, so the fixture answers the whole envelope.
              thread: {
                id: "th_a",
                title: "T",
                parent: null,
                anchor: null,
                status: "open",
                agent: "requested",
                resident: null,
                created: "2026-08-08T10:00:00Z",
                updated: "2026-08-08T10:00:00Z",
                turnCount: 1,
                lastAuthor: "user",
                lastTs: "2026-08-08T10:00:00Z",
              } satisfies ThreadSummary,
              turn: {
                author: "user",
                ts: "2026-08-08T10:00:00Z",
                body: "hi",
                model: null,
                attachments: [],
              },
              eventId: "evt_1",
              warnings: [],
            };
    return new Response(JSON.stringify(payload), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, sent };
}

function file(): File {
  return new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
}

/** `{ weight }` or `{}` — the caller-side spelling of "stated nothing". */
function stated(weight: string | undefined): { weight?: string } {
  return weight === undefined ? {} : { weight };
}

interface Body {
  readonly name: string;
  readonly path: string;
  /** Multipart sends every value as a string part; JSON sends the value. */
  readonly multipart: boolean;
  readonly send: (harness: CorpusTestHarness, weight: string | undefined) => Promise<void>;
}

/** The five composer request bodies, each as one named case. */
const BODIES: readonly Body[] = [
  {
    name: "POST /api/threads (JSON) — Ask, and a comment",
    path: "/api/threads",
    multipart: false,
    send: async (harness, weight) => {
      const view = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });
      await act(async () => {
        await view.result.current.mutateAsync({
          parent: null,
          selector: null,
          body: "hello",
          requestsAgent: true,
          ...stated(weight),
        });
      });
    },
  },
  {
    name: "POST /api/threads (multipart) — the same, with a file",
    path: "/api/threads",
    multipart: true,
    send: async (harness, weight) => {
      const view = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });
      await act(async () => {
        await view.result.current.mutateAsync({
          parent: null,
          selector: null,
          body: "hello",
          requestsAgent: true,
          files: [file()],
          ...stated(weight),
        });
      });
    },
  },
  {
    name: "POST /api/threads/{id}/turns (JSON) — a thread's reply box",
    path: "/api/threads/th_a/turns",
    multipart: false,
    send: async (harness, weight) => {
      const view = renderHook(() => useAppendTurn("th_a"), { wrapper: harness.Wrapper });
      await act(async () => {
        await view.result.current.mutateAsync({
          body: "hello",
          requestsAgent: true,
          ...stated(weight),
        });
      });
    },
  },
  {
    name: "POST /api/threads/{id}/turns (multipart) — the same, with a file",
    path: "/api/threads/th_a/turns",
    multipart: true,
    send: async (harness, weight) => {
      const view = renderHook(() => useAppendTurn("th_a"), { wrapper: harness.Wrapper });
      await act(async () => {
        await view.result.current.mutateAsync({
          body: "hello",
          requestsAgent: true,
          files: [file()],
          ...stated(weight),
        });
      });
    },
  },
  {
    name: "POST /api/capture (multipart) — Capture",
    path: "/api/capture",
    multipart: true,
    send: async (harness, weight) => {
      const view = renderHook(() => useCapture(), { wrapper: harness.Wrapper });
      await act(async () => {
        await view.result.current.mutateAsync({
          text: "a thought",
          requestsAgent: true,
          ...stated(weight),
        });
      });
    },
  },
];

describe.each(BODIES)("$name", (body) => {
  it("carries the stated Key verbatim", async () => {
    const transport = wire();
    await body.send(createCorpusTestHarness({ fetch: transport.fetch }), "light");
    const call = transport.sent.find((sent) => sent.path === body.path);
    expect(call).toBeDefined();
    expect((body.multipart ? call?.form : call?.json)?.["weight"]).toBe("light");
  });

  it("states nothing when nothing was chosen — an absent key, not a null", async () => {
    const transport = wire();
    await body.send(createCorpusTestHarness({ fetch: transport.fetch }), undefined);
    const call = transport.sent.find((sent) => sent.path === body.path);
    expect(call).toBeDefined();
    const sent = (body.multipart ? call?.form : call?.json) ?? {};
    expect("weight" in sent).toBe(false);
    expect(JSON.stringify(sent)).not.toContain("weight");
  });
});
