import { ORCHESTRATOR_LANE, type AgentLane, type Lane } from "@corpus/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { unknownRecipientLane } from "../client/createCorpusClient.js";
import { AGENTS_KEY } from "../query/keys.js";
import { useAgentsRoster } from "../query/useAgentsRoster.js";
import { laneRows, unknownLaneRow, type LaneRow } from "./laneRows.js";
import { laneOf } from "./scopeWalk.js";
import { useScopeWalk } from "./useScopeWalk.js";

/**
 * One composer's recipient — SPEC.md §7's *"Every message has a recipient, and
 * where you post computes it"*, and the three prohibitions on overriding it.
 *
 * ## A default nobody touched travels by being absent; a pick travels as itself
 *
 * {@link ComposerRecipient.request} is `{}` while nothing has been picked, and
 * `{recipient: <lane>}` for **every** pick — including one that names the lane
 * this build's own walk had already computed. Two rules, and they are not in
 * tension once the question each answers is named.
 *
 * *Did anybody choose?* decides what goes on the wire. For the untouched
 * default the answer is no, and UI-108's property is exactly why absence is
 * right there: there is no value for this build's walk and the server's to
 * disagree about, so a walk that is slow, bounded, or wrong costs a label and
 * never a route.
 *
 * *Does the pick route somewhere else?* is {@link ComposerRecipient.overridden},
 * and it is a **display** question — it decides whether a surface says "this
 * message" rather than "here". It is not the wire question, and conflating the
 * two is UI-118: `chosen === computed` was read as "nobody chose", so a person
 * who released the resident on `th_X` in one tab and then, in another tab whose
 * roster had not refetched, opened the picker and pressed `th_X` — the lane they
 * meant to address — sent no `recipient` at all. The server's walk, unbounded
 * and over the live projection, climbed past the now-undesignated `th_X` and
 * handed the message to the orchestrator. **They addressed one agent and another
 * answered**, with nothing on any surface to say so.
 *
 * The server has held the guard for that since SERVER-111
 * (`queue/scope.ts`'s `assertRecipientResolvable` — *"a pick can go stale
 * between the roster read and the post, and quietly routing it elsewhere would
 * answer the person from an agent they did not address"*), and it could never
 * run, because the value never left this file. Sending the act rather than the
 * difference is what arms it.
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
 * is called when the send **lands**; a send the server refused is handled by
 * {@link ComposerRecipient.refuse} instead, because a message that was never
 * written is not a message this pick has outlived.
 *
 * The first two prohibitions were once enforced by omission of capability — the
 * kit's client had no way to designate or release — and since UI-109 they are
 * enforced by **evidence** instead, because §10 puts designate/release in the
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
  /**
   * The explicit pick, or `undefined`. **This is what reaches the wire**, and it
   * may equal {@link computed} — a person pressing the lane the default already
   * names has still chosen it, and the server is the one that gets to say
   * whether that lane is still a lane.
   */
  readonly chosen: Lane | undefined;
  /** Who will actually answer: the pick, else the computed default, else unknown. */
  readonly effective: Lane | undefined;
  /**
   * Whether the message routes somewhere other than where posting here would
   * send it. **Display only** — it is the difference, not the act, so it is
   * false for a pick that names the computed default. What goes on the wire is
   * {@link chosen}.
   */
  readonly overridden: boolean;
  /** Picks a lane; `undefined` drops the pick and returns to the computed default. */
  readonly choose: (lane: Lane | undefined) => void;
  /** `{}` while nothing is picked, `{recipient}` for a pick. Spread onto the request. */
  readonly request: { readonly recipient?: Lane };
  /**
   * The lane the server refused for this message, or `undefined`.
   *
   * Set by {@link refuse} and cleared by any later {@link choose} or
   * {@link clear}. A surface renders it as the refusal it is; nothing derives
   * routing from it.
   */
  readonly refused: Lane | undefined;
  /** Drops the pick. Called when the message it was set on **lands**. */
  readonly clear: () => void;
  /**
   * Settles a send the server **refused**, given the error it refused with.
   *
   * A `422 unknown_recipient` naming this message's own pick is not an ordinary
   * failure: it is the server telling this composer that its roster is behind.
   * So the pick is **kept** — nothing was written, the composers put the text
   * and the attachments back, and dropping the recipient alone would send the
   * retry to a computed default this build works out from the same stale roster,
   * which is the silent misroute the refusal exists to prevent. The roster is
   * refetched, so the surface corrects itself rather than waiting for an
   * `["agents"]` frame that this refusal is proof did not arrive.
   *
   * Every other failure clears the pick exactly as {@link clear} does.
   */
  readonly refuse: (error: unknown) => void;
}

/**
 * The pick a **refused** send left behind, for a composer that does not outlive
 * its own send.
 *
 * Three of the four composers stay mounted through a refusal and settle their
 * own pick with {@link ComposerRecipient.refuse}. The comment popover does not —
 * it unmounts on submit and its host re-opens it holding what it held (UI-111's
 * `CommentRestore`) — so its pick has to come back the way its words and its
 * attachments do. This is **not** a place for an override to persist to (§7's
 * third prohibition): it only ever describes a message that was refused and
 * therefore never happened, and it is the host's own refusal handling that
 * builds it.
 */
export interface ComposerRecipientRestore {
  /** The lane the refused message was addressed to. */
  readonly chosen: Lane;
  /** Whether the server refused **that lane by name** (`422 unknown_recipient`). */
  readonly refused: boolean;
}

export interface ComposerRecipientInput {
  /**
   * The conversation a message from this composer lands in — the thread being
   * replied to, the thread a child comment hangs off, or the document a
   * selection comment is on. `null` for the global composer's Ask.
   */
  readonly start: string | null;
  /** What a refused send left behind, on a composer its host re-opens. */
  readonly restore?: ComposerRecipientRestore | undefined;
}

export function useComposerRecipient({
  start,
  restore,
}: ComposerRecipientInput): ComposerRecipient {
  const roster = useAgentsRoster();
  const queryClient = useQueryClient();
  const walk = useScopeWalk({ start, lanes: roster.lanes });
  const [chosen, setChosen] = useState<Lane | undefined>(restore?.chosen);
  const [refused, setRefused] = useState<Lane | undefined>(
    restore?.refused === true ? restore.chosen : undefined,
  );

  /*
   * A composer re-opened onto a refusal refetches the roster for the reason
   * `refuse` does, and it has to do it here because the composer that took the
   * refusal is gone: the refusal is the evidence this build's roster is behind
   * the server's, and `useAgentsRoster` has no poll to correct it (§7 — "who is
   * running is a read, never a push").
   */
  const restoredRefusal = restore?.refused === true ? restore.chosen : undefined;
  useEffect(() => {
    if (restoredRefusal === undefined) return;
    void queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
  }, [queryClient, restoredRefusal]);

  const computed = laneOf(walk);
  const effective = chosen ?? computed;

  const clear = useCallback(() => {
    setChosen(undefined);
    setRefused(undefined);
  }, []);

  const choose = useCallback((lane: Lane | undefined) => {
    setChosen(lane);
    // Whatever the server refused, it refused the previous pick. Carrying the
    // mark onto a different one would be this surface inventing a verdict.
    setRefused(undefined);
  }, []);

  const refuse = useCallback(
    (error: unknown) => {
      // Only a refusal of **this** message's own pick: a `422` naming some other
      // lane, or any other failure, is an ordinary one and the pick goes.
      if (chosen === undefined || unknownRecipientLane(error) !== chosen) {
        clear();
        return;
      }
      setRefused(chosen);
      // The refusal *is* the evidence the roster is stale: `useAgentsRoster` has
      // no poll and no `staleTime: 0` on purpose (§7 — "who is running is a
      // read, never a push"), so without this the picker would keep offering a
      // lane the server has already said is not one.
      void queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
    },
    [chosen, clear, queryClient],
  );

  const rows = rowsToOffer(roster.lanes, computed, chosen);
  const overridden = chosen !== undefined && chosen !== computed;

  return {
    rows,
    computed,
    chosen,
    effective,
    overridden,
    choose,
    // The act, not the difference (see the header): a pick equal to the computed
    // lane is still a pick, and the server is the only party that can say
    // whether the lane it names is still designated.
    request: chosen === undefined ? {} : { recipient: chosen },
    refused,
    clear,
    refuse,
  };
}

/**
 * The rows to offer, with the computed default **and the current pick** both
 * guaranteed to be among them.
 *
 * A default the roster does not list is the window between a designation
 * landing and `["agents"]` refetching. It is shown as *unknown* rather than
 * dropped: a list that does not contain the answer is worse than a row that
 * says nothing about liveness.
 *
 * A **pick** the roster does not list is the same window read from the other
 * end, and it is the state a refusal leaves behind (`ComposerRecipient.refuse`
 * refetches the roster, which is what drops the released lane out of it). The
 * row has to survive that refetch, because the pick does: a message addressed to
 * a lane no row names would show the picker asserting the computed default while
 * the wire carried something else.
 */
function rowsToOffer(
  lanes: readonly AgentLane[] | undefined,
  computed: Lane | undefined,
  chosen: Lane | undefined,
): readonly LaneRow[] | undefined {
  if (lanes === undefined) return undefined;
  const known = laneRows(lanes, new Date());
  const wanted = new Set<Lane>(
    [computed, chosen].filter((lane): lane is Lane => lane !== undefined),
  );
  const missing = [...wanted].filter((lane) => !known.some((row) => row.lane === lane));
  // The orchestrator leads the roster wherever it appears (`laneRows`); every
  // other unknown lane is appended, so a designated one never displaces a live
  // row a person is reading.
  return [
    ...missing.filter((lane) => lane === ORCHESTRATOR_LANE).map(unknownLaneRow),
    ...known,
    ...missing.filter((lane) => lane !== ORCHESTRATOR_LANE).map(unknownLaneRow),
  ];
}
