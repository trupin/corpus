import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import {
  CorpusRequestError,
  isPendingTurn,
  THREAD_DOC_TYPE,
  useDeleteTurn,
  useDoc,
  useDocs,
  useMarkSeenOnce,
  useResidentLane,
  useSetThreadStatus,
  useThread,
  type RowNotice,
  type ThreadTurn,
} from "@corpus/kit";
import type { RevealTarget } from "@corpus/kit/plugin";
import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from "react";
import { placeChildThreads, turnAnchorText } from "./childThreads";
import { summaryFromRow, type ThreadSummary } from "./CollapsedThread";
import { NewChildThread } from "./NewChildThread";
import { agentWaitSince, useOutstandingAgentRequest } from "./outstandingAgentRequest";
import { mapFormAnswers, type SubmittedAnswer } from "./parseFormBlock";
import { PendingIndicator } from "./PendingIndicator";
import { ResidentBadge } from "./ResidentBadge";
import { threadStatusNotice } from "./resolveNotice";
import { MAX_NESTED_DEPTH } from "./threadDepth";
import { ThreadPanel } from "./ThreadPanel";
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
 * **This is the expanded half of a conversation, and only that.** `ThreadPanel`
 * decides which half is on screen; mounting this one is what displays the
 * conversation and therefore what marks it seen (SPEC.md §7). The `–` control in
 * the head is the fold, and it is present in every host now — §11's "whether it
 * can be collapsed does not depend on the width" is exactly the sentence that
 * used to be untrue here, where a margin card had no way back to anything.
 */

export type ThreadHost = "slot" | "margin" | "standalone" | "nested";

/** A thread with no anchors, shared so it is one identity rather than one per render. */
const NO_ANCHORS: readonly ResolvedAnchor[] = [];

export interface ThreadCardProps {
  readonly threadId: string;
  readonly host: ThreadHost;
  /** 0 for a top-level card; each child thread is one deeper. */
  readonly depth?: number;
  /** What the placement already knew, for the head before the fetch lands. */
  readonly summary?: ThreadSummary | undefined;
  /** True for ~1.2s after the 💬 popover jumped here. */
  readonly flashing?: boolean;
  /** Present renders the `–` collapse control. */
  readonly onCollapse?: (() => void) | undefined;
  /** The conversation's own right-click menu, when a placement hosts one. */
  readonly onCardContextMenu?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  /**
   * Follows a `[[ref]]`, the context link, or a nested thread's own link.
   *
   * The optional `reveal` is what makes the **context link** land on the
   * conversation rather than at the top of the parent (UI-095): the host pushes
   * it onto the navigation entry it creates, and the arriving reader honours it
   * once the document has rendered. A caller with nothing to say about where to
   * land — a `[[ref]]` — omits it and the open behaves exactly as it always did.
   */
  readonly onOpenDoc: (docId: string, reveal?: RevealTarget) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function ThreadCard({
  threadId,
  host,
  depth = 0,
  summary,
  flashing = false,
  onCollapse,
  onCardContextMenu,
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
      onNotify({ tone: "info", message: threadStatusNotice(variables.resolved) });
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
  /**
   * The last turn the **server** has. An optimistic append carries a provisional
   * client timestamp, and marking the thread read up to a turn the server has
   * never seen would spend a request per keystroke-and-send *and* claim a read
   * of something that does not exist yet. The mark re-arms on the confirmed
   * timestamp instead, one round trip later.
   */
  const lastConfirmedTs = turns.findLast((turn) => !isPendingTurn(turn))?.ts;
  const parentId = data?.parent ?? summary?.parent ?? null;

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
  const parentTitle = parent.data?.frontmatter.title ?? summary?.parentTitle ?? null;
  const resolvedQuote =
    parent.data?.anchors.find((anchor) => anchor.threadId === threadId)?.selector.exact ?? null;
  const quote = (resolvedQuote ?? summary?.quote ?? "").trim();

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

  const status = data?.status ?? summary?.status ?? "open";
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
  const outstanding = useOutstandingAgentRequest(threadId);
  /**
   * Which lane answers a message posted in this conversation (SPEC.md §7), and
   * what that lane says — the shared walk the composer below already performs
   * for the same `start`, so this costs no request of its own and cannot
   * disagree with the recipient it offers.
   *
   * It feeds the pending row's wording only. The badge in the head asks a
   * narrower question — *is this conversation itself a lane* — and asks it
   * directly, because a card deep inside a scope is not the conversation that
   * has the resident.
   */
  const { row: laneRow } = useResidentLane(threadId);

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
       *
       * With **no** selection it declines, and the conversation's own menu takes
       * the event: right-clicking a card offers that card's actions — collapse,
       * resolve/reopen — which is where §11 puts the fold, since it claims no key
       * of its own. Read off `defaultPrevented` rather than off a second
       * selection check, because the selection handler is the one that decides
       * whether it consumed the event and asking twice is how the two answers
       * drift.
       */
      onContextMenu={(event) => {
        turnComments.onContextMenu(event);
        if (event.defaultPrevented || onCardContextMenu === undefined) return;
        onCardContextMenu(event);
      }}
    >
      <div className="t-head">
        <span className="t-quote">{headLabel}</span>
        <span className="chip t-status">{status}</span>
        <ResidentBadge threadId={threadId} />
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
              onAnsweredForm={(formTs, answer) => {
                setSubmitted((current) =>
                  current.some((entry) => entry.formTs === formTs)
                    ? current
                    : [...current, { formTs, answer }],
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
              /*
               * Commenting is offered at every depth now. It used to stop at the
               * old render cap — the depth at which a conversation became a link
               * that navigated away — so a turn deep in a nest lost the one
               * affordance the whole recursion exists for. Nothing about §6's
               * recursion ever justified that: it was a consequence of the cap,
               * and the cap no longer drops anything.
               */
              onComment={(target: ThreadTurn) => {
                setCommenting((current) => (current === target.ts ? null : target.ts));
              }}
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
        <PendingIndicator
          since={agentWaitSince(outstanding.job, turns)}
          state={outstanding.working ? "working" : "waiting"}
          lane={laneRow}
        />
      )}

      <ThreadComposer threadId={threadId} resolved={resolved} onNotify={onNotify} />
      {turnComments.popover}
    </div>
  );
}

interface ChildCardsProps {
  readonly rows: readonly DocRow[];
  readonly depth: number;
  readonly onOpenDoc: (docId: string, reveal?: RevealTarget) => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * Nested conversations, and where the nesting stops **drawing** — not where it
 * stops existing (SPEC.md §11, rider signed 2026-08-05).
 *
 * Indentation runs out at {@link MAX_NESTED_DEPTH}: past it the wrapper stops
 * insetting and the card says how deep it is instead, so depths 3, 4 and 5 all
 * sit at the same left edge. Past `MAX_DRAWN_DEPTH` the conversation is placed
 * **collapsed** — one line that still says what it is, expanding where it stands
 * — rather than becoming a link that navigates away.
 *
 * That link was the one collapse in the app with no way back: §11 now says
 * "every collapse expands again in place… a fold whose only way back is losing
 * your place is not a collapse", and "opening it in its own reader stays
 * available as a **choice**, never as the only way to read it" — which is where
 * the panel's right-click menu keeps it.
 *
 * Indefinite recursion is still bounded, but by the reader rather than by a cap:
 * each expansion draws one more level, whose own children are collapsed again.
 */
function ChildCards({ rows, depth, onOpenDoc, onNotify }: ChildCardsProps): ReactElement | null {
  if (rows.length === 0) return null;
  const childDepth = depth + 1;
  const wrapper = childDepth > MAX_NESTED_DEPTH ? "child-threads flush" : "child-threads";
  return (
    <div className={wrapper}>
      {rows.map((child) => (
        <ThreadPanel
          key={child.id}
          summary={summaryFromRow(child)}
          host="nested"
          depth={childDepth}
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
  readonly onOpenDoc: (docId: string, reveal?: RevealTarget) => void;
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
          // The conversation, not the top of the document it hangs on: this
          // link's whole promise is "at «quote»", and the reveal is what keeps
          // it. `jumpToThread` expands the card, scrolls its highlight into
          // view and flashes it — and on a thread with no anchor it still
          // expands the card, which is where the reason it has none is written.
          onOpenDoc(parentId, { kind: "thread", threadId });
        }}
      >
        {parentTitle}
      </button>
      {where}
    </div>
  );
}
