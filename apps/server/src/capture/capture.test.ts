import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAPTURE_TITLE_LENGTH, FILING_REQUEST, UNTITLED_CAPTURE, captureTitle } from "./capture.js";
import {
  createThreadWorkspace,
  frontmatterOf,
  pendingEvents,
  postForm,
  referencedAttachments,
  threadFrontmatterOf,
  turnsOf,
  withBrokenQueue,
  type WriteWorkspace,
} from "../threads/thread-fixture.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("capture");
});

afterEach(() => {
  ws.close();
});

interface Captured {
  readonly status: number;
  readonly docId: string;
  readonly threadId: string;
  readonly eventId: string | null;
}

async function capture(
  parts: readonly (readonly [string, string | Blob])[],
  actor?: "user" | "agent",
): Promise<Captured> {
  const response = await postForm(
    ws,
    "/api/capture",
    parts,
    actor === undefined ? {} : { "x-corpus-author": actor },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    docId: (payload["docId"] as string) ?? "",
    threadId: (payload["threadId"] as string) ?? "",
    eventId: (payload["eventId"] as string | null) ?? null,
  };
}

const inboxFiles = (): string[] =>
  readdirSync(join(ws.root, "data", "docs", "inbox"))
    .filter((name) => name.endsWith(".md"))
    .sort();

const docPathOf = (docId: string): string =>
  (ws.db.prepare("SELECT path FROM documents WHERE id = ?").get(docId) as { path: string }).path;

const filesInHead = (): string[] =>
  ws
    .git("show", "--name-only", "--format=", "HEAD")
    .split("\n")
    .filter((line) => line !== "")
    .sort();

describe("POST /api/capture", () => {
  it("creates the document, its filing thread and one event in one commit", async () => {
    const before = ws.log("%H").length;

    const result = await capture([["text", "call the bank about the rate lock"]]);

    expect(result.status).toBe(201);
    expect(result.docId).toMatch(/^doc_/);
    expect(result.threadId).toMatch(/^th_/);
    expect(result.eventId).toMatch(/^evt_/);

    const docPath = docPathOf(result.docId);
    expect(docPath).toBe("data/docs/inbox/call-the-bank-about-the-rate-lock.md");
    expect(frontmatterOf(ws, docPath)).toMatchObject({
      id: result.docId,
      type: "note",
      title: "call the bank about the rate lock",
      status: "open",
    });

    expect(threadFrontmatterOf(ws, result.threadId)).toMatchObject({
      parent: result.docId,
      anchor: null,
      agent: "requested",
      status: "open",
    });

    expect(pendingEvents(ws)).toHaveLength(1);
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([docPath, `data/threads/${result.threadId}.md`].sort());
  });

  it("asks the agent to file it in the thread's only turn", async () => {
    const result = await capture([["text", "call the bank"]]);
    const turns = turnsOf(ws, result.threadId);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.author).toBe("user");
    expect(turns[0]?.body).toContain("call the bank");
    expect(turns[0]?.body).toContain(FILING_REQUEST);
    // Filing is what the ask is *for*: the words the skill acts on are present.
    for (const word of ["title", "inbox", "expand", "tag"]) {
      expect(FILING_REQUEST).toContain(word);
    }
  });

  it("names the event `comment.created` from the capture surface", async () => {
    const result = await capture([["text", "call the bank"]]);
    const raw = JSON.parse(
      readFileSync(
        join(ws.root, ".corpus", "queue", "pending", pendingEvents(ws)[0] ?? ""),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(raw).toMatchObject({ id: result.eventId, type: "comment.created", source: "capture" });
    expect(raw["payload"]).toMatchObject({
      threadId: result.threadId,
      parentId: result.docId,
      mentions: [],
      skills: [],
    });
  });

  it("dedupes slugs rather than overwriting an earlier capture", async () => {
    const first = await capture([["text", "call the bank about the rate lock"]]);
    const firstText = ws.read(docPathOf(first.docId));

    const second = await capture([["text", "call the bank about the rate lock"]]);

    expect(second.docId).not.toBe(first.docId);
    expect(docPathOf(second.docId)).not.toBe(docPathOf(first.docId));
    expect(inboxFiles()).toHaveLength(2);
    expect(ws.read(docPathOf(first.docId))).toBe(firstText);
  });

  it('honours "note only" without skipping the document or the thread', async () => {
    const result = await capture([
      ["text", "a private note"],
      ["requestsAgent", "false"],
    ]);

    expect(result.status).toBe(201);
    expect(result.eventId).toBeNull();
    expect(pendingEvents(ws)).toEqual([]);
    expect(threadFrontmatterOf(ws, result.threadId)["agent"]).toBe("none");
    expect(ws.exists(docPathOf(result.docId))).toBe(true);
  });

  it("routes a capture whose text carries its own invocation", async () => {
    ws.write(
      ".claude/skills/comment/SKILL.md",
      "---\nname: comment\ndescription: handles comment.created\n---\nBody.\n",
    );
    ws.reproject();

    const result = await capture([["text", "/comment on this when you file it"]]);
    const raw = JSON.parse(
      readFileSync(
        join(ws.root, ".corpus", "queue", "pending", pendingEvents(ws)[0] ?? ""),
        "utf8",
      ),
    ) as { payload: { skills: { name: string }[] } };

    expect(result.eventId).toMatch(/^evt_/);
    expect(raw.payload.skills.map((skill) => skill.name)).toEqual(["comment"]);
  });

  // Replaces the SERVER-010 refusal: "screenshot + one line is a first-class
  // capture" (§6) now works, and nothing in the response still names the issue.
  it("files an attachment on the filing thread, leaving the document text alone", async () => {
    const response = await postForm(ws, "/api/capture", [
      ["text", "screenshot plus a line"],
      ["files", new File(["bytes"], "shot.png", { type: "image/png" })],
    ]);
    const payload = (await response.json()) as { docId: string; threadId: string };

    expect(response.status).toBe(201);
    expect(JSON.stringify(payload)).not.toContain("SERVER-010");

    const turn = turnsOf(ws, payload.threadId)[0];
    expect(turn?.body).toContain("![shot.png](attachments/");
    expect(ws.exists(`.corpus/attachments/${payload.threadId}/${turn?.ts ?? ""}/shot.png`)).toBe(
      true,
    );
    // The attachment belongs to the conversation, not to the document (§6).
    const docPath = inboxFiles()[0] ?? "";
    expect(ws.read(`data/docs/inbox/${docPath}`)).not.toContain("attachments/");
  });

  // SERVER-021. The cleanup that removes the bytes when the markdown cannot be
  // built used to wrap the commit and everything after it, so an enqueue failure
  // deleted the files the *committed* turn quotes.
  it("keeps the attachment when the failure lands after the commit (§6)", async () => {
    const before = ws.log("%H").length;

    const response = await withBrokenQueue(ws, () =>
      postForm(ws, "/api/capture", [
        ["text", "post-commit failure"],
        ["files", new File(["bytes"], "shot.png", { type: "image/png" })],
      ]),
    );

    expect(response.status).toBe(500);
    // The commit landed all the same — this is a failure *after* the write.
    expect(ws.log("%H")).toHaveLength(before + 1);
    const threadFile = filesInHead().find((path) => path.startsWith("data/threads/")) ?? "";
    expect(threadFile).not.toBe("");

    const referenced = referencedAttachments(ws.git("show", `HEAD:${threadFile}`));
    expect(referenced).toHaveLength(1);
    for (const path of referenced) expect(ws.exists(path)).toBe(true);
    // The event is the part that genuinely did not happen.
    expect(pendingEvents(ws)).toEqual([]);
  });

  it("refuses an empty capture, with or without a file", async () => {
    expect((await postForm(ws, "/api/capture", [["text", ""]])).status).toBe(400);
    // `CaptureRequestSchema.text` is `min(1)` and mandatory: an attachment-only
    // capture is impossible by contract, and SERVER-010 does not change that.
    expect(
      (await postForm(ws, "/api/capture", [["files", new File(["bytes"], "shot.png")]])).status,
    ).toBe(400);
  });

  /**
   * SERVER-075's third door. The captured text becomes the filing thread's first
   * turn as well as the document's body, so an open fence here swallows the
   * filing request itself and every reply after it — the refusal covers both
   * files because they carry the same words.
   */
  it("refuses a capture whose text leaves a code fence open, writing neither file", async () => {
    const before = ws.log("%H").length;
    const inbox = inboxFiles();

    const response = await postForm(ws, "/api/capture", [
      ["text", "Note this:\n\n```sh\nnpm run build\n"],
    ]);
    const payload = (await response.json()) as { message: string; issues: { path: string }[] };

    expect(response.status).toBe(400);
    expect(payload.message).toContain("line 3");
    expect(payload.issues[0]).toEqual({
      path: "text",
      message: "unterminated ``` code fence opened on line 3",
    });
    expect(ws.log("%H")).toHaveLength(before);
    expect(inboxFiles()).toEqual(inbox);
    expect(pendingEvents(ws)).toEqual([]);
  });

  it("still captures text that quotes a fence correctly", async () => {
    const result = await capture([["text", "Snippet:\n\n```sh\nnpm run build\n```\n"]]);
    expect(result.status).toBe(201);
    expect(turnsOf(ws, result.threadId)).toHaveLength(1);
  });

  it("records the agent as the author when it captures", async () => {
    const result = await capture([["text", "noticed while working"]], "agent");
    expect(turnsOf(ws, result.threadId)[0]?.author).toBe("agent");
    expect(ws.log("%an")[0]).toBe("agent");
  });
});

describe("captureTitle", () => {
  it("takes the first prose line", () => {
    expect(captureTitle("\n\n  call the bank  \nand the broker")).toBe("call the bank");
  });

  it("truncates at the documented length", () => {
    expect(captureTitle("q".repeat(200))).toBe("q".repeat(CAPTURE_TITLE_LENGTH));
  });

  it("falls back when there is no prose at all", () => {
    expect(captureTitle("```\n```")).toBe(UNTITLED_CAPTURE);
  });
});
