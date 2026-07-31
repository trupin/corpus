/**
 * The CLI's one tabular rendering, shared by every verb that prints a row per
 * thing (`doc list`, `search`, `doc related`).
 *
 * The house style is space-padded columns joined by two spaces, with the **last
 * column left ragged**: padding it to the widest value in the batch adds
 * trailing spaces to every line and buys nothing. It lived inside `doc list`
 * until a second and a third verb needed exactly it (CLI-019); a second
 * implementation of a house style is how two verbs end up looking almost the
 * same.
 *
 * Every cell is a single line by the time it gets here — {@link oneLine} is what
 * makes that true of server text that might not be — because the whole point of
 * a row is that one thing is one line an agent can read positionally.
 */

/** One padded line per row, columns sized to the widest cell in the batch. */
export function renderColumns(rows: readonly (readonly string[])[]): readonly string[] {
  const widths = rows[0]?.slice(0, -1).map((_, column) => widest(rows, column)) ?? [];

  return rows.map((row) =>
    row
      .map((cell, column) => (column < widths.length ? cell.padEnd(widths[column] ?? 0) : cell))
      .join("  ")
      // A trailing cell may legitimately be empty (a document with no excerpt);
      // the row is still one line, without invisible trailing whitespace.
      .trimEnd(),
  );
}

function widest(rows: readonly (readonly string[])[], column: number): number {
  return rows.reduce((max, row) => Math.max(max, row[column]?.length ?? 0), 0);
}

/**
 * Whitespace collapsed to single spaces and the ends trimmed, so a value that
 * spans lines on the server still occupies exactly one line here. Nothing is
 * truncated: what to cut is the caller's decision, and for retrieval output the
 * answer is "nothing" — the server already contracted these fields to be short.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
