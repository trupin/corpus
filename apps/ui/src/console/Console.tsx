import type { Job } from "@corpus/contract";
import { useHaltQueue, useIndexStatus, useJobs, useQueueStatus, useResumeQueue } from "@corpus/kit";
import { useState, type KeyboardEvent, type ReactElement } from "react";
import { useNotices, useToast } from "../shell/Toasts";
import { resolveSelectedJob } from "./consoleModel";
import { ConsoleStrip } from "./ConsoleStrip";
import { IndexStatusRow } from "./IndexPill";
import { JobDetail } from "./JobDetail";
import { JobList } from "./JobList";
import { Notices } from "./Notices";
import { Residents } from "./Residents";
import { CONSOLE_TABS, type ConsoleTab } from "./residentsModel";
import { MAX_CONSOLE_HEIGHT_RATIO, MIN_CONSOLE_HEIGHT, useConsoleLayout } from "./useConsoleLayout";
import "./console.css";

/**
 * The console drawer — the bottom region of the shell and the single home of
 * agent and queue status (SPEC.md §7, §10).
 *
 * **It pushes; it never overlays.** `.app` is a flex column, `.board` is its
 * only flex-grow child, and `.console` is `flex: none`. Giving `.console-body`
 * a height therefore takes that height *from the board* — there is no
 * `position: fixed` anywhere in this feature, and that is the one thing §10
 * explicitly forbids.
 *
 * The body is not rendered at all while collapsed, which is also how "a
 * collapsed drawer consumes nothing" is enforced: with no `JobDetail` mounted
 * there is no log query to refetch, so an invalidation for a chatty job costs
 * nothing while nobody is looking.
 */
interface ConsoleBodyProps {
  readonly tab: ConsoleTab;
  readonly jobs: readonly Job[];
  readonly selectedId: string | null;
  readonly selected: Job | null;
  readonly onSelect: (id: string) => void;
}

/**
 * Whichever body the selected tab names. Split out of {@link Console} only so
 * the choice can be a statement rather than a chain of ternaries inside JSX —
 * three tabs is where that chain stops being readable.
 */
function ConsoleBody({
  tab,
  jobs,
  selectedId,
  selected,
  onSelect,
}: ConsoleBodyProps): ReactElement {
  if (tab === "notices") return <Notices />;
  if (tab === "residents") return <Residents />;
  return (
    <>
      <JobList jobs={jobs} selectedId={selectedId} onSelect={onSelect} />
      <JobDetail job={selected} enabled />
    </>
  );
}

export function Console(): ReactElement {
  const layout = useConsoleLayout();
  const notify = useToast();
  /*
   * The session's notices (UI-139). The drawer reads the same log the toast
   * surface writes, which is what makes the tab a record of what was raised
   * rather than a second, drifting one.
   */
  const notices = useNotices();
  const queue = useQueueStatus();
  /*
   * The index pill's data (SPEC.md §10's index-pill rider). One query for the
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
   * §10's console: a drawer that opened on another tab would have moved the job
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

  /**
   * The tab strip's own keys — the arrows and `Home`/`End` a `role="tablist"`
   * owes a keyboard user, and `Enter`/`Space` on the focused tab.
   *
   * **`Enter` has to be claimed here, and that is not belt-and-braces.** The
   * shell binds `Enter` globally to "open the row at the cursor" and calls
   * `preventDefault()` on it (`useShortcuts`), which cancels the browser's own
   * activation of *any* focused button in board scope. A React handler runs
   * before that document listener and marks the event handled, so this is what
   * makes the tabs pressable by keyboard at all — they were not before, and
   * neither were Jobs and Residents. The wider defect (every button in board
   * scope loses `Enter`) is not this issue's to fix and is reported separately.
   */
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const pressed = event.target;
    if (!(pressed instanceof HTMLElement)) return;
    const from = CONSOLE_TABS.findIndex((entry) => entry.id === pressed.dataset.tab);
    if (from === -1) return;

    const last = CONSOLE_TABS.length - 1;
    const step: Record<string, number> = {
      ArrowRight: from === last ? 0 : from + 1,
      ArrowLeft: from === 0 ? last : from - 1,
      Home: 0,
      End: last,
      Enter: from,
      " ": from,
    };
    const to = step[event.key];
    if (to === undefined) return;
    const entry = CONSOLE_TABS[to];
    if (entry === undefined) return;

    event.preventDefault();
    setTab(entry.id);
    // Automatic activation: the focus follows the selection, which is the
    // pattern for tabs whose panels are already mounted and cheap to swap.
    document.getElementById(`console-tab-${entry.id}`)?.focus();
  };

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
        unreadNotice={notices.unreadError}
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
           * Three bodies, one drawer (UI-125, then UI-139): the queue's jobs,
           * this session's notices, and §7's roster with what each lane owns.
           * None of the three is the corpus — each is the running system's own
           * account of itself, which is what §10 puts in the console.
           */}
          <div
            className="console-tabs"
            role="tablist"
            aria-label="Console"
            onKeyDown={onTabsKeyDown}
          >
            {CONSOLE_TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`console-tab-${entry.id}`}
                data-tab={entry.id}
                className={entry.id === tab ? "console-tab sel" : "console-tab"}
                aria-selected={entry.id === tab}
                aria-controls="console-panel"
                /* The strip's marker again, at the tab it names — the strip is
                   still on screen with the drawer open, so this repeats it
                   rather than replacing it. The attribute is on the Notices tab
                   whether or not it is lit, and `console.css` reserves the dot's
                   box off that, so lighting it re-widths nothing. */
                data-unread={entry.id === "notices" ? notices.unreadError : undefined}
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
            <ConsoleBody
              tab={tab}
              jobs={rows}
              selectedId={selectedId}
              selected={selected}
              onSelect={setChosen}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
