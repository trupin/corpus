import { useHaltQueue, useIndexStatus, useJobs, useQueueStatus, useResumeQueue } from "@corpus/kit";
import { useState, type ReactElement } from "react";
import { useToast } from "../shell/Toasts";
import { resolveSelectedJob } from "./consoleModel";
import { ConsoleStrip } from "./ConsoleStrip";
import { IndexStatusRow } from "./IndexPill";
import { JobDetail } from "./JobDetail";
import { JobList } from "./JobList";
import { Residents } from "./Residents";
import { CONSOLE_TABS, type ConsoleTab } from "./residentsModel";
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
  /*
   * The index pill's data (SPEC.md §11's index-pill rider). One query for the
   * whole feature, mounted with the strip rather than with the drawer body: the
   * pill is on the collapsed line, so unlike the job log there is nothing to
   * defer. It costs one request per `["index"]` frame and never polls.
   */
  const index = useIndexStatus();
  const jobs = useJobs();
  const halt = useHaltQueue();
  const resume = useResumeQueue();
  const [chosen, setChosen] = useState<string | null>(null);
  /*
   * Which body the drawer is showing (UI-125). Jobs is the default and stays
   * §11's console: a drawer that opened on another tab would have moved the job
   * list somebody expanded it to read. Not persisted, unlike the drawer's open
   * state and height — those are what a person set, and this is where they are
   * looking right now.
   */
  const [tab, setTab] = useState<ConsoleTab>("jobs");

  /*
   * The query's own answer, passed down **unsubstituted** (UI-098). The strip
   * decides what stands in for what: its counts can honestly show zeroes while
   * nothing has answered, and its agent pill cannot honestly show anything at
   * all. Substituting here would have made that a decision nobody could see.
   */
  const status = queue.data;
  const rows = jobs.data?.jobs ?? [];
  const selectedId = resolveSelectedJob(rows, chosen);
  const selected = rows.find((job) => job.eventId === selectedId) ?? null;

  const onToggleHalt = (): void => {
    const failed = (error: Error): void => {
      notify({ tone: "error", message: error.message });
    };
    // The button is disabled while `status` is undefined, so this is only
    // reached with a status the server actually sent.
    if (status?.halted === true) {
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
        index={index.data}
        onToggle={layout.toggle}
        onToggleHalt={onToggleHalt}
      />
      {layout.open ? (
        <>
          {/*
           * Above the master-detail body and outside it: the index's sentence is
           * about the workspace, not about the selected job, and putting it in
           * either pane would tie it to a selection it has nothing to do with.
           * It is `flex: none`, so it takes its height from the drawer's chrome
           * and the body keeps the height the resizer set.
           */}
          <IndexStatusRow status={index.data} />
          {/*
           * Two bodies, one drawer (UI-125, asked for by the user): the queue's
           * jobs, and §7's roster with what each lane owns. Both are the agent's
           * own machinery, which is what §11 puts in the console — and both are
           * master-detail, so one console has one shape.
           */}
          <div className="console-tabs" role="tablist" aria-label="Console">
            {CONSOLE_TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`console-tab-${entry.id}`}
                className={entry.id === tab ? "console-tab sel" : "console-tab"}
                aria-selected={entry.id === tab}
                aria-controls="console-panel"
                onClick={() => {
                  setTab(entry.id);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div
            className="console-body"
            id="console-panel"
            role="tabpanel"
            aria-labelledby={`console-tab-${tab}`}
            style={{ height: `${String(layout.height)}px` }}
          >
            {tab === "jobs" ? (
              <>
                <JobList jobs={rows} selectedId={selectedId} onSelect={setChosen} />
                <JobDetail job={selected} enabled />
              </>
            ) : (
              <Residents />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
