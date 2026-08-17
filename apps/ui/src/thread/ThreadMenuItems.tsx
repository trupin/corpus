import { MENTION_DOC_TYPE, useAgentsRoster, useDocs, useLaneRow } from "@corpus/kit";
import type { ReactElement } from "react";
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
  readonly onDesignate: (name: string) => void;
  readonly onRelease: () => void;
  readonly onDone: () => void;
}

export function ThreadMenuItems({
  threadId,
  hasParent,
  actions,
  pending,
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

  const items = [
    ...actions,
    ...residentActions({
      hasParent,
      resident,
      rosterAnswered: roster.lanes !== undefined,
      agents: agentDefRows(agents.data?.items),
      pending,
      onDesignate,
      onRelease,
    }),
  ];

  return <MenuItems actions={items} onDone={onDone} />;
}
