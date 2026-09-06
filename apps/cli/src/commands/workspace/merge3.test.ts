import { describe, expect, it } from "vitest";
import { mergeThreeWay } from "./merge3.js";

/**
 * The three-way decision, exhausted as a pure function — the same split
 * `template/plan.test.ts` makes: `merge.test.ts` proves the verb's behaviour
 * on disk and over the wire, this file proves every classification the merge
 * can reach, including the two deliberate departures from `git merge-file`.
 */

const BASE = "one\ntwo\nthree\nfour\nfive\n";

describe("mergeThreeWay", () => {
  it("merges non-overlapping additions from both sides", () => {
    const ours = "one\ntwo\nours added\nthree\nfour\nfive\n";
    const theirs = "one\ntwo\nthree\nfour\ntheirs added\nfive\n";

    const merge = mergeThreeWay(BASE, ours, theirs);
    expect(merge.clean).toBe(true);
    expect(merge.result).toBe("one\ntwo\nours added\nthree\nfour\ntheirs added\nfive\n");
    expect(merge.incoming).toBe(1);
    expect(merge.local).toBe(1);
  });

  it("keeps the workspace's lines where only the workspace moved", () => {
    const ours = "one\ntwo edited\nthree\nfour\nfive\n";
    const merge = mergeThreeWay(BASE, ours, BASE);
    expect(merge.clean).toBe(true);
    expect(merge.result).toBe(ours);
    expect(merge.incoming).toBe(0);
  });

  it("takes the tool's replacement where only the tool moved", () => {
    const theirs = "one\ntwo rewritten\nthree\nfour\nfive\n";
    const merge = mergeThreeWay(BASE, BASE, theirs);
    expect(merge.clean).toBe(true);
    expect(merge.result).toBe(theirs);
  });

  it("collapses an identical change made by both sides", () => {
    const both = "one\ntwo\nthree\nfour\nfive\nsame new line\n";
    const merge = mergeThreeWay(BASE, both, both);
    expect(merge.clean).toBe(true);
    expect(merge.result).toBe(both);
    expect(merge.chunks.some((chunk) => chunk.kind === "agreement")).toBe(true);
  });

  it("conflicts where both sides changed the same region differently", () => {
    const ours = "one\ntwo ours\nthree\nfour\nfive\n";
    const theirs = "one\ntwo theirs\nthree\nfour\nfive\n";

    const merge = mergeThreeWay(BASE, ours, theirs);
    expect(merge.clean).toBe(false);
    expect(merge.result).toBeNull();
    const conflict = merge.chunks.find((chunk) => chunk.kind === "conflict");
    expect(conflict).toMatchObject({
      base: ["two\n"],
      ours: ["two ours\n"],
      theirs: ["two theirs\n"],
      oursLine: 2,
    });
  });

  it("never auto-applies a pure upstream deletion: the baseline-only hunk is ambiguous", () => {
    // The trap (CLI-082): in the baseline and in the workspace, absent from the
    // tool's copy. `git merge-file` deletes it; this merge refuses to decide.
    const theirs = "one\ntwo\nfive\n";
    const merge = mergeThreeWay(BASE, BASE, theirs);

    expect(merge.clean).toBe(false);
    expect(merge.result).toBeNull();
    const ambiguous = merge.chunks.find((chunk) => chunk.kind === "ambiguous-deletion");
    expect(ambiguous).toMatchObject({ base: ["three\n", "four\n"], oursLine: 3 });
    expect(merge.chunks.some((chunk) => chunk.kind === "conflict")).toBe(false);
  });

  it("still applies an upstream replacement — deleting-and-writing is not the trap", () => {
    const theirs = "one\ntwo\nreplacement\nfive\n";
    const merge = mergeThreeWay(BASE, BASE, theirs);
    expect(merge.clean).toBe(true);
    expect(merge.result).toBe(theirs);
  });

  it("treats touching hunks as one group rather than inventing an order", () => {
    // Both sides insert at the same boundary: no honest interleaving exists.
    const ours = "one\ntwo\nours insert\nthree\nfour\nfive\n";
    const theirs = "one\ntwo\ntheirs insert\nthree\nfour\nfive\n";
    const merge = mergeThreeWay(BASE, ours, theirs);
    expect(merge.clean).toBe(false);
    expect(merge.chunks.some((chunk) => chunk.kind === "conflict")).toBe(true);
  });

  it("answers identical inputs with the input and no work", () => {
    const merge = mergeThreeWay(BASE, BASE, BASE);
    expect(merge.clean).toBe(true);
    expect(merge.result).toBe(BASE);
    expect(merge.incoming).toBe(0);
    expect(merge.local).toBe(0);
  });

  it("numbers conflict hunks by the workspace copy's own lines", () => {
    // An earlier local insertion shifts everything below it in the workspace
    // copy; the reported line must be the workspace's, not the baseline's.
    const ours = "inserted at top\none\ntwo\nthree\nfour ours\nfive\n";
    const theirs = "one\ntwo\nthree\nfour theirs\nfive\n";
    const merge = mergeThreeWay(BASE, ours, theirs);
    const conflict = merge.chunks.find((chunk) => chunk.kind === "conflict");
    expect(conflict).toMatchObject({ oursLine: 5 });
  });

  it("handles a file that does not end in a newline without equating it to one that does", () => {
    const merge = mergeThreeWay("a\nb", "a\nb", "a\nb\nc");
    expect(merge.clean).toBe(true);
    expect(merge.result).toBe("a\nb\nc");
  });
});
