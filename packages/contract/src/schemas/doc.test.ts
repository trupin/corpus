import { describe, expect, it } from "vitest";
import {
  CORE_DOC_TYPES,
  CoreDocTypeSchema,
  CreateDocRequestSchema,
  DeleteDocResultSchema,
  DocFrontmatterSchema,
  DocSchema,
  DocStatusSchema,
  MoveDocRequestSchema,
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

  /**
   * The default is `inbox`, not the root: creation is inbox-first (SPEC.md §11)
   * and the server's `documentPathFor` implements it. The schema leaves `folder`
   * absent so the server owns the default — what is asserted here is that the
   * published description says so, since that is the only place a client learns it.
   */
  it("documents the inbox default and both accepted folder spellings", () => {
    const description = CreateDocRequestSchema.shape.folder.meta()?.description ?? "";
    expect(description).toContain("`inbox`");
    expect(description).toContain("data/docs/finance");
    expect(description).not.toContain("defaults to the root");
  });

  it.each(["finance", "data/docs/finance"])("accepts the folder spelling %s", (folder) => {
    expect(CreateDocRequestSchema.parse({ type: "note", title: "T", folder }).folder).toBe(folder);
  });
});

describe("MoveDocRequest", () => {
  it("carries only the destination folder — the id never changes", () => {
    expect(MoveDocRequestSchema.parse({ folder: "finance" })).toEqual({ folder: "finance" });
    expect(Object.keys(MoveDocRequestSchema.shape)).toEqual(["folder"]);
  });

  it("requires a destination", () => {
    expect(MoveDocRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("DeleteDocResult", () => {
  it("round-trips the cascade: the deleted id and the threads it orphaned", () => {
    const result = { deletedId: "doc_a1b2c3", orphanedThreadIds: ["th_x9y8", "th_q1w2"] };
    expect(DeleteDocResultSchema.parse(result)).toEqual(result);
  });

  it("round-trips a document that had no threads", () => {
    const result = { deletedId: "doc_a1b2c3", orphanedThreadIds: [] };
    expect(DeleteDocResultSchema.parse(result)).toEqual(result);
  });

  it("rejects a document id in the orphaned thread list", () => {
    const result = { deletedId: "doc_a1b2c3", orphanedThreadIds: ["doc_zzz"] };
    expect(DeleteDocResultSchema.safeParse(result).success).toBe(false);
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
