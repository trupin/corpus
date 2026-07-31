// The half of the loopback guard that `app.request` cannot test: whether the
// adapter actually puts a socket on `c.env.incoming` (SERVER-033).
//
// `getPeerAddress` reads an `@hono/node-server` binding. Nothing in the type
// system ties that shape to the adapter's, so an adapter that renames or
// restructures the binding makes the read return `undefined` — and `undefined`
// is not loopback, so *every* call to `POST /api/jobs/{id}/log` starts answering
// 403. `localhost.test.ts` would stay green through that entire failure: it
// supplies the bindings itself, as `app.request`'s third argument, and so
// asserts what the guard does with a shape rather than that the shape arrives.
//
// These cases therefore go over a real socket, with the shipped `serve()`
// binding it, and assert the guard *admits* a genuine loopback peer. Fail-closed
// is the right default and also the failure mode's disguise: a dead binding and
// a working guard look identical from the refusal side.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import {
  createThread,
  createThreadWorkspace,
  type WriteWorkspace,
} from "../threads/thread-fixture.js";
import { getPeerAddress, isLoopbackAddress, localhostOnly } from "./localhost.js";

/** Listeners this file opened, closed even when an expectation throws. */
const openServers: { close(callback: () => void): void }[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

/** Binds `app` on an ephemeral loopback port and answers with its origin. */
async function listen(app: Hono): Promise<string> {
  return new Promise<string>((resolve) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve(`http://127.0.0.1:${info.port}`);
    });
    openServers.push(server);
  });
}

describe("the adapter's peer-address binding, over a real socket", () => {
  it("supplies a loopback remoteAddress that getPeerAddress can read", async () => {
    const app = new Hono();
    app.all("*", (c) => c.json({ peer: getPeerAddress(c.env) ?? null }));

    const origin = await listen(app);
    const body = (await (await fetch(`${origin}/whatever`)).json()) as { peer: string | null };

    // The exact spelling depends on the stack (`127.0.0.1` or `::ffff:127.0.0.1`),
    // so the assertion is on what the guard concludes, not on the string.
    expect(typeof body.peer).toBe("string");
    expect(isLoopbackAddress(body.peer ?? undefined)).toBe(true);
  });

  it("admits a loopback caller through the shipped localhostOnly guard", async () => {
    const app = new Hono();
    app.use("*", localhostOnly);
    app.all("*", (c) => c.json({ reached: true }));

    const origin = await listen(app);
    const response = await fetch(`${origin}/api/jobs/evt_probe/log`, { method: "POST" });

    // A 403 here means the binding vanished, not that the guard tightened.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reached: true });
  });
});

describe("POST /api/jobs/{id}/log over a real socket", () => {
  let ws: WriteWorkspace;

  afterEach(() => {
    ws.close();
  });

  it("accepts a tokenless append from 127.0.0.1", async () => {
    ws = createThreadWorkspace("loopback-real");
    const created = await createThread(ws, { body: "needs the agent", requestsAgent: true });
    const eventId = created.eventId;
    expect(eventId).not.toBeNull();

    const address = await ws.server.start();
    try {
      const response = await fetch(`${address.url}/api/jobs/${String(eventId)}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line: "hook line from a real socket" }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ eventId, appended: true });
    } finally {
      await ws.server.close();
    }
  });

  it("still refuses a request carrying a browser Origin", async () => {
    ws = createThreadWorkspace("loopback-origin");
    const created = await createThread(ws, { body: "needs the agent", requestsAgent: true });

    const address = await ws.server.start();
    try {
      const response = await fetch(`${address.url}/api/jobs/${String(created.eventId)}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ line: "from a page" }),
      });

      expect(response.status).toBe(403);
    } finally {
      await ws.server.close();
    }
  });
});
