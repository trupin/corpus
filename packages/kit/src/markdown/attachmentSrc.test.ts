import { describe, expect, it } from "vitest";
import { ATTACHMENT_PREFIX, attachmentTarget } from "./attachmentSrc.js";

describe("attachmentTarget", () => {
  it.each([
    ["attachments/th_a/2026-07-01T09%3A05%3A00.000Z/shot.png"],
    ["attachments/th_a/t/name%20with%20space.png"],
    ["attachments/single.png"],
  ])("takes a workspace reference as written: %s", (src) => {
    expect(attachmentTarget(src)).toBe(src);
  });

  it.each([
    ["./attachments/th_a/t/shot.png", "attachments/th_a/t/shot.png"],
    ["/attachments/th_a/t/shot.png", "attachments/th_a/t/shot.png"],
    ["  attachments/th_a/t/shot.png  ", "attachments/th_a/t/shot.png"],
  ])("normalises %s to the server-relative target", (src, expected) => {
    expect(attachmentTarget(src)).toBe(expected);
  });

  /**
   * The "leave it exactly alone" answer. Every one of these already renders,
   * and none of them is behind the workspace token.
   */
  it.each([
    ["https://example.com/a.png"],
    ["HTTP://example.com/attachments/a.png"],
    ["data:image/png;base64,iVBORw0KGgo="],
    ["blob:http://127.0.0.1:8765/2b0f"],
    ["assets/diagram.png"],
    ["./figures/plot.svg"],
    [""],
    ["   "],
  ])("declines %s", (src) => {
    expect(attachmentTarget(src)).toBeNull();
  });

  /** Another origin wearing a familiar path: the token must not follow it. */
  it("declines a protocol-relative host", () => {
    expect(attachmentTarget("//evil.example/attachments/a.png")).toBeNull();
  });

  /**
   * `new URL(target, origin)` collapses dot segments **before** the request is
   * sent, so a `..` in a body would aim an authenticated read at an unrelated
   * route on the workspace server.
   */
  it.each([
    ["attachments/../api/docs"],
    ["attachments/th_a/../../etc/passwd"],
    ["/attachments/.."],
  ])("declines the traversal %s", (src) => {
    expect(attachmentTarget(src)).toBeNull();
  });

  it("declines the bare prefix, which addresses no file", () => {
    expect(attachmentTarget(ATTACHMENT_PREFIX)).toBeNull();
    expect(attachmentTarget("attachments")).toBeNull();
  });
});
