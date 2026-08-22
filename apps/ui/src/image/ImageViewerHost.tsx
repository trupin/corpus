import { ImageViewerProvider, type ViewableImage } from "@corpus/kit";
import { useCallback, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ImageViewer } from "./ImageViewer";

/**
 * The application's **one** image viewer, and the door the kit opens it through
 * (UI-049).
 *
 * The kit renders the images — `MarkdownView`, the thread's attachment strip
 * and the editor's image node view all draw `CorpusImage` — and publishes a
 * context to open one full-screen. The overlay itself is the app's, because the
 * escape chain and the z-order are (see `markdown/imageViewer.tsx` for the full
 * argument). This component is where the two meet: it holds which image is
 * open, and it is what returns focus when the viewer closes.
 *
 * **One at a time.** There is no stack: a viewer is a picture, and opening one
 * from another is not a thing the surface offers.
 */

export interface ImageViewerHostProps {
  readonly children?: ReactNode;
}

export function ImageViewerHost({ children }: ImageViewerHostProps): ReactElement {
  const [image, setImage] = useState<ViewableImage | null>(null);
  /**
   * The image that opened the viewer — SPEC.md §10: "`esc` closes it and
   * returns focus to the image".
   *
   * Held as the element rather than read back off `document.activeElement`: a
   * click does not reliably focus an image in every browser, and by the time
   * the viewer closes the active element is the viewer's own close button.
   */
  const origin = useRef<HTMLElement | null>(null);

  const open = useCallback((next: ViewableImage, from: HTMLElement | null) => {
    origin.current = from;
    setImage(next);
  }, []);

  const close = useCallback(() => {
    setImage(null);
    const element = origin.current;
    origin.current = null;
    // A body can be replaced under the overlay — an SSE refresh, a navigation
    // in the reader behind it — and focusing a detached node moves focus to
    // `<body>`, which is worse than leaving it where the browser put it.
    if (element !== null && element.isConnected) element.focus();
  }, []);

  return (
    <ImageViewerProvider open={open}>
      {children}
      {image === null ? null : <ImageViewer image={image} onClose={close} />}
    </ImageViewerProvider>
  );
}
