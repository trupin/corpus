import { CorpusImage, useAttachment } from "@corpus/kit";
import type { ReactElement } from "react";
import type { TurnAttachment } from "./attachmentRefs";

/**
 * A posted turn's attachments (SPEC.md §6, `design/index.html`): images inline
 * as `.turn-att-img`, everything else as an `.att-file` download chip.
 *
 * Bytes come through `GET /attachments/…` with the workspace bearer token, which
 * is why this is a fetch and an object URL rather than a bare `src` — see
 * `useAttachment`. A failed fetch degrades to a visible chip: the reference is
 * still a fact about the turn even when the bytes are unreachable.
 *
 * **The image is the kit's** (UI-049). It was this component's own until the
 * bug it hid became the issue: the same attachment referenced one line earlier
 * in the prose went through `MarkdownView` as a bare relative `src` and loaded
 * nothing. `CorpusImage` is the one renderer both paths now use, so the trailing
 * reference and the mid-prose one cannot render differently again — and it is
 * what makes the thumbnail below clickable through to the full-size viewer.
 * This file keeps only what is the *thread's*: the 240×180 preview cap.
 */

export interface TurnAttachmentsProps {
  readonly attachments: readonly TurnAttachment[];
}

function AttachmentFile({ attachment }: { readonly attachment: TurnAttachment }): ReactElement {
  const bytes = useAttachment(attachment.target);
  if (bytes.url === null) {
    return (
      <span className="att-file" data-att-target={attachment.target}>
        📄 {attachment.name}
      </span>
    );
  }
  return (
    <a
      className="att-file"
      href={bytes.url}
      download={attachment.name}
      data-att-target={attachment.target}
    >
      📄 {attachment.name}
    </a>
  );
}

export function TurnAttachments({ attachments }: TurnAttachmentsProps): ReactElement | null {
  if (attachments.length === 0) return null;
  return (
    <div className="turn-atts">
      {attachments.map((attachment) =>
        attachment.isImage ? (
          <CorpusImage
            key={attachment.target}
            src={attachment.target}
            alt={attachment.name}
            className="turn-att-img"
          />
        ) : (
          <AttachmentFile key={attachment.target} attachment={attachment} />
        ),
      )}
    </div>
  );
}
