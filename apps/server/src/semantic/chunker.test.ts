import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HEADING_PATH_SEPARATOR } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { enclosingHeadings } from "../core/headings.js";
import {
  CHUNK_CHARS_PER_TOKEN,
  CHUNK_CHAR_BUDGET,
  CHUNK_TOKEN_BUDGET,
  chunkBody,
  chunkId,
  type Chunk,
} from "./chunker.js";

const SOURCE = { docId: "doc_abc123", title: "The document" };

const paths = (chunks: readonly Chunk[]): string[] => chunks.map((chunk) => chunk.headingPath);
const ids = (chunks: readonly Chunk[]): string[] => chunks.map((chunk) => chunk.id);

/**
 * Chunks are ordered, never overlap, always quote the body verbatim, and leave
 * behind nothing but whitespace — a blank stretch (an empty preamble, the
 * newline a hard split strands) carries nothing to index and is dropped.
 */
function expectCovers(body: string, chunks: readonly Chunk[]): void {
  let cursor = 0;
  for (const chunk of chunks) {
    expect(chunk.start).toBeGreaterThanOrEqual(cursor);
    expect(chunk.end).toBeGreaterThan(chunk.start);
    expect(chunk.text).toBe(body.slice(chunk.start, chunk.end));
    expect(body.slice(cursor, chunk.start).trim()).toBe("");
    cursor = chunk.end;
  }
  expect(body.slice(cursor).trim()).toBe("");
}

/** A body long enough to force a split, in paragraphs of a known size. */
const paragraphs = (count: number, seed: string): string =>
  Array.from(
    { length: count },
    (_, index) => `${seed} paragraph ${String(index)}. ${"x".repeat(200)}`,
  ).join("\n\n");

describe("chunkBody — the shape of the split", () => {
  it("cuts one chunk per heading section, addressed by its heading path", () => {
    const body = "Intro.\n\n# Mortgage\n\nUnder mortgage.\n\n## Rates\n\nRate text.\n";
    const chunks = chunkBody(body, SOURCE);
    expect(paths(chunks)).toEqual([
      "The document",
      "Mortgage",
      ["Mortgage", "Rates"].join(HEADING_PATH_SEPARATOR),
    ]);
    expect(chunks.map((chunk) => chunk.ord)).toEqual([0, 1, 2]);
  });

  it("covers the body exactly: contiguous slices, no byte lost or duplicated", () => {
    const body = "Intro.\n\n# A\n\nunder a\n\n## B\n\nunder b\n\n# C\n\nunder c\n";
    const chunks = chunkBody(body, SOURCE);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(body);
    expectCovers(body, chunks);
  });

  // TEST-831
  it("chunks a body with no heading at all, addressed by the document's title", () => {
    const chunks = chunkBody("Just a paragraph, no headings anywhere.\n", SOURCE);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toBe("The document");
    expect(chunks[0]?.headings).toEqual([]);
  });

  // TEST-831, second half: an empty heading closes its level and names nothing.
  it("drops an empty heading from the path while still closing its level", () => {
    const chunks = chunkBody("# A\n\n## B\n\nb text\n\n##\n\nafter\n", SOURCE);
    expect(paths(chunks)).toEqual(["A", ["A", "B"].join(HEADING_PATH_SEPARATOR), "A"]);
  });

  it("produces nothing for an empty body, and skips a blank preamble", () => {
    expect(chunkBody("", SOURCE)).toEqual([]);
    expect(chunkBody("   \n\n  \n", SOURCE)).toEqual([]);
    expect(paths(chunkBody("# A\n\nbody\n", SOURCE))).toEqual(["A"]);
  });

  it("agrees with the search path's enclosing headings at every offset", () => {
    const body = "pre\n\n# A\n\n## B\n\ntext\n\n### C\n\ndeep\n\n## D\n\ntail\n";
    for (const chunk of chunkBody(body, SOURCE)) {
      for (const offset of [chunk.start, Math.floor((chunk.start + chunk.end) / 2)]) {
        expect(enclosingHeadings(body, offset), `offset ${String(offset)}`).toEqual(chunk.headings);
      }
    }
  });
});

describe("chunkBody — fences are not headings", () => {
  // TEST-827
  it("reads a `## Rates` inside a fence as text, not as a boundary", () => {
    const body = "# Guide\n\n```md\n## Rates\n## Fees\n```\n\n## Rates\n\nReal rates.\n";
    const chunks = chunkBody(body, SOURCE);
    expect(paths(chunks)).toEqual(["Guide", ["Guide", "Rates"].join(HEADING_PATH_SEPARATOR)]);
    // The fenced text belongs to the section that encloses the fence.
    expect(chunks[0]?.text).toContain("## Fees");
  });

  // TEST-828
  it.each([
    ["backticks", "```"],
    ["tildes", "~~~"],
  ])("honours a %s fence", (_name, fence) => {
    const body = `# A\n\n${fence}\n## Fake\n${fence}\n\n## Real\n\ntext\n`;
    expect(paths(chunkBody(body, SOURCE))).toEqual([
      "A",
      ["A", "Real"].join(HEADING_PATH_SEPARATOR),
    ]);
  });

  // TEST-828
  it("lets an unterminated fence swallow the rest of the document", () => {
    const body = "# A\n\n```\n## Never real\n\n## Also never real\n";
    const chunks = chunkBody(body, SOURCE);
    expect(paths(chunks)).toEqual(["A"]);
    expect(chunks[0]?.end).toBe(body.length);
  });

  // TEST-828
  it("treats a fence indented up to three spaces as a fence", () => {
    const body = "# A\n\n   ```\n   ## Fake\n   ```\n\n## Real\n\ntext\n";
    expect(paths(chunkBody(body, SOURCE))).toEqual([
      "A",
      ["A", "Real"].join(HEADING_PATH_SEPARATOR),
    ]);
  });
});

describe("chunkBody — the size budget", () => {
  // TEST-829
  it("states both numbers the approximation rests on", () => {
    expect(CHUNK_TOKEN_BUDGET).toBe(500);
    expect(CHUNK_CHARS_PER_TOKEN).toBe(4);
    expect(CHUNK_CHAR_BUDGET).toBe(CHUNK_TOKEN_BUDGET * CHUNK_CHARS_PER_TOKEN);
  });

  // TEST-829
  it("splits an oversized section into ordered sub-chunks sharing one address", () => {
    const body = `## Long\n\n${paragraphs(20, "alpha")}\n`;
    const chunks = chunkBody(body, SOURCE);
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(paths(chunks))).toEqual(new Set(["Long"]));
    expect(chunks.map((chunk) => chunk.ord)).toEqual(chunks.map((_, index) => index));
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_CHAR_BUDGET);
    expectCovers(body, chunks);
  });

  // TEST-829: stable sub-addressing.
  it("changes only the last sub-chunk's id when a paragraph is appended", () => {
    const before = `## Long\n\n${paragraphs(20, "alpha")}\n`;
    const after = `${before}\nappended tail paragraph.\n`;
    const beforeIds = ids(chunkBody(before, SOURCE));
    const afterIds = ids(chunkBody(after, SOURCE));
    expect(afterIds.slice(0, beforeIds.length - 1)).toEqual(beforeIds.slice(0, -1));
    expect(afterIds.at(beforeIds.length - 1)).not.toBe(beforeIds.at(-1));
  });

  it("keeps a section shorter than the budget whole, however short", () => {
    expect(chunkBody("## Tiny\n\nx\n", SOURCE)).toHaveLength(1);
  });

  it("splits a single line longer than the budget at the budget", () => {
    const body = `## Wall\n\n${"y".repeat(CHUNK_CHAR_BUDGET * 3)}\n`;
    const chunks = chunkBody(body, SOURCE);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_CHAR_BUDGET);
    expectCovers(body, chunks);
  });

  it("does not split inside a fenced block that fits the budget", () => {
    const fence = `\`\`\`\n${paragraphs(4, "code")}\n\`\`\``;
    const body = `## Section\n\n${paragraphs(4, "prose")}\n\n${fence}\n\n${paragraphs(4, "after")}\n`;
    for (const chunk of chunkBody(body, SOURCE)) {
      const opens = (chunk.text.match(/```/gu) ?? []).length;
      expect(opens % 2, `chunk cut a fence: ${chunk.text.slice(0, 40)}`).toBe(0);
    }
  });
});

describe("chunkBody — a turn's chunks hang under the turn's heading", () => {
  // TEST-830
  it("roots every chunk of a turn at that turn's own heading", () => {
    const turnHeading = "agent · 2026-07-19T10:07:12Z";
    const chunks = chunkBody("A reply.\n\n## Detail\n\nMore.\n", {
      ...SOURCE,
      rootHeading: turnHeading,
    });
    expect(paths(chunks)).toEqual([
      turnHeading,
      [turnHeading, "Detail"].join(HEADING_PATH_SEPARATOR),
    ]);
  });

  // TEST-830
  it("keeps the turn's heading on every sub-chunk of a long turn", () => {
    const turnHeading = "user · 2026-07-19T10:00:00Z";
    const chunks = chunkBody(paragraphs(20, "turn"), { ...SOURCE, rootHeading: turnHeading });
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(paths(chunks))).toEqual(new Set([turnHeading]));
  });

  it("never falls back to the title for a turn, since the root heading is always there", () => {
    const chunks = chunkBody("body\n", { ...SOURCE, rootHeading: "agent · t" });
    expect(chunks[0]?.headingPath).toBe("agent · t");
  });
});

describe("chunkId — a function of exactly three things", () => {
  const body = "# A\n\n## B\n\nThe target paragraph.\n\n## Sibling\n\nOther text.\n";
  /** The chunk under `## B` (or whatever the second heading became), by position. */
  const target = (source = SOURCE, text = body): Chunk => {
    const found = chunkBody(text, source)[1];
    expect(found).toBeDefined();
    return found as Chunk;
  };

  // TEST-824
  it("changes when the content changes", () => {
    expect(target().id).not.toBe(target(SOURCE, body.replace("target", "changed")).id);
  });

  // TEST-824
  it("changes when an enclosing heading changes", () => {
    expect(target().id).not.toBe(target(SOURCE, body.replace("## B", "## Renamed")).id);
  });

  // TEST-824
  it("changes when the document id changes", () => {
    expect(target().id).not.toBe(target({ ...SOURCE, docId: "doc_other" }).id);
  });

  // TEST-824: a move or a rename re-indexes nothing, because the path is not an input.
  it("does not change when the document's title changes", () => {
    expect(target().id).toBe(target({ ...SOURCE, title: "Renamed document" }).id);
  });

  // TEST-824
  it("does not change when a sibling section changes", () => {
    expect(target().id).toBe(target(SOURCE, body.replace("Other text", "Rewritten text")).id);
  });

  it("is injective across its three inputs", () => {
    // `["a", []]` and `[]` with content `"a"` must not collide, which a plain
    // concatenation would allow.
    expect(chunkId("doc_a", ["b"], "c")).not.toBe(chunkId("doc_a", [], "bc"));
    expect(chunkId("doc_a", ["b", "c"], "")).not.toBe(chunkId("doc_a", ["b"], "c"));
  });

  it("gives one id to two byte-identical chunks under one address", () => {
    const repeated = "## Same\n\nBoilerplate.\n\n## Same\n\nBoilerplate.\n\n";
    const chunks = chunkBody(repeated, SOURCE);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.id).toBe(chunks[1]?.id);
    expect(chunks[0]?.ord).not.toBe(chunks[1]?.ord);
  });
});

/**
 * A seeded generator, so a failure is reproducible from the seed printed in the
 * assertion rather than from a screenshot of a random body.
 */
function generateBody(seed: number): string {
  let state = seed * 2654435761 + 1;
  const next = (bound: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % bound;
  };
  const parts: string[] = [];
  for (let index = 0; index < 24; index += 1) {
    switch (next(6)) {
      case 0:
        parts.push(`${"#".repeat(1 + next(6))} Heading ${String(index)}`);
        break;
      case 1:
        parts.push(`${"#".repeat(1 + next(6))}`);
        break;
      case 2:
        parts.push(`\`\`\`\n## Not a heading ${String(index)}\ncode\n\`\`\``);
        break;
      case 3:
        parts.push("");
        break;
      case 4:
        parts.push(`Paragraph ${String(index)}. ${"z".repeat(next(900))}`);
        break;
      default:
        parts.push(`- item ${String(index)}\n- item ${String(index + 1)}`);
    }
  }
  return `${parts.join("\n\n")}\n`;
}

describe("determinism", () => {
  // TEST-823
  it("produces identical chunks for the same body, over generated bodies", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const body = generateBody(seed);
      const first = chunkBody(body, SOURCE);
      const second = chunkBody(body, SOURCE);
      expect(second, `seed ${String(seed)}`).toEqual(first);
      // And the partition property holds for every generated body.
      expect(first.map((chunk) => body.slice(chunk.start, chunk.end))).toEqual(
        first.map((chunk) => chunk.text),
      );
      expect(first.map((chunk) => chunk.ord)).toEqual(first.map((_, index) => index));
    }
  });

  // TEST-823: "and again in a fresh process" — the id function must carry no
  // process-local state (a counter, a hash seed, a `Math.random` salt), which a
  // second call inside this process could never detect.
  it("produces the same ids in a fresh process", () => {
    const module = fileURLToPath(new URL("./chunker.ts", import.meta.url));
    const body = generateBody(7);
    const script = [
      `const { chunkBody } = await import(${JSON.stringify(module)});`,
      `const body = ${JSON.stringify(body)};`,
      `const source = ${JSON.stringify(SOURCE)};`,
      "console.log(JSON.stringify(chunkBody(body, source).map((chunk) => chunk.id)));",
    ].join("\n");
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      { encoding: "utf8", cwd: fileURLToPath(new URL("../../", import.meta.url)) },
    );
    expect(JSON.parse(output.trim())).toEqual(ids(chunkBody(body, SOURCE)));
  });
});
