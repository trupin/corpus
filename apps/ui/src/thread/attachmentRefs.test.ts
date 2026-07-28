import { describe, expect, it } from "vitest";
import { splitTurnAttachments } from "./attachmentRefs";

/**
 * The inverse of the server's `withAttachmentReferences`
 * (`apps/server/src/attachments/references.ts`).
 */
describe("splitTurnAttachments", () => {
  it("separates the trailing reference block from the prose", () => {
    const body = [
      "Here is the quote and the policy.",
      "",
      "![shot.png](attachments/th_a/2026-07-19T10%3A05%3A00.000Z/shot.png)",
      "[policy.pdf](attachments/th_a/2026-07-19T10%3A05%3A00.000Z/policy.pdf)",
    ].join("\n");

    const { prose, attachments } = splitTurnAttachments(body);
    expect(prose).toBe("Here is the quote and the policy.");
    expect(attachments).toEqual([
      {
        isImage: true,
        name: "shot.png",
        target: "attachments/th_a/2026-07-19T10%3A05%3A00.000Z/shot.png",
      },
      {
        isImage: false,
        name: "policy.pdf",
        target: "attachments/th_a/2026-07-19T10%3A05%3A00.000Z/policy.pdf",
      },
    ]);
  });

  /** An attachment-only turn is the references alone, with no empty paragraph. */
  it("handles an attachment-only turn", () => {
    const { prose, attachments } = splitTurnAttachments("![shot.png](attachments/th_a/t/shot.png)");
    expect(prose).toBe("");
    expect(attachments).toHaveLength(1);
  });

  it("leaves a reference written inside the prose where the author put it", () => {
    const body = "See ![shot.png](attachments/th_a/t/shot.png) in context.";
    const { prose, attachments } = splitTurnAttachments(body);
    expect(prose).toBe(body);
    expect(attachments).toHaveLength(0);
  });

  it("ignores links that are not attachments", () => {
    const body = "Read [the docs](https://example.com/docs)";
    expect(splitTurnAttachments(body)).toEqual({ prose: body, attachments: [] });
  });

  it("returns an ordinary turn untouched", () => {
    expect(splitTurnAttachments("just words")).toEqual({
      prose: "just words",
      attachments: [],
    });
  });
});
