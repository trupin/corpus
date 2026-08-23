/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { DOCS_KEY, TREE_KEY, docKey, threadKey } from "./keys.js";
import { useDeleteFolder, useRenameFolder, useSetFolderArchived } from "./useFolderActs.js";

/**
 * The four folder acts (SPEC.md §9.2, rider 7). Each case asserts the two
 * things that can silently go wrong: **the request that reaches the wire**, and
 * **the keys invalidated afterwards** — an act that writes correctly and
 * invalidates the wrong key leaves the tree and every list stale for the rest of
 * the session, and nothing else in the app would notice.
 */

afterEach(cleanup);

interface Capture {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function transport(
  payload: unknown,
  status = 200,
): { fetch: typeof globalThis.fetch; calls: Capture[] } {
  const calls: Capture[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const raw = await request.text();
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, calls };
}

function spyInvalidations(harness: ReturnType<typeof createCorpusTestHarness>): unknown[][] {
  const seen: unknown[][] = [];
  vi.spyOn(harness.queryClient, "invalidateQueries").mockImplementation((filters) => {
    seen.push((filters?.queryKey ?? []) as unknown[]);
    return Promise.resolve();
  });
  return seen;
}

describe("useRenameFolder", () => {
  it("posts both paths in the body, byte for byte", async () => {
    const wire = transport({ documents: [], warnings: [] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useRenameFolder(), { wrapper: harness.Wrapper });

    result.current.mutate({ from: "Inbox", to: "triage" });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Not lower-cased on the way out: the server compares exactly, and `Inbox`
    // is a `404` in a workspace holding `inbox` (SERVER-136).
    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/folders/rename", body: { from: "Inbox", to: "triage" } },
    ]);
  });

  it("drops the collection, the tree and every document the server named", async () => {
    const wire = transport({
      documents: [
        { id: "doc_a", path: "data/docs/triage/a.md" },
        { id: "th_1", path: "data/docs/triage/a.thread.md" },
      ],
      warnings: [],
    });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const keys = spyInvalidations(harness);
    const { result } = renderHook(() => useRenameFolder(), { wrapper: harness.Wrapper });

    result.current.mutate({ from: "inbox", to: "triage" });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(keys).toEqual([
      DOCS_KEY,
      TREE_KEY,
      docKey("doc_a"),
      threadKey("doc_a"),
      docKey("th_1"),
      threadKey("th_1"),
    ]);
  });

  it("surfaces a conflict rather than reporting a rename that never happened", async () => {
    const wire = transport({ code: "conflict", message: "triage already exists" }, 409);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useRenameFolder(), { wrapper: harness.Wrapper });

    result.current.mutate({ from: "inbox", to: "triage" });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("triage already exists");
  });
});

describe("useSetFolderArchived", () => {
  it.each([
    [true, "/api/folders/archive"],
    [false, "/api/folders/unarchive"],
  ])("posts to the route the direction names (archived=%s)", async (archived, path) => {
    const wire = transport({ documents: [], warnings: [] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetFolderArchived(), { wrapper: harness.Wrapper });

    result.current.mutate({ path: "finance/mortgage", archived });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([{ method: "POST", path, body: { path: "finance/mortgage" } }]);
  });

  it("invalidates every document listed, including ones already archived", async () => {
    // `documents` is the state after the act, not what changed (SERVER-136): a
    // document that was archived before the call is still listed, and its row
    // still has to be dropped, because nothing here can tell the two apart.
    const wire = transport({
      documents: [
        { id: "doc_a", status: "archived" },
        { id: "doc_b", status: "archived" },
      ],
      warnings: [],
    });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const keys = spyInvalidations(harness);
    const { result } = renderHook(() => useSetFolderArchived(), { wrapper: harness.Wrapper });

    result.current.mutate({ path: "finance", archived: true });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(keys).toEqual([
      DOCS_KEY,
      TREE_KEY,
      docKey("doc_a"),
      threadKey("doc_a"),
      docKey("doc_b"),
      threadKey("doc_b"),
    ]);
  });
});

describe("useDeleteFolder", () => {
  it("posts the path and drops the tree, which may still hold the folder", async () => {
    // Delete leaves the folder behind when something that is not a document is
    // still in it (SERVER-136), so the tree is refetched rather than assumed.
    const wire = transport({ documents: [{ id: "doc_a" }], warnings: [] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const keys = spyInvalidations(harness);
    const { result } = renderHook(() => useDeleteFolder(), { wrapper: harness.Wrapper });

    result.current.mutate("scratch");
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/folders/delete", body: { path: "scratch" } },
    ]);
    expect(keys).toEqual([DOCS_KEY, TREE_KEY, docKey("doc_a"), threadKey("doc_a")]);
  });

  it("surfaces a refusal rather than pretending the folder went away", async () => {
    const wire = transport({ code: "forbidden", message: "deletion is user-only" }, 403);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useDeleteFolder(), { wrapper: harness.Wrapper });

    result.current.mutate("scratch");
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("deletion is user-only");
  });
});
