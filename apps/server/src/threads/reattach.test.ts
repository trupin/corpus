// `POST /api/threads/{id}/reattach` (SPEC.md §6, §4; SERVER-072).
//
// Everything below runs against the real app, a real workspace and a real git
// repository, and every assertion reads one of the three surfaces the repair is
// supposed to move: the parent's bytes on disk, what `GET /api/docs/{id}`
// resolves out of them, and `git log`. A repair that only showed up in the
// response envelope would be indistinguishable from one that was never written.
//
// The fixture is SERVER-059's, and it is four parallel list items rather than
// two on purpose: every line differs from its siblings by one character, so any
// measure that ranked similarity would rank them within noise of each other.
// That is what makes "the person's range, and nothing re-derived from it" a
// claim the tests can actually check.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { CONTEXT_WINDOW } from "../anchors/index.js";
import {
  createDoc,
  createThread,
  createThreadWorkspace,
  frontmatterOf,
  threadPath,
  type WriteWorkspace,
} from "./thread-fixture.js";

const PARENT_BODY = [
  "## Actions",
  "",
  "- Review the Q1 report by Friday",
  "- Review the Q2 report by Friday",
  "- Review the Q3 report by Friday",
  "- Review the Q4 report by Friday",
  "",
].join("\n");

/** A quote no version of the parent has ever held — an anchor orphaned at birth. */
const NEVER_MATCHED = "Review the Q7 report by Friday";

type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

interface Selector {
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
}

interface WireAnchor {
  readonly anchorId: string;
  readonly selector: Selector;
  readonly threadId: string;
  readonly range: { start: number; end: number } | null;
  readonly orphaned: boolean;
}

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("reattach");
});

afterEach(() => {
  ws.close();
});

const seedParent = async (): Promise<{ id: string; path: string }> =>
  createDoc(ws, { type: "note", title: "Actions", body: PARENT_BODY });

/** The parent's body **as the server serves it** — the coordinate space a range lives in. */
async function docBody(id: string): Promise<string> {
  const response = await ws.request(`/api/docs/${id}`);
  return ((await response.json()) as { body: string }).body;
}

async function anchorsOf(id: string): Promise<WireAnchor[]> {
  const response = await ws.request(`/api/docs/${id}`);
  return ((await response.json()) as { anchors: WireAnchor[] }).anchors;
}

/** The one anchor a single-thread fixture has, read back off the document. */
const soleAnchor = async (id: string): Promise<WireAnchor> => {
  const anchors = await anchorsOf(id);
  const anchor = anchors[0];
  if (anchor === undefined || anchors.length !== 1) {
    throw new Error(`expected exactly one anchor on ${id}, got ${anchors.length}`);
  }
  return anchor;
};

/** The selector the parent's frontmatter actually stores for `anchorId`. */
const storedSelector = (path: string, anchorId: string): Selector =>
  ((frontmatterOf(ws, path)["anchors"] ?? {}) as Record<string, Selector>)[anchorId] as Selector;

const quarterChoice = (
  body: string,
  quarter: Quarter,
): { range: { start: number; end: number }; expectedText: string } => {
  const expectedText = `Review the ${quarter} report by Friday`;
  const start = body.indexOf(expectedText);
  if (start === -1) throw new Error(`${quarter} is not in the body`);
  return { range: { start, end: start + expectedText.length }, expectedText };
};

const reattach = (id: string, body: unknown, actor?: "user" | "agent"): Promise<Response> =>
  ws.post(
    `/api/threads/${id}/reattach`,
    body,
    actor === undefined ? {} : { "x-corpus-author": actor },
  );

interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly reason?: string;
}

const refusalOf = async (response: Response): Promise<Refusal> =>
  (await response.json()) as Refusal;

/** A parent plus a thread whose selector never byte-matched — UI-068's shape. */
async function seedOrphan(): Promise<{
  parent: { id: string; path: string };
  threadId: string;
  anchorId: string;
}> {
  const parent = await seedParent();
  const created = await createThread(ws, {
    parent: parent.id,
    selector: { exact: NEVER_MATCHED },
    body: "wrong quarter — this is about Q2",
  });
  const anchorId = created.anchorId;
  if (anchorId === null) throw new Error("the fixture thread was created unanchored");
  return { parent, threadId: created.id, anchorId };
}

describe("POST /api/threads/{id}/reattach — a person's repair", () => {
  it("starts from an anchor the reader honestly reports as orphaned", async () => {
    const { parent } = await seedOrphan();
    const anchor = await soleAnchor(parent.id);

    expect(anchor.orphaned).toBe(true);
    expect(anchor.range).toBeNull();
  });

  it("attaches the thread to exactly the range the person chose", async () => {
    const { parent, threadId, anchorId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");

    const response = await reattach(threadId, chosen);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as { anchor: WireAnchor };
    expect(payload.anchor).toMatchObject({
      anchorId,
      threadId,
      range: chosen.range,
      orphaned: false,
    });
    expect(payload.anchor.selector.exact).toBe(chosen.expectedText);
  });

  it("persists the selector in the parent's frontmatter, read off its own bytes", async () => {
    const { parent, threadId, anchorId } = await seedOrphan();
    const body = await docBody(parent.id);
    const chosen = quarterChoice(body, "Q3");

    expect((await reattach(threadId, chosen)).status).toBe(200);

    const stored = storedSelector(parent.path, anchorId);
    expect(stored.exact).toBe(chosen.expectedText);
    // The surroundings are the *siblings*, which is what a candidate index or a
    // similarity score could never have produced from this document.
    expect(stored.prefix).toContain("Q2 report");
    expect(stored.suffix).toContain("Q4 report");
    expect(stored.prefix.length).toBe(CONTEXT_WINDOW);
    expect(stored.suffix.length).toBe(CONTEXT_WINDOW);
  });

  it("resolves on the next read with no fuzzy rung — rung 1 lands on the chosen range", async () => {
    const { parent, threadId } = await seedOrphan();
    const body = await docBody(parent.id);
    const chosen = quarterChoice(body, "Q2");

    expect((await reattach(threadId, chosen)).status).toBe(200);

    const anchor = await soleAnchor(parent.id);
    expect(anchor.orphaned).toBe(false);
    expect(anchor.range).toEqual(chosen.range);

    // Rung 1 is a plain `indexOf` of `prefix + exact + suffix`: the framed quote
    // occurs once, and where it occurs is where the person pointed. Rung 2 could
    // not have carried this anchor at all — `exact` alone appears… once here,
    // but the framing is what makes the read independent of that.
    const framed = `${anchor.selector.prefix}${anchor.selector.exact}${anchor.selector.suffix}`;
    expect(body.indexOf(framed) + anchor.selector.prefix.length).toBe(chosen.range.start);
    expect(body.split(framed)).toHaveLength(2);
  });

  it.each(["Q1", "Q2", "Q3"] as const)(
    "separates sibling %s from its lookalikes",
    async (quarter) => {
      const { parent, threadId } = await seedOrphan();
      const chosen = quarterChoice(await docBody(parent.id), quarter);

      expect((await reattach(threadId, chosen)).status).toBe(200);

      const anchor = await soleAnchor(parent.id);
      expect(anchor.selector.exact).toBe(`Review the ${quarter} report by Friday`);
      expect(anchor.range).toEqual(chosen.range);
    },
  );

  it("re-attaches a thread that already resolves, which moves it", async () => {
    const parent = await seedParent();
    const body = await docBody(parent.id);
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "Review the Q1 report by Friday" },
      body: "this belongs on Q3",
    });

    const chosen = quarterChoice(body, "Q3");
    expect((await reattach(created.id, chosen)).status).toBe(200);

    const anchor = await soleAnchor(parent.id);
    expect(anchor.selector.exact).toBe(chosen.expectedText);
    expect(anchor.range).toEqual(chosen.range);
  });

  it("does not treat the thread's own current text as an overlap with itself", async () => {
    const parent = await seedParent();
    const body = await docBody(parent.id);
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "Review the Q1 report by Friday" },
      body: "?",
    });

    const chosen = quarterChoice(body, "Q1");
    expect((await reattach(created.id, chosen)).status).toBe(200);
    expect((await soleAnchor(parent.id)).range).toEqual(chosen.range);
  });

  it("widens a range that splits a character rather than storing half of one", async () => {
    const parent = await createDoc(ws, {
      type: "note",
      title: "Emoji",
      body: "before the rocket 🚀 and after\n",
    });
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: NEVER_MATCHED },
      body: "?",
    });
    const body = await docBody(parent.id);
    const rocket = body.indexOf("🚀");
    // End between the two halves of the surrogate pair: a slice the caller can
    // describe honestly, and a selector nothing could ever resolve.
    const split = {
      range: { start: rocket, end: rocket + 1 },
      expectedText: body.slice(rocket, rocket + 1),
    };

    const response = await reattach(created.id, split);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as { anchor: WireAnchor };
    expect(payload.anchor.range).toEqual({ start: rocket, end: rocket + 2 });
    expect(payload.anchor.selector.exact).toBe("🚀");
    expect((await soleAnchor(parent.id)).orphaned).toBe(false);
  });
});

describe("POST /api/threads/{id}/reattach — refusals the document's state makes", () => {
  it("refuses a range whose bytes are not what the caller saw, writing nothing", async () => {
    const { parent, threadId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");
    const before = ws.read(parent.path);

    const response = await reattach(threadId, {
      ...chosen,
      expectedText: "Review the Q9 report by Friday",
    });

    expect(response.status).toBe(409);
    expect((await refusalOf(response)).reason).toBe("range-changed");
    expect(ws.read(parent.path)).toBe(before);
  });

  it("refuses a range running past the end of the body as the same fact", async () => {
    const { parent, threadId } = await seedOrphan();
    const beyond = (await docBody(parent.id)).length + 40;

    const response = await reattach(threadId, {
      range: { start: beyond, end: beyond + 5 },
      expectedText: "abcde",
    });

    expect(response.status).toBe(409);
    expect((await refusalOf(response)).reason).toBe("range-changed");
  });

  /**
   * The window between seeing a range and choosing it is real: the document is
   * live and the agent may save it in between. The guard is what makes a raw
   * offset pair safe to act on.
   */
  it("refuses a range the parent moved under, rather than approximating it", async () => {
    const { parent, threadId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");

    const edited = await ws.put(`/api/docs/${parent.id}`, {
      body: `## Actions\n\n- Review the Q0 report by Friday\n${PARENT_BODY.slice("## Actions\n\n".length)}`,
    });
    expect(edited.status).toBe(200);
    const afterSave = ws.read(parent.path);

    const response = await reattach(threadId, chosen);
    expect(response.status).toBe(409);
    expect((await refusalOf(response)).reason).toBe("range-changed");
    // The stale offsets now designate the *Q1* line. Approximating would have
    // silently attached somebody's Q2 comment to it; the parent is untouched.
    expect(ws.read(parent.path)).toBe(afterSave);
  });

  it("refuses a range overlapping another thread's text (SPEC.md §6)", async () => {
    const { parent, threadId } = await seedOrphan();
    const body = await docBody(parent.id);
    await createThread(ws, {
      parent: parent.id,
      selector: { exact: "Review the Q4 report by Friday" },
      body: "already anchored here",
    });

    const response = await reattach(threadId, quarterChoice(body, "Q4"));

    expect(response.status).toBe(409);
    const refusal = await refusalOf(response);
    expect(refusal.reason).toBe("range-overlaps");
    expect(refusal.code).toBe("conflict");
  });

  it("refuses a range that only partly overlaps another thread's text", async () => {
    const { parent, threadId } = await seedOrphan();
    const body = await docBody(parent.id);
    await createThread(ws, {
      parent: parent.id,
      selector: { exact: "Review the Q4 report by Friday" },
      body: "already anchored here",
    });

    const occupied = quarterChoice(body, "Q4").range;
    const straddle = { start: occupied.start - 4, end: occupied.start + 6 };
    const response = await reattach(threadId, {
      range: straddle,
      expectedText: body.slice(straddle.start, straddle.end),
    });

    expect(response.status).toBe(409);
    expect((await refusalOf(response)).reason).toBe("range-overlaps");
  });

  it("allows a range abutting another thread's text, since half-open ranges do not overlap", async () => {
    const { parent, threadId } = await seedOrphan();
    const body = await docBody(parent.id);
    await createThread(ws, {
      parent: parent.id,
      selector: { exact: "Review the Q4 report by Friday" },
      body: "already anchored here",
    });

    const occupied = quarterChoice(body, "Q4").range;
    const abutting = { start: occupied.start - 2, end: occupied.start };
    const response = await reattach(threadId, {
      range: abutting,
      expectedText: body.slice(abutting.start, abutting.end),
    });

    expect(response.status).toBe(200);
  });

  it("refuses a whole-document thread — it has no anchor to repair", async () => {
    const parent = await seedParent();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");
    const created = await createThread(ws, { parent: parent.id, body: "general note" });

    const response = await reattach(created.id, chosen);
    expect(response.status).toBe(409);
    expect((await refusalOf(response)).reason).toBe("not-anchored");
  });

  it("refuses a standalone thread the same way", async () => {
    const parent = await seedParent();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");
    const created = await createThread(ws, { body: "an Ask with no parent" });

    const response = await reattach(created.id, chosen);
    expect(response.status).toBe(409);
    expect((await refusalOf(response)).reason).toBe("not-anchored");
  });

  it("is a 404 for a thread that does not exist", async () => {
    const response = await reattach("th_aaaaaaaa", {
      range: { start: 0, end: 3 },
      expectedText: "abc",
    });
    expect(response.status).toBe(404);
  });

  it("refuses the repair while the other party holds the parent's edit lock", async () => {
    const { parent, threadId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");
    expect(
      (await ws.post(`/api/locks/${parent.id}`, {}, { "x-corpus-author": "agent" })).status,
    ).toBe(201);

    const response = await reattach(threadId, chosen);
    expect(response.status).toBe(423);
    expect((await soleAnchor(parent.id)).orphaned).toBe(true);
  });
});

describe("POST /api/threads/{id}/reattach — who may ask", () => {
  it("refuses the agent with 403 and writes nothing", async () => {
    const { parent, threadId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");
    const before = ws.read(parent.path);

    const response = await reattach(threadId, chosen, "agent");
    expect(response.status).toBe(403);
    expect((await refusalOf(response)).code).toBe("forbidden");
    expect(ws.read(parent.path)).toBe(before);
  });

  it("accepts the person, whether they say so or not", async () => {
    const first = await seedOrphan();
    expect(
      (await reattach(first.threadId, quarterChoice(await docBody(first.parent.id), "Q2"), "user"))
        .status,
    ).toBe(200);

    const second = await seedOrphan();
    expect(
      (await reattach(second.threadId, quarterChoice(await docBody(second.parent.id), "Q2")))
        .status,
    ).toBe(200);
  });
});

describe("POST /api/threads/{id}/reattach — what the repair records", () => {
  const filesInHead = (): string[] =>
    ws
      .git("show", "--name-only", "--format=", "HEAD")
      .split("\n")
      .filter((line) => line !== "")
      .sort();

  it("lands as one commit, authored by the person, staging only the parent", async () => {
    const { parent, threadId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");
    const before = ws.log("%H").length;

    expect((await reattach(threadId, chosen)).status).toBe(200);

    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([parent.path]);
    expect(ws.git("log", "-1", "--format=%an").trim()).toBe("user");
    expect(ws.git("log", "-1", "--format=%s").trim()).toBe(
      `comment: re-attach ${threadId} on ${parent.id} by user`,
    );
  });

  /**
   * §4 folds a person's repeated saves of one document into one commit. A repair
   * opts out: it is not a continuation of the edit that made it necessary, and
   * the record of *where a thread was pointed, and when* is the only audit trail
   * a write with no diff behind it leaves.
   */
  it("does not fold a second repair into the first one's commit", async () => {
    const { parent, threadId } = await seedOrphan();
    const body = await docBody(parent.id);
    const before = ws.log("%H").length;

    expect((await reattach(threadId, quarterChoice(body, "Q2"))).status).toBe(200);
    expect((await reattach(threadId, quarterChoice(body, "Q3"))).status).toBe(200);

    expect(ws.log("%H")).toHaveLength(before + 2);
  });

  it("changes nothing else about the thread", async () => {
    const { parent, threadId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");
    const threadBefore = ws.read(threadPath(threadId));
    const summaryBefore = await (await ws.request(`/api/threads/${threadId}`)).json();

    ws.advance(60_000);
    expect((await reattach(threadId, chosen)).status).toBe(200);

    expect(ws.read(threadPath(threadId))).toBe(threadBefore);
    expect(await (await ws.request(`/api/threads/${threadId}`)).json()).toEqual(summaryBefore);
  });

  it("leaves the parent's own frontmatter alone apart from the anchor entry", async () => {
    const { parent, threadId, anchorId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");
    const before = frontmatterOf(ws, parent.path);

    ws.advance(60_000);
    expect((await reattach(threadId, chosen)).status).toBe(200);

    const after = frontmatterOf(ws, parent.path);
    expect(after["updated"]).toEqual(before["updated"]);
    expect({ ...after, anchors: undefined }).toEqual({ ...before, anchors: undefined });
    expect(Object.keys(after["anchors"] as Record<string, unknown>)).toEqual([anchorId]);
  });
});

describe("POST /api/threads/{id}/reattach — what the board is told", () => {
  it("announces both documents, and never the folder tree", async () => {
    const { parent, threadId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");

    const frames: QueryKey[][] = [];
    const off = ws.server.bus.subscribe((keys) => frames.push(keys as QueryKey[]));
    try {
      expect((await reattach(threadId, chosen)).status).toBe(200);
    } finally {
      off();
    }

    const announced = frames.flat().map((key) => JSON.stringify(key));
    expect(announced).toContain(JSON.stringify(["docs"]));
    expect(announced).toContain(JSON.stringify(["docs", parent.id]));
    expect(announced).toContain(JSON.stringify(["docs", threadId]));
    expect(announced).not.toContain(JSON.stringify(["tree"]));
  });

  it("says nothing at all when the repair was refused", async () => {
    const { parent, threadId } = await seedOrphan();
    const chosen = quarterChoice(await docBody(parent.id), "Q2");

    const frames: QueryKey[][] = [];
    const off = ws.server.bus.subscribe((keys) => frames.push(keys as QueryKey[]));
    try {
      expect((await reattach(threadId, { ...chosen, expectedText: "x".repeat(30) })).status).toBe(
        409,
      );
    } finally {
      off();
    }

    expect(frames).toEqual([]);
  });
});
