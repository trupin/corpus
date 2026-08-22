// Attachment ingest against the real app, the real filesystem and a real git
// repository (SPEC.md §6): what lands on disk, what lands in the commit, what
// the deletion cascade takes with it, and what an aborted write leaves behind.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WriteWorkspace } from "../docs/write-fixture.js";
import { UNTITLED_THREAD } from "../threads/index.js";
import {
  AUTH,
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  pendingEvents,
  postForm,
  threadFrontmatterOf,
  threadPath,
  turnsOf,
  withBrokenQueue,
} from "../threads/thread-fixture.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("ingest");
});

afterEach(() => {
  ws.close();
});

const attachmentsDir = (...parts: string[]): string =>
  join(ws.root, ".corpus", "attachments", ...parts);

const listTurnFiles = (thread: string, ts: string): string[] => {
  try {
    return readdirSync(attachmentsDir(thread, ts)).sort();
  } catch {
    return [];
  }
};

interface Uploaded {
  readonly thread: string;
  readonly ts: string;
  readonly turnBody: string;
  readonly status: number;
  readonly payload: Record<string, unknown>;
}

/** Appends one multipart turn to a fresh thread. */
async function uploadTurn(
  parts: readonly (readonly [string, string | Blob])[],
  thread?: string,
): Promise<Uploaded> {
  const id = thread ?? (await createThread(ws, { body: "first" })).id;
  const response = await postForm(ws, `/api/threads/${id}/turns`, parts);
  const payload = (await response.json()) as Record<string, unknown>;
  const turn = payload["turn"] as { ts: string; body: string } | undefined;
  return {
    thread: id,
    ts: turn?.ts ?? "",
    turnBody: turn?.body ?? "",
    status: response.status,
    payload,
  };
}

const png = (name = "shot.png", body = "png-bytes"): File =>
  new File([body], name, { type: "image/png" });
const pdf = (name = "notes.pdf", body = "pdf-bytes"): File =>
  new File([body], name, { type: "application/pdf" });

describe("ingest on turn append", () => {
  it("stores both files and references both, in upload order", async () => {
    const before = ws.log("%H").length;
    const { thread, ts, turnBody, status } = await uploadTurn([
      ["text", "see attached"],
      ["files", png()],
      ["files", pdf()],
    ]);

    expect(status).toBe(201);
    expect(listTurnFiles(thread, ts)).toEqual(["notes.pdf", "shot.png"]);
    expect(readFileSync(attachmentsDir(thread, ts, "shot.png"), "utf8")).toBe("png-bytes");
    expect(readFileSync(attachmentsDir(thread, ts, "notes.pdf"), "utf8")).toBe("pdf-bytes");

    const encoded = encodeURIComponent(ts);
    expect(turnBody).toBe(
      `see attached\n\n![shot.png](attachments/${thread}/${encoded}/shot.png)\n` +
        `[notes.pdf](attachments/${thread}/${encoded}/notes.pdf)`,
    );
    expect(ws.read(threadPath(thread))).toContain(turnBody);
    // A different actor is not involved, so this is one new commit, not two.
    expect(ws.log("%H").length).toBeGreaterThan(before);
  });

  it("decides image-ness by extension, never by the client's declared type", async () => {
    const { thread, ts, turnBody } = await uploadTurn([
      ["text", "mislabelled"],
      ["files", new File(["png"], "shot.png", { type: "application/octet-stream" })],
      ["files", new File(["pdf"], "notes.pdf", { type: "image/png" })],
    ]);
    const encoded = encodeURIComponent(ts);
    expect(turnBody).toContain(`![shot.png](attachments/${thread}/${encoded}/shot.png)`);
    expect(turnBody).toContain(`[notes.pdf](attachments/${thread}/${encoded}/notes.pdf)`);
    expect(turnBody).not.toContain("![notes.pdf]");
  });

  it("accepts an attachment-only turn whose body is exactly the reference", async () => {
    const { thread, ts, turnBody, status } = await uploadTurn([["files", png()]]);
    expect(status).toBe(201);
    expect(turnBody).toBe(`![shot.png](attachments/${thread}/${encodeURIComponent(ts)}/shot.png)`);
    expect(turnBody.startsWith("\n")).toBe(false);
    expect(existsSync(attachmentsDir(thread, ts, "shot.png"))).toBe(true);
  });

  it("refuses a turn with neither text nor files, writing nothing", async () => {
    const created = await createThread(ws, { body: "first" });
    const before = ws.log("%H").length;
    const response = await postForm(ws, `/api/threads/${created.id}/turns`, []);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(existsSync(attachmentsDir(created.id))).toBe(false);
    expect(ws.log("%H")).toHaveLength(before);
  });

  it("creates no attachment directory for a JSON turn or a fileless multipart one", async () => {
    const created = await createThread(ws, { body: "first" });
    const json = await appendTurn(ws, created.id, { body: "plain" });
    expect(json.status).toBe(201);
    expect((json.body["turn"] as { body: string }).body).toBe("plain");
    expect(existsSync(attachmentsDir(created.id))).toBe(false);

    const form = await uploadTurn([["text", "plain"]], created.id);
    expect(form.turnBody).toBe("plain");
    expect(existsSync(attachmentsDir(created.id))).toBe(false);
  });

  it("names the directory with the turn ts verbatim, colons included", async () => {
    const { thread, ts } = await uploadTurn([["files", png()]]);
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(readdirSync(attachmentsDir(thread))).toEqual([ts]);
    expect(ts).toContain(":");
  });

  it("stores a zero-byte file and still references it", async () => {
    const { thread, ts, turnBody } = await uploadTurn([["files", new File([], "empty.txt")]]);
    expect(readFileSync(attachmentsDir(thread, ts, "empty.txt"), "utf8")).toBe("");
    expect(turnBody).toContain("[empty.txt](");
  });

  it("gives two turns of one thread separate directories", async () => {
    const first = await uploadTurn([["files", png("shot.png", "one")]]);
    ws.advance(2000);
    const second = await uploadTurn([["files", png("shot.png", "two")]], first.thread);

    expect(second.ts).not.toBe(first.ts);
    expect(readdirSync(attachmentsDir(first.thread)).sort()).toEqual([first.ts, second.ts].sort());
    expect(readFileSync(attachmentsDir(first.thread, first.ts, "shot.png"), "utf8")).toBe("one");
    expect(readFileSync(attachmentsDir(second.thread, second.ts, "shot.png"), "utf8")).toBe("two");
  });

  it("leaves the §8 enqueue rules exactly as they were", async () => {
    const created = await createThread(ws, { body: "first", requestsAgent: true });
    await appendTurn(ws, created.id, { body: "looked" }, "agent");

    const omitted = await uploadTurn([["files", png()]], created.id);
    expect(omitted.payload["eventId"]).toMatch(/^evt_/);

    const noteOnly = await uploadTurn(
      [
        ["requestsAgent", "false"],
        ["files", png()],
      ],
      created.id,
    );
    expect(noteOnly.payload["eventId"]).toBeNull();

    const plain = await createThread(ws, { body: "quiet" });
    const requested = await uploadTurn(
      [
        ["requestsAgent", "true"],
        ["files", png()],
      ],
      plain.id,
    );
    expect(requested.payload["eventId"]).toMatch(/^evt_/);
  });

  it("never routes on the server's own reference block", async () => {
    const created = await createThread(ws, { body: "quiet" });
    const before = pendingEvents(ws).length;
    const { payload } = await uploadTurn([["files", png("comment.png")]], created.id);
    expect(payload["eventId"]).toBeNull();
    expect(pendingEvents(ws)).toHaveLength(before);
  });
});

describe("sanitization, end to end", () => {
  it("stores every hostile name safely under the turn's own directory", async () => {
    const names = [
      "../../etc/passwd",
      "a/b/c.png",
      "  .hidden",
      ".....",
      `${"L".repeat(300)}.png`,
      "my shot.png",
      "a#b.png",
      "q?x.png",
      "café.png",
    ];
    const { thread, ts, turnBody } = await uploadTurn([
      ["text", "a hostile batch"],
      ...names.map((name) => ["files", new File([name], name)] as const),
    ]);

    const stored = listTurnFiles(thread, ts);
    expect(stored).toHaveLength(names.length);
    for (const name of stored) {
      expect(name).not.toMatch(/[/\\]/);
      expect(name.startsWith(".")).toBe(false);
      expect(name.length).toBeLessThanOrEqual(100);
      expect([".", ".."]).not.toContain(name);
    }
    expect(stored).toContain("passwd");
    expect(stored).toContain("c.png");
    expect(stored).toContain("hidden");
    expect(stored).toContain("file");
    expect(stored).toContain("my-shot.png");
    expect(stored).toContain("café.png");
    // Nothing was created anywhere but this one directory.
    expect(readdirSync(attachmentsDir())).toEqual([thread]);
    expect(readdirSync(attachmentsDir(thread))).toEqual([ts]);
    // Every reference resolves to a file that exists.
    for (const target of [...turnBody.matchAll(/\]\(attachments\/([^)]+)\)/g)]) {
      const segments = (target[1] ?? "").split("/").map((part) => decodeURIComponent(part));
      expect(existsSync(attachmentsDir(...segments))).toBe(true);
    }
  });

  it("truncates a long name but keeps it an image", async () => {
    const { thread, ts, turnBody } = await uploadTurn([
      ["files", new File(["x"], `${"L".repeat(300)}.png`)],
    ]);
    const [stored] = listTurnFiles(thread, ts);
    expect(stored?.length).toBeLessThanOrEqual(100);
    expect(stored?.endsWith(".png")).toBe(true);
    expect(turnBody.startsWith("![")).toBe(true);
  });

  it("suffixes three identical names and keeps each file's own bytes", async () => {
    const { thread, ts, turnBody } = await uploadTurn([
      ["files", png("shot.png", "one")],
      ["files", png("shot.png", "two")],
      ["files", png("shot.png", "three")],
    ]);

    expect(listTurnFiles(thread, ts)).toEqual(["shot-2.png", "shot-3.png", "shot.png"]);
    expect(readFileSync(attachmentsDir(thread, ts, "shot.png"), "utf8")).toBe("one");
    expect(readFileSync(attachmentsDir(thread, ts, "shot-2.png"), "utf8")).toBe("two");
    expect(readFileSync(attachmentsDir(thread, ts, "shot-3.png"), "utf8")).toBe("three");

    const references = [...turnBody.matchAll(/\]\(attachments\/[^)]+\/([^/)]+)\)/g)].map(
      (match) => match[1],
    );
    expect(references).toEqual(["shot.png", "shot-2.png", "shot-3.png"]);
  });

  it("suffixes two names that both collapse to the fallback", async () => {
    const { thread, ts } = await uploadTurn([
      ["files", new File(["a"], "...")],
      ["files", new File(["b"], "///")],
    ]);
    expect(listTurnFiles(thread, ts)).toEqual(["file", "file-2"]);
  });

  it("lets two turns hold identically named files with no suffix", async () => {
    const first = await uploadTurn([["files", png("shot.png", "one")]]);
    ws.advance(2000);
    const second = await uploadTurn([["files", png("shot.png", "two")]], first.thread);
    expect(listTurnFiles(first.thread, first.ts)).toEqual(["shot.png"]);
    expect(listTurnFiles(second.thread, second.ts)).toEqual(["shot.png"]);
  });

  it("makes every committed reference resolve over HTTP", async () => {
    const { thread, ts, turnBody } = await uploadTurn([
      ["text", "many"],
      ["files", png("shot.png", "one")],
      ["files", png("shot.png", "two")],
      ["files", new File(["c"], "my shot.png")],
      ["files", new File(["d"], "café.png")],
    ]);
    expect(listTurnFiles(thread, ts)).toHaveLength(4);

    for (const match of turnBody.matchAll(/\]\((attachments\/[^)]+)\)/g)) {
      const response = await ws.server.app.request(`/${match[1] ?? ""}`, { headers: AUTH });
      expect(response.status).toBe(200);
      expect((await response.text()).length).toBeGreaterThan(0);
    }
  });
});

describe("ingest on thread creation (SPEC.md §8 — Ask with attachments)", () => {
  /** Creates a thread through the multipart branch and reads back its first turn. */
  async function uploadThread(
    parts: readonly (readonly [string, string | Blob])[],
  ): Promise<{ id: string; ts: string; body: string; status: number }> {
    const response = await postForm(ws, "/api/threads", parts);
    const payload = (await response.json()) as { thread?: { id: string } };
    const id = payload.thread?.id ?? "";
    const turn = id === "" ? undefined : turnsOf(ws, id)[0];
    return { id, ts: turn?.ts ?? "", body: turn?.body ?? "", status: response.status };
  }

  it("stores both files and references both from the first turn, in upload order", async () => {
    const before = ws.log("%H").length;

    const { id, ts, body, status } = await uploadThread([
      ["text", "why 6.1%?"],
      ["files", png()],
      ["files", pdf()],
    ]);

    expect(status).toBe(201);
    expect(listTurnFiles(id, ts)).toEqual(["notes.pdf", "shot.png"]);
    const encoded = encodeURIComponent(ts);
    expect(body).toBe(
      `why 6.1%?\n\n![shot.png](attachments/${id}/${encoded}/shot.png)\n` +
        `[notes.pdf](attachments/${id}/${encoded}/notes.pdf)`,
    );
    // Bytes before markdown, and the markdown in exactly one commit — the same
    // pipeline the JSON branch uses, so the count is the JSON branch's count.
    expect(ws.log("%H")).toHaveLength(before + 1);
    // The bytes live under `.corpus/`, which is gitignored: the commit carries
    // the reference, never the file.
    expect(ws.git("show", "--name-only", "--format=", "HEAD")).not.toContain("attachments");
  });

  it("accepts an attachment-only first turn, and titles it rather than quoting a URL", async () => {
    const { id, ts, body, status } = await uploadThread([["files", png()]]);

    expect(status).toBe(201);
    expect(body).toBe(`![shot.png](attachments/${id}/${encodeURIComponent(ts)}/shot.png)`);
    expect(body.startsWith("\n")).toBe(false);
    expect(readFileSync(attachmentsDir(id, ts, "shot.png"), "utf8")).toBe("png-bytes");
    // The title is derived from the author's own text, which there is none of —
    // never from the reference block, or the board would show a URL.
    expect(threadFrontmatterOf(ws, id)["title"]).toBe(UNTITLED_THREAD);
  });

  it("lets an explicit title name an attachment-only thread", async () => {
    const { id } = await uploadThread([
      ["title", "The failing screenshot"],
      ["files", png()],
    ]);
    expect(threadFrontmatterOf(ws, id)["title"]).toBe("The failing screenshot");
  });

  it("names the first turn's directory with its ts verbatim, and serves every reference", async () => {
    const { id, ts, body } = await uploadThread([
      ["text", "look"],
      ["files", png("shot.png", "one")],
      ["files", new File(["c"], "my shot.png")],
      ["files", new File(["d"], "café.png")],
    ]);

    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(readdirSync(attachmentsDir(id))).toEqual([ts]);
    for (const match of body.matchAll(/\]\((attachments\/[^)]+)\)/g)) {
      const response = await ws.server.app.request(`/${match[1] ?? ""}`, { headers: AUTH });
      expect(response.status).toBe(200);
      expect((await response.text()).length).toBeGreaterThan(0);
    }
  });

  it("gives the first turn and a later one separate directories", async () => {
    const first = await uploadThread([["files", png("shot.png", "one")]]);
    ws.advance(2000);
    const response = await postForm(ws, `/api/threads/${first.id}/turns`, [
      ["files", png("shot.png", "two")],
    ]);
    const second = ((await response.json()) as { turn: { ts: string } }).turn.ts;

    expect(second).not.toBe(first.ts);
    expect(readdirSync(attachmentsDir(first.id)).sort()).toEqual([first.ts, second].sort());
    expect(readFileSync(attachmentsDir(first.id, first.ts, "shot.png"), "utf8")).toBe("one");
    expect(readFileSync(attachmentsDir(first.id, second, "shot.png"), "utf8")).toBe("two");
  });

  it("creates no attachment directory for a JSON creation or a fileless multipart one", async () => {
    const json = await createThread(ws, { body: "plain" });
    expect(existsSync(attachmentsDir(json.id))).toBe(false);

    const form = await uploadThread([["text", "plain"]]);
    expect(form.body).toBe("plain");
    expect(existsSync(attachmentsDir(form.id))).toBe(false);
  });

  it("keeps the bytes when the enqueue fails after the commit (SERVER-021)", async () => {
    const response = await withBrokenQueue(ws, () =>
      postForm(ws, "/api/threads", [
        ["text", "@agent look at this"],
        ["requestsAgent", "true"],
        ["files", png()],
      ]),
    );

    expect(response.status).toBe(500);
    // The thread is committed, so the reference it quotes must still resolve:
    // deleting the bytes here is the one state §6 rules out.
    const id = readdirSync(join(ws.root, ".corpus", "attachments"))[0] ?? "";
    expect(id).toMatch(/^th_/);
    const ts = readdirSync(attachmentsDir(id))[0] ?? "";
    expect(readFileSync(attachmentsDir(id, ts, "shot.png"), "utf8")).toBe("png-bytes");
    expect(ws.git("show", `HEAD:${threadPath(id)}`)).toContain("shot.png");
  });

  it("refuses an over-cap upload with 413, on both the declared and the parsed path", async () => {
    ws.close();
    ws = createThreadWorkspace("create-limits", {
      attachments: { maxFileBytes: 64, maxRequestBytes: 64 },
    });
    const before = ws.log("%H").length;

    // Post-parse: the sizes actually received.
    const parsed = await postForm(ws, "/api/threads", [
      ["text", "too big"],
      ["files", new File([new Uint8Array(65)], "huge.png")],
    ]);
    expect(parsed.status).toBe(413);
    expect(((await parsed.json()) as { message: string }).message).toContain("huge.png");

    // Pre-parse: the declared Content-Length, refused before the body is read.
    const declared = await ws.server.app.request("/api/threads", {
      method: "POST",
      headers: {
        ...AUTH,
        "content-type": "multipart/form-data; boundary=x",
        "content-length": "1048576",
      },
      body: "--x--\r\n",
    });
    expect(declared.status).toBe(413);
    expect(((await declared.json()) as { code: string }).code).toBe("bad_request");

    // Neither wrote a thread, a byte or a commit.
    expect(readdirSync(join(ws.root, "data", "threads"))).toEqual([]);
    expect(existsSync(join(ws.root, ".corpus", "attachments"))).toBe(false);
    expect(ws.log("%H")).toHaveLength(before);
  });
});

describe("ingest on capture", () => {
  it("lands the bytes on the filing thread's first turn", async () => {
    const response = await postForm(ws, "/api/capture", [
      ["text", "screenshot of the error"],
      ["files", png()],
    ]);
    const payload = (await response.json()) as { docId: string; threadId: string };
    expect(response.status).toBe(201);

    const turn = turnsOf(ws, payload.threadId)[0];
    expect(turn).toBeDefined();
    expect(readFileSync(attachmentsDir(payload.threadId, turn?.ts ?? "", "shot.png"), "utf8")).toBe(
      "png-bytes",
    );
    expect(turn?.body).toContain(
      `![shot.png](attachments/${payload.threadId}/${encodeURIComponent(turn?.ts ?? "")}/shot.png)`,
    );

    const docFile = readdirSync(join(ws.root, "data", "docs", "inbox"))[0] ?? "";
    expect(ws.read(`data/docs/inbox/${docFile}`)).not.toContain("attachments/");
    expect(pendingEvents(ws)).toHaveLength(1);
  });
});

describe("limits", () => {
  it("refuses an over-cap file and leaves nothing behind", async () => {
    ws.close();
    ws = createThreadWorkspace("limits", {
      attachments: { maxFileBytes: 64, maxRequestBytes: 1024 },
    });

    const created = await createThread(ws, { body: "first" });
    const before = { commits: ws.log("%H").length, file: ws.read(threadPath(created.id)) };
    const response = await postForm(ws, `/api/threads/${created.id}/turns`, [
      ["text", "too big"],
      ["files", new File([new Uint8Array(65)], "huge.png")],
    ]);
    const payload = (await response.json()) as { message: string; issues: { message: string }[] };

    expect(response.status).toBe(413);
    expect(payload.message).toContain("huge.png");
    expect(payload.message).toContain("64 bytes");
    expect(existsSync(attachmentsDir(created.id))).toBe(false);
    expect(ws.read(threadPath(created.id))).toBe(before.file);
    expect(ws.log("%H")).toHaveLength(before.commits);
  });

  it("refuses an over-cap request total made of legal files", async () => {
    ws.close();
    ws = createThreadWorkspace("limits-total", {
      attachments: { maxFileBytes: 64, maxRequestBytes: 100 },
    });

    const created = await createThread(ws, { body: "first" });
    const response = await postForm(ws, `/api/threads/${created.id}/turns`, [
      ["files", new File([new Uint8Array(60)], "a.png")],
      ["files", new File([new Uint8Array(60)], "b.png")],
    ]);

    expect(response.status).toBe(413);
    expect(((await response.json()) as { message: string }).message).toContain("per-request limit");
    expect(existsSync(attachmentsDir(created.id))).toBe(false);
  });

  it("reads the cap from configuration, not from a constant", async () => {
    const generous = await uploadTurn([["files", new File([new Uint8Array(4096)], "big.png")]]);
    expect(generous.status).toBe(201);

    ws.close();
    ws = createThreadWorkspace("limits-config", {
      attachments: { maxFileBytes: 128, maxRequestBytes: 128 },
    });
    const strict = await uploadTurn([["files", new File([new Uint8Array(4096)], "big.png")]]);
    expect(strict.status).toBe(413);
    expect(JSON.stringify(strict.payload)).toContain("128 bytes");
  });

  it("refuses a declared Content-Length over the cap before reading the body", async () => {
    ws.close();
    ws = createThreadWorkspace("limits-declared", {
      attachments: { maxFileBytes: 8, maxRequestBytes: 8 },
    });
    const created = await createThread(ws, { body: "first" });

    // A body the handler must never buffer: the guard answers from the header.
    const response = await ws.server.app.request(`/api/threads/${created.id}/turns`, {
      method: "POST",
      headers: {
        ...AUTH,
        "content-type": "multipart/form-data; boundary=x",
        "content-length": "1048576",
      },
      body: "--x--\r\n",
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { message: string }).message).toContain("per-request limit");
  });
});

describe("git hygiene", () => {
  it("keeps the working tree clean and the commit free of bytes", async () => {
    expect(ws.git("status", "--porcelain")).toBe("");
    const canary = `CORPUS-ATTACHMENT-CANARY-${Math.random().toString(36).slice(2)}`;

    const first = await uploadTurn([
      ["text", "one"],
      ["files", new File([canary], "canary.txt")],
    ]);
    ws.advance(2000);
    await uploadTurn(
      [
        ["text", "two"],
        ["files", png()],
      ],
      first.thread,
    );
    ws.advance(2000);
    await uploadTurn(
      [
        ["text", "three"],
        ["files", pdf()],
      ],
      first.thread,
    );

    expect(ws.git("status", "--porcelain")).toBe("");

    const stat = ws.git("show", "--stat", "--name-only", "--format=", "HEAD").trim();
    expect(stat).toBe(`data/threads/${first.thread}.md`);

    // The reference is in history; the bytes are not.
    const objects = ws.git("rev-list", "--objects", "--all");
    expect(objects).not.toContain(canary);
    expect(ws.git("log", "-p", "--all")).not.toContain(canary);
    expect(ws.git("log", "-p", "--all")).toContain("canary.txt](attachments/");
    expect(readFileSync(attachmentsDir(first.thread, first.ts, "canary.txt"), "utf8")).toBe(canary);
  });

  it("gives two turns inside the idle window a commit each, and neither one the bytes", async () => {
    // This asserted that two turns squash into one commit, which was true while
    // §4's first closer read "an **agent** turn posted to a thread". The user
    // struck the word on 2026-08-10 (SHARED-040 held item (c)): a turn by either
    // party is an act, and an act closes the window it lands in. So two turns are
    // two acts and two commits — the expectation is rewritten rather than
    // relaxed, and what this file is actually about (attachment bytes never
    // reaching git) is asserted at both.
    const first = await uploadTurn([
      ["text", "one"],
      ["files", png("a.png")],
    ]);
    const before = ws.log("%H").length;
    ws.advance(1000);
    const second = await uploadTurn(
      [
        ["text", "two"],
        ["files", png("b.png")],
      ],
      first.thread,
    );

    expect(ws.log("%H")).toHaveLength(before + 1);
    const text = ws.git("show", "HEAD:" + threadPath(first.thread));
    expect(text).toContain("a.png](attachments/");
    expect(text).toContain("b.png](attachments/");
    expect(ws.git("log", "-p", "--all")).not.toContain("png-bytes");
    expect(second.status).toBe(201);
  });
});

describe("atomicity", () => {
  /**
   * The stamp the next turn will take, once the clock has been moved past every
   * stamp already in the thread. Deterministic because the fixture's clock is
   * injected, which is what lets a fault be planted at the exact path the write
   * is about to use.
   */
  function nextStamp(): string {
    ws.advance(60_000);
    return new Date(ws.clock).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  it("leaves no partial directory when a later file cannot be written", async () => {
    const created = await createThread(ws, { body: "first" });
    const before = ws.read(threadPath(created.id));
    const commits = ws.log("%H").length;

    // A *directory* where the second file's bytes have to go: the write fails
    // with EISDIR — a real filesystem failure, not a stubbed one.
    const ts = nextStamp();
    mkdirSync(attachmentsDir(created.id, ts, "second.png"), { recursive: true });

    const response = await postForm(ws, `/api/threads/${created.id}/turns`, [
      ["text", "three files"],
      ["files", png("first.png")],
      ["files", png("second.png")],
      ["files", png("third.png")],
    ]);

    expect(response.status).toBe(500);
    expect(existsSync(attachmentsDir(created.id, ts))).toBe(false);
    expect(existsSync(attachmentsDir(created.id, ts, "first.png"))).toBe(false);
    expect(ws.read(threadPath(created.id))).toBe(before);
    expect(ws.log("%H")).toHaveLength(commits);
  });

  it("removes the bytes when the write is refused after they land", async () => {
    const created = await createThread(ws, { body: "first" });
    // Two turns sharing a timestamp: §11's `duplicate-turn-timestamp` is a hard
    // error, so `validateBeforeWrite` refuses the append — which happens *after*
    // the bytes are on disk, exactly the window the cleanup exists for.
    const clash = "2026-07-27T08:00:00Z";
    ws.write(
      threadPath(created.id),
      `---\nid: ${created.id}\ntype: thread\ntitle: Clash\ncreated: ${clash}\n` +
        `updated: ${clash}\nparent: null\nanchor: null\nagent: none\nstatus: open\ntags: []\n---\n` +
        `## user ${String.fromCharCode(0xb7)} ${clash}\none\n\n` +
        `## user ${String.fromCharCode(0xb7)} ${clash}\ntwo\n`,
    );
    ws.reproject();
    const before = ws.read(threadPath(created.id));
    const commits = ws.log("%H").length;

    const response = await postForm(ws, `/api/threads/${created.id}/turns`, [
      ["text", "with a file"],
      ["files", png()],
    ]);

    expect(response.status).toBe(400);
    // Nothing under the thread survives: the turn directory went, and pruning
    // took the empty thread directory with it.
    expect(existsSync(attachmentsDir(created.id))).toBe(false);
    expect(ws.read(threadPath(created.id))).toBe(before);
    expect(ws.log("%H")).toHaveLength(commits);
  });
});

describe("the deletion cascade", () => {
  /** A thread with three attachment-bearing turns. */
  async function threeTurns(): Promise<{ id: string; stamps: string[] }> {
    const first = await uploadTurn([
      ["text", "one"],
      ["files", png("one.png", "1")],
    ]);
    ws.advance(2000);
    const second = await uploadTurn(
      [
        ["text", "two"],
        ["files", png("two.png", "2")],
      ],
      first.thread,
    );
    ws.advance(2000);
    const third = await uploadTurn(
      [
        ["text", "three"],
        ["files", png("three.png", "3")],
      ],
      first.thread,
    );
    return { id: first.thread, stamps: [first.ts, second.ts, third.ts] };
  }

  it("removes only the deleted turn's directory", async () => {
    const { id, stamps } = await threeTurns();
    const [first, middle, last] = stamps;

    const response = await ws.del(`/api/threads/${id}/turns/${encodeURIComponent(middle ?? "")}`);
    expect(response.status).toBe(200);

    expect(existsSync(attachmentsDir(id, middle ?? ""))).toBe(false);
    expect(readFileSync(attachmentsDir(id, first ?? "", "one.png"), "utf8")).toBe("1");
    expect(readFileSync(attachmentsDir(id, last ?? "", "three.png"), "utf8")).toBe("3");
    expect(ws.read(threadPath(id))).not.toContain("two.png");
  });

  it("removes the whole tree when the thread is deleted", async () => {
    const { id } = await threeTurns();
    const sibling = await uploadTurn([["files", png("other.png")]]);

    expect((await ws.del(`/api/docs/${id}`)).status).toBe(200);
    expect(existsSync(attachmentsDir(id))).toBe(false);
    expect(existsSync(attachmentsDir(sibling.thread, sibling.ts, "other.png"))).toBe(true);
  });

  it("cleans up when the last turn's deletion cascades into the thread", async () => {
    const parent = await createDoc(ws, {
      type: "note",
      title: "Parent",
      body: "Some text here.\n",
    });
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "Some text" },
      body: "look",
    });
    ws.advance(2000);
    const { ts } = await uploadTurn([["files", png()]], created.id);
    // Remove the original turn first, so the attachment turn is the last one.
    const turns = turnsOf(ws, created.id);
    expect(turns).toHaveLength(2);
    expect(
      (await ws.del(`/api/threads/${created.id}/turns/${encodeURIComponent(turns[0]?.ts ?? "")}`))
        .status,
    ).toBe(200);

    const response = await ws.del(`/api/threads/${created.id}/turns/${encodeURIComponent(ts)}`);
    const payload = (await response.json()) as { deletedThread: boolean; removedAnchor: unknown };
    expect(response.status).toBe(200);
    expect(payload.deletedThread).toBe(true);
    expect(payload.removedAnchor).not.toBeNull();
    expect(existsSync(attachmentsDir(created.id))).toBe(false);
  });

  it("deletes a thread with no attachments at all without error", async () => {
    const created = await createThread(ws, { body: "no files here" });
    expect(existsSync(attachmentsDir(created.id))).toBe(false);
    expect((await ws.del(`/api/docs/${created.id}`)).status).toBe(200);
    expect(existsSync(attachmentsDir(created.id))).toBe(false);
  });

  it("keeps the bytes when the commit fails but the file mutation stands (§11)", async () => {
    const { thread, ts } = await uploadTurn([["files", png()]]);
    // A pre-commit hook that always refuses: §11 says the deletion still lands
    // on disk and the failure is a warning, so the bytes must go with the turn.
    const hooks = join(ws.root, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });

    const response = await ws.del(`/api/threads/${thread}/turns/${encodeURIComponent(ts)}`);
    expect(response.status).toBe(200);
    // The turn is gone from disk, so its bytes are gone too — the deletion
    // succeeded, only its commit did not.
    expect(existsSync(attachmentsDir(thread, ts))).toBe(false);
  });
});
