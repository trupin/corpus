import { afterEach, describe, expect, it } from "vitest";
import { GLOBAL_FLAG_NAMES } from "../../registry/globals.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { rebuildCommand, REBUILD_TIMEOUT_MS, runDbRebuild } from "./rebuild.js";

const RESULT = {
  path: "/tmp/ws/.corpus/cache.db",
  documents: 12,
  threads: 3,
  turns: 7,
  anchors: 2,
  links: 0,
  events: 1,
  jobs: 1,
  seen: 1,
  durationMs: 412,
  skipped: [],
};

afterEach(closeStubServers);

describe("corpus db rebuild", () => {
  it("posts a bodiless rebuild and summarises every count and the duration", async () => {
    const stub = await startStubServer(jsonResponder(200, RESULT));
    const harness = stubContext(stub, {});

    await runDbRebuild(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/db/rebuild");
    expect(harness.stdout()).toBe(
      "rebuilt the projection in 412ms — 12 documents, 3 threads, 7 turns, 2 anchors, " +
        "0 links, 1 event, 1 job, 1 seen\n",
    );
  });

  it("names the files it skipped, because an empty list is the good case", async () => {
    const stub = await startStubServer(
      jsonResponder(200, {
        ...RESULT,
        skipped: [{ path: "data/docs/broken.md", reason: "frontmatter unparseable" }],
      }),
    );
    const harness = stubContext(stub, {});

    await runDbRebuild(harness.context);

    expect(harness.stdout()).toContain("skipped 1 file (data/docs/broken.md)");
  });

  it("emits the whole RebuildResult under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, RESULT));
    const harness = stubContext(stub, { json: true });

    await runDbRebuild(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(RESULT);
  });

  it("does not use the ten-second global transport timeout", () => {
    // Registering a local `--timeout` is impossible — validation rejects a flag
    // that shadows a global — so the deadline lives on the untimed client seam.
    expect(rebuildCommand.flags.map((flag) => flag.name)).toEqual([]);
    expect(GLOBAL_FLAG_NAMES.has("timeout")).toBe(true);
    expect(REBUILD_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  it("survives a server slower than the global timeout would allow", async () => {
    const stub = await startStubServer((_request, response) => {
      // Longer than a default `--timeout` window would tolerate on a fast path;
      // short enough to keep the suite quick.
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(RESULT));
      }, 50);
    });
    const harness = stubContext(stub, { json: true });

    await runDbRebuild(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(RESULT);
  });
});
