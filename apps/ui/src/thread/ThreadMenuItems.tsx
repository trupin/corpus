import {
  MENTION_DOC_TYPE,
  useAgentsRoster,
  useDocs,
  useLaneRow,
  useWeightLevels,
} from "@corpus/kit";
import { useState, type ReactElement } from "react";
import { MenuItems } from "../menu/MenuItems";
import type { MenuAction } from "../menu/menuModel";
import { agentDefRows, residentActions } from "./residentActions";

/**
 * A conversation's menu, with the items that need a read of their own.
 *
 * ## Why the fetching lives here and not in `ThreadPanel`
 *
 * Because a menu that is not open should cost nothing. `ThreadPanel` mounts once
 * per conversation — thirty on a document with thirty anchored comments — and
 * the resident items need the roster and the workspace's agent-def directory.
 * Read at panel level, that directory would refetch on every `["docs"]`
 * invalidation, which is every write anybody makes, for a list nothing is
 * showing. The context menu takes its body as a render prop, so mounting the
 * reads *inside* it defers them to the click that opens it — after which they
 * are ordinary shared cache entries like any other.
 *
 * The **mutation** stays on the panel, deliberately: this component unmounts the
 * instant the menu closes, which is the same click that designates, and an
 * observer that goes away with its own request is exactly the dropped-report bug
 * `SettledCallbacks` was written for (UI-012, UI-015).
 *
 * ## The chosen level lives here, and dies with the menu
 *
 * A designation's weight (SPEC.md §7's rider signed 2026-08-19, UI-168) is a
 * property of the act about to be performed, not a standing preference — so it
 * is `useState` in a component the menu mounts and unmounts, and every opening
 * starts from what is true of the conversation rather than from what was
 * pressed last time. It is deliberately **not** `weightChoice.ts`, which
 * remembers a **message's** weight per conversation: that is a different
 * question about a different request, and one map serving both would have a
 * reply's level silently pre-arming a designation.
 */

/** How many agent-defs the menu offers, matching the mention autocomplete's own bound. */
export const AGENT_DIRECTORY_LIMIT = 50;

export interface ThreadMenuItemsProps {
  readonly threadId: string;
  /** True for a thread on a document — §7 forbids it a resident. */
  readonly hasParent: boolean;
  /** The conversation's own actions, which come first. */
  readonly actions: readonly MenuAction[];
  readonly pending: boolean;
  /** Designate with no profile — §7's ordinary case, which needs no directory. */
  readonly onDesignateGeneral: (weight: string | undefined) => void;
  readonly onDesignate: (name: string, weight: string | undefined) => void;
  readonly onRelease: () => void;
  readonly onDone: () => void;
}

export function ThreadMenuItems({
  threadId,
  hasParent,
  actions,
  pending,
  onDesignateGeneral,
  onDesignate,
  onRelease,
  onDone,
}: ThreadMenuItemsProps): ReactElement {
  const roster = useAgentsRoster();
  const resident = useLaneRow(threadId);
  /*
   * The `@` autocomplete's own directory read (`useAutocomplete.ts`), under the
   * same filter and therefore the same cache key: designating offers exactly the
   * names a mention would resolve, because §7 says it is the same resolution.
   */
  const agents = useDocs({ type: MENTION_DOC_TYPE, limit: AGENT_DIRECTORY_LIMIT });
  /*
   * The workspace's own tier table, through the same projection read every
   * composer's weight control uses — one declaration, so the designation cannot
   * offer a level a message could not, and neither can name a model.
   */
  const levels = useWeightLevels();
  /**
   * What this opening has stated, or `null` for *not touched yet*.
   *
   * The wrapper is what makes `undefined` — "the launcher decides" — a value a
   * person can actually choose, which a bare `string | undefined` cannot express
   * beside an untouched state that means something else.
   */
  const [stated, setStated] = useState<{ readonly key: string | undefined } | null>(null);
  /*
   * Untouched shows **what the resident runs at now**, and only a designation
   * with nobody to read from starts at nothing.
   *
   * Not a preselection: it is the current state of the thing the menu is acting
   * on, which is the same reason the release item names the resident and the
   * badge shows it. It is also what keeps the acts' no-op skips behaving as they
   * did before this feature — an untouched menu on a resident designated
   * `heavy` would otherwise offer to re-designate the same profile, because
   * coming back to the launcher's choice really would clear the level.
   *
   * Derived rather than seeded into `useState`, because a state initialiser runs
   * once and the roster may answer after the menu has already painted.
   */
  const weight = stated === null ? (resident?.weight ?? undefined) : stated.key;

  const items = [
    ...actions,
    ...residentActions({
      hasParent,
      resident,
      rosterAnswered: roster.lanes !== undefined,
      agents: agentDefRows(agents.data?.items),
      pending,
      levels,
      weight,
      onChooseWeight: (key) => {
        setStated({ key });
      },
      onDesignateGeneral,
      onDesignate,
      onRelease,
    }),
  ];

  return <MenuItems actions={items} onDone={onDone} />;
}
