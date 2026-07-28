import { useHaltQueue, useJobs, useQueueStatus, useResumeQueue } from "@corpus/kit";
import { useState, type ReactElement } from "react";
import { useToast } from "../shell/Toasts";
import { UNKNOWN_QUEUE_STATUS, resolveSelectedJob } from "./consoleModel";
import { ConsoleStrip } from "./ConsoleStrip";
import { JobDetail } from "./JobDetail";
import { JobList } from "./JobList";
import { MAX_CONSOLE_HEIGHT_RATIO, MIN_CONSOLE_HEIGHT, useConsoleLayout } from "./useConsoleLayout";
import "./console.css";

/**
 * The console drawer — the bottom region of the shell and the single home of
 * agent and queue status (SPEC.md §7, §11).
 *
 * **It pushes; it never overlays.** `.app` is a flex column, `.board` is its
 * only flex-grow child, and `.console` is `flex: none`. Giving `.console-body`
 * a height therefore takes that height *from the board* — there is no
 * `position: fixed` anywhere in this feature, and that is the one thing §11
 * explicitly forbids.
 *
 * The body is not rendered at all while collapsed, which is also how "a
 * collapsed drawer consumes nothing" is enforced: with no `JobDetail` mounted
 * there is no log query to refetch, so an invalidation for a chatty job costs
 * nothing while nobody is looking.
 */
export function Console(): ReactElement {
  const layout = useConsoleLayout();
  const notify = useToast();
  const queue = useQueueStatus();
  const jobs = useJobs();
  const halt = useHaltQueue();
  const resume = useResumeQueue();
  const [chosen, setChosen] = useState<string | null>(null);

  const status = queue.data ?? UNKNOWN_QUEUE_STATUS;
  const rows = jobs.data?.jobs ?? [];
  const selectedId = resolveSelectedJob(rows, chosen);
  const selected = rows.find((job) => job.eventId === selectedId) ?? null;

  const onToggleHalt = (): void => {
    const failed = (error: Error): void => {
      notify({ tone: "error", message: error.message });
    };
    if (status.halted) {
      resume.mutate(undefined, {
        onSuccess: () => {
          notify({ tone: "info", message: "Resumed — the queue is claimable again." });
        },
        onError: failed,
      });
      return;
    }
    halt.mutate(undefined, {
      onSuccess: () => {
        notify({
          tone: "info",
          message: "HALT set — nothing is claimed until resume (.corpus/HALT).",
        });
      },
      onError: failed,
    });
  };

  return (
    <div className={layout.open ? "console open" : "console"}>
      {layout.open ? (
        <div
          className={layout.dragging ? "console-resizer dragging" : "console-resizer"}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize console"
          aria-valuenow={Math.round(layout.height)}
          aria-valuemin={MIN_CONSOLE_HEIGHT}
          aria-valuemax={Math.round(window.innerHeight * MAX_CONSOLE_HEIGHT_RATIO)}
          tabIndex={0}
          onPointerDown={layout.onResizerPointerDown}
          onKeyDown={layout.onResizerKeyDown}
        />
      ) : null}
      <ConsoleStrip
        open={layout.open}
        status={status}
        controlsEnabled={queue.data !== undefined}
        onToggle={layout.toggle}
        onToggleHalt={onToggleHalt}
      />
      {layout.open ? (
        <div className="console-body" style={{ height: `${String(layout.height)}px` }}>
          <JobList jobs={rows} selectedId={selectedId} onSelect={setChosen} />
          <JobDetail job={selected} enabled />
        </div>
      ) : null}
    </div>
  );
}
