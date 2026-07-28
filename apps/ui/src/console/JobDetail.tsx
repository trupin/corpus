import type { Job } from "@corpus/contract";
import { EMPTY_JOB_LOG, useAbandonJob, useJobLog, useRetryJob } from "@corpus/kit";
import type { ReactElement } from "react";
import { useOpenInColumn } from "../board/openInColumn";
import { useToast } from "../shell/Toasts";
import { jobDotClass, jobLabel, jobStartedLabel } from "./consoleModel";
import { JobLog } from "./JobLog";

/** The prototype's copy, verbatim. */
export const NO_JOBS_MESSAGE = "No jobs yet — agent activity will stream here.";

/**
 * The detail half of the master-detail (SPEC.md §11): a header naming the job
 * and what it came from, the failed-only actions, and the live log below.
 *
 * `↗ open` reads `job.originId` — the wire carries no payload, and the origin id
 * is already resolved server-side against the projection, so a null one means
 * "there is nothing to open", not "look harder". It stays rendered and disabled
 * in that case rather than disappearing, because a link that vanishes reads as
 * a bug and a disabled one with a reason reads as an answer.
 */
export interface JobDetailProps {
  readonly job: Job | null;
  /** False while the drawer is collapsed — nothing visible, nothing fetched. */
  readonly enabled: boolean;
}

export function JobDetail({ job, enabled }: JobDetailProps): ReactElement {
  const openInColumn = useOpenInColumn();
  const notify = useToast();
  const retry = useRetryJob();
  const abandon = useAbandonJob();
  const log = useJobLog(job?.eventId ?? null, { enabled });

  if (job === null) {
    return (
      <div className="job-detail">
        <div className="job-empty">{NO_JOBS_MESSAGE}</div>
      </div>
    );
  }

  const canOpen = job.originId !== null;
  const meta = `${job.status} · started ${jobStartedLabel(job.started)} · ${job.eventId}`;

  // The server refuses a job whose event was already reaped. Surface its own
  // message and let the refreshed list be the correction — an optimistic row
  // that never comes back is worse than a red toast.
  const reportFailure =
    (verb: string) =>
    (error: Error): void => {
      notify({ tone: "error", message: `Could not ${verb} ${job.eventId}: ${error.message}` });
    };

  return (
    <div className="job-detail">
      <div className="job-detail-head">
        <span className={`job-dot ${jobDotClass(job.status)}`.trimEnd()} aria-hidden="true" />
        <span className="job-title">{jobLabel(job)}</span>
        <button
          type="button"
          className="ref"
          disabled={!canOpen}
          title={
            canOpen
              ? "Open the originating document in its column"
              : "This job has no originating document, or it no longer exists"
          }
          onClick={() => {
            if (job.originId === null) return;
            // No `subject`: a job knows an id, not a folder or a type. The
            // documented fallback resolves it to the first column rather than
            // costing a request the console did not need.
            openInColumn.open({ docId: job.originId });
          }}
        >
          ↗ open
        </button>
        <span className="job-meta">{meta}</span>
        {job.status === "failed" ? (
          <>
            <button
              type="button"
              disabled={retry.isPending}
              onClick={() => {
                retry.mutate(job.eventId, { onError: reportFailure("retry") });
              }}
            >
              Retry
            </button>
            <button
              type="button"
              disabled={abandon.isPending}
              onClick={() => {
                abandon.mutate(job.eventId, { onError: reportFailure("abandon") });
              }}
            >
              Abandon
            </button>
          </>
        ) : null}
      </div>
      {/*
        Keyed on the job: switching jobs starts a fresh pane, pinned to the
        bottom, rather than inheriting the previous job's scroll position.
      */}
      <JobLog key={job.eventId} log={log.data ?? EMPTY_JOB_LOG} />
    </div>
  );
}
