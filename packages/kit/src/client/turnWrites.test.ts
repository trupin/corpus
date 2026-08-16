import { describe, expect, it } from "vitest";
import { createCorpusClient, CorpusRequestError } from "./createCorpusClient.js";

/**
 * The turn-write half of the client: the two routes whose path carries a
 * timestamp, the multipart append, and the token-guarded attachment fetch.
 */

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly contentType: string | null;
  readonly body: string | FormData | undefined;
}

function wire(response: { status: number; payload: unknown; contentType?: string }) {
  const calls: Recorded[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const clone = request.clone();
    const contentType = request.headers.get("content-type");
    calls.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.get("authorization"),
      contentType,
      body:
        contentType?.startsWith("multipart/form-data") === true
          ? await clone.formData()
          : await clone.text(),
    });
    if (response.contentType === "image/png") {
      return new Response("PNGBYTES", {
        status: response.status,
        headers: { "content-type": "image/png" },
      });
    }
    return new Response(JSON.stringify(response.payload), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createCorpusClient({ baseUrl: "http://127.0.0.1:9099", token: "tok", fetch });
  return { client, calls };
}

const TS = "2026-07-19T10:05:00.000Z";
const ENCODED = encodeURIComponent(TS);

describe("deleteTurn", () => {
  it("URL-encodes the timestamp, which is the turn's identity", async () => {
    const { client, calls } = wire({
      status: 200,
      payload: {
        deletedTurn: true,
        deletedThread: false,
        removedAnchor: null,
        parentId: "doc_m",
        warnings: [],
      },
    });
    const result = await client.deleteTurn("th_a", TS);
    expect(result.parentId).toBe("doc_m");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(`http://127.0.0.1:9099/api/threads/th_a/turns/${ENCODED}`);
    // The raw colon would split the path into extra segments on some proxies.
    expect(calls[0]?.url).toContain("%3A");
  });
});

describe("respondToForm", () => {
  it("posts the dedicated form route with the answer only", async () => {
    const { client, calls } = wire({
      status: 201,
      payload: {
        thread: {
          id: "th_a",
          title: "t",
          status: "open",
          parent: null,
          anchor: null,
          agent: "engaged",
          resident: null,
          created: TS,
          updated: TS,
          turnCount: 3,
          lastAuthor: "user",
          lastTs: TS,
        },
        turn: { author: "user", ts: TS, body: "**Answered:** Lemonade", model: null },
        eventId: "evt_1",
        warnings: [],
      },
    });
    const result = await client.respondToForm("th_a", {
      ts: TS,
      answers: [
        { question: "Which quote?", option: "Lemonade" },
        { question: "Which riders?", options: ["Water backup"] },
        { question: "Anything else?", text: "the roof is new" },
      ],
      note: "cheap",
    });
    expect(result.eventId).toBe("evt_1");
    expect(calls[0]?.url).toBe(`http://127.0.0.1:9099/api/threads/th_a/turns/${ENCODED}/form`);
    expect(JSON.parse(calls[0]?.body as string)).toEqual({
      answers: [
        { question: "Which quote?", option: "Lemonade" },
        { question: "Which riders?", options: ["Water backup"] },
        { question: "Anything else?", text: "the roof is new" },
      ],
      note: "cheap",
    });
  });

  it("omits an absent note rather than sending undefined", async () => {
    const { client, calls } = wire({
      status: 400,
      payload: { code: "bad_request", message: "no", issues: [] },
    });
    await expect(
      client.respondToForm("th_a", { ts: TS, answers: [{ question: "q", option: "x" }] }),
    ).rejects.toBeInstanceOf(CorpusRequestError);
    expect(JSON.parse(calls[0]?.body as string)).toEqual({
      answers: [{ question: "q", option: "x" }],
    });
  });
});

describe("appendTurnWithFiles", () => {
  it("sends multipart with the prose under `text` and repeated `files` parts", async () => {
    const { client, calls } = wire({
      status: 201,
      payload: {
        thread: {
          id: "th_a",
          title: "t",
          status: "open",
          parent: null,
          anchor: null,
          agent: "none",
          resident: null,
          created: TS,
          updated: TS,
          turnCount: 1,
          lastAuthor: "user",
          lastTs: TS,
        },
        turn: { author: "user", ts: TS, body: "look", model: null },
        eventId: null,
        warnings: [],
      },
    });
    await client.appendTurnWithFiles("th_a", {
      text: "look",
      requestsAgent: false,
      files: [
        new File(["a"], "shot.png", { type: "image/png" }),
        new File(["b"], "notes.pdf", { type: "application/pdf" }),
      ],
    });
    const form = calls[0]?.body as FormData;
    expect(calls[0]?.contentType?.startsWith("multipart/form-data")).toBe(true);
    // `text`, not `body` — the multipart route names the prose field differently.
    expect(form.get("text")).toBe("look");
    expect(form.get("requestsAgent")).toBe("false");
    expect(form.getAll("files")).toHaveLength(2);
  });

  /** SPEC.md §6: a turn may be attachment-only, so `text` is simply absent. */
  it("omits `text` for an attachment-only turn", async () => {
    const { client, calls } = wire({
      status: 201,
      payload: {
        thread: {
          id: "th_a",
          title: "t",
          status: "open",
          parent: null,
          anchor: null,
          agent: "none",
          resident: null,
          created: TS,
          updated: TS,
          turnCount: 1,
          lastAuthor: "user",
          lastTs: TS,
        },
        turn: {
          author: "user",
          ts: TS,
          body: "![shot.png](attachments/th_a/x/shot.png)",
          model: null,
        },
        eventId: null,
        warnings: [],
      },
    });
    await client.appendTurnWithFiles("th_a", {
      files: [new File(["a"], "shot.png", { type: "image/png" })],
    });
    expect((calls[0]?.body as FormData).has("text")).toBe(false);
  });

  /**
   * A 413 must arrive as the kit's own error with its status intact — the
   * server sends the over-cap refusal as `413` carrying a `bad_request` body
   * (`apps/server/src/errors.ts`'s `payloadTooLarge`), so it is the **status**
   * that says "too large" and the message that says what was.
   */
  it("re-raises the upload's refusal as a CorpusRequestError", async () => {
    const { client } = wire({
      status: 413,
      payload: {
        code: "bad_request",
        message: "attachment big.bin is 30000000 bytes, over the per-file limit of 25 MB",
        issues: [{ path: "files", message: "over the per-file limit of 25 MB" }],
      },
    });
    const failure = await client
      .appendTurnWithFiles("th_a", { files: [new File(["x"], "big.bin")] })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CorpusRequestError);
    expect((failure as CorpusRequestError).status).toBe(413);
    expect((failure as CorpusRequestError).message).toContain("per-file limit");
    expect((failure as CorpusRequestError).issues[0]?.path).toBe("files");
  });
});

describe("fetchAttachment", () => {
  it("sends the workspace token, which an <img src> could not", async () => {
    const { client, calls } = wire({ status: 200, payload: null, contentType: "image/png" });
    const blob = await client.fetchAttachment("attachments/th_a/2026/shot.png");
    expect(blob.type).toBe("image/png");
    expect(calls[0]?.url).toBe("http://127.0.0.1:9099/attachments/th_a/2026/shot.png");
    expect(calls[0]?.authorization).toBe("Bearer tok");
  });

  it("normalises a leading slash rather than trusting the reference", async () => {
    const { client, calls } = wire({ status: 200, payload: null, contentType: "image/png" });
    await client.fetchAttachment("//evil.example/x");
    expect(calls[0]?.url).toBe("http://127.0.0.1:9099/evil.example/x");
  });

  it("raises the client's error on a miss", async () => {
    const { client } = wire({
      status: 404,
      payload: { code: "not_found", message: "no such attachment" },
    });
    await expect(client.fetchAttachment("attachments/a/b/c")).rejects.toBeInstanceOf(
      CorpusRequestError,
    );
  });
});
