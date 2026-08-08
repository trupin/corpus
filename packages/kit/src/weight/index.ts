/**
 * SPEC.md §11's "Every composer can choose how much thought the work gets"
 * (rider SHARED-022, signed 2026-08-06), as one unit.
 *
 * Four parts, and the split is the design:
 *
 *   - `weightLevels.ts` — the parser. The **only** reading of the declaration,
 *     and it holds no vocabulary of its own.
 *   - `useWeightLevels.ts` — where the declaration is read from: the orchestrate
 *     skill, as a projected document, through the ordinary document queries.
 *   - `weightChoice.ts` — the standing choice, browser-local, per conversation,
 *     and the single spelling of "nothing chosen".
 *   - `WeightPicker.tsx` + `composerReach.ts` — the control, and the one
 *     derivation of whether a composer says it will reach the agent.
 */

export { composerReachesAgent, type ComposerReach } from "./composerReach.js";
export {
  findOrchestrateSkill,
  ORCHESTRATE_SKILL_NAME,
  useWeightLevels,
} from "./useWeightLevels.js";
export {
  chooseWeight,
  docWeightScope,
  GLOBAL_COMPOSE_WEIGHT_SCOPE,
  resetWeightChoices,
  subscribeWeightChoices,
  threadWeightScope,
  useComposerWeight,
  weightChoice,
  type ComposerWeight,
} from "./weightChoice.js";
export { parseWeightLevels, WEIGHT_TABLE_HEADER, type WeightLevel } from "./weightLevels.js";
export {
  WeightPicker,
  WEIGHT_INERT_TITLE,
  WEIGHT_LIVE_TITLE,
  WEIGHT_PICKER_LABEL,
  WEIGHT_UNKNOWN_TITLE,
  type WeightPickerProps,
} from "./WeightPicker.js";
