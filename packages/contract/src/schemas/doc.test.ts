import { describe, expect, it } from "vitest";
import {
  CORE_DOC_TYPES,
  CoreDocTypeSchema,
  CreateDocRequestSchema,
  DocFrontmatterSchema,
  DocListSchema,
  DocSchema,
  DocsQuerySchema,
  DocStatusSchema,
  DocSummarySchema,
  UpdateDocRequestSchema,
  UpdateDocResponseSchema,
} from "./doc.js";

const frontmatter = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
  tags: ["finance"],
  status: "open",
  anchors: {
    anc_k4f7: {
      exact: "assume a 30-year fixed at 6.1%",
      prefix: "the model we ",
      suffix: " which may be stale",
    },
  },
  due: null,
  reviewed: null,
  evergreen: false,
};

const doc = {
  frontmatter,
  body: "Body is plain markdown.",
  path: "data/docs/finance/mortgage-options.md",
  anchors: [
    {
      anchorId: "anc_k4f7",
      selector: { exact: "assume a 30-year fixed at 6.1%", prefix: "the model we ", suffix: "" },
      threadId: "th_x9y8",
      threadStatus: "open",
      range: { start: 42, end: 71 },
      orphaned: false,
    },
  ],
};

const summary = {
  id: "doc_a1b2c3",
  type: "note",
  title: "Mortgage options",
  path: "data/docs/finance/mortgage-options.md",
  status: "open",
  tags: ["finance"],
  created: "2026-07-19T10:00:00Z",
  updated: "2026-07-19T10:42:00Z",
  due: "2026-08-01",
  reviewed: "2026-07-20T09:00:00Z",
  evergreen: false,
  excerpt: "Body is plain markdown.",
};

describe("DocFrontmatter", () => {
  it("round-trips the SPEC.md §5 canonical frontmatter", () => {
    expect(DocFrontmatterSchema.parse(frontmatter)).toEqual(frontmatter);
  });

  it("accepts a plugin-defined type, since plugins declare their own", () => {
    expect(DocFrontmatterSchema.parse({ ...frontmatter, type: "todo" }).type).toBe("todo");
  });

  it("rejects a status outside the lifecycle", () => {
    expect(DocFrontmatterSchema.safeParse({ ...frontmatter, status: "done" }).success).toBe(false);
  });

  it("rejects an anchor key that is not an anchor id", () => {
    const broken = { ...frontmatter, anchors: { k4f7: { exact: "x", prefix: "", suffix: "" } } };
    expect(DocFrontmatterSchema.safeParse(broken).success).toBe(false);
  });
});

describe("Doc", () => {
  it("round-trips a document with a resolved anchor", () => {
    expect(DocSchema.parse(doc)).toEqual(doc);
  });

  it("round-trips an orphaned anchor, whose range is null", () => {
    const orphaned = {
      ...doc,
      anchors: [{ ...doc.anchors[0], range: null, orphaned: true }],
    };
    expect(DocSchema.parse(orphaned)).toEqual(orphaned);
  });
});

describe("DocSummary and DocList", () => {
  it("round-trips a row carrying a due date and a review mark", () => {
    expect(DocSummarySchema.parse(summary)).toEqual(summary);
  });

  it("round-trips a page of rows", () => {
    const list = { items: [summary], page: { total: 1, limit: 50, offset: 0 } };
    expect(DocListSchema.parse(list)).toEqual(list);
  });
});

describe("DocsQuery", () => {
  it("applies pagination defaults when only a filter is given", () => {
    expect(DocsQuerySchema.parse({ type: "thread" })).toEqual({
      type: "thread",
      limit: 50,
      offset: 0,
    });
  });

  it("carries the full-text query through", () => {
    expect(DocsQuerySchema.parse({ q: "mortgage", status: "archived" })).toMatchObject({
      q: "mortgage",
      status: "archived",
    });
  });

  it("rejects an unknown status", () => {
    expect(DocsQuerySchema.safeParse({ status: "done" }).success).toBe(false);
  });

  it("rejects an empty full-text query rather than treating it as no filter", () => {
    expect(DocsQuerySchema.safeParse({ q: "" }).success).toBe(false);
  });
});

describe("CreateDocRequest", () => {
  it("defaults everything the caller may omit", () => {
    expect(CreateDocRequestSchema.parse({ type: "note", title: "Untitled" })).toEqual({
      type: "note",
      title: "Untitled",
      tags: [],
      status: "open",
      due: null,
      evergreen: false,
    });
  });

  it("rejects an empty title", () => {
    expect(CreateDocRequestSchema.safeParse({ type: "note", title: "" }).success).toBe(false);
  });
});

describe("UpdateDocRequest and UpdateDocResponse", () => {
  it("accepts a body-only edit", () => {
    expect(UpdateDocRequestSchema.parse({ body: "new body" })).toEqual({ body: "new body" });
  });

  it('accepts a "still current" review mark', () => {
    expect(UpdateDocRequestSchema.parse({ reviewed: "2026-07-26T12:00:00Z" })).toEqual({
      reviewed: "2026-07-26T12:00:00Z",
    });
  });

  it("round-trips the anchor reconciliation report", () => {
    const response = { doc, anchors: { remapped: ["anc_k4f7"], orphaned: [] } };
    expect(UpdateDocResponseSchema.parse(response)).toEqual(response);
  });
});

describe("document type vocabulary", () => {
  it.each(CORE_DOC_TYPES)("recognises the core type %s", (type) => {
    expect(CoreDocTypeSchema.parse(type)).toBe(type);
  });

  it("does not treat a plugin type as a core type", () => {
    expect(CoreDocTypeSchema.safeParse("todo").success).toBe(false);
  });

  it.each(["open", "resolved", "archived"])("recognises the status %s", (status) => {
    expect(DocStatusSchema.parse(status)).toBe(status);
  });
});
