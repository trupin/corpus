import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from "react";

/**
 * The seam between a kit-rendered image and the app's full-screen viewer
 * (SPEC.md §10: "clicking any rendered image … opens it full-screen over the
 * app, where `esc` closes it and returns focus to the image").
 *
 * **Why a seam and not a viewer.** The kit renders the images; it does not own
 * the surface they open over. Escape precedence and z-order live in one place
 * in `apps/ui` (`reader/useEscapeStack.ts` — Reader 0 / Focus 10 / Overlay 20 /
 * Popover 30), the viewer has to take precedence over focus mode and the search
 * overlay, and a kit-local chain would be a *second* registry that the first one
 * could not see: two layers both believing they are topmost, and one Escape
 * closing both. The kit also has no application root to portal a fixed overlay
 * into. Importing `apps/ui` from here is forbidden outright (the dependency
 * direction runs the other way), so the viewer lives in the app and the kit
 * publishes the door to it.
 *
 * **Why a context and not a prop.** `MarkdownView` renders from several hosts
 * today — the column reader, focus mode, thread turns, the compose preview —
 * and turn attachments are not a `MarkdownView` at all. A prop is a
 * thing every host must remember to thread, and the hosts that would forget it
 * are precisely the ones this issue exists to fix. The callback identity is
 * memoised here so a provider re-render does not remount every image below it.
 *
 * Absent a provider — a component test, a preview rendered outside the shell —
 * {@link useImageViewer} answers `null` and images
 * render as plain images. Not clickable, and not advertising a click that would
 * do nothing.
 */

export interface ViewableImage {
  /**
   * A source the browser can paint **now**: the `blob:` URL for an attachment,
   * or the original `data:`/remote URL for everything else. Never the relative
   * reference as written — resolving that is the renderer's job, done before
   * the viewer is ever told about the image.
   */
  readonly src: string;
  /** The image's alt text; the viewer's accessible name and its caption. */
  readonly alt: string;
}

export interface ImageViewerApi {
  /**
   * Opens the viewer.
   *
   * `origin` is the element that was activated, and it is what Escape gives
   * focus back to. The element is passed rather than read from
   * `document.activeElement` because a mouse click does not reliably focus an
   * image in every browser, and "the image that opened the viewer" is a fact
   * the caller holds and the viewer cannot recover.
   */
  readonly open: (image: ViewableImage, origin: HTMLElement | null) => void;
}

const ImageViewerContext = createContext<ImageViewerApi | null>(null);

export interface ImageViewerProviderProps {
  readonly open: (image: ViewableImage, origin: HTMLElement | null) => void;
  readonly children?: ReactNode;
}

export function ImageViewerProvider({ open, children }: ImageViewerProviderProps): ReactElement {
  const value = useMemo<ImageViewerApi>(() => ({ open }), [open]);
  return <ImageViewerContext.Provider value={value}>{children}</ImageViewerContext.Provider>;
}

/** The viewer this subtree opens into, or `null` where none is mounted. */
export function useImageViewer(): ImageViewerApi | null {
  return useContext(ImageViewerContext);
}
