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
 * **Why this lives in the kit** (UI-070). SPEC.md §11's rider binds *every*
 * composer — "the global composer, a thread's reply box, a comment on a document
 * selection, a comment on a turn or on a selection within one, **and any
 * composer a plugin contributes**" — and a plugin may import nothing but
 * `@corpus/kit` (§10). While this hook sat in `apps/ui`, the one composer
 * outside that tree was the one composer that could not take a file, and the
 * only ways to fix it were to copy the hook into the plugin or to move it here.
 * `composerKeys.ts` next door settled the same argument the same way.
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

/**
 * Revokes a taken snapshot's previews from **outside** a composer.
 *
 * A composer that closes on submit hands its attachments to whoever posts them
 * — `take()` deliberately leaves them unrevoked so a refusal can put them back —
 * and that owner is then the only thing left to free them once the post lands.
 * {@link AttachmentIntake.release} is the same act from inside a composer that
 * is still mounted.
 */
export function releaseAttachments(snapshot: readonly PendingAttachment[]): void {
  for (const attachment of snapshot) releasePreview(attachment);
}

/**
 * `initial` seeds the list — what a composer re-opened on a refused send holds
 * (UI-111). Those previews were made by the composer that closed and survived
 * its unmount because `take()` handed ownership out; seeding is how ownership
 * comes back.
 */
export function useAttachmentIntake(initial: readonly PendingAttachment[] = []): AttachmentIntake {
  const [pending, setPending] = useState<readonly PendingAttachment[]>(initial);
  const [dropping, setDropping] = useState(false);
  const depth = useRef(0);
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
