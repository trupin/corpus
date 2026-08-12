// `POST /api/threads/{id}/turns/{ts}/form` (SPEC.md §6, §7, §8; SERVER-016,
// SERVER-068).
//
// Everything below drives the real Hono app against a real git workspace, and
// asserts one of the three surfaces the route actually changes: the thread
// markdown on disk, `git log`, or `.corpus/queue/pending/`. The route's six
// declared statuses (`201 / 400 / 401 / 403 / 404 / 409`) are each provoked;
// nothing else is ever accepted as an answer.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import {
  FORM_ANSWER_BLANK,
  FORM_ANSWER_LABEL,
  FORM_RESPOND_EVENT_TYPE,
  FormRespondPayloadSchema,
  parseFormAnswerBody,
} from "@corpus/contract";
import { readForm } from "../core/index.js";
import { formAnswerBody, formCommitSubject } from "./forms.js";
import {
  AUTH,
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  pendingEvents,
  putDoc,
  threadFrontmatterOf,
  threadPath,
  turnsOf,
  type WriteWorkspace,
} from "./thread-fixture.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("forms");
});

afterEach(() => {
  ws.close();
});

const PROMPT = "Which rate should the model assume?";
const OPTIONS = ["6.1% fixed", "5.4% variable"] as const;

/**
 * The **short** spelling of a form: a `prompt` plus `options`, which §6 keeps as
 * a form with one required choose-one field. Every form written before
 * CONTRACT-038 looks like this and must keep working unchanged.
 */
const formTurn = (options: readonly string[] = OPTIONS): string =>
  `Here is what I found.\n\n\`\`\`form\nprompt: ${PROMPT}\noptions:\n${options
    .map((option) => `  - "${option}"`)
    .join("\n")}\n\`\`\`\n`;

const RISKS = "Which risks apply?";
const RISK_OPTIONS = ["Rate rise", "Currency"] as const;
const FLAG = "Anything else to flag?";

/** One field of each of §6's three kinds, with the `write` one optional. */
const richFormTurn = (): string =>
  [
    "Here is what I found.",
    "",
    "```form",
    "fields:",
    `  - question: "${PROMPT}"`,
    '    kind: "choose one"',
    "    options:",
    ...OPTIONS.map((option) => `      - "${option}"`),
    `  - question: "${RISKS}"`,
    '    kind: "choose any"',
    "    options:",
    ...RISK_OPTIONS.map((option) => `      - "${option}"`),
    `  - question: "${FLAG}"`,
    '    kind: "write"',
    "    optional: true",
    "```",
    "",
  ].join("\n");

/** The answer to a short-spelling form, which names its one question. */
const chose = (option: string): Record<string, unknown> => ({
  answers: [{ question: PROMPT, option }],
});

interface FormThread {
  readonly id: string;
  readonly formTs: string;
  readonly parent: string;
  /**
   * The events already pending when the fixture finished. Getting the agent
   * *engaged* means asking for it, which enqueues a `comment.created` — so every
   * queue assertion below counts what this answer added, not what the directory
   * holds.
   */
  readonly before: readonly string[];
}

/**
 * A thread the agent is engaged in whose last turn carries a form — the state
 * `needs=form` describes and the only one the route is normally reached in.
 */
async function threadWithForm(body: string = formTurn()): Promise<FormThread> {
  const parent = (await createDoc(ws, { type: "note", title: "Mortgage model", body: "A body.\n" }))
    .id;
  const created = await createThread(ws, { parent, body: "what rate?", requestsAgent: true });
  const posted = await appendTurn(ws, created.id, { body }, "agent");
  expect(posted.status).toBe(201);
  expect(threadFrontmatterOf(ws, created.id)["agent"]).toBe("engaged");
  return { id: created.id, formTs: posted.ts, parent, before: pendingEvents(ws) };
}

/**
 * The same thread, with the agent turn written **straight into the file** rather
 * than posted.
 *
 * Since SERVER-068 a malformed form is a `400` at `POST …/turns` (forms are
 * written only through the server's thread endpoints, §6), so a hand-edited file
 * is the only way one reaches disk — which is exactly the case the rows below
 * describe. Seeding every row this way, malformed or not, keeps the comparison
 * about the *bytes* rather than about how they got there.
 */
async function threadWithRawTurn(body: string): Promise<FormThread> {
  const parent = (await createDoc(ws, { type: "note", title: "Mortgage model", body: "A body.\n" }))
    .id;
  const created = await createThread(ws, { parent, body: "what rate?", requestsAgent: true });
  const ts = "2030-01-01T00:00:00Z";
  const path = threadPath(created.id);
  ws.write(path, `${ws.read(path).replace(/\s*$/, "")}\n\n## agent · ${ts}\n${body}\n`);
  ws.reproject();
  return { id: created.id, formTs: ts, parent, before: pendingEvents(ws) };
}

/** `evt_*.json` files that appeared since the fixture was built. */
const addedEvents = (thread: { readonly before: readonly string[] }): string[] =>
  pendingEvents(ws).filter((name) => !thread.before.includes(name));

const formPath = (id: string, ts: string): string =>
  `/api/threads/${id}/turns/${encodeURIComponent(ts)}/form`;

const answerForm = async (
  thread: { readonly id: string; readonly formTs: string },
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Response> => ws.post(formPath(thread.id, thread.formTs), body, headers);

const eventFile = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ws.root, ".corpus", "queue", "pending", name), "utf8")) as Record<
    string,
    unknown
  >;

/** The one event this answer added, failing loudly when there is not exactly one. */
function onlyAddedEvent(thread: FormThread): Record<string, unknown> {
  const names = addedEvents(thread);
  expect(names).toHaveLength(1);
  return eventFile(names[0] ?? "");
}

/** A `pre-commit` hook that always refuses, with recognisable output (§14). */
function refuseCommits(): void {
  const hook = join(ws.root, ".git", "hooks", "pre-commit");
  mkdirSync(join(ws.root, ".git", "hooks"), { recursive: true });
  writeFileSync(hook, "#!/bin/sh\necho 'doc check: refusing' >&2\nexit 1\n", "utf8");
  chmodSync(hook, 0o755);
}

describe("answering a form", () => {
  it("appends a §6 answer turn, commits it as the user, and answers 201", async () => {
    const thread = await threadWithForm();
    const before = ws.log("%H").length;

    const response = await answerForm(thread, {
      answers: [{ question: PROMPT, option: OPTIONS[0] }],
      note: "matches the quote",
    });
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    const turn = payload["turn"] as { author: string; ts: string; body: string };
    expect(turn.author).toBe("user");
    expect(turn.body).toBe(
      `${FORM_ANSWER_LABEL}\n\n**${PROMPT}**\n\n${OPTIONS[0]}\n\n**Note:**\n\nmatches the quote`,
    );
    expect(payload["thread"]).toMatchObject({ id: thread.id, lastAuthor: "user", turnCount: 3 });
    expect(payload["warnings"]).toEqual([]);

    // §6's heading, with U+00B7 as the separator, written by the shipped renderer.
    const text = ws.read(threadPath(thread.id));
    expect(text).toContain(`## user · ${turn.ts}\n${FORM_ANSWER_LABEL}`);
    expect(text).toContain("matches the quote");

    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.log("%an <%ae>")[0]).toBe("user <user@corpus.local>");
    expect(ws.log("%s")[0]).toBe(formCommitSubject(thread.id, "user"));
  });

  /**
   * The record, asserted as **bytes**. This turn is the only durable statement of
   * what was answered — the `form.respond` payload is reaped with its event — so
   * a substring assertion would let the thing §6 actually requires (every field
   * named, the blank one said out loud) rot without a failing test.
   */
  it("names every field the form asked, in order, with the blank one said out loud", async () => {
    const thread = await threadWithForm(richFormTurn());

    const response = await answerForm(thread, {
      answers: [
        { question: PROMPT, option: OPTIONS[1] },
        { question: RISKS, options: [RISK_OPTIONS[1], RISK_OPTIONS[0]] },
      ],
      note: "the currency leg is the one I worry about",
    });

    expect(response.status).toBe(201);
    expect(turnsOf(ws, thread.id).at(-1)?.body).toBe(
      [
        FORM_ANSWER_LABEL,
        "",
        `**${PROMPT}**`,
        "",
        OPTIONS[1],
        "",
        `**${RISKS}**`,
        "",
        `- ${RISK_OPTIONS[1]}`,
        `- ${RISK_OPTIONS[0]}`,
        "",
        `**${FLAG}**`,
        "",
        FORM_ANSWER_BLANK,
        "",
        "**Note:**",
        "",
        "the currency leg is the one I worry about",
      ].join("\n"),
    );
  });

  it("carries no machine markup and invents no identifier", async () => {
    const thread = await threadWithForm(richFormTurn());
    await answerForm(thread, {
      answers: [
        { question: PROMPT, option: OPTIONS[0] },
        { question: RISKS, options: [RISK_OPTIONS[0]] },
        { question: FLAG, text: "watch the escrow" },
      ],
    });

    const body = turnsOf(ws, thread.id).at(-1)?.body ?? "";
    expect(body).not.toContain("```");
    expect(body).not.toContain(thread.formTs);
    expect(body).not.toContain(thread.id);
    expect(body).not.toMatch(/^\s*(question|kind|option|options|text):/m);
  });

  it("accepts an empty submit when every field is optional, and says so in the turn", async () => {
    const optional = [
      "Anything to add?",
      "",
      "```form",
      "fields:",
      '  - question: "Rename it?"',
      '    kind: "write"',
      "    optional: true",
      '  - question: "Which tags?"',
      '    kind: "choose any"',
      "    options:",
      '      - "rates"',
      '      - "escrow"',
      "    optional: true",
      "```",
      "",
    ].join("\n");
    const thread = await threadWithForm(optional);

    const response = await answerForm(thread, { answers: [] });

    expect(response.status).toBe(201);
    expect(turnsOf(ws, thread.id).at(-1)?.body).toBe(
      [
        FORM_ANSWER_LABEL,
        "",
        "**Rename it?**",
        "",
        FORM_ANSWER_BLANK,
        "",
        "**Which tags?**",
        "",
        FORM_ANSWER_BLANK,
      ].join("\n"),
    );
    // A form is unanswered until it is submitted; submitting nothing still
    // answers it (§6).
    const listed = await ws.request("/api/docs?needs=form&limit=200");
    const items = ((await listed.json()) as { items: { id: string }[] }).items;
    expect(items.map((item) => item.id)).not.toContain(thread.id);
  });

  it("keeps the note beside the answers rather than modelling it as a field", async () => {
    const thread = await threadWithForm(richFormTurn());

    await answerForm(thread, {
      answers: [
        { question: PROMPT, option: OPTIONS[0] },
        { question: RISKS, options: [RISK_OPTIONS[0]] },
      ],
      note: "one remark about the whole ask",
    });

    const payload = FormRespondPayloadSchema.parse(onlyAddedEvent(thread)["payload"]);
    expect(payload.note).toBe("one remark about the whole ask");
    // Three fields, not four: the note is never one of them.
    expect(payload.answers).toHaveLength(3);
    expect(payload.answers.map((record) => record.question)).toEqual([PROMPT, RISKS, FLAG]);
  });

  it("rejects a body carrying attribution-shaped keys, writing nothing", async () => {
    const thread = await threadWithForm();
    const turnsBefore = turnsOf(ws, thread.id).length;

    const response = await answerForm(thread, {
      ...chose(OPTIONS[1]),
      author: "user",
      actor: "user",
      from: "user",
    });

    expect(response.status).toBe(400);
    expect(turnsOf(ws, thread.id)).toHaveLength(turnsBefore);
  });

  it("writes the answer turn with no note block when none was given", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, chose(OPTIONS[1]));

    expect(response.status).toBe(201);
    const body = turnsOf(ws, thread.id).at(-1)?.body ?? "";
    expect(body).toBe(`${FORM_ANSWER_LABEL}\n\n**${PROMPT}**\n\n${OPTIONS[1]}`);
    expect(body).not.toContain("**Note:**");
  });

  it("stamps the answer after the form and re-projects before responding", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, chose(OPTIONS[0]));
    const turn = ((await response.json()) as { turn: { ts: string } }).turn;

    // Read-your-write: no delay, no retry loop.
    const read = await ws.request(`/api/threads/${thread.id}`);
    const wire = (await read.json()) as { turns: { ts: string; body: string }[] };
    expect(wire.turns).toHaveLength(3);
    expect(wire.turns.at(-1)?.ts).toBe(turn.ts);
    expect(turn.ts > thread.formTs).toBe(true);

    // And the file parses back to the same list.
    expect(turnsOf(ws, thread.id).map((each) => each.ts)).toEqual(
      wire.turns.map((each) => each.ts),
    );
  });

  it("gives two concurrent answers to two forms distinct, ordered stamps and loses neither", async () => {
    const thread = await threadWithForm();
    const second = await appendTurn(ws, thread.id, { body: formTurn(["A", "B"]) }, "agent");
    expect(second.status).toBe(201);

    const [first, other] = await Promise.all([
      answerForm(thread, chose(OPTIONS[0])),
      ws.post(formPath(thread.id, second.ts), { answers: [{ question: PROMPT, option: "A" }] }),
    ]);

    expect([first.status, other.status]).toEqual([201, 201]);
    const stamps = turnsOf(ws, thread.id).map((turn) => turn.ts);
    expect(stamps).toHaveLength(5);
    expect(new Set(stamps).size).toBe(5);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("succeeds while the agent is writing the parent document (SERVER-099)", async () => {
    // The route declares no refusal for another writer, and since SPEC.md §7
    // replaced the lock there is nothing left that could raise one.
    const thread = await threadWithForm();
    expect(
      (
        await putDoc(
          ws,
          thread.parent ?? "",
          { body: "the agent writes on" },
          { "x-corpus-author": "agent" },
        )
      ).status,
    ).toBe(200);

    const response = await answerForm(thread, chose(OPTIONS[0]));

    expect(response.status).toBe(201);
    expect(turnsOf(ws, thread.id)).toHaveLength(3);
  });
});

describe("refusing an answer", () => {
  it("rejects an option the form does not offer with 400 under `body.answers`", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, chose("4.0% teaser"));
    const payload = (await response.json()) as {
      code: string;
      issues: { path: string; message: string }[];
    };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("bad_request");
    expect(payload.issues).toHaveLength(1);
    expect(payload.issues[0]?.path).toBe("body.answers[0].option");
    // The message names what was offered, so a client can correct itself.
    for (const option of OPTIONS) expect(payload.issues[0]?.message).toContain(option);

    // Nothing was written: no turn, no commit, no event.
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
    expect(addedEvents(thread)).toEqual([]);
  });

  it("rejects an answer to a field the form does not ask", async () => {
    const thread = await threadWithForm(richFormTurn());

    const response = await answerForm(thread, {
      answers: [
        { question: PROMPT, option: OPTIONS[0] },
        { question: RISKS, options: [RISK_OPTIONS[0]] },
        { question: "Who signs it?", text: "me" },
      ],
    });
    const payload = (await response.json()) as { issues: { path: string; message: string }[] };

    expect(response.status).toBe(400);
    expect(payload.issues[0]?.path).toBe("body.answers[2].question");
    expect(payload.issues[0]?.message).toContain("does not ask");
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });

  it("rejects a required field with no answer, naming every one it finds", async () => {
    const thread = await threadWithForm(richFormTurn());

    const response = await answerForm(thread, { answers: [] });
    const payload = (await response.json()) as { issues: { path: string; message: string }[] };

    expect(response.status).toBe(400);
    // The two required fields; the optional `write` one is not a problem.
    expect(payload.issues).toHaveLength(2);
    expect(payload.issues.map((issue) => issue.path)).toEqual(["body.answers", "body.answers"]);
    expect(payload.issues.map((issue) => issue.message).join(" ")).toContain(RISKS);
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });

  it("rejects a required `choose any` answered with nothing selected", async () => {
    const required = [
      "```form",
      "fields:",
      `  - question: "${RISKS}"`,
      '    kind: "choose any"',
      "    options:",
      ...RISK_OPTIONS.map((option) => `      - "${option}"`),
      "```",
      "",
    ].join("\n");
    const thread = await threadWithForm(required);

    const response = await answerForm(thread, { answers: [] });
    const payload = (await response.json()) as { issues: { message: string }[] };

    expect(response.status).toBe(400);
    expect(payload.issues[0]?.message).toContain("at least one option");
  });

  it("rejects an empty option with 400 before the form is even read", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, chose(""));

    expect(response.status).toBe(400);
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });

  it("refuses an agent actor with 403, on its own form (SPEC.md §6)", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, chose(OPTIONS[0]), {
      "x-corpus-author": "agent",
    });
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(403);
    expect(payload.code).toBe("forbidden");
    // Legible, because an agent handed an opaque error retries.
    expect(payload.message).toContain("user-only");
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
    expect(addedEvents(thread)).toEqual([]);
  });

  it("refuses an agent actor with 403 on a form it did not write either", async () => {
    // The refusal is about who is answering, not about who asked: §6 says the
    // agent never answers a form, full stop.
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const created = await createThread(ws, { parent, body: "what rate?", requestsAgent: true });
    const posted = await appendTurn(ws, created.id, { body: formTurn() }, "agent");

    const response = await ws.post(formPath(created.id, posted.ts), chose(OPTIONS[0]), {
      "x-corpus-author": "agent",
    });

    expect(response.status).toBe(403);
  });

  it("refuses a second answer to the same form with 409, changing nothing", async () => {
    const thread = await threadWithForm();
    expect((await answerForm(thread, chose(OPTIONS[0]))).status).toBe(201);
    const after = ws.head();

    const response = await answerForm(thread, chose(OPTIONS[1]));
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(409);
    expect(payload.code).toBe("conflict");
    expect(payload.message).toContain("already answered");
    // Append-only: the first answer stands, and nothing new was written.
    expect(turnsOf(ws, thread.id)).toHaveLength(3);
    expect(ws.head()).toBe(after);
    expect(addedEvents(thread)).toHaveLength(1);
  });

  it("still accepts an answer to a *different* form on the same thread", async () => {
    const thread = await threadWithForm();
    const second = await appendTurn(ws, thread.id, { body: formTurn(["A", "B"]) }, "agent");

    expect((await answerForm(thread, chose(OPTIONS[0]))).status).toBe(201);
    expect(
      (
        await ws.post(formPath(thread.id, second.ts), {
          answers: [{ question: PROMPT, option: "B" }],
        })
      ).status,
    ).toBe(201);
  });

  it("refuses a second answer to a form answered the short way, before SERVER-068", async () => {
    // A workspace answered by an older server carries `**Answered:** <option>`
    // and nothing else; it is still an answer, so the form is still answered.
    const thread = await threadWithForm();
    const path = threadPath(thread.id);
    ws.write(
      path,
      `${ws.read(path).replace(/\s*$/, "")}\n\n## user · 2030-01-01T00:00:00Z\n${FORM_ANSWER_LABEL} ${OPTIONS[0]}\n`,
    );
    ws.reproject();

    expect((await answerForm(thread, chose(OPTIONS[1]))).status).toBe(409);
  });

  it.each([
    ["no fence at all", "I looked at it and have no question.\n"],
    ["a ```formula fence", "Here:\n\n```formula\nprompt: x\noptions:\n  - a\n```\n"],
    ["a ```form-builder fence", "Here:\n\n```form-builder\nprompt: x\noptions:\n  - a\n```\n"],
    ["YAML that is not a mapping", "Here:\n\n```form\n- just\n- a list\n```\n"],
    ["YAML that does not parse", "Here:\n\n```form\nprompt: [unclosed\n```\n"],
    ["a form with no options", "Here:\n\n```form\nprompt: Pick one\noptions: []\n```\n"],
    ["a form with an empty prompt", '```form\nprompt: ""\noptions:\n  - a\n```\n'],
    ["a form whose options repeat", "```form\nprompt: Pick one\noptions:\n  - a\n  - a\n```\n"],
    ["a form asking one question twice", '```form\nfields:\n  - question: "Q"\n    kind: "write"\n  - question: "Q"\n    kind: "write"\n```\n'], // prettier-ignore
    ["a fourth field kind", '```form\nfields:\n  - question: "Q"\n    kind: "pick a date"\n```\n'],
  ])("refuses a turn carrying %s with 404", async (_name, body) => {
    const thread = await threadWithRawTurn(body);

    const response = await answerForm(thread, { answers: [{ question: "Q", option: "a" }] });
    const payload = (await response.json()) as { code: string };

    expect(response.status).toBe(404);
    expect(payload.code).toBe("not_found");
    expect(addedEvents(thread)).toEqual([]);
  });

  it("refuses a `ts` naming no turn in a real thread with 404", async () => {
    const thread = await threadWithForm();

    const response = await ws.post(formPath(thread.id, "2026-07-19T10:05:00Z"), chose(OPTIONS[0]));

    expect(response.status).toBe(404);
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });

  it("refuses a `ts` naming a user turn that quotes a form fence with 404", async () => {
    const thread = await threadWithForm();
    const quoted = await appendTurn(ws, thread.id, { body: formTurn() }, "user");
    expect(quoted.status).toBe(201);
    // That user turn re-triggered the agent on its own (§8), so the baseline
    // moves with it.
    const before = pendingEvents(ws);

    const response = await ws.post(formPath(thread.id, quoted.ts), chose(OPTIONS[0]));

    expect(response.status).toBe(404);
    expect(addedEvents({ before })).toEqual([]);
  });

  it("refuses an unknown thread id with 404", async () => {
    const response = await ws.post(
      formPath("th_zzzzzz", "2026-07-27T09:00:00Z"),
      chose(OPTIONS[0]),
    );

    expect(response.status).toBe(404);
  });

  it("refuses a `doc_` id with 400 — the route addresses threads", async () => {
    const doc = await createDoc(ws, { type: "note", title: "Not a thread", body: "x\n" });

    const response = await ws.post(formPath(doc.id, "2026-07-27T09:00:00Z"), chose(OPTIONS[0]));

    // `ThreadIdSchema` refuses it before the handler runs; 400 is one of the
    // statuses the route declares, so this is a declared outcome and not a leak
    // of an undeclared one.
    expect(response.status).toBe(400);
  });

  it("refuses an unauthenticated request with 401", async () => {
    const thread = await threadWithForm();

    const response = await ws.server.app.request(formPath(thread.id, thread.formTs), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chose(OPTIONS[0])),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });
});

// SPEC.md §6, §14. A `write` answer and the note are the two places a person's
// arbitrary text reaches a thread file, where `## <author> · <ts>` is the turn
// delimiter and an unterminated fence masks every heading after it. Either one
// destroys turns rather than rendering oddly, so the answer is refused and the
// thread is asserted to still read back with the turns it had.
describe("an answer that would not survive being appended", () => {
  const withWrite = async (text: string): Promise<{ thread: FormThread; response: Response }> => {
    const thread = await threadWithForm(richFormTurn());
    const response = await answerForm(thread, {
      answers: [
        { question: PROMPT, option: OPTIONS[0] },
        { question: RISKS, options: [RISK_OPTIONS[0]] },
        { question: FLAG, text },
      ],
    });
    return { thread, response };
  };

  it("refuses a written answer that would fabricate a turn heading", async () => {
    const { thread, response } = await withWrite(
      "here is the format:\n## user · 2026-07-27T09:00:00Z\nand more",
    );
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(400);
    expect(payload.message).toContain("turn heading");
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });

  it("refuses a note that would fabricate a turn heading", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, {
      ...chose(OPTIONS[0]),
      note: "see below\n## agent · 2026-07-27T09:00:00Z\nnot really the agent",
    });

    expect(response.status).toBe(400);
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });

  it("refuses a written answer that leaves a code fence open", async () => {
    const { thread, response } = await withWrite("look:\n```js\nconst a = 1;");
    const payload = (await response.json()) as { message: string };

    expect(response.status).toBe(400);
    expect(payload.message).toContain("fence");
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });

  /**
   * PR #28 finding 2. The third delimiter a person's text can imitate belongs to
   * the answer prose itself: a line spelled exactly like one of this form's bold
   * question headings splits the record in the wrong place. Unlike the two
   * above, the *parse still succeeds*, so nothing later flags it — the refusal
   * is the only thing standing between the person and a record showing them,
   * beside a question, something they did not write.
   */
  it("refuses a written answer carrying a line spelled like the note heading", async () => {
    const { thread, response } = await withWrite("the rate moved\n\n**Note:**\n\nmine");
    const payload = (await response.json()) as { message: string };

    expect(response.status).toBe(400);
    expect(payload.message).toContain("**Note:**");
    expect(payload.message).toContain(FLAG);
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });

  /**
   * And only where the collision is real. A heading naming a question the reader
   * has already claimed — every question before this field, and this field's
   * own — is ordinary content, so quoting the form back at it is not a `400`.
   */
  it("accepts a written answer quoting a question the reader has already claimed", async () => {
    const { thread, response } = await withWrite(`you asked:\n\n**${PROMPT}**\n\nand I answered`);
    expect(response.status).toBe(201);
    expect(turnsOf(ws, thread.id)).toHaveLength(3);
  });

  /**
   * The round trip on the exact bytes written, end to end: what the person
   * submitted is what the turn on disk reads back as. `readThreadForms` asking
   * the same reader is what makes `form_answered` — and so the Attention row —
   * agree with it.
   */
  it("writes an accepted answer so that it reads back as the answer given", async () => {
    const thread = await threadWithForm(richFormTurn());
    const text = "moved on the 3rd\n\n- checked Q1\n- checked Q3\n\n**bold** but not a heading";
    const response = await answerForm(thread, {
      answers: [
        { question: PROMPT, option: OPTIONS[0] },
        { question: RISKS, options: [RISK_OPTIONS[0]] },
        { question: FLAG, text },
      ],
      note: "and a remark",
    });
    expect(response.status).toBe(201);

    const form = readForm(turnsOf(ws, thread.id)[1]?.body ?? "");
    expect(form.ok).toBe(true);
    const answered = parseFormAnswerBody(
      turnsOf(ws, thread.id).at(-1)?.body ?? "",
      form.ok ? form.form : { fields: [] },
    );
    expect(answered?.answers.map((record) => record.text)).toEqual([null, null, text]);
    expect(answered?.answers[0]?.option).toBe(OPTIONS[0]);
    expect(answered?.answers[1]?.options).toEqual([RISK_OPTIONS[0]]);
    expect(answered?.note).toBe("and a remark");
  });

  it("accepts a written answer whose fence is closed, and the thread still reads back whole", async () => {
    const { thread, response } = await withWrite("look:\n```js\nconst a = 1;\n```");
    expect(response.status).toBe(201);

    // The turn the answer wrote, and a reply after it: three plus one.
    expect((await appendTurn(ws, thread.id, { body: "thanks" }, "agent")).status).toBe(201);
    const turns = turnsOf(ws, thread.id);
    expect(turns).toHaveLength(4);
    expect(turns.at(-1)?.body).toBe("thanks");
  });
});

// SPEC.md §6 + CONTRACT-038: forms are written only through the server's thread
// endpoints, so a malformed one is refused where it is written rather than
// discovered by the person who tries to answer it.
describe("a malformed form is refused at `POST /api/threads/{id}/turns`", () => {
  const post = async (body: string, author = "agent"): Promise<Response> => {
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const created = await createThread(ws, { parent, body: "what rate?", requestsAgent: true });
    return ws.post(`/api/threads/${created.id}/turns`, { body }, { "x-corpus-author": author });
  };

  it.each([
    ["two fields asking the same question", '```form\nfields:\n  - question: "Q"\n    kind: "write"\n  - question: "Q"\n    kind: "write"\n```\n'], // prettier-ignore
    ["a choose-one listing a duplicate option", '```form\nfields:\n  - question: "Q"\n    kind: "choose one"\n    options:\n      - "a"\n      - "a"\n```\n'], // prettier-ignore
    ["a fourth kind", '```form\nfields:\n  - question: "Q"\n    kind: "pick a date"\n```\n'],
    ["a `write` field carrying options", '```form\nfields:\n  - question: "Q"\n    kind: "write"\n    options:\n      - "a"\n```\n'], // prettier-ignore
    ["YAML that does not parse", "```form\nprompt: [unclosed\n```\n"],
  ])("refuses %s with 400", async (_label, body) => {
    const response = await post(body);
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("bad_request");
    expect(payload.message).toContain("form");
  });

  it("accepts a well-formed form, in both spellings", async () => {
    expect((await post(formTurn())).status).toBe(201);
    expect((await post(richFormTurn())).status).toBe(201);
  });

  it("leaves a turn with no form fence alone", async () => {
    expect((await post("Just a reply about ```formula``` blocks.\n")).status).toBe(201);
  });

  it("does not police a person's turn, which is quoting rather than asking", async () => {
    // §6 makes a form something an agent turn carries, so a person's code block
    // that reads like a broken form is an ordinary code block.
    const response = await post("```form\nprompt: [unclosed\n```\n", "user");
    expect(response.status).toBe(201);
  });

  /**
   * SERVER-075's guard runs before this one and is not agent-only, so a form
   * fence that was never closed is reported as the *fence* it is — the fault
   * that destroys turns — rather than as YAML that happened not to parse. Both
   * actors get it, which is the point: the agent's own broken fence would have
   * swallowed the person's answer.
   */
  it("reports an unterminated form fence as the open fence, for both actors", async () => {
    for (const author of ["agent", "user"]) {
      const response = await post("Here:\n\n```form\nprompt: Pick one\n", author);
      const payload = (await response.json()) as { message: string };

      expect(response.status).toBe(400);
      expect(payload.message).toContain("code fence open");
      expect(payload.message).toContain("line 3");
    }
  });
});

describe("the `form.respond` event (SPEC.md §7)", () => {
  it("enqueues exactly one event, of the pinned type, with no `comment.created` beside it", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, {
      ...chose(OPTIONS[0]),
      note: "because rates rose",
    });
    const eventId = ((await response.json()) as { eventId: string | null }).eventId;

    const event = onlyAddedEvent(thread);
    expect(event["type"]).toBe(FORM_RESPOND_EVENT_TYPE);
    expect(event["type"]).not.toBe("comment.created");
    // The response names the event that was actually written.
    expect(event["id"]).toBe(eventId);
  });

  it("writes one entry per field of the form, in the form's order, blanks marked", async () => {
    const thread = await threadWithForm(richFormTurn());
    const response = await answerForm(thread, {
      answers: [
        { question: PROMPT, option: OPTIONS[1] },
        { question: RISKS, options: [RISK_OPTIONS[0]] },
      ],
      note: "cheaper for now",
    });
    const turn = ((await response.json()) as { turn: { ts: string } }).turn;

    const payload = FormRespondPayloadSchema.parse(onlyAddedEvent(thread)["payload"]);

    expect(payload).toEqual({
      threadId: thread.id,
      formTs: thread.formTs,
      answers: [
        {
          question: PROMPT,
          kind: "choose one",
          option: OPTIONS[1],
          options: null,
          text: null,
        },
        {
          question: RISKS,
          kind: "choose any",
          option: null,
          options: [RISK_OPTIONS[0]],
          text: null,
        },
        // Present and blank: "they declined" is not "it was never asked".
        { question: FLAG, kind: "write", option: null, options: null, text: null },
      ],
      note: "cheaper for now",
    });
    // The answered turn, never the answer.
    expect(payload.formTs).not.toBe(turn.ts);
  });

  it("carries `note: null` — present, not omitted — when no note was given", async () => {
    const thread = await threadWithForm();

    await answerForm(thread, chose(OPTIONS[0]));

    const payload = onlyAddedEvent(thread)["payload"] as Record<string, unknown>;
    expect("note" in payload).toBe(true);
    expect(payload["note"]).toBeNull();
    expect(FormRespondPayloadSchema.parse(payload).note).toBeNull();
  });

  it("moves through the queue's own lifecycle like any other event", async () => {
    const thread = await threadWithForm();
    await answerForm(thread, chose(OPTIONS[0]));

    const statusOf = async (): Promise<Record<string, number>> => {
      const response = await ws.request("/api/queue/status");
      return (await response.json()) as Record<string, number>;
    };

    // Two pending: the `comment.created` the fixture's `@agent` request made,
    // and this answer's `form.respond`.
    expect(await statusOf()).toMatchObject({ pending: 2, inProgress: 0, processed: 0 });

    const claimed = await ws.post("/api/queue/claim-all", {});
    const events = ((await claimed.json()) as { events: { id: string; type: string }[] }).events;
    const answered = events.find((event) => event.type === FORM_RESPOND_EVENT_TYPE);
    expect(answered).toBeDefined();
    expect(await statusOf()).toMatchObject({ pending: 0, inProgress: 2 });

    expect((await ws.post(`/api/queue/${answered?.id}/complete`, {})).status).toBe(200);
    expect(await statusOf()).toMatchObject({ inProgress: 1, processed: 1 });
  });
});

describe("§8 decides whether the answer re-triggers the agent", () => {
  // Corrected by SERVER-062. This case used to read "appends and commits but
  // enqueues nothing on a resolved thread" and asserted `eventId: null` — the
  // silence UI-078 filed. §8's reopen (SHARED-019 Amendment 1) names no
  // exception for the shape of a person's turn, and an answer is a turn a
  // person wrote, so it reopens and then re-triggers on §8's ordinary terms.
  it("reopens a resolved thread and re-triggers, in the answer's own commit", async () => {
    const thread = await threadWithForm();
    expect((await ws.post(`/api/threads/${thread.id}/resolve`, {})).status).toBe(200);
    expect(threadFrontmatterOf(ws, thread.id)["agent"]).toBe("engaged");
    expect(threadFrontmatterOf(ws, thread.id)["status"]).toBe("resolved");
    const before = ws.head();

    const response = await answerForm(thread, {
      ...chose(OPTIONS[0]),
      note: "for the record",
    });
    const payload = (await response.json()) as {
      eventId: string | null;
      thread: { status: string };
    };

    expect(response.status).toBe(201);
    expect(payload.eventId).toMatch(/^evt_/);
    expect(onlyAddedEvent(thread)["type"]).toBe(FORM_RESPOND_EVENT_TYPE);
    expect(payload.thread.status).toBe("open");
    expect(threadFrontmatterOf(ws, thread.id)["status"]).toBe("open");
    // The turn, the status flip and the commit are one write. `HEAD` rather
    // than a commit count: §4 folds consecutive same-actor writes into one
    // session commit, and resolve-then-answer is two writes by `user`.
    expect(turnsOf(ws, thread.id).at(-1)?.body).toContain(OPTIONS[0]);
    expect(ws.head()).not.toBe(before);
    expect(ws.git("show", `HEAD:${threadPath(thread.id)}`)).toContain("for the record");
    expect(ws.log("%s")[0]).toBe(formCommitSubject(thread.id, "user", true));
  });

  // The one remaining way `eventId` is null: since only the person answers a
  // form, the agent-author rows of §8's matrix are unreachable from this route.
  it("enqueues nothing when the agent is not engaged in the thread", async () => {
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const created = await createThread(ws, { parent, body: "a private note" });
    const posted = await appendTurn(ws, created.id, { body: formTurn() }, "agent");
    expect(threadFrontmatterOf(ws, created.id)["agent"]).toBe("none");
    const before = pendingEvents(ws);

    const response = await answerForm({ id: created.id, formTs: posted.ts }, chose(OPTIONS[0]));

    expect(response.status).toBe(201);
    expect(((await response.json()) as { eventId: string | null }).eventId).toBeNull();
    expect(addedEvents({ before })).toEqual([]);
  });
});

describe("the answer is a mutation like any other", () => {
  it("carries §14's `commit_failed` and leaves the turn standing", async () => {
    const thread = await threadWithForm();
    const before = ws.log("%H").length;
    refuseCommits();

    const response = await answerForm(thread, chose(OPTIONS[0]));
    const payload = (await response.json()) as { warnings: { code: string; detail: string }[] };

    expect(response.status).toBe(201);
    const commitFailed = payload.warnings.find((warning) => warning.code === "commit_failed");
    expect(commitFailed).toBeDefined();
    expect(commitFailed?.detail).toContain("refusing");
    // SPEC.md §14: the file write is never rolled back because a commit failed.
    expect(turnsOf(ws, thread.id)).toHaveLength(3);
    expect(ws.log("%H")).toHaveLength(before);
  });

  it("invalidates the thread, its parent and the docs collection, and streams no content", async () => {
    const thread = await threadWithForm();
    const frames: QueryKey[][] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => frames.push(keys.map((key) => [...key])));

    try {
      await answerForm(thread, { ...chose(OPTIONS[0]), note: "a private note" });
    } finally {
      unsubscribe();
    }

    const flattened = frames.flat();
    expect(flattened).toContainEqual(["docs"]);
    expect(flattened).toContainEqual(["threads", thread.id]);
    expect(flattened).toContainEqual(["docs", thread.id]);
    expect(flattened).toContainEqual(["docs", thread.parent]);
    // SPEC.md §2.2 rule 3: keys only, never content.
    const serialized = JSON.stringify(frames);
    expect(serialized).not.toContain("a private note");
    expect(serialized).not.toContain(OPTIONS[0]);
    expect(serialized).not.toContain(PROMPT);
  });

  it("leaves `needs=form` and `needs=me` once the form is answered", async () => {
    const thread = await threadWithForm(richFormTurn());
    const idsFor = async (needs: string): Promise<string[]> => {
      const response = await ws.request(`/api/docs?needs=${needs}`);
      const payload = (await response.json()) as { items: { id: string }[] };
      return payload.items.map((item) => item.id);
    };

    expect(await idsFor("form")).toContain(thread.id);
    expect(await idsFor("me")).toContain(thread.id);

    expect(
      (
        await answerForm(thread, {
          answers: [
            { question: PROMPT, option: OPTIONS[0] },
            { question: RISKS, options: [RISK_OPTIONS[0]] },
          ],
        })
      ).status,
    ).toBe(201);

    expect(await idsFor("form")).not.toContain(thread.id);
    expect(await idsFor("me")).not.toContain(thread.id);
  });
});

describe("the projection and the route agree about what carries a form (SERVER-029)", () => {
  // PR #10 finding 8. `needs=form` and this route are the two halves of one
  // promise — Attention says "awaiting your answer", the route is where the
  // answer goes — and they used to be two separate readings of the bytes: a SQL
  // substring search against the contract's regex. Every row below is a shape
  // they disagreed about. The assertion is not "each is listed" or "each is
  // answerable" but that the two answers are *the same*, which is the property
  // that has to survive whatever CONTRACT-038 does to the grammar next.
  const OPTION = "a";
  const FORM_YAML = `prompt: Pick one\noptions:\n  - ${OPTION}\n  - b`;

  const listedByNeedsForm = async (): Promise<Set<string>> => {
    const response = await ws.request("/api/docs?needs=form&limit=200", {
      headers: { ...AUTH, accept: "application/json" },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { items: { id: string }[] };
    return new Set(payload.items.map((item) => item.id));
  };

  it.each([
    ["a well-formed fence", `Here:\n\n\`\`\`form\n${FORM_YAML}\n\`\`\`\n`, true],
    // Answerable, and never surfaced: the SQL required a line ending straight
    // after `form`, while the contract's info string allows trailing blanks.
    ["a trailing space in the info string", `Here:\n\n\`\`\`form  \n${FORM_YAML}\n\`\`\`\n`, true],
    ["a trailing tab in the info string", `Here:\n\n\`\`\`form\t\n${FORM_YAML}\n\`\`\`\n`, true],
    // Surfaced forever, and unanswerable: the SQL saw only the opening line.
    ["an unterminated fence", `Here:\n\n\`\`\`form\n${FORM_YAML}\n`, false],
    ["a fence whose YAML does not parse", "Here:\n\n```form\nprompt: [unclosed\n```\n", false],
    ["a fence whose YAML is not a form", "Here:\n\n```form\ntitle: nope\n```\n", false],
    // Already agreed before SERVER-029, and asserted here so the new mechanism
    // is held to the old answers too.
    ["a ```formula fence", "Here:\n\n```formula\nx = y\n```\n", false],
    ["a quoted fence", "The skill writes:\n\n> ```form\n> prompt: Pick one\n> ```\n", false],
    ["no fence at all", "No question from me.\n", false],
  ])("%s: listed and answerable, or neither", async (_label, turnBody, expected) => {
    // Seeded out of band, uniformly: since SERVER-068 the malformed rows cannot
    // be posted at all, and the comparison is about the bytes either way.
    const thread = await threadWithRawTurn(turnBody);

    const listed = (await listedByNeedsForm()).has(thread.id);
    const response = await answerForm(thread, {
      answers: [{ question: "Pick one", option: OPTION }],
    });
    const answerable = response.status === 201;

    expect([listed, answerable]).toEqual([expected, expected]);
  });

  it("drops out of needs=form once the form is answered", async () => {
    const thread = await threadWithForm();
    expect((await listedByNeedsForm()).has(thread.id)).toBe(true);

    expect((await answerForm(thread, chose(OPTIONS[0]))).status).toBe(201);

    expect((await listedByNeedsForm()).has(thread.id)).toBe(false);
  });

  it("keeps a legacy thread answered the short way out of needs=form", async () => {
    // Nothing on disk is rewritten: an answer committed before SERVER-068 still
    // reads as an answer, so a historical thread does not return to Attention.
    const thread = await threadWithForm();
    const path = threadPath(thread.id);
    ws.write(
      path,
      `${ws.read(path).replace(/\s*$/, "")}\n\n## user · 2030-01-01T00:00:00Z\n${FORM_ANSWER_LABEL} ${OPTIONS[1]}\n`,
    );
    ws.reproject();

    expect((await listedByNeedsForm()).has(thread.id)).toBe(false);
  });
});

describe("the answer turn's body", () => {
  const form = (() => {
    const reading = readForm(richFormTurn());
    if (!reading.ok) throw new Error("fixture is not a form");
    return reading.form;
  })();

  it("names every field, and appends the note only when there is one", () => {
    const answer = {
      answers: [
        { question: PROMPT, option: OPTIONS[0] },
        { question: RISKS, options: [RISK_OPTIONS[0]] },
      ],
    };
    expect(formAnswerBody(form, answer)).toBe(
      [
        FORM_ANSWER_LABEL,
        "",
        `**${PROMPT}**`,
        "",
        OPTIONS[0],
        "",
        `**${RISKS}**`,
        "",
        `- ${RISK_OPTIONS[0]}`,
        "",
        `**${FLAG}**`,
        "",
        FORM_ANSWER_BLANK,
      ].join("\n"),
    );
    expect(formAnswerBody(form, { ...answer, note: "with caveats" })).toContain(
      "**Note:**\n\nwith caveats",
    );
  });
});
