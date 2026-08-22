import { useRef, type ReactElement } from "react";

/**
 * The 📎 of SPEC.md §6's three routes — the one that needs markup rather than
 * an event handler: a button that opens the file picker, and the hidden
 * `<input type="file">` it opens.
 *
 * One component rather than one copy per composer, because every copy has to
 * remember the same two non-obvious things: the input is `multiple` (a person
 * dropping three screenshots may also pick three), and its `value` is cleared
 * after every change, or **re-picking the same file fires no `change` event**
 * and the attachment silently does not arrive.
 *
 * Published from the kit alongside {@link useAttachmentIntake} and
 * `PendingAttachments` (UI-070). The picker is the route a composer cannot
 * supply for itself without re-deriving both of those details, and §10's rider
 * binds every composer to all three routes, not two.
 */

export interface AttachButtonProps {
  /**
   * The composer this belongs to — `data-attach-input`, which is how a test or
   * an e2e reaches *this* composer's picker on a board showing several.
   */
  readonly surface: string;
  readonly onFiles: (files: FileList | null) => void;
}

export function AttachButton({ surface, onFiles }: AttachButtonProps): ReactElement {
  const picker = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        className="clip"
        title="Attach files from disk"
        aria-label="Attach files"
        onClick={() => {
          picker.current?.click();
        }}
      >
        📎
      </button>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        data-attach-input={surface}
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
}
