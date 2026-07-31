import type { QueueStatus } from "@corpus/contract";
import { useHealth } from "@corpus/kit";
import type { KeyboardEvent, ReactElement } from "react";
import { usePluginRegistry } from "../plugins/registry";
import { AgentPill } from "./AgentPill";
import { consoleCounts } from "./consoleModel";

/**
 * The collapsed one-line strip (SPEC.md §11): caret, the word `console`, the
 * agent pill, the counts, the reachability notice, and the HALT toggle pinned
 * right. Clicking anywhere on it toggles the drawer.
 */

export function ServerStatus(): ReactElement {
  const health = useHealth();

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
  return (
    <span className="c-status" role="status">
      corpus {health.data.version}
    </span>
  );
}

/**
 * Plugin load warnings (SPEC.md §10: "a manifest that fails to load is skipped
 * with a visible warning"). Written once at bootstrap by `loadPlugins()` and
 * read here, so a broken plugin is a fact in the strip — not only a
 * `console.error` a user never opens. The class is its own (`.c-plugin-warn`),
 * never `.c-failed`, which is the reachability notice's and is asserted in
 * Playwright strict mode (sprint-010 adjudication 5).
 */
export function PluginWarnings(): ReactElement | null {
  const warnings = usePluginRegistry().warnings;
  if (warnings.length === 0) return null;
  const detail = warnings.map((warning) => `${warning.plugin}: ${warning.reason}`).join("\n");
  return (
    <span className="c-plugin-warn" role="status" title={detail}>
      {warnings.length === 1
        ? `plugin ${warnings[0]?.plugin ?? ""} skipped`
        : `${String(warnings.length)} plugin warnings`}
    </span>
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
  readonly status: QueueStatus;
  /** False while the queue status is unknown — halting would be a guess. */
  readonly controlsEnabled: boolean;
  readonly onToggle: () => void;
  readonly onToggleHalt: () => void;
}

export function ConsoleStrip({
  open,
  status,
  controlsEnabled,
  onToggle,
  onToggleHalt,
}: ConsoleStripProps): ReactElement {
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
      <AgentPill status={status} />
      <ConsoleCounts status={status} />
      <span className="spacer" />
      <PluginWarnings />
      <ServerStatus />
      <button
        type="button"
        className={status.halted ? "halt-btn halted" : "halt-btn"}
        disabled={!controlsEnabled}
        aria-pressed={status.halted}
        title={
          status.halted
            ? "Resume the queue — removes the .corpus/HALT sentinel"
            : "Halt the queue — writes the .corpus/HALT sentinel; nothing is claimed until resume"
        }
        onClick={(event) => {
          // The strip toggles on click; the control inside it must not.
          event.stopPropagation();
          onToggleHalt();
        }}
      >
        HALT {status.halted ? "●" : "○"}
      </button>
    </div>
  );
}
