import type { ViewableImage } from "@corpus/kit";
import { useEffect, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import "./ImageViewer.css";

/**
 * One image, full-screen over the app (SPEC.md §11: "clicking any rendered
 * image — a turn attachment or an image in a document body — opens it
 * full-screen over the app, where `esc` closes it and returns focus to the
 * image").
 *
 * **It is not a reader.** `FocusMode` is a document surface with a navigation
 * stack, a frontmatter form and an editor in it; this is a picture and a way
 * out. They share the escape chain and nothing else.
 *
 * Portalled to `document.body` for the reason focus mode is: a `position:
 * fixed` overlay mounted inside the board would be caught by an ancestor's
 * containing block and clipped by the horizontal scroller.
 *
 * The source is already a source the browser can paint — a `blob:` URL the
 * kit's `useAttachment` owns, or the original remote/`data:` URL. This
 * component fetches nothing and revokes nothing: the object URL belongs to the
 * image that opened the viewer, which is still mounted behind it, so the bytes
 * cannot be pulled out from under the picture on screen.
 */

export const IMAGE_VIEWER_HINT = "esc closes";

export interface ImageViewerProps {
  readonly image: ViewableImage;
  readonly onClose: () => void;
}

export function ImageViewer({ image, onClose }: ImageViewerProps): ReactElement {
  useEscapeLayer({
    active: true,
    priority: EscapeLayerPriority.ImageViewer,
    onEscape: onClose,
  });

  /**
   * Focus moves *into* the overlay on open.
   *
   * Without it the caret stays wherever it was — very often inside the
   * document editor the image was clicked in — and the escape chain
   * deliberately ignores keys typed in a writing surface, so `esc` would do
   * nothing at all. Focus goes back to the image on close; that is
   * {@link ImageViewerHost}'s job, because it is the thing that outlives this
   * component.
   */
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);

  return createPortal(
    <div
      className="overlay open image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt === "" ? "Image" : image.alt}
      // Clicking the backdrop closes, exactly as clicking away from any other
      // modal surface does. The picture itself is excluded below rather than by
      // a stopPropagation on it, so a click that lands on the padding around a
      // portrait image still counts as "outside".
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="image-viewer-bar">
        <span className="image-viewer-hint">{IMAGE_VIEWER_HINT}</span>
        <button ref={close} type="button" className="image-viewer-close" onClick={onClose}>
          ✕ Close
        </button>
      </div>
      <img className="image-viewer-img" src={image.src} alt={image.alt} />
      {image.alt === "" ? null : <p className="image-viewer-caption">{image.alt}</p>}
    </div>,
    document.body,
  );
}
