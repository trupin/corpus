import type { Job } from "@corpus/contract";
import { useAbandonJob, useRetryJob } from "@corpus/kit";
import type { ReactElement } from "react";
import { useOpenInColumn } from "../board/openInColumn";
import { useToast } from "../shell/Toasts";
import { MenuItems } from "./MenuItems";
import type { MenuAction } from "./menuModel";

/**
 * A console job row's own actions (SPEC.md §10): open the originating
 * document, and — for a job that is actually stalled — retry or abandon.
 *
 * The set is the detail header's, exactly: `↗ open` stays present and
 * **disabled** when the job has no origin (a link that vanishes reads as a bug;
 * a disabled one with a reason reads as an answer), and Retry/Abandon appear
 * only for `failed` and `deferred` jobs, because a running job's header does
 * not offer them either.
 */

export interface JobMenuItemsProps {
  readonly job: Job;
  readonly close: () => void;
}

export function JobMenuItems({ job, close }: JobMenuItemsProps): ReactElement {
  const openInColumn = useOpenInColumn();
  const notify = useToast();
  const retry = useRetryJob();
  const abandon = useAbandonJob();

  const canOpen = job.originId !== null;
  const canAct = job.status === "failed" || job.status === "deferred";

  /**
   * The refusal is reported off the **promise**, not off a per-call callback
   * (PR #12 review, MAJOR 2).
   *
   * Every item here closes the menu in the same tick it acts, which unmounts
   * this component before the request settles — and TanStack Query v5 delivers
   * `mutate(…, { onError })` through the observer, which it skips once that
   * observer has no listeners left (`SettledCallbacks`). A refused retry was
   * therefore silent: the job stays failed and nothing says why.
   *
   * `useRetryJob`/`useAbandonJob` take no hook-level callbacks, and this issue
   * does not change `@corpus/kit`. `mutateAsync` needs none: it returns the
   * *mutation's* own promise (`MutationObserver#mutate` hands back
   * `mutation.execute(...)`), which settles wherever the menu went. The toast
   * goes to `useToast`, whose provider is the shell — it outlives this menu by
   * construction.
   */
  const reportFailure =
    (verb: string) =>
    (error: unknown): void => {
      const detail = error instanceof Error ? error.message : "the server refused it";
      notify({ tone: "error", message: `Could not ${verb} ${job.eventId}: ${detail}` });
    };

  const actions: MenuAction[] = [
    {
      id: "open",
      label: "↗ open",
      meta: canOpen
        ? "the originating document, in its column"
        : "no originating document, or it no longer exists",
      disabled: !canOpen,
      run: () => {
        if (job.originId === null) return;
        openInColumn.open({ docId: job.originId });
      },
    },
  ];

  if (canAct) {
    actions.push(
      {
        id: "retry",
        label: "Retry",
        meta:
          job.status === "deferred"
            ? "the manual override — it re-enters on its own when the editing session ends"
            : "re-queue this failed job",
        disabled: retry.isPending,
        run: () => {
          void retry.mutateAsync(job.eventId).catch(reportFailure("retry"));
        },
      },
      {
        id: "abandon",
        label: "Abandon",
        meta: "drops the job from the queue",
        disabled: abandon.isPending,
        run: () => {
          void abandon.mutateAsync(job.eventId).catch(reportFailure("abandon"));
        },
      },
    );
  }

  return <MenuItems actions={actions} onDone={close} />;
}
