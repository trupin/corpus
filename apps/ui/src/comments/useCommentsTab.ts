import { useCallback, useState } from "react";
import type { ReaderTab } from "./CommentsSwitch";
import { ALL_COMMENTS, type CommentFilters } from "./commentsModel";

/**
 * Which half of the reader is showing, and what the comments list is filtered
 * to — held by the host so the head's switch and the body agree, and so a column
 * reader and a focus-mode reader each own their own answer.
 *
 * **The tab resets to the document on every navigation.** It is a view of *this*
 * document's comments, and arriving at a `[[ref]]` on the Comments tab would
 * hide the body you followed the link to reach. That is a different lifetime
 * from a fold, which §10 makes sticky across navigation precisely because a fold
 * belongs to the conversation rather than to the reader.
 *
 * It is derived at render rather than reset in an effect: an effect would paint
 * one frame of the outgoing tab over the incoming document, which on this
 * surface is a body appearing and then being replaced — the class of movement
 * §10's reading surface is written against.
 *
 * **The filters are not persisted at all**, and that is deliberate rather than
 * unfinished. Both axes default to *all*, which hides nothing; a filter that
 * survived a reload would hide comments from someone who has forgotten they set
 * it, and a list silently missing rows is the failure this surface exists to
 * cure. They are a question being asked now, not a place being returned to.
 */

export interface CommentsTabState {
  readonly tab: ReaderTab;
  readonly setTab: (tab: ReaderTab) => void;
  readonly filters: CommentFilters;
  readonly setFilters: (filters: CommentFilters) => void;
  /**
   * Show a conversation at its anchor: back to the document, then the reveal
   * seam (UI-037's `jumpToThread`, which expands the conversation, flashes it
   * and scrolls it into view).
   *
   * Both halves, in this order, because the body is not mounted while the list
   * is — a reveal issued from the list would otherwise have nothing to reveal
   * into.
   */
  readonly reveal: (threadId: string) => void;
}

interface TabState {
  readonly docId: string;
  readonly tab: ReaderTab;
}

export function useCommentsTab(
  docId: string,
  jumpToThread: (threadId: string) => void,
): CommentsTabState {
  const [chosen, setChosen] = useState<TabState>({ docId, tab: "document" });
  const [filters, setFilters] = useState<CommentFilters>(ALL_COMMENTS);

  const tab: ReaderTab = chosen.docId === docId ? chosen.tab : "document";

  const setTab = useCallback(
    (next: ReaderTab) => {
      setChosen({ docId, tab: next });
    },
    [docId],
  );

  const reveal = useCallback(
    (threadId: string) => {
      setChosen({ docId, tab: "document" });
      jumpToThread(threadId);
    },
    [docId, jumpToThread],
  );

  return { tab, setTab, filters, setFilters, reveal };
}
