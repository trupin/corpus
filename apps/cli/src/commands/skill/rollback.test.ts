import type { SkillRollbackResult } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ServerResponseError } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { skillTopic } from "./index.js";
import { rollbackCommand, runSkillRollback } from "./rollback.js";

/**
 * The verb is a thin call, so what is worth testing is the honesty of the
 * rendering: an uncommitted restoration must not read like a committed one, and
 * an unknown skill must come back as the server's `404` (exit 5) rather than as
 * anything the CLI decided on its own.
 */

const RESTORED: SkillRollbackResult = {
  name: "orchestrate",
  docId: "doc_skill1a2b3c4d",
  commit: "9f3c1ab",
  path: ".claude/skills/orchestrate/SKILL.md",
  warnings: [],
};

const UNCOMMITTED: SkillRollbackResult = {
  ...RESTORED,
  commit: null,
  warnings: [{ code: "commit_failed", detail: "pre-commit hook rejected the commit" }],
};

afterEach(closeStubServers);

describe("corpus skill rollback", () => {
  it("restores by name and names the commit and the path", async () => {
    const stub = await startStubServer(jsonResponder(200, RESTORED));

    const harness = stubContext(stub, { args: { name: "orchestrate" } });
    await runSkillRollback(harness.context);

    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.path).toBe("/api/skills/orchestrate/rollback");
    expect(harness.stdout()).toBe(
      "restored .claude/skills/orchestrate/SKILL.md in commit 9f3c1ab (doc_skill1a2b3c4d)\n",
    );
  });

  it("sends no body at all when --to is omitted", async () => {
    const stub = await startStubServer(jsonResponder(200, RESTORED));

    const harness = stubContext(stub, { args: { name: "orchestrate" } });
    await runSkillRollback(harness.context);

    expect(stub.requests[0]?.body).toBe("");
  });

  it("passes --to through as the request body", async () => {
    const stub = await startStubServer(jsonResponder(200, RESTORED));

    const harness = stubContext(stub, { args: { name: "comment" }, flags: { to: "9f3c1ab" } });
    await runSkillRollback(harness.context);

    expect(stub.requests[0]?.path).toBe("/api/skills/comment/rollback");
    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({ to: "9f3c1ab" });
  });

  it("carries the acting party as the author header", async () => {
    const stub = await startStubServer(jsonResponder(200, RESTORED));

    const harness = stubContext(stub, { args: { name: "orchestrate" }, actor: "agent" });
    await runSkillRollback(harness.context);

    expect(stub.requests[0]?.headers["x-corpus-author"]).toBe("agent");
  });

  it("reports a null commit as uncommitted, with the reason", async () => {
    const stub = await startStubServer(jsonResponder(200, UNCOMMITTED));

    const harness = stubContext(stub, { args: { name: "orchestrate" } });
    await runSkillRollback(harness.context);

    expect(harness.stdout()).toBe(
      [
        "restored .claude/skills/orchestrate/SKILL.md — uncommitted, the file write stands (doc_skill1a2b3c4d)",
        "warning commit_failed: pre-commit hook rejected the commit",
        "",
      ].join("\n"),
    );
    // No sha is invented to fill an audit field.
    expect(harness.stdout()).not.toMatch(/commit [0-9a-f]{7}/);
  });

  it("emits the server's result unreshaped under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, UNCOMMITTED));

    const harness = stubContext(stub, { args: { name: "orchestrate" }, json: true });
    await runSkillRollback(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(UNCOMMITTED)}\n`);
    expect(JSON.parse(harness.stdout())).toEqual(UNCOMMITTED);
  });

  it("surfaces an unknown skill as the server's 404 — exit 5", async () => {
    const stub = await startStubServer(
      jsonResponder(404, {
        code: "not_found",
        message: "no skill named `nope` is installed (.claude/skills/nope/SKILL.md does not exist)",
      }),
    );

    const harness = stubContext(stub, { args: { name: "nope" } });
    const failure = await runSkillRollback(harness.context).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ServerResponseError);
    expect((failure as ServerResponseError).exitCode).toBe(5);
    expect((failure as ServerResponseError).message).toContain("no skill named `nope`");
  });
});

describe("the skill rollback command spec", () => {
  it("keeps the topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [skillTopic] })).toEqual(
      [],
    );
  });

  it("takes one required name and only --to", () => {
    expect(rollbackCommand.args.map((arg) => [arg.name, arg.required])).toEqual([["name", true]]);
    // `--from` is global; a verb declaring it fails registry validation.
    expect(rollbackCommand.flags.map((flag) => flag.name)).toEqual(["to"]);
    expect(rollbackCommand.requiresWorkspace).not.toBe(false);
  });

  it("documents the null-commit case and the 404", () => {
    expect(rollbackCommand.description).toContain("uncommitted");
    expect(rollbackCommand.description).toContain("exit 5");
  });

  it("carries a --json example that inlines its shape", () => {
    const machine = rollbackCommand.examples.find((example) => example.command.includes("--json"));
    expect(machine?.description).toContain('"docId"');
    expect(machine?.description).toContain('"commit"');
  });

  it("is the topic's only verb, reachable as `corpus skill rollback`", () => {
    expect(skillTopic.commands.map((command) => command.name)).toEqual(["rollback"]);
  });
});
