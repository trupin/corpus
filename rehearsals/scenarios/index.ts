/**
 * The scenario registry. INFRA-034 adds the other eight stories; each is one
 * declarative file next to this one, registered here in story order.
 */

import type { Scenario } from "../scenario.js";
import { oneQuestionOneAnswer } from "./03-one-question-one-answer.js";

export const SCENARIOS: readonly Scenario[] = [oneQuestionOneAnswer];
