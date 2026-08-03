/** @vitest-environment jsdom */
import { CorpusImage } from "@corpus/kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EscapeLayerPriority, resetEscapeLayers, useEscapeLayer } from "../reader/useEscapeStack";
import { isOverlayOpen } from "../shell/overlays";
import { ImageViewerHost } from "./ImageViewerHost";
import { IMAGE_VIEWER_HINT } from "./ImageViewer";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const REMOTE = "https://example.com/chart.png";

/**
 * The whole seam, end to end: a kit-rendered image inside the app's host. The
 * two halves are only correct together, so the test mounts both rather than
 * calling the provider's `open` by hand.
 */
function Host({ alt = "A chart" }: { readonly alt?: string }): ReactElement {
  return (
    <ImageViewerHost>
      <p>
        before <CorpusImage src={REMOTE} alt={alt} /> after
      </p>
    </ImageViewerHost>
  );
}

function image(): HTMLElement {
  return screen.getByRole("button", { name: /open full screen/ });
}

function pressEscape(): void {
  fireEvent.keyDown(document, { key: "Escape" });
}

describe("the full-screen image viewer", () => {
  it("is not mounted until an image is clicked", () => {
    render(<Host />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isOverlayOpen()).toBe(false);
  });

  it("opens over the app with the image at full size", () => {
    render(<Host />);
    fireEvent.click(image());

    const dialog = screen.getByRole("dialog", { name: "A chart" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.querySelector(".image-viewer-img")?.getAttribute("src")).toBe(REMOTE);
    // No 240×180 cap and no `max-width: 100%` of a column: the viewer's own
    // stylesheet is what bounds it, and it bounds it by the viewport.
    expect(dialog.querySelector(".image-viewer-img")?.className).toBe("image-viewer-img");
    expect(dialog.textContent).toContain(IMAGE_VIEWER_HINT);
  });

  /**
   * The class pair is the app's contract for "a modal surface owns the
   * keyboard" (`shell/overlays.ts`), which is what takes the board's
   * single-letter bindings out of scope while a picture is up.
   */
  it("declares itself an open overlay", () => {
    render(<Host />);
    fireEvent.click(image());
    expect(isOverlayOpen()).toBe(true);
  });

  it("opens on ↵ from the keyboard", () => {
    render(<Host />);
    fireEvent.keyDown(image(), { key: "Enter" });
    expect(screen.getByRole("dialog")).not.toBeNull();
  });

  /** SPEC.md §11: "`esc` closes it and returns focus to the image". */
  it("closes on esc and gives focus back to the image that opened it", () => {
    render(<Host />);
    const opener = image();
    fireEvent.click(opener);
    // Focus moved into the overlay, or `esc` typed in the editor behind it
    // would never reach the chain.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "✕ Close" }));

    pressEscape();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes from its own button, and from the backdrop around the picture", () => {
    render(<Host />);
    fireEvent.click(image());
    fireEvent.click(screen.getByRole("button", { name: "✕ Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(image());
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /** A click on the picture is not a click outside it. */
  it("stays open when the picture itself is clicked", () => {
    render(<Host />);
    fireEvent.click(image());
    const shown = screen.getByRole("dialog").querySelector(".image-viewer-img");
    fireEvent.click(shown as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  /**
   * The acceptance criterion the layering exists for: the viewer opens *from*
   * focus mode or from over the search overlay, both of which stay mounted
   * behind it, and Escape belongs to the picture until it is gone.
   */
  it("takes escape precedence over focus mode and the search overlay", () => {
    const closed: string[] = [];
    function Layer({ priority, name }: { readonly priority: number; readonly name: string }): null {
      useEscapeLayer({
        active: true,
        priority,
        onEscape: () => closed.push(name),
      });
      return null;
    }

    render(
      <>
        <Layer priority={EscapeLayerPriority.Focus} name="focus" />
        <Layer priority={EscapeLayerPriority.Overlay} name="search" />
        <Layer priority={EscapeLayerPriority.Popover} name="menu" />
        <Host />
      </>,
    );

    fireEvent.click(image());
    pressEscape();
    expect(closed).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();

    // And the layers underneath are untouched: the next press is theirs.
    pressEscape();
    expect(closed).toEqual(["menu"]);
  });

  /**
   * A body can be replaced under the overlay — an SSE refresh, a navigation in
   * the reader behind it. Focusing a detached node moves focus to `<body>`,
   * which is worse than leaving it where the browser put it.
   */
  it("does not chase an image that left the document while the viewer was up", () => {
    const view = render(<Host />);
    fireEvent.click(image());
    const close = screen.getByRole("button", { name: "✕ Close" });
    view.rerender(
      <ImageViewerHost>
        <p>the body moved on</p>
      </ImageViewerHost>,
    );
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.contains(document.activeElement)).toBe(true);
  });

  it("names itself generically when the image has no alt text", () => {
    render(<Host alt="" />);
    fireEvent.click(screen.getByRole("button", { name: "Open image full screen" }));
    expect(screen.getByRole("dialog", { name: "Image" })).not.toBeNull();
    // …and shows no empty caption line under the picture.
    expect(screen.getByRole("dialog").querySelector(".image-viewer-caption")).toBeNull();
  });

  it("shows the alt text as the picture's caption", () => {
    render(<Host />);
    fireEvent.click(image());
    expect(screen.getByRole("dialog").querySelector(".image-viewer-caption")?.textContent).toBe(
      "A chart",
    );
  });

  /** One picture at a time: opening a second replaces the first. */
  it("replaces the open image rather than stacking viewers", () => {
    render(
      <ImageViewerHost>
        <CorpusImage src={REMOTE} alt="first" />
        <CorpusImage src="https://example.com/two.png" alt="second" />
      </ImageViewerHost>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^first/ }));
    fireEvent.click(screen.getByRole("button", { name: /^second/ }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "second" })).not.toBeNull();
  });

  it("registers no escape layer once it is closed", () => {
    const onEscape = vi.fn();
    function Reader(): null {
      useEscapeLayer({ active: true, priority: EscapeLayerPriority.Reader, onEscape });
      return null;
    }
    render(
      <>
        <Reader />
        <Host />
      </>,
    );
    fireEvent.click(image());
    pressEscape();
    expect(onEscape).not.toHaveBeenCalled();
    pressEscape();
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
