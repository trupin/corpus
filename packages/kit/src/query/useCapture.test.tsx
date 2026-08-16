/** @vitest-environment jsdom */
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CorpusRequestError } from "../client/createCorpusClient.js";
import { createCorpusTestHarness } from "../testing/harness.js";
import { DOCS_KEY, QUEUE_KEY, TREE_KEY } from "./keys.js";
import { useCapture } from "./useCapture.js";
import { useCreateThread } from "./useCreateThread.js";

/**
 * The two writes the global composer makes (SPEC.md §11). Both are asserted at
 * the transport, because what matters about them is the *shape on the wire* —
 * which field carried the text, whether `requestsAgent` was the string `"true"`,
 * and that Capture is one request rather than three.
 */

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly form: Record<string, string> | undefined;
  readonly files: readonly string[];
  readonly json: unknown;
}

function wire(options: { readonly eventId?: string | null; readonly status?: number } = {}) {
  const calls: Recorded[] = [];
  const eventId = options.eventId === undefined ? "evt_1" : options.eventId;

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // The `init` body is deliberately withheld from `new Request`: this test
    // runs in jsdom, so a `FormData` here is jsdom's while `Request` is Node's
    // undici, and constructing one around a foreign-realm body is rejected on
    // Node 22 (what CI runs) though tolerated on Node 25. Everything the
    // fixture asserts is read off `init` or off a `Request` the caller built.
    const request =
      input instanceof Request
        ? input
        : new Request(String(input), {
            method: init?.method ?? "GET",
            ...(init?.headers === undefined ? {} : { headers: init.headers }),
          });
    const url = new URL(request.url);
    const sent = init?.body ?? null;

    let form: Record<string, string> | undefined;
    let json: unknown;
    const files: string[] = [];
    if (sent instanceof FormData) {
      form = {};
      for (const [name, value] of sent) {
        if (typeof value === "string") form[name] = value;
        else files.push(value.name);
      }
    } else {
      const text = sent === null ? await request.clone().text() : bodyText(sent);
      json = text === "" ? undefined : JSON.parse(text);
    }
    calls.push({ method: init?.method ?? request.method, path: url.pathname, form, files, json });

    if (options.status !== undefined) {
      return new Response(JSON.stringify({ code: "bad_request", message: "too big", issues: [] }), {
        status: options.status,
        headers: { "content-type": "application/json" },
      });
    }
    const payload =
      url.pathname === "/api/capture"
        ? { docId: "doc_c", threadId: "th_c", eventId, warnings: [] }
        : {
            thread: {
              id: "th_n",
              title: "t",
              parent: null,
              anchor: null,
              status: "open",
              tags: [],
              agent: "requested",
              resident: null,
              turns: [],
              created: "2026-07-28T10:00:00Z",
              updated: "2026-07-28T10:00:00Z",
            },
            anchorId: null,
            eventId,
            warnings: [],
          };
    return new Response(JSON.stringify(payload), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  return { calls, fetch };
}

/** JSON bodies reach `fetch` as a string; anything else is not a body this fixture reads. */
function bodyText(body: BodyInit): string {
  return typeof body === "string" ? body : "";
}

const file = (name: string): File => new File(["x"], name, { type: "image/png" });

describe("useCapture", () => {
  it("posts one multipart request and returns the server's three ids", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useCapture(), { wrapper: harness.Wrapper });

    await act(async () => {
      const answer = await result.current.mutateAsync({ text: "a thought", requestsAgent: true });
      expect(answer).toEqual({
        docId: "doc_c",
        threadId: "th_c",
        eventId: "evt_1",
        warnings: [],
      });
    });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/capture",
      form: { text: "a thought", requestsAgent: "true" },
    });
  });

  it("carries attachments as repeated `files` parts", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useCapture(), { wrapper: harness.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ text: "x", files: [file("a.png"), file("b.png")] });
    });
    expect(transport.calls[0]?.files).toEqual(["a.png", "b.png"]);
  });

  it("omits `requestsAgent` when the caller does not decide — the flag is tri-state", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useCapture(), { wrapper: harness.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ text: "x" });
    });
    expect(transport.calls[0]?.form).toEqual({ text: "x" });
  });

  it("invalidates the documents, the tree and the queue", async () => {
    const transport = wire();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidated: unknown[] = [];
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = (filters) => {
      invalidated.push(filters?.queryKey);
      return original(filters);
    };
    const harness = createCorpusTestHarness({ fetch: transport.fetch, queryClient });
    const { result } = renderHook(() => useCapture(), { wrapper: harness.Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ text: "x" });
    });
    await waitFor(() => {
      expect(invalidated).toContainEqual(DOCS_KEY);
    });
    expect(invalidated).toContainEqual(TREE_KEY);
    expect(invalidated).toContainEqual(QUEUE_KEY);
  });

  it("leaves the queue alone when the server enqueued nothing", async () => {
    const transport = wire({ eventId: null });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidated: unknown[] = [];
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = (filters) => {
      invalidated.push(filters?.queryKey);
      return original(filters);
    };
    const harness = createCorpusTestHarness({ fetch: transport.fetch, queryClient });
    const { result } = renderHook(() => useCapture(), { wrapper: harness.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ text: "x" });
    });
    expect(invalidated).not.toContainEqual(QUEUE_KEY);
  });

  /** A `413` arrives as the client's own error, carrying the server's message. */
  it("raises the client's error type for an over-cap upload", async () => {
    const transport = wire({ status: 413 });
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useCapture(), { wrapper: harness.Wrapper });
    await act(async () => {
      const failure = await result.current
        .mutateAsync({ text: "x", files: [file("a.png")] })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CorpusRequestError);
      expect((failure as CorpusRequestError).status).toBe(413);
      expect((failure as CorpusRequestError).message).toContain("too big");
    });
  });
});

describe("useCreateThread with attachments", () => {
  it("stays JSON when there are no files", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ parent: null, selector: null, body: "hi" });
    });
    expect(transport.calls[0]?.json).toEqual({ parent: null, selector: null, body: "hi" });
    expect(transport.calls[0]?.form).toBeUndefined();
  });

  it("switches to multipart when the first turn carries files, naming the prose `text`", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        parent: null,
        selector: null,
        body: "look",
        requestsAgent: true,
        files: [file("a.png")],
      });
    });
    expect(transport.calls[0]?.form).toEqual({ text: "look", requestsAgent: "true" });
    expect(transport.calls[0]?.files).toEqual(["a.png"]);
  });

  it("sends an anchored comment's selector as one JSON part, without undefined context", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        parent: "doc_p",
        selector: { exact: "a phrase", prefix: "before " },
        body: "note",
        files: [file("a.png")],
      });
    });
    expect(transport.calls[0]?.form).toEqual({
      parent: "doc_p",
      selector: JSON.stringify({ exact: "a phrase", prefix: "before " }),
      text: "note",
    });
  });

  it("allows an attachment-only first turn", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const { result } = renderHook(() => useCreateThread(), { wrapper: harness.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        parent: null,
        selector: null,
        body: "",
        files: [file("a.png")],
      });
    });
    expect(transport.calls[0]?.form).toEqual({});
    expect(transport.calls[0]?.files).toEqual(["a.png"]);
  });
});
