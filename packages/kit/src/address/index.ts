/**
 * The composer's **address** (SPEC.md §10, UI-126) — who answers, at what
 * weight — as one unit.
 *
 * Three parts, and the split is the design:
 *
 *   - `addressModel.ts` — the derivation: the line's wording, which weight
 *     surface a recipient gets (levels, a resident's sentence, or nothing), and
 *     what rides the request. Pure, because the honesty is in the wording and
 *     in what is withheld from the wire, and neither should need a render to
 *     test.
 *   - `ComposerAddress.tsx` — the control: the line, and the popover holding
 *     the recipient rows and the weight levels it replaced two inline controls
 *     with.
 *   - `address.css` — the anatomy, as a subpath: `@corpus/kit/address.css`.
 *
 * It ships from the kit for the reason the controls it replaced did: §10's
 * enumeration binds every composer, and kit is how each of them gets the same
 * affordance with one import and no copy. The
 * derivations underneath — `useComposerRecipient`, `useComposerWeight`,
 * `composerReachesAgent` — are unchanged and still published beside it.
 */

export {
  answeringRow,
  composerAddress,
  designationWeightSentence,
  residentWeightSentence,
  weightLabel,
  ADDRESS_DESIGNATING_TITLE,
  ADDRESS_FLOOR_TITLE,
  ADDRESS_OPEN_TITLE,
  ADDRESSED_TO,
  LAUNCH_WEIGHT_CLAUSE,
  LINE_SEPARATOR,
  NOBODY_ASKED,
} from "./addressModel.js";
export type {
  AddressWeight,
  ComposerAddress as ComposerAddressModel,
  ComposerAddressInput,
  ResidentWeight,
} from "./addressModel.js";
export {
  ComposerAddress,
  lanesCappedNote,
  RECIPIENT_GROUP_LABEL,
  RECIPIENT_LEAD,
  WEIGHT_GROUP_LABEL,
  WEIGHT_LEAD,
  WEIGHT_UNKNOWN_TITLE,
  type ComposerAddressProps,
} from "./ComposerAddress.js";
