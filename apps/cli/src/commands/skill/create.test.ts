import type { Doc } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import { pipe } from "../../testing/stdin.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { createCommand, runSkillCreate } from "./create.js";
import { skillTopic } from "./index.js";

/**
 * The verb is a thin call, so what is worth testing is what it must *not* do:
 * invent a path, sanitize a name, or pre-empt a refusal the server owns. A
 * hostile name has to leave the CLI unchanged and come back as the server's
 * `400` — a CLI that silently rewrote `../evil` into `evil` would be creating a
 * skill nobody asked for.
 */

const SKILL: Doc = {
  frontmatter: {
    id: "doc_wy3a54lf",
    type: "skill",
    title: "weekly-review",
    created: "2026-07-30T14:01:06Z",
    updated: "2026-07-30T14:01:06Z",
    tags: [],
    status: "open",
    anchors: {},
    due: null,
    reviewed: null,
    evergreen: false,
    origin: null,
    stage: null,
    order: null,
    query: null,
    columns: null,
    kanban: null,
    defaultOpen: false,
    extra: {},
  },
  body: "# Weekly review\n",
  path: ".claude/skills/weekly-review/SKILL.md",
  key: "a1d4e0c9b8f7a6d5c4b3a2918f7e6d5c4b3a29180f1e2d3c4b5a69788796a5b4",
  userEditing: false,
  anchors: [],
};

const CREATED = { doc: SKILL, warnings: [] };

const requestBody = (body: string | undefined): Record<string, unknown> =>
  JSON.parse(body ?? "null") as Record<string, unknown>;

afterEach(closeStubServers);

describe("corpus skill create", () => {
  it("posts the name and description and prints the new id and path", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, {
      args: { name: "weekly-review" },
      flags: { description: "Run the weekly review over the corpus." },
      actor: "agent",
    });

    await runSkillCreate(harness.context, { stdinIsBodySource: false });

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/skills");
    expect(request?.headers["x-corpus-author"]).toBe("agent");
    expect(requestBody(request?.body)).toEqual({
      name: "weekly-review",
      description: "Run the weekly review over the corpus.",
    });
    expect(harness.stdout()).toBe("created doc_wy3a54lf — .claude/skills/weekly-review/SKILL.md\n");
  });

  it("omits body, title and tags entirely when none were given, so the template pre-fills", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, {
      args: { name: "triage" },
      flags: { description: "Triage the inbox." },
    });

    await runSkillCreate(harness.context, { stdinIsBodySource: false });

    expect(Object.keys(requestBody(stub.requests[0]?.body))).toEqual(["name", "description"]);
  });

  it("sends the optional fields when they are given, with a heredoc body byte for byte", async () => {
    const body = "# Weekly review\n\n```form\nname: x\n```\n";
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, {
      args: { name: "weekly-review" },
      flags: { description: "Run it.", title: "Weekly review", tags: "loop, memory" },
    });

    await runSkillCreate(harness.context, { stdin: pipe(body), stdinIsBodySource: true });

    expect(requestBody(stub.requests[0]?.body)).toEqual({
      name: "weekly-review",
      description: "Run it.",
      title: "Weekly review",
      body,
      tags: ["loop", "memory"],
    });
  });

  it("refuses to send a request when --description is missing or empty", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));

    for (const flags of [{}, { description: "" }]) {
      const harness = stubContext(stub, { args: { name: "triage" }, flags });
      const error: unknown = await runSkillCreate(harness.context, {
        stdinIsBodySource: false,
      }).catch((cause: unknown) => cause);

      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
      expect(String(error)).toContain("--description is required");
    }
    expect(stub.requests).toHaveLength(0);
  });

  it.each([["../evil"], ["a/b"], ["/etc/passwd"], ["%2e%2e"], ["Weekly"], [""], ["x".repeat(65)]])(
    "sends %j unchanged and reports the server's refusal — nothing is sanitized here",
    async (name) => {
      const stub = await startStubServer(
        jsonResponder(400, {
          code: "bad_request",
          message: "invalid request",
          issues: [{ path: "json.name", message: "Invalid string: must match pattern" }],
        }),
      );
      const harness = stubContext(stub, {
        args: { name },
        flags: { description: "Whatever." },
      });

      const error: unknown = await runSkillCreate(harness.context, {
        stdinIsBodySource: false,
      }).catch((cause: unknown) => cause);

      expect(exitCodeFor(error)).toBe(ExitCode.serverError);
      // The name reached the wire exactly as typed: the guard is the server's,
      // and a CLI that "helpfully" rewrote it would create a different skill.
      expect(requestBody(stub.requests[0]?.body)).toMatchObject({ name });
    },
  );

  it("surfaces a taken name as the server's 409 — exit 5", async () => {
    const stub = await startStubServer(
      jsonResponder(409, {
        code: "conflict",
        message: "a skill named `comment` is already installed (.claude/skills/comment exists)",
      }),
    );
    const harness = stubContext(stub, {
      args: { name: "comment" },
      flags: { description: "Duplicate." },
    });

    const error: unknown = await runSkillCreate(harness.context, {
      stdinIsBodySource: false,
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("already installed");
  });

  it("folds a rejected auto-commit onto the success line rather than hiding it", async () => {
    const stub = await startStubServer(
      jsonResponder(201, {
        doc: SKILL,
        warnings: [{ code: "commit_failed", detail: "pre-commit hook rejected the commit" }],
      }),
    );
    const harness = stubContext(stub, {
      args: { name: "weekly-review" },
      flags: { description: "Run it." },
    });

    await runSkillCreate(harness.context, { stdinIsBodySource: false });

    expect(harness.stdout()).toContain("warning: commit_failed");
  });

  it("emits the server's mutation envelope unchanged under --json", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, {
      args: { name: "weekly-review" },
      flags: { description: "Run it." },
      json: true,
    });

    await runSkillCreate(harness.context, { stdinIsBodySource: false });

    expect(JSON.parse(harness.stdout())).toEqual(CREATED);
  });
});

describe("the skill create command spec", () => {
  it("keeps the topic a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [skillTopic] })).toEqual(
      [],
    );
  });

  it("takes one required name and declares no global flag", () => {
    expect(createCommand.args.map((arg) => [arg.name, arg.required])).toEqual([["name", true]]);
    expect(createCommand.flags.map((flag) => flag.name)).toEqual([
      "description",
      "title",
      "tags",
      "message",
      "file",
    ]);
    expect(createCommand.requiresWorkspace).not.toBe(false);
  });

  it("documents that --description is required and that the server owns the name check", () => {
    const text = createCommand.description ?? "";
    expect(text).toContain("required");
    expect(text).toContain("409");
    expect(text).toContain("64");
  });

  /**
   * The whole topic, pinned. `rollback` left on 2026-08-12 — §7's loop safety is
   * an ordinary write whose content came from history — so a second verb
   * reappearing here is a decision to re-open that, not a detail.
   */
  it("is reachable as `corpus skill create`, and is the topic's only verb", () => {
    expect(skillTopic.commands.map((command) => command.name)).toEqual(["create"]);
  });

  it("points a bad skill edit at the ordinary write path, not at a removed verb", () => {
    const text = `${createCommand.description ?? ""}\n${skillTopic.description}`;
    expect(text).not.toContain("skill rollback");
    expect(text).toContain("corpus doc edit");
    expect(text).toContain("corpus doc diff");
  });
});
