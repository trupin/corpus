import type { IndexStatus, QueueStatus } from "@corpus/contract";
import { useHealth } from "@corpus/kit";
import type { KeyboardEvent, ReactElement } from "react";
import { AgentPill } from "./AgentPill";
import { UNKNOWN_QUEUE_STATUS, consoleCounts } from "./consoleModel";
import { IndexPill } from "./IndexPill";
import { NOTICES_UNREAD_HINT } from "./noticesModel";
import { UPGRADING_SENTENCE } from "../upgrade/upgradeModel";
import { useUpgradeSurface } from "../upgrade/UpgradeProvider";

/**
 * The collapsed one-line strip (SPEC.md §10): caret, the word `console`, the
 * agent pill, the counts, the reachability notice, and the HALT toggle pinned
 * right. Clicking anywhere on it toggles the drawer.
 */

/**
 * The version, and the only affordance in the app that reaches SPEC.md §2.4.
 *
 * It is a **button** rather than a span because the version is exactly where a
 * person looks to ask "am I current" — and it keeps the same words, the same
 * class and therefore the same 24ch bound, so nothing about the strip moves for
 * making it pressable. Pressing it opens the updates panel, which is what
 * performs the check; nothing checks before that, because §2.4 says Corpus never
 * looks unless asked.
 *
 * **While an upgrade is running it does not say "server unreachable".** It is
 * true that the server cannot be reached — the upgrade's last act is replacing
 * it — but a fault is not what is happening, and this is the line a person
 * watches while they wait (UI-035).
 */
export function ServerStatus(): ReactElement {
  const health = useHealth();
  const upgrade = useUpgradeSurface();

  if (upgrade.inFlight) {
    return (
      <span className="c-status" role="status" title={UPGRADING_SENTENCE}>
        upgrading…
      </span>
    );
  }
  if (health.isError) {
    // Fail soft: the server being down is a fact to report, not a reason to
    // stop rendering the shell. The board and the top bar stay usable.
    return (
      <span className="c-failed" role="status">
        server unreachable
      </span>
    );
  }
  if (health.data === undefined) {
    return (
      <span className="c-status" role="status">
        checking server…
      </span>
    );
  }
  /*
   * `title` because the version is the server's string, not ours: `.c-status`
   * is bounded at 24ch and a long pre-release tag ellipsises, so the whole of
   * it has to be reachable in place (SPEC.md §10's rider, clause 2).
   */
  return (
    <button
      type="button"
      className="c-status c-status-button"
      // No `role="status"` here, unlike the three spans above: an explicit role
      // *replaces* the implicit one, and a `<button role="status">` is not a
      // button to a screen reader. The live-region announcement belonged to the
      // states that change under a person; this one is a control they press.
      title={`corpus ${health.data.version} — check for updates`}
      onClick={(event) => {
        // The strip around it is itself a button that toggles the drawer.
        event.stopPropagation();
        upgrade.open();
      }}
    >
      corpus {health.data.version}
    </button>
  );
}

/**
 * `N running[· N queued][· N deferred] · N done · N failed`, with the failed
 * count in `--signal`.
 *
 * Its span is `.c-failed-jobs`, **not** the prototype's `.c-failed`: that class
 * is the reachability notice's, and `apps/ui/e2e/smoke.spec.ts` asserts on it in
 * Playwright's strict mode. Two matches in one strip would break a shipped spec
 * (sprint-010 adjudication 5).
 */
export function ConsoleCounts({ status }: { readonly status: QueueStatus }): ReactElement {
  const counts = consoleCounts(status);
  return (
    <span className="c-counts">
      {counts.lead}
      {" · "}
      <span className="c-failed-jobs">{counts.failed} failed</span>
    </span>
  );
}

export interface ConsoleStripProps {
  readonly open: boolean;
  /**
   * The queue status, or `undefined` while `GET /api/queue/status` has not
   * answered — including when it never will.
   *
   * The strip splits it rather than substituting once (UI-098). The **counts**
   * take `UNKNOWN_QUEUE_STATUS`, whose zeroes are true of a server that is not
   * there, and the **HALT button** takes its disabled state from the same
   * absence, since halting on a guess would be a write. The **agent pill** takes
   * the `undefined` itself: the placeholder's `agent: {live: false}` is a
   * required field with nothing behind it, and handing it to a pill that now
   * reads presence would publish "no agent is connected" about a server that has
   * merely not replied. One substitution for two questions is how that happens,
   * so there is one substitution and it stops short of the pill.
   */
  readonly status: QueueStatus | undefined;
  /**
   * The semantic index's report, or `undefined` while the server has not
   * answered — including when it never will.
   *
   * Unlike the queue status, an absent one is **not** substituted with zeroes:
   * `UNKNOWN_QUEUE_STATUS` can stand in because "0 running" is true of a server
   * that is not there, while every index state is a claim about a workspace's
   * vectors. `index: disabled` on an unreachable server would say the workspace
   * has no semantic index, which nobody knows. So the pill is simply absent, and
   * the reachability notice two spans to the right is the fact that is true.
   */
  readonly index: IndexStatus | undefined;
  /**
   * Whether an error notice has arrived that the Notices tab has not been
   * opened since (UI-139).
   *
   * The marker is drawn either way and only *lit* by this flag — see
   * `.c-notice-mark` in `console.css`. A mark that appeared would re-width the
   * line it appeared on, which is exactly what §10's rider forbids, and it would
   * do it on the one row that always renders.
   */
  readonly unreadNotice: boolean;
  readonly onToggle: () => void;
  readonly onToggleHalt: () => void;
}

export function ConsoleStrip({
  open,
  status,
  index,
  unreadNotice,
  onToggle,
  onToggleHalt,
}: ConsoleStripProps): ReactElement {
  /** The counts' stand-in. Never the pill's — see {@link ConsoleStripProps}. */
  const counts = status ?? UNKNOWN_QUEUE_STATUS;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onToggle();
  };

  return (
    <div
      className="console-strip"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label="Toggle console"
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span className="c-caret" aria-hidden="true">
        ▴
      </span>
      <span>console</span>
      {/*
       * The attention marker (SHARED-058, call 5): "there is a refusal in here
       * you have not been shown". Error tone only — a dot that lit for every
       * saved document is noise, and noise is how a marker stops being read.
       *
       * Always rendered, never conditionally, so its arrival moves nothing. It
       * is `aria-hidden` and carries only a tooltip: the strip is a
       * `role="button"` with its own `aria-label`, so nothing inside it is
       * announced anyway — and a screen-reader user has already had the whole
       * notice read out of the toast's live region, which is the group this
       * marker was never for.
       */}
      <span
        className="c-notice-mark"
        data-unread={unreadNotice}
        aria-hidden="true"
        title={unreadNotice ? NOTICES_UNREAD_HINT : undefined}
      >
        ●
      </span>
      <AgentPill status={status} />
      <ConsoleCounts status={counts} />
      {/*
       * The index pill sits **after** the counts and immediately before the
       * spacer, which is the one slot in this row where a late arrival displaces
       * nothing (SPEC.md §10's rider — "a value that arrives later than the box
       * holding it" moves nothing else).
       *
       * `GET /api/index/status` answers after first paint, and the pill is
       * roughly 210px of it. Between the agent pill and the counts, that 210px
       * pushed `.c-counts` right on the frame the answer landed. Here the left
       * group is already laid out and the right group is anchored to the right
       * edge, so the pill materialises into the spacer's slack.
       *
       * The alternative — reserving its slot — was rejected: a workspace with no
       * semantic index would carry a 210px hole in its strip forever, which is a
       * worse answer to the same question.
       */}
      {index === undefined ? null : <IndexPill status={index} />}
      <span className="spacer" />
      <ServerStatus />
      <button
        type="button"
        className={counts.halted ? "halt-btn halted" : "halt-btn"}
        // Halting while the status is unknown would be a guess, and a write.
        disabled={status === undefined}
        aria-pressed={counts.halted}
        title={
          counts.halted
            ? "Resume the queue — removes the .corpus/HALT sentinel"
            : "Halt the queue — writes the .corpus/HALT sentinel; nothing is claimed until resume"
        }
        onClick={(event) => {
          // The strip toggles on click; the control inside it must not.
          event.stopPropagation();
          onToggleHalt();
        }}
      >
        HALT {counts.halted ? "●" : "○"}
      </button>
    </div>
  );
}
