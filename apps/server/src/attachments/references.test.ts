import { describe, expect, it } from "vitest";
import { parseAttachmentPath } from "./serve.js";
import {
  attachmentReference,
  attachmentReferences,
  attachmentTarget,
  withAttachmentReferences,
} from "./references.js";

const THREAD = "th_x9y8";
const TS = "2026-07-19T10:05:00Z";

describe("attachmentTarget", () => {
  it("percent-encodes the turn ts's colons and leaves an ASCII name alone", () => {
    expect(attachmentTarget(THREAD, TS, "shot.png")).toBe(
      "attachments/th_x9y8/2026-07-19T10%3A05%3A00Z/shot.png",
    );
  });

  it("encodes a non-ASCII name", () => {
    expect(attachmentTarget(THREAD, TS, "café.png")).toBe(
      "attachments/th_x9y8/2026-07-19T10%3A05%3A00Z/caf%C3%A9.png",
    );
  });

  it("round-trips through the serve route's decoder, segment for segment", () => {
    for (const name of ["shot.png", "café.png", "a..b.png", "v1.2.3.tar", "file-2"]) {
      const target = attachmentTarget(THREAD, TS, name);
      expect(parseAttachmentPath(`/${target}`)).toEqual([THREAD, TS, name]);
    }
  });
});

describe("attachmentReference", () => {
  it("renders images with a bang and everything else without", () => {
    expect(attachmentReference(THREAD, TS, "shot.png")).toBe(
      "![shot.png](attachments/th_x9y8/2026-07-19T10%3A05%3A00Z/shot.png)",
    );
    expect(attachmentReference(THREAD, TS, "notes.pdf")).toBe(
      "[notes.pdf](attachments/th_x9y8/2026-07-19T10%3A05%3A00Z/notes.pdf)",
    );
  });

  it("keeps the display text human-readable while the target is encoded", () => {
    expect(attachmentReference(THREAD, TS, "café.png")).toContain("![café.png](");
  });
});

describe("withAttachmentReferences", () => {
  it("separates the text from the block by exactly one blank line", () => {
    expect(withAttachmentReferences("see attached", ["![a](x)", "[b](y)"])).toBe(
      "see attached\n\n![a](x)\n[b](y)",
    );
  });

  it("is the block alone for an attachment-only turn — no leading blank line", () => {
    expect(withAttachmentReferences(undefined, ["![a](x)"])).toBe("![a](x)");
    expect(withAttachmentReferences("   ", ["![a](x)"])).toBe("![a](x)");
  });

  it("leaves a fileless turn's text untouched, with no trailing blank line", () => {
    expect(withAttachmentReferences("plain", [])).toBe("plain");
    expect(withAttachmentReferences(undefined, [])).toBe("");
  });

  it("keeps upload order", () => {
    expect(attachmentReferences(THREAD, TS, ["one.png", "two.pdf", "three.gif"])).toEqual([
      attachmentReference(THREAD, TS, "one.png"),
      attachmentReference(THREAD, TS, "two.pdf"),
      attachmentReference(THREAD, TS, "three.gif"),
    ]);
  });
});
