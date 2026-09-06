import { PRESENTATION_FRONTMATTER_KEYS, SERVER_STAMPED_FRONTMATTER_KEYS } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { sha256 } from "./manifest.js";
import {
  ignoredKeyDelta,
  normalizeIgnoredKeys,
  normalizedSha256,
  preserveUpgradeIgnoredKeys,
  UPGRADE_IGNORED_KEYS,
} from "./ignored-keys.js";

const doc = (frontmatter: readonly string[], body = "The body.\n"): string =>
  ["---", ...frontmatter, "---", "", body].join("\n");

const BASE = doc(["id: doc_1", "type: note", "title: Inbox"]);

describe("UPGRADE_IGNORED_KEYS", () => {
  it("is exactly the contract's two classes, unioned — no key of its own", () => {
    // The drift test the other way lives beside the server
    // (`frontmatter-key-classes.test.ts`): here the union must add nothing and
    // drop nothing relative to the contract's declarations, because a key
    // ignored by the comparison but stamped by nobody — or the reverse — is two
    // answers to one question.
    expect([...UPGRADE_IGNORED_KEYS].sort()).toEqual(
      [...SERVER_STAMPED_FRONTMATTER_KEYS, ...PRESENTATION_FRONTMATTER_KEYS].sort(),
    );
  });

  it.each([...UPGRADE_IGNORED_KEYS])(
    "normalizes away a %s-only delta — the mechanism follows the contract's list",
    (key) => {
      // Driven from the declaration, never a restated list: a key added in the
      // contract is exercised here without this file changing, and a mechanism
      // that stopped covering it fails by name.
      const stamped = doc(["id: doc_1", "type: note", "title: Inbox", `${key}: some-value`]);
      expect(normalizeIgnoredKeys(stamped)).toBe(normalizeIgnoredKeys(BASE));
      expect(normalizedSha256(Buffer.from(stamped))).toBe(normalizedSha256(Buffer.from(BASE)));
    },
  );
});

describe("normalizeIgnoredKeys", () => {
  it("differing values of an ignored key normalize equal", () => {
    const one = doc(["id: doc_1", "updated: 2026-07-26T00:00:00Z"]);
    const other = doc(["id: doc_1", "updated: 2026-09-06T10:11:12Z"]);
    expect(normalizedSha256(Buffer.from(one))).toBe(normalizedSha256(Buffer.from(other)));
  });

  it("leaves every other byte alone — body, comments, formatting", () => {
    const text = doc(
      ["id: doc_1", "updated: 2026-07-26T00:00:00Z", "# a comment", "tags: [a, b]"],
      "Body with `updated:` prose that must survive.\n",
    );
    expect(normalizeIgnoredKeys(text)).toBe(
      doc(
        ["id: doc_1", "# a comment", "tags: [a, b]"],
        "Body with `updated:` prose that must survive.\n",
      ),
    );
  });

  it("a real edit still reads as a difference", () => {
    const one = doc(["id: doc_1", "updated: 2026-07-26T00:00:00Z"], "One body.\n");
    const other = doc(["id: doc_1", "updated: 2026-09-06T10:11:12Z"], "Another body.\n");
    expect(normalizedSha256(Buffer.from(one))).not.toBe(normalizedSha256(Buffer.from(other)));
  });

  it("drops only top-level keys, never a nested or prose occurrence", () => {
    const text = doc(["id: doc_1", "extra:", "  width: 9", "  updated: nested"], "width: 5\n");
    expect(normalizeIgnoredKeys(text)).toBe(text);
  });

  it("drops an ignored key's indented continuation lines with it", () => {
    const text = doc(["id: doc_1", "updated: >-", "  2026-07-26", "title: Inbox"]);
    expect(normalizeIgnoredKeys(text)).toBe(doc(["id: doc_1", "title: Inbox"]));
  });

  it("touches only the frontmatter block, and only when there is one", () => {
    const plain = "no frontmatter\nupdated: not-a-key\n";
    expect(normalizeIgnoredKeys(plain)).toBe(plain);
    const unterminated = "---\nupdated: x\nno closing fence\n";
    expect(normalizeIgnoredKeys(unterminated)).toBe(unterminated);
    const afterBody = "body first\n---\nupdated: x\n---\n";
    expect(normalizeIgnoredKeys(afterBody)).toBe(afterBody);
  });

  it("handles CRLF fences and a BOM the way the CLI's frontmatter reader does", () => {
    const crlf = "---\r\nid: doc_1\r\nupdated: 2026-07-26T00:00:00Z\r\n---\r\nBody.\r\n";
    expect(normalizeIgnoredKeys(crlf)).toBe("---\r\nid: doc_1\r\n---\r\nBody.\r\n");
    const bom = "﻿---\nupdated: x\n---\nBody.\n";
    expect(normalizeIgnoredKeys(bom)).toBe("﻿---\n---\nBody.\n");
  });
});

describe("preserveUpgradeIgnoredKeys", () => {
  const template = doc(
    [
      "id: doc_1",
      "type: note",
      "title: Inbox",
      "created: 2026-07-26T00:00:00Z",
      "updated: 2026-07-26T00:00:00Z",
    ],
    "New template body.\n",
  );

  it("replaces the template's value with the workspace's, in place", () => {
    const workspace = doc(
      [
        "id: doc_1",
        "type: note",
        "title: Inbox",
        "created: 2026-07-26T00:00:00Z",
        "updated: 2026-09-06T10:11:12Z",
      ],
      "Old body the workspace never edited.\n",
    );
    const written = preserveUpgradeIgnoredKeys(template, workspace);
    expect(written).toBe(
      doc(
        [
          "id: doc_1",
          "type: note",
          "title: Inbox",
          "created: 2026-07-26T00:00:00Z",
          "updated: 2026-09-06T10:11:12Z",
        ],
        "New template body.\n",
      ),
    );
    // The template's fixed seed date is gone: `updated` never moves backwards
    // (sprint-024 P5, TEST-1094).
    expect(written).not.toContain("updated: 2026-07-26T00:00:00Z");
  });

  it("appends a key the template does not carry, before the closing fence", () => {
    // TEST-1099's shape: no template ships a `width:`, and the resize must
    // survive the write that ignoring it enabled.
    const workspace = doc(["id: doc_1", "type: note", "title: Inbox", "width: 686"]);
    const written = preserveUpgradeIgnoredKeys(template, workspace);
    expect(written).toBe(
      doc(
        [
          "id: doc_1",
          "type: note",
          "title: Inbox",
          "created: 2026-07-26T00:00:00Z",
          "updated: 2026-07-26T00:00:00Z",
          "width: 686",
        ],
        "New template body.\n",
      ),
    );
  });

  it("keeps the template's value for a key the workspace copy does not carry", () => {
    // Preserving is not deleting: a workspace copy with no `updated` leaves the
    // template's own line where it is.
    const workspace = doc(["id: doc_1", "type: note", "title: Inbox"]);
    expect(preserveUpgradeIgnoredKeys(template, workspace)).toBe(template);
  });

  it("writes bytes that normalize back to the template's own identity", () => {
    // The invariant the manifest relies on: the merge differs from the template
    // in ignored keys only, so the next run's comparison reads it as current.
    const workspace = doc(["id: doc_1", "updated: 2026-09-06T10:11:12Z", "width: 686"]);
    const written = preserveUpgradeIgnoredKeys(template, workspace);
    expect(normalizedSha256(Buffer.from(written))).toBe(normalizedSha256(Buffer.from(template)));
    expect(sha256(Buffer.from(written))).not.toBe(sha256(Buffer.from(template)));
  });

  it("returns the template unchanged when either side has no frontmatter block", () => {
    expect(preserveUpgradeIgnoredKeys("plain file\n", BASE)).toBe("plain file\n");
    expect(preserveUpgradeIgnoredKeys(template, "plain file\n")).toBe(template);
  });
});

describe("ignoredKeyDelta", () => {
  it("names the keys in which two copies differ, in the contract's order", () => {
    const one = doc(["id: doc_1", "updated: 2026-07-26T00:00:00Z"]);
    const other = doc(["id: doc_1", "updated: 2026-09-06T10:11:12Z", "width: 686"]);
    expect(ignoredKeyDelta(one, other)).toEqual(["updated", "width"]);
  });

  it("is empty when every ignored key reads the same", () => {
    const one = doc(["id: doc_1", "updated: 2026-07-26T00:00:00Z"], "One body.\n");
    const other = doc(["id: doc_1", "updated: 2026-07-26T00:00:00Z"], "Another body.\n");
    expect(ignoredKeyDelta(one, other)).toEqual([]);
  });
});
