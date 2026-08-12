/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CorpusRequestError, reattachRefusalReason } from "../client/createCorpusClient.js";
import { createCorpusTestHarness } from "../testing/harness.js";
import { DOCS_KEY, docKey, threadKey } from "./keys.js";
import { useReattachThread } from "./useReattachThread.js";

afterEach(() => {
  cleanup();
});

const THREAD = "th_orphan";
const PARENT = "doc_parent";

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly text: string;
}

function wire(response: { status: number; body: unknown } = { status: 200, body: null }) {
  const calls: Recorded[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const source = input instanceof Request ? input : null;
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input.href : input,
    );
    calls.push({
      method: (init?.method ?? source?.method ?? "GET").toUpperCase(),
      path: url.pathname,
      text:
        typeof init?.body === "string"
          ? init.body
          : source === null
            ? ""
            : await source
                .clone()
                .text()
                .catch(() => ""),
    });
    const payload = response.body ?? {
      thread: { id: THREAD, title: "Comment", status: "open", parent: PARENT },
      anchor: {
        anchorId: "anc_orphan",
        threadId: THREAD,
        threadStatus: "open",
        selector: { exact: "Q3", prefix: "", suffix: "" },
        range: { start: 4, end: 6 },
        orphaned: false,
      },
      warnings: [],
    };
    return new Response(JSON.stringify(payload), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetch: fetch };
}

interface HostProps {
  readonly transport: ReturnType<typeof wire>;
  readonly onError?: (error: Error) => void;
}

function Host({ transport, onError }: HostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <Button {...(onError ? { onError } : {})} />
    </harness.Wrapper>
  );
}

function Button({ onError }: { readonly onError?: (error: Error) => void }): ReactElement {
  const reattach = useReattachThread({ ...(onError ? { onError } : {}) });
  return (
    <button
      type="button"
      data-go
      onClick={() => {
        reattach.mutate({
          id: THREAD,
          parentId: PARENT,
          range: { start: 4, end: 6 },
          expectedText: "Q3",
        });
      }}
    >
      go
    </button>
  );
}

describe("useReattachThread", () => {
  it("posts the range and the guard, and nothing else", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    fireEvent.click(document.querySelector("[data-go]") as HTMLButtonElement);

    await waitFor(() => {
      expect(transport.calls).toHaveLength(1);
    });
    const call = transport.calls[0];
    expect(call?.method).toBe("POST");
    expect(call?.path).toBe(`/api/threads/${THREAD}/reattach`);
    expect(JSON.parse(call?.text ?? "null")).toEqual({
      range: { start: 4, end: 6 },
      expectedText: "Q3",
    });
  });

  it("invalidates the thread, the parent and every list", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const invalidated: unknown[][] = [];
    const original = harness.queryClient.invalidateQueries.bind(harness.queryClient);
    harness.queryClient.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
      if (filters?.queryKey !== undefined) invalidated.push(filters.queryKey);
      return original(filters as never);
    }) as typeof harness.queryClient.invalidateQueries;

    function Local(): ReactElement {
      return (
        <harness.Wrapper>
          <Button />
        </harness.Wrapper>
      );
    }
    render(<Local />);
    fireEvent.click(document.querySelector("[data-go]") as HTMLButtonElement);

    await waitFor(() => {
      expect(invalidated).toContainEqual(threadKey(THREAD));
    });
    expect(invalidated).toContainEqual(docKey(THREAD));
    expect(invalidated).toContainEqual(docKey(PARENT));
    expect(invalidated).toContainEqual(DOCS_KEY);
  });

  it("surfaces the refusal so the caller can say what it means", async () => {
    const transport = wire({
      status: 409,
      body: { code: "conflict", message: "the range changed", reason: "range-changed" },
    });
    const errors: Error[] = [];
    render(
      <Host
        transport={transport}
        onError={(error) => {
          errors.push(error);
        }}
      />,
    );
    fireEvent.click(document.querySelector("[data-go]") as HTMLButtonElement);

    await waitFor(() => {
      expect(errors).toHaveLength(1);
    });
    expect(reattachRefusalReason(errors[0])).toBe("range-changed");
    expect(errors[0]?.message).toBe("the range changed");
  });
});

describe("reattachRefusalReason", () => {
  const conflict = (payload: unknown): CorpusRequestError =>
    new CorpusRequestError("POST /api/threads/{id}/reattach", 409, payload);

  it.each(["range-changed", "range-overlaps", "not-anchored"])(
    "reads %s off the body",
    (reason) => {
      expect(reattachRefusalReason(conflict({ code: "conflict", message: "no", reason }))).toBe(
        reason,
      );
    },
  );

  it("answers null for a reason this build has never heard of", () => {
    expect(
      reattachRefusalReason(conflict({ code: "conflict", message: "no", reason: "invented" })),
    ).toBeNull();
  });

  it("answers null for a failure that is not a re-attach refusal", () => {
    expect(
      reattachRefusalReason(
        new CorpusRequestError("POST /api/threads/{id}/reattach", 404, {
          code: "not_found",
          message: "no such thread",
        }),
      ),
    ).toBeNull();
    expect(reattachRefusalReason(new Error("network down"))).toBeNull();
    expect(reattachRefusalReason(null)).toBeNull();
  });
});
