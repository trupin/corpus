import { TurnModelsSchema, TURN_MODELS_FRONTMATTER_KEY } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./document.js";
import { FileThreadFrontmatterSchema } from "./frontmatter.js";
import { parseThreadBody, appendTurn, deleteTurn } from "./turns.js";

/**
 * CONTRACT-043's decision, proved against the real parser: the model that wrote
 * a turn is recorded in the thread document's **frontmatter**, keyed by turn
 * timestamp, and never in the body. The reasoning lives in the contract
 * (`schemas/turn-model.ts`); what is checked here is the property the reasoning
 * rests on — that adding the record changes **nothing** about how a thread file
 * reads back.
 *
 * Joining the map onto the parsed turns is SERVER-074's; until it lands every
 * turn this module produces names no model, which is §11's answer for a turn
 * nobody recorded one for.
 */

const TURNS = [
  "## user · 2026-07-19T10:05:00Z",
  "@agent is 6.1% still the right assumption?",
  "",
  "## agent · 2026-07-19T10:07:12Z",
  "Checked current averages; 6.4% is more representative.",
  "",
  "```yaml",
  "turnModels:",
  "  2026-07-19T10:05:00Z: a model I did not run",
  "```",
  "",
].join("\n");

const threadFile = (frontmatter: readonly string[]): string =>
  [
    "---",
    "id: th_x9y8",
    "type: thread",
    'title: "Re: the rate assumption"',
    ...frontmatter,
    "---",
    TURNS,
  ].join("\n");

const WITHOUT_RECORD = threadFile([]);
const WITH_RECORD = threadFile([
  `${TURN_MODELS_FRONTMATTER_KEY}:`,
  "  2026-07-19T10:07:12Z: claude-opus-4-1",
]);

describe("a thread file carrying the record", () => {
  it("round-trips its turns byte for byte, record or no record", () => {
    const without = parseThreadBody(parseDocument(WITHOUT_RECORD).body);
    const withRecord = parseThreadBody(parseDocument(WITH_RECORD).body);

    expect(withRecord).toEqual(without);
    expect(withRecord.turns.map((turn) => turn.body)).toEqual([
      "@agent is 6.1% still the right assumption?",
      [
        "Checked current averages; 6.4% is more representative.",
        "",
        "```yaml",
        "turnModels:",
        "  2026-07-19T10:05:00Z: a model I did not run",
        "```",
      ].join("\n"),
    ]);
  });

  it("leaves the body untouched — the record is outside it entirely", () => {
    expect(parseDocument(WITH_RECORD).body).toBe(parseDocument(WITHOUT_RECORD).body);
  });

  it("parses the record against the contract's shape", () => {
    const data = parseDocument(WITH_RECORD).data;
    expect(TurnModelsSchema.parse(data[TURN_MODELS_FRONTMATTER_KEY])).toEqual({
      "2026-07-19T10:07:12Z": "claude-opus-4-1",
    });
  });

  /**
   * The key survives YAML unquoted. The `yaml` package parses on the 1.2 core
   * schema, where an unquoted ISO instant is a string; a 1.1 writer would hand
   * back a `Date`, which is the read path's to normalise (`FileInstantSchema`).
   */
  it("keeps an unquoted instant key a string", () => {
    const record = parseDocument(WITH_RECORD).data[TURN_MODELS_FRONTMATTER_KEY];
    expect(Object.keys(record as object)).toEqual(["2026-07-19T10:07:12Z"]);
  });

  it("is accepted by the thread frontmatter schema and kept out of nothing else", () => {
    const parsed = FileThreadFrontmatterSchema.safeParse({
      ...parseDocument(WITH_RECORD).data,
      created: "2026-07-19T10:00:00Z",
      updated: "2026-07-19T10:07:12Z",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("what a turn's own text cannot do", () => {
  /**
   * The fenced `turnModels:` block in the second turn is content. It is inside
   * the turn, it stays inside the turn, and it reaches no map — the forgery
   * option B would have had to defend against with a guard, and this shape
   * defends against by construction.
   */
  it("does not let a body reach the frontmatter record", () => {
    const { data, body } = parseDocument(WITHOUT_RECORD);
    expect(data[TURN_MODELS_FRONTMATTER_KEY]).toBeUndefined();
    expect(body).toContain("turnModels:");
  });

  it("still parses a body full of impostor attributions as exactly two turns", () => {
    expect(parseThreadBody(parseDocument(WITHOUT_RECORD).body).turns).toHaveLength(2);
  });
});

describe("turns the parser produces", () => {
  it("name no model, because a body never carried one", () => {
    for (const turn of parseThreadBody(parseDocument(WITH_RECORD).body).turns) {
      expect(turn.model).toBeNull();
    }
  });

  it("append and delete without inventing one", () => {
    const body = parseDocument(WITHOUT_RECORD).body;
    const appended = appendTurn(body, { author: "agent", text: "Filed it." });
    expect(appended.turn.model).toBeNull();

    const removed = deleteTurn(appended.body, appended.turn.ts);
    expect(removed.deleted?.model).toBeNull();
    // Appending and deleting again leaves the same turns with the same bodies.
    expect(parseThreadBody(removed.body).turns).toEqual(parseThreadBody(body).turns);
  });
});
