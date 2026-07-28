/**
 * Splits a posted turn's body into its prose and its attachment references
 * (SPEC.md §6).
 *
 * This is the exact inverse of the server's `withAttachmentReferences`
 * (`apps/server/src/attachments/references.ts`), which appends one reference per
 * line after the author's text: `![name](attachments/<thread>/<ts>/<name>)` for
 * an image, `[name](…)` for everything else, and the references alone when the
 * turn is attachment-only.
 *
 * **Only a trailing run counts.** A reference written *inside* the prose is left
 * where the author put it and renders as ordinary markdown — the prototype's
 * inline image and download chip are what the *upload path* produces, and
 * hoisting an author's mid-sentence link out of their sentence would be the UI
 * rewriting a document it does not own.
 */

export interface TurnAttachment {
  /** The link text the server wrote, which is the stored filename. */
  readonly name: string;
  /** Relative target: `attachments/<threadId>/<turnTs>/<name>`. */
  readonly target: string;
  /** Written as `![…]`, i.e. rendered inline rather than as a download chip. */
  readonly isImage: boolean;
}

export interface TurnContent {
  /** The turn's markdown with the trailing reference block removed. */
  readonly prose: string;
  readonly attachments: readonly TurnAttachment[];
}

/** One whole line that is nothing but a reference into `attachments/`. */
const REFERENCE_LINE = /^(!?)\[([^\]]*)\]\((attachments\/[^)\s]+)\)$/;

export function splitTurnAttachments(body: string): TurnContent {
  const lines = body.split("\n");
  const attachments: TurnAttachment[] = [];

  while (lines.length > 0) {
    const line = (lines[lines.length - 1] ?? "").trim();
    if (line === "") {
      lines.pop();
      continue;
    }
    const match = REFERENCE_LINE.exec(line);
    if (match === null) break;
    lines.pop();
    attachments.unshift({
      isImage: match[1] === "!",
      name: match[2] ?? "",
      target: match[3] ?? "",
    });
  }

  return { prose: lines.join("\n").trimEnd(), attachments };
}
