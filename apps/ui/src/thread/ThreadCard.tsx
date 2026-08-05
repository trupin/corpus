import type { DocRow, ResolvedAnchor } from "@corpus/contract";
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
import { agentWaitSince, useOutstandingAgentJob } from "./outstandingAgentRequest";
import { mapFormAnswers, type SubmittedAnswer } from "./parseFormBlock";
import { PendingIndicator } from "./PendingIndicator";
import { ThreadComposer } from "./ThreadComposer";
import { Turn } from "./Turn";
import { useTurnComments } from "./useTurnComments";
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

/** A thread with no anchors, shared so it is one identity rather than one per render. */
const NO_ANCHORS: readonly ResolvedAnchor[] = [];

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
  /**
   * Resolve/reopen reports from the **hook**, not from the call (UI-015).
   *
   * A per-call callback is delivered through the mutation's observer and dropped
   * the moment that observer has no listeners left, so a card that goes away
   * mid-flight — the chip collapsing, the reader closing, the margin re-laying
   * out — flips the thread on disk and says nothing about it. Hook-level
   * callbacks ride on the mutation itself (`SettledCallbacks`).
   *
   * The direction is read off `variables.resolved`, which is what was **sent**,
   * rather than off this render's `resolved`: the callbacks now outlive the
   * render that started the write, so a captured value would be reporting the
   * state the card was in rather than the flip it asked for.
   */
  const setStatus = useSetThreadStatus({
    onSuccess: (_result, variables) => {
      onNotify({
        tone: "info",
        message: variables.resolved
          ? "Thread resolved — committed. Replying reopens it."
          : "Thread reopened — committed.",
      });
    },
    onError: (error, variables) => {
      onNotify({
        tone: "error",
        message: `${variables.resolved ? "Resolve" : "Reopen"} failed — ${error.message}`,
      });
    },
  });
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

  /**
   * The thread **as a document** — its markdown and its own anchors.
   *
   * A thread is a document (SPEC.md §6), so a comment on one of its turns writes
   * an anchor into its frontmatter exactly as a comment on a note does. This is
   * the only place those resolved ranges can be read from, and they are what
   * puts a child card under the right turn and a highlight over the right words
   * (UI-051). Free wherever the thread is the open document — the reader already
   * fetched it, and the kit's cache is keyed by id.
   */
  const self = useDoc(threadId);
  const selfBody = self.data?.body;
  // The constant, not a fresh `[]`: this array is an effect dependency in
  // `useTurnComments`, and a new one per render would re-measure every
  // highlight on every render of the card.
  const selfAnchors = self.data?.anchors ?? NO_ANCHORS;

  const children = useDocs({ parent: threadId, type: THREAD_DOC_TYPE });
  const placement = placeChildThreads(
    children.data?.items ?? [],
    turns,
    selfBody === undefined ? undefined : { body: selfBody, anchors: selfAnchors },
  );

  const turnComments = useTurnComments({
    threadId,
    turns,
    body: selfBody,
    anchors: selfAnchors,
    cardRef: card,
    onNotify,
  });
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
  /**
   * SPEC.md §8's pending row, off the **queue** rather than off the thread's
   * `agent` field (UI-058 — the reasoning is in `outstandingAgentRequest.ts`).
   *
   * Nothing else gates it, and deliberately: `resolved` used to, and it has no
   * business here now that the answer is a fact rather than an inference.
   * Resolving stops the *re-trigger* (SPEC.md §8), it does not cancel an event
   * already in the queue — the agent will still reply — so hiding the row there
   * would drop a wait the person is genuinely in the middle of. A resolved thread
   * with nothing queued has no job, which is the ordinary case and already says
   * nothing.
   */
  const outstanding = useOutstandingAgentJob(threadId);

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
    <div
      ref={card}
      className={classes.join(" ")}
      data-thread={threadId}
      data-depth={String(depth)}
      /*
       * SPEC.md §11's selection menu, on the card rather than on the reader: a
       * thread card renders in four hosts and only one of them is a document
       * view. The handler stops the event when it opens, so the innermost card
       * answers for its own turns and the document view's own menu never opens
       * over one (UI-051).
       */
      onContextMenu={turnComments.onContextMenu}
    >
      <div className="t-head">
        <span className="t-quote">{headLabel}</span>
        <span className="chip t-status">{status}</span>
        <button
          type="button"
          className="t-resolve"
          data-resolve={threadId}
          disabled={setStatus.isPending}
          onClick={() => {
            setStatus.mutate({ id: threadId, resolved: !resolved });
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

      {outstanding === null ? null : (
        <PendingIndicator since={agentWaitSince(outstanding, lastTurn?.ts)} />
      )}

      <ThreadComposer threadId={threadId} resolved={resolved} onNotify={onNotify} />
      {turnComments.popover}
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
