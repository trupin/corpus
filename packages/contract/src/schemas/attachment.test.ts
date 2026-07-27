import { describe, expect, it } from "vitest";
import { AttachmentFilesSchema, AttachmentFileSchema, AttachmentPathSchema } from "./attachment.js";

const png = () => new File(["bytes"], "screenshot.png", { type: "image/png" });

describe("AttachmentFile", () => {
  it("accepts an uploaded file part", () => {
    const file = png();
    expect(AttachmentFileSchema.parse(file)).toBe(file);
  });

  it.each([
    ["a filename string", "screenshot.png"],
    ["a plain object", { name: "screenshot.png" }],
    ["null", null],
  ])("rejects %s, which is not a file part", (_label, value) => {
    expect(AttachmentFileSchema.safeParse(value).success).toBe(false);
  });
});

/**
 * Hono's form parser hands back a bare `File` for the first occurrence of a key
 * and an array only from the second onwards, so the single-attachment case — the
 * common one — would otherwise fail validation.
 */
describe("AttachmentFiles normalisation", () => {
  it("wraps a single file part into an array", () => {
    const file = png();
    expect(AttachmentFilesSchema.parse(file)).toEqual([file]);
  });

  it("passes an array of file parts through", () => {
    const files = [png(), png()];
    expect(AttachmentFilesSchema.parse(files)).toEqual(files);
  });

  it("defaults to an empty array when no files were sent", () => {
    expect(AttachmentFilesSchema.parse(undefined)).toEqual([]);
  });

  it("rejects a non-file part rather than silently dropping it", () => {
    expect(AttachmentFilesSchema.safeParse("screenshot.png").success).toBe(false);
    expect(AttachmentFilesSchema.safeParse([png(), "nope"]).success).toBe(false);
  });
});

describe("AttachmentPath", () => {
  it("accepts the slash-bearing storage path", () => {
    const path = "th_x9y8/2026-07-19T10:05:00Z/screenshot.png";
    expect(AttachmentPathSchema.parse(path)).toBe(path);
  });

  it("rejects an empty path", () => {
    expect(AttachmentPathSchema.safeParse("").success).toBe(false);
  });
});
