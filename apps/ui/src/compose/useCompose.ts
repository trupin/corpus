import { useCapture, useCreateThread, type RowNotice } from "@corpus/kit";
import { useCallback } from "react";

/**
 * The composer's two submits (SPEC.md §11), routed.
 *
 * Both are compositions of primitives that already exist, and that is the whole
 * design: **Ask** is `POST /api/threads` with no parent, **Capture** is
 * `POST /api/capture`, and neither invents machinery. What this hook owns is the
 * choice between them, the attachment hand-off, and the narration — one place,
 * so the buttons and the keys cannot build different requests from each other.
 *
 * **Both are agent-requested, explicitly.** `requestsAgent` is tri-state
 * (SPEC.md §8): omitted means "enqueue if the thread is already engaged", which
 * for a thread that does not exist yet means "no". Ask exists to reach the
 * agent, and a capture is a request to file something — so both send `true`
 * rather than relying on the server's default.
 *
 * **Nothing is inserted optimistically.** The board's rows are the server's
 * documents: it assigns the id, the path, the title and the timestamps, and the
 * capture result carries ids rather than a row. A provisional row assembled here
 * would be a document the corpus has never heard of (the reason `useCreateDoc`
 * gives for the same choice). What makes SPEC.md §11's "appear on the board
 * immediately" true is that the mutation invalidates `["docs"]` on success,
 * which refetches every mounted column at once rather than waiting for the SSE
 * frame to arrive.
 */

export type ComposeMode = "ask" | "capture";

export interface ComposeInput {
  readonly text: string;
  readonly files: readonly File[];
  /**
   * The weight the request states (SPEC.md §11's rider) — `{}` when nothing is
   * chosen, which is the ordinary case.
   *
   * Spread onto the body rather than passed as a `string | undefined`, so
   * "stated nothing" has exactly one spelling on the way out: the key is absent.
   * §11 names both submits, so Capture carries it exactly as Ask does — "a
   * request is a request wherever it starts".
   */
  readonly weight: { readonly weight?: string };
  /**
   * The lane the Ask is addressed to (SPEC.md §7) — `{}` for the computed
   * default, which for a standalone thread is always the orchestrator, and
   * `{recipient}` only when a lane was picked. A pick here is §7's **summons**:
   * the event is stamped with the recipient's lane so it reaches them at all,
   * and what they write files into the thread this Ask creates, because routing
   * follows the recipient and filing follows the conversation.
   *
   * **Capture carries none, and cannot**: `POST /api/capture` has no `recipient`
   * (CONTRACT-051), because a capture creates a standalone thread that is in no
   * scope by construction — offering a routing choice before there is a
   * conversation to route. So this rides the Ask branch only.
   */
  readonly recipient: { readonly recipient?: string };
}

/**
 * What one submit did.
 *
 * The refusal rides along rather than being swallowed by the narration: the
 * overlay has to settle its own recipient pick against it, and a
 * `422 unknown_recipient` is the one failure where dropping that pick would
 * quietly reroute the retry (UI-118, `ComposerRecipient.refuse`). The toast is
 * still this hook's to write — the caller reads the error, it does not narrate
 * it a second time.
 */
export type ComposeOutcome =
  { readonly ok: true } | { readonly ok: false; readonly error: unknown };

export interface ComposeApi {
  /** Resolves `{ok: true}` when the corpus changed; the refusal when it did not. */
  readonly submit: (mode: ComposeMode, input: ComposeInput) => Promise<ComposeOutcome>;
  readonly isPending: boolean;
}

/** Ask's narration — what happened, not what was attempted. */
export function askMessage(queued: boolean): string {
  return queued
    ? "Asked the agent — a standalone thread was created and the agent was queued."
    : "Asked — a standalone thread was created; nothing was queued.";
}

/** Capture's narration. Names the folder, because "where did it go" is the question. */
export function captureMessage(queued: boolean): string {
  return queued
    ? "Captured to inbox/ — a document and a filing thread were created; the agent will file it."
    : "Captured to inbox/ — a document and a filing thread were created; nothing was queued.";
}

export function useCompose(notify: (notice: RowNotice) => void): ComposeApi {
  const createThread = useCreateThread();
  const capture = useCapture();

  const submit = useCallback(
    async (mode: ComposeMode, input: ComposeInput): Promise<ComposeOutcome> => {
      const text = input.text.trim();
      const files = input.files;
      try {
        if (mode === "ask") {
          const result = await createThread.mutateAsync({
            parent: null,
            selector: null,
            body: text,
            requestsAgent: true,
            ...input.weight,
            ...input.recipient,
            ...(files.length === 0 ? {} : { files }),
          });
          for (const warning of result.warnings) {
            notify({ tone: "error", message: `${warning.code} — ${warning.detail}` });
          }
          notify({ tone: "info", message: askMessage(result.eventId !== null) });
          return { ok: true };
        }

        const result = await capture.mutateAsync({
          text,
          requestsAgent: true,
          ...input.weight,
          ...(files.length === 0 ? {} : { files }),
        });
        for (const warning of result.warnings) {
          notify({ tone: "error", message: `${warning.code} — ${warning.detail}` });
        }
        notify({ tone: "info", message: captureMessage(result.eventId !== null) });
        return { ok: true };
      } catch (cause) {
        notify({
          tone: "error",
          message: `${mode === "ask" ? "Ask" : "Capture"} failed — ${(cause as Error).message}`,
        });
        return { ok: false, error: cause };
      }
    },
    [capture, createThread, notify],
  );

  return { submit, isPending: createThread.isPending || capture.isPending };
}
