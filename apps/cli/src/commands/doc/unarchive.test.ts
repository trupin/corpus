import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { isSettled } from "./archive-toggle.js";
import { archived, ARCHIVED_SKILL, at, DOC, SKILL } from "./fixtures.js";
import { runDocUnarchive, unarchiveCommand } from "./unarchive.js";

const ARGS = { id: "doc_a1b2c3" };
const SKILL_ARGS = { id: "doc_gqyrzvto" };

const withStatus = (status: "open" | "resolved" | "archived") => ({
  ...DOC,
  frontmatter: { ...DOC.frontmatter, status },
});

afterEach(closeStubServers);

describe("corpus doc unarchive", () => {
  it("round-trips the shipped route and prints one line", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    await runDocUnarchive(harness.context);

    const post = stub.requests[1];
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe("/api/docs/doc_a1b2c3/unarchive");
    expect(post?.headers["x-corpus-author"]).toBe("agent");
    expect(harness.stdout()).toBe("unarchived doc_a1b2c3\n");
  });

  it("sends nothing at all for a document that is not archived, and exits 0", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS });

    await runDocUnarchive(harness.context);

    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
    expect(harness.stdout()).toBe("doc_a1b2c3 is not archived\n");
  });

  it("leaves a resolved document resolved — it never quietly reopens one", async () => {
    // Wave-3 audit, FIX 11. The route sets `status: open` unconditionally, so
    // posting at a document that was never archived *changed* it while the
    // output line called the run a no-op. Nothing is sent now, so nothing moves.
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, withStatus("resolved"));
      sendJson(response, 200, { doc: withStatus("open"), warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS });

    await runDocUnarchive(harness.context);

    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
    expect(harness.stdout()).toBe("doc_a1b2c3 is not archived\n");
  });

  it("is idempotent: a second run on the now-open document sends nothing either", async () => {
    let unarchived = false;
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET")
        return sendJson(response, 200, unarchived ? DOC : archived(DOC));
      unarchived = true;
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });

    const first = stubContext(stub, { args: ARGS });
    await runDocUnarchive(first.context);
    expect(first.stdout()).toBe("unarchived doc_a1b2c3\n");

    const second = stubContext(stub, { args: ARGS });
    await runDocUnarchive(second.context);
    expect(second.stdout()).toBe("doc_a1b2c3 is not archived\n");
    expect(stub.requests.map((request) => request.method)).toEqual(["GET", "POST", "GET"]);
  });

  it("still posts for a skill whose folder is stranded in skills-archived", async () => {
    // The half-state a raw `PUT` or the UI can still reach until SERVER-039
    // lands: frontmatter `open`, folder still archived, name still 409-blocked.
    // This verb is the only CLI repair for it, so the status alone must not be
    // what decides to skip.
    const stranded = at(SKILL, ".claude/skills-archived/weekly-review/SKILL.md");
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, stranded);
      sendJson(response, 200, { doc: SKILL, warnings: [] });
    });
    const harness = stubContext(stub, { args: SKILL_ARGS });

    await runDocUnarchive(harness.context);

    expect(stub.requests.map((request) => request.method)).toEqual(["GET", "POST"]);
    expect(harness.stdout()).toBe("unarchived doc_gqyrzvto\n");
  });

  it("sends nothing for a skill that is already back in .claude/skills/", async () => {
    const stub = await startStubServer((_request, response) => sendJson(response, 200, SKILL));
    const harness = stubContext(stub, { args: SKILL_ARGS });

    await runDocUnarchive(harness.context);

    expect(stub.requests).toHaveLength(1);
    expect(harness.stdout()).toBe("doc_gqyrzvto is not archived\n");
  });

  it("emits the server's response under --json", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, json: true });

    await runDocUnarchive(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ doc: DOC, warnings: [] });
  });

  it("emits the same shape under --json when it sends nothing", async () => {
    const stub = await startStubServer((_request, response) => sendJson(response, 200, DOC));
    const harness = stubContext(stub, { args: ARGS, json: true });

    await runDocUnarchive(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ doc: DOC, warnings: [] });
  });

  it("folds a §11 warning onto the same line", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, {
        doc: DOC,
        warnings: [{ code: "commit_failed", detail: "pre-commit hook rejected the commit" }],
      });
    });
    const harness = stubContext(stub, { args: ARGS });

    await runDocUnarchive(harness.context);

    expect(harness.stdout()).toBe(
      "unarchived doc_a1b2c3 — warning: commit_failed (pre-commit hook rejected the commit)\n",
    );
  });

  it("surfaces the destination-collision refusal with its message intact", async () => {
    // `apps/server/src/docs/archive.ts` refuses when the skill folder's
    // destination already exists. The CLI must hand that message through — an
    // agent that cannot read why it failed cannot recover.
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, ARCHIVED_SKILL);
      sendJson(response, 400, {
        code: "bad_request",
        message: "the archive destination already exists",
        issues: [
          {
            path: "id",
            message: ".claude/skills/weekly-review already exists; move or remove it first",
          },
        ],
      });
    });
    const harness = stubContext(stub, { args: SKILL_ARGS });

    const error: unknown = await runDocUnarchive(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("the archive destination already exists");
    expect(harness.stdout()).toBe("");
  });

  it("presents no key and is never refused for one, because unarchiving names its own delta", async () => {
    // SPEC.md §7: a status flip states exactly what it changes, so it merges
    // with whatever else happened and carries no key — the write goes through
    // while someone else is writing the same document, which is the distinction
    // the keyed/keyless split exists to draw. (This replaces the wave-3 `423`
    // case: there is no lock left for the route to refuse on.)
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    await runDocUnarchive(harness.context);

    const [, post] = stub.requests;
    expect(post?.method).toBe("POST");
    expect(post?.body ?? "").not.toContain("key");
    expect(harness.stdout()).toBe("unarchived doc_a1b2c3\n");
  });

  it("reports the route's own outcome when the document is archived between the read and the post", async () => {
    // The read is one round trip old, exactly like `doc edit`'s tag merge. If
    // somebody archives the document in that window the route still runs — it
    // is the server that serialises writes, not this verb — and the line reports
    // what the route did, not what the stale read predicted.
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS });

    await runDocUnarchive(harness.context);

    expect(harness.stdout()).toBe("unarchived doc_a1b2c3\n");
  });

  it("cannot be raced into a no-op: a document archived after an unarchived read is left alone", async () => {
    // The other direction of the same window, and the one that has to fail
    // safe. The read says "not archived", so nothing is sent — the document
    // somebody just archived stays archived rather than being reopened by a
    // decision made before they touched it.
    const stub = await startStubServer((_request, response) => sendJson(response, 200, DOC));
    const harness = stubContext(stub, { args: ARGS });

    await runDocUnarchive(harness.context);

    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("reports an unknown id the way `doc archive` does — the server's own error", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no document with id doc_a1b2c3" });
    });
    const harness = stubContext(stub, { args: ARGS });

    const error: unknown = await runDocUnarchive(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("no document with id doc_a1b2c3");
    expect(stub.requests).toHaveLength(1); // the read failed; nothing was posted
  });
});

describe("isSettled — what counts as already there", () => {
  it("reads a plain document's state off the status alone", () => {
    expect(isSettled(DOC, false)).toBe(true);
    expect(isSettled(DOC, true)).toBe(false);
    expect(isSettled(archived(DOC), true)).toBe(true);
    expect(isSettled(archived(DOC), false)).toBe(false);
  });

  it("treats a resolved document as unarchived — the route would reopen it", () => {
    expect(isSettled(withStatus("resolved"), false)).toBe(true);
  });

  it("asks a skill for its folder as well as its status", () => {
    expect(isSettled(SKILL, false)).toBe(true);
    expect(isSettled(ARCHIVED_SKILL, true)).toBe(true);

    // Both half-states: each disagrees with itself, so neither is settled either way.
    const strandedOpen = at(SKILL, ".claude/skills-archived/weekly-review/SKILL.md");
    const strandedArchived = archived(SKILL);
    expect(isSettled(strandedOpen, false)).toBe(false);
    expect(isSettled(strandedArchived, true)).toBe(false);
  });
});

describe("unarchive helpers", () => {
  it("tells the agent, in the published help, that this is what the skill-name 409 means", () => {
    // TEST-540: the instruction the server's 409 gives has to name a command
    // `docs/cli.md` documents, and this description is what `docs/cli.md`
    // publishes.
    expect(unarchiveCommand.description).toContain("409");
    expect(unarchiveCommand.description).toContain("frees its name");
  });

  it("publishes that a non-archived document is left alone, not reopened", () => {
    expect(unarchiveCommand.description).toContain("without sending anything");
    expect(unarchiveCommand.description).toContain("never");
  });
});
