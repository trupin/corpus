import { describe, expect, it } from "vitest";
import { DocFrontmatterSchema } from "@corpus/contract";
import { parseDocument, serializeDocument, setFrontmatterFields } from "./document.js";
import {
  FileFrontmatterSchema,
  FileThreadFrontmatterSchema,
  documentFrontmatter,
  isThreadFrontmatter,
  threadFrontmatter,
  validateFrontmatter,
} from "./frontmatter.js";

const CORE = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
};

const THREAD_CORE = {
  id: "th_x9y8",
  type: "thread",
  title: "Re: 30-year fixed assumption",
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:07:12Z",
};

describe("FileFrontmatterSchema", () => {
  it("applies §5 defaults for every omitted optional field", () => {
    const result = FileFrontmatterSchema.parse(CORE);
    expect(result).toMatchObject({
      tags: [],
      status: "open",
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      origin: null,
    });
  });

  /**
   * The five fields added below are the ones a *file* does not have to carry
   * and a *response* always does (CONTRACT-011). `extra` is not a disk key at
   * all — it is the wire envelope for every non-core key, which on disk sits
   * beside the core ones (SPEC.md §12) — and the four §11 view keys are
   * optional in a file the way `tags` and `due` are. `docs/read.ts`'s
   * `wireFrontmatter` is what supplies them, which is why this schema's output
   * is a *subset* of the wire shape rather than equal to it.
   */
  it("produces core values the contract's wire schema accepts unmodified", () => {
    const defaulted = FileFrontmatterSchema.parse(CORE);
    const wire = { ...defaulted, pinned: false, order: null, query: null, column: null, extra: {} };
    expect(DocFrontmatterSchema.safeParse(wire).success).toBe(true);
    // Nothing the file schema produced needed changing to get there.
    const parsed = DocFrontmatterSchema.parse(wire) as Record<string, unknown>;
    for (const [key, value] of Object.entries(defaulted)) expect(parsed[key]).toEqual(value);
  });

  it("keeps plugin and Claude Code keys through validation", () => {
    const result = FileFrontmatterSchema.parse({
      ...CORE,
      type: "skill",
      publish: { "google-docs": { id: "1AbC" } },
      name: "orchestrate",
      description: "Steward the corpus.",
    });
    expect(result["publish"]).toEqual({ "google-docs": { id: "1AbC" } });
    expect(result["name"]).toBe("orchestrate");
    expect(result["description"]).toBe("Steward the corpus.");
  });

  it("accepts a plugin-defined type", () => {
    expect(FileFrontmatterSchema.parse({ ...CORE, type: "todo" }).type).toBe("todo");
  });

  it("normalizes non-UTC and millisecond timestamps for in-memory use", () => {
    const result = FileFrontmatterSchema.parse({
      ...CORE,
      created: "2026-07-19T12:00:00.123+02:00",
      reviewed: "2026-07-20T09:00:00.500Z",
    });
    expect(result.created).toBe("2026-07-19T10:00:00Z");
    expect(result.reviewed).toBe("2026-07-20T09:00:00Z");
  });

  it("reads a YAML 1.1 writer's Date value", () => {
    const result = FileFrontmatterSchema.parse({
      ...CORE,
      created: new Date("2026-07-19T10:00:00.000Z"),
      due: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(result.created).toBe("2026-07-19T10:00:00Z");
    expect(result.due).toBe("2026-08-01");
  });

  it("parses anchor entries and defaults their context to empty strings", () => {
    const result = FileFrontmatterSchema.parse({
      ...CORE,
      anchors: { anc_k4f7: { exact: "assume a 30-year fixed at 6.1%" } },
    });
    expect(result.anchors["anc_k4f7"]).toEqual({
      exact: "assume a 30-year fixed at 6.1%",
      prefix: "",
      suffix: "",
    });
  });

  it.each([
    ["a missing id", { ...CORE, id: undefined }, "id"],
    ["an id with no prefix", { ...CORE, id: "a1b2c3" }, "id"],
    ["a missing title", { ...CORE, title: undefined }, "title"],
    ["a non-string title", { ...CORE, title: 42 }, "title"],
    ["a missing created", { ...CORE, created: undefined }, "created"],
    ["an unzoned created", { ...CORE, created: "2026-07-19T10:00:00" }, "created"],
    ["an impossible created", { ...CORE, created: "2026-02-30T10:00:00Z" }, "created"],
    ["an empty type", { ...CORE, type: "" }, "type"],
    ["a non-array tags", { ...CORE, tags: "finance" }, "tags"],
    ["an unknown status", { ...CORE, status: "pending" }, "status"],
    ["a due with a time component", { ...CORE, due: "2026-08-01T00:00:00Z" }, "due"],
    ["a non-boolean evergreen", { ...CORE, evergreen: "yes" }, "evergreen"],
    ["an anchor key that is not anc_*", { ...CORE, anchors: { k4f7: { exact: "x" } } }, "anchors"],
    ["an anchor with an empty exact", { ...CORE, anchors: { anc_k4f7: { exact: "" } } }, "anchors"],
  ])("rejects %s, naming the field", (_name, data, field) => {
    const result = validateFrontmatter(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.path.startsWith(String(field)))).toBe(true);
  });
});

describe("FileThreadFrontmatterSchema", () => {
  it("validates the §6 fields", () => {
    const result = FileThreadFrontmatterSchema.parse({
      ...THREAD_CORE,
      parent: "doc_a1b2c3",
      anchor: "anc_k4f7",
      agent: "requested",
    });
    expect(result).toMatchObject({ parent: "doc_a1b2c3", anchor: "anc_k4f7", agent: "requested" });
  });

  it("defaults a thread that omits parent, anchor and agent to a standalone unengaged thread", () => {
    expect(FileThreadFrontmatterSchema.parse(THREAD_CORE)).toMatchObject({
      parent: null,
      anchor: null,
      agent: "none",
    });
  });

  it("requires a th_* id on a thread", () => {
    const result = validateFrontmatter({ ...THREAD_CORE, id: "doc_a1b2c3" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path === "id")).toBe(true);
  });

  it("rejects an unknown agent state", () => {
    const result = validateFrontmatter({ ...THREAD_CORE, agent: "maybe" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path === "agent")).toBe(true);
  });

  it("keeps passthrough for plugin keys", () => {
    expect(FileThreadFrontmatterSchema.parse({ ...THREAD_CORE, extra: 1 })["extra"]).toBe(1);
  });
});

describe("validateFrontmatter", () => {
  it("picks the thread schema for a `type: thread` document", () => {
    const result = validateFrontmatter({ ...THREAD_CORE, parent: "doc_a1b2c3" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.thread).toBe(true);
  });

  it("picks the core schema for everything else", () => {
    const result = validateFrontmatter(CORE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.thread).toBe(false);
  });

  it("reports the root when an issue has no path", () => {
    const result = validateFrontmatter([] as unknown as Record<string, unknown>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("<root>");
  });
});

describe("isThreadFrontmatter", () => {
  it("keys off the declared type only", () => {
    expect(isThreadFrontmatter({ type: "thread" })).toBe(true);
    expect(isThreadFrontmatter({ type: "note", parent: "doc_a1b2c3" })).toBe(false);
  });
});

describe("threadFrontmatter", () => {
  it("returns the §6 fields for a valid thread", () => {
    expect(threadFrontmatter(THREAD_CORE)?.agent).toBe("none");
  });

  it("returns null for a document that is not a valid thread", () => {
    expect(threadFrontmatter(CORE)).toBeNull();
  });
});

describe("documentFrontmatter", () => {
  const RAW = `---
id: doc_a1b2c3
type: note
title: Minimal
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:00:00Z
---
Body.
`;

  it("validates an already-parsed document", () => {
    const result = documentFrontmatter(parseDocument(RAW));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("open");
  });

  it("never writes its in-memory defaults back to the file", () => {
    const parsed = parseDocument(RAW);
    const validated = documentFrontmatter(parsed);
    expect(validated.ok).toBe(true);
    const rewritten = serializeDocument(setFrontmatterFields(parsed, { title: "Renamed" }));
    expect(rewritten).toBe(RAW.replace("title: Minimal", "title: Renamed"));
    for (const key of ["tags:", "status:", "anchors:", "due:", "reviewed:", "evergreen:"]) {
      expect(rewritten).not.toContain(key);
    }
  });
});
