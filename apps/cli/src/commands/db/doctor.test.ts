import { afterEach, describe, expect, it } from "vitest";
import { CheckFailedError, ExitCode, exitCodeFor } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { doctorCommand, runDbDoctor } from "./doctor.js";

const STATS = { files: 18, documents: 18, hashed: 0, parsed: 0, durationMs: 12 };
const CLEAN = { ok: true, drift: [], stats: STATS };
const DRIFTED = {
  ok: false,
  drift: [
    { kind: "missing_row", path: "data/docs/inbox/new.md", detail: "no row for this file" },
    { kind: "count_mismatch", path: null, detail: "jobs: 2 files, 1 row" },
  ],
  stats: STATS,
};

const WARNED = {
  ok: true,
  drift: [],
  warnings: [
    {
      kind: "unindexable_file",
      path: "data/docs/.claude/skills/invisible-doc.md",
      detail: 'it can never be indexed. Added in abc1234 "seed it".',
      commit: "abc1234",
    },
    { kind: "unindexable_files_truncated", path: null, detail: "more than 50 files", commit: null },
  ],
  stats: STATS,
};

afterEach(closeStubServers);

describe("corpus db doctor", () => {
  it("exits 0 and says the projection is clean", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEAN));
    const harness = stubContext(stub, {});

    await runDbDoctor(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("GET");
    expect(request?.path).toBe("/api/db/doctor");
    expect(harness.stdout()).toBe("projection is clean — 18 documents from 18 files (12ms)\n");
  });

  /**
   * A report-only finding is printed and changes nothing else: SPEC.md §11's
   * standing `rebuild && doctor` clean invariant is about drift, so a warning
   * that moved the exit code would fail a routine check on a workspace whose
   * projection is correct (SERVER-038).
   */
  it("prints warnings and still exits 0 with the clean verdict", async () => {
    const stub = await startStubServer(jsonResponder(200, WARNED));
    const harness = stubContext(stub, {});

    await runDbDoctor(harness.context);

    expect(harness.stdout()).toBe(
      'unindexable_file data/docs/.claude/skills/invisible-doc.md: it can never be indexed. Added in abc1234 "seed it".\n' +
        "unindexable_files_truncated (no file): more than 50 files\n" +
        "projection is clean — 18 documents from 18 files (12ms)\n",
    );
  });

  it("passes warnings through untouched under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, WARNED));
    const harness = stubContext(stub, { json: true });

    await runDbDoctor(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(WARNED);
  });

  it("maps a drift report to exit 6 — the code a pre-commit hook gates on", async () => {
    const stub = await startStubServer(jsonResponder(200, DRIFTED));
    const harness = stubContext(stub, {});

    const error: unknown = await runDbDoctor(harness.context).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CheckFailedError);
    expect(exitCodeFor(error)).toBe(ExitCode.checkFailed);
    expect(harness.stdout()).toBe(
      "missing_row data/docs/inbox/new.md: no row for this file\n" +
        "count_mismatch (no file): jobs: 2 files, 1 row\n",
    );
  });

  it("passes the report through untouched under --json, still exiting 6", async () => {
    const stub = await startStubServer(jsonResponder(200, DRIFTED));
    const harness = stubContext(stub, { json: true });

    const error: unknown = await runDbDoctor(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.checkFailed);
    expect(JSON.parse(harness.stdout())).toEqual(DRIFTED);
  });

  it("emits the clean report under --json too", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEAN));
    const harness = stubContext(stub, { json: true });

    await runDbDoctor(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(CLEAN);
  });

  it("reports an unreachable server as exit 4, not as drift", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEAN));
    const harness = stubContext(stub, {});
    await stub.close();

    const error: unknown = await runDbDoctor(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverUnreachable);
    expect(String(error)).toContain("corpus server start");
  });

  it("documents the exit codes and that it repairs nothing", () => {
    const text = `${doctorCommand.description ?? ""} ${doctorCommand.summary}`;
    expect(text).toContain("6");
    expect(text).toContain("corpus db rebuild");
  });
});
