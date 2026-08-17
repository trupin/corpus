/** @vitest-environment jsdom */
import { COMPOSER_PRIMARY_KEY } from "@corpus/kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transport, wrapperFor, type Transport } from "./testing.js";
import { quotePreview, TodoItemComposer } from "./TodoItemComposer.js";
import type { TodoItemTarget } from "./TodoItemMenu.js";

afterEach(cleanup);

/**
 * jsdom implements neither half of the object-URL API, and the intake makes a
 * preview for every image. Recording both halves is also how the leak is
 * asserted: a revoked preview is a `blob:` URL that came back.
 */
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
      const url = `blob:todo-preview-${String(sequence)}`;
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

/**
 * The composer *Comment on item* opens, and the request it sends: an ordinary
 * `POST /api/threads` with a §6 selector (sprint-023 TEST-1070). "No new thread
 * shape" is asserted as the wire body, because that is where a new shape would
 * appear.
 */

const SELECTOR = {
  exact: "Call the plumber",
  prefix: "appointment (due: 2026-08-01)\n- [ ] ",
  suffix: "\n- [x] Send the signed form\n",
};

const TARGET: TodoItemTarget = {
  docId: "doc_week",
  listTitle: "Week of Jul 20",
  index: 1,
  item: { text: "Call the plumber", done: false },
};

/**
 * A whole `CreateThreadResponse`, not the two fields the JSON branch's callers
 * happen to read.
 *
 * The multipart branch parses its answer with the contract's own schema
 * (`uploadCreateThread`), while `openapi-fetch` trusts the wire — so a stub
 * good enough for one branch is rejected by the other, and the honest fixture
 * is the shape the route actually declares.
 */
const CREATED = {
  thread: {
    id: "th_new1",
    title: "Call the plumber",
    created: "2026-08-16T09:00:00.000Z",
    updated: "2026-08-16T09:00:00.000Z",
    status: "open",
    tags: [],
    parent: "doc_week",
    anchor: "anc_new1",
    agent: "requested",
    resident: null,
    turns: [
      {
        author: "user",
        ts: "2026-08-16T09:00:00.000Z",
        body: "which plumber was it?",
        model: null,
      },
    ],
  },
  anchorId: "anc_new1",
  eventId: "evt_1",
  warnings: [],
};

/** One multipart `POST /api/threads`, decoded into the two things it carries. */
interface Upload {
  /** Every text part, by name — `parent`, `selector` (JSON), `text`, … */
  readonly fields: Record<string, string>;
  readonly files: readonly { readonly name: string; readonly type: string }[];
}

interface Mounted {
  /** Every JSON `POST /api/threads` body the composer sent, parsed. */
  readonly posted: readonly Record<string, unknown>[];
  /** Every multipart `POST /api/threads` — the branch a file switches on. */
  readonly uploads: readonly Upload[];
  readonly container: HTMLElement;
  readonly unmount: () => void;
  readonly onCreated: ReturnType<typeof vi.fn>;
  readonly onClose: ReturnType<typeof vi.fn>;
}

function decode(form: FormData): Upload {
  const fields: Record<string, string> = {};
  const files: { name: string; type: string }[] = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
    else files.push({ name: value.name, type: value.type });
  }
  return { fields, files };
}

function mount(threadsAnswer?: { readonly status: number; readonly body: unknown }): Mounted {
  const wire = transport({});
  const answer = threadsAnswer ?? { status: 201, body: CREATED };
  // Two callers, two shapes. `openapi-fetch` — which every core kit hook goes
  // through — hands `fetch` a `Request`, so the JSON body is in the request
  // rather than in an init; the contract's upload helper hands a `URL` and a
  // `FormData` init, which is the branch a pending attachment switches on.
  const posted: Record<string, unknown>[] = [];
  const uploads: Upload[] = [];
  const wired: Transport = {
    ...wire,
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url).pathname !== "/api/threads") return wire.fetch(input, init);
      const body = input instanceof Request ? await input.clone().text() : init?.body;
      if (body instanceof FormData) uploads.push(decode(body));
      else
        posted.push(JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>);
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const handlers = { onCreated: vi.fn(), onClose: vi.fn() };
  const { container, unmount } = render(
    <TodoItemComposer
      target={TARGET}
      selector={SELECTOR}
      clientX={20}
      clientY={30}
      {...handlers}
    />,
    { wrapper: wrapperFor(wired).Wrapper },
  );
  return { posted, uploads, container, unmount, ...handlers };
}

const input = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>("Comment");
/**
 * Spelled out rather than imported from the component: the acceptance criterion
 * is the glyph a user reads on the button, and a test that re-used the constant
 * would pass whatever the constant said.
 */
const send = (): HTMLButtonElement => screen.getByText<HTMLButtonElement>("Comment ⌘↵");

describe("TodoItemComposer", () => {
  it("shows the quote it will anchor to, and takes focus", () => {
    mount();
    expect(screen.getByText("“Call the plumber”")).toBeTruthy();
    expect(document.activeElement).toBe(input());
  });

  it("sends nothing until there is something to say", () => {
    const { posted } = mount();
    expect(send().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: "   " } });
    expect(send().disabled).toBe(true);
    expect(posted).toEqual([]);
  });

  /** TEST-1070: parent, selector, first turn — the ordinary §6 request. */
  it("creates an ordinary anchored thread on the parent document", async () => {
    const { posted, onCreated } = mount();
    fireEvent.change(input(), { target: { value: "  who was the plumber again?  " } });
    fireEvent.click(send());
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(TARGET, "th_new1");
    });
    expect(posted[0]).toEqual({
      parent: "doc_week",
      selector: SELECTOR,
      body: "who was the plumber again?",
      requestsAgent: true,
    });
  });

  it("sends an explicit false for a note, so a note never becomes a job", async () => {
    const { posted, onCreated } = mount();
    fireEvent.change(input(), { target: { value: "note to self" } });
    fireEvent.click(screen.getByText("◉ ask agent"));
    expect(screen.getByText("○ note only").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(send());
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(posted[0]?.["requestsAgent"]).toBe(false);
  });

  /**
   * PLUGINS-011. This composer sent on `↵` with `⇧↵` for a newline, which was
   * the convention SPEC.md §11 replaced. The contract binds "any composer a
   * plugin contributes", so the reference plugin demonstrates it: `↵` belongs to
   * the text, `⌘↵` sends. The handler is the kit's `handleComposerKeyDown` — its
   * own unit tests cover the contract, and what is asserted here is that this
   * composer is wired to it and to nothing else.
   */
  it("sends on ⌘↵ and leaves ↵ to the text", async () => {
    const { onCreated } = mount();
    fireEvent.change(input(), { target: { value: "first line" } });
    // `fireEvent` returns false once `preventDefault` has been called, so a
    // `true` here is the proof the browser's own newline insertion still runs —
    // in jsdom nothing types into the field, and un-prevented is the behaviour.
    expect(fireEvent.keyDown(input(), { key: "Enter" })).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();
    // ⇧↵ was the old newline chord; it stays a newline and never sends.
    expect(fireEvent.keyDown(input(), { key: "Enter", shiftKey: true })).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(input(), { key: "Enter", metaKey: true })).toBe(false);
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(TARGET, "th_new1");
    });
  });

  /** The chord on the button is the kit's, so it cannot drift from the app's. */
  it("names the key it answers to", () => {
    mount();
    expect(send().textContent).toBe(`Comment ${COMPOSER_PRIMARY_KEY}`);
  });

  /**
   * The keystroke that *commits* an IME composition arrives as `Enter`, and on
   * macOS a user may well be holding ⌘ from the chord before it. Committing
   * "プランを" must put those characters in the field, not post them.
   */
  it("never sends on an IME composition commit", async () => {
    const { posted, onCreated } = mount();
    fireEvent.change(input(), { target: { value: "プランを" } });
    fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true, isComposing: true });
    await Promise.resolve();
    expect(onCreated).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
    // And the composition is still there to be sent deliberately.
    expect(input().value).toBe("プランを");
  });

  /** The field grows with the draft; the mirror that measures it carries it. */
  it("mirrors the draft so the field grows with it", () => {
    const { container } = mount();
    const grow = container.querySelector(".todo-cm-grow");
    expect(grow?.getAttribute("data-replicated-value")).toBe("");
    fireEvent.change(input(), { target: { value: "first line\nsecond line" } });
    expect(grow?.getAttribute("data-replicated-value")).toBe("first line\nsecond line");
  });

  it("closes on Escape from inside the field", () => {
    const { onClose } = mount();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * PR #19 review. The composer used to answer Escape only from its textarea,
   * so pressing the agent toggle first — which moves focus to a button — left
   * the key to the app's own escape chain: the reader **underneath** closed
   * while this popover stayed open, over nothing.
   */
  it("closes on Escape once focus has left the field", () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByText("◉ ask agent"));
    fireEvent.keyDown(screen.getByText("○ note only"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes Escape before the layer behind it can act on it", () => {
    const behind = vi.fn();
    // The app's escape chain listens on `document` in the capture phase; this
    // popover listens on `window`, which captures first.
    document.addEventListener("keydown", behind, true);
    const { onClose } = mount();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener("keydown", behind, true);
  });

  it("dismisses on a click outside, and not on one inside", () => {
    const { onClose } = mount();
    fireEvent.mouseDown(input());
    fireEvent.mouseDown(screen.getByText("“Call the plumber”"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The refusal is one `POST /api/threads` actually declares — a `404` for a
   * parent document that went away while the popover was open (the route's
   * responses are `400`, `401`, `404`). A payload the system cannot produce
   * would prove only that this composer treats every failure alike.
   */
  it("keeps the words and reports the refusal when the server says no", async () => {
    const { onCreated } = mount({
      status: 404,
      body: { code: "not_found", message: "no document doc_week" },
    });
    fireEvent.change(input(), { target: { value: "who was the plumber again?" } });
    fireEvent.click(send());
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Comment failed");
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(input().value).toBe("who was the plumber again?");
  });
});

/**
 * PLUGINS-012 — SPEC.md §11's rider: *"any composer a plugin contributes"*
 * takes files by all three of §6's routes, previewed as chips before sending.
 *
 * Everything asserted here is behaviour reachable from the plugin's own import
 * surface: the chips come from the kit's `PendingAttachments`, the 📎 from its
 * `AttachButton`, the three routes from its `useAttachmentIntake` — and if any
 * of that had had to be copied into `plugins/todos/`, `imports.test.ts` would
 * be the file that changed instead of this one.
 *
 * The drop tests deliberately assert what was **sent**, not which class the
 * popover wore. A test that stops at `.dropping` passes against a dropzone
 * whose `onDrop` was never wired (UI-111's Testing Strategy names exactly this
 * trap), because the highlight and the intake are two different handlers.
 */
describe("TodoItemComposer attachments", () => {
  const png = (name = "shot.png"): File =>
    new File(["screenshot-bytes"], name, { type: "image/png" });
  const pdf = (): File => new File(["policy-bytes"], "policy.pdf", { type: "application/pdf" });

  const pop = (container: HTMLElement): HTMLElement =>
    container.querySelector("[data-todo-comment]") as HTMLElement;
  const picker = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(
      '[data-attach-input="todo-item-comment"]',
    ) as HTMLInputElement;
  const chips = (container: HTMLElement): readonly HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>(".att-chip"),
  ];

  /** Route 1 of 3 — the 📎, which is the only one that needs markup. */
  it("takes a file from the picker and previews it as a chip before sending", () => {
    const { container, posted, uploads } = mount();
    fireEvent.click(screen.getByLabelText("Attach files"));
    fireEvent.change(picker(), { target: { files: [png()] } });

    expect(chips(container)).toHaveLength(1);
    expect(chips(container)[0]?.textContent).toContain("shot.png");
    expect(chips(container)[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "blob:todo-preview-1",
    );
    // A preview is not a send: nothing has left the composer yet.
    expect(posted).toEqual([]);
    expect(uploads).toEqual([]);
  });

  /** Route 2 of 3 — the pasted screenshot, which must never land as base64. */
  it("consumes a paste carrying files and leaves a text-only paste to the field", () => {
    const { container } = mount();
    const withFile = fireEvent.paste(input(), {
      clipboardData: { files: [png()], getData: () => "data:image/png;base64,AAAA" },
    });
    // `fireEvent` returns false once `preventDefault` ran — the paste was taken.
    expect(withFile).toBe(false);
    expect(chips(container)).toHaveLength(1);

    const textOnly = fireEvent.paste(input(), {
      clipboardData: { files: [], getData: () => "plain words" },
    });
    expect(textOnly).toBe(true);
    expect(chips(container)).toHaveLength(1);
  });

  /** Route 3 of 3 — the drop, and the highlight that says where to aim. */
  it("lights the popover while a file is over it, across its own children", () => {
    const { container } = mount();
    const surface = pop(container);
    fireEvent.dragEnter(surface);
    expect(surface.className).toContain("dropping");

    // `dragleave` fires on the way *into* a child, so a boolean would strobe.
    fireEvent.dragEnter(screen.getByText("“Call the plumber”"));
    fireEvent.dragLeave(surface);
    expect(surface.className).toContain("dropping");

    fireEvent.dragLeave(screen.getByText("“Call the plumber”"));
    expect(surface.className).not.toContain("dropping");
  });

  it("sends what was dropped on it, and clears the highlight", async () => {
    const { container, uploads, onCreated } = mount();
    const surface = pop(container);
    fireEvent.dragEnter(surface);
    fireEvent.drop(surface, { dataTransfer: { files: [pdf()] } });

    expect(surface.className).not.toContain("dropping");
    expect(chips(container)).toHaveLength(1);

    fireEvent.change(input(), { target: { value: "the quote is on page 4" } });
    fireEvent.click(send());
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(TARGET, "th_new1");
    });
    // The whole point: the file reached the wire, on the multipart branch, with
    // the ordinary §6 anchor beside it.
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.files).toEqual([{ name: "policy.pdf", type: "application/pdf" }]);
    expect(uploads[0]?.fields["parent"]).toBe("doc_week");
    expect(uploads[0]?.fields["text"]).toBe("the quote is on page 4");
    expect(JSON.parse(uploads[0]?.fields["selector"] ?? "null")).toEqual(SELECTOR);
    expect(uploads[0]?.fields["requestsAgent"]).toBe("true");
  });

  /** SPEC.md §6: a comment may be a file and no words at all. */
  it("sends a comment that is only a file", async () => {
    const { uploads, onCreated } = mount();
    expect(send().disabled).toBe(true);
    fireEvent.change(picker(), { target: { files: [png()] } });
    expect(send().disabled).toBe(false);

    fireEvent.click(send());
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(TARGET, "th_new1");
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.files).toEqual([{ name: "shot.png", type: "image/png" }]);
    // No empty first turn: `text` is omitted rather than sent as "" — the route
    // takes a turn with files and no words, not one with an empty body.
    expect(Object.keys(uploads[0]?.fields ?? {})).not.toContain("text");
  });

  it("takes a chip back off, and frees the preview it was showing", () => {
    const { container } = mount();
    fireEvent.change(picker(), { target: { files: [png(), png("second.png")] } });
    expect(chips(container)).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Remove second.png"));
    expect(chips(container)).toHaveLength(1);
    expect(revoked).toEqual(["blob:todo-preview-2"]);
  });

  /**
   * The load-bearing half of UI-111: *"a comment that loses its screenshot
   * because the post failed is worse than one that could never take it"*.
   *
   * This composer clears nothing until the thread exists, so the chips stay put
   * where the words already stayed — and the proof is not that they are still
   * on screen but that pressing send again puts the same file back on the wire.
   * Their previews are still live too: a restored chip showing a broken image
   * would be the same loss one step later.
   */
  it("keeps the words and the files through a refusal, and sends them again", async () => {
    const { container, uploads } = mount({
      status: 404,
      body: { code: "not_found", message: "no document doc_week" },
    });
    fireEvent.change(picker(), { target: { files: [png()] } });
    fireEvent.change(input(), { target: { value: "which plumber was it?" } });
    fireEvent.click(send());

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Comment failed");
    });
    expect(input().value).toBe("which plumber was it?");
    expect(chips(container)).toHaveLength(1);
    expect(chips(container)[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "blob:todo-preview-1",
    );
    expect(revoked).toEqual([]);

    fireEvent.click(send());
    await waitFor(() => {
      expect(uploads).toHaveLength(2);
    });
    expect(uploads[1]?.files).toEqual([{ name: "shot.png", type: "image/png" }]);
  });

  /**
   * The over-cap refusal, in the shape the server actually sends it
   * (`apps/server/src/attachments/limits.ts`): a `413` whose body is the
   * ordinary validation envelope naming the file and the cap. Reported the same
   * way every other surface reports it — the server's own sentence, in the
   * composer, with nothing thrown away.
   */
  it("reports an over-cap file visibly, and keeps it to be dealt with", async () => {
    const { container } = mount({
      status: 413,
      body: {
        code: "bad_request",
        message:
          "attachment shot.png is 27262976 bytes, over the per-file limit of 26214400 bytes (25 MB)",
        issues: [],
      },
    });
    fireEvent.change(picker(), { target: { files: [png()] } });
    fireEvent.click(send());

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("over the per-file limit");
    });
    expect(screen.getByRole("alert").textContent).toContain("shot.png");
    expect(chips(container)).toHaveLength(1);
  });

  /**
   * Nothing here calls the kit's `take()`/`restore()`, so the previews are
   * still the intake's own when this popover goes — which is the moment
   * `onCreated` closes it. If that ever stops being true, the composer starts
   * leaking an object URL per attachment per comment.
   */
  it("frees its previews when it closes", () => {
    const { unmount } = mount();
    fireEvent.change(picker(), { target: { files: [png(), png("second.png")] } });
    expect(created).toHaveLength(2);
    expect(revoked).toEqual([]);
    unmount();
    expect(revoked).toEqual(created);
  });
});

describe("quotePreview", () => {
  it("flattens whitespace and stops a long quote from becoming the popover", () => {
    expect(quotePreview("  Call   the\nplumber ")).toBe("Call the plumber");
    expect(quotePreview("abcdefghij", 5)).toBe("abcd…");
  });
});
