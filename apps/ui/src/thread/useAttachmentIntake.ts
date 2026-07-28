import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";

/**
 * The three ways a file gets into a composer (SPEC.md §6): the 📎 picker, a
 * clipboard paste, and a drag onto the composer — normalised into **one**
 * pending list, because a turn does not care which one the person used.
 *
 * Shared rather than private: UI-010's global composer captures files the same
 * three ways, and a second implementation is how one of them silently loses the
 * paste-with-files branch.
 *
 * Two details are load-bearing and easy to get wrong:
 *
 * - **Paste reads `files` first.** A screenshot on the clipboard arrives as both
 *   a file *and* (in some browsers) a text/plain fallback; letting the default
 *   run would drop a filename or a `data:` blob into the input. So a paste
 *   carrying files is consumed here, and only a paste carrying none falls
 *   through to ordinary text insertion.
 * - **The drop highlight counts.** `dragleave` fires when the pointer crosses
 *   into a *child* of the dropzone, so a boolean flickers off every time the
 *   drag passes over the placeholder, the foot or a chip. A counter is the
 *   difference between a highlight that stays lit and one that strobes.
 */

export interface PendingAttachment {
  /** Client-side identity; the file itself is not a stable key. */
  readonly id: string;
  readonly file: File;
  readonly name: string;
  /** Object URL for an image thumbnail, or `null` for everything else. */
  readonly previewUrl: string | null;
}

export interface AttachmentIntake {
  readonly pending: readonly PendingAttachment[];
  /** True while a drag is over the composer — the `.composer.dropping` class. */
  readonly dropping: boolean;
  readonly add: (files: FileList | readonly File[] | null | undefined) => void;
  readonly remove: (id: string) => void;
  /**
   * Empties the list *without* revoking anything and hands the snapshot back —
   * what a send does, so the chips leave the composer the moment the turn is
   * optimistically appended while their previews stay usable if the send fails.
   */
  readonly take: () => readonly PendingAttachment[];
  /** Puts a taken snapshot back after a failed send. */
  readonly restore: (snapshot: readonly PendingAttachment[]) => void;
  /** Releases a taken snapshot after a successful send. */
  readonly release: (snapshot: readonly PendingAttachment[]) => void;
  readonly onPaste: (event: ClipboardEvent) => void;
  readonly onDragEnter: (event: DragEvent) => void;
  readonly onDragOver: (event: DragEvent) => void;
  readonly onDragLeave: (event: DragEvent) => void;
  readonly onDrop: (event: DragEvent) => void;
}

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `att-${String(sequence)}`;
}

/** jsdom implements neither half of the object-URL API. */
function makePreview(file: File): string | null {
  if (!file.type.startsWith("image/")) return null;
  if (typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

function releasePreview(attachment: PendingAttachment): void {
  if (attachment.previewUrl === null) return;
  if (typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(attachment.previewUrl);
}

export function useAttachmentIntake(): AttachmentIntake {
  const [pending, setPending] = useState<readonly PendingAttachment[]>([]);
  const [dropping, setDropping] = useState(false);
  const depth = useRef(0);
  // Mirrors state so the unmount cleanup revokes what is actually held: an
  // effect closing over `pending` would revoke whatever the list was at its
  // last run, which is a leak on the way out and a blank thumbnail on the way in.
  const live = useRef<readonly PendingAttachment[]>([]);
  live.current = pending;

  useEffect(
    () => () => {
      for (const attachment of live.current) releasePreview(attachment);
    },
    [],
  );

  const add = useCallback((files: FileList | readonly File[] | null | undefined) => {
    const list = files === null || files === undefined ? [] : Array.from(files);
    if (list.length === 0) return;
    const added = list.map((file) => ({
      id: nextId(),
      file,
      name: file.name === "" ? "pasted-file" : file.name,
      previewUrl: makePreview(file),
    }));
    setPending((current) => [...current, ...added]);
  }, []);

  const remove = useCallback((id: string) => {
    setPending((current) => {
      const going = current.find((attachment) => attachment.id === id);
      if (going !== undefined) releasePreview(going);
      return current.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const take = useCallback((): readonly PendingAttachment[] => {
    const snapshot = live.current;
    live.current = [];
    setPending([]);
    return snapshot;
  }, []);

  const restore = useCallback((snapshot: readonly PendingAttachment[]) => {
    if (snapshot.length === 0) return;
    setPending((current) => [...snapshot, ...current]);
  }, []);

  const release = useCallback((snapshot: readonly PendingAttachment[]) => {
    for (const attachment of snapshot) releasePreview(attachment);
  }, []);

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (files === undefined || files.length === 0) return;
      // Files win: the text fallback beside them is a filename or a data URL,
      // and neither belongs in the composer.
      event.preventDefault();
      add(files);
    },
    [add],
  );

  const onDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    depth.current += 1;
    setDropping(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    // Without this the browser navigates to the dropped file.
    event.preventDefault();
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDropping(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      setDropping(false);
      add(event.dataTransfer?.files);
    },
    [add],
  );

  return {
    pending,
    dropping,
    add,
    remove,
    take,
    restore,
    release,
    onPaste,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
