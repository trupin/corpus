import { CorpusRequestError, useCheckUpgrade, useHealth, useStartUpgrade } from "@corpus/kit";
import type { UpgradeCheck } from "@corpus/contract";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import {
  canUpgrade,
  checkHeading,
  checkSentence,
  DEFAULT_LOG_PATH,
  doneSentence,
  stalledSentence,
  unchangedSentence,
  UPGRADING_SENTENCE,
  type UpgradePhase,
} from "./upgradeModel";
import "./upgrade.css";

/**
 * SPEC.md §2.4's UI half: "a check affordance, and when a newer release exists,
 * an 'Upgrade & restart' action that asks the server to spawn the detached CLI
 * upgrade; the UI rides out the restart with its normal SSE reconnect and shows
 * the new version on return."
 *
 * **It checks when it is opened, and at no other moment.** Opening it is the
 * explicit act — a person clicked the version — and nothing here re-checks on a
 * focus, a reconnect or a remount. The hooks are mutations rather than queries
 * for exactly that reason (`@corpus/kit`'s `useUpgrade`).
 *
 * **The restart is ridden out here, not endured.** After the `202` the server is
 * on its way out, so `GET /api/health` starts failing and the console strip's
 * ordinary "server unreachable" becomes true — and reporting a fault at the
 * moment the thing is working is the defect this panel exists to avoid. While
 * the upgrade is in flight the panel says so, and the strip says so too
 * (`UpgradeProvider` publishes the fact one component up).
 */

export interface UpgradePanelProps {
  readonly onClose: () => void;
  /** Told when a trigger is accepted and when the server is back. */
  readonly onInFlight: (inFlight: boolean) => void;
  /**
   * How long to wait for the restart before saying so instead (SPEC.md §2.4
   * puts no bound on an upgrade, and neither does this — it stops *claiming*).
   * A parameter so a test need not wait ninety seconds for its own assertion.
   */
  readonly stallAfterMs?: number;
}

/**
 * Ninety seconds. A download, an `npm install -g` and a restart on a slow link,
 * with room to spare — long enough that a normal upgrade never trips it, short
 * enough that an upgrade which declined does not leave a person watching a
 * sentence that is no longer true.
 */
export const STALL_AFTER_MS = 90_000;

export function UpgradePanel({
  onClose,
  onInFlight,
  stallAfterMs = STALL_AFTER_MS,
}: UpgradePanelProps): ReactElement {
  const health = useHealth();
  const check = useCheckUpgrade();
  const start = useStartUpgrade();
  const [phase, setPhase] = useState<UpgradePhase>("idle");
  const [result, setResult] = useState<UpgradeCheck | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  /** The version we left, captured before the server goes away. */
  const leftAt = useRef<string | null>(null);
  /** Whether the probe has failed since the trigger — the restart, observed. */
  const dropped = useRef(false);

  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Overlay, onEscape: onClose });

  const runCheck = check.mutate;
  /*
   * The one automatic call in the feature, and it is the click that opened the
   * panel — mounting is the user's act, not a lifecycle Corpus took upon itself.
   * The dependency list is the mutate function, which react-query keeps stable,
   * so this runs once per opening and never again.
   */
  useEffect(() => {
    setPhase("checking");
    runCheck(undefined, {
      onSuccess: (answer) => {
        setResult(answer);
        setPhase("checked");
      },
      onError: () => {
        setPhase("check-failed");
      },
    });
  }, [runCheck]);

  /*
   * The ride-through, in two halves, and the order is the whole of it.
   *
   * **The server going away is what starts it.** A probe that simply *succeeds*
   * after the trigger proves nothing: the `202` is written before the download
   * begins, so for the first several seconds the old server is still answering
   * on the old version. Declaring the upgrade finished then would report a
   * result before anything had happened. So the panel waits for the probe to
   * fail — the restart — and only a success **after** that is the new server.
   */
  useEffect(() => {
    if (phase !== "upgrading" || !health.isError) return;
    dropped.current = true;
  }, [health.isError, phase]);

  /*
   * `dataUpdatedAt`, not `data`. A server that comes back on the **same**
   * version answers with a body structurally equal to the last one, and
   * react-query's structural sharing hands back the identical object — so an
   * effect watching `data` never fires and the panel says "upgrading" forever.
   * The stamp moves on every successful fetch, which is the fact being waited
   * for: the server answered again.
   */
  useEffect(() => {
    if (phase !== "upgrading" || !dropped.current) return;
    if (health.status !== "success") return;
    setPhase("done");
    onInFlight(false);
  }, [health.dataUpdatedAt, health.status, phase, onInFlight]);

  /*
   * And the bound, because "wait for the server to go away" has to answer for
   * the case where it never does. An upgrade can decline after starting — an
   * undetectable install method, a release that stopped being verifiable — and
   * then nothing restarts and nothing drops. A spinner that never ends would be
   * the panel's own version of the false promise this issue exists to remove.
   */
  useEffect(() => {
    if (phase !== "upgrading") return undefined;
    const timer = setTimeout(() => {
      setPhase("stalled");
      onInFlight(false);
    }, stallAfterMs);
    return () => {
      clearTimeout(timer);
    };
  }, [phase, onInFlight, stallAfterMs]);

  const onUpgrade = (): void => {
    leftAt.current = health.data?.version ?? null;
    setPhase("starting");
    start.mutate(undefined, {
      onSuccess: (started) => {
        setLogPath(started.logPath);
        dropped.current = false;
        setPhase("upgrading");
        onInFlight(true);
      },
      onError: (error) => {
        // The `409` is a refusal to start a *second* upgrade, not a failure of
        // the first, so it is reported as the fact it is rather than as an
        // error with a retry beside it.
        if (error instanceof CorpusRequestError && error.status === 409) {
          setRefusal(error.message);
          setPhase("refused");
          return;
        }
        setRefusal(error.message);
        setPhase("start-failed");
      },
    });
  };

  return (
    <div
      className="overlay open"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        // Not while the server is being replaced: dismissing the one surface
        // that explains the outage leaves a person looking at "server
        // unreachable" with no idea why.
        if (phase === "upgrading" || phase === "starting") return;
        onClose();
      }}
    >
      <div
        className="search-panel upgrade-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Updates"
      >
        <h3>Updates</h3>
        <UpgradeBody
          phase={phase}
          result={result}
          refusal={refusal}
          logPath={logPath}
          leftAt={leftAt.current}
          version={health.data?.version ?? null}
        />
        <div className="upgrade-actions">
          {phase === "checked" && result !== null && canUpgrade(result) ? (
            <button type="button" className="btn-upgrade" onClick={onUpgrade}>
              Upgrade &amp; restart
            </button>
          ) : null}
          <button
            type="button"
            className="btn-close"
            disabled={phase === "upgrading" || phase === "starting"}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface UpgradeBodyProps {
  readonly phase: UpgradePhase;
  readonly result: UpgradeCheck | null;
  readonly refusal: string | null;
  readonly logPath: string | null;
  readonly leftAt: string | null;
  readonly version: string | null;
}

/** The panel's one paragraph, chosen by phase. Split out so the choice reads as one. */
function UpgradeBody({
  phase,
  result,
  refusal,
  logPath,
  leftAt,
  version,
}: UpgradeBodyProps): ReactElement {
  if (phase === "checking" || phase === "idle") {
    return <p className="upgrade-line">Asking GitHub for the newest release…</p>;
  }
  if (phase === "check-failed") {
    return (
      <p className="upgrade-line" role="status">
        This server could not be asked, so nothing is known about newer releases.
      </p>
    );
  }
  if (phase === "starting") {
    return <p className="upgrade-line">Starting the upgrade…</p>;
  }
  if (phase === "upgrading") {
    return (
      <p className="upgrade-line upgrade-riding" role="status">
        {UPGRADING_SENTENCE}
      </p>
    );
  }
  if (phase === "done") {
    const now = version ?? "an unknown version";
    return (
      <p className="upgrade-line" role="status">
        {leftAt !== null && leftAt !== now
          ? doneSentence(leftAt, now)
          : unchangedSentence(now, logPath ?? DEFAULT_LOG_PATH)}
      </p>
    );
  }
  if (phase === "stalled") {
    return (
      <p className="upgrade-line" role="status">
        {stalledSentence(logPath ?? DEFAULT_LOG_PATH)}
      </p>
    );
  }
  if (phase === "refused" || phase === "start-failed") {
    return (
      <p className="upgrade-line upgrade-refused" role="status">
        {refusal ?? "The upgrade could not be started."}
      </p>
    );
  }
  if (result === null) return <p className="upgrade-line">Nothing to report.</p>;
  return (
    <>
      <p className="upgrade-heading">{checkHeading(result)}</p>
      <p className="upgrade-line">{checkSentence(result)}</p>
      {result.notesUrl === null ? null : (
        <p className="upgrade-notes">
          <a href={result.notesUrl} target="_blank" rel="noreferrer">
            Read what changed
          </a>
        </p>
      )}
    </>
  );
}
