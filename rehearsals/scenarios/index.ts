/**
 * The scenario registry (INFRA-033, filled by INFRA-034). Each scenario is one
 * declarative file next to this one, registered here in story order.
 */

import type { Scenario } from "../scenario.js";
import { statedWeight } from "./01-stated-weight.js";
import { weightlessDesignation } from "./02-weightless-designation.js";
import { oneQuestionOneAnswer } from "./03-one-question-one-answer.js";
import { twoLanesNoCrossing } from "./04-two-lanes-no-crossing.js";
import { restartRecovery } from "./05-restart-recovery.js";
import { midTurnNoSecondListener } from "./06-mid-turn-no-second-listener.js";
import { hostileTranscript } from "./07-hostile-transcript.js";
import { unmeetableWeight } from "./08-unmeetable-weight.js";
import { retieredTable } from "./09-retiered-table.js";

export const SCENARIOS: readonly Scenario[] = [
  statedWeight,
  weightlessDesignation,
  oneQuestionOneAnswer,
  twoLanesNoCrossing,
  restartRecovery,
  midTurnNoSecondListener,
  hostileTranscript,
  unmeetableWeight,
  retieredTable,
];
