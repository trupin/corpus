import { describe, expect, it } from "vitest";
import {
  parseRefs,
  refIds,
  REF_ALIAS_ATTRIBUTE,
  REF_ID_ATTRIBUTE,
  REF_NODE_TYPE,
  remarkCorpusRefs,
  splitTextNode,
} from "./refs.js";

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: Record<string, unknown>;
}

describe("parseRefs", () => {
  it("finds the bare form and the alias form, in source order", () => {
    expect(parseRefs("see [[doc_a]] and [[doc_b|the rate assumption]] today")).toEqual([
      { id: "doc_a", alias: null },
      { id: "doc_b", alias: "the rate assumption" },
    ]);
  });

  it("accepts any document id, threads and skills included (SPEC.md §5)", () => {
    expect(parseRefs("[[th_x9y8]] [[doc_a1b2c3]]").map((ref) => ref.id)).toEqual([
      "th_x9y8",
      "doc_a1b2c3",
    ]);
  });

  it("treats prose in double brackets as prose, not as a broken ref", () => {
    expect(parseRefs("[[not an id]] and [[ ]]")).toEqual([]);
  });

  /**
   * sprint-010 FIND-3. Refs are id-based (SPEC.md §5) and the server ignores
   * anything else, so a token that merely *looks* structured is prose too — a
   * client recognising more than the server does renders a live link into a
   * document the corpus has no record of.
   */
  it.each([
    "[[not-a-real-doc]]",
    "[[TODO]]",
    "[[doc]]",
    "[[note_a1b2]]",
    "[[doc-a1b2]]",
    "[[doc_]]",
    "[[_a1b2]]",
    "[[doc_a1b2|alias]] and [[whatever_else|alias]]",
  ])("ignores %s, which is not a document id", (body) => {
    expect(parseRefs(body).every((ref) => /^(doc|th)_[A-Za-z0-9]+$/.test(ref.id))).toBe(true);
  });

  it("keeps the real refs in a body that mixes them with prose tokens", () => {
    expect(parseRefs("[[not-a-real-doc]] then [[doc_a1b2]]")).toEqual([
      { id: "doc_a1b2", alias: null },
    ]);
  });

  it("reads an empty alias as no alias — an invisible link is worse than an id", () => {
    expect(parseRefs("[[doc_a|]] [[doc_b|   ]]")).toEqual([
      { id: "doc_a", alias: null },
      { id: "doc_b", alias: null },
    ]);
  });

  it("does not let one call's cursor decide where the next one starts", () => {
    const body = "[[doc_a]] [[doc_b]]";
    expect(parseRefs(body)).toHaveLength(2);
    expect(parseRefs(body)).toHaveLength(2);
  });
});

describe("refIds", () => {
  it("is the distinct ids, in first-appearance order", () => {
    const body = "[[doc_b]] [[doc_a]] [[doc_b]] [[doc_b|again]]";
    expect(refIds(body)).toEqual(["doc_b", "doc_a"]);
  });

  it("bounds resolution: eight refs to three documents are three lookups", () => {
    const body = Array.from({ length: 8 }, (_, index) => `[[doc_${index % 3}]]`).join(" ");
    expect(refIds(body)).toEqual(["doc_0", "doc_1", "doc_2"]);
  });
});

describe("splitTextNode", () => {
  it("returns null for text with no refs, so the node is left untouched", () => {
    expect(splitTextNode("plain prose")).toBeNull();
  });

  it("leaves a non-id token inside the text run, character for character", () => {
    // Not `["text", ref, "text"]` with the token dropped, and not a ref node:
    // the author typed those characters and they render as those characters.
    expect(splitTextNode("see [[not-a-real-doc]] now")).toBeNull();
    const mixed = splitTextNode("[[not-a-real-doc]] then [[doc_a]]");
    expect(mixed?.map((part) => part.type)).toEqual(["text", REF_NODE_TYPE]);
    expect(mixed?.[0]?.value).toBe("[[not-a-real-doc]] then ");
  });

  it("keeps the text around a ref", () => {
    const parts = splitTextNode("see [[doc_a]] now");
    expect(parts?.map((part) => part.type)).toEqual(["text", REF_NODE_TYPE, "text"]);
    expect(parts?.[0]?.value).toBe("see ");
    expect(parts?.[2]?.value).toBe(" now");
  });

  it("renders the alias as the node's text and keeps the id as data", () => {
    const parts = splitTextNode("[[doc_b|the rate assumption]]");
    const ref = parts?.[0];
    expect(ref?.children?.[0]?.value).toBe("the rate assumption");
    const properties = (ref?.data?.["hProperties"] ?? {}) as Record<string, string>;
    expect(properties[REF_ID_ATTRIBUTE]).toBe("doc_b");
    expect(properties[REF_ALIAS_ATTRIBUTE]).toBe("the rate assumption");
  });

  it("carries no alias attribute for the bare form", () => {
    const properties = (splitTextNode("[[doc_a]]")?.[0]?.data?.["hProperties"] ?? {}) as Record<
      string,
      string
    >;
    expect(properties).not.toHaveProperty(REF_ALIAS_ATTRIBUTE);
    expect(properties[REF_ID_ATTRIBUTE]).toBe("doc_a");
  });
});

describe("remarkCorpusRefs", () => {
  const transform = remarkCorpusRefs();

  it("rewrites refs however deeply they are nested", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                { type: "paragraph", children: [{ type: "text", value: "a [[doc_a]] ref" }] },
              ],
            },
          ],
        },
      ],
    };
    transform(tree);
    const paragraph = tree.children?.[0]?.children?.[0]?.children?.[0];
    expect(paragraph?.children?.map((child) => child.type)).toEqual([
      "text",
      REF_NODE_TYPE,
      "text",
    ]);
  });

  it("leaves code spans alone — they carry no text child to rewrite", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "inlineCode", value: "[[doc_a]]" }],
        },
      ],
    };
    transform(tree);
    expect(tree.children?.[0]?.children?.[0]).toEqual({
      type: "inlineCode",
      value: "[[doc_a]]",
    });
  });

  it("ignores anything that is not a tree", () => {
    expect(() => {
      transform(null);
      transform("nope");
    }).not.toThrow();
  });
});
