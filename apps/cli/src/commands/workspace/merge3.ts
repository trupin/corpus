import { diffOps, splitLines } from "./unified-diff.js";

/**
 * The three-way text merge behind `corpus workspace merge` (CLI-082), as a
 * pure function over three strings — the same reasoning as `template/plan.ts`:
 * the interesting part is the decision, and a decision that needs a filesystem
 * to test is a decision nobody exhaustively tests.
 *
 * The algorithm is ordinary diff3: diff base→ours and base→theirs with the
 * aligner `corpus workspace diff` already prints from (`unified-diff.ts`),
 * group the two hunk streams wherever their base ranges overlap **or touch**,
 * and classify each group. Touching hunks group on purpose — it is the
 * conservative reading, and a merge of two prose skills that reports one
 * conflict too many is recoverable, while one that interleaves two edits at
 * the same boundary in a made-up order is not.
 *
 * Two classifications are deliberately not what `git merge-file` would do:
 *
 * - **A pure upstream deletion of a block ours did not touch is *ambiguous*,
 *   never applied** ({@link MergeChunk} kind `ambiguous-deletion`). The
 *   recorded baseline of a modified file can itself be post-modification
 *   (`--adopt` records the copy as it stood), so a local block older than the
 *   baseline is indistinguishable from an upstream deletion — and the classic
 *   three-way silently deletes it, which is exactly how the reporting incident
 *   lost a block of the comment skill to a hand-run `git merge-file`. The tool
 *   cannot tell which it is, so it says so on the hunk and picks no side.
 * - **An upstream *replacement* still applies.** Where theirs replaced the
 *   block with something, upstream demonstrably touched that region, and the
 *   ambiguity above does not arise.
 */

export type MergeChunk =
  /** Identical in all three copies. */
  | { readonly kind: "stable"; readonly lines: readonly string[]; readonly oursLine: number }
  /** Only this workspace changed it → the workspace's lines stand. */
  | { readonly kind: "ours"; readonly lines: readonly string[]; readonly oursLine: number }
  /** Only the tool changed it → the tool's lines come in. */
  | { readonly kind: "theirs"; readonly lines: readonly string[]; readonly oursLine: number }
  /** Both changed it identically → either side's lines, once. */
  | { readonly kind: "agreement"; readonly lines: readonly string[]; readonly oursLine: number }
  /**
   * In the baseline and in the workspace, absent from the tool's copy: an
   * upstream deletion or a pre-baseline local edit, and the tool cannot tell
   * which. Unresolved by design — no side is picked.
   */
  | {
      readonly kind: "ambiguous-deletion";
      readonly base: readonly string[];
      /** 1-based first line of the block in the workspace copy. */
      readonly oursLine: number;
    }
  /** Both changed the same region differently: somebody's to resolve. */
  | {
      readonly kind: "conflict";
      readonly base: readonly string[];
      readonly ours: readonly string[];
      readonly theirs: readonly string[];
      /** 1-based first line of the region in the workspace copy. */
      readonly oursLine: number;
    };

export interface ThreeWayMerge {
  readonly chunks: readonly MergeChunk[];
  /** No conflict and no ambiguous deletion: {@link result} is the whole answer. */
  readonly clean: boolean;
  /** The merged text — only when {@link clean}; a conflicted merge has no single answer. */
  readonly result: string | null;
  /** Count of chunks where the tool's copy decided the lines (`theirs` + `agreement`). */
  readonly incoming: number;
  /** Count of chunks where only this workspace's lines stand (`ours`). */
  readonly local: number;
  /** True when either aligner degraded to whole-file replacement (pathological inputs). */
  readonly coarse: boolean;
}

interface Hunk {
  readonly baseStart: number;
  readonly baseEnd: number;
  readonly sideStart: number;
  readonly sideEnd: number;
}

/** A classified group before its workspace line number is known. */
type Classified =
  | { readonly kind: "ours" | "theirs" | "agreement"; readonly lines: readonly string[] }
  | { readonly kind: "ambiguous-deletion"; readonly base: readonly string[] }
  | {
      readonly kind: "conflict";
      readonly base: readonly string[];
      readonly ours: readonly string[];
      readonly theirs: readonly string[];
    };

export function mergeThreeWay(base: string, ours: string, theirs: string): ThreeWayMerge {
  const baseLines = splitLines(base);
  const oursLines = splitLines(ours);
  const theirsLines = splitLines(theirs);

  const oursDiff = diffOps(baseLines, oursLines);
  const theirsDiff = diffOps(baseLines, theirsLines);
  const oursHunks = hunksOf(oursDiff.ops);
  const theirsHunks = hunksOf(theirsDiff.ops);

  const chunks: MergeChunk[] = [];
  let cursor = 0;
  // 1-based position in the workspace copy where the next chunk begins.
  let oursLine = 1;

  for (const group of groups(oursHunks, theirsHunks)) {
    if (group.baseStart > cursor) {
      const lines = baseLines.slice(cursor, group.baseStart);
      chunks.push({ kind: "stable", lines, oursLine });
      oursLine += lines.length;
    }
    const { classified, oursSpan } = classify(group, baseLines, oursLines, theirsLines);
    chunks.push({ ...classified, oursLine });
    oursLine += oursSpan;
    cursor = group.baseEnd;
  }
  if (cursor < baseLines.length) {
    chunks.push({ kind: "stable", lines: baseLines.slice(cursor), oursLine });
  }

  const clean = chunks.every(
    (chunk) => chunk.kind !== "conflict" && chunk.kind !== "ambiguous-deletion",
  );
  return {
    chunks,
    clean,
    result: clean ? assemble(chunks) : null,
    incoming: chunks.filter((chunk) => chunk.kind === "theirs" || chunk.kind === "agreement")
      .length,
    local: chunks.filter((chunk) => chunk.kind === "ours").length,
    coarse: oursDiff.coarse || theirsDiff.coarse,
  };
}

function assemble(chunks: readonly MergeChunk[]): string {
  let text = "";
  for (const chunk of chunks) {
    if (chunk.kind === "conflict" || chunk.kind === "ambiguous-deletion") continue;
    text += chunk.lines.join("");
  }
  return text;
}

function hunksOf(ops: readonly { readonly kind: string }[]): readonly Hunk[] {
  const hunks: Hunk[] = [];
  let baseIndex = 0;
  let sideIndex = 0;
  let open: { baseStart: number; sideStart: number } | null = null;

  const close = (): void => {
    if (open !== null) {
      hunks.push({ ...open, baseEnd: baseIndex, sideEnd: sideIndex });
      open = null;
    }
  };

  for (const op of ops) {
    if (op.kind === "equal") {
      close();
      baseIndex += 1;
      sideIndex += 1;
      continue;
    }
    open ??= { baseStart: baseIndex, sideStart: sideIndex };
    if (op.kind === "remove") baseIndex += 1;
    else sideIndex += 1;
  }
  close();
  return hunks;
}

interface Group {
  readonly baseStart: number;
  readonly baseEnd: number;
  readonly ours: readonly Hunk[];
  readonly theirs: readonly Hunk[];
}

/**
 * The two hunk streams, grouped wherever their base ranges overlap or touch.
 * Touching counts (closed intervals): two insertions at one boundary have no
 * order the tool could honestly invent, and two edits meeting at a line are
 * the conservative case — grouped, they either agree, resolve to one side, or
 * conflict out loud.
 */
function groups(oursHunks: readonly Hunk[], theirsHunks: readonly Hunk[]): readonly Group[] {
  const tagged = [
    ...oursHunks.map((hunk) => ({ hunk, side: "ours" as const })),
    ...theirsHunks.map((hunk) => ({ hunk, side: "theirs" as const })),
  ].sort((one, other) => one.hunk.baseStart - other.hunk.baseStart);

  const result: Group[] = [];
  let current: { baseStart: number; baseEnd: number; ours: Hunk[]; theirs: Hunk[] } | null = null;

  for (const { hunk, side } of tagged) {
    if (current !== null && hunk.baseStart <= current.baseEnd) {
      current.baseEnd = Math.max(current.baseEnd, hunk.baseEnd);
      current[side].push(hunk);
      continue;
    }
    if (current !== null) result.push(current);
    current = {
      baseStart: hunk.baseStart,
      baseEnd: hunk.baseEnd,
      ours: side === "ours" ? [hunk] : [],
      theirs: side === "theirs" ? [hunk] : [],
    };
  }
  if (current !== null) result.push(current);
  return result;
}

function classify(
  group: Group,
  baseLines: readonly string[],
  oursLines: readonly string[],
  theirsLines: readonly string[],
): { readonly classified: Classified; readonly oursSpan: number } {
  const baseSlice = baseLines.slice(group.baseStart, group.baseEnd);
  const oursSlice = sideSlice(group, group.ours, oursLines, baseSlice);
  const theirsSlice = sideSlice(group, group.theirs, theirsLines, baseSlice);
  // Whatever the verdict, the workspace copy holds `oursSlice` over this
  // range — that is how many of its lines the group spans.
  const oursSpan = oursSlice.length;

  const oursChanged = !equalLines(oursSlice, baseSlice);
  const theirsChanged = !equalLines(theirsSlice, baseSlice);

  if (!theirsChanged) return { classified: { kind: "ours", lines: oursSlice }, oursSpan };
  if (!oursChanged) {
    if (theirsSlice.length === 0 && baseSlice.length > 0) {
      return { classified: { kind: "ambiguous-deletion", base: baseSlice }, oursSpan };
    }
    return { classified: { kind: "theirs", lines: theirsSlice }, oursSpan };
  }
  if (equalLines(oursSlice, theirsSlice)) {
    return { classified: { kind: "agreement", lines: oursSlice }, oursSpan };
  }
  return {
    classified: { kind: "conflict", base: baseSlice, ours: oursSlice, theirs: theirsSlice },
    oursSpan,
  };
}

/**
 * One side's lines for a group's base range. Outside its hunks a side is 1:1
 * aligned with the base, so any hunk of the group anchors the whole span; a
 * side with no hunk in the group did not change the range, and its content
 * *is* the base's.
 */
function sideSlice(
  group: Group,
  hunks: readonly Hunk[],
  sideLines: readonly string[],
  baseSlice: readonly string[],
): readonly string[] {
  const first = hunks[0];
  const last = hunks[hunks.length - 1];
  if (first === undefined || last === undefined) return baseSlice;
  const start = first.sideStart - (first.baseStart - group.baseStart);
  const end = last.sideEnd + (group.baseEnd - last.baseEnd);
  return sideLines.slice(start, end);
}

function equalLines(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((line, index) => line === other[index]);
}
