import { pathColumnKey, topDoc, type BoardStrip } from "./strip";
import type { BoardColumn } from "./viewDoc";

/**
 * The column strip's model (SPEC.md §10, rider 4; `design/navigation.html`'s
 * `renderColbar`): one tab per column, in board order, grouped exactly as the
 * board groups them.
 *
 * It is derived from the **same** {@link BoardStrip} the board renders from, so
 * the strip can never disagree with the board about order or grouping — that is
 * the whole reason this is a pure function over the strip rather than a second
 * list assembled beside it.
 *
 * What a tab *says* is resolved by the component, not here: a tab naming a
 * document takes that document's type and title from the query cache the column
 * beside it already filled. What is fixed here is the fallback — the view's own
 * kind and title — so a tab that is waiting for a document still says something
 * true about the column it stands for, and swaps text inside a box that never
 * changes size.
 */

/** One tab: a column, and what to call it. */
export interface StripTab {
  /** The column key — the `data-col` of the column it scrolls to. */
  readonly key: string;
  /**
   * The document whose type and title label this tab, or `null` for a query
   * column showing its list.
   */
  readonly docId: string | null;
  /** The label until (or unless) {@link docId} resolves. Empty for no badge. */
  readonly badge: string;
  /** The title until (or unless) {@link docId} resolves. */
  readonly title: string;
  /** Path columns close from their tab (rider 4); query columns do not. */
  readonly closable: boolean;
}

/** One band of the strip: a bare query tab, or a path's tabs inside a group. */
export type StripEntry =
  | { readonly kind: "query"; readonly tab: StripTab }
  | {
      readonly kind: "path";
      readonly pathId: number;
      /** No origin row: the prototype's solid `.cgroup.loose`. */
      readonly loose: boolean;
      /** The origin column's title for the `◂` prefix, or `null` when unknown. */
      readonly originTitle: string | null;
      readonly tabs: readonly StripTab[];
    };

/**
 * The strip, as tabs.
 *
 * A query item whose column is not in `columns` is skipped rather than drawn
 * from nothing — exactly what the board does with the same item, so the two
 * stay in step through a reconciliation the board has not committed yet.
 */
export function columnTabs(
  strip: BoardStrip,
  columns: readonly BoardColumn[],
): readonly StripEntry[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const entries: StripEntry[] = [];

  for (const item of strip.strip) {
    if (item.kind === "query") {
      const column = byId.get(item.view);
      if (column === undefined) continue;
      entries.push({
        kind: "query",
        tab: {
          key: item.view,
          // The edge case rider 4 names: a query column showing its in-place
          // reader shows *that document's* title, not the view's.
          docId: item.nav.at(-1)?.docId ?? null,
          badge: column.kind,
          title: column.title,
          closable: false,
        },
      });
      continue;
    }

    const origin = item.origin;
    entries.push({
      kind: "path",
      pathId: item.id,
      loose: origin === null,
      originTitle: origin === null ? null : (byId.get(origin.view)?.title ?? null),
      tabs: item.cols.map((col, index) => {
        const docId = topDoc(col);
        return {
          key: pathColumnKey(item.id, index),
          docId,
          badge: "",
          // The id is the only honest placeholder before the document lands —
          // the same one `PathColumn` shows in its `◂ from` line.
          title: docId ?? "",
          closable: true,
        };
      }),
    });
  }

  return entries;
}

/** Every key the strip draws, in order — what the visibility observer watches. */
export function tabKeys(entries: readonly StripEntry[]): readonly string[] {
  return entries.flatMap((entry) =>
    entry.kind === "query" ? [entry.tab.key] : entry.tabs.map((tab) => tab.key),
  );
}
