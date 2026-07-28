// `GET /attachments/...` against the real app: the traversal block, the header
// contract, and the promise that serving changes nothing.
//
// The raw (unencoded) traversal forms are exercised against
// {@link parseAttachmentPath} directly, because `new URL()` — which every
// `Request` goes through — normalises `..` segments and rewrites `\` to `/`
// before a server could ever see them. A raw `../../` over the wire needs
// `curl --path-as-is`, and lives in the issue's E2E log; the decoded forms below
// are the ones a URL parser actually preserves.

import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { AUTH, createThread, createThreadWorkspace, postForm } from "../threads/thread-fixture.js";
import type { WriteWorkspace } from "../docs/write-fixture.js";
import {
  ATTACHMENT_NOT_FOUND_BODY,
  contentDisposition,
  isUnnormalizedAttachmentTarget,
  parseAttachmentPath,
} from "./serve.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("serve");
});

afterEach(() => {
  ws.close();
});

/** One turn carrying `files`, answering with the thread id and the turn's ts. */
async function upload(files: readonly File[]): Promise<{ thread: string; ts: string }> {
  const created = await createThread(ws, { body: "first" });
  const response = await postForm(
    ws,
    `/api/threads/${created.id}/turns`,
    files.map((file) => ["files", file] as const),
  );
  const payload = (await response.json()) as { turn: { ts: string } };
  if (response.status !== 201) throw new Error(`upload failed: ${JSON.stringify(payload)}`);
  return { thread: created.id, ts: payload.turn.ts };
}

/**
 * A request whose body is fully buffered before it is returned.
 *
 * The route streams from an open descriptor, and `app.request` has no socket
 * whose close would tear that stream down — so a test that asserted only on
 * headers would leave a file open for the rest of the run. Draining here keeps
 * every assertion below unchanged and the process able to exit.
 */
const get = async (path: string, headers: Record<string, string> = AUTH): Promise<Response> => {
  const response = await ws.server.app.request(path, { headers });
  const bytes = await response.arrayBuffer();
  return new Response(bytes, { status: response.status, headers: response.headers });
};

const attachmentUrl = (thread: string, ts: string, name: string): string =>
  `/attachments/${thread}/${encodeURIComponent(ts)}/${encodeURIComponent(name)}`;

describe("parseAttachmentPath", () => {
  it("accepts the three-segment layout and decodes each segment exactly once", () => {
    expect(parseAttachmentPath("/attachments/th_a/2026-07-19T10%3A05%3A00Z/shot.png")).toEqual([
      "th_a",
      "2026-07-19T10:05:00Z",
      "shot.png",
    ]);
  });

  it.each([
    ["raw dot-dot", "/attachments/../../../tmp/secret.txt"],
    ["dot-dot inside the layout", "/attachments/th_a/ts/../../th_b/ts/other.png"],
    ["single-encoded traversal", "/attachments/%2e%2e%2f%2e%2e%2fsecret.txt"],
    ["mixed encoded traversal", "/attachments/..%2f..%2fsecret.txt"],
    ["double-encoded traversal", "/attachments/%252e%252e%252fsecret.txt"],
    ["backslash separators", "/attachments/..\\..\\secret.txt"],
    ["encoded backslash", "/attachments/..%5c..%5csecret.txt"],
    ["absolute path", "/attachments//etc/hosts"],
    ["encoded absolute path", "/attachments/%2fetc%2fhosts"],
    ["a NUL byte", "/attachments/th_a/ts/shot.png%00.txt"],
    ["a newline", "/attachments/th_a/ts/shot%0a.png"],
    ["a bare dot segment", "/attachments/th_a/./shot.png"],
    ["too few segments", "/attachments/th_a/ts"],
    ["too many segments", "/attachments/th_a/ts/sub/shot.png"],
    ["no path at all", "/attachments"],
    ["an empty path", "/attachments/"],
    ["a malformed escape", "/attachments/th_a/ts/%zz.png"],
    ["a different prefix entirely", "/attachmentsx/th_a/ts/shot.png"],
  ])("refuses %s", (_label, path) => {
    expect(parseAttachmentPath(path)).toBeNull();
  });

  it("accepts names that merely contain dots — the rule is about whole segments", () => {
    for (const name of ["..hidden.png", "a..b.png", "v1.2.3.tar", "...x"]) {
      expect(parseAttachmentPath(`/attachments/th_a/ts/${name}`)).toEqual(["th_a", "ts", name]);
    }
  });
});

describe("isUnnormalizedAttachmentTarget", () => {
  it.each([
    "/attachments/../../../etc/hosts",
    "/attachments/th_a/ts/../../th_b/ts/other.png",
    "/attachments/./th_a/ts/shot.png",
    "/attachments/th_a//shot.png",
    "/attachments/..\\..\\secret.txt",
    // The encoded spellings the WHATWG URL parser collapses exactly like the
    // literal ones, each of which reached a real attachment before SERVER-022
    // finding 1: with these unrefused, `/attachments/<th>/<ts>/%2e%2e/%2e%2e/
    // <other>/<ts>/x` was answered 200 with the other thread's bytes while its
    // literal twin was answered 404.
    "/attachments/th_a/ts/%2e%2e/%2e%2e/th_b/ts/other.png",
    "/attachments/th_a/ts/%2E%2E/%2E%2E/th_b/ts/other.png",
    "/attachments/th_a/ts/.%2e/.%2e/th_b/ts/other.png",
    "/attachments/th_a/ts/%2e./%2e./th_b/ts/other.png",
    "/attachments/th_a/ts/%2E./.%2E/th_b/ts/other.png",
    "/attachments/%2e%2e/%2e%2e/outside/secret.txt",
    "/attachments/.%2E/th_a/ts/shot.png",
    // A single-dot segment resolves back to a legitimate path rather than out of
    // the root, and is refused for the same reason its literal `.` twin is: a
    // harmless traversal is still a traversal.
    "/attachments/th_a/ts/%2e/shot.png",
    "/attachments/%2E/th_a/ts/shot.png",
  ])("refuses %j", (target) => {
    expect(isUnnormalizedAttachmentTarget(target)).toBe(true);
  });

  it.each([
    "/attachments/th_a/ts/shot.png?x=1/../..",
    "/attachments/th_a/ts/shot.png",
    "/attachments/th_a/ts/a..b.png",
    // Not a dot segment to the URL parser either — `%2f` is not a separator, so
    // this stays one segment and `parseAttachmentPath` refuses it at layer 4.
    "/attachments/th_a/ts/%2e%2e%2fx",
    // The percent-encoded colons of a real turn stamp must survive the guard, or
    // the fix for the encoded traversal breaks every legitimate attachment URL.
    "/attachments/th_a/2026-07-27T09%3A00%3A00.000Z/shot.png",
    "/attachments/th_a/ts/%2e%2ename.png",
    "/attachments/th_a/ts/x%2e%2e",
    "/attachments",
    "/attachmentsx/../../etc/hosts",
    "/api/docs",
  ])("passes %j through to routing", (target) => {
    expect(isUnnormalizedAttachmentTarget(target)).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("is inline for an image and an attachment for everything else", () => {
    expect(contentDisposition("shot.png")).toContain("inline;");
    expect(contentDisposition("notes.pdf")).toContain('attachment; filename="notes.pdf"');
  });

  it("never lets a filename break out of the header", () => {
    const header = contentDisposition('ev"il\r\nX-Injected: 1.txt');
    expect(header).not.toContain('"ev"');
    expect(header).not.toMatch(/[\r\n]/);
  });
});

describe("GET /attachments — content types and headers", () => {
  it.each([
    ["shot.png", "image/png"],
    ["shot.jpg", "image/jpeg"],
    ["shot.gif", "image/gif"],
    ["shot.webp", "image/webp"],
    ["shot.avif", "image/avif"],
    ["notes.pdf", "application/pdf"],
    ["notes.txt", "text/plain; charset=utf-8"],
    ["notes.md", "text/markdown; charset=utf-8"],
    ["mystery.wat", "application/octet-stream"],
  ])("serves %s as %s", async (name, contentType) => {
    const { thread, ts } = await upload([new File(["bytes"], name)]);
    const response = await get(attachmentUrl(thread, ts, name));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(contentType);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  });

  it("serves an SVG as a download, closing the inline-script vector", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const { thread, ts } = await upload([new File([svg], "drawing.svg")]);
    const response = await get(attachmentUrl(thread, ts, "drawing.svg"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    // The bytes are untouched: the disposition is the defence, not a rewrite.
    expect(await response.text()).toBe(svg);
  });

  it("gives an image `inline` and a document `attachment; filename=`", async () => {
    const { thread, ts } = await upload([
      new File(["a"], "shot.png"),
      new File(["b"], "notes.pdf"),
    ]);
    const image = await get(attachmentUrl(thread, ts, "shot.png"));
    const document = await get(attachmentUrl(thread, ts, "notes.pdf"));

    expect(image.headers.get("content-disposition")).toContain("inline;");
    expect(document.headers.get("content-disposition")).toContain(
      'attachment; filename="notes.pdf"',
    );
  });

  it("reports a Content-Length that matches the bytes it sends", async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const { thread, ts } = await upload([new File([bytes], "big.bin")]);

    const response = await get(attachmentUrl(thread, ts, "big.bin"));
    const received = new Uint8Array(await response.arrayBuffer());

    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(received.length).toBe(bytes.length);
    expect(Buffer.from(received).equals(Buffer.from(bytes))).toBe(true);
  });

  it("serves a zero-byte attachment", async () => {
    const { thread, ts } = await upload([new File([], "empty.txt")]);
    const response = await get(attachmentUrl(thread, ts, "empty.txt"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("0");
    expect(await response.text()).toBe("");
  });
});

describe("GET /attachments — auth", () => {
  it("answers 401 with no token and with a wrong one, revealing nothing", async () => {
    const { thread, ts } = await upload([new File(["secret bytes"], "shot.png")]);
    const url = attachmentUrl(thread, ts, "shot.png");

    const anonymous = await ws.server.app.request(url);
    const wrong = await get(url, { Authorization: "Bearer wrong-token" });

    for (const response of [anonymous, wrong]) {
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("secret bytes");
    }
  });
});

describe("GET /attachments — the traversal block", () => {
  /** A bait file outside the attachments root, under this suite's own scratch dir. */
  const plantBait = (): string => {
    const outside = join(ws.root, "outside");
    mkdirSync(outside, { recursive: true });
    const bait = join(outside, "secret.txt");
    writeFileSync(bait, "CORPUS-BAIT-DO-NOT-SERVE\n", "utf8");
    return bait;
  };

  it.each([
    ["single-encoded traversal", "/attachments/%2e%2e%2f%2e%2e%2foutside%2fsecret.txt"],
    ["mixed encoded traversal", "/attachments/..%2f..%2foutside%2fsecret.txt"],
    ["double-encoded traversal", "/attachments/%252e%252e%252fsecret.txt"],
    ["encoded backslash", "/attachments/..%5c..%5csecret.txt"],
    ["absolute path", "/attachments//etc/hosts"],
    ["encoded absolute path", "/attachments/%2fetc%2fhosts"],
    ["a NUL byte", "/attachments/th_a/ts/shot.png%00.txt"],
    ["a newline", "/attachments/th_a/ts/shot%0a.png"],
  ])("refuses %s with a 404 and no bait in the body", async (_label, path) => {
    plantBait();
    const response = await get(path);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("CORPUS-BAIT");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses a traversal that would land back inside the root", async () => {
    const first = await upload([new File(["one"], "one.png")]);
    const second = await upload([new File(["two"], "two.png")]);

    const response = await get(
      `/attachments/${first.thread}/${encodeURIComponent(first.ts)}/..%2f..%2f${second.thread}%2f${encodeURIComponent(second.ts)}%2ftwo.png`,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("two");
  });

  it("does not follow a symlink planted inside the attachments root", async () => {
    const bait = plantBait();
    const { thread, ts } = await upload([new File(["real"], "real.png")]);
    symlinkSync(bait, join(ws.root, ".corpus", "attachments", thread, ts, "link.txt"));

    const response = await get(attachmentUrl(thread, ts, "link.txt"));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("CORPUS-BAIT");
    // The legitimate sibling still serves — the defence is per-entry.
    expect((await get(attachmentUrl(thread, ts, "real.png"))).status).toBe(200);
  });

  it("does not follow a symlinked turn directory either", async () => {
    const outside = join(ws.root, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "CORPUS-BAIT-DO-NOT-SERVE\n", "utf8");
    const { thread } = await upload([new File(["real"], "real.png")]);
    symlinkSync(outside, join(ws.root, ".corpus", "attachments", thread, "elsewhere"));

    const response = await get(`/attachments/${thread}/elsewhere/secret.txt`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("CORPUS-BAIT");
  });

  it("still serves legitimate names containing dots", async () => {
    const { thread, ts } = await upload([new File(["one"], "a..b.png")]);
    // `..hidden.png` cannot be produced by the sanitizer (leading dots are
    // dropped), so it is planted by hand — the point is that the *serving*
    // rule rejects segments equal to `..`, not names that begin with them.
    const directory = join(ws.root, ".corpus", "attachments", thread, ts);
    writeFileSync(join(directory, "..hidden.png"), "hidden bytes", "utf8");
    writeFileSync(join(directory, "v1.2.3.tar"), "tar bytes", "utf8");

    for (const [name, body] of [
      ["a..b.png", "one"],
      ["..hidden.png", "hidden bytes"],
      ["v1.2.3.tar", "tar bytes"],
    ] as const) {
      const response = await get(attachmentUrl(thread, ts, name));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
    }
  });

  it("is case-sensitive on every platform, decided rather than inherited", async () => {
    const { thread, ts } = await upload([new File(["bytes"], "shot.png")]);
    expect((await get(attachmentUrl(thread, ts, "shot.png"))).status).toBe(200);
    // macOS `realpath` does not canonicalise case, so this is enforced by
    // comparing each segment against its parent's directory listing.
    expect((await get(attachmentUrl(thread, ts, "SHOT.PNG"))).status).toBe(404);
    expect(
      (await get(`/attachments/${thread.toUpperCase()}/${encodeURIComponent(ts)}/shot.png`)).status,
    ).toBe(404);
  });

  it("offers no existence oracle: every miss is the same response", async () => {
    const { thread, ts } = await upload([new File(["bytes"], "shot.png")]);

    const responses = await Promise.all([
      get("/attachments/%2e%2e%2f%2e%2e%2fsecret.txt"),
      get(attachmentUrl(thread, ts, "missing.png")),
      get(attachmentUrl("th_nosuchthread", ts, "shot.png")),
      get(`/attachments/${thread}/${encodeURIComponent(ts)}`),
      get("/attachments"),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.clone().json()).toEqual(ATTACHMENT_NOT_FOUND_BODY);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
    // No filesystem path, no errno, no stack trace.
    const body = await responses[1]?.text();
    expect(body).not.toContain(ws.root);
    expect(body).not.toContain("ENOENT");
    expect(body).not.toMatch(/\bat \w+ \(/);
  });

  it("does not own `/attachmentsx`, which belongs to the UI fallback", async () => {
    const response = await get("/attachmentsx/th_a/ts/shot.png");
    expect(
      await response
        .clone()
        .json()
        .catch(() => null),
    ).not.toEqual(ATTACHMENT_NOT_FOUND_BODY);
  });
});

describe("serving mutates nothing", () => {
  it("makes no commit, emits no invalidation and changes no file", async () => {
    const { thread, ts } = await upload([new File(["bytes"], "shot.png")]);

    const commitsBefore = ws.log("%H").length;
    const statusBefore = ws.git("status", "--porcelain");
    const threadFile = join(ws.root, "data", "threads", `${thread}.md`);
    const mtimeBefore = statSync(threadFile).mtimeMs;
    const attachmentMtime = statSync(
      join(ws.root, ".corpus", "attachments", thread, ts, "shot.png"),
    ).mtimeMs;
    const projectionBefore = ws.db.prepare("SELECT count(*) AS n FROM turns").get();

    const frames: QueryKey[][] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => {
      frames.push([...keys]);
    });

    for (let index = 0; index < 20; index += 1) {
      const path =
        index % 4 === 0
          ? attachmentUrl(thread, ts, "missing.png")
          : attachmentUrl(thread, ts, "shot.png");
      await get(path);
    }
    unsubscribe();

    expect(frames).toEqual([]);
    expect(ws.log("%H")).toHaveLength(commitsBefore);
    expect(ws.git("status", "--porcelain")).toBe(statusBefore);
    expect(statSync(threadFile).mtimeMs).toBe(mtimeBefore);
    expect(statSync(join(ws.root, ".corpus", "attachments", thread, ts, "shot.png")).mtimeMs).toBe(
      attachmentMtime,
    );
    expect(ws.db.prepare("SELECT count(*) AS n FROM turns").get()).toEqual(projectionBefore);
    expect(readFileSync(threadFile, "utf8")).toContain("shot.png");
  });
});
