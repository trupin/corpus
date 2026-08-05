/** @vitest-environment jsdom */
import type { CorpusClient } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDIT_SESSION_SETTLE_MS,
  resetEditSessionFlush,
  setEditSessionClient,
} from "../editor/editSessionFlush";
import { docFixture, readerTransport, type ReaderTransport } from "../testing/readerFixture";
import { changedFields, FrontmatterForm, tagsToText, textToTags } from "./FrontmatterForm";

afterEach(() => {
  cleanup();
  // The registry is module state, and an unmount from any test in this file
  // releases a surface into it (UI-044).
  resetEditSessionFlush();
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

function mount(options: { locked?: boolean; wire?: ReaderTransport; doc?: typeof DOC } = {}): {
  wire: ReaderTransport;
  unmount: () => void;
} {
  const doc = options.doc ?? DOC;
  const wire = options.wire ?? readerTransport({ docs: [doc] });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const view = render(
    <FrontmatterForm
      doc={doc}
      selectTitle={false}
      locked={options.locked ?? false}
      onNotify={() => undefined}
    />,
    { wrapper: harness.Wrapper },
  );
  return { wire, unmount: view.unmount };
}

describe("tags round-trip", () => {
  it("renders and parses the comma form", () => {
    expect(tagsToText(["finance", "mortgage"])).toBe("finance, mortgage");
    expect(textToTags(" finance ,  mortgage , ")).toEqual(["finance", "mortgage"]);
    expect(textToTags("")).toEqual([]);
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
   * every path to the wire — Save, Enter, the unmount flush, the reader
   * rebinding and `pagehide` — funnels through here.
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

describe("FrontmatterForm", () => {
  it("renders the frontmatter as the prototype's chip strip", () => {
    mount();
    const chips = [...document.querySelectorAll(".fm-chips .chip")].map((chip) => chip.textContent);
    expect(chips).toEqual(["note", "finance/", "#finance", "open", "updated 2026-07-02", "edit"]);
  });

  it("issues one PUT carrying only the changed fields", async () => {
    const { wire } = mount();
    fireEvent.click(screen.getByRole("button", { name: "edit" }));

    fireEvent.change(screen.getByLabelText("Document title"), {
      target: { value: "Mortgage options 2026" },
    });
    fireEvent.change(screen.getByDisplayValue("finance"), {
      target: { value: "finance, mortgage" },
    });
    fireEvent.change(screen.getByDisplayValue("open"), { target: { value: "resolved" } });
    fireEvent.change(document.querySelector("input[type='date']") as HTMLInputElement, {
      target: { value: "2026-10-01" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    });
    expect(wire.of("PUT")[0]?.body).toEqual({
      title: "Mortgage options 2026",
      tags: ["finance", "mortgage"],
      status: "resolved",
      due: "2026-10-01",
    });
  });

  it("saves from the title field alone, with Enter", async () => {
    const { wire } = mount();
    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.keyDown(title, { key: "Enter" });

    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });
    expect(wire.of("PUT")[0]?.body).toEqual({ title: "Renamed" });
  });

  it("reverts the draft on Escape, and writes nothing", () => {
    const { wire } = mount();
    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Half a thought" } });
    expect(screen.getByText("unsaved changes")).toBeDefined();

    fireEvent.keyDown(title, { key: "Escape" });
    expect((title as HTMLTextAreaElement).value).toBe("Mortgage options");
    expect(wire.of("PUT")).toHaveLength(0);
  });

  it("reverts on demand", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: "Nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.queryByText("unsaved changes")).toBeNull();
  });

  /** SPEC.md §7: a locked document renders read-only. */
  it("freezes every control while the document is locked", () => {
    mount({ locked: true });
    expect(screen.getByLabelText("Document title")).toHaveProperty("readOnly", true);
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByDisplayValue("finance")).toHaveProperty("disabled", true);
    expect(screen.getByDisplayValue("open")).toHaveProperty("disabled", true);
  });

  /**
   * The lock landing mid-edit is the case that must not silently discard typed
   * text: the draft is kept, Save is blocked, and the user is told why.
   */
  it("keeps a mid-edit draft when the lock lands, and warns instead of discarding it", () => {
    const wire = readerTransport({ docs: [DOC] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const view = render(
      <FrontmatterForm doc={DOC} selectTitle={false} locked={false} onNotify={() => undefined} />,
      { wrapper: harness.Wrapper },
    );
    fireEvent.change(screen.getByLabelText("Document title"), { target: { value: "Typed" } });

    view.rerender(
      <FrontmatterForm doc={DOC} selectTitle={false} locked onNotify={() => undefined} />,
    );

    expect(screen.getByLabelText("Document title")).toHaveProperty("value", "Typed");
    expect(screen.getByText(/the document was locked while you were editing/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });

  /**
   * UI-020, TEST-619 and TEST-620. The refusal SERVER-039 ships is the
   * enforcement; this is the better error in front of it — and the flush leg is
   * the one that gets missed, because guarding the Save button alone ships a
   * `400` the user cannot connect to anything they did.
   */
  describe("archiving is the ⋯ menu's, not this form's", () => {
    it("disables the status control on an archived document and says where the way out is", () => {
      mount({ doc: ARCHIVED });
      fireEvent.click(screen.getByRole("button", { name: "edit" }));
      const status = screen.getByDisplayValue("archived");
      expect(status).toHaveProperty("disabled", true);
      expect(screen.getByText(/Unarchive in the ⋯ menu/)).toBeDefined();
    });

    it("offers no archived destination on a live document", () => {
      mount();
      fireEvent.click(screen.getByRole("button", { name: "edit" }));
      const status = screen.getByDisplayValue<HTMLSelectElement>("open");
      expect([...status.options].map((option) => option.value)).toEqual(["open", "resolved"]);
      expect(status).toHaveProperty("disabled", false);
    });

    it("flushes a draft on the way out without ever carrying status", async () => {
      const { wire, unmount } = mount({ doc: ARCHIVED });
      fireEvent.change(screen.getByLabelText("Document title"), {
        target: { value: "Renamed while archived" },
      });

      unmount();

      await waitFor(() => {
        expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
      });
      expect(wire.of("PUT")[0]?.body).toEqual({ title: "Renamed while archived" });
      expect(Object.keys(wire.of("PUT")[0]?.body as object)).not.toContain("status");
    });
  });

  it("selects the title of a just-created document", () => {
    const wire = readerTransport({ docs: [DOC] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    render(<FrontmatterForm doc={DOC} selectTitle locked={false} onNotify={() => undefined} />, {
      wrapper: harness.Wrapper,
    });
    const title = screen.getByLabelText<HTMLTextAreaElement>("Document title");
    expect(document.activeElement).toBe(title);
    expect(title.selectionStart).toBe(0);
    expect(title.selectionEnd).toBe(title.value.length);
  });

  it("reports a failed save rather than clearing the draft", async () => {
    const notices: string[] = [];
    const wire = readerTransport({ docs: [DOC], failing: { "PUT /api/docs/doc_m": 423 } });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    render(
      <FrontmatterForm
        doc={DOC}
        selectTitle={false}
        locked={false}
        onNotify={(notice) => notices.push(`${notice.tone}:${notice.message}`)}
      />,
      { wrapper: harness.Wrapper },
    );
    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.keyDown(title, { key: "Enter" });

    await waitFor(() => {
      expect(notices[0]).toContain("error:Save failed");
    });
    expect((title as HTMLTextAreaElement).value).toBe("Renamed");
  });

  it("narrates a successful save", async () => {
    const notify = vi.fn();
    const wire = readerTransport({ docs: [DOC] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    render(<FrontmatterForm doc={DOC} selectTitle={false} locked={false} onNotify={notify} />, {
      wrapper: harness.Wrapper,
    });
    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.keyDown(title, { key: "Enter" });

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith({
        tone: "info",
        message: "Saved — title updated and committed.",
      });
    });
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the session open while the form is mounted, and ends it when it goes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const flushEditSession = flusher();
    const { wire, unmount } = mount();

    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.keyDown(title, { key: "Enter" });
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

    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.keyDown(title, { key: "Enter" });
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });

    unmount();
    vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS * 4);
    expect(flushEditSession).not.toHaveBeenCalled();
  });
});
