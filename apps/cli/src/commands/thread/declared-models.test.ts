import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError } from "../../errors.js";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import {
  DECLARED_MODELS,
  ORCHESTRATE_DOC,
  ORCHESTRATE_ROW,
  TIER_TABLE,
  withDeclaredModels,
} from "../../testing/vocabulary.js";
import { row } from "../doc/fixtures.js";
import { declaredModelCells, requireDeclaredModel } from "./declared-models.js";

afterEach(closeStubServers);

const hint = (error: unknown): string => (isCliError(error) ? (error.hint ?? "") : "");

describe("declaredModelCells", () => {
  /**
   * The pin that keeps the sibling readers honest: this parser, the kit's
   * `parseWeightLevels` and the repo tooling's `readWeightLevels` all target
   * the one declaration, and each pins itself against the real shipped
   * template so they agree by test rather than by construction.
   */
  it("reads the shipped template's own declaration", () => {
    const template = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../../assets/workspace/claude/skills/orchestrate/SKILL.md",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(declaredModelCells(template)).toEqual([...DECLARED_MODELS]);
  });

  it("strips emphasis, drops blank Model cells, and never repeats a name", () => {
    const body = [
      "| Weight | Key | Model | What falls here |",
      "| --- | --- | --- | --- |",
      "| Small | light | **Haiku** | a |",
      "| Odd jobs | odd |  | b |",
      "| Standard | standard | Sonnet | c |",
      "| Heavy | heavy | Sonnet | d |",
    ].join("\n");
    expect(declaredModelCells(body)).toEqual(["Haiku", "Sonnet"]);
  });

  it("declares nothing for a missing, fenced, or malformed table", () => {
    // No table at all.
    expect(declaredModelCells("just prose\n")).toEqual([]);
    // A worked example inside a fence is documentation, not the declaration.
    expect(declaredModelCells("````text\n" + TIER_TABLE + "\n````\n")).toEqual([]);
    // A header with no divider under it is not a table at all.
    expect(declaredModelCells("| Weight | Key | Model | What falls here |\nprose\n")).toEqual([]);
    // A malformed row invalidates the whole table rather than being skipped.
    const short = TIER_TABLE.split("\n").slice(0, 2).concat("| Heavy | heavy |").join("\n");
    expect(declaredModelCells(short)).toEqual([]);
    // A blank Weight or Key cell is the same fail-clean outcome the kit takes.
    const blankKey = [
      "| Weight | Key | Model | What falls here |",
      "| --- | --- | --- | --- |",
      "| Small |  | **Haiku** | a |",
    ].join("\n");
    expect(declaredModelCells(blankKey)).toEqual([]);
  });
});

describe("requireDeclaredModel", () => {
  const refusing = () => {
    throw new Error("nothing but the lookup should be sent");
  };

  it("passes a declared name through, reading only the projection", async () => {
    const stub = await startStubServer(withDeclaredModels(refusing));
    const harness = stubContext(stub, { actor: "agent" });

    await requireDeclaredModel(harness.context, "Opus 5");

    expect(stub.requests.map((request) => request.method)).toEqual(["GET", "GET"]);
  });

  it("refuses a name outside the table, listing the declared spellings", async () => {
    const stub = await startStubServer(withDeclaredModels(refusing));
    const harness = stubContext(stub, { actor: "agent" });

    // The incident's literal value: a real-sounding model name no runtime in
    // the workspace was running (AGENT-061, INFRA-034 story 4).
    const error: unknown = await requireDeclaredModel(harness.context, "claude-opus-4-5").catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain('"claude-opus-4-5" is not a model this workspace declares');
    expect(hint(error)).toContain("Haiku, Sonnet, Opus 5");
    // The way out that records nothing is stated, and so is that no turn was
    // lost: the refusal happens before anything is posted.
    expect(hint(error)).toContain("drop --model");
    expect(hint(error)).toContain("Nothing was sent to the server");
  });

  it("refuses every model when the workspace declares none, and says so", async () => {
    const stub = await startStubServer((request, response) => {
      sendJson(response, 200, { items: [], page: { total: 0, limit: 200, offset: 0 } });
      void request;
    });
    const harness = stubContext(stub, { actor: "agent" });

    const error: unknown = await requireDeclaredModel(harness.context, "Sonnet").catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("declares no model names");
    expect(hint(error)).toContain("no model recorded");
  });

  it("declares none when the skill exists but its table does not parse", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET" && request.path === "/api/docs") {
        sendJson(response, 200, {
          items: [ORCHESTRATE_ROW],
          page: { total: 1, limit: 200, offset: 0 },
        });
        return;
      }
      sendJson(response, 200, { ...ORCHESTRATE_DOC, body: "## Delegation\n\nprose only\n" });
    });
    const harness = stubContext(stub, { actor: "agent" });

    const error: unknown = await requireDeclaredModel(harness.context, "Sonnet").catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("declares no model names");
  });

  it("walks the skill listing to the end before concluding anything", async () => {
    // The orchestrate skill sinks to the second page — `useWeightLevels`
    // documents why a one-page read answers this question wrongly, and the CLI
    // walk inherits the same obligation.
    const filler = Array.from({ length: 200 }, (_, index) =>
      row({
        id: `doc_fill${String(index)}`,
        type: "skill",
        path: `.claude/skills/skill-${String(index)}/SKILL.md`,
      }),
    );
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET" && request.path === "/api/docs") {
        const offset = Number(request.query.get("offset") ?? "0");
        sendJson(response, 200, {
          items: offset === 0 ? filler : [ORCHESTRATE_ROW],
          page: { total: 201, limit: 200, offset },
        });
        return;
      }
      sendJson(response, 200, ORCHESTRATE_DOC);
    });
    const harness = stubContext(stub, { actor: "agent" });

    await requireDeclaredModel(harness.context, "Sonnet");

    const listings = stub.requestsTo("/api/docs");
    expect(listings.map((request) => request.query.get("offset"))).toEqual(["0", "200"]);
    expect(listings[0]?.query.get("type")).toBe("skill");
    expect(listings[0]?.query.get("sort")).toBe("created");
  });

  it("recognises the skill in the archived root too, like the composer does", async () => {
    const archivedRow = row({
      id: "doc_orch01",
      type: "skill",
      path: ".claude/skills-archived/orchestrate/SKILL.md",
    });
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET" && request.path === "/api/docs") {
        sendJson(response, 200, {
          items: [archivedRow],
          page: { total: 1, limit: 200, offset: 0 },
        });
        return;
      }
      sendJson(response, 200, ORCHESTRATE_DOC);
    });
    const harness = stubContext(stub, { actor: "agent" });

    await requireDeclaredModel(harness.context, "Sonnet");
  });
});
