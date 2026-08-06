/**
 * A line-oriented unified diff, computed in-process.
 *
 * `corpus workspace diff` compares a file on disk with a file inside the
 * installed tool. Neither is in the workspace's git history — the tool's copy
 * lives in `node_modules` — so `git diff` cannot produce this and the CLI
 * computes it itself. Doing so keeps the verb what SPEC.md §2.4 needs it to be:
 * read-only, runnable with the server stopped, and spawning nothing.
 *
 * The output is ordinary unified-diff text — `---`/`+++` headers, `@@` hunks,
 * three lines of context, and git's `\ No newline at end of file` marker —
 * because the reader is an agent that has been told it has unresolved work, and
 * a format every merge tool and every model already knows is one less thing for
 * it to parse.
 *
 * Lines are compared **with their terminators**, so a file that ends without a
 * trailing newline never compares equal to one that does. Two files with
 * different shas therefore always produce a non-empty diff — the alternative is
 * a verb that says "these differ" and then shows nothing.
 */

/** Lines of context around each change, matching git's default. */
export const DIFF_CONTEXT_LINES = 3;

/**
 * The compare is O(n×m) in lines. Past this many cells it degrades to "all of
 * one side removed, all of the other added" rather than allocating unboundedly:
 * still a correct diff, just not a minimal one. Template files are skills and
 * seed documents, so the guard is a backstop for a pathological input rather
 * than a case anybody meets — 3000×3000 lines is far past any of them.
 */
const MAX_COMPARE_CELLS = 9_000_000;

export interface UnifiedDiffLabels {
  /** Names the `---` side: the lines a `-` prefix belongs to. */
  readonly from: string;
  /** Names the `+++` side: the lines a `+` prefix belongs to. */
  readonly to: string;
}

export interface UnifiedDiff {
  /** The diff, newline-terminated; `""` when the two sides are byte-identical. */
  readonly text: string;
  /** Lines present only on the `+++` side. */
  readonly added: number;
  /** Lines present only on the `---` side. */
  readonly removed: number;
  /**
   * True when the compare hit {@link MAX_COMPARE_CELLS} and fell back to a
   * whole-file replacement. The diff is still correct; it is simply not the
   * smallest one, and a reader that expected minimal hunks should know.
   */
  readonly coarse: boolean;
}

type OpKind = "equal" | "remove" | "add";

interface Op {
  readonly kind: OpKind;
  /** The raw line, terminator included. */
  readonly line: string;
}

export function unifiedDiff(
  from: string,
  to: string,
  labels: UnifiedDiffLabels,
  context: number = DIFF_CONTEXT_LINES,
): UnifiedDiff {
  if (from === to) return { text: "", added: 0, removed: 0, coarse: false };

  const fromLines = splitLines(from);
  const toLines = splitLines(to);
  const { ops, coarse } = compare(fromLines, toLines);

  const added = ops.filter((op) => op.kind === "add").length;
  const removed = ops.filter((op) => op.kind === "remove").length;
  const body = hunks(ops, context);
  const header = [`--- ${labels.from}`, `+++ ${labels.to}`];

  return { text: `${[...header, ...body].join("\n")}\n`, added, removed, coarse };
}

/**
 * Lines **with** their terminators. An empty input has no lines at all, which is
 * what makes a diff against a file this workspace does not have read as one
 * whole-file addition rather than as an empty line being replaced.
 */
export function splitLines(text: string): readonly string[] {
  if (text === "") return [];
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function compare(
  from: readonly string[],
  to: readonly string[],
): { readonly ops: readonly Op[]; readonly coarse: boolean } {
  // The shared head and tail are the bulk of any real edit and cost nothing to
  // find, which is what keeps the quadratic part small enough to be exact.
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) head += 1;

  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  ) {
    tail += 1;
  }

  const middleFrom = from.slice(head, from.length - tail);
  const middleTo = to.slice(head, to.length - tail);

  const coarse = middleFrom.length * middleTo.length > MAX_COMPARE_CELLS;
  const middle = coarse ? replaceWholly(middleFrom, middleTo) : align(middleFrom, middleTo);

  return {
    ops: [
      ...from.slice(0, head).map((line) => ({ kind: "equal", line }) as const),
      ...middle,
      ...from.slice(from.length - tail).map((line) => ({ kind: "equal", line }) as const),
    ],
    coarse,
  };
}

function replaceWholly(from: readonly string[], to: readonly string[]): readonly Op[] {
  return [
    ...from.map((line) => ({ kind: "remove", line }) as const),
    ...to.map((line) => ({ kind: "add", line }) as const),
  ];
}

/**
 * The longest common subsequence, as an edit script. A flat `Int32Array` of
 * suffix lengths, walked forward: at each cell the longer of "skip a line on the
 * left" and "skip a line on the right" decides, so equal runs stay together and
 * the script is deterministic — the same two files always produce the same diff.
 */
function align(from: readonly string[], to: readonly string[]): readonly Op[] {
  const rows = from.length;
  const columns = to.length;
  if (rows === 0 || columns === 0) return replaceWholly(from, to);

  const width = columns + 1;
  const lengths = new Int32Array((rows + 1) * width);
  const common = (row: number, column: number): number => lengths[row * width + column] ?? 0;

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      lengths[row * width + column] =
        from[row] === to[column]
          ? common(row + 1, column + 1) + 1
          : Math.max(common(row + 1, column), common(row, column + 1));
    }
  }

  const ops: Op[] = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (from[row] === to[column]) {
      ops.push({ kind: "equal", line: from[row] ?? "" });
      row += 1;
      column += 1;
    } else if (common(row + 1, column) >= common(row, column + 1)) {
      ops.push({ kind: "remove", line: from[row] ?? "" });
      row += 1;
    } else {
      ops.push({ kind: "add", line: to[column] ?? "" });
      column += 1;
    }
  }
  for (; row < rows; row += 1) ops.push({ kind: "remove", line: from[row] ?? "" });
  for (; column < columns; column += 1) ops.push({ kind: "add", line: to[column] ?? "" });
  return ops;
}

/** One op with its 0-based position on each side; `-1` where it has none. */
interface Positioned extends Op {
  readonly fromIndex: number;
  readonly toIndex: number;
}

function hunks(ops: readonly Op[], context: number): readonly string[] {
  const positioned: Positioned[] = [];
  let fromIndex = 0;
  let toIndex = 0;
  for (const op of ops) {
    positioned.push({
      ...op,
      fromIndex: op.kind === "add" ? -1 : fromIndex,
      toIndex: op.kind === "remove" ? -1 : toIndex,
    });
    if (op.kind !== "add") fromIndex += 1;
    if (op.kind !== "remove") toIndex += 1;
  }

  // A line is printed when it is a change or sits within `context` of one;
  // contiguous runs of printed lines are the hunks, so two changes closer than
  // twice the context merge into one without a separate merging pass.
  const printed = new Array<boolean>(positioned.length).fill(false);
  positioned.forEach((op, index) => {
    if (op.kind === "equal") return;
    const first = Math.max(0, index - context);
    const last = Math.min(positioned.length - 1, index + context);
    for (let mark = first; mark <= last; mark += 1) printed[mark] = true;
  });

  const lines: string[] = [];
  let index = 0;
  while (index < positioned.length) {
    if (printed[index] !== true) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < positioned.length && printed[end] === true) end += 1;
    lines.push(...renderHunk(positioned.slice(index, end)));
    index = end;
  }
  return lines;
}

function renderHunk(run: readonly Positioned[]): readonly string[] {
  const fromCount = run.filter((op) => op.kind !== "add").length;
  const toCount = run.filter((op) => op.kind !== "remove").length;
  const fromStart = start(run, "from", fromCount);
  const toStart = start(run, "to", toCount);

  const lines = [
    `@@ -${String(fromStart)},${String(fromCount)} +${String(toStart)},${String(toCount)} @@`,
  ];
  for (const op of run) {
    const prefix = op.kind === "equal" ? " " : op.kind === "remove" ? "-" : "+";
    const raw = op.line;
    const ends = raw.endsWith("\n");
    lines.push(`${prefix}${ends ? raw.slice(0, -1) : raw}`);
    if (!ends) lines.push("\\ No newline at end of file");
  }
  return lines;
}

/**
 * The 1-based start of a hunk on one side. A hunk that touches no line at all on
 * its side starts at `0` — git's convention for "inserted before line 1" and for
 * a wholly empty side.
 */
function start(run: readonly Positioned[], side: "from" | "to", count: number): number {
  if (count === 0) return 0;
  const first = run.find((op) => (side === "from" ? op.fromIndex : op.toIndex) >= 0);
  const index = first === undefined ? 0 : side === "from" ? first.fromIndex : first.toIndex;
  return index + 1;
}
