import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import {
  contractRoutes,
  isMultipartThreadCreate,
  mountAppendTurn,
  mountCreateThread,
} from "../routes/index.js";
import {
  buildCaptureFormData,
  buildThreadFormData,
  buildTurnFormData,
  FILES_FIELD,
  uploadCapture,
  uploadCreateThread,
  UploadError,
  uploadTurn,
} from "./upload.js";

const BASE_URL = "http://127.0.0.1:8965";
const TOKEN = "workspace-token";

const png = (name = "shot.png") => new File(["bytes"], name, { type: "image/png" });

const threadSummary = {
  id: "th_x9y8",
  title: "Re: 30-year fixed assumption",
  status: "open" as const,
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "engaged" as const,
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:09:00Z",
  turnCount: 2,
  lastAuthor: "user" as const,
  lastTs: "2026-07-19T10:09:00Z",
};

/**
 * A Hono app mounting the real multipart route definitions, so the helper's
 * `FormData` travels the same validation path the server will use. The handlers
 * echo the parsed parts back through fields the response schema already has —
 * the assertion is on what the contract's own validator saw, not on a double.
 */
function createServer() {
  const app = new OpenAPIHono();

  mountAppendTurn(app, (c) => {
    // The route declares two content types, so the validated body is their
    // union; `files` is required on the multipart half and absent from the JSON
    // half, which makes it the discriminator.
    const validated = c.req.valid("form");
    const parsed =
      "files" in validated
        ? { text: validated.text, requestsAgent: validated.requestsAgent, files: validated.files }
        : { text: validated.body, requestsAgent: validated.requestsAgent, files: [] as File[] };
    const files = parsed.files;
    return c.json(
      {
        thread: threadSummary,
        turn: {
          author: "user" as const,
          ts: "2026-07-19T10:09:00Z",
          body: [
            `text=${parsed.text ?? ""}`,
            `requestsAgent=${String(parsed.requestsAgent)}`,
            `files=${files.map((file) => file.name).join("|")}`,
            `auth=${c.req.header("authorization") ?? ""}`,
            `actor=${c.req.header(ACTOR_HEADER) ?? ""}`,
          ].join(" "),
          model: null,
        },
        eventId: parsed.requestsAgent === false ? null : "evt_7c1d",
        warnings: [],
      },
      201,
    );
  });

  mountCreateThread(app, (c) => {
    const validated = c.req.valid("form");
    const multipart = isMultipartThreadCreate(validated);
    const files = multipart ? validated.files : [];
    return c.json(
      {
        thread: {
          id: "th_x9y8",
          title: [
            `text=${(multipart ? validated.text : validated.body) ?? ""}`,
            `title=${validated.title ?? ""}`,
            `selector=${validated.selector?.exact ?? ""}`,
            `files=${files.map((file) => file.name).join("|")}`,
            `auth=${c.req.header("authorization") ?? ""}`,
            `actor=${c.req.header(ACTOR_HEADER) ?? ""}`,
          ].join(" "),
          created: "2026-07-19T10:05:00Z",
          updated: "2026-07-19T10:05:00Z",
          status: "open" as const,
          tags: [],
          parent: validated.parent ?? null,
          anchor: validated.selector ? "anc_k4f7" : null,
          agent: "none" as const,
          turns: [],
        },
        anchorId: validated.selector ? "anc_k4f7" : null,
        eventId: validated.requestsAgent === false ? null : "evt_7c1d",
        warnings: [],
      },
      201,
    );
  });

  app.openapi(contractRoutes.capture, (c) => {
    const body = c.req.valid("form");
    return c.json(
      {
        docId: "doc_a1b2c3",
        threadId: body.files.length > 0 ? "th_x9y8" : "th_q1w2",
        eventId: body.requestsAgent === false ? null : "evt_7c1d",
        warnings: [],
      },
      201,
    );
  });

  return app;
}

const transport = (): typeof globalThis.fetch => {
  const app = createServer();
  return async (input, init) => app.fetch(new Request(input, init));
};

const options = () => ({ baseUrl: BASE_URL, token: TOKEN, fetch: transport() });

/** Narrows a rejection to the helper's own error type without casting. */
async function rejection(promise: Promise<unknown>): Promise<UploadError> {
  const outcome = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(outcome instanceof UploadError)) {
    throw new Error(`Expected an UploadError, got ${String(outcome)}.`);
  }
  return outcome;
}

describe("buildTurnFormData", () => {
  it("names the parts the contract declares", () => {
    const form = buildTurnFormData({ text: "hi", requestsAgent: true, files: [png()] });
    expect([...form.keys()].sort()).toEqual(["files", "requestsAgent", "text"]);
    expect(form.get("text")).toBe("hi");
    expect(form.get("requestsAgent")).toBe("true");
    expect(FILES_FIELD).toBe("files");
  });

  it("repeats the files part once per attachment", () => {
    const form = buildTurnFormData({ files: [png("a.png"), png("b.png")] });
    expect(form.getAll("files")).toHaveLength(2);
  });

  it("omits the enqueue signal entirely when it is unset, preserving the tri-state", () => {
    expect(buildTurnFormData({ text: "hi" }).has("requestsAgent")).toBe(false);
  });

  it('sends an explicit false, which is the "note only" instruction', () => {
    expect(buildTurnFormData({ text: "hi", requestsAgent: false }).get("requestsAgent")).toBe(
      "false",
    );
  });

  it("omits the text part on an attachment-only turn", () => {
    expect(buildTurnFormData({ files: [png()] }).has("text")).toBe(false);
  });
});

describe("buildThreadFormData", () => {
  it("names the parts the multipart thread body declares", () => {
    const form = buildThreadFormData({ text: "why 6.1%?", title: "Rates", files: [png()] });
    expect([...form.keys()].sort()).toEqual([FILES_FIELD, "text", "title"]);
    expect(form.get("text")).toBe("why 6.1%?");
  });

  /** One JSON-encoded part, because every multipart part is text. */
  it("encodes the selector into a single part", () => {
    const selector = { exact: "a 30-year fixed at 6.1%", prefix: "the model we " };
    const form = buildThreadFormData({ text: "why?", selector, parent: "doc_a1b2c3" });
    // A `FormData` entry is a string or a `File`; this part must be the former,
    // and it must round-trip back to the very object the caller handed in.
    const encoded = form.get("selector");
    expect(encoded).toBe(JSON.stringify(selector));
    expect(form.get("parent")).toBe("doc_a1b2c3");
    expect(JSON.parse(typeof encoded === "string" ? encoded : "")).toEqual(selector);
  });

  it("omits every part the caller left unset, preserving the tri-state signal", () => {
    const form = buildThreadFormData({ files: [png()] });
    expect([...form.keys()]).toEqual([FILES_FIELD]);
  });

  it("repeats the files part once per attachment", () => {
    const form = buildThreadFormData({ text: "hi", files: [png("a.png"), png("b.png")] });
    expect(form.getAll(FILES_FIELD)).toHaveLength(2);
  });
});

describe("uploadCreateThread against a mounted contract route", () => {
  it("delivers the parts, the bearer token and the actor header", async () => {
    const created = await uploadCreateThread({
      ...options(),
      actor: "agent",
      text: "why 6.1%?",
      title: "Rates",
      files: [png()],
    });

    expect(created.thread.title).toBe(
      `text=why 6.1%? title=Rates selector= files=shot.png auth=Bearer ${TOKEN} actor=agent`,
    );
    expect(created.eventId).toBe("evt_7c1d");
  });

  it("round-trips a selector through the encoded part, and anchors the thread", async () => {
    const created = await uploadCreateThread({
      ...options(),
      text: "why?",
      parent: "doc_a1b2c3",
      selector: { exact: "a 30-year fixed at 6.1%" },
    });

    expect(created.thread.title).toContain("selector=a 30-year fixed at 6.1%");
    expect(created.thread.parent).toBe("doc_a1b2c3");
    expect(created.anchorId).toBe("anc_k4f7");
  });

  it("posts an attachment-only first turn", async () => {
    const created = await uploadCreateThread({ ...options(), files: [png()] });
    expect(created.thread.title).toContain("files=shot.png");
    expect(created.thread.title).toContain("text=");
  });

  it('carries an explicit false through to a null event id ("note only")', async () => {
    const created = await uploadCreateThread({
      ...options(),
      text: "just filing this",
      requestsAgent: false,
    });
    expect(created.eventId).toBeNull();
  });

  /** A thread with an empty first turn is nothing at all; the helper says so before the round trip. */
  it("refuses an empty first turn without touching the network", async () => {
    const error = await rejection(
      uploadCreateThread({
        ...options(),
        fetch: () => {
          throw new Error("the network should not have been touched");
        },
      }),
    );
    expect(error.status).toBe(400);
    expect(error.message).toContain("at least one file");
  });
});

describe("buildCaptureFormData", () => {
  it("always carries the text, which capture requires", () => {
    const form = buildCaptureFormData({ text: "a thought" });
    expect(form.get("text")).toBe("a thought");
    expect(form.has("requestsAgent")).toBe(false);
  });

  it("carries attachments and an explicit signal", () => {
    const form = buildCaptureFormData({ text: "look", requestsAgent: false, files: [png()] });
    expect(form.getAll("files")).toHaveLength(1);
    expect(form.get("requestsAgent")).toBe("false");
  });
});

describe("uploadTurn against a mounted contract route", () => {
  it("delivers the parts, the bearer token and the actor header", async () => {
    const response = await uploadTurn({
      ...options(),
      actor: "agent",
      threadId: "th_x9y8",
      text: "look at this",
      files: [png("a.png"), png("b.png")],
    });
    expect(response.turn.body).toBe(
      `text=look at this requestsAgent=undefined files=a.png|b.png ` +
        `auth=Bearer ${TOKEN} actor=agent`,
    );
  });

  it("posts an attachment-only turn", async () => {
    const response = await uploadTurn({
      ...options(),
      threadId: "th_x9y8",
      files: [png("only.png")],
    });
    expect(response.turn.body).toContain("files=only.png");
    expect(response.turn.body).toContain("text=");
  });

  it("carries an explicit false through to a null event id", async () => {
    const response = await uploadTurn({
      ...options(),
      threadId: "th_x9y8",
      text: "note only",
      requestsAgent: false,
    });
    expect(response.eventId).toBeNull();
  });

  it("sends no actor header when none is configured, so the server's default applies", async () => {
    const response = await uploadTurn({ ...options(), threadId: "th_x9y8", text: "hi" });
    expect(response.turn.body).toContain("actor=");
    expect(response.turn.body).not.toContain("actor=agent");
  });

  it("refuses an empty turn at the call site rather than on the wire", async () => {
    await expect(uploadTurn({ ...options(), threadId: "th_x9y8" })).rejects.toBeInstanceOf(
      UploadError,
    );
  });

  it("percent-encodes the thread id into the path", async () => {
    const seen: string[] = [];
    await expect(
      uploadTurn({
        baseUrl: BASE_URL,
        token: TOKEN,
        threadId: "th x/9",
        text: "hi",
        fetch: (input) => {
          // `input` is the helper's `URL`; `Request` normalises every accepted
          // form to a string without relying on default stringification.
          seen.push(new Request(input).url);
          return Promise.resolve(new Response("{}", { status: 500 }));
        },
      }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(seen[0]).toContain("/api/threads/th%20x%2F9/turns");
  });
});

describe("uploadCapture against a mounted contract route", () => {
  it("captures text alone", async () => {
    const result = await uploadCapture({ ...options(), text: "buy a house?" });
    expect(result).toEqual({
      docId: "doc_a1b2c3",
      threadId: "th_q1w2",
      eventId: "evt_7c1d",
      warnings: [],
    });
  });

  it("captures a screenshot plus one line", async () => {
    const result = await uploadCapture({ ...options(), text: "this rate", files: [png()] });
    expect(result.threadId).toBe("th_x9y8");
  });

  it("suppresses the enqueue on an explicit note-only capture", async () => {
    const result = await uploadCapture({ ...options(), text: "x", requestsAgent: false });
    expect(result.eventId).toBeNull();
  });

  it("surfaces a rejected capture as a typed UploadError", async () => {
    const failure = await rejection(uploadCapture({ ...options(), text: "" }));
    expect(failure.status).toBe(400);
  });
});

describe("UploadError", () => {
  it("carries the parsed problem body when the server sent one", async () => {
    const failure = await rejection(
      uploadCapture({
        baseUrl: BASE_URL,
        token: TOKEN,
        text: "x",
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify({ code: "not_found", message: "No such workspace." }), {
              status: 404,
              headers: { "content-type": "application/json" },
            }),
          ),
      }),
    );
    expect(failure.status).toBe(404);
    expect(failure.message).toBe("No such workspace.");
    expect(failure.apiError?.code).toBe("not_found");
    expect(failure.name).toBe("UploadError");
  });

  it("falls back to a status message when the body is not a problem shape", async () => {
    const failure = await rejection(
      uploadCapture({
        baseUrl: BASE_URL,
        token: TOKEN,
        text: "x",
        fetch: () => Promise.resolve(new Response("<html>gateway</html>", { status: 502 })),
      }),
    );
    expect(failure.status).toBe(502);
    expect(failure.message).toContain("502");
    expect(failure.apiError).toBeUndefined();
  });

  /** A 200 whose body is not the declared shape is a contract violation, not a value to pass on. */
  it("rejects a success body that does not match the declared response", async () => {
    await expect(
      uploadCapture({
        baseUrl: BASE_URL,
        token: TOKEN,
        text: "x",
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify({ docId: "nope" }), {
              status: 201,
              headers: { "content-type": "application/json" },
            }),
          ),
      }),
    ).rejects.toThrow();
  });
});
