import type { DocRow } from "@corpus/contract";
import {
  CorpusRequestError,
  isPendingTurn,
  THREAD_DOC_TYPE,
  useDeleteTurn,
  useDoc,
  useDocs,
  useMarkSeenOnce,
  useSetThreadStatus,
  useThread,
  type RowNotice,
  type ThreadTurn,
} from "@corpus/kit";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { placeChildThreads, turnAnchorText } from "./childThreads";
import { NewChildThread } from "./NewChildThread";
import { mapFormAnswers, type SubmittedAnswer } from "./parseFormBlock";
import { PendingIndicator } from "./PendingIndicator";
import { ThreadComposer } from "./ThreadComposer";
import { Turn } from "./Turn";
import "./thread.css";

/**
 * **The** thread card (SPEC.md §6, §11; `design/index.html`'s `.thread-card`).
 *
 * One component, four hosts — an expanded chip in a column, a margin card beside
 * a document, a `type: thread` document open in a reader, and a child thread
 * nested under a turn. They differ by a **class on the card**, never by a second
 * JSX tree: the head, the turns, the form controls, the pending indicator and
 * the composer are the same elements in all four, because they are the same
 * conversation seen from four places, and a fork is how two of them quietly stop
 * agreeing about what a thread is.
 *
 * The collapse control is present exactly when the host gave it something to
 * collapse into (`onCollapse`) — a margin card and a thread document have no
 * chip to fold back to.
 */

export type ThreadHost = "slot" | "margin" | "standalone" | "nested";

/** Past this depth the card stops indenting and says how deep it is instead. */
export const MAX_NESTED_DEPTH = 3;

/** Deeper than this the conversation is a link, not a nesting. */
export const MAX_RENDERED_DEPTH = 4;

export interface ThreadCardProps {
  readonly threadId: string;
  readonly host: ThreadHost;
  /** 0 for a top-level card; each child thread is one deeper. */
  readonly depth?: number;
  /** The list row that opened this card, for the head before the fetch lands. */
  readonly row?: DocRow | undefined;
  /** True for ~1.2s after the 💬 popover jumped here. */
  readonly flashing?: boolean;
  /** Present renders the `–` collapse control. */
  readonly onCollapse?: (() => void) | undefined;
  /** Follows a `[[ref]]`, the context link, or a nested thread's own link. */
  readonly onOpenDoc: (docId: string, anchorId?: string | null) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function ThreadCard({
  threadId,
  host,
  depth = 0,
  row,
  flashing = false,
  onCollapse,
  onOpenDoc,
  onNotify,
}: ThreadCardProps): ReactElement {
  const thread = useThread(threadId);
  const setStatus = useSetThreadStatus();
  const deleteTurn = useDeleteTurn(threadId);
  const { markSeen } = useMarkSeenOnce();
  const card = useRef<HTMLDivElement>(null);
  const [commenting, setCommenting] = useState<string | null>(null);

  const data = thread.data;
  const turns: readonly ThreadTurn[] = data?.turns ?? [];
  const lastTurn = turns.at(-1);
  /**
   * The last turn the **server** has. An optimistic append carries a provisional
   * client timestamp, and marking the thread read up to a turn the server has
   * never seen would spend a request per keystroke-and-send *and* claim a read
   * of something that does not exist yet. The mark re-arms on the confirmed
   * timestamp instead, one round trip later.
   */
  const lastConfirmedTs = turns.findLast((turn) => !isPendingTurn(turn))?.ts;
  const parentId = data?.parent ?? row?.parent ?? null;

  /**
   * SPEC.md §7: **displayed content only**. This card renders the conversation,
   * so mounting it is the read — and de-duplication lives in the kit so an
   * expand/collapse/expand burst, or the same thread displayed in two columns,
   * costs one request per `(thread, last turn)` pair.
   */
  useEffect(() => {
    markSeen(threadId, lastConfirmedTs);
  }, [lastConfirmedTs, markSeen, threadId]);

  useEffect(() => {
    if (!flashing || card.current === null) return;
    // jsdom implements no layout and therefore no `scrollIntoView`.
    if (typeof card.current.scrollIntoView === "function") {
      card.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [flashing]);

  // The parent's title and the anchor's quote both live on the parent document,
  // not on the thread: `GET /api/docs/{id}` resolves the anchor's selector for
  // us, so the UI never searches text for an anchor (that is the server's
  // four-step ladder, SPEC.md §6).
  const parent = useDoc(parentId ?? undefined);
  const parentMissing = parent.error instanceof CorpusRequestError && parent.error.status === 404;
  const parentTitle = parent.data?.frontmatter.title ?? row?.parentTitle ?? null;
  const resolvedQuote =
    parent.data?.anchors.find((anchor) => anchor.threadId === threadId)?.selector.exact ?? null;
  const quote = (resolvedQuote ?? row?.anchorQuote ?? "").trim();

  const children = useDocs({ parent: threadId, type: THREAD_DOC_TYPE });
  const placement = placeChildThreads(children.data?.items ?? [], turns);
  /*
   * The answers this card submitted, in the order it submitted them.
   *
   * Browser-local and deliberately so: it is knowledge about *this* session's
   * clicks, not corpus state, and it is never written anywhere. It exists
   * because the answer turn the server writes is prose that names an option and
   * not a form (SPEC.md §6), so with two open forms offering the same option
   * the replay would otherwise credit the wrong one — observed in a browser
   * (PR #10 finding 12). After a reload it is empty again and the ordering rule
   * takes over, which is the honest limit of what the file says.
   */
  const [submitted, setSubmitted] = useState<readonly SubmittedAnswer[]>([]);
  const answers = mapFormAnswers(turns, submitted);

  const status = data?.status ?? row?.status ?? "open";
  const resolved = status === "resolved";
  const agentState = data?.agent ?? row?.agent ?? "none";
  const awaiting =
    !resolved && agentState !== "none" && lastTurn !== undefined && lastTurn.author !== "agent";

  const classes = [
    "thread-card",
    `host-${host}`,
    resolved ? "resolved" : "",
    flashing ? "flash" : "",
    depth === 0 ? "" : "nested",
    depth >= MAX_NESTED_DEPTH ? "flush" : "",
  ].filter((part) => part !== "");

  const headLabel =
    quote !== "" ? `“${quote}”` : parentId === null ? "standalone" : "whole-document thread";

  return (
    <div ref={card} className={classes.join(" ")} data-thread={threadId} data-depth={String(depth)}>
      <div className="t-head">
        <span className="t-quote">{headLabel}</span>
        <span className="chip t-status">{status}</span>
        <button
          type="button"
          className="t-resolve"
          data-resolve={threadId}
          disabled={setStatus.isPending}
          onClick={() => {
            setStatus.mutate(
              { id: threadId, resolved: !resolved },
              {
                onSuccess: () => {
                  onNotify({
                    tone: "info",
                    message: resolved
                      ? "Thread reopened — committed."
                      : "Thread resolved — committed. Replying reopens it.",
                  });
                },
                onError: (error) => {
                  onNotify({
                    tone: "error",
                    message: `${resolved ? "Reopen" : "Resolve"} failed — ${error.message}`,
                  });
                },
              },
            );
          }}
        >
          {resolved ? "reopen" : "✓ resolve"}
        </button>
        {onCollapse === undefined ? null : (
          <button
            type="button"
            className="t-collapse"
            title="Collapse"
            aria-label="Collapse thread"
            onClick={onCollapse}
          >
            –
          </button>
        )}
      </div>

      {depth >= MAX_NESTED_DEPTH ? (
        <div className="t-depth" data-depth-indicator>
          nested {String(depth)} deep
        </div>
      ) : null}

      <ThreadContext
        threadId={threadId}
        parentId={parentId}
        parentTitle={parentMissing ? null : parentTitle}
        quote={quote}
        anchorId={data?.anchor ?? null}
        onOpenDoc={onOpenDoc}
      />

      <div className="turns">
        {thread.isPending ? (
          <p className="turn-empty">Loading…</p>
        ) : thread.error !== null ? (
          <p className="turn-empty" role="alert">
            {thread.error.message}
          </p>
        ) : turns.length === 0 ? (
          <p className="turn-empty">No turns yet.</p>
        ) : (
          turns.map((turn) => (
            <Turn
              key={turn.ts}
              threadId={threadId}
              turn={turn}
              answeredForm={answers.get(turn.ts) ?? null}
              onAnsweredForm={(formTs, option) => {
                setSubmitted((current) =>
                  current.some((entry) => entry.formTs === formTs)
                    ? current
                    : [...current, { formTs, option }],
                );
              }}
              onOpenRef={onOpenDoc}
              onNotify={onNotify}
              onDelete={(ts) => {
                deleteTurn.mutate(ts, {
                  onSuccess: (result) => {
                    onNotify({
                      tone: "info",
                      message: result.deletedThread
                        ? "Turn deleted — it was the last one, so the thread went with it. Git keeps the history."
                        : "Turn deleted — git keeps the history.",
                    });
                  },
                  onError: (error) => {
                    onNotify({ tone: "error", message: `Delete failed — ${error.message}` });
                  },
                });
              }}
              {...(depth < MAX_RENDERED_DEPTH
                ? {
                    onComment: (target: ThreadTurn) => {
                      setCommenting((current) => (current === target.ts ? null : target.ts));
                    },
                  }
                : {})}
            >
              <ChildCards
                rows={placement.byTurn.get(turn.ts) ?? []}
                depth={depth}
                onOpenDoc={onOpenDoc}
                onNotify={onNotify}
              />
              {commenting === turn.ts ? (
                <NewChildThread
                  parentThreadId={threadId}
                  anchorText={turnAnchorText(turn)}
                  onDone={() => {
                    setCommenting(null);
                  }}
                  onCancel={() => {
                    setCommenting(null);
                  }}
                  onNotify={onNotify}
                />
              ) : null}
            </Turn>
          ))
        )}
      </div>

      <ChildCards
        rows={placement.unanchored}
        depth={depth}
        onOpenDoc={onOpenDoc}
        onNotify={onNotify}
      />

      {awaiting && lastTurn !== undefined ? <PendingIndicator since={lastTurn.ts} /> : null}

      <ThreadComposer threadId={threadId} resolved={resolved} onNotify={onNotify} />
    </div>
  );
}

interface ChildCardsProps {
  readonly rows: readonly DocRow[];
  readonly depth: number;
  readonly onOpenDoc: (docId: string, anchorId?: string | null) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * Nested conversations, and where the nesting stops.
 *
 * Indentation runs out at {@link MAX_NESTED_DEPTH}: past it the wrapper stops
 * inset­ting and the card says how deep it is instead, so depths 3, 4 and 5 all
 * sit at the same left edge. Past {@link MAX_RENDERED_DEPTH} the conversation
 * becomes a link rather than a card — indefinite recursion would eventually
 * leave a composer a few characters wide, and a conversation that deep is a
 * conversation you open.
 */
function ChildCards({ rows, depth, onOpenDoc, onNotify }: ChildCardsProps): ReactElement | null {
  if (rows.length === 0) return null;
  const childDepth = depth + 1;
  const wrapper = childDepth > MAX_NESTED_DEPTH ? "child-threads flush" : "child-threads";
  if (childDepth > MAX_RENDERED_DEPTH) {
    return (
      <div className={wrapper}>
        {rows.map((child) => (
          <button
            key={child.id}
            type="button"
            className="t-chip"
            onClick={() => {
              onOpenDoc(child.id);
            }}
          >
            💬 {String(child.turnCount ?? 0)} · open thread
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={wrapper}>
      {rows.map((child) => (
        <ThreadCard
          key={child.id}
          threadId={child.id}
          host="nested"
          depth={depth + 1}
          row={child}
          onOpenDoc={onOpenDoc}
          onNotify={onNotify}
        />
      ))}
    </div>
  );
}

interface ThreadContextProps {
  readonly threadId: string;
  readonly parentId: string | null;
  readonly parentTitle: string | null;
  readonly quote: string;
  readonly anchorId: string | null;
  readonly onOpenDoc: (docId: string, anchorId?: string | null) => void;
}

/**
 * `.t-context` — where this conversation hangs, and the way back to it
 * (SPEC.md §11: the anchor quote is pinned at the top and links back to the
 * parent at the anchor position).
 *
 * A thread whose parent was deleted degrades to the stored id as plain text:
 * §9 says such a thread becomes an orphaned record, and an orphaned record still
 * knows what it was about even though there is nowhere left to go.
 */
function ThreadContext({
  threadId,
  parentId,
  parentTitle,
  quote,
  anchorId,
  onOpenDoc,
}: ThreadContextProps): ReactElement {
  if (parentId === null) {
    return (
      <div className="t-context">
        standalone thread · <span className="t-context-id">{threadId}</span>
      </div>
    );
  }

  const where = quote === "" ? " · whole document" : ` · at “${quote}”`;

  if (parentTitle === null) {
    return (
      <div className="t-context">
        on <span className="t-context-id">{parentId}</span>
        {where}
      </div>
    );
  }

  return (
    <div className="t-context">
      on{" "}
      <button
        type="button"
        className="ref"
        onClick={() => {
          onOpenDoc(parentId, anchorId);
        }}
      >
        {parentTitle}
      </button>
      {where}
    </div>
  );
}
