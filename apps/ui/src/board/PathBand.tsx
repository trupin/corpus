import type { RevealTarget, RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { PathColumn } from "./PathColumn";
import { pathColumnKey, topDoc, type NavEntry, type PathItem } from "./strip";

/**
 * One path, drawn (SPEC.md §10, rider 3; `design/navigation.html`'s `.path`):
 * a band holding the chain's reader columns — dashed while the path hangs off
 * an origin row, solid once it is loose. The band is the snap target, so a
 * path scrolls as the unit it is.
 *
 * Every act a column can take on its path is a callback the board supplies,
 * because the acts are pure functions over the strip (`strip.ts`) and the board
 * is the one holding it.
 */

/** What the board lets a path's columns do — one bundle per path. */
export interface PathActs {
  readonly follow: (
    index: number,
    docId: string,
    fromScrollY: number,
    reveal?: RevealTarget,
  ) => void;
  readonly setStack: (index: number, stack: readonly NavEntry[]) => void;
  readonly setWidth: (index: number, width: number) => void;
  readonly closeAfter: (index: number) => void;
  readonly closeWholePath: () => void;
  readonly restartHere: (index: number) => void;
  readonly newPathRight: (index: number) => void;
  readonly detach: () => void;
  readonly focusMode: (docId: string) => void;
}

export interface PathBandProps {
  readonly path: PathItem;
  /** The origin column's title for the root `◂` label, or `null` when loose. */
  readonly originTitle: string | null;
  /** The active column's key, for `.kactive` on the column that holds it. */
  readonly activeKey: string | null;
  /** The column key being flashed after a scroll-to, or `null`. */
  readonly flashingKey: string | null;
  /** The just-created document whose title is selected, or `null`. */
  readonly selectTitleFor: string | null;
  readonly acts: PathActs;
  readonly onActivate: (key: string) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function PathBand({
  path,
  originTitle,
  activeKey,
  flashingKey,
  selectTitleFor,
  acts,
  onActivate,
  onNotify,
}: PathBandProps): ReactElement {
  return (
    <div
      className={path.origin === null ? "path loose" : "path"}
      data-path={String(path.id)}
      role="group"
      aria-label={originTitle === null ? "Loose path" : `Path from ${originTitle}`}
    >
      {path.cols.map((col, index) => {
        const key = pathColumnKey(path.id, index);
        return (
          <PathColumn
            key={key}
            path={path}
            index={index}
            col={col}
            originTitle={originTitle}
            isActive={key === activeKey}
            isFlashing={key === flashingKey}
            selectTitle={selectTitleFor !== null && topDoc(col) === selectTitleFor}
            onActivate={() => {
              onActivate(key);
            }}
            onFollow={(docId, fromScrollY, reveal) => {
              acts.follow(index, docId, fromScrollY, reveal);
            }}
            onSetStack={(stack) => {
              acts.setStack(index, stack);
            }}
            onSetWidth={(width) => {
              acts.setWidth(index, width);
            }}
            onCloseAfter={() => {
              acts.closeAfter(index);
            }}
            onCloseWholePath={acts.closeWholePath}
            onRestartHere={() => {
              acts.restartHere(index);
            }}
            onNewPathRight={() => {
              acts.newPathRight(index);
            }}
            onDetach={acts.detach}
            onFocusMode={acts.focusMode}
            onNotify={onNotify}
          />
        );
      })}
    </div>
  );
}
