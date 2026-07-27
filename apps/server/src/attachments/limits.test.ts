import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import {
  DEFAULT_ATTACHMENT_LIMITS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  assertWithinLimits,
  formatBytes,
} from "./limits.js";

const file = (name: string, bytes: number): File =>
  new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" });

describe("the shipped defaults", () => {
  it("are 25 MB per file and 100 MB per request", () => {
    expect(DEFAULT_MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    expect(DEFAULT_MAX_REQUEST_BYTES).toBe(100 * 1024 * 1024);
    expect(DEFAULT_ATTACHMENT_LIMITS).toEqual({
      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
      maxRequestBytes: DEFAULT_MAX_REQUEST_BYTES,
    });
  });
});

describe("formatBytes", () => {
  it.each([
    [25 * 1024 * 1024, "25 MB"],
    [Math.round(1.5 * 1024 * 1024), "1.5 MB"],
    [2048, "2.0 KB"],
    [17, "17 bytes"],
  ])("%i -> %j", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("assertWithinLimits", () => {
  const limits = { maxFileBytes: 100, maxRequestBytes: 150 };

  it("accepts an upload inside both caps", () => {
    expect(() => {
      assertWithinLimits([file("a.png", 100), file("b.png", 50)], limits);
    }).not.toThrow();
  });

  it("refuses an over-cap file with a 400 naming the file and the cap", () => {
    try {
      assertWithinLimits([file("huge.png", 101)], limits);
      expect.unreachable("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const http = error as HttpError;
      // Sprint-007 Open Conflict 5b: the declared 400, not an undeclared 413.
      expect(http.status).toBe(400);
      expect(http.message).toContain("huge.png");
      expect(http.message).toContain("100 bytes");
      expect(http.body).toMatchObject({ code: "bad_request" });
    }
  });

  it("refuses an over-cap total made of individually legal files", () => {
    try {
      assertWithinLimits([file("a.png", 100), file("b.png", 51)], limits);
      expect.unreachable("expected a refusal");
    } catch (error) {
      const http = error as HttpError;
      expect(http.status).toBe(400);
      expect(http.message).toContain("per-request limit");
    }
  });

  it("accepts a zero-byte file", () => {
    expect(() => {
      assertWithinLimits([file("empty.txt", 0)], limits);
    }).not.toThrow();
  });
});
