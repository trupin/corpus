import type { CorpusClient } from "@corpus/kit";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abandonEmptyDoc } from "./abandonEmptyDoc";
import {
  isAbandoned,
  publishBodyDraft,
  publishDoc,
  publishTitleDraft,
  resetAbandonRegistry,
  snapshotOf,
  subscribeAbandoned,
} from "./registry";

afterEach(() => {
  resetAbandonRegistry();
  vi.restoreAllMocks();
});

const BLANK = { type: "note", title: "Untitled", body: "", threadCount: 0, hasExtra: false };

function fakeClient(
  deleteDoc: (id: string) => Promise<unknown> = () =>
    Promise.resolve({ deletedId: "x", orphanedThreadIds: [], warnings: [] }),
): { client: CorpusClient; deleteDoc: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(deleteDoc);
  // Only `deleteDoc` is reachable from this unit; the rest of the surface is
  // deliberately absent so a second call site would fail loudly rather than
  // silently hitting a stub.
  return { client: { deleteDoc: spy } as unknown as CorpusClient, deleteDoc: spy };
}

describe("abandonEmptyDoc", () => {
  it("deletes an empty document and invalidates what listed it", async () => {
    publishDoc("doc_a", BLANK);
    const { client, deleteDoc } = fakeClient();
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await expect(abandonEmptyDoc("doc_a", client, queryClient)).resolves.toBe(true);

    expect(deleteDoc).toHaveBeenCalledWith("doc_a");
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(snapshotOf("doc_a")).toBeNull();
  });

  it("marks the document abandoned before the request leaves", async () => {
    publishDoc("doc_a", BLANK);
    let markedDuringRequest = false;
    const { client } = fakeClient(async (id) => {
      markedDuringRequest = isAbandoned(id);
      return Promise.resolve({});
    });

    await abandonEmptyDoc("doc_a", client, new QueryClient());
    expect(markedDuringRequest).toBe(true);
  });

  it("tells the hosts before the request, so Back never lands on a tombstone", async () => {
    publishDoc("doc_a", BLANK);
    const order: string[] = [];
    subscribeAbandoned((id) => {
      order.push(`announced:${id}`);
    });
    const { client } = fakeClient(async (id) => {
      order.push(`deleted:${id}`);
      return Promise.resolve({});
    });

    await abandonEmptyDoc("doc_a", client, new QueryClient());
    expect(order).toEqual(["announced:doc_a", "deleted:doc_a"]);
  });

  it("leaves a document that carries a title", async () => {
    publishDoc("doc_a", { ...BLANK, title: "Quarterly planning" });
    const { client, deleteDoc } = fakeClient();

    await expect(abandonEmptyDoc("doc_a", client, new QueryClient())).resolves.toBe(false);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("acts on the live buffer, not on the corpus's copy", async () => {
    publishDoc("doc_a", { ...BLANK, body: "half a sentence" });
    publishBodyDraft("doc_a", "");
    publishTitleDraft("doc_a", "");
    const { client, deleteDoc } = fakeClient();

    await expect(abandonEmptyDoc("doc_a", client, new QueryClient())).resolves.toBe(true);
    expect(deleteDoc).toHaveBeenCalledWith("doc_a");
  });

  it("does nothing for a document it knows nothing about", async () => {
    const { client, deleteDoc } = fakeClient();
    await expect(abandonEmptyDoc("doc_a", client, new QueryClient())).resolves.toBe(false);
    await expect(abandonEmptyDoc("", client, new QueryClient())).resolves.toBe(false);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("never deletes the same document twice", async () => {
    publishDoc("doc_a", BLANK);
    const { client, deleteDoc } = fakeClient();
    const queryClient = new QueryClient();

    const [first, second] = await Promise.all([
      abandonEmptyDoc("doc_a", client, queryClient),
      abandonEmptyDoc("doc_a", client, queryClient),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });

  it("swallows a refusal — leaving is not a request that can fail", async () => {
    publishDoc("doc_a", BLANK);
    const { client } = fakeClient(() => Promise.reject(new Error("409 refused")));

    await expect(abandonEmptyDoc("doc_a", client, new QueryClient())).resolves.toBe(true);
    expect(snapshotOf("doc_a")).toBeNull();
  });
});
