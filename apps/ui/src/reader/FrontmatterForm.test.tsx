/** @vitest-environment jsdom */
import type { Doc, DocStatus } from "@corpus/contract";
import { docKey, type CorpusClient } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDIT_SESSION_SETTLE_MS,
  resetEditSessionFlush,
  setEditSessionClient,
} from "../editor/editSessionFlush";
import { AUTOSAVE_DEBOUNCE_MS } from "../editor/useAutosave";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import { docFixture, readerTransport, type ReaderTransport } from "../testing/readerFixture";
import { resetEscapeLayers } from "./useEscapeStack";
import {
  changedFields,
  FrontmatterForm,
  isDeliberate,
  normalizedTags,
  tagsToText,
  textToTags,
} from "./FrontmatterForm";

/**
 * The chip strip as the frontmatter editor (SPEC.md §10, rider signed
 * 2026-08-23, UI-162): every chip that names an editable field is the control
 * for that field, the labelled form is gone, and the write model — one patch,
 * one write, `isDeliberate` deciding when — is exactly what it was.
 */

afterEach(() => {
  cleanup();
  // The registry is module state, and an unmount from any test in this file
  // releases a surface into it (UI-044). The escape layers are the menus'.
  resetEditSessionFlush();
  resetEscapeLayers();
  vi.useRealTimers();
});

const DOC = docFixture({
  frontmatter: {
    id: "doc_m",
    title: "Mortgage options",
    tags: ["finance"],
    status: "open",
    stage: null,
    due: null,
    updated: "2026-07-02T09:00:00.000Z",
  },
});

/** The same document after `POST …/archive` — status flipped, id unchanged. */
const ARCHIVED = docFixture({
  frontmatter: { ...DOC.frontmatter, status: "archived" },
});

interface Mounted {
  readonly wire: ReaderTransport;
  readonly harness: ReturnType<typeof createCorpusTestHarness>;
  readonly notices: string[];
  readonly unmount: () => void;
  /** The same mounted form, handed a newer document — what an SSE refetch does. */
  readonly rerender: (doc: Doc) => void;
}

function mount(
  options: { wire?: ReaderTransport; doc?: Doc; selectTitle?: boolean } = {},
): Mounted {
  const doc = options.doc ?? DOC;
  const wire = options.wire ?? readerTransport({ docs: [doc] });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const notices: string[] = [];
  const form = (shown: Doc) => (
    // The provider is the app's own menu host (`Shell` mounts it above every
    // reader): the chips open their menus through it, so the tests do too.
    <ContextMenuProvider>
      <FrontmatterForm
        doc={shown}
        selectTitle={options.selectTitle ?? false}
        onNotify={(notice) => notices.push(`${notice.tone}:${notice.message}`)}
      />
    </ContextMenuProvider>
  );
  const view = render(form(doc), { wrapper: harness.Wrapper });
  return {
    wire,
    harness,
    notices,
    unmount: view.unmount,
    rerender: (next) => {
      view.rerender(form(next));
    },
  };
}

const title = (): HTMLTextAreaElement =>
  screen.getByLabelText<HTMLTextAreaElement>("Document title");
const chip = (): HTMLElement =>
  document.querySelector("[data-save-chip='frontmatter']") as HTMLElement;

const statusChip = (): HTMLButtonElement =>
  document.querySelector("[data-chip='status']") as HTMLButtonElement;
const dueChip = (): HTMLButtonElement =>
  document.querySelector("[data-chip='due']") as HTMLButtonElement;
const addChip = (): HTMLButtonElement =>
  document.querySelector("[data-chip='add-tag']") as HTMLButtonElement;
const tagChip = (tag: string): HTMLButtonElement =>
  document.querySelector(`[data-chip='tag'][data-tag='${tag}']`) as HTMLButtonElement;

const menu = (): HTMLElement | null => document.querySelector("[data-ctx-menu]");
const menuItem = (act: string): HTMLButtonElement =>
  document.querySelector(`[data-ctx-menu] [data-act='${act}']`) as HTMLButtonElement;

/** One chosen status, the way a person chooses it: chip, then menu. */
function pickStatus(word: string): void {
  fireEvent.click(statusChip());
  fireEvent.click(menuItem(`status:${word}`));
}

/** The tag rename input a chip swaps for, or the `+` chip's empty one. */
const tagInput = (): HTMLInputElement =>
  document.querySelector(".fm-chip-input:not([type='date'])") as HTMLInputElement;

/** The due chip, opened: the date field itself. */
function openDue(): HTMLInputElement {
  fireEvent.click(dueChip());
  return document.querySelector("input[type='date']") as HTMLInputElement;
}

describe("tags round-trip", () => {
  it("renders and parses the comma form", () => {
    expect(tagsToText(["finance", "mortgage"])).toBe("finance, mortgage");
    expect(textToTags(" finance ,  mortgage , ")).toEqual(["finance", "mortgage"]);
    expect(textToTags("")).toEqual([]);
  });

  it("collapses duplicates and drops empties, first occurrence winning", () => {
    expect(normalizedTags(["finance", " finance ", "", "tax"])).toEqual(["finance", "tax"]);
  });
});

/**
 * UI-093's one decision about *when*, and it is per change rather than per
 * control. A menu produces one chosen value; a text field produces one per
 * keystroke; a date input produces both — an empty string while its segments
 * are half-filled, and a whole date when they are not.
 */
describe("isDeliberate", () => {
  it("commits a status the moment it is picked", () => {
    expect(isDeliberate("status", "resolved")).toBe(true);
  });

  it("waits out the debounce for free text", () => {
    expect(isDeliberate("title", "Mort")).toBe(false);
    expect(isDeliberate("tags", "fin")).toBe(false);
  });

  it("commits a whole date, and waits on an empty one", () => {
    expect(isDeliberate("due", "2026-10-01")).toBe(true);
    // Half a typed date and a cleared field are the same value arriving, and
    // committing the first would clear a deadline on the way to setting one.
    expect(isDeliberate("due", "")).toBe(false);
  });
});

describe("changedFields", () => {
  it("carries only what changed", () => {
    expect(
      changedFields(DOC, {
        title: "Mortgage options",
        tags: "finance",
        status: "resolved",
        stage: "",
        due: "",
      }),
    ).toEqual({ status: "resolved" });
  });

  it("clears a due date with null, which omission cannot express", () => {
    const withDue = docFixture({
      frontmatter: { ...DOC.frontmatter, due: "2026-10-01" },
    });
    expect(
      changedFields(withDue, {
        title: withDue.frontmatter.title,
        tags: "finance",
        status: "open",
        stage: "",
        due: "",
      }),
    ).toEqual({ due: null });
  });

  it("refuses an empty title rather than writing one", () => {
    expect(
      changedFields(DOC, { title: "   ", tags: "finance", status: "open", stage: "", due: "" }),
    ).toEqual({});
  });

  /**
   * UI-020. Both directions belong to routes this form does not call, and the
   * guard sits in `changedFields` rather than only on the menu because every
   * path to the wire — a change, the debounce, the unmount flush, the reader
   * rebinding and `pagehide` — funnels through here.
   */
  describe("the archive boundary", () => {
    it("never unarchives, which SERVER-039 refuses with a 400 naming the route", () => {
      expect(
        changedFields(ARCHIVED, {
          title: ARCHIVED.frontmatter.title,
          tags: "finance",
          status: "open",
          stage: "",
          due: "",
        }),
      ).toEqual({});
    });

    it("never archives, because a status flip does not move a skill's folder", () => {
      expect(
        changedFields(DOC, {
          title: DOC.frontmatter.title,
          tags: "finance",
          status: "archived",
          stage: "",
          due: "",
        }),
      ).toEqual({});
    });

    it("still carries everything else on an archived document", () => {
      expect(
        changedFields(ARCHIVED, {
          title: "Renamed while archived",
          tags: "finance",
          status: "open",
          stage: "",
          due: "",
        }),
      ).toEqual({ title: "Renamed while archived" });
    });
  });

  describe("a document whose type nothing recognises", () => {
    const draft = {
      title: "Inbox chores",
      tags: "finance",
      status: "resolved" as const,
      stage: "",
      due: "2030-01-01",
    };
    const TODO = docFixture({
      frontmatter: { ...DOC.frontmatter, title: "Inbox chores", type: "todo" },
    });

    it("sends its status and its due like any other document", () => {
      expect(changedFields(TODO, draft)).toEqual({ status: "resolved", due: "2030-01-01" });
    });

    it("is treated no differently from a note", () => {
      expect(changedFields(TODO, draft)).toEqual(
        changedFields(DOC, { ...draft, title: "Mortgage options" }),
      );
    });
  });
});

describe("the strip is the editor", () => {
  it("renders every editable value on a chip that is its control", () => {
    mount();
    expect(title().value).toBe("Mortgage options");
    expect(tagChip("finance").tagName).toBe("BUTTON");
    expect(statusChip().textContent).toBe("status: open");
    // With no due date the chip reads as unset rather than disappearing, so
    // the field stays reachable.
    expect(dueChip().textContent).toBe("due: —");
    expect(addChip().tagName).toBe("BUTTON");
  });

  /**
   * The rider's own sentence: no value in the reader is displayed in one place
   * and edited in another. The `.fm-form` grid — `TAGS` / `STATUS` / `DUE` —
   * is gone, and nothing labelled stands beside the strip.
   */
  it("draws no second copy of the values below the strip", () => {
    mount();
    expect(document.querySelector(".fm-form")).toBeNull();
    expect(document.querySelector(".fm-field")).toBeNull();
    expect(document.querySelector(".fm-input")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("keeps type, folder and updated as read-only chips", () => {
    mount();
    const readOnly = [...document.querySelectorAll(".fm-chips > span.chip")].map(
      (each) => each.textContent,
    );
    expect(readOnly).toContain("note");
    expect(readOnly).toContain("finance/");
    expect(readOnly).toContain("updated 2026-07-02");
  });

  /** The `+` sits at the end of the tags, not at the end of the strip. */
  it("keeps the + beside the tags it adds to", () => {
    mount();
    const strip = document.querySelector(".fm-chips");
    const children = [...(strip?.children ?? [])];
    const lastTag = children.findIndex((each) => each.getAttribute("data-chip") === "tag");
    expect(children[lastTag + 1]?.getAttribute("data-chip")).toBe("add-tag");
    const status = children.findIndex((each) => each.getAttribute("data-chip") === "status");
    expect(status).toBeGreaterThan(lastTag + 1);
  });

  /**
   * The chip is where the `edit` chip was — in the frontmatter's own strip and
   * pointedly not in the reader head, which is at its width limit (UI-135) and
   * already carries the body's.
   */
  it("still ends with its reserved save chip", () => {
    mount();
    const element = chip();
    expect(element.closest(".fm-chips")).not.toBeNull();
    expect(element.closest(".reader-head")).toBeNull();
    expect(element.getAttribute("data-reserve")).not.toBe("");
    expect(element.textContent).toBe("");
    // Last in the strip, in its reserved box.
    expect(document.querySelector(".fm-chips")?.lastElementChild).toBe(element);
  });
});

describe("the status chip", () => {
  it("opens the vocabulary, marks the current word, and writes on choice", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.click(statusChip());
    expect(menu()).not.toBeNull();
    expect(menuItem("status:open").textContent).toContain("✓ open");
    expect(menuItem("status:resolved").disabled).toBe(false);
    // §5's third word is offered and gated: archiving is a route, not a status
    // flip, and the item says so instead of writing.
    expect(menuItem("status:archived").disabled).toBe(true);
    expect(menuItem("status:archived").textContent).toContain("archive from the ⋯ menu");

    fireEvent.click(menuItem("status:resolved"));
    // No timer is advanced past zero: the request cannot be waiting on one.
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ status: "resolved" });
    // The choice closed the menu.
    expect(menu()).toBeNull();
  });

  it("closes on Escape without writing", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.click(statusChip());
    expect(menu()).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu()).toBeNull();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(wire.of("PUT")).toHaveLength(0);
  });

  /**
   * `statusLock`: the chip still shows the status, and the menu says why
   * instead of writing — the reason is the predicate's own sentence.
   */
  it("says why an archived document's status is not the reader's to set", async () => {
    vi.useFakeTimers();
    const { wire } = mount({ doc: ARCHIVED });

    expect(statusChip().textContent).toBe("status: archived");
    fireEvent.click(statusChip());
    expect(screen.getByText(/Unarchive in the ⋯ menu/)).toBeDefined();
    // §5's ladder is still offered — marked at the word the document holds —
    // and none of it writes: unarchiving returns a document to `resolved` on
    // its own route, so the menu must not silently write `open`.
    expect(menuItem("status:archived").textContent).toContain("✓ archived");
    expect(menuItem("status:open").disabled).toBe(true);
    expect(menuItem("status:resolved").disabled).toBe(true);

    fireEvent.click(menuItem("status:open"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(wire.of("PUT")).toHaveLength(0);
  });
});

describe("the tag chips", () => {
  it("removes a tag from its menu, in one immediate write", async () => {
    vi.useFakeTimers();
    const doc = docFixture({ frontmatter: { ...DOC.frontmatter, tags: ["finance", "tax"] } });
    const { wire } = mount({ doc });

    fireEvent.click(tagChip("tax"));
    fireEvent.click(menuItem("remove-tag"));
    // A menu choice is a deliberate change: it sends at once.
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ tags: ["finance"] });
  });

  it("renames a tag in place, debounced like the text field it replaces", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.click(tagChip("finance"));
    fireEvent.click(menuItem("rename-tag"));
    const input = tagInput();
    expect(input.value).toBe("finance");
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "fin" } });
    await vi.advanceTimersByTimeAsync(400);
    fireEvent.change(input, { target: { value: "finances" } });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(wire.of("PUT")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);
    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ tags: ["finances"] });
  });

  it("collapses a rename onto an existing tag rather than writing a duplicate", async () => {
    vi.useFakeTimers();
    const doc = docFixture({ frontmatter: { ...DOC.frontmatter, tags: ["finance", "tax"] } });
    const { wire } = mount({ doc });

    fireEvent.click(tagChip("tax"));
    fireEvent.click(menuItem("rename-tag"));
    fireEvent.change(tagInput(), { target: { value: "finance" } });
    fireEvent.keyDown(tagInput(), { key: "Enter" });
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ tags: ["finance"] });
  });

  it("treats a rename to empty as the removal it is", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.click(tagChip("finance"));
    fireEvent.click(menuItem("rename-tag"));
    fireEvent.change(tagInput(), { target: { value: "" } });
    fireEvent.keyDown(tagInput(), { key: "Enter" });
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ tags: [] });
  });

  it("adds a tag from the + chip", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.click(addChip());
    const input = tagInput();
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "mortgage" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ tags: ["finance", "mortgage"] });
  });

  it("leaves the input on Escape, with the typed value still saving", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.click(addChip());
    fireEvent.change(tagInput(), { target: { value: "tax" } });
    fireEvent.keyDown(tagInput(), { key: "Escape" });
    // Escape leaves the field, exactly as it leaves the title: nothing is
    // reverted, and the debounce still lands the value.
    fireEvent.blur(tagInput() ?? document.body);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(wire.of("PUT")[0]?.body).toEqual({ tags: ["finance", "tax"] });
  });
});

describe("the due chip", () => {
  it("opens the date field in place, and a whole date sends at once", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    const input = openDue();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "2026-10-01" } });
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ due: "2026-10-01" });
  });

  it("shows the date it holds", () => {
    const dated = docFixture({ frontmatter: { ...DOC.frontmatter, due: "2026-10-01" } });
    mount({ doc: dated });
    expect(dueChip().textContent).toBe("due: 2026-10-01");
  });

  /**
   * Chromium fires a change per segment of a date field, with `value === ""`
   * until every segment is filled — so "commit every date change" would clear a
   * stored deadline on the way to typing a new one. Empty waits out the
   * debounce, which is also how the picker's Clear lands.
   */
  it("holds an empty due date for the debounce, then clears the deadline", async () => {
    vi.useFakeTimers();
    const dated = docFixture({ frontmatter: { ...DOC.frontmatter, due: "2026-10-01" } });
    const { wire } = mount({ doc: dated });

    const input = openDue();
    expect(input.value).toBe("2026-10-01");
    fireEvent.change(input, { target: { value: "" } });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(wire.of("PUT")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);
    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ due: null });
  });
});

describe("the title", () => {
  it("sends nothing while it is being typed, and one request after", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(title(), { target: { value: "Mortgage options 2026" } });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(wire.of("PUT")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);
    expect(wire.of("PUT")[0]?.body).toEqual({ title: "Mortgage options 2026" });
  });

  it("sends what is outstanding at once when Enter says now", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(title(), { target: { value: "Renamed" } });
    fireEvent.keyDown(title(), { key: "Enter" });
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ title: "Renamed" });
  });

  /** `↵` is send, so no newline can reach a field the mirror measures. */
  it("keeps the title one line by refusing the newline", () => {
    vi.useFakeTimers();
    mount();
    const event = fireEvent.keyDown(title(), { key: "Enter" });
    expect(event).toBe(false);
  });

  /**
   * Escape is not a revert — there is nothing left to revert to. It leaves the
   * field, exactly as it leaves the body, so the second press reaches the escape
   * chain (which ignores keys typed inside a field).
   */
  it("leaves the field on Escape without undoing anything", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    title().focus();
    fireEvent.change(title(), { target: { value: "Half a thought" } });
    fireEvent.keyDown(title(), { key: "Escape" });

    expect(document.activeElement).not.toBe(title());
    expect(title().value).toBe("Half a thought");

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(wire.of("PUT")[0]?.body).toEqual({ title: "Half a thought" });
  });
});

describe("one patch, one write", () => {
  /**
   * The falsification the issue asks for: two changes inside one debounce
   * window are one request carrying both — a test that asserted only "a
   * request was made" would pass with four.
   */
  it("carries three fields in one request when they change together", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(title(), { target: { value: "Mortgage options 2026" } });
    fireEvent.click(tagChip("finance"));
    fireEvent.click(menuItem("rename-tag"));
    fireEvent.change(tagInput(), { target: { value: "finance, mortgage" } });
    // The deliberate one sends what is outstanding rather than only its own
    // field: the request is one patch either way, and holding the other two back
    // would mean a second write a moment later for a sitting §4 squashes into
    // one commit regardless.
    pickStatus("resolved");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({
      title: "Mortgage options 2026",
      tags: ["finance", "mortgage"],
      status: "resolved",
    });
  });

  /**
   * Two deliberate changes back to back are two writes, in order, never two in
   * flight — and §4's open commit window is what makes them one commit. A
   * batching window here would be that rule written a second time.
   */
  it("orders two deliberate changes rather than racing them", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(openDue(), { target: { value: "2026-10-01" } });
    pickStatus("resolved");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(wire.of("PUT").map((call) => call.body)).toEqual([
      { due: "2026-10-01" },
      { status: "resolved" },
    ]);
  });

  it("keeps the last value when one field changes twice inside a window", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.click(tagChip("finance"));
    fireEvent.click(menuItem("rename-tag"));
    fireEvent.change(tagInput(), { target: { value: "finance, m" } });
    fireEvent.change(tagInput(), { target: { value: "finance, tax" } });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ tags: ["finance", "tax"] });
  });

  /**
   * A change made while a `PUT` is on the wire is queued, never sent beside it:
   * two writes for one document could land out of order and re-assert a value
   * the first one changed.
   */
  it("queues a change made while a request is in flight", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wire = readerTransport({ docs: [DOC], holdWrites: held });
    mount({ wire });

    pickStatus("resolved");
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });

    fireEvent.change(openDue(), { target: { value: "2026-12-24" } });
    await waitFor(() => {
      expect(chip().textContent).toContain("saving");
    });
    // Still one: the second change is held, not raced.
    expect(wire.of("PUT")).toHaveLength(1);

    release();
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(2);
    });
    expect(wire.of("PUT")[1]?.body).toEqual({ due: "2026-12-24" });
  });

  /** A delta write names what it changes, so it presents no key (SPEC.md §7). */
  it("writes with no key and no body on the request", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    pickStatus("resolved");
    await vi.advanceTimersByTimeAsync(0);

    const body = wire.of("PUT")[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("key");
    expect(body).not.toHaveProperty("body");
  });
});

describe("what a landed save does", () => {
  it("says so on the chip and publishes the server's document", async () => {
    const { wire, harness } = mount();

    pickStatus("resolved");
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓");
    });
    expect(wire.of("PUT")).toHaveLength(1);
    /*
     * Read-your-write: the chips read the document, so a save that only
     * invalidated would leave every one of them showing the value the person
     * just changed away from until a refetch landed.
     */
    const published = harness.queryClient.getQueryData<Doc>(docKey("doc_m"));
    expect(published?.frontmatter.status).toBe("resolved");
  });

  it("stops holding a value the document now carries", async () => {
    const { wire } = mount();

    pickStatus("resolved");
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓");
    });
    // The prop is still the pre-save document: a form that had kept the value
    // locally would render `resolved`, and one that follows the document renders
    // what it was handed. That is the point — the value lives in one place.
    expect(statusChip().textContent).toBe("status: open");
    expect(wire.of("PUT")).toHaveLength(1);
  });
});

describe("what a failed save does", () => {
  it("says so, keeps every typed value, and retries the whole patch", async () => {
    const wire = readerTransport({ docs: [DOC], failing: { "PUT /api/docs/doc_m": 500 } });
    const { notices } = mount({ wire });

    fireEvent.click(tagChip("finance"));
    fireEvent.click(menuItem("rename-tag"));
    fireEvent.change(tagInput(), { target: { value: "finance, tax" } });
    pickStatus("resolved");

    await waitFor(() => {
      expect(chip().textContent).toContain("save failed");
    });
    // Nothing was discarded: the chips still show what the person set — the
    // strip's values come from the same `valueOf(doc, local)` overlay.
    expect(tagChip("tax")).not.toBeNull();
    expect(statusChip().textContent).toBe("status: resolved");
    expect(notices[0]).toContain("error:Save failed");

    const retry = screen.getByRole("button", { name: /save failed/ });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(2);
    });
    expect(wire.of("PUT")[1]?.body).toEqual({ tags: ["finance", "tax"], status: "resolved" });
  });

  it("offers no retry control while nothing has failed", () => {
    mount();
    expect(screen.queryByRole("button", { name: /save failed/ })).toBeNull();
  });

  /**
   * **A refusal may not outlive its own request** (PR #55 re-review, finding 1).
   *
   * The wedge, measured against a real server before it was fixed: the status
   * control is live, the person picks `resolved`, the server answers `400`
   * naming `body.status`, and the refused value stays in the local map. From
   * then on **every** patch carries it and is refused too — a title typed
   * afterwards could not be saved until the page was reloaded.
   */
  describe("a field the server says is nobody's to set", () => {
    it("lets go of it, so the next save of another field lands", async () => {
      // The projection reports the document archived, which is the one refusal
      // a live control cannot see coming (SERVER-039).
      const wire = readerTransport({ docs: [DOC], failing: { "PUT /api/docs/doc_m": 400 } });
      mount({ wire });

      pickStatus("resolved");
      await waitFor(() => {
        expect(chip().textContent).toContain("save failed");
      });
      expect(wire.of("PUT")[0]?.body).toEqual({ status: "resolved" });
      // The chip shows the document again: a value the server will not take
      // is not an unsaved edit, and this form is not the place it survives.
      expect(statusChip().textContent).toBe("status: open");

      fireEvent.change(title(), { target: { value: "Renamed afterwards" } });
      fireEvent.keyDown(title(), { key: "Enter" });
      await waitFor(() => {
        expect(wire.of("PUT")).toHaveLength(2);
      });
      // The whole of the finding: the refused status is *not* riding along.
      expect(wire.of("PUT")[1]?.body).toEqual({ title: "Renamed afterwards" });
    });

    it("keeps a value the refusal did not name", async () => {
      // A `500`, a dropped connection, a refusal about some other field: the
      // moment was wrong, not the value, and dropping it would be the silent
      // discard this form refuses to make.
      const wire = readerTransport({ docs: [DOC], failing: { "PUT /api/docs/doc_m": 500 } });
      mount({ wire });

      pickStatus("resolved");
      await waitFor(() => {
        expect(chip().textContent).toContain("save failed");
      });
      expect(statusChip().textContent).toBe("status: resolved");
    });
  });
});

describe("archiving is the ⋯ menu's, not this form's", () => {
  it("flushes on the way out without ever carrying status", async () => {
    const { wire, unmount } = mount({ doc: ARCHIVED });
    fireEvent.change(title(), { target: { value: "Renamed while archived" } });

    unmount();

    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    });
    expect(wire.of("PUT")[0]?.body).toEqual({ title: "Renamed while archived" });
    expect(Object.keys(wire.of("PUT")[0]?.body as object)).not.toContain("status");
  });

  it("leaves every other control live on an archived document", async () => {
    vi.useFakeTimers();
    const { wire } = mount({ doc: ARCHIVED });
    expect(title().readOnly).toBe(false);
    // The tag menu still removes, and the due chip still opens: the lock is
    // the status's alone.
    fireEvent.click(tagChip("finance"));
    fireEvent.click(menuItem("remove-tag"));
    await vi.advanceTimersByTimeAsync(0);
    expect(wire.of("PUT")[0]?.body).toEqual({ tags: [] });
    expect(openDue().disabled).toBe(false);
  });
});

describe("leaving the document", () => {
  it("flushes a value that is still inside its debounce window", async () => {
    vi.useFakeTimers();
    const { wire, unmount } = mount();

    fireEvent.change(title(), { target: { value: "Typed and left" } });
    await vi.advanceTimersByTimeAsync(100);
    expect(wire.of("PUT")).toHaveLength(0);

    unmount();
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ title: "Typed and left" });
  });

  it("writes nothing when nothing was touched", async () => {
    vi.useFakeTimers();
    const { wire, unmount } = mount();

    unmount();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(wire.of("PUT")).toHaveLength(0);
  });

  /**
   * SPEC.md §10's "empty document does not survive leaving it": a cleared title
   * is never written, and the abandon rule is what removes the document. The
   * control keeps showing the emptiness the person typed rather than
   * repopulating itself from disk.
   */
  it("never writes an empty title, and keeps showing the empty field", async () => {
    vi.useFakeTimers();
    const { wire, unmount } = mount();

    fireEvent.change(title(), { target: { value: "" } });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(title().value).toBe("");
    expect(wire.of("PUT")).toHaveLength(0);

    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(wire.of("PUT")).toHaveLength(0);
  });

  it("does not lose a cleared title when another field saves beside it", async () => {
    const { wire } = mount();

    fireEvent.change(title(), { target: { value: "" } });
    pickStatus("resolved");

    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });
    expect(wire.of("PUT")[0]?.body).toEqual({ status: "resolved" });
    // The landed request carried no title, so the emptiness the abandon rule is
    // judging is still on screen.
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓");
    });
    expect(title().value).toBe("");
  });
});

describe("the just-created document", () => {
  it("selects its title", () => {
    mount({ selectTitle: true });
    expect(document.activeElement).toBe(title());
    expect(title().selectionStart).toBe(0);
    expect(title().selectionEnd).toBe(title().value.length);
  });
});

/**
 * SPEC.md §4's close path (UI-044). A title write opens an edit session exactly
 * as a body write does, and on a thread or a view this form is the document's
 * only editing surface — so it has to both mark the session and hold it open
 * while the reader is still showing the document.
 */
describe("the document's edit session", () => {
  function flusher(): ReturnType<typeof vi.fn> {
    const flushEditSession = vi.fn(async () => Promise.resolve());
    setEditSessionClient({ flushEditSession } as unknown as CorpusClient);
    return flushEditSession;
  }

  it("holds the session open while the form is mounted, and ends it when it goes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const flushEditSession = flusher();
    const { wire, unmount } = mount();

    pickStatus("resolved");
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });

    // The reader is still open on the document: the acknowledgment waits.
    vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS * 4);
    expect(flushEditSession).not.toHaveBeenCalled();

    unmount();
    vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS + 1);
    expect(flushEditSession.mock.calls).toEqual([["doc_m"]]);
  });

  it("opens no session for a form that was only looked at", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const flushEditSession = flusher();
    const { unmount } = mount();

    unmount();
    vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS * 4);

    expect(flushEditSession).not.toHaveBeenCalled();
  });

  it("opens no session when the server refuses the write", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const flushEditSession = flusher();
    const wire = readerTransport({ docs: [DOC], failing: { "PUT /api/docs/doc_m": 500 } });
    const { unmount } = mount({ wire });

    pickStatus("resolved");
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });

    unmount();
    vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS * 4);
    expect(flushEditSession).not.toHaveBeenCalled();
  });
});

/**
 * **Every field on a document whose type nothing recognises is that person's**
 * — SPEC.md §12's M6 at the frontmatter strip.
 *
 * Nothing computes a `status` or a `due` from a document's content, so no
 * chip is ever replaced by a statement of a value and no write path is gated
 * on one. What is pinned here is that seen from the outside: a `type: todo`
 * document — an unrecognised type real workspaces already hold — gets the same
 * live chips a note gets, and its edits reach the wire.
 */
describe("a document whose type nothing recognises", () => {
  const todo = (overrides: { status?: DocStatus } = {}): Doc =>
    docFixture({
      body: "- [ ] call the plumber (due: 2026-08-04)\n",
      path: "data/docs/inbox/week.md",
      frontmatter: {
        id: "doc_m",
        type: "todo",
        title: "Week of Jul 20",
        status: overrides.status ?? "open",
        due: "2026-08-04",
      },
    });

  it("renders live chips, with no statement standing in for one", () => {
    mount({ doc: todo() });

    expect(statusChip().disabled).toBe(false);
    expect(statusChip().textContent).toBe("status: open");
    expect(dueChip().disabled).toBe(false);
    expect(dueChip().textContent).toBe("due: 2026-08-04");
  });

  it("writes a status it is given, through the ordinary route", async () => {
    const { wire } = mount({ doc: todo() });

    pickStatus("resolved");
    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    });
    expect(wire.of("PUT")[0]?.body).toEqual({ status: "resolved" });
  });

  it("writes a deadline it is given, which the server no longer converges away", async () => {
    const { wire } = mount({ doc: todo() });

    fireEvent.change(openDue(), { target: { value: "2026-12-24" } });
    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    });
    expect(wire.of("PUT")[0]?.body).toEqual({ due: "2026-12-24" });
  });

  /**
   * The one lock there is: archiving is a status set on another route (UI-020,
   * SERVER-039), so the vocabulary is shown and gated with the way out named.
   * It applies by **status**, never by type.
   */
  it("locks its status only for being archived, and says where the act lives", () => {
    mount({ doc: todo({ status: "archived" }) });

    expect(statusChip().textContent).toBe("status: archived");
    fireEvent.click(statusChip());
    expect(screen.getByText(/Unarchive in the ⋯ menu/)).toBeDefined();
    expect(menuItem("status:open").disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    // And `due` is not swept up in it — there is no act on `due` on any route.
    expect(openDue().disabled).toBe(false);
  });
});
