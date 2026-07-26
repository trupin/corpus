import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../actor.js";
import { contractRoutes } from "../routes/index.js";
import {
  buildCaptureFormData,
  buildTurnFormData,
  FILES_FIELD,
  uploadCapture,
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

  app.openapi(contractRoutes.appendTurn, (c) => {
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
        },
        eventId: parsed.requestsAgent === false ? null : "evt_7c1d",
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
    expect(result).toEqual({ docId: "doc_a1b2c3", threadId: "th_q1w2", eventId: "evt_7c1d" });
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
