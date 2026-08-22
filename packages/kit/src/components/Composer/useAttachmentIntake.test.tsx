/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttachButton } from "./AttachButton.js";
import { PendingAttachments } from "./PendingAttachments.js";
import { useAttachmentIntake, type AttachmentIntake } from "./useAttachmentIntake.js";

afterEach(cleanup);

const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  let sequence = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => {
      sequence += 1;
      const url = `blob:preview-${String(sequence)}`;
      created.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: (url: string) => {
      revoked.push(url);
    },
  });
});

let latest: AttachmentIntake | null = null;

/**
 * The whole published trio wired the way a composer wires it — the hook's drag
 * handlers on the surface, its paste handler on the field, the chip strip above
 * it and the 📎 in the foot. These four imports are the whole of what a composer
 * needs, so the test composes them the same way.
 */
function Host(): ReactElement {
  const intake = useAttachmentIntake();
  latest = intake;
  return (
    <div
      data-testid="zone"
      className={intake.dropping ? "composer dropping" : "composer"}
      onDragEnter={intake.onDragEnter}
      onDragOver={intake.onDragOver}
      onDragLeave={intake.onDragLeave}
      onDrop={intake.onDrop}
    >
      <PendingAttachments pending={intake.pending} onRemove={intake.remove} />
      <input aria-label="text" onPaste={intake.onPaste} />
      <AttachButton surface="host" onFiles={intake.add} />
      <span data-child>nested</span>
    </div>
  );
}

const png = (): File => new File(["x"], "shot.png", { type: "image/png" });
const pdf = (): File => new File(["x"], "policy.pdf", { type: "application/pdf" });

function pasteEvent(files: File[], text: string): unknown {
  return { clipboardData: { files, getData: () => text } };
}

describe("useAttachmentIntake", () => {
  it("takes files from the picker and previews only the images", () => {
    const { container } = render(<Host />);
    act(() => {
      latest?.add([png(), pdf()]);
    });
    const chips = container.querySelectorAll(".att-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]?.querySelector("img")?.getAttribute("src")).toBe("blob:preview-1");
    expect(chips[1]?.querySelector("img")).toBeNull();
    expect(created).toHaveLength(1);
  });

  /** SPEC.md §6: a pasted screenshot is an attachment, never base64 in the input. */
  it("consumes a paste carrying files and leaves a text-only paste alone", () => {
    const { container } = render(<Host />);
    const input = screen.getByLabelText("text");

    const withFile = pasteEvent([png()], "data:image/png;base64,AAAA");
    fireEvent.paste(input, withFile as never);
    expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
    expect((input as HTMLInputElement).value).toBe("");

    const textOnly = pasteEvent([], "plain words");
    const handled = fireEvent.paste(input, textOnly as never);
    expect(handled).toBe(true);
    expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
  });

  it("keeps the drop highlight lit across nested children", () => {
    const { container } = render(<Host />);
    const zone = screen.getByTestId("zone");
    const child = container.querySelector("[data-child]") as HTMLElement;

    fireEvent.dragEnter(zone);
    expect(zone.className).toContain("dropping");
    fireEvent.dragEnter(child);
    fireEvent.dragLeave(zone);
    expect(zone.className).toContain("dropping");
    fireEvent.dragLeave(child);
    expect(zone.className).not.toContain("dropping");
  });

  it("adds dropped files and clears the highlight", () => {
    const { container } = render(<Host />);
    const zone = screen.getByTestId("zone");
    fireEvent.dragEnter(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [pdf()] } });
    expect(zone.className).not.toContain("dropping");
    expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
  });

  it("revokes a removed preview, and everything still held on unmount", () => {
    const { container, unmount } = render(<Host />);
    act(() => {
      latest?.add([png(), png()]);
    });
    expect(created).toHaveLength(2);

    fireEvent.click(container.querySelectorAll(".att-chip button")[0] as HTMLElement);
    expect(revoked).toEqual(["blob:preview-1"]);

    unmount();
    expect(revoked).toEqual(["blob:preview-1", "blob:preview-2"]);
  });

  /** A send takes the list without revoking, so a failure can put it back. */
  it("take/restore keeps previews usable, release frees them", () => {
    const { container } = render(<Host />);
    act(() => {
      latest?.add([png()]);
    });

    let snapshot: readonly { readonly id: string }[] = [];
    act(() => {
      snapshot = latest?.take() ?? [];
    });
    expect(container.querySelectorAll(".att-chip")).toHaveLength(0);
    expect(revoked).toHaveLength(0);

    act(() => {
      latest?.restore(snapshot as never);
    });
    expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
    expect(container.querySelector(".att-chip img")?.getAttribute("src")).toBe("blob:preview-1");

    act(() => {
      snapshot = latest?.take() ?? [];
      latest?.release(snapshot as never);
    });
    expect(revoked).toEqual(["blob:preview-1"]);
  });
});

/**
 * The 📎 route, asserted through the markup a host actually gets — the two
 * details the component exists to stop every composer from re-deriving.
 */
describe("AttachButton", () => {
  it("opens its own hidden input, named by surface and taking many files", () => {
    render(<Host />);
    const picker = document.querySelector<HTMLInputElement>('[data-attach-input="host"]');
    expect(picker).not.toBeNull();
    expect(picker?.type).toBe("file");
    expect(picker?.multiple).toBe(true);
    expect(picker?.hidden).toBe(true);

    let clicked = 0;
    picker?.addEventListener("click", () => {
      clicked += 1;
    });
    fireEvent.click(screen.getByLabelText("Attach files"));
    expect(clicked).toBe(1);
  });

  /**
   * Re-picking the *same* file fires no `change` event unless the input's value
   * was cleared first, and the attachment then silently does not arrive.
   *
   * The assertion has to watch the **write**, not the resulting value: a file
   * input reads `""` before anything is picked, so `expect(picker.value)` is
   * vacuous and passes against a component that clears nothing (checked — it
   * did). So `value` is replaced with an accessor that reports a browser's
   * post-pick spelling and records what is assigned to it.
   */
  it("hands the files to the composer and clears its value for a re-pick", () => {
    const { container } = render(<Host />);
    const picker = document.querySelector<HTMLInputElement>('[data-attach-input="host"]');
    if (picker === null) throw new Error("no picker");

    const list = {
      0: png(),
      length: 1,
      item: (index: number) => (index === 0 ? png() : null),
    } as unknown as FileList;
    Object.defineProperty(picker, "files", { configurable: true, value: list });

    const writes: string[] = [];
    Object.defineProperty(picker, "value", {
      configurable: true,
      get: () => "C:\\fakepath\\shot.png",
      set: (next: string) => {
        writes.push(next);
      },
    });

    fireEvent.change(picker);
    expect(container.querySelectorAll(".att-chip")).toHaveLength(1);
    expect(writes).toEqual([""]);
  });
});
