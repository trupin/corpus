// SPEC.md §7's scope listing (SERVER-130): `GET /api/threads/{id}/scope`.
//
// Driven through the real route, over a real workspace, with every member put
// there by the **write path** rather than by a seeded row: a document is in a
// scope because a job stamped its `origin`, and a thread is because it was
// created on something. That is the only way this suite can claim the listing
// agrees with the routing — the two are the same walk, and a fixture that wrote
// the columns by hand would only be asking whether the walk reads its own
// inputs. The one place files are written directly is the bound, where the
// question is arithmetic and two hundred `POST`s would buy nothing.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SCOPE_PAGE_SIZE,
  ThreadScopeSchema,
  type ScopeMember,
  type ThreadScope,
} from "@corpus/contract";
import { docMarkdown } from "../docs/corpus-fixture.js";
import {
  createDoc,
  createThread,
  createThreadWorkspace,
  type WriteWorkspace,
} from "./thread-fixture.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("scope-listing");
});

afterEach(() => {
  ws.close();
});

const scopeResponse = async (id: string): Promise<Response> =>
  ws.request(`/api/threads/${id}/scope`);

/** The listing, parsed by the contract's own schema — never by this file's idea of it. */
async function scopeOf(id: string): Promise<ThreadScope> {
  const response = await scopeResponse(id);
  expect(response.status).toBe(200);
  const parsed = ThreadScopeSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`not a ThreadScope: ${parsed.error.message}`);
  return parsed.data;
}

/** `POST /api/docs`'s body for the document a job writes — the origin edge's whole cause. */
const DOC_WRITTEN = (job: string): Record<string, unknown> => ({
  type: "note",
  title: "Findings",
  body: "What we found.",
  job,
});

const memberIds = (scope: ThreadScope): string[] => scope.members.map((member) => member.id);

const memberFor = (scope: ThreadScope, id: string): ScopeMember | undefined =>
  scope.members.find((member) => member.id === id);

/**
 * A designated standalone thread — a lane — and the id of the event its `@agent`
 * mention enqueued, which is what a later write names as its `job` to be filed
 * into this conversation (SPEC.md §9.2).
 */
async function lane(body = "Please look into this @agent"): Promise<{ id: string; job: string }> {
  const created = await createThread(ws, { body });
  expect((await ws.post(`/api/threads/${created.id}/resident`, {})).status).toBe(200);
  // The job is the point of the mention: without an enqueued event nothing in
  // this suite could acquire an origin through the ordinary write path.
  expect(created.eventId).not.toBeNull();
  return { id: created.id, job: created.eventId ?? "" };
}

describe("the scope of a designated thread", () => {
  it("lists the thread, what a job it ran wrote, and the conversations on it", async () => {
    const root = await lane();
    const written = await createDoc(ws, DOC_WRITTEN(root.job));
    const onDocument = await createThread(ws, { parent: written.id, body: "A question here." });
    const onThread = await createThread(ws, { parent: root.id, body: "A follow-up." });
    const unrelated = await createDoc(ws, {
      type: "note",
      title: "Elsewhere",
      body: "Nothing to do with it.",
    });

    const scope = await scopeOf(root.id);

    expect(scope.thread).toBe(root.id);
    expect(scope.truncated).toBe(false);
    expect(new Set(memberIds(scope))).toEqual(
      new Set([root.id, written.id, onDocument.id, onThread.id]),
    );
    expect(memberIds(scope)).not.toContain(unrelated.id);
  });

  /** The root is the scope, by no edge at all — and it is always the first line. */
  it("puts the thread itself first, as `self`", async () => {
    const root = await lane();
    await createDoc(ws, DOC_WRITTEN(root.job));

    const scope = await scopeOf(root.id);

    // The title is the one the thread derived from its first turn, so it is
    // asserted as "there is one" rather than restated here.
    const first = scope.members[0];
    expect(first?.id).toBe(root.id);
    expect(first?.kind).toBe("thread");
    expect(first?.status).toBe("open");
    expect(first?.via).toBe("self");
    expect(first?.title).not.toBe("");
    expect(scope.members.slice(1).map((member) => member.via)).not.toContain("self");
  });

  /**
   * `via` is the edge the walk took, and the two are told apart by which branch
   * reached the root — not by which columns the row happens to carry.
   */
  it("reports how each member reached the scope", async () => {
    const root = await lane();
    const written = await createDoc(ws, DOC_WRITTEN(root.job));
    const onDocument = await createThread(ws, { parent: written.id, body: "A question here." });

    const scope = await scopeOf(root.id);

    expect(memberFor(scope, written.id)?.via).toBe("origin");
    expect(memberFor(scope, written.id)?.kind).toBe("doc");
    expect(memberFor(scope, onDocument.id)?.via).toBe("parent");
    expect(memberFor(scope, onDocument.id)?.kind).toBe("thread");
  });

  /**
   * §7's own words: archiving does not touch `origin` or `parent`, and detaching
   * is the way out of a scope. So an archived document is still owned — and the
   * `status` field is what tells a reader it is archived.
   */
  it("still lists an archived document, with its status", async () => {
    const root = await lane();
    const written = await createDoc(ws, DOC_WRITTEN(root.job));
    expect((await ws.post(`/api/docs/${written.id}/archive`, {})).status).toBe(200);

    const scope = await scopeOf(root.id);

    expect(memberFor(scope, written.id)).toEqual({
      id: written.id,
      kind: "doc",
      title: "Findings",
      status: "archived",
      via: "origin",
    });
  });

  /**
   * The order the bound is meaningful under: the root, then the live end of the
   * scope first. The clock is the fixture's, so each write below is a deliberate
   * instant rather than whatever the wall clock gave.
   */
  it("orders every other member most recently updated first", async () => {
    const root = await lane();
    const first = await createDoc(ws, { ...DOC_WRITTEN(root.job), title: "First" });
    ws.advance(60_000);
    const second = await createDoc(ws, { ...DOC_WRITTEN(root.job), title: "Second" });
    ws.advance(60_000);
    const third = await createDoc(ws, { ...DOC_WRITTEN(root.job), title: "Third" });

    expect(memberIds(await scopeOf(root.id))).toEqual([root.id, third.id, second.id, first.id]);
  });
});

describe("the bound on a listing", () => {
  /**
   * Seeded as files rather than through `POST /api/docs`: what is being asked is
   * whether the cut happens at {@link SCOPE_PAGE_SIZE} and says so, and the write
   * path has nothing to contribute to that question but two hundred commits.
   */
  const seedDocuments = (originThread: string, count: number): void => {
    for (let index = 0; index < count; index += 1) {
      const id = `doc_seed${String(index).padStart(3, "0")}`;
      ws.write(
        `data/docs/inbox/${id}.md`,
        docMarkdown({
          id,
          title: `Seeded ${String(index)}`,
          // One minute apart and ascending with the index, so the listing's
          // order is the reverse of the seeded one: the cut is then observable
          // as *which* members fell off, not merely as a count.
          updated: new Date(Date.UTC(2026, 6, 1) + index * 60_000)
            .toISOString()
            .replace(".000Z", "Z"),
          frontmatter: { origin: originThread },
        }),
      );
    }
    ws.reproject();
  };

  it("returns the whole scope, untruncated, up to the page size", async () => {
    const root = await lane();
    seedDocuments(root.id, SCOPE_PAGE_SIZE - 1);

    const scope = await scopeOf(root.id);

    expect(scope.members).toHaveLength(SCOPE_PAGE_SIZE);
    expect(scope.truncated).toBe(false);
  });

  it("cuts at the page size and says so", async () => {
    const root = await lane();
    seedDocuments(root.id, SCOPE_PAGE_SIZE + 20);

    const scope = await scopeOf(root.id);

    expect(scope.members).toHaveLength(SCOPE_PAGE_SIZE);
    expect(scope.truncated).toBe(true);
    // The root survives the cut, because it is not sorted with the rest…
    expect(scope.members[0]?.id).toBe(root.id);
    // …and what fell off is the least recently updated end: 220 seeded, 199
    // places left after the root, so the newest 199 stay and the oldest 21 go.
    expect(memberIds(scope)).toContain("doc_seed219");
    expect(memberIds(scope)).toContain("doc_seed021");
    expect(memberIds(scope)).not.toContain("doc_seed020");
    expect(memberIds(scope)).not.toContain("doc_seed000");
  });
});

describe("a thread with no scope to list", () => {
  /**
   * The orchestrator's lane is not a scope (CONTRACT-068): §7 gives a scope to a
   * designated thread, and everything outside every scope is the orchestrator's
   * by default — so this is a `409` and not an empty listing.
   */
  it("refuses an undesignated thread with a 409 that names the remedy", async () => {
    // Explicitly undesignated, because since SPEC.md §7's rider A a plain
    // `POST /api/threads` designates a general resident (SERVER-154) and would
    // give this thread the very scope the case is about not having.
    const created = await createThread(ws, { body: "Just a conversation.", resident: null });

    const response = await scopeResponse(created.id);
    const body = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("conflict");
    expect(body.message).toContain("no resident");
    expect(body.message).toContain("GET /api/agents");
  });

  /** …and again once its resident has been released: a lane can stop being one. */
  it("refuses a thread whose resident was released", async () => {
    const root = await lane();
    expect((await ws.del(`/api/threads/${root.id}/resident`)).status).toBe(200);

    expect((await scopeResponse(root.id)).status).toBe(409);
  });

  it("answers 404 for a thread this workspace does not hold", async () => {
    const response = await scopeResponse("th_nosuchthread");

    expect(response.status).toBe(404);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "not_found" });
  });

  /** A document id is not a thread id on this surface, and the contract's param says so. */
  it("answers 400 for a document id", async () => {
    expect((await scopeResponse("doc_a1b2c3")).status).toBe(400);
  });
});
