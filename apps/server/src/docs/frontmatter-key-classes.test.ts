import { PRESENTATION_FRONTMATTER_KEYS, SERVER_STAMPED_FRONTMATTER_KEYS } from "@corpus/contract";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { SQUASH_IDLE_MS } from "../git/index.js";
import { createDoc, createWriteWorkspace, putDoc, type WriteWorkspace } from "./write-fixture.js";

/**
 * **The drift guard for CONTRACT-098's two key classes.**
 *
 * The classes are declared once, in `@corpus/contract`, because the server and
 * the CLI's template comparison ask the same question of the same keys. A
 * declaration a consumer can quietly re-state is not a declaration, so every
 * assertion below is driven **by iterating the contract's own list** rather than
 * by naming `width`, `created` or `updated`: a key added to the contract and not
 * honoured here fails with that key in the test's name, which is the message
 * saying which side is behind.
 *
 * The behaviour these tests hold is unchanged and older than this file —
 * `update.test.ts`'s "`updated` is when the content changed" block covers
 * `width` in prose and in detail. This file covers the *class*.
 */
let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const updatedOf = (path: string): unknown => parseDocument(ws.read(path)).data["updated"];

describe("presentation frontmatter keys are the contract's, not this module's", () => {
  it.each([...PRESENTATION_FRONTMATTER_KEYS])(
    "a save of only `%s` writes the file and leaves `updated` where it was",
    async (key) => {
      ws = createWriteWorkspace(`presentation-${key}`);
      ws.reproject();
      const created = await createDoc(ws, { type: "view", title: "Open threads" });
      ws.advance(SQUASH_IDLE_MS);
      await putDoc(ws, created.id, { extra: { [key]: 444 } });
      const before = updatedOf(created.path);

      ws.advance(SQUASH_IDLE_MS);
      const response = await putDoc(ws, created.id, { extra: { [key]: 686 } });

      expect(response.status).toBe(200);
      const parsed = parseDocument(ws.read(created.path));
      expect(parsed.data[key]).toBe(686);
      expect(parsed.data["updated"]).toBe(before);
    },
  );

  it("still stamps `updated` for a key that is not on the list", async () => {
    ws = createWriteWorkspace("presentation-negative");
    ws.reproject();
    const created = await createDoc(ws, { type: "view", title: "Open threads" });
    const before = updatedOf(created.path);

    ws.advance(SQUASH_IDLE_MS);
    const response = await putDoc(ws, created.id, { extra: { colour: "accent" } });

    expect(response.status).toBe(200);
    expect(updatedOf(created.path)).not.toBe(before);
  });

  /**
   * The restatement this issue removed was a `const PRESENTATION_KEYS` in
   * `update.ts`, and the failure mode it created was invisible: both copies keep
   * working until one of them grows a key. A literal here would be that copy
   * coming back, so the source is checked for one. Scoped to the single file
   * that held it, and to **quoted** occurrences, because the prose in that file
   * legitimately names `width` while explaining the class.
   */
  it("holds no quoted presentation key of its own in `update.ts`", () => {
    const source = readFileSync(new URL("./update.ts", import.meta.url), "utf8");
    for (const key of PRESENTATION_FRONTMATTER_KEYS) {
      expect(source).not.toContain(`"${key}"`);
      expect(source).not.toContain(`'${key}'`);
    }
  });
});

describe("server-stamped frontmatter keys are written by the server alone", () => {
  it.each([...SERVER_STAMPED_FRONTMATTER_KEYS])(
    "refuses a `PUT` naming `%s`, so the file keeps the server's value",
    async (key) => {
      ws = createWriteWorkspace(`stamped-${key}`);
      ws.reproject();
      const created = await createDoc(ws, { type: "note", title: "Mortgage options" });
      const before = parseDocument(ws.read(created.path)).data[key];

      ws.advance(SQUASH_IDLE_MS);
      const response = await putDoc(ws, created.id, { [key]: "2020-01-01T00:00:00Z" });

      expect(response.status).toBe(400);
      expect(parseDocument(ws.read(created.path)).data[key]).toBe(before);
    },
  );

  it("stamps `updated` and leaves `created` alone across a content edit", async () => {
    ws = createWriteWorkspace("stamped-content-edit");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Mortgage options" });
    const born = parseDocument(ws.read(created.path)).data["created"];
    const before = updatedOf(created.path);

    ws.advance(SQUASH_IDLE_MS);
    const response = await putDoc(ws, created.id, { title: "Mortgage options, 2026" });

    expect(response.status).toBe(200);
    const parsed = parseDocument(ws.read(created.path));
    expect(parsed.data["created"]).toBe(born);
    expect(parsed.data["updated"]).not.toBe(before);
  });
});
