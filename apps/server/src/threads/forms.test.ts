// `POST /api/threads/{id}/turns/{ts}/form` (SPEC.md §6, §7, §8; SERVER-016).
//
// Everything below drives the real Hono app against a real git workspace, and
// asserts one of the three surfaces the route actually changes: the thread
// markdown on disk, `git log`, or `.corpus/queue/pending/`. The route's four
// declared statuses (`201 / 400 / 401 / 404`) are each provoked; nothing else is
// ever accepted as an answer.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { FORM_RESPOND_EVENT_TYPE, FormRespondPayloadSchema } from "@corpus/contract";
import { FORM_ANSWER_LABEL, formAnswerBody, formCommitSubject } from "./forms.js";
import {
  AUTH,
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  pendingEvents,
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

/** An agent turn body carrying a well-formed form fence (SPEC.md §6). */
const formTurn = (options: readonly string[] = OPTIONS): string =>
  `Here is what I found.\n\n\`\`\`form\nprompt: ${PROMPT}\noptions:\n${options
    .map((option) => `  - "${option}"`)
    .join("\n")}\n\`\`\`\n`;

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

    const response = await answerForm(thread, { option: OPTIONS[0], note: "matches the quote" });
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    const turn = payload["turn"] as { author: string; ts: string; body: string };
    expect(turn.author).toBe("user");
    expect(turn.body).toBe(`${FORM_ANSWER_LABEL} ${OPTIONS[0]}\n\nmatches the quote`);
    expect(payload["thread"]).toMatchObject({ id: thread.id, lastAuthor: "user", turnCount: 3 });
    expect(payload["warnings"]).toEqual([]);

    // §6's heading, with U+00B7 as the separator, written by the shipped renderer.
    const text = ws.read(threadPath(thread.id));
    expect(text).toContain(`## user · ${turn.ts}\n${FORM_ANSWER_LABEL} ${OPTIONS[0]}`);
    expect(text).toContain("matches the quote");

    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.log("%an <%ae>")[0]).toBe("user <user@corpus.local>");
    expect(ws.log("%s")[0]).toBe(formCommitSubject(thread.id, "user"));
  });

  it("records the acting party from the header, never from the body", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(
      thread,
      { option: OPTIONS[1] },
      { "x-corpus-author": "agent" },
    );

    expect(response.status).toBe(201);
    expect(ws.log("%an <%ae>")[0]).toBe("agent <agent@corpus.local>");
    expect(turnsOf(ws, thread.id).at(-1)?.author).toBe("agent");
  });

  /**
   * Before CONTRACT-017 these keys validated and were silently dropped — which
   * is what the test above used to prove attribution ignores them. Bodies are
   * strict now, so a body that even *tries* to smuggle attribution is refused
   * outright, and nothing is written.
   */
  it("rejects a body carrying attribution-shaped keys, writing nothing", async () => {
    const thread = await threadWithForm();
    const turnsBefore = turnsOf(ws, thread.id).length;

    const response = await answerForm(
      thread,
      { option: OPTIONS[1], author: "user", actor: "user", from: "user" },
      { "x-corpus-author": "agent" },
    );

    expect(response.status).toBe(400);
    expect(turnsOf(ws, thread.id)).toHaveLength(turnsBefore);
  });

  it("writes the answer turn with no note when none was given", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, { option: OPTIONS[1] });

    expect(response.status).toBe(201);
    expect(turnsOf(ws, thread.id).at(-1)?.body).toBe(`${FORM_ANSWER_LABEL} ${OPTIONS[1]}`);
  });

  it("stamps the answer after the form and re-projects before responding", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, { option: OPTIONS[0] });
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

  it("gives two concurrent answers distinct, ordered stamps and loses neither", async () => {
    const thread = await threadWithForm();

    const [first, second] = await Promise.all([
      answerForm(thread, { option: OPTIONS[0] }),
      answerForm(thread, { option: OPTIONS[1] }),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    const stamps = turnsOf(ws, thread.id).map((turn) => turn.ts);
    expect(stamps).toHaveLength(4);
    expect(new Set(stamps).size).toBe(4);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("succeeds while the parent document is locked by the agent (no 423)", async () => {
    const thread = await threadWithForm();
    expect(
      (await ws.post(`/api/locks/${thread.parent}`, {}, { "x-corpus-author": "agent" })).status,
    ).toBe(201);

    const response = await answerForm(thread, { option: OPTIONS[0] });

    expect(response.status).toBe(201);
    expect(turnsOf(ws, thread.id)).toHaveLength(3);
  });

  it("appends a second answer with a second event when the same form is answered twice", async () => {
    const thread = await threadWithForm();

    expect((await answerForm(thread, { option: OPTIONS[0] })).status).toBe(201);
    expect((await answerForm(thread, { option: OPTIONS[1] })).status).toBe(201);

    expect(turnsOf(ws, thread.id)).toHaveLength(4);
    expect(addedEvents(thread)).toHaveLength(2);
  });
});

describe("refusing an answer", () => {
  it("rejects an option the form does not offer with 400 on `body.option`", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, { option: "4.0% teaser" });
    const payload = (await response.json()) as {
      code: string;
      issues: { path: string; message: string }[];
    };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("bad_request");
    expect(payload.issues).toHaveLength(1);
    expect(payload.issues[0]?.path).toBe("body.option");
    // The message names what was offered, so a client can correct itself.
    for (const option of OPTIONS) expect(payload.issues[0]?.message).toContain(option);

    // Nothing was written: no turn, no commit, no event.
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
    expect(addedEvents(thread)).toEqual([]);
  });

  it("rejects an empty option with 400 before the form is even read", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, { option: "" });

    expect(response.status).toBe(400);
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
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
  ])("refuses a turn carrying %s with 404", async (_name, body) => {
    const thread = await threadWithForm(body);

    const response = await answerForm(thread, { option: "a" });
    const payload = (await response.json()) as { code: string };

    expect(response.status).toBe(404);
    expect(payload.code).toBe("not_found");
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
    expect(addedEvents(thread)).toEqual([]);
  });

  it("refuses a `ts` naming no turn in a real thread with 404", async () => {
    const thread = await threadWithForm();

    const response = await ws.post(formPath(thread.id, "2026-07-19T10:05:00Z"), {
      option: OPTIONS[0],
    });

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

    const response = await ws.post(formPath(thread.id, quoted.ts), { option: OPTIONS[0] });

    expect(response.status).toBe(404);
    expect(addedEvents({ before })).toEqual([]);
  });

  it("refuses an unknown thread id with 404", async () => {
    const response = await ws.post(formPath("th_zzzzzz", "2026-07-27T09:00:00Z"), {
      option: OPTIONS[0],
    });

    expect(response.status).toBe(404);
  });

  it("refuses a `doc_` id with 400 — the route addresses threads", async () => {
    const doc = await createDoc(ws, { type: "note", title: "Not a thread", body: "x\n" });

    const response = await ws.post(formPath(doc.id, "2026-07-27T09:00:00Z"), {
      option: OPTIONS[0],
    });

    // `ThreadIdSchema` refuses it before the handler runs; 400 is one of the
    // four statuses the route declares, so this is a declared outcome and not a
    // leak of an undeclared one.
    expect(response.status).toBe(400);
  });

  it("refuses an unauthenticated request with 401", async () => {
    const thread = await threadWithForm();

    const response = await ws.server.app.request(formPath(thread.id, thread.formTs), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ option: OPTIONS[0] }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(turnsOf(ws, thread.id)).toHaveLength(2);
  });
});

describe("the `form.respond` event (SPEC.md §7)", () => {
  it("enqueues exactly one event, of the pinned type, with no `comment.created` beside it", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(thread, { option: OPTIONS[0], note: "because rates rose" });
    const eventId = ((await response.json()) as { eventId: string | null }).eventId;

    const event = onlyAddedEvent(thread);
    expect(event["type"]).toBe(FORM_RESPOND_EVENT_TYPE);
    expect(event["type"]).not.toBe("comment.created");
    // The response names the event that was actually written.
    expect(event["id"]).toBe(eventId);
  });

  it("writes the payload the contract pins, with the form's own `ts`", async () => {
    const thread = await threadWithForm();
    const response = await answerForm(thread, { option: OPTIONS[1], note: "cheaper for now" });
    const turn = ((await response.json()) as { turn: { ts: string } }).turn;

    const payload = FormRespondPayloadSchema.parse(onlyAddedEvent(thread)["payload"]);

    expect(payload).toEqual({
      threadId: thread.id,
      formTs: thread.formTs,
      option: OPTIONS[1],
      note: "cheaper for now",
    });
    // The answered turn, never the answer.
    expect(payload.formTs).not.toBe(turn.ts);
  });

  it("carries `note: null` — present, not omitted — when no note was given", async () => {
    const thread = await threadWithForm();

    await answerForm(thread, { option: OPTIONS[0] });

    const payload = onlyAddedEvent(thread)["payload"] as Record<string, unknown>;
    expect("note" in payload).toBe(true);
    expect(payload["note"]).toBeNull();
    expect(FormRespondPayloadSchema.parse(payload).note).toBeNull();
  });

  it("moves through the queue's own lifecycle like any other event", async () => {
    const thread = await threadWithForm();
    await answerForm(thread, { option: OPTIONS[0] });

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

    const response = await answerForm(thread, { option: OPTIONS[0], note: "for the record" });
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

  it("keeps a resolved thread closed when the agent answers its own form", async () => {
    const thread = await threadWithForm();
    expect((await ws.post(`/api/threads/${thread.id}/resolve`, {})).status).toBe(200);

    const response = await answerForm(
      thread,
      { option: OPTIONS[0] },
      { "x-corpus-author": "agent" },
    );

    expect(response.status).toBe(201);
    expect(((await response.json()) as { eventId: string | null }).eventId).toBeNull();
    expect(addedEvents(thread)).toEqual([]);
    expect(threadFrontmatterOf(ws, thread.id)["status"]).toBe("resolved");
    expect(ws.log("%s")[0]).toBe(formCommitSubject(thread.id, "agent"));
  });

  it("enqueues nothing when the agent is not engaged in the thread", async () => {
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const created = await createThread(ws, { parent, body: "a private note" });
    const posted = await appendTurn(ws, created.id, { body: formTurn() }, "agent");
    expect(threadFrontmatterOf(ws, created.id)["agent"]).toBe("none");
    const before = pendingEvents(ws);

    const response = await answerForm(
      { id: created.id, formTs: posted.ts },
      { option: OPTIONS[0] },
    );

    expect(response.status).toBe(201);
    expect(((await response.json()) as { eventId: string | null }).eventId).toBeNull();
    expect(addedEvents({ before })).toEqual([]);
  });

  it("enqueues nothing when the agent answers its own form", async () => {
    const thread = await threadWithForm();

    const response = await answerForm(
      thread,
      { option: OPTIONS[0] },
      { "x-corpus-author": "agent" },
    );

    expect(response.status).toBe(201);
    expect(((await response.json()) as { eventId: string | null }).eventId).toBeNull();
    expect(addedEvents(thread)).toEqual([]);
  });
});

describe("the answer is a mutation like any other", () => {
  it("carries §14's `commit_failed` and leaves the turn standing", async () => {
    const thread = await threadWithForm();
    const before = ws.log("%H").length;
    refuseCommits();

    const response = await answerForm(thread, { option: OPTIONS[0] });
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
      await answerForm(thread, { option: OPTIONS[0], note: "a private note" });
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
    const thread = await threadWithForm();
    const idsFor = async (needs: string): Promise<string[]> => {
      const response = await ws.request(`/api/docs?needs=${needs}`);
      const payload = (await response.json()) as { items: { id: string }[] };
      return payload.items.map((item) => item.id);
    };

    expect(await idsFor("form")).toContain(thread.id);
    expect(await idsFor("me")).toContain(thread.id);

    expect((await answerForm(thread, { option: OPTIONS[0] })).status).toBe(201);

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
  // that has to survive whatever CONTRACT-014 does to the grammar next.
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
    const thread = await threadWithForm(turnBody);

    const listed = (await listedByNeedsForm()).has(thread.id);
    const response = await answerForm(thread, { option: OPTION });
    const answerable = response.status === 201;

    expect([listed, answerable]).toEqual([expected, expected]);
  });

  it("drops out of needs=form once the form is answered", async () => {
    // The reason has to be clearable: answering moves `last_author` to `user`,
    // which is the whole of the mechanism (SERVER-016).
    const thread = await threadWithForm();
    expect((await listedByNeedsForm()).has(thread.id)).toBe(true);

    expect((await answerForm(thread, { option: OPTIONS[0] })).status).toBe(201);

    expect((await listedByNeedsForm()).has(thread.id)).toBe(false);
  });
});

describe("the answer turn's body", () => {
  it("renders the option alone, or the option then the note", () => {
    expect(formAnswerBody({ option: "Yes" })).toBe(`${FORM_ANSWER_LABEL} Yes`);
    expect(formAnswerBody({ option: "Yes", note: "with caveats" })).toBe(
      `${FORM_ANSWER_LABEL} Yes\n\nwith caveats`,
    );
  });
});
