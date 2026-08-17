import type { UnknownRecipientError } from "@corpus/contract";

/**
 * The server's refusal bodies, transcribed **once** for every double in this
 * application (UI-120).
 *
 * `apps/ui` may not import `apps/server` — sibling applications, not a
 * dependency edge (CLAUDE.md → Repository Structure) — and the message is built
 * by the server rather than published by the contract, so a fixture that wants
 * to answer what the server answers has to carry a copy. This module is that
 * copy, and it is the only one: `scripts/stub-server-parity.test.ts` runs it
 * against `apps/server/src/errors.ts`'s own factory and fails on any difference,
 * which is what makes it a transcription rather than an invention.
 *
 * **Why one copy rather than three correct ones.** Before this module the same
 * `422` was written out in three places — `readerFixture`, `composeFixture` and
 * the e2e `stubCorpus` — and two had drifted: one had lost the recovery
 * sentence, the other was a wholly different sentence. Nothing caught it,
 * because every assertion in the repo matches the substring `names no lane`,
 * which all three still contained. A double that words a refusal differently
 * from the server is a double that can certify a message a person will never
 * see, and the copies are the defect whatever their contents happen to be
 * today.
 */

/**
 * `422 unknown_recipient` — a `recipient` naming no lane (SPEC.md §7), the body
 * of `apps/server/src/errors.ts`'s `unknownRecipient`.
 *
 * Deliberately the whole body and not just the message: `code` and `recipient`
 * are what a composer branches on to drop the stale row, so a double that got
 * the prose right and the shape wrong would be the same failure one field over.
 */
export function unknownRecipientBody(recipient: string): UnknownRecipientError {
  return {
    code: "unknown_recipient",
    message:
      `\`${recipient}\` names no lane: either this workspace holds no such thread, or that thread ` +
      "holds no resident and is therefore not a lane at all (SPEC.md §7). Nothing was written — " +
      "post without a recipient to reach whoever owns the conversation you are posting in, or " +
      "pick a live agent from the roster.",
    recipient,
  };
}
