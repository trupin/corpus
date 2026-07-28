import type { Job } from "@corpus/contract";
import type { ReactElement } from "react";
import { jobDotClass, jobLabel } from "./consoleModel";

/**
 * The master half of the console's master-detail (SPEC.md §11): a fixed 380 px
 * list of jobs, newest first, one row per queue event.
 *
 * A row is a real `<button>` inside a `role="listbox"`-free plain list: the
 * rows are navigable by Tab and activated by Enter or Space with no handler of
 * our own, and `aria-current` says which one the detail pane is showing.
 */
export interface JobListProps {
  readonly jobs: readonly Job[];
  readonly selectedId: string | null;
  readonly onSelect: (eventId: string) => void;
}

export function JobList({ jobs, selectedId, onSelect }: JobListProps): ReactElement {
  return (
    <div className="job-list" aria-label="Jobs">
      {jobs.map((job) => (
        <button
          key={job.eventId}
          type="button"
          className={job.eventId === selectedId ? "job sel" : "job"}
          aria-current={job.eventId === selectedId}
          onClick={() => {
            onSelect(job.eventId);
          }}
        >
          <span className={`job-dot ${jobDotClass(job.status)}`.trimEnd()} aria-hidden="true" />
          <span className="job-title">{jobLabel(job)}</span>
          <span className="job-meta">{job.status}</span>
        </button>
      ))}
    </div>
  );
}
