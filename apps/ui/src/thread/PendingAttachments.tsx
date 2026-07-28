import type { ReactElement } from "react";
import type { PendingAttachment } from "./useAttachmentIntake";

/** `design/index.html`'s `.pending-atts` — removable chips with 34px thumbnails. */
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
