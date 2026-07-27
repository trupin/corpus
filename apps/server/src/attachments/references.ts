// The markdown an attachment leaves in the committed turn body (SPEC.md §6).
//
// The bytes are gitignored; *this* is what git keeps, and it is what the UI
// resolves against the server's `/attachments/` route. Two decisions are pinned
// here because both are cross-component contracts:
//
// **Image-ness comes from the extension**, never from the client's declared
// MIME type — see `mime.ts`.
//
// **Every path segment is percent-encoded** (sprint-007 Open Conflict 12). The
// turn ts contains colons and a filename may contain non-ASCII letters; a raw
// markdown target containing a space, `#`, `?` or `(` breaks the link, is
// truncated at a fragment, or terminates early. `encodeURIComponent` leaves
// letters, digits, `.`, `-`, `_` and `~` alone — and the sanitizer only ever
// produces letters, digits, `.`, `-` and `_` — so for an ASCII name the encoded
// target and the stored name are byte-identical, and only the ts's colons and
// any non-ASCII letters actually encode. The **display text** stays the
// human-readable stored name.

import { isImageName } from "./mime.js";

/** Prefix of every reference target, relative to the workspace's server origin. */
export const ATTACHMENT_URL_PREFIX = "attachments";

/**
 * The link target for one stored file: `attachments/<thread>/<ts>/<name>`, each
 * segment percent-encoded exactly once. The serving route decodes each segment
 * exactly once, which is what makes the round trip total.
 */
export function attachmentTarget(threadId: string, turnTs: string, name: string): string {
  return [ATTACHMENT_URL_PREFIX, threadId, turnTs, name]
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
    .join("/");
}

/** `![name](target)` for an image, `[name](target)` for everything else. */
export function attachmentReference(threadId: string, turnTs: string, name: string): string {
  const target = attachmentTarget(threadId, turnTs, name);
  return `${isImageName(name) ? "!" : ""}[${name}](${target})`;
}

/**
 * The turn body: the author's text, then a blank line, then one reference per
 * line in upload order.
 *
 * An attachment-only turn is the references alone — no leading blank line and
 * no empty paragraph, because a turn that opens with whitespace renders as one
 * and there is no text for it to be separated from.
 */
export function withAttachmentReferences(
  text: string | undefined,
  references: readonly string[],
): string {
  const body = text?.trim() ?? "";
  if (references.length === 0) return body;
  const block = references.join("\n");
  return body === "" ? block : `${body}\n\n${block}`;
}

/** Reference lines for a turn's stored files, in upload order. */
export function attachmentReferences(
  threadId: string,
  turnTs: string,
  names: readonly string[],
): string[] {
  return names.map((name) => attachmentReference(threadId, turnTs, name));
}
