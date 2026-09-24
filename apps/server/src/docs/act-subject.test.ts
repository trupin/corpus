import { describe, expect, it } from "vitest";
import {
  archiveSubjectVerb,
  documentSubject,
  statusMoveSubjectVerb,
  threadStatusSubjectVerb,
} from "./act-subject.js";

describe("documentSubject", () => {
  it("writes `<verb>: <title> (<id>) by <actor>`", () => {
    expect(documentSubject("doc archive", "Pricing", "doc_a1", "user")).toBe(
      "doc archive: Pricing (doc_a1) by user",
    );
  });
});

describe("statusMoveSubjectVerb — the dedicated verb's name for each move", () => {
  it.each([
    ["note", "open", "archived", "doc archive"],
    ["note", "resolved", "archived", "doc archive"],
    ["thread", "open", "archived", "doc archive"],
    ["note", "archived", "open", "doc unarchive"],
    ["note", "archived", "resolved", "doc unarchive"],
    ["thread", "open", "resolved", "thread resolve"],
    ["thread", "resolved", "open", "thread reopen"],
    ["note", "open", "resolved", "doc resolve"],
    ["board", "resolved", "open", "doc reopen"],
  ] as const)("%s %s → %s is `%s`", (type, from, to, verb) => {
    expect(statusMoveSubjectVerb(type, from, to)).toBe(verb);
  });

  it("answers a non-move as a plain edit", () => {
    expect(statusMoveSubjectVerb("note", "open", "open")).toBe("doc edit");
  });

  it("agrees with the verbs' own names", () => {
    expect(statusMoveSubjectVerb("note", "open", "archived")).toBe(archiveSubjectVerb(true));
    expect(statusMoveSubjectVerb("note", "archived", "open")).toBe(archiveSubjectVerb(false));
    expect(statusMoveSubjectVerb("thread", "open", "resolved")).toBe(
      threadStatusSubjectVerb("resolved"),
    );
    expect(statusMoveSubjectVerb("thread", "resolved", "open")).toBe(
      threadStatusSubjectVerb("open"),
    );
  });
});
