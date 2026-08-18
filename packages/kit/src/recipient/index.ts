/**
 * SPEC.md §7's *"Every message has a recipient, and where you post computes
 * it"*, as one unit.
 *
 * Seven parts, and the split is the design:
 *
 *   - `scopeWalk.ts` — the pure walk. The **only** client-side reading of §7's
 *     scope rule, and it decides nothing that reaches the wire.
 *   - `useScopeWalk.ts` — where the walk's nodes come from: the same cached
 *     document and thread reads the board already holds.
 *   - `laneRows.ts` — how a roster row reads: the name, the liveness and the one
 *     line. Pure, because the honesty is in the wording.
 *   - `useComposerRecipient.ts` — the default, the one-message override, and the
 *     `{}`-or-`{recipient}` a composer spreads onto its request.
 *   - `RecipientPicker.tsx` — the control.
 *   - `useResidentLane.ts` — the same two readings for a surface that is not a
 *     composer: is *this* conversation a lane, and which lane answers *here*
 *     (UI-109's badge, pending row and provenance line).
 *   - `LaneDot.tsx` — the liveness dot, shared by the picker and the board so
 *     one lane is not drawn two ways.
 *
 * It ships from the kit rather than from `apps/ui` for the reason `WeightPicker`
 * does: five first-party composers mount it, a composer a plugin contributes
 * must be able to offer the same roster with one import — and, since UI-109, the
 * board reads the roster through the same vocabulary rather than a parallel one.
 */

export { LaneDot, type LaneDotProps } from "./LaneDot.js";
export {
  laneLine,
  laneLiveness,
  laneMark,
  laneName,
  laneNote,
  laneResidentKind,
  laneRow,
  laneRows,
  unknownLaneRow,
  GENERAL_RESIDENT_LABEL,
  LAPSED_FALLBACK,
  LAPSED_ORCHESTRATOR,
  LIVE_WITHOUT_SUMMARY,
  MISSING_PROFILE_CAUSES,
  MISSING_PROFILE_MARK,
  MISSING_PROFILE_NOTE,
  NEVER_SEEN_LINE,
  ORCHESTRATOR_LABEL,
  UNNAMED_RESIDENT_LABEL,
  type LaneLiveness,
  type LaneResidentKind,
  type MissingProfileCause,
  type LaneRow,
} from "./laneRows.js";
export {
  DEFAULT_ROW_NOTE,
  RECIPIENT_GROUP_LABEL,
  RECIPIENT_INERT_TITLE,
  RECIPIENT_LIVE_TITLE,
  RECIPIENT_PICKER_LABEL,
  RECIPIENT_REFUSED_STATEMENT,
  RECIPIENT_UNKNOWN_STATEMENT,
  RecipientPicker,
  statementFor,
  type RecipientPickerProps,
} from "./RecipientPicker.js";
export {
  laneOf,
  walkToLane,
  SCOPE_NODE_ABSENT,
  type LanePredicate,
  type ScopeNode,
  type ScopeNodeLookup,
  type ScopeWalk,
  type ScopeWalkLane,
  type ScopeWalkOrchestrator,
  type ScopeWalkUnread,
} from "./scopeWalk.js";
export {
  useComposerRecipient,
  type ComposerRecipient,
  type ComposerRecipientInput,
  type ComposerRecipientRestore,
} from "./useComposerRecipient.js";
export { useLaneRow, useResidentLane, type ResidentLane } from "./useResidentLane.js";
export {
  designatedLanes,
  isThreadId,
  useScopeWalk,
  MAX_SCOPE_WALK,
  type ScopeWalkInput,
} from "./useScopeWalk.js";
