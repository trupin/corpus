/** @vitest-environment jsdom */
import type { Doc } from "@corpus/contract";
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
import { docFixture, readerTransport, type ReaderTransport } from "../testing/readerFixture";
import {
  changedFields,
  FrontmatterForm,
  isDeliberate,
  statusLock,
  tagsToText,
  textToTags,
} from "./FrontmatterForm";

afterEach(() => {
  cleanup();
  // The registry is module state, and an unmount from any test in this file
  // releases a surface into it (UI-044).
  resetEditSessionFlush();
  vi.useRealTimers();
});

const DOC = docFixture({
  frontmatter: {
    id: "doc_m",
    title: "Mortgage options",
    tags: ["finance"],
    status: "open",
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
}

function mount(
  options: { wire?: ReaderTransport; doc?: Doc; selectTitle?: boolean } = {},
): Mounted {
  const doc = options.doc ?? DOC;
  const wire = options.wire ?? readerTransport({ docs: [doc] });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const notices: string[] = [];
  const view = render(
    <FrontmatterForm
      doc={doc}
      selectTitle={options.selectTitle ?? false}
      onNotify={(notice) => notices.push(`${notice.tone}:${notice.message}`)}
    />,
    { wrapper: harness.Wrapper },
  );
  return { wire, harness, notices, unmount: view.unmount };
}

const title = (): HTMLTextAreaElement =>
  screen.getByLabelText<HTMLTextAreaElement>("Document title");
const tags = (): HTMLInputElement =>
  screen.getByPlaceholderText<HTMLInputElement>("comma, separated");
const status = (): HTMLSelectElement =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: /status/ });
const due = (): HTMLInputElement =>
  document.querySelector("input[type='date']") as HTMLInputElement;
const chip = (): HTMLElement =>
  document.querySelector("[data-save-chip='frontmatter']") as HTMLElement;

describe("tags round-trip", () => {
  it("renders and parses the comma form", () => {
    expect(tagsToText(["finance", "mortgage"])).toBe("finance, mortgage");
    expect(textToTags(" finance ,  mortgage , ")).toEqual(["finance", "mortgage"]);
    expect(textToTags("")).toEqual([]);
  });
});

/**
 * UI-093's one decision about *when*, and it is per change rather than per
 * control. A select produces one chosen value; a text field produces one per
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

describe("statusLock", () => {
  it("leaves an ordinary document's status the person's to set", () => {
    expect(statusLock(DOC)).toBeNull();
  });

  it("shows an archived status with the reason it is nobody's to set", () => {
    expect(statusLock(ARCHIVED)?.reason).toContain("Unarchive in the ⋯ menu");
  });
});

describe("changedFields", () => {
  it("carries only what changed", () => {
    expect(
      changedFields(DOC, {
        title: "Mortgage options",
        tags: "finance",
        status: "resolved",
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
        due: "",
      }),
    ).toEqual({ due: null });
  });

  it("refuses an empty title rather than writing one", () => {
    expect(changedFields(DOC, { title: "   ", tags: "finance", status: "open", due: "" })).toEqual(
      {},
    );
  });

  /**
   * UI-020. Both directions belong to routes this form does not call, and the
   * guard sits in `changedFields` rather than only on the `<select>` because
   * every path to the wire — a change, the debounce, the unmount flush, the
   * reader rebinding and `pagehide` — funnels through here.
   */
  describe("the archive boundary", () => {
    it("never unarchives, which SERVER-039 refuses with a 400 naming the route", () => {
      expect(
        changedFields(ARCHIVED, {
          title: ARCHIVED.frontmatter.title,
          tags: "finance",
          status: "open",
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
          due: "",
        }),
      ).toEqual({ title: "Renamed while archived" });
    });
  });
});

describe("the form has no mode", () => {
  it("renders every control with no click first", () => {
    mount();
    expect(title().value).toBe("Mortgage options");
    expect(tags().value).toBe("finance");
    expect(status().value).toBe("open");
    expect(due().value).toBe("");
  });

  it("offers no edit chip and no save button", () => {
    mount();
    const chips = [...document.querySelectorAll(".fm-chips .chip")].map((each) => each.textContent);
    expect(chips).toEqual(["note", "finance/", "#finance", "open", "updated 2026-07-02"]);
    expect(screen.queryByRole("button", { name: "edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });

  /**
   * The chip is where the `edit` chip was — in the frontmatter's own strip and
   * pointedly not in the reader head, which is at its width limit (UI-135) and
   * already carries the body's.
   */
  it("carries its own save chip in the strip, reserved so it cannot resize", () => {
    mount();
    const element = chip();
    expect(element.closest(".fm-chips")).not.toBeNull();
    expect(element.closest(".reader-head")).toBeNull();
    expect(element.getAttribute("data-reserve")).not.toBe("");
    expect(element.textContent).toBe("");
  });
});

describe("when a change is sent", () => {
  it("issues the PUT the moment a status is picked", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(status(), { target: { value: "resolved" } });
    // No timer is advanced past zero: the request cannot be waiting on one.
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ status: "resolved" });
  });

  it("issues the PUT the moment a whole due date arrives", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(due(), { target: { value: "2026-10-01" } });
    await vi.advanceTimersByTimeAsync(0);

    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ due: "2026-10-01" });
  });

  /**
   * Chromium fires a change per segment of a date field, with `value === ""`
   * until every segment is filled — so "commit every date change" would clear a
   * stored deadline on the way to typing a new one.
   */
  it("holds an empty due date for the debounce, then clears the deadline", async () => {
    vi.useFakeTimers();
    const dated = docFixture({ frontmatter: { ...DOC.frontmatter, due: "2026-10-01" } });
    const { wire } = mount({ doc: dated });

    fireEvent.change(due(), { target: { value: "" } });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(wire.of("PUT")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);
    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ due: null });
  });

  it("sends nothing while a tag is being typed, and one request after", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(tags(), { target: { value: "finance, m" } });
    await vi.advanceTimersByTimeAsync(400);
    fireEvent.change(tags(), { target: { value: "finance, mortgage" } });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(wire.of("PUT")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);
    expect(wire.of("PUT")).toHaveLength(1);
    expect(wire.of("PUT")[0]?.body).toEqual({ tags: ["finance", "mortgage"] });
  });

  it("sends nothing while a title is being typed, and one request after", async () => {
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
  it("carries three fields in one request when they change together", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(title(), { target: { value: "Mortgage options 2026" } });
    fireEvent.change(tags(), { target: { value: "finance, mortgage" } });
    // The deliberate one sends what is outstanding rather than only its own
    // field: the request is one patch either way, and holding the other two back
    // would mean a second write a moment later for a sitting §4 squashes into
    // one commit regardless.
    fireEvent.change(status(), { target: { value: "resolved" } });
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

    fireEvent.change(due(), { target: { value: "2026-10-01" } });
    fireEvent.change(status(), { target: { value: "resolved" } });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(wire.of("PUT").map((call) => call.body)).toEqual([
      { due: "2026-10-01" },
      { status: "resolved" },
    ]);
  });

  it("keeps the last value when one field changes twice inside a window", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(tags(), { target: { value: "finance, m" } });
    fireEvent.change(tags(), { target: { value: "finance, tax" } });
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

    fireEvent.change(status(), { target: { value: "resolved" } });
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });

    fireEvent.change(tags(), { target: { value: "finance, tax" } });
    await waitFor(() => {
      expect(chip().textContent).toContain("saving");
    });
    // Still one: the second change is held, not raced.
    expect(wire.of("PUT")).toHaveLength(1);

    release();
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(2);
    });
    expect(wire.of("PUT")[1]?.body).toEqual({ tags: ["finance", "tax"] });
  });

  /** A delta write names what it changes, so it presents no key (SPEC.md §7). */
  it("writes with no key and no body on the request", async () => {
    vi.useFakeTimers();
    const { wire } = mount();

    fireEvent.change(status(), { target: { value: "resolved" } });
    await vi.advanceTimersByTimeAsync(0);

    const body = wire.of("PUT")[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("key");
    expect(body).not.toHaveProperty("body");
  });
});

describe("what a landed save does", () => {
  it("says so on the chip and publishes the server's document", async () => {
    const { wire, harness } = mount();

    fireEvent.change(status(), { target: { value: "resolved" } });
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓");
    });
    expect(wire.of("PUT")).toHaveLength(1);
    /*
     * Read-your-write: the controls read the document, so a save that only
     * invalidated would leave every one of them showing the value the person
     * just changed away from until a refetch landed.
     */
    const published = harness.queryClient.getQueryData<Doc>(docKey("doc_m"));
    expect(published?.frontmatter.status).toBe("resolved");
  });

  it("stops holding a value the document now carries", async () => {
    const { wire } = mount();

    fireEvent.change(status(), { target: { value: "resolved" } });
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓");
    });
    // The prop is still the pre-save document: a form that had kept the value
    // locally would render `resolved`, and one that follows the document renders
    // what it was handed. That is the point — the value lives in one place.
    expect(status().value).toBe("open");
    expect(wire.of("PUT")).toHaveLength(1);
  });
});

describe("what a failed save does", () => {
  it("says so, keeps every typed value, and retries the whole patch", async () => {
    const wire = readerTransport({ docs: [DOC], failing: { "PUT /api/docs/doc_m": 500 } });
    const { notices } = mount({ wire });

    fireEvent.change(tags(), { target: { value: "finance, tax" } });
    fireEvent.change(status(), { target: { value: "resolved" } });

    await waitFor(() => {
      expect(chip().textContent).toContain("save failed");
    });
    // Nothing was discarded: both controls still show what the person set.
    expect(tags().value).toBe("finance, tax");
    expect(status().value).toBe("resolved");
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
});

describe("archiving is the ⋯ menu's, not this form's", () => {
  it("shows an archived status, disabled, and says where the way out is", () => {
    mount({ doc: ARCHIVED });
    expect(status().value).toBe("archived");
    expect(status().disabled).toBe(true);
    expect(screen.getByText(/Unarchive in the ⋯ menu/)).toBeDefined();
  });

  it("offers no archived destination on a live document", () => {
    mount();
    expect([...status().options].map((option) => option.value)).toEqual(["open", "resolved"]);
    expect(status().disabled).toBe(false);
  });

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

  it("leaves every other control live on an archived document", () => {
    mount({ doc: ARCHIVED });
    expect(title().readOnly).toBe(false);
    expect(tags().disabled).toBe(false);
    expect(due().disabled).toBe(false);
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
   * SPEC.md §11's "empty document does not survive leaving it": a cleared title
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
    fireEvent.change(status(), { target: { value: "resolved" } });

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

    fireEvent.change(status(), { target: { value: "resolved" } });
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

    fireEvent.change(status(), { target: { value: "resolved" } });
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });

    unmount();
    vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS * 4);
    expect(flushEditSession).not.toHaveBeenCalled();
  });
});
