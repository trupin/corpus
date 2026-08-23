import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../testing/stub-server.js";
import { runReflect } from "./reflect.js";

afterEach(() => {
  vi.useRealTimers();
  return closeStubServers();
});

const ASKED = { eventId: "evt_a1b2", since: "2026-08-22T09:00:00Z", pending: false };

describe("corpus reflect — the ask", () => {
  it("posts the ask and prints the event and the window", async () => {
    const stub = await startStubServer(jsonResponder(202, ASKED));
    const harness = stubContext(stub, { actor: "user" });

    await runReflect(harness.context);

    const request = stub.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/workspace/reflect");
    expect(request?.headers["x-corpus-author"]).toBe("user");
    expect(harness.stdout()).toBe("reflecting — evt_a1b2, window since 2026-08-22T09:00:00Z\n");
  });

  it("says so and exits 0 when one was already pending — asking twice is not an error", async () => {
    const stub = await startStubServer(jsonResponder(202, { ...ASKED, pending: true }));
    const harness = stubContext(stub);

    // No throw: `runReflect` resolving *is* exit 0.
    await runReflect(harness.context);

    expect(harness.stdout()).toBe(
      "already reflecting — evt_a1b2, window since 2026-08-22T09:00:00Z\n",
    );
  });

  it("names the whole corpus when nothing has ever been reflected on", async () => {
    const stub = await startStubServer(jsonResponder(202, { ...ASKED, since: null }));
    const harness = stubContext(stub);

    await runReflect(harness.context);

    expect(harness.stdout()).toContain("window since the beginning");
  });

  it("emits the server's response unchanged under --json", async () => {
    const stub = await startStubServer(jsonResponder(202, ASKED));
    const harness = stubContext(stub, { json: true });

    await runReflect(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(ASKED);
  });
});

describe("corpus reflect --status — the clock", () => {
  const CLOCK = {
    reflected: "2026-08-22T09:00:00Z",
    pending: null,
    changed: 4,
    lastDigest: "th_d1g2",
    quiet: 30,
  };

  it("reads the clock instead of asking, and reports every part of it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00Z"));
    const stub = await startStubServer(jsonResponder(200, CLOCK));
    const harness = stubContext(stub, { flags: { status: true } });

    await runReflect(harness.context);

    expect(stub.requests[0]?.method).toBe("GET");
    expect(harness.stdout()).toBe(
      "reflected 3h ago (2026-08-22T09:00:00Z) · 4 documents changed since\n" +
        "nothing pending · quiet window 30m\n" +
        "last digest th_d1g2\n",
    );
  });

  it("names the running reflection when one is in flight", async () => {
    const stub = await startStubServer(
      jsonResponder(200, { ...CLOCK, pending: "evt_a1b2", lastDigest: null }),
    );
    const harness = stubContext(stub, { flags: { status: true } });

    await runReflect(harness.context);

    expect(harness.stdout()).toContain("reflecting now (evt_a1b2)");
    expect(harness.stdout()).not.toContain("last digest");
  });

  it("says the window is everything for a corpus never reflected on", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...CLOCK, reflected: null }));
    const harness = stubContext(stub, { flags: { status: true } });

    await runReflect(harness.context);

    expect(harness.stdout()).toContain("reflected never — the window is the whole corpus");
  });

  it("reads a quiet window of 0 as the automatic path switched off, not as immediate", async () => {
    const stub = await startStubServer(jsonResponder(200, { ...CLOCK, quiet: 0 }));
    const harness = stubContext(stub, { flags: { status: true } });

    await runReflect(harness.context);

    expect(harness.stdout()).toContain("quiet window off (asking is the only way)");
  });

  it("emits the clock unchanged under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, CLOCK));
    const harness = stubContext(stub, { flags: { status: true }, json: true });

    await runReflect(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(CLOCK);
  });
});
