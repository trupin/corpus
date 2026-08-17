import type { ReactElement } from "react";
import type { PendingAttachment } from "./useAttachmentIntake.js";

/**
 * `design/index.html`'s `.pending-atts` — removable chips with 34px thumbnails,
 * the preview SPEC.md §6 requires before a file is sent.
 *
 * Published from the kit with {@link useAttachmentIntake} and `AttachButton`
 * (UI-070): a plugin composer that could take a file but drew its own chips
 * would be a second implementation of the one thing §6 describes as a look.
 * Import the anatomy with it:
 *
 *     import "@corpus/kit/composer.css";
 */
export interface PendingAttachmentsProps {
  readonly pending: readonly PendingAttachment[];
  readonly onRemove: (id: string) => void;
}

export function PendingAttachments({ pending, onRemove }: PendingAttachmentsProps): ReactElement {
  return (
    <div className="pending-atts" data-pending-atts>
      {pending.map((attachment) => (
        <span className="att-chip" key={attachment.id}>
          {attachment.previewUrl === null ? (
            <span aria-hidden="true">📄</span>
          ) : (
            <img src={attachment.previewUrl} alt={attachment.name} />
          )}
          {attachment.name}
          <button
            type="button"
            title="Remove"
            aria-label={`Remove ${attachment.name}`}
            onClick={() => {
              onRemove(attachment.id);
            }}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}
