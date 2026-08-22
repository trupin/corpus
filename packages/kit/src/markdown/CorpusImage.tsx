import {
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { useAttachment } from "../query/useAttachment.js";
import { attachmentTarget } from "./attachmentSrc.js";
import { useImageViewer } from "./imageViewer.js";

/**
 * **The** image renderer, for every host that draws one (UI-049).
 *
 * Three hosts existed and two of them were wrong: a trailing turn attachment
 * fetched its bytes with the workspace token and rendered, while the *same*
 * attachment referenced one line earlier — or anywhere in a document body —
 * rendered as a bare relative `<img src>` that silently loaded nothing. One
 * component is what makes "referenced at the end" and "referenced mid-prose"
 * the same picture: `MarkdownView`'s `img` override, the thread's attachment
 * strip and the editor's image node view all render this.
 *
 * It answers two questions and nothing else:
 *
 * 1. **Where do the bytes come from.** An `attachments/…` source is fetched
 *    with the bearer token and painted from an object URL revoked on unmount
 *    (`useAttachment`); every other source — remote, `data:`, `blob:` — is
 *    handed to the browser untouched, because nothing about it is ours.
 * 2. **What a click does.** With a viewer mounted the image is a focusable
 *    control that opens it full-screen; without one it is an image.
 */

export interface CorpusImageProps {
  /** The source as the body wrote it — relative reference, URL or `data:`. */
  readonly src: string;
  readonly alt: string;
  readonly title?: string | undefined;
  /** Host sizing (`turn-att-img`, say). Composed with the shared base class. */
  readonly className?: string | undefined;
}

/**
 * The class every rendered image carries, whatever the host: one selector for
 * the affordance, so the cursor and the focus ring are declared once.
 */
export const IMAGE_CLASS = "md-img";

/**
 * The degraded states. Both are **visible**: a reference whose bytes are
 * unreachable is still a fact about the body, and a blank where a picture
 * should be is the one outcome that tells the reader nothing (SPEC.md §6's
 * "posted turns render images inline" does not stop being true when the fetch
 * fails).
 */
export const IMAGE_PENDING_CLASS = "md-img-pending";
export const IMAGE_BROKEN_CLASS = "md-img-broken";

/**
 * Whether this click is the end of a text selection rather than a click on the
 * picture.
 *
 * Dragging a selection across prose that contains an image ends on the image
 * and fires a click there, and UI-042's selection menu and Copy path are about
 * that selection — opening a viewer over it would be the image stealing a
 * gesture aimed at the text. Right-click never reaches here at all: `onClick`
 * fires for the primary button only, so UI-036's context menus are untouched.
 *
 * `containsNode` is what makes this specific to *this* image; where the browser
 * does not implement it the click opens, because refusing every click while any
 * stale selection exists somewhere on the page is the worse failure.
 *
 * **Text is what makes it a text selection**, and that clause is not
 * defensive — it is what makes the editor work. Clicking an image inside
 * ProseMirror creates a `NodeSelection`, which reaches the DOM as a
 * *non-collapsed* selection spanning exactly this element and carrying no text
 * at all. Without the test below, every click on an image in a document body
 * was swallowed by the guard meant for a drag across prose.
 */
function endsASelection(image: Node): boolean {
  const selection = globalThis.getSelection?.() ?? null;
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false;
  if (selection.toString() === "") return false;
  if (typeof selection.containsNode !== "function") return false;
  return selection.containsNode(image, true);
}

interface ViewableImgProps extends CorpusImageProps {
  /** The reference this image resolves, when it resolves one. */
  readonly attachment: string | null;
}

/** The `<img>` itself, once the bytes have a source the browser can paint. */
function ViewableImg({ src, alt, title, className, attachment }: ViewableImgProps): ReactElement {
  const viewer = useImageViewer();

  const open = useCallback(
    (element: HTMLElement) => {
      viewer?.open({ src, alt }, element);
    },
    [alt, src, viewer],
  );

  const classes = [IMAGE_CLASS, ...(className === undefined ? [] : [className])].join(" ");
  const attrs = {
    src,
    alt,
    className: classes,
    ...(title === undefined ? {} : { title }),
    ...(attachment === null ? {} : { "data-att-target": attachment }),
  };

  // No provider: an image, and nothing that claims to be a button.
  if (viewer === null) return <img {...attrs} />;

  return (
    <img
      {...attrs}
      // `role`/`tabIndex` on the image rather than a `<button>` around it: a
      // wrapper is a new box in the middle of phrasing content, and §10's
      // prose layout is not this feature's to change.
      role="button"
      tabIndex={0}
      aria-label={alt === "" ? "Open image full screen" : `${alt} — open full screen`}
      onClick={(event: ReactMouseEvent<HTMLImageElement>) => {
        if (endsASelection(event.currentTarget)) return;
        open(event.currentTarget);
      }}
      onKeyDown={(event: ReactKeyboardEvent<HTMLImageElement>) => {
        if (event.key !== "Enter") return;
        // The editor hosts images too, and there `↵` splits a paragraph. The
        // key belongs to the focused control, not to the surface behind it.
        event.preventDefault();
        event.stopPropagation();
        open(event.currentTarget);
      }}
    />
  );
}

interface AttachmentImgProps extends CorpusImageProps {
  readonly target: string;
}

function AttachmentImg({ target, alt, title, className }: AttachmentImgProps): ReactElement {
  const bytes = useAttachment(target);

  if (bytes.url !== null) {
    return (
      <ViewableImg
        src={bytes.url}
        alt={alt}
        title={title}
        className={className}
        attachment={target}
      />
    );
  }

  const label = alt === "" ? (target.split("/").at(-1) ?? target) : alt;
  if (bytes.error !== null) {
    return (
      <span
        className={IMAGE_BROKEN_CLASS}
        data-att-target={target}
        title={`${target} could not be loaded.`}
      >
        ⚠ {label}
      </span>
    );
  }
  return (
    <span className={IMAGE_PENDING_CLASS} data-att-target={target} aria-busy="true">
      🖼 {label}
    </span>
  );
}

export function CorpusImage({ src, alt, title, className }: CorpusImageProps): ReactElement {
  const target = attachmentTarget(src);
  // Two components rather than a branch inside one: `useAttachment` is a hook
  // and a source that is not an attachment must not call it.
  return target === null ? (
    <ViewableImg src={src} alt={alt} title={title} className={className} attachment={null} />
  ) : (
    <AttachmentImg target={target} src={src} alt={alt} title={title} className={className} />
  );
}
