// The half of the attachment traversal guard that no in-process test can reach
// (SERVER-033).
//
// `serve.test.ts` says so in its own header: the raw forms are exercised against
// `parseAttachmentPath` and `isUnnormalizedAttachmentTarget` directly, because
// every `Request` — including the one `app.request` builds, and the one
// `fetch()` builds — goes through the WHATWG URL parser, which resolves `..`,
// `%2e%2e` and their spellings *before* any Corpus code runs. The guard that
// catches them reads the unnormalized target off `c.env.incoming.url`, an
// adapter binding, and its own docblock records that an adapter which does not
// supply it yields `undefined` — at which point the check silently stops
// running and the whole shipped suite stays green.
//
// So these cases send the request line verbatim. `node:http`'s `path` option is
// written into the request without a URL parse, which is what `curl
// --path-as-is` does on the command line and the only way to put an
// unnormalized target on the wire from Node.
//
// The probe is chosen so that its *refusal* is attributable to nothing else: a
// target that the URL parser normalizes back onto a real, existing attachment.
// With the raw-target check alive it is a 404; with the binding gone the parser
// hands the route a perfectly valid path and it answers 200 with the bytes.

import { request as httpRequest } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH,
  createThread,
  createThreadWorkspace,
  postForm,
  type WriteWorkspace,
} from "../threads/thread-fixture.js";
import { ATTACHMENT_NOT_FOUND_BODY } from "./serve.js";

interface RawResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * A GET whose request target is sent byte-for-byte, with no URL normalization.
 * `fetch` cannot express this: its `Request` constructor collapses dot segments
 * before a byte reaches the socket.
 */
async function rawGet(origin: string, target: string): Promise<RawResponse> {
  const { hostname, port } = new URL(origin);
  return new Promise<RawResponse>((resolve, reject) => {
    const req = httpRequest(
      { hostname, port, method: "GET", path: target, headers: AUTH },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

let ws: WriteWorkspace;

/** Throwaway listeners the adapter-fact case opens, closed however it ends. */
const probeServers: { close(callback: () => void): void }[] = [];

beforeEach(() => {
  ws = createThreadWorkspace("serve-real");
});

afterEach(async () => {
  await ws.server.close();
  ws.close();
  await Promise.all(
    probeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

/** A thread carrying one attachment, plus the URL that serves it. */
async function uploadOne(): Promise<{ url: string; directory: string; name: string }> {
  const created = await createThread(ws, { body: "first" });
  const name = "note.txt";
  const response = await postForm(ws, `/api/threads/${created.id}/turns`, [
    ["files", new File([Buffer.from("attachment-bytes-ok\n")], name, { type: "text/plain" })],
  ]);
  const payload = (await response.json()) as { turn: { ts: string } };
  if (response.status !== 201) throw new Error(`upload failed: ${JSON.stringify(payload)}`);

  const directory = `/attachments/${created.id}/${encodeURIComponent(payload.turn.ts)}`;
  return { url: `${directory}/${name}`, directory, name };
}

/**
 * The adapter fact the guard is built on, stated on its own so a regression
 * names itself: whatever else changes, `c.env.incoming.url` must still be the
 * request target as it was written into the request line. Every case below is
 * downstream of this one.
 */
describe("the adapter's raw request target", () => {
  it("reaches c.env.incoming.url unnormalized", async () => {
    const probe = new Hono();
    probe.all("*", (c) => {
      const env: unknown = c.env;
      const incoming = (env as { incoming?: { url?: unknown } }).incoming;
      return c.json({ raw: typeof incoming?.url === "string" ? incoming.url : null });
    });

    const origin = await new Promise<string>((resolve) => {
      const server = serve({ fetch: probe.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
        resolve(`http://127.0.0.1:${info.port}`);
      });
      probeServers.push(server);
    });

    const target = "/attachments/th_a/ts/nonexistent/%2e%2e/note.txt";
    const response = await rawGet(origin, target);

    expect(JSON.parse(response.body)).toEqual({ raw: target });
    // And the routed path is the normalized one, which is exactly why the guard
    // cannot be written against `c.req.path`.
    expect(new URL(`http://127.0.0.1${target}`).pathname).toBe("/attachments/th_a/ts/note.txt");
  });
});

describe("the attachment raw-target guard, over a real socket", () => {
  it("serves a legitimate attachment", async () => {
    const { url } = await uploadOne();
    const address = await ws.server.start();

    const response = await rawGet(address.url, url);

    expect(response.status).toBe(200);
    expect(response.body).toBe("attachment-bytes-ok\n");
  });

  it.each([
    ["an encoded dot segment", "%2e%2e"],
    ["a literal dot segment", ".."],
    ["a mixed dot segment", ".%2e"],
    ["an upper-case encoded dot segment", "%2E%2E"],
  ])(
    "refuses a target that %s normalizes back onto that same attachment",
    async (_label, segment) => {
      const { directory, name } = await uploadOne();
      const address = await ws.server.start();

      // What the URL parser makes of this is exactly `${directory}/${name}` —
      // the file that just answered 200 above. Only the unnormalized target
      // distinguishes the two, so a 200 here means the binding is gone.
      const target = `${directory}/nonexistent/${segment}/${name}`;
      expect(new URL(`http://127.0.0.1${target}`).pathname).toBe(`${directory}/${name}`);

      const response = await rawGet(address.url, target);

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual(ATTACHMENT_NOT_FOUND_BODY);
    },
  );

  it("refuses a raw traversal out of the attachments root", async () => {
    const { directory } = await uploadOne();
    const address = await ws.server.start();

    const response = await rawGet(address.url, `${directory}/../../../../../../etc/hosts`);

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual(ATTACHMENT_NOT_FOUND_BODY);
  });

  it("refuses a backslash target, which the parser would rewrite to a separator", async () => {
    const { directory, name } = await uploadOne();
    const address = await ws.server.start();

    const response = await rawGet(address.url, `${directory}\\..\\${name}`);

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual(ATTACHMENT_NOT_FOUND_BODY);
  });
});
