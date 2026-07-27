import { describe, expect, it } from "vitest";
import {
  FALLBACK_NAME,
  MAX_NAME_LENGTH,
  dedupeName,
  sanitizeAttachmentName,
  storedNames,
} from "./names.js";

/** The properties every stored name has, whatever it was called on the way in. */
const assertSafe = (name: string): void => {
  expect(name).not.toBe("");
  expect(name).not.toBe(".");
  expect(name).not.toBe("..");
  expect(name.startsWith(".")).toBe(false);
  expect(name).not.toMatch(/[/\\]/);
  // Checked by code point rather than by regex: a control-character class is
  // exactly what `no-control-regex` exists to flag, and the property under test
  // is "no control code point survives", which reads better as the loop it is.
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    expect(code).toBeGreaterThan(0x1f);
    expect(code < 0x7f || code > 0x9f).toBe(true);
  }
  expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
};

describe("sanitizeAttachmentName", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["a/b/c.png", "c.png"],
    ["..\\..\\windows\\system32\\cmd.exe", "cmd.exe"],
    ["  .hidden", "hidden"],
    [".....", FALLBACK_NAME],
    [".", FALLBACK_NAME],
    ["..", FALLBACK_NAME],
    ["", FALLBACK_NAME],
    ["   ", FALLBACK_NAME],
    ["my shot.png", "my-shot.png"],
    ["a#b.png", "a-b.png"],
    ["q?x.png", "q-x.png"],
    // The `)` before the dot is a disallowed character like any other, so it
    // becomes a `-`; only a *trailing* run of `.`/`-` is stripped.
    ["report (final).pdf", "report-final-.pdf"],
    ["a..b.png", "a..b.png"],
    ["v1.2.3.tar", "v1.2.3.tar"],
    ["shot.PNG", "shot.PNG"],
    ["résumé.pdf", "résumé.pdf"],
    ["日本語.txt", "日本語.txt"],
  ])("%j -> %j", (raw, expected) => {
    expect(sanitizeAttachmentName(raw)).toBe(expected);
    assertSafe(sanitizeAttachmentName(raw));
  });

  it("strips NUL and control bytes rather than turning them into separators", () => {
    const name = sanitizeAttachmentName("sh\u0000ot\u0007.png");
    expect(name).toBe("shot.png");
    assertSafe(name);
  });

  it("normalises NFD to NFC, so one filename is one byte string", () => {
    const decomposed = "cafe\u0301.png";
    expect(decomposed.normalize("NFC")).not.toBe(decomposed);
    expect(sanitizeAttachmentName(decomposed)).toBe("café.png");
  });

  it("truncates a 300-character name but keeps its extension", () => {
    const name = sanitizeAttachmentName(`${"a".repeat(300)}.png`);
    expect(name.length).toBe(MAX_NAME_LENGTH);
    expect(name.endsWith(".png")).toBe(true);
    assertSafe(name);
  });

  it("truncates a long name with no usable extension", () => {
    const name = sanitizeAttachmentName("b".repeat(300));
    expect(name).toBe("b".repeat(MAX_NAME_LENGTH));
  });

  it("never cuts a surrogate pair in half", () => {
    // U+1D400 MATHEMATICAL BOLD CAPITAL A is `\p{L}`, so it survives the
    // allow-list — and is two UTF-16 units, so a naive slice can strand one.
    const astral = "\u{1D400}".repeat(200);
    for (const raw of [astral, `${astral}.png`, `x${astral}`]) {
      const name = sanitizeAttachmentName(raw);
      expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(name).toBe(name.normalize("NFC"));
      for (const code of [...name].map((character) => character.codePointAt(0) ?? 0)) {
        expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
      }
    }
  });

  it("ignores a 'extension' too long to be one", () => {
    const name = sanitizeAttachmentName(`${"c".repeat(200)}.${"d".repeat(40)}`);
    expect(name.length).toBe(MAX_NAME_LENGTH);
    assertSafe(name);
  });
});

describe("dedupeName", () => {
  it("suffixes before the extension, counting up", () => {
    expect(dedupeName("shot.png", new Set())).toBe("shot.png");
    expect(dedupeName("shot.png", new Set(["shot.png"]))).toBe("shot-2.png");
    expect(dedupeName("shot.png", new Set(["shot.png", "shot-2.png"]))).toBe("shot-3.png");
  });

  it("suffixes an extension-less name at the end", () => {
    expect(dedupeName(FALLBACK_NAME, new Set([FALLBACK_NAME]))).toBe("file-2");
  });

  it("collides case-insensitively, because the filesystem may", () => {
    expect(dedupeName("Shot.png", new Set(["shot.png"]))).toBe("Shot-2.png");
  });

  // Regression: appending the marker and then truncating made every candidate
  // equal the taken name, so this call never returned — a hang reachable from
  // two uploads whose sanitized names are both 100 characters long.
  it("terminates for a name already at the length limit, and stays within it", () => {
    const long = sanitizeAttachmentName(`${"a".repeat(300)}.png`);
    expect(long.length).toBe(MAX_NAME_LENGTH);

    const taken = new Set([long]);
    for (let index = 0; index < 12; index += 1) {
      const deduped = dedupeName(long, taken);
      expect(deduped.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(deduped.endsWith(".png")).toBe(true);
      expect(taken.has(deduped)).toBe(false);
      taken.add(deduped);
    }
    expect(taken.size).toBe(13);
  });

  it("terminates when the extension leaves no room for a stem", () => {
    const name = `${"b".repeat(MAX_NAME_LENGTH - 16)}.${"c".repeat(15)}`;
    const deduped = dedupeName(name, new Set([name]));
    expect(deduped.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(deduped).not.toBe(name);
  });
});

describe("storedNames", () => {
  it("resolves three identical uploads in order", () => {
    expect(storedNames(["shot.png", "shot.png", "shot.png"])).toEqual([
      "shot.png",
      "shot-2.png",
      "shot-3.png",
    ]);
  });

  it("collides two unusable names onto the fallback and suffixes the second", () => {
    expect(storedNames(["...", "/"])).toEqual(["file", "file-2"]);
  });

  it("keeps every result unique and safe for an adversarial batch", () => {
    const names = storedNames([
      "../../etc/passwd",
      "../../etc/passwd",
      "a/b/c.png",
      "\u0000\u001f",
      "",
      `${"z".repeat(300)}.png`,
      `${"z".repeat(300)}.png`,
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) assertSafe(name);
  });
});
