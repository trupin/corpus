/** @vitest-environment jsdom */
import { IMAGE_CLASS } from "@corpus/kit";
import { afterEach, describe, expect, it } from "vitest";
import { opensTheViewer } from "./ImageNodeView.js";

/**
 * UI-202: which presses the editor's image node view keeps away from
 * ProseMirror. Only the one that opens the viewer — anything wider takes
 * gestures away from the editor, anything narrower lets ProseMirror select the
 * image under the viewer, and the next keystroke replaces it.
 *
 * The browser half, where the press, the viewer, esc and the keystroke all
 * happen, is `apps/ui/e2e/images.spec.ts` › "closing the viewer from a document
 * body (UI-202)".
 */

afterEach(() => {
  document.body.replaceChildren();
});

/** The picture as `CorpusImage` draws it with a viewer mounted. */
function viewableImage(): HTMLImageElement {
  const image = document.createElement("img");
  image.className = IMAGE_CLASS;
  image.setAttribute("role", "button");
  document.body.append(image);
  return image;
}

function press(target: Element, init: MouseEventInit = {}, type = "mousedown"): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("opensTheViewer", () => {
  it("takes a plain primary press on a viewable picture", () => {
    expect(opensTheViewer(press(viewableImage()))).toBe(true);
  });

  it("takes it whatever other modifier is held, since the click opens the viewer anyway", () => {
    expect(opensTheViewer(press(viewableImage(), { metaKey: true }))).toBe(true);
    expect(opensTheViewer(press(viewableImage(), { ctrlKey: true }))).toBe(true);
  });

  it.each([
    ["the secondary button — the context menu reads the editor's selection", { button: 2 }],
    ["the middle button", { button: 1 }],
    ["a shift-press, which extends a text selection", { shiftKey: true }],
  ])("leaves %s to the editor", (_label, init: MouseEventInit) => {
    expect(opensTheViewer(press(viewableImage(), init))).toBe(false);
  });

  it.each(["mouseup", "click", "dblclick"])("leaves a %s to the editor", (type) => {
    expect(opensTheViewer(press(viewableImage(), {}, type))).toBe(false);
  });

  it("leaves a key on the focused picture to the node view's own rule", () => {
    const image = viewableImage();
    const event = new KeyboardEvent("keydown", { key: "z", bubbles: true });
    image.dispatchEvent(event);
    expect(opensTheViewer(event)).toBe(false);
  });

  it("leaves a picture that cannot open — no viewer mounted, so no button role", () => {
    const image = viewableImage();
    image.removeAttribute("role");
    expect(opensTheViewer(press(image))).toBe(false);
  });

  it("leaves ProseMirror's own hidden separator image alone (UI-201)", () => {
    const separator = document.createElement("img");
    separator.className = "ProseMirror-separator";
    document.body.append(separator);
    expect(opensTheViewer(press(separator))).toBe(false);
  });

  it("leaves a press on the wrapper around the picture to the editor", () => {
    const wrapper = document.createElement("span");
    wrapper.className = "doc-image";
    document.body.append(wrapper);
    expect(opensTheViewer(press(wrapper))).toBe(false);
  });
});
