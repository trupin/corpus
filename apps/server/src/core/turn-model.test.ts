import { TurnModelsSchema, TURN_MODELS_FRONTMATTER_KEY, type Turn } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./document.js";
import { FileThreadFrontmatterSchema } from "./frontmatter.js";
import {
  FileTurnModelsSchema,
  readTurnModels,
  turnModelsOf,
  turnModelsPatch,
  withTurnModels,
} from "./turn-model.js";
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

/**
 * SERVER-074's half: reading the record off a file, joining it onto the turns,
 * and computing what the next write records. The rules under test are the three
 * `turn-model.ts` states — record never invent, drop an entry that names no turn
 * of this thread, and normalise a stamp spelled another way before anything
 * compares it.
 */

const FIRST = "2026-07-19T10:05:00Z";
const SECOND = "2026-07-19T10:07:12Z";
const OPUS = "claude-opus-4-1";

const turn = (ts: string): Turn => ({ author: "agent", ts, body: "…", model: null });

describe("readTurnModels", () => {
  it("keeps a canonical entry exactly as written", () => {
    expect(readTurnModels({ [SECOND]: OPUS })).toEqual({ [SECOND]: OPUS });
  });

  it("normalises an offset spelling to the instant a turn heading carries", () => {
    // The same instant, written the way a hand edit or another tool spells it.
    // Left alone it would key a turn that does not exist and name nothing.
    expect(readTurnModels({ "2026-07-19T12:07:12+02:00": OPUS })).toEqual({ [SECOND]: OPUS });
  });

  it("normalises millisecond precision and a lowercase zone", () => {
    expect(readTurnModels({ "2026-07-19t10:07:12.500z": OPUS })).toEqual({ [SECOND]: OPUS });
  });

  /**
   * The `Date` case, through the real parser rather than a hand-built object. A
   * `!!timestamp` key is a `Date` in the YAML AST and a JavaScript object has no
   * `Date` keys, so `toJS` stringifies it — and what lands is
   * `Sun Jul 19 2026 …`, a key that names no turn and never would.
   */
  it("normalises a key a YAML `!!timestamp` left as a stringified Date", () => {
    const file = [
      "---",
      "id: th_x9y8",
      "type: thread",
      `${TURN_MODELS_FRONTMATTER_KEY}:`,
      `  ? !!timestamp ${SECOND}`,
      `  : ${OPUS}`,
      "---",
      TURNS,
    ].join("\n");
    const written = Object.keys(
      parseDocument(file).data[TURN_MODELS_FRONTMATTER_KEY] as Record<string, unknown>,
    );

    expect(written).not.toEqual([SECOND]);
    expect(written[0]).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} /);
    expect(turnModelsOf(parseDocument(file).data)).toEqual({ [SECOND]: OPUS });
  });

  it("skips a key that spells no instant rather than throwing", () => {
    expect(readTurnModels({ "not a stamp": OPUS, [SECOND]: OPUS })).toEqual({ [SECOND]: OPUS });
  });

  it("skips a value that is not a model name", () => {
    expect(
      readTurnModels({ [FIRST]: ["haiku", "opus"], [SECOND]: "", "2026-07-19T10:09:00Z": OPUS }),
    ).toEqual({ "2026-07-19T10:09:00Z": OPUS });
  });

  it("is an empty map for anything that is not a mapping", () => {
    for (const value of [undefined, null, [], "opus", 7]) {
      expect(readTurnModels(value)).toEqual({});
    }
  });

  it("reads the map off a frontmatter mapping under the reserved key", () => {
    expect(turnModelsOf({ [TURN_MODELS_FRONTMATTER_KEY]: { [SECOND]: OPUS } })).toEqual({
      [SECOND]: OPUS,
    });
    expect(turnModelsOf({ title: "no record here" })).toEqual({});
  });
});

describe("FileTurnModelsSchema", () => {
  it("accepts a stringified `Date` key, so §14 does not report a file it can read", () => {
    const stringified = new Date(Date.parse(SECOND)).toString();
    expect(FileTurnModelsSchema.parse({ [stringified]: OPUS })).toEqual({ [SECOND]: OPUS });
  });

  it("accepts an offset spelling and hands back the canonical key", () => {
    expect(FileTurnModelsSchema.parse({ "2026-07-19T12:07:12+02:00": OPUS })).toEqual({
      [SECOND]: OPUS,
    });
  });

  it("refuses a key that names no instant, so §14 reports it", () => {
    expect(FileTurnModelsSchema.safeParse({ yesterday: OPUS }).success).toBe(false);
  });

  it("refuses a multi-line value, which would write a second frontmatter key", () => {
    expect(FileTurnModelsSchema.safeParse({ [SECOND]: "opus\nagent: user" }).success).toBe(false);
  });
});

describe("withTurnModels", () => {
  it("joins the map onto the turns it names", () => {
    const joined = withTurnModels([turn(FIRST), turn(SECOND)], { [SECOND]: OPUS });
    expect(joined.map((each) => each.model)).toEqual([null, OPUS]);
  });

  it("leaves a turn the map says nothing about at null — nothing, not a guess", () => {
    expect(withTurnModels([turn(FIRST)], {})[0]?.model).toBeNull();
  });

  it("ignores an entry naming no turn, so a stale key is invisible to a reader", () => {
    expect(withTurnModels([turn(FIRST)], { [SECOND]: OPUS })).toEqual([turn(FIRST)]);
  });
});

describe("turnModelsPatch", () => {
  const data = { [TURN_MODELS_FRONTMATTER_KEY]: { [FIRST]: "haiku", [SECOND]: OPUS } };

  it("records what the writer stated about the turn being written", () => {
    expect(turnModelsPatch({}, [], { ts: SECOND, model: OPUS })).toEqual({
      [TURN_MODELS_FRONTMATTER_KEY]: { [SECOND]: OPUS },
    });
  });

  it("records nothing when the writer stated nothing", () => {
    expect(turnModelsPatch({}, [], { ts: SECOND, model: undefined })).toEqual({
      [TURN_MODELS_FRONTMATTER_KEY]: undefined,
    });
  });

  it("keeps the entries of the turns that survive", () => {
    expect(turnModelsPatch(data, [FIRST, SECOND])).toEqual({
      [TURN_MODELS_FRONTMATTER_KEY]: { [FIRST]: "haiku", [SECOND]: OPUS },
    });
  });

  it("drops the entry of a turn that is gone", () => {
    expect(turnModelsPatch(data, [FIRST])).toEqual({
      [TURN_MODELS_FRONTMATTER_KEY]: { [FIRST]: "haiku" },
    });
  });

  it("removes the key entirely when nothing is left to record", () => {
    expect(turnModelsPatch(data, [])).toEqual({ [TURN_MODELS_FRONTMATTER_KEY]: undefined });
  });

  /**
   * The reuse case, stated as a unit: `nextTurnTs` frees a deleted last turn's
   * stamp, so a caller that passed the *post*-append timestamps would hand the
   * new turn the dead turn's model. `keep` is the pre-append list, so a stale
   * entry at the reused stamp is pruned before the new one is applied.
   */
  it("never lets a stale entry attribute a model to a turn that reused its stamp", () => {
    expect(turnModelsPatch(data, [FIRST], { ts: SECOND, model: undefined })).toEqual({
      [TURN_MODELS_FRONTMATTER_KEY]: { [FIRST]: "haiku" },
    });
  });

  it("lets what the writer stated win over what the file held", () => {
    expect(turnModelsPatch(data, [FIRST, SECOND], { ts: SECOND, model: "haiku" })).toEqual({
      [TURN_MODELS_FRONTMATTER_KEY]: { [FIRST]: "haiku", [SECOND]: "haiku" },
    });
  });

  it("normalises the keys it keeps, so a re-spelled stamp names its turn", () => {
    expect(
      turnModelsPatch({ [TURN_MODELS_FRONTMATTER_KEY]: { "2026-07-19T12:07:12+02:00": OPUS } }, [
        SECOND,
      ]),
    ).toEqual({ [TURN_MODELS_FRONTMATTER_KEY]: { [SECOND]: OPUS } });
  });

  it("emits entries in timestamp order, whatever order the file held them in", () => {
    const patch = turnModelsPatch(
      { [TURN_MODELS_FRONTMATTER_KEY]: { [SECOND]: OPUS, [FIRST]: "haiku" } },
      [FIRST, SECOND],
    );
    expect(Object.keys(patch[TURN_MODELS_FRONTMATTER_KEY] ?? {})).toEqual([FIRST, SECOND]);
  });

  it("invents nothing from an empty file and an empty write", () => {
    expect(turnModelsPatch({}, [FIRST, SECOND])).toEqual({
      [TURN_MODELS_FRONTMATTER_KEY]: undefined,
    });
  });
});
