import { DEFAULT_REFLECT_QUIET_MINUTES } from "@corpus/contract";
import type { ReactElement } from "react";
import { useOpenInColumn } from "../board/openInColumn";
import { useToast } from "../shell/Toasts";
import "./ReflectControl.css";
import {
  automaticIsOn,
  quietSwitchTitle,
  reflectControlLabel,
  reflectControlTitle,
  reflectedLabel,
} from "./unreflected";
import { useAskReflection, useReflectStatus, useSetReflectQuiet } from "./useReflectStatus";

/**
 * The board bar's **Reflect** control (SPEC.md §7's rider 9, §10's board bar).
 *
 * Two elements, because they are two acts. The button asks for a reflection over
 * the whole corpus and carries the corpus count of what is unreflected; the text
 * beside it says when the last one landed and opens its digest thread.
 *
 * **Pressing it twice is not an error.** §7 is explicit that an ask while one is
 * pending is answered with the pending one rather than doubled, and the route
 * answers `202` for both — so a second press produces the pending state and
 * never a toast. The only thing that raises one here is a request that did not
 * reach the server.
 *
 * **It never changes the bar's height.** The bar is chrome at a fixed 38px
 * (§10: "nothing resizes because of what it holds"), so the control is
 * `flex: none`, never wraps, and puts its count in a fixed-width tabular box —
 * the same treatment `.col-count` gets, and for the same reason: a count
 * crossing from one digit to two must move nothing beside it.
 */

export interface ReflectControlProps {
  /** Injectable clock, so a test can pin the relative time. */
  readonly now?: Date | undefined;
}

export function ReflectControl({ now }: ReflectControlProps): ReactElement {
  const status = useReflectStatus();
  const ask = useAskReflection();
  const setQuiet = useSetReflectQuiet();
  const navigation = useOpenInColumn();
  const toast = useToast();
  const at = now ?? new Date();
  const data = status.data;

  const label = reflectControlLabel(data, at);
  const isReflecting = data !== undefined && data.pending !== null;
  const digest = data?.lastDigest ?? null;
  const automatic = automaticIsOn(data);

  return (
    <div className="reflect">
      <button
        type="button"
        className="reflect-ask"
        // A person may always ask, even with nothing changed (§7: "a person
        // asks — the board bar's Reflect control — and it is enqueued at
        // once"). What disables it is a reflection already running, and the
        // moment between the press and the server's answer.
        disabled={isReflecting || ask.isPending}
        data-reflecting={isReflecting ? "" : undefined}
        data-changed={label.count === null ? undefined : String(label.count)}
        aria-label={label.text}
        title={reflectControlTitle(data)}
        onClick={() => {
          ask.mutate(undefined, {
            onError: (error) => {
              toast({ tone: "error", message: `Reflect failed — ${error.message}` });
            },
          });
        }}
      >
        {/*
         * **Three elements, not two text nodes around a span** (UI-181).
         *
         * This button is a flex row, so a bare text run becomes an *anonymous*
         * flex item — and CSS strips whitespace at both ends of one. The label's
         * own trailing and leading spaces were composed correctly, carried
         * correctly in the DOM, announced correctly by the accessible name, and
         * thrown away at layout: a person read `Reflect ·  5changes since 1w`.
         * Real elements with `white-space: pre` keep what
         * `reflectControlLabel` wrote, which is why the fix is here and not in
         * the strings — the strings were never wrong.
         */}
        <span className="reflect-said">{label.lead}</span>
        {label.count === null ? null : <span className="reflect-count">{label.count}</span>}
        {label.trail === "" ? null : <span className="reflect-said">{label.trail}</span>}
      </button>

      {/*
       * **The switch** (UI-172; SPEC.md §7's rider signed 2026-08-25).
       *
       * Beside the ask, because the two are the same decision seen from either
       * side: whether the corpus reflects on its own, and asking it to now.
       *
       * **It never disables the ask, which is the whole of what was asked for**
       * — with the automatic path off, this button becomes the only way a
       * reflection happens, so disabling it would remove the last one.
       *
       * **Absent until the status arrives**, not rendered as "off". A control
       * that said "off" before it had read anything would be making a claim
       * about the workspace on the strength of not knowing (UI-098's rule), and
       * its slot is reserved in CSS so the arrival moves nothing beside it
       * (SPEC.md §10).
       */}
      <span className="reflect-auto">
        {automatic === undefined ? null : (
          <button
            type="button"
            className="reflect-auto-switch"
            role="switch"
            aria-checked={automatic}
            aria-label="Automatic reflection"
            disabled={setQuiet.isPending}
            title={quietSwitchTitle(data, DEFAULT_REFLECT_QUIET_MINUTES)}
            onClick={() => {
              // `0` is §7's spelling of off, and the default is what on
              // restores — SHARED-071 chose showing that number over
              // remembering the old one, and the tooltip is where it shows.
              setQuiet.mutate(automatic ? 0 : DEFAULT_REFLECT_QUIET_MINUTES, {
                onError: (error) => {
                  toast({ tone: "error", message: `Could not change it — ${error.message}` });
                },
              });
            }}
          >
            {automatic ? "auto" : "auto off"}
          </button>
        )}
      </span>

      {/*
       * The clock, and the way to what was said about it. Rendered only once a
       * status has arrived: a browser that has not read the clock must not
       * announce "never reflected", which is a claim about the corpus and not
       * about this page (UI-098's rule — unknown needs somewhere to live, and
       * here the surface can withhold by omission).
       */}
      {data === undefined ? null : digest === null ? (
        <span
          className="reflect-clock"
          title="A reflection posts a digest thread. There is none to open yet."
        >
          {reflectedLabel(data, at)}
        </span>
      ) : (
        <button
          type="button"
          className="reflect-clock reflect-digest"
          title="Open the last reflection’s digest thread"
          onClick={() => {
            // The board's own open. It lands wherever a request naming no
            // origin lands — today the resolved column, and UI-149's loose
            // path at the left edge once every `open()` caller goes through
            // one. The digest is a standalone thread and carries no placement
            // this control knows, so no `subject` rides along.
            navigation.open({ docId: digest });
          }}
        >
          {reflectedLabel(data, at)}
        </button>
      )}
    </div>
  );
}
