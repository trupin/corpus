import type { DocRow } from "@corpus/contract";
import type { LaneRow } from "@corpus/kit";
import type { MenuAction } from "../menu/menuModel";

/**
 * Designating and releasing a resident, as menu actions — SPEC.md §7's
 * *"Designation is user-only state on the thread, set and released like any
 * other thread field"*, offered where a person acts on the conversation.
 *
 * ## Why a declared list rather than a control
 *
 * §11 binds the conversation's right-click menu to *"exactly that item's
 * existing actions"*, and `menuModel.ts` exists so the ⋯ sheet and the context
 * menu cannot come to offer different ones. A designation is an action on this
 * thread, so it belongs in that list; a dialog beside it would be a second
 * surface with its own drift.
 *
 * ## The names come from the mention directory, because they are the same names
 *
 * §7 designates by the **invocable name** — the one `@<subagent>` would have
 * written — resolved against the workspace's `type: agent-def` documents (§8).
 * So the offer is that directory, read through the very query the `@`
 * autocomplete reads (`MENTION_DOC_TYPE`), and a person picks the word they
 * already type rather than learning a second vocabulary. A directory that has
 * not answered offers nothing rather than an empty list that looks like a
 * workspace with no agents.
 *
 * ## Only where a designation is legal, and only for a person
 *
 * A thread with a **parent** may not have a resident at all — §7: *"a thread on
 * a document is about that document, and a resident owns a conversation rather
 * than a passage"* — so a card on a document offers nothing here rather than an
 * item that would earn a `409`. Nothing gates on the actor: designation is
 * user-only and this surface has no other kind of user.
 */

/** The one field of an agent-def row this needs: what it is invocable as. */
export interface AgentDefRow {
  readonly id: string;
  readonly name: string;
}

/**
 * The invocable name of an `agent-def` document row.
 *
 * The title, because that is what `GET /api/docs` carries and what the
 * autocomplete offers; the server resolves a name against both the file stem and
 * the title, case-insensitively, so the title always resolves. A row whose title
 * is blank is dropped rather than offered — an item labelled with nothing is not
 * an offer, and designating by an empty name is a `400`.
 */
export function agentDefRows(rows: readonly DocRow[] | undefined): readonly AgentDefRow[] {
  if (rows === undefined) return [];
  return rows
    .map((row) => ({ id: row.id, name: row.title.trim() }))
    .filter((row) => row.name !== "");
}

/** What a designation item's second line says. */
export const DESIGNATE_META = "owns this conversation and everything that grows out of it";

/** …and a release's, which states the consequence rather than the act. */
export const RELEASE_META = "back to ordinary routing — nothing already queued moves";

/** Said in place of the offer when the workspace defines no agents to designate. */
export const NO_AGENT_DEFS = "no agent-def documents in this workspace";

export interface ResidentActionsInput {
  /** True for a thread on a document, which §7 forbids a resident. */
  readonly hasParent: boolean;
  /**
   * This conversation's roster row, or `undefined` when the roster has not
   * answered *or* has answered and this thread is not a lane. The two are told
   * apart by `rosterAnswered`, because offering "Release" on a thread whose
   * roster row simply has not arrived would be an action against a state nobody
   * reported.
   */
  readonly resident: LaneRow | undefined;
  /** Whether `GET /api/agents` has answered at all (UI-098's rule). */
  readonly rosterAnswered: boolean;
  /** The workspace's agent-defs, from the mention directory. */
  readonly agents: readonly AgentDefRow[];
  readonly pending: boolean;
  readonly onDesignate: (name: string) => void;
  readonly onRelease: () => void;
}

/**
 * The items to append to a conversation's menu — possibly none.
 *
 * Ordered as the decision is made: release first where there is something to
 * release, since it is one item and the alternative is a list; then the offers,
 * in the directory's own order.
 */
export function residentActions(input: ResidentActionsInput): readonly MenuAction[] {
  if (input.hasParent) return [];
  // Nothing is offered from a roster that has not spoken: with no answer we
  // cannot tell "designate" from "replace", and either label would be a claim.
  if (!input.rosterAnswered) return [];

  const items: MenuAction[] = [];
  if (input.resident !== undefined) {
    items.push({
      id: "resident-release",
      label: `Release ${input.resident.name}`,
      meta: RELEASE_META,
      disabled: input.pending,
      run: () => {
        input.onRelease();
      },
    });
  }
  if (input.agents.length === 0) {
    items.push({
      id: "resident-none",
      label: "Designate a resident",
      meta: NO_AGENT_DEFS,
      disabled: true,
      run: () => {
        /* Nothing to designate; the item exists to say so rather than to act. */
      },
    });
    return items;
  }
  for (const agent of input.agents) {
    // A lane already resident on this thread is not offered again: §7 makes
    // designation single-valued, so designating the same agent twice is a write
    // that changes nothing, and an item that does nothing is not an action.
    if (agent.name === input.resident?.name) continue;
    items.push({
      id: `resident-designate-${agent.id}`,
      label:
        input.resident === undefined ? `Designate ${agent.name}` : `Replace with ${agent.name}`,
      meta: DESIGNATE_META,
      disabled: input.pending,
      run: () => {
        input.onDesignate(agent.name);
      },
    });
  }
  return items;
}
