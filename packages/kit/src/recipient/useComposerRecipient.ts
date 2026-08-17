import { ORCHESTRATOR_LANE, type AgentLane, type Lane } from "@corpus/contract";
import { useCallback, useState } from "react";
import { useAgentsRoster } from "../query/useAgentsRoster.js";
import { laneRows, unknownLaneRow, type LaneRow } from "./laneRows.js";
import { laneOf } from "./scopeWalk.js";
import { useScopeWalk } from "./useScopeWalk.js";

/**
 * One composer's recipient — SPEC.md §7's *"Every message has a recipient, and
 * where you post computes it"*, and the three prohibitions on overriding it.
 *
 * ## The default is computed, and travels by being absent
 *
 * {@link ComposerRecipient.request} is `{}` for the default and
 * `{recipient: <lane>}` only for an explicit pick that differs from it. The
 * server computes the same default from the same graph, and **omission is how
 * the two cannot drift**: there is no value on the wire for them to disagree
 * about. It is also why the walk being slow, or wrong, or unreadable costs a
 * label and never a route.
 *
 * ## An override is for one message, and there is nowhere for it to persist
 *
 * §7: an override *"routes that message and nothing else — an override never
 * rewires a scope, never re-designates anything, and never persists past the
 * message it was set on."* Three prohibitions, and this hook is where the third
 * is enforced **structurally**: the pick is `useState` inside the composer, and
 * unlike the weight (`weight/weightChoice.ts`, a module-level store keyed by
 * conversation so a choice outlives a re-render on purpose) there is no store to
 * write it to and no scope key to write it under. {@link ComposerRecipient.clear}
 * is called when the send settles — either way, because a refused message is not
 * a message that carried this pick to a second one.
 *
 * The first two prohibitions were once enforced by omission of capability — the
 * kit's client had no way to designate or release — and since UI-109 they are
 * enforced by **evidence** instead, because §11 puts designate/release in the
 * conversation's own menu and that menu is a kit consumer. What is left, and
 * what the test pins, is that nothing on this path issues a request to
 * `/resident` and that `request` is spread onto the message's own body and
 * nothing else: an override routes one message and touches no thread's
 * frontmatter. A structural argument is nicer than an asserted one, but not so
 * much nicer that the board should be made to reach the route some other way.
 */

export interface ComposerRecipient {
  /**
   * The lanes to offer, or `undefined` while the roster has not answered.
   * Never `[]` for "not yet" (see `useAgentsRoster`).
   */
  readonly rows: readonly LaneRow[] | undefined;
  /**
   * Where a message posted here goes with nothing picked, or `undefined` while
   * the walk cannot say. Display only — it never reaches the wire.
   */
  readonly computed: Lane | undefined;
  /** The explicit pick, or `undefined`. */
  readonly chosen: Lane | undefined;
  /** Who will actually answer: the pick, else the computed default, else unknown. */
  readonly effective: Lane | undefined;
  /** Whether the person has overridden the default for this message. */
  readonly overridden: boolean;
  /** Picks a lane; picking the standing one, or `undefined`, clears the override. */
  readonly choose: (lane: Lane | undefined) => void;
  /** `{}` for the default, `{recipient}` for an override. Spread onto the request. */
  readonly request: { readonly recipient?: Lane };
  /** Drops the override. Called when the message it was set on settles. */
  readonly clear: () => void;
}

export interface ComposerRecipientInput {
  /**
   * The conversation a message from this composer lands in — the thread being
   * replied to, the thread a child comment hangs off, or the document a
   * selection comment is on. `null` for the global composer's Ask.
   */
  readonly start: string | null;
}

export function useComposerRecipient({ start }: ComposerRecipientInput): ComposerRecipient {
  const roster = useAgentsRoster();
  const walk = useScopeWalk({ start, lanes: roster.lanes });
  const [chosen, setChosen] = useState<Lane | undefined>(undefined);

  const computed = laneOf(walk);
  const effective = chosen ?? computed;

  const clear = useCallback(() => {
    setChosen(undefined);
  }, []);

  const choose = useCallback((lane: Lane | undefined) => {
    setChosen(lane);
  }, []);

  const rows = rowsToOffer(roster.lanes, computed);
  // Picking the default back states nothing again — the two are one lane, and
  // an override that repeated the default would be a value on the wire where
  // absence already says the same thing, only more durably.
  const overridden = chosen !== undefined && chosen !== computed;

  return {
    rows,
    computed,
    chosen,
    effective,
    overridden,
    choose,
    request: overridden ? { recipient: chosen } : {},
    clear,
  };
}

/**
 * The rows to offer, with the computed default guaranteed to be among them.
 *
 * A default the roster does not list is the window between a designation
 * landing and `["agents"]` refetching. It is shown as *unknown* rather than
 * dropped: a list that does not contain the answer is worse than a row that
 * says nothing about liveness.
 */
function rowsToOffer(
  lanes: readonly AgentLane[] | undefined,
  computed: Lane | undefined,
): readonly LaneRow[] | undefined {
  if (lanes === undefined) return undefined;
  const rows = laneRows(lanes, new Date());
  if (computed === undefined || rows.some((row) => row.lane === computed)) return rows;
  // The orchestrator's row is unconditional on the wire, so a missing default
  // is always a designated lane — it sorts after the orchestrator, as the
  // server sorts them.
  return computed === ORCHESTRATOR_LANE
    ? [unknownLaneRow(computed), ...rows]
    : [...rows, unknownLaneRow(computed)];
}
