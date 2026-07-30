import type { Job } from "@corpus/contract";
import { useAbandonJob, useRetryJob } from "@corpus/kit";
import type { ReactElement } from "react";
import { useOpenInColumn } from "../board/openInColumn";
import { useToast } from "../shell/Toasts";
import { MenuItems } from "./MenuItems";
import type { MenuAction } from "./menuModel";

/**
 * A console job row's own actions (SPEC.md §11): open the originating
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

  const reportFailure =
    (verb: string) =>
    (error: Error): void => {
      notify({ tone: "error", message: `Could not ${verb} ${job.eventId}: ${error.message}` });
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
            ? "the manual override — it re-enters on its own when the lock clears"
            : "re-queue this failed job",
        disabled: retry.isPending,
        run: () => {
          retry.mutate(job.eventId, { onError: reportFailure("retry") });
        },
      },
      {
        id: "abandon",
        label: "Abandon",
        meta: "drops the job from the queue",
        disabled: abandon.isPending,
        run: () => {
          abandon.mutate(job.eventId, { onError: reportFailure("abandon") });
        },
      },
    );
  }

  return <MenuItems actions={actions} onDone={close} />;
}
