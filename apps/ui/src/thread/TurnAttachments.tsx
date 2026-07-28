import { useAttachment } from "@corpus/kit";
import type { ReactElement } from "react";
import type { TurnAttachment } from "./attachmentRefs";

/**
 * A posted turn's attachments (SPEC.md §6, `design/index.html`): images inline
 * as `.turn-att-img`, everything else as an `.att-file` download chip.
 *
 * Bytes come through `GET /attachments/…` with the workspace bearer token, which
 * is why this is a fetch and an object URL rather than a bare `src` — see
 * `useAttachment`. A failed fetch degrades to the file chip: the reference is
 * still a fact about the turn even when the bytes are unreachable.
 */

export interface TurnAttachmentsProps {
  readonly attachments: readonly TurnAttachment[];
}

function AttachmentImage({ attachment }: { readonly attachment: TurnAttachment }): ReactElement {
  const bytes = useAttachment(attachment.target);
  if (bytes.url === null) {
    return (
      <span className="att-file" data-att-target={attachment.target}>
        {bytes.error === null ? "🖼" : "⚠"} {attachment.name}
      </span>
    );
  }
  return (
    <img
      className="turn-att-img"
      src={bytes.url}
      alt={attachment.name}
      data-att-target={attachment.target}
    />
  );
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
          <AttachmentImage key={attachment.target} attachment={attachment} />
        ) : (
          <AttachmentFile key={attachment.target} attachment={attachment} />
        ),
      )}
    </div>
  );
}
