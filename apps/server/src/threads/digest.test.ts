// SPEC.md §6's digest rider (signed 2026-09-05), server side: one digest per
// thread, written by its resident and never by the server, watermarked at the
// instant of the write, and marked stale — and only marked stale — when a turn
// it covers is deleted or revised.
//
// Everything here runs against the real app, real files, a real git repository
// and the real projection, for the reason the rest of the thread suites do: what
// this has to be right about — a frontmatter block written and later removed, a
// flag set in the *same* commit as the change that caused it, a body left
// byte-for-byte alone, a row a rebuild reconstructs — is only observable
// against those.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DIGEST_MAX_CHARS } from "@corpus/contract";
import { populateFromFiles } from "../projection/index.js";
import { doctor } from "../projection/doctor.js";
import {
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  threadFrontmatterOf,
  threadPath,
  turnsOf,
  type WriteWorkspace,
} from "./thread-fixture.js";

let ws: WriteWorkspace;

const AGENT = { "x-corpus-author": "agent" };

beforeEach(() => {
  ws = createThreadWorkspace("digest");
});

afterEach(() => {
  ws.close();
});

type Envelope = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

const call = async (response: Response): Promise<Envelope> => ({
  status: response.status,
  body: (await response.json()) as Record<string, unknown>,
});

const putDigest = async (id: string, body: unknown, headers = AGENT): Promise<Envelope> =>
  call(await ws.put(`/api/threads/${id}/digest`, body, headers));

const deleteDigest = async (id: string, headers = AGENT): Promise<Envelope> =>
  call(await ws.del(`/api/threads/${id}/digest`, headers));

const readThread = async (id: string): Promise<Record<string, unknown>> =>
  (await (await ws.request(`/api/threads/${id}`)).json()) as Record<string, unknown>;

const digestOf = async (id: string): Promise<unknown> => (await readThread(id))["digest"];

const contextDigestOf = async (id: string): Promise<unknown> =>
  ((await (await ws.request(`/api/threads/${id}/context`)).json()) as Record<string, unknown>)[
    "digest"
  ];

const digestRow = (id: string): unknown =>
  ws.db
    .prepare("SELECT digest_body, digest_watermark, digest_stale FROM threads WHERE id = ?")
    .get(id);

/**
 * A standalone thread with a designated resident and two turns — the state every
 * write in this file starts from, because a digest needs a resident to be
 * refused for and a turn for its watermark to name.
 *
 * Designation is user-only (§7), so the fixture designates as the person and the
 * digest is written as the agent, which is what actually happens: a resident
 * writes its digest at reply time through the CLI.
 */
async function designatedThread(): Promise<{ id: string; first: string; second: string }> {
  const created = await createThread(ws, { body: "What is the rate?", resident: null });
  const second = await appendTurn(ws, created.id, { body: "Six point one." }, "agent");
  expect(second.status).toBe(201);
  expect((await ws.post(`/api/threads/${created.id}/resident`, {})).status).toBe(200);
  const turns = turnsOf(ws, created.id);
  expect(turns).toHaveLength(2);
  return { id: created.id, first: turns[0]?.ts ?? "", second: second.ts };
}

describe("PUT /api/threads/{id}/digest", () => {
  it("writes the prose, stamps the newest turn's ts as the watermark, and is not stale", async () => {
    const { id, second } = await designatedThread();

    const written = await putDigest(id, { body: "They settled on six point one." });

    expect(written.status).toBe(200);
    expect(written.body).toMatchObject({
      threadId: id,
      digest: { body: "They settled on six point one.", watermark: second, stale: false },
    });
    // The stamp is the server's, and the response carries it so the writer never
    // re-reads the thread to learn what it just wrote.
    expect(await digestOf(id)).toEqual({
      body: "They settled on six point one.",
      watermark: second,
      stale: false,
    });
    expect(threadFrontmatterOf(ws, id)["digest"]).toEqual({
      body: "They settled on six point one.",
      watermark: second,
      stale: false,
    });
  });

  it("stamps the newest turn even when one landed after the writer last read", async () => {
    const { id } = await designatedThread();
    const later = await appendTurn(ws, id, { body: "One more thing." });

    const written = await putDigest(id, { body: "Everything so far." });

    expect(written.body["digest"]).toMatchObject({ watermark: later.ts });
  });

  it("refuses a watermark sent by the writer, by name, before any handler runs", async () => {
    const { id, second } = await designatedThread();

    const refused = await putDigest(id, { body: "prose", watermark: "2020-01-01T00:00:00Z" });

    expect(refused.status).toBe(400);
    expect(await digestOf(id)).toBeNull();
    expect(second).not.toBe("");
  });

  it("refuses a body past the published bound as an ordinary 400 — a shorter one would work", async () => {
    const { id } = await designatedThread();

    expect((await putDigest(id, { body: "x".repeat(DIGEST_MAX_CHARS + 1) })).status).toBe(400);
    expect((await putDigest(id, { body: "x".repeat(DIGEST_MAX_CHARS) })).status).toBe(200);
  });

  it("replaces the digest a thread already had — one per thread, no history here", async () => {
    const { id } = await designatedThread();
    await putDigest(id, { body: "First account." });

    await putDigest(id, { body: "Second account." });

    expect(await digestOf(id)).toMatchObject({ body: "Second account." });
  });

  it("appears in the thread's context pack, whole", async () => {
    const { id, second } = await designatedThread();
    await putDigest(id, { body: "The pack carries this." });

    expect(await contextDigestOf(id)).toEqual({
      body: "The pack carries this.",
      watermark: second,
      stale: false,
    });
  });

  it("commits once, authored by the acting party, naming the act", async () => {
    const { id } = await designatedThread();
    // Past the fold window, so the digest is not amended into the turn before it.
    ws.advance(61_000);
    const before = ws.log("%H").length;

    await putDigest(id, { body: "An account." });

    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.log("%s")[0]).toContain(`digest write:`);
    expect(ws.log("%s")[0]).toContain(`(${id}) by agent`);
    expect(ws.log("%an")[0]).toBe("agent");
  });

  it("keeps its subject when a later act closes the window — it is not an editing session", async () => {
    // Reproduced on a real server before `squash: false` was set: the digest
    // write opened a §4 session window, and the next thing to close it relabelled
    // the commit "editing session: 1 document by agent". A digest is authored
    // work, and *when was this written* has to stay answerable from `git log`.
    const { id, first } = await designatedThread();
    ws.advance(61_000);

    await putDigest(id, { body: "An account." });
    // A deletion is one of §4's acts that commit alone: it closes whatever
    // window is open first, which is exactly the moment the subject was lost.
    await ws.del(`/api/threads/${id}/turns/${first}`);

    expect(
      ws
        .log("%s")
        .some(
          (subject) => subject.startsWith("digest write:") && subject.endsWith(`(${id}) by agent`),
        ),
    ).toBe(true);
  });

  describe("refusals", () => {
    it("404s an unknown thread", async () => {
      expect((await putDigest("th_notreal9999", { body: "prose" })).status).toBe(404);
    });

    it("400s a well-formed id that is not a thread id — the param schema refuses it", async () => {
      const doc = await createDoc(ws, { type: "note", title: "A note", body: "Text.\n" });
      expect((await putDigest(doc.id, { body: "prose" })).status).toBe(400);
    });

    it("404s a `th_` id that names a document which is not a thread", async () => {
      // Only a hand-written file gets here — the create verbs never mint one —
      // and the answer is `GET /api/threads/{id}`'s: there is no thread with
      // that id, which is exactly true of a note.
      ws.write(
        "data/docs/notathread.md",
        "---\nid: th_notathread\ntype: note\ntitle: Not a thread\n---\n\nText.\n",
      );
      ws.reproject();

      expect((await putDigest("th_notathread", { body: "prose" })).status).toBe(404);
      expect((await deleteDigest("th_notathread")).status).toBe(404);
    });

    it("422s `unknown_recipient` on a thread with no resident, and writes nothing", async () => {
      const created = await createThread(ws, { body: "start", resident: null });

      const refused = await putDigest(created.id, { body: "prose" });

      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: "unknown_recipient", recipient: created.id });
      expect(threadFrontmatterOf(ws, created.id)["digest"]).toBeUndefined();
    });

    it.each([
      ["an empty body", ""],
      ["a whitespace-only body", "   \n\t "],
    ])("422s `bad_request` on %s — an empty write is not a clear", async (_label, body) => {
      const { id } = await designatedThread();

      const refused = await putDigest(id, { body });

      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: "bad_request" });
      expect(await digestOf(id)).toBeNull();
    });

    it("422s `bad_request` on a thread with no turns — the watermark points at one", async () => {
      // Only a hand-written file gets here: the create verb always writes a
      // first turn, and deleting a thread's last turn deletes the thread.
      ws.write(
        threadPath("th_noturnsyet"),
        [
          "---",
          "id: th_noturnsyet",
          "type: thread",
          "title: Empty",
          "resident:",
          "  name: null",
          "  docId: null",
          "---",
          "",
          "Nothing said yet.",
          "",
        ].join("\n"),
      );
      ws.reproject();

      const refused = await putDigest("th_noturnsyet", { body: "prose" });

      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: "bad_request" });
      expect(threadFrontmatterOf(ws, "th_noturnsyet")["digest"]).toBeUndefined();
    });

    it("tells the two 422s apart at `code`, which is the only thing a client can branch on", async () => {
      const undesignated = await createThread(ws, { body: "start", resident: null });
      const { id } = await designatedThread();

      expect((await putDigest(undesignated.id, { body: "" })).body["code"]).toBe(
        "unknown_recipient",
      );
      expect((await putDigest(id, { body: "" })).body["code"]).toBe("bad_request");
    });
  });
});

describe("DELETE /api/threads/{id}/digest", () => {
  it("removes the key rather than writing a null, and answers with a null digest", async () => {
    const { id } = await designatedThread();
    await putDigest(id, { body: "An account." });

    const cleared = await deleteDigest(id);

    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ threadId: id, digest: null });
    expect(Object.hasOwn(threadFrontmatterOf(ws, id), "digest")).toBe(false);
    expect(await digestOf(id)).toBeNull();
  });

  it("is idempotent: clearing a thread with no digest writes and commits nothing", async () => {
    const { id } = await designatedThread();
    ws.advance(61_000);
    const before = ws.head();

    const cleared = await deleteDigest(id);

    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ digest: null, warnings: [] });
    expect(ws.head()).toBe(before);
  });

  it("removes a hand-written block that never parsed — otherwise no verb could", async () => {
    const { id } = await designatedThread();
    ws.write(
      threadPath(id),
      ws.read(threadPath(id)).replace("---\n\n##", "digest: not a mapping\n---\n\n##"),
    );
    ws.reproject();
    expect(await digestOf(id)).toBeNull();

    expect((await deleteDigest(id)).status).toBe(200);

    expect(Object.hasOwn(threadFrontmatterOf(ws, id), "digest")).toBe(false);
  });

  it("422s `unknown_recipient` on a thread with no resident, the same fact as the write", async () => {
    const created = await createThread(ws, { body: "start", resident: null });

    const refused = await deleteDigest(created.id);

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: "unknown_recipient", recipient: created.id });
  });

  it("404s an unknown thread", async () => {
    expect((await deleteDigest("th_notreal9999")).status).toBe(404);
  });
});

describe("staleness — a covered turn deleted or revised", () => {
  it("marks the digest stale when a covered turn is deleted, leaving the body alone", async () => {
    const { id, first, second } = await designatedThread();
    await putDigest(id, { body: "They settled on six point one." });

    expect((await ws.del(`/api/threads/${id}/turns/${first}`)).status).toBe(200);

    expect(await digestOf(id)).toEqual({
      // Byte-for-byte the prose its author wrote. Repairing it is the resident's
      // act and never the server's.
      body: "They settled on six point one.",
      // And the coverage claim is untouched too — only the flag moved.
      watermark: second,
      stale: true,
    });
  });

  it("marks it in the *same* write, so no commit says a digest covers a turn it removed", async () => {
    const { id, first } = await designatedThread();
    await putDigest(id, { body: "An account." });
    ws.advance(61_000);
    const before = ws.log("%H").length;

    await ws.del(`/api/threads/${id}/turns/${first}`);

    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.log("%s")[0]).toContain(`delete turn ${first}`);
    expect(threadFrontmatterOf(ws, id)["digest"]).toMatchObject({ stale: true });
  });

  it("changes nothing when the deleted turn is after the watermark", async () => {
    const { id, second } = await designatedThread();
    await putDigest(id, { body: "An account." });
    const later = await appendTurn(ws, id, { body: "One more thing." });

    await ws.del(`/api/threads/${id}/turns/${later.ts}`);

    expect(await digestOf(id)).toEqual({
      body: "An account.",
      watermark: second,
      stale: false,
    });
  });

  it("marks it stale when a whole-body save revises a covered turn in place", async () => {
    const { id, second } = await designatedThread();
    await putDigest(id, { body: "An account." });
    const key = (await readThread(id)) && (await docKeyOf(id));

    const saved = await ws.put(
      `/api/docs/${id}`,
      {
        body: turnsOf(ws, id)
          .map(
            ({ author, ts, body }) =>
              `## ${author} · ${ts}\n\n${ts === second ? "Six point four." : body}\n`,
          )
          .join("\n"),
        key,
      },
      AGENT,
    );

    expect(saved.status).toBe(200);
    expect(await digestOf(id)).toEqual({ body: "An account.", watermark: second, stale: true });
  });

  it("leaves a whole-body save alone when it only appends past the watermark", async () => {
    const { id, second } = await designatedThread();
    await putDigest(id, { body: "An account." });
    const key = await docKeyOf(id);
    const body = `${ws.read(threadPath(id)).split("---\n").slice(2).join("---\n")}\n## user · 2027-01-01T00:00:00Z\n\nMuch later.\n`;

    expect((await ws.put(`/api/docs/${id}`, { body, key }, AGENT)).status).toBe(200);

    expect(await digestOf(id)).toMatchObject({ watermark: second, stale: false });
  });

  it("is cleared by the resident writing the digest again — the only thing that corrects it", async () => {
    const { id, first } = await designatedThread();
    await putDigest(id, { body: "An account." });
    await ws.del(`/api/threads/${id}/turns/${first}`);
    expect(await digestOf(id)).toMatchObject({ stale: true });

    const rewritten = await putDigest(id, { body: "A corrected account." });

    expect(rewritten.body["digest"]).toMatchObject({ body: "A corrected account.", stale: false });
  });
});

describe("the digest outlives the ability to touch it (CONTRACT-096 decision 6)", () => {
  it("is neither rewritable nor removable once resolving released the resident", async () => {
    const { id } = await designatedThread();
    await putDigest(id, { body: "An account." });

    expect((await ws.post(`/api/threads/${id}/resolve`, {})).status).toBe(200);

    expect((await putDigest(id, { body: "Another." })).status).toBe(422);
    expect((await deleteDigest(id)).status).toBe(422);
    // And it stays honest: still readable, and still carrying its coverage.
    expect(await digestOf(id)).toMatchObject({ body: "An account.", stale: false });
  });

  it("still goes stale when a turn it covers is deleted afterwards", async () => {
    const { id, first } = await designatedThread();
    await putDigest(id, { body: "An account." });
    await ws.post(`/api/threads/${id}/resolve`, {});

    await ws.del(`/api/threads/${id}/turns/${first}`);

    expect(await digestOf(id)).toMatchObject({ body: "An account.", stale: true });
  });
});

describe("projection and doctor", () => {
  it("projects the digest with the thread, and a rebuild reconstructs it from the file", async () => {
    const { id, second } = await designatedThread();
    await putDigest(id, { body: "An account." });

    expect(digestRow(id)).toEqual({
      digest_body: "An account.",
      digest_watermark: second,
      digest_stale: 0,
    });

    populateFromFiles(ws.db);

    expect(digestRow(id)).toEqual({
      digest_body: "An account.",
      digest_watermark: second,
      digest_stale: 0,
    });
  });

  it("projects the staleness a turn deletion recorded", async () => {
    const { id, first } = await designatedThread();
    await putDigest(id, { body: "An account." });

    await ws.del(`/api/threads/${id}/turns/${first}`);

    expect(digestRow(id)).toMatchObject({ digest_stale: 1 });
  });

  it("leaves all three columns null for a thread with no digest — one state, not two", async () => {
    const { id } = await designatedThread();
    expect(digestRow(id)).toEqual({
      digest_body: null,
      digest_watermark: null,
      digest_stale: null,
    });
  });

  it("reports a clean projection while digests are present", async () => {
    const { id } = await designatedThread();
    await putDigest(id, { body: "An account." });

    const report = doctor(ws.server.config);

    expect(report.drift).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reports a digest edited on disk behind the projection as drift", async () => {
    const { id } = await designatedThread();
    await putDigest(id, { body: "An account." });
    // The file changes and nothing re-projects: exactly the state doctor exists
    // to find, and the digest is part of the bytes it hashes.
    ws.write(
      threadPath(id),
      ws.read(threadPath(id)).replace("body: An account.", "body: A different account."),
    );

    const report = doctor(ws.server.config);

    expect(report.ok).toBe(false);
    expect(report.drift.map((entry) => entry.kind)).toContain("content_mismatch");
  });
});

/** The key `GET /api/docs/{id}` currently hands out — what a whole-body save presents. */
async function docKeyOf(id: string): Promise<string> {
  const doc = (await (await ws.request(`/api/docs/${id}`)).json()) as { key: string };
  return doc.key;
}
