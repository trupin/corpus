import { describe, expect, it } from "vitest";
import {
  DocumentParseError,
  duplicateKeysAt,
  hasFrontmatterKey,
  parseDocument,
  serializeDocument,
  setBody,
  setFrontmatterFields,
} from "./document.js";

const MINIMAL = `---
id: doc_a1b2c3
type: note
title: Minimal
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:00:00Z
---
Body is plain markdown.
`;

const FULL = `---
id: doc_full0001
type: note
title: Mortgage options
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:42:00Z
tags: [finance, housing]
status: open
anchors:
  anc_k4f7:
    exact: "assume a 30-year fixed at 6.1%"
    prefix: "the model we "
    suffix: " which may be stale"
due: 2026-08-01
reviewed: 2026-07-20T09:00:00Z
evergreen: false
---
We assume a 30-year fixed at 6.1% which may be stale.
`;

const THREAD = `---
id: th_x9y8
type: thread
title: "Re: 30-year fixed assumption"
created: 2026-07-19T10:05:00Z
updated: 2026-07-19T10:07:12Z
parent: doc_full0001
anchor: anc_k4f7
agent: engaged
---
## user · 2026-07-19T10:05:00Z
@agent is 6.1% still the right assumption?

## agent · 2026-07-19T10:07:12Z
Checked current averages; 6.4% is more representative.
`;

const PLUGIN_KEYS = `---
id: doc_plugin01
type: note
title: Published note
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:00:00Z
publish:
  google-docs:
    id: 1AbC
    lastSync: 2026-07-19T11:00:00Z
name: orchestrate
description: Steward the corpus.
---
Body.
`;

const COMMENTED = `---
# The id is immutable — never edit it by hand.
type: note
id: doc_comment1 # assigned at creation
title: 'Single quoted title'
updated: 2026-07-19T10:00:00Z
created: 2026-07-19T10:00:00Z

# Plugin fields live below the core block.
tags:
  - finance # the only tag that matters
---
Body with a --- line that is not a fence.

---

Still body.
`;

const NO_TRAILING_NEWLINE = `---
id: doc_notrail1
type: note
title: No trailing newline
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:00:00Z
---
Last line has no newline.`;

const UNICODE = `---
id: doc_unicode1
type: note
title: "Astral 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 🎉 title"
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:00:00Z
---
Emoji 👩‍👩‍👧‍👦 and combining marks é and RTL עברית all round-trip.
`;

const EXPLICIT_NULL = `---
id: doc_nullish1
type: note
title: Explicit nulls
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:00:00Z
due: null
reviewed: null
---
Body.
`;

const EMPTY_BODY = `---
id: doc_empty001
type: note
title: Empty body
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:00:00Z
---
`;

const ALIASES = `---
id: doc_alias001
type: note
title: Aliases
created: &t 2026-07-19T10:00:00Z
updated: *t
---
Body.
`;

const FIXTURES: readonly (readonly [string, string])[] = [
  ["minimal frontmatter", MINIMAL],
  ["full frontmatter", FULL],
  ["thread with turns", THREAD],
  ["plugin + Claude Code keys", PLUGIN_KEYS],
  ["comments and non-default key order", COMMENTED],
  ["no trailing newline", NO_TRAILING_NEWLINE],
  ["astral-plane unicode", UNICODE],
  ["explicit nulls", EXPLICIT_NULL],
  ["empty body", EMPTY_BODY],
  ["YAML anchors and aliases", ALIASES],
  ["CRLF line endings", FULL.replaceAll("\n", "\r\n")],
  ["CRLF without trailing newline", NO_TRAILING_NEWLINE.replaceAll("\n", "\r\n")],
  ["UTF-8 BOM", `\uFEFF${MINIMAL}`],
  ["BOM + CRLF", `\uFEFF${MINIMAL.replaceAll("\n", "\r\n")}`],
  ["empty frontmatter block", "---\n---\nBody only.\n"],
  ["over-long fence", "-----\nid: doc_fence001\ntype: note\n----\nBody.\n"],
  ["fence with trailing spaces", "---  \nid: doc_space001\ntype: note\n---  \nBody.\n"],
];

describe("parseDocument / serializeDocument", () => {
  it.each(FIXTURES)("round-trips %s byte-identically", (_name, raw) => {
    expect(serializeDocument(parseDocument(raw))).toBe(raw);
  });

  it("exposes the frontmatter mapping exactly as written, with no defaults", () => {
    const parsed = parseDocument(MINIMAL);
    expect(parsed.data).toEqual({
      id: "doc_a1b2c3",
      type: "note",
      title: "Minimal",
      created: "2026-07-19T10:00:00Z",
      updated: "2026-07-19T10:00:00Z",
    });
  });

  it("keeps the body verbatim, without the frontmatter block", () => {
    expect(parseDocument(MINIMAL).body).toBe("Body is plain markdown.\n");
    expect(parseDocument(EMPTY_BODY).body).toBe("");
  });

  it("does not mistake a `---` inside the body for the closing fence", () => {
    const parsed = parseDocument(COMMENTED);
    expect(parsed.data["id"]).toBe("doc_comment1");
    expect(parsed.body).toContain("Body with a --- line that is not a fence.");
  });

  it("parses an empty frontmatter block to an empty mapping rather than throwing", () => {
    const parsed = parseDocument("---\n---\nBody only.\n");
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe("Body only.\n");
  });

  it("resolves YAML aliases when building the plain mapping", () => {
    expect(parseDocument(ALIASES).data["updated"]).toBe("2026-07-19T10:00:00Z");
  });

  it("detects CRLF and LF line endings", () => {
    expect(parseDocument(MINIMAL).source.eol).toBe("\n");
    expect(parseDocument(MINIMAL.replaceAll("\n", "\r\n")).source.eol).toBe("\r\n");
  });

  it("records the BOM so it survives serialization", () => {
    expect(parseDocument(`\uFEFF${MINIMAL}`).source.bom).toBe("\uFEFF");
    expect(parseDocument(MINIMAL).source.bom).toBe("");
  });
});

describe("parseDocument failures", () => {
  it("throws naming the path and line when there is no frontmatter fence", () => {
    const call = () => parseDocument("Just a markdown file.\n", "data/docs/bare.md");
    expect(call).toThrow(DocumentParseError);
    expect(call).toThrow(/data\/docs\/bare\.md:1:/);
    expect(call).toThrow(/missing YAML frontmatter fence/);
  });

  it("throws naming the path when the fence is never closed", () => {
    const call = () => parseDocument("---\nid: doc_a1b2c3\ntype: note\n", "data/docs/open.md");
    expect(call).toThrow(DocumentParseError);
    expect(call).toThrow(/unterminated YAML frontmatter fence/);
  });

  it("throws on YAML that cannot be parsed at all", () => {
    const call = () => parseDocument("---\nid: [unclosed\n---\nBody.\n", "data/docs/bad.md");
    expect(call).toThrow(DocumentParseError);
    expect(call).toThrow(/invalid YAML frontmatter/);
  });

  it("reports the offending path even when none was supplied", () => {
    expect(() => parseDocument("no fence")).toThrow(/<document>:1:/);
  });

  it("does not treat a non-mapping frontmatter as fields", () => {
    expect(parseDocument("---\n- a\n- b\n---\nBody.\n").data).toEqual({});
  });
});

describe("setFrontmatterFields", () => {
  it("changes exactly one line and preserves comments, order and quoting", () => {
    const parsed = parseDocument(COMMENTED);
    const after = serializeDocument(setFrontmatterFields(parsed, { title: "Renamed" }));
    const before = COMMENTED.split("\n");
    const changed = after.split("\n").filter((line, index) => line !== before[index]);
    // The retained AST keeps the key's original quoting style, so the diff is
    // one line even when the new value would not have been quoted from scratch.
    expect(changed).toEqual(["title: 'Renamed'"]);
  });

  it("leaves the original parse serializable to the original bytes", () => {
    const parsed = parseDocument(COMMENTED);
    setFrontmatterFields(parsed, { title: "Renamed" });
    expect(serializeDocument(parsed)).toBe(COMMENTED);
  });

  it("adds a key without disturbing the ones already written", () => {
    const parsed = parseDocument(MINIMAL);
    const after = serializeDocument(setFrontmatterFields(parsed, { evergreen: true }));
    expect(after).toBe(MINIMAL.replace("---\nBody", "evergreen: true\n---\nBody"));
  });

  it("removes a key when the patch value is undefined", () => {
    const parsed = parseDocument(EXPLICIT_NULL);
    const after = serializeDocument(setFrontmatterFields(parsed, { reviewed: undefined }));
    expect(after).not.toContain("reviewed:");
    expect(after).toContain("due: null");
  });

  it("writes into an empty frontmatter block", () => {
    const parsed = parseDocument("---\n---\nBody.\n");
    expect(serializeDocument(setFrontmatterFields(parsed, { id: "doc_new00001" }))).toBe(
      "---\nid: doc_new00001\n---\nBody.\n",
    );
  });

  it("keeps the file's line endings when re-emitting", () => {
    const parsed = parseDocument(MINIMAL.replaceAll("\n", "\r\n"));
    const after = serializeDocument(setFrontmatterFields(parsed, { title: "Renamed" }));
    expect(after).toContain("title: Renamed\r\n");
    expect(after).not.toMatch(/[^\r]\n/);
  });

  it("returns the same document for an empty patch", () => {
    const parsed = parseDocument(MINIMAL);
    expect(setFrontmatterFields(parsed, {})).toBe(parsed);
  });

  it("reflects the patch in the plain mapping", () => {
    const patched = setFrontmatterFields(parseDocument(MINIMAL), { tags: ["finance"] });
    expect(patched.data["tags"]).toEqual(["finance"]);
  });

  it("does not fold a long untouched scalar onto a new line", () => {
    const long = `---\nid: doc_long0001\ntype: note\ntitle: ${"word ".repeat(40).trim()}\n---\nBody.\n`;
    const after = serializeDocument(setFrontmatterFields(parseDocument(long), { type: "view" }));
    expect(after.split("\n").filter((line) => line.startsWith("title:"))).toHaveLength(1);
    expect(after).toContain(`title: ${"word ".repeat(40).trim()}`);
  });
});

describe("setBody", () => {
  it("replaces the body and leaves the frontmatter source untouched", () => {
    const parsed = parseDocument(COMMENTED);
    const after = serializeDocument(setBody(parsed, "New body.\n"));
    expect(after.endsWith("---\nNew body.\n")).toBe(true);
    expect(after).toContain("# The id is immutable");
  });

  it("returns the same document when the body is unchanged", () => {
    const parsed = parseDocument(MINIMAL);
    expect(setBody(parsed, parsed.body)).toBe(parsed);
  });
});

describe("duplicateKeysAt", () => {
  it("reports anchor ids written more than once", () => {
    const raw = `---
id: doc_dupanc01
type: note
anchors:
  anc_k4f7:
    exact: "first"
  anc_k4f7:
    exact: "second"
---
Body.
`;
    expect(duplicateKeysAt(parseDocument(raw), ["anchors"])).toEqual(["anc_k4f7"]);
  });

  it("reports nothing for a well-formed mapping", () => {
    expect(duplicateKeysAt(parseDocument(FULL), ["anchors"])).toEqual([]);
  });

  it("reports nothing when the path is not a mapping", () => {
    expect(duplicateKeysAt(parseDocument(FULL), ["tags"])).toEqual([]);
    expect(duplicateKeysAt(parseDocument(FULL), ["nope"])).toEqual([]);
  });

  it("inspects the root mapping when given an empty path", () => {
    expect(duplicateKeysAt(parseDocument(FULL), [])).toEqual([]);
  });
});

describe("hasFrontmatterKey", () => {
  it("distinguishes an explicit null from an absent key", () => {
    const explicit = parseDocument(EXPLICIT_NULL);
    const absent = parseDocument(MINIMAL);
    expect(hasFrontmatterKey(explicit, "due")).toBe(true);
    expect(explicit.data["due"]).toBeNull();
    expect(hasFrontmatterKey(absent, "due")).toBe(false);
  });
});
