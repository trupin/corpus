import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTENT_TYPE,
  contentTypeOf,
  extensionOf,
  isImageName,
  isInlineDisposition,
} from "./mime.js";

describe("extensionOf", () => {
  it.each([
    ["shot.png", "png"],
    ["shot.PNG", "png"],
    ["v1.2.3.tar", "tar"],
    ["a..b.png", "png"],
    ["noextension", ""],
    [".hidden", ""],
  ])("%j -> %j", (name, expected) => {
    expect(extensionOf(name)).toBe(expected);
  });
});

describe("contentTypeOf", () => {
  it.each([
    ["shot.png", "image/png"],
    ["shot.jpg", "image/jpeg"],
    ["shot.jpeg", "image/jpeg"],
    ["shot.gif", "image/gif"],
    ["shot.webp", "image/webp"],
    ["shot.avif", "image/avif"],
    ["drawing.svg", "image/svg+xml"],
    ["notes.pdf", "application/pdf"],
    ["notes.txt", "text/plain; charset=utf-8"],
    ["notes.md", "text/markdown; charset=utf-8"],
    ["mystery.wat", DEFAULT_CONTENT_TYPE],
    ["noextension", DEFAULT_CONTENT_TYPE],
  ])("%j -> %j", (name, expected) => {
    expect(contentTypeOf(name)).toBe(expected);
  });
});

describe("image-ness", () => {
  it.each(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"])(
    "%s renders as an image",
    (extension) => {
      expect(isImageName(`shot.${extension}`)).toBe(true);
    },
  );

  it.each(["pdf", "txt", "md", "zip", "wat"])("%s does not", (extension) => {
    expect(isImageName(`file.${extension}`)).toBe(false);
  });

  it("is decided by the extension alone — the client's MIME type is never consulted", () => {
    // Both signatures take a name and nothing else: there is no parameter a
    // caller could pass a `content-type` through.
    expect(isImageName("shot.png")).toBe(true);
    expect(isImageName("notes.pdf")).toBe(false);
  });

  it("serves SVG as a download even though it is an image", () => {
    expect(isImageName("drawing.svg")).toBe(true);
    expect(isInlineDisposition("drawing.svg")).toBe(false);
    expect(isInlineDisposition("shot.png")).toBe(true);
    expect(isInlineDisposition("notes.pdf")).toBe(false);
  });
});
