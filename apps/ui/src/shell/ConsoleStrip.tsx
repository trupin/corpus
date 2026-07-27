import { useHealth } from "@corpus/kit";
import type { ReactElement } from "react";
import "./ConsoleStrip.css";

function ServerStatus(): ReactElement {
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
 * The collapsed one-line strip (SPEC.md §11). Agent status, queue depth, job
 * counts, the HALT toggle and the expandable master-detail body are UI-011 —
 * this issue shows only what it can honestly know: whether the server answers.
 */
export function ConsoleStrip(): ReactElement {
  return (
    <div className="console">
      <div className="console-strip">
        <span className="c-caret" aria-hidden="true">
          ▴
        </span>
        <span>console</span>
        <span className="spacer" />
        <ServerStatus />
      </div>
    </div>
  );
}
