import type { Job } from "@corpus/contract";
import type { ReactElement } from "react";
import { useContextMenu } from "../menu/ContextMenuHost";
import { JobMenuItems } from "../menu/JobMenuItems";
import { keepsNativeMenu, selectionText } from "../menu/nativeMenu";
import { blockedOn, blockedOnDetailLabel, jobDotClass, jobLabel } from "./consoleModel";

/**
 * The master half of the console's master-detail (SPEC.md §11): a fixed 380 px
 * list of jobs, newest first, one row per queue event.
 *
 * A row is a real `<button>` inside a `role="listbox"`-free plain list: the
 * rows are navigable by Tab and activated by Enter or Space with no handler of
 * our own, and `aria-current` says which one the detail pane is showing.
 *
 * Right-clicking a row opens that row's own actions — `↗ open` plus, for a
 * `failed` or `deferred` job, Retry and Abandon (SPEC.md §11). The set is the
 * detail header's, from one declaration: a running job's menu must not offer
 * Retry, because its header does not.
 *
 * A deferred row carries one extra span naming the document it is waiting for
 * (SERVER-030 eval FAIL-1). The dot and the status word say *deferred*; without
 * the name, the row still cannot be told from a stuck job — which is the
 * failure mode the contract's own field description names.
 */
export interface JobListProps {
  readonly jobs: readonly Job[];
  readonly selectedId: string | null;
  readonly onSelect: (eventId: string) => void;
}

export function JobList({ jobs, selectedId, onSelect }: JobListProps): ReactElement {
  const menu = useContextMenu();
  return (
    <div className="job-list" aria-label="Jobs">
      {jobs.map((job) => {
        const blocker = blockedOn(job);
        return (
          <button
            key={job.eventId}
            type="button"
            className={job.eventId === selectedId ? "job sel" : "job"}
            aria-current={job.eventId === selectedId}
            onClick={() => {
              onSelect(job.eventId);
            }}
            onContextMenu={(event) => {
              if (keepsNativeMenu({ target: event.target, selection: selectionText() })) return;
              event.preventDefault();
              // The menu acts on the row under the cursor, which is not
              // necessarily the selected job (sprint-016 TEST-433).
              menu.open({
                label: `Actions for ${jobLabel(job)}`,
                clientX: event.clientX,
                clientY: event.clientY,
                items: (close) => <JobMenuItems job={job} close={close} />,
              });
            }}
          >
            <span className={`job-dot ${jobDotClass(job.status)}`.trimEnd()} aria-hidden="true" />
            <span className="job-title">{jobLabel(job)}</span>
            {blocker === null ? null : (
              /*
               * `🔒 <name>` rather than the full `blocked on <name>`: three
               * labels do not fit 380 px, and spending ten characters on the
               * preposition is what pushes the document's name — the one fact
               * the row exists to add — into an ellipsis. The lock glyph is the
               * mockup's own affordance for a held document (`🔒 agent
               * editing`), the sepia matches the deferred dot beside it, and the
               * full sentence with the id is on the hover and in the detail pane.
               */
              <span className="job-blocked" title={blockedOnDetailLabel(blocker)}>
                🔒 {blocker.name}
              </span>
            )}
            <span className="job-meta">{job.status}</span>
          </button>
        );
      })}
    </div>
  );
}
