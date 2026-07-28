/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docFixture, readerTransport, type ReaderTransport } from "../testing/readerFixture";
import { changedFields, FrontmatterForm, tagsToText, textToTags } from "./FrontmatterForm";

afterEach(cleanup);

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

function mount(options: { locked?: boolean; wire?: ReaderTransport } = {}): ReaderTransport {
  const wire = options.wire ?? readerTransport({ docs: [DOC] });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  render(
    <FrontmatterForm
      doc={DOC}
      selectTitle={false}
      locked={options.locked ?? false}
      onNotify={() => undefined}
    />,
    { wrapper: harness.Wrapper },
  );
  return wire;
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
});

describe("FrontmatterForm", () => {
  it("renders the frontmatter as the prototype's chip strip", () => {
    mount();
    const chips = [...document.querySelectorAll(".fm-chips .chip")].map((chip) => chip.textContent);
    expect(chips).toEqual(["note", "finance/", "#finance", "open", "updated 2026-07-02", "edit"]);
  });

  it("issues one PUT carrying only the changed fields", async () => {
    const wire = mount();
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
    const wire = mount();
    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.keyDown(title, { key: "Enter" });

    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });
    expect(wire.of("PUT")[0]?.body).toEqual({ title: "Renamed" });
  });

  it("reverts the draft on Escape, and writes nothing", () => {
    const wire = mount();
    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Half a thought" } });
    expect(screen.getByText("unsaved changes")).toBeDefined();

    fireEvent.keyDown(title, { key: "Escape" });
    expect((title as HTMLInputElement).value).toBe("Mortgage options");
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

  it("selects the title of a just-created document", () => {
    const wire = readerTransport({ docs: [DOC] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    render(<FrontmatterForm doc={DOC} selectTitle locked={false} onNotify={() => undefined} />, {
      wrapper: harness.Wrapper,
    });
    const title = screen.getByLabelText<HTMLInputElement>("Document title");
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
    expect((title as HTMLInputElement).value).toBe("Renamed");
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
