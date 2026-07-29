import { describe, expect, it } from "vitest";
import {
  containsFormFence,
  extractFormSource,
  findFormFence,
  FORM_ANSWER_LABEL,
  FORM_FENCE_INFO_STRING,
  FORM_RESPOND_EVENT_TYPE,
  FormAnswerRequestSchema,
  FormAnswerResponseSchema,
  FormRespondPayloadSchema,
  FormSchema,
  parseFormRespondPayload,
  validateFormAnswer,
} from "./form.js";
import { CORE_QUEUE_EVENT_TYPES } from "./queue.js";

const fenced = (info: string, yaml: string) => ["```" + info, yaml, "```"].join("\n");

const FORM_YAML = 'prompt: Which rate should the model assume?\noptions:\n  - "6.1%"\n  - "6.4%"';

const form = FormSchema.parse({
  prompt: "Which rate should the model assume?",
  options: ["6.1%", "6.4%"],
});

describe("the form fence", () => {
  it("names the info string the whole grammar hangs on", () => {
    expect(FORM_FENCE_INFO_STRING).toBe("form");
  });

  /**
   * The writer (the server's form route) and the reader (the UI's answered-form
   * detector) cannot import each other, so the marker is pinned here — a change
   * to it is a change to the turn format, and this is where it has to be made.
   */
  it("names the answered-form marker both the writer and the reader match on", () => {
    expect(FORM_ANSWER_LABEL).toBe("**Answered:**");
    expect(`${FORM_ANSWER_LABEL} 6.4%`.startsWith(FORM_ANSWER_LABEL)).toBe(true);
  });

  it("extracts the YAML of a form fence in an agent turn", () => {
    const body = `Checked the averages.\n\n${fenced("form", FORM_YAML)}\n\nLet me know.`;
    expect(extractFormSource(body)).toBe(FORM_YAML);
    expect(containsFormFence(body)).toBe(true);
  });

  it("finds a fence that opens the body, with no preceding newline", () => {
    expect(extractFormSource(fenced("form", FORM_YAML))).toBe(FORM_YAML);
  });

  /**
   * The distinction the projection's `needs=form` detector has to make: a
   * substring search for "```form" matches every one of these and would put a
   * thread into Attention that is waiting for nothing.
   */
  it.each(["formula", "form-builder", "formatting", "yaml", ""])(
    "does not mistake a ```%s fence for a form",
    (info) => {
      const body = fenced(info, FORM_YAML);
      expect(extractFormSource(body)).toBeUndefined();
      expect(containsFormFence(body)).toBe(false);
    },
  );

  it("tolerates trailing whitespace on both fence lines", () => {
    const body = "```form  \nprompt: Ready?\noptions:\n  - Yes\n```  ";
    expect(extractFormSource(body)).toBe("prompt: Ready?\noptions:\n  - Yes");
  });

  it("returns the first form when a turn carries more than one", () => {
    const body = `${fenced("form", "prompt: A\noptions:\n  - x")}\n\n${fenced("form", "prompt: B\noptions:\n  - y")}`;
    expect(extractFormSource(body)).toBe("prompt: A\noptions:\n  - x");
  });

  it("reports no form in a body that has none", () => {
    expect(containsFormFence("Just a reply, with `code` and a ```ts fence.")).toBe(false);
    expect(extractFormSource("")).toBeUndefined();
  });
});

/** The CONTRACT-014 settlement: CommonMark's fence rules, minus three documented restrictions. */
describe("the fence grammar at its edges", () => {
  it("hands a renderer the offsets to split the body around the fence", () => {
    const body = `Before.\n\n${fenced("form", FORM_YAML)}\n\nAfter.`;
    const match = findFormFence(body);
    expect(match).toBeDefined();
    expect(body.slice(0, match?.start)).toBe("Before.\n\n");
    expect(body.slice(match?.end)).toBe("\n\nAfter.");
    expect(match?.source).toBe(FORM_YAML);
  });

  // Restriction 3: the server always closes the fences it writes, so an
  // unterminated one is a mangled file, not a question — even though CommonMark
  // would close it at end of input.
  it("does not treat an unterminated fence as a form", () => {
    expect(containsFormFence(`Q:\n\n\`\`\`form\n${FORM_YAML}\n`)).toBe(false);
    expect(containsFormFence("```form")).toBe(false);
  });

  // CommonMark: a closing fence is a whole line. The old regex accepted this
  // and read a YAML source no renderer would show.
  it("does not accept a mid-line closer, leaving the fence unterminated", () => {
    expect(containsFormFence("```form\nprompt: x```\n")).toBe(false);
  });

  // CommonMark: fences do not nest — content of an open block is content. The
  // old regex claimed the quoted example as a live form.
  it("leaves a form quoted inside an outer example block alone", () => {
    const body = `An example:\n\n\`\`\`\`markdown\n${fenced("form", FORM_YAML)}\n\`\`\`\``;
    expect(containsFormFence(body)).toBe(false);
  });

  it("leaves a form quoted inside a tilde block alone", () => {
    expect(containsFormFence(`~~~\n${fenced("form", FORM_YAML)}\n~~~`)).toBe(false);
  });

  // The inner "```form" line cannot close the ```js block (a closer carries no
  // info string), so the js block swallows everything to the last "```" —
  // exactly CommonMark's reading.
  it("lets an unclosed plain fence shadow a form fence that follows", () => {
    expect(containsFormFence(`\`\`\`js\ncode\n\`\`\`form\n${FORM_YAML}\n\`\`\``)).toBe(false);
  });

  it("finds a form after a closed plain fence", () => {
    const body = `\`\`\`js\ncode()\n\`\`\`\n\n${fenced("form", FORM_YAML)}`;
    expect(extractFormSource(body)).toBe(FORM_YAML);
  });

  // CommonMark: the closer needs at least as many backticks as the opener.
  it.each([
    ["a longer closer on a three-backtick opener", `\`\`\`form\n${FORM_YAML}\n\`\`\`\`\``],
    ["a four-backtick opener with a matching closer", `\`\`\`\`form\n${FORM_YAML}\n\`\`\`\`\``],
  ])("accepts %s", (_name, body) => {
    expect(extractFormSource(body)).toBe(FORM_YAML);
  });

  it("keeps a three-backtick line as content inside a four-backtick form fence", () => {
    expect(extractFormSource(`\`\`\`\`form\n${FORM_YAML}\n\`\`\`\n\`\`\`\``)).toBe(
      `${FORM_YAML}\n\`\`\``,
    );
  });

  // Restriction 2: §6 spells the fence with backticks; a tilde fence opens an
  // ordinary code block. Restriction 1: column 0 only.
  it.each([
    ["a tilde form fence", `~~~form\n${FORM_YAML}\n~~~`],
    ["an indented fence", `  \`\`\`form\n${FORM_YAML}\n  \`\`\``],
    ["a backtick in the info string", `\`\`\`form\`\n${FORM_YAML}\n\`\`\``],
  ])("declines %s, degrading it to an ordinary block", (_name, body) => {
    expect(containsFormFence(body)).toBe(false);
  });

  // CommonMark trims the info string, so leading whitespace before `form` is
  // the same fence — new with the scanner; the old regex declined it.
  it("accepts leading whitespace in the info string, as CommonMark does", () => {
    expect(extractFormSource(`\`\`\` form\n${FORM_YAML}\n\`\`\``)).toBe(FORM_YAML);
  });

  it("reads a CRLF body, normalising the source's line terminators", () => {
    const body = "```form\r\nprompt: Ready?\r\noptions:\r\n  - Yes\r\n```\r\n";
    expect(extractFormSource(body)).toBe("prompt: Ready?\noptions:\n  - Yes");
  });
});

describe("the form grammar", () => {
  it("accepts a prompt with at least one option", () => {
    expect(FormSchema.parse({ prompt: "Ready?", options: ["Yes"] })).toEqual({
      prompt: "Ready?",
      options: ["Yes"],
    });
  });

  it.each([
    ["an empty prompt", { prompt: "", options: ["Yes"] }],
    ["a missing prompt", { options: ["Yes"] }],
    ["no options at all", { prompt: "Ready?", options: [] }],
    ["a missing options list", { prompt: "Ready?" }],
    ["an empty option", { prompt: "Ready?", options: ["Yes", ""] }],
  ])("rejects %s", (_name, value) => {
    expect(FormSchema.safeParse(value).success).toBe(false);
  });

  /** An answer names an option by its text, so duplicates make it ambiguous. */
  it("rejects duplicate options", () => {
    const parsed = FormSchema.safeParse({ prompt: "Ready?", options: ["Yes", "Yes"] });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("distinct");
  });
});

describe("answering a form", () => {
  it("round-trips an answer with a note", () => {
    const answer = { option: "6.1%", note: "matches the Q2 sheet" };
    expect(FormAnswerRequestSchema.parse(answer)).toEqual(answer);
  });

  it("leaves the note out entirely rather than defaulting it", () => {
    expect(FormAnswerRequestSchema.parse({ option: "6.1%" })).toEqual({ option: "6.1%" });
  });

  it.each([
    ["a missing option", {}],
    ["an empty option", { option: "" }],
    ["an empty note", { option: "6.1%", note: "" }],
  ])("rejects %s", (_name, value) => {
    expect(FormAnswerRequestSchema.safeParse(value).success).toBe(false);
  });

  it("passes an option the form offers", () => {
    expect(validateFormAnswer(form, { option: "6.4%" })).toBeUndefined();
  });

  it("rejects an option the form does not offer, naming the field and the choices", () => {
    const rejection = validateFormAnswer(form, { option: "5.0%" });
    expect(rejection?.code).toBe("bad_request");
    expect(rejection?.issues).toHaveLength(1);
    expect(rejection?.issues[0]?.path).toBe("body.option");
    expect(rejection?.issues[0]?.message).toContain("`6.1%`");
    expect(rejection?.issues[0]?.message).toContain("`6.4%`");
  });

  /** Matching is verbatim: a near miss is a rejection, not a fuzzy accept. */
  it.each(["6.1", " 6.1%", "6.1% ", "6.1%\n", "6.4%%"])("rejects the near miss %j", (option) => {
    expect(validateFormAnswer(form, { option })).toBeDefined();
  });

  it("carries the answer through the response shape, with the enqueued event", () => {
    const response = {
      thread: {
        id: "th_x9y8",
        title: "Re: rates",
        status: "open" as const,
        parent: "doc_a1b2c3",
        anchor: "anc_k4f7",
        agent: "engaged" as const,
        created: "2026-07-19T10:05:00Z",
        updated: "2026-07-19T10:09:00Z",
        turnCount: 3,
        lastAuthor: "user" as const,
        lastTs: "2026-07-19T10:09:00Z",
      },
      turn: { author: "user" as const, ts: "2026-07-19T10:09:00Z", body: "6.4%" },
      eventId: "evt_7c1d",
      warnings: [],
    };
    expect(FormAnswerResponseSchema.parse(response)).toEqual(response);
  });

  /** A resolved thread stops re-triggering the agent (SPEC.md §8), so null is legal. */
  it("accepts a null event id but never a missing one", () => {
    const base = FormAnswerResponseSchema.parse({
      thread: {
        id: "th_x9y8",
        title: "Re: rates",
        status: "resolved" as const,
        parent: null,
        anchor: null,
        agent: "engaged" as const,
        created: "2026-07-19T10:05:00Z",
        updated: "2026-07-19T10:09:00Z",
        turnCount: 3,
        lastAuthor: "user" as const,
        lastTs: "2026-07-19T10:09:00Z",
      },
      turn: { author: "user" as const, ts: "2026-07-19T10:09:00Z", body: "6.4%" },
      eventId: null,
      warnings: [],
    });
    expect(base.eventId).toBeNull();

    const { eventId: _dropped, ...missing } = base;
    expect(FormAnswerResponseSchema.safeParse(missing).success).toBe(false);
  });
});

describe("the form.respond payload", () => {
  const payload = {
    threadId: "th_x9y8",
    formTs: "2026-07-19T10:07:12Z",
    option: "6.4%",
    note: null,
  };

  it("is one of the core event types SPEC.md §7 names", () => {
    expect(CORE_QUEUE_EVENT_TYPES).toContain(FORM_RESPOND_EVENT_TYPE);
  });

  it("round-trips, naming the thread and the answered form", () => {
    expect(FormRespondPayloadSchema.parse(payload)).toEqual(payload);
    expect(FormRespondPayloadSchema.parse({ ...payload, note: "a note" }).note).toBe("a note");
  });

  it.each([
    ["a document id where a thread belongs", { ...payload, threadId: "doc_a1b2c3" }],
    ["a timestamp that is not an instant", { ...payload, formTs: "yesterday" }],
    ["an empty option", { ...payload, option: "" }],
    [
      "an omitted note rather than a null one",
      { threadId: "th_x9y8", formTs: payload.formTs, option: "6.4%" },
    ],
  ])("rejects %s", (_name, value) => {
    expect(FormRespondPayloadSchema.safeParse(value).success).toBe(false);
  });

  it("narrows a matching queue event", () => {
    expect(parseFormRespondPayload({ type: "form.respond", payload })).toEqual(payload);
  });

  it("declines an event of another type, core or plugin", () => {
    expect(parseFormRespondPayload({ type: "comment.created", payload })).toBeUndefined();
    expect(parseFormRespondPayload({ type: "todos.moved", payload })).toBeUndefined();
  });

  /** Events come off disk: one written by an older server is skipped, not thrown on. */
  it("declines a form.respond whose payload does not match", () => {
    expect(parseFormRespondPayload({ type: "form.respond", payload: {} })).toBeUndefined();
    expect(parseFormRespondPayload({ type: "form.respond", payload: null })).toBeUndefined();
  });
});
