/** @vitest-environment jsdom */
import { DEFAULT_DOC_FOLDER } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { boardTransport } from "../testing/boardFixture";
import {
  creationRequest,
  INBOX_TARGET,
  UNTITLED_DOCUMENT_TITLE,
  useCreateInColumn,
} from "./useCreateInColumn";

afterEach(cleanup);

describe("creationRequest", () => {
  it("creates into a folder column's folder", () => {
    expect(creationRequest({ folder: "finance" }, "Untitled")).toEqual({
      type: "note",
      title: "Untitled",
      folder: "finance",
    });
  });

  /**
   * sprint-010 UI-009 FIND-1: the omnibox row promises the inbox, so the
   * request says `inbox` rather than trusting a default declared elsewhere.
   */
  it("names the inbox explicitly everywhere else, rather than relying on the server default", () => {
    expect(creationRequest(INBOX_TARGET, "Untitled")).toEqual({
      type: "note",
      title: "Untitled",
      folder: DEFAULT_DOC_FOLDER,
    });
    expect(DEFAULT_DOC_FOLDER).toBe("inbox");
  });

  /**
   * Every column creates a `note`, whatever its query says. A column could name
   * its own document type until Phase 41 (a plugin `column:` reference), and
   * nothing can now: `＋` is zero-form creation, and the type is retyped in the
   * document's own frontmatter if it should be something else.
   */
  it("creates a note from every column, whatever the column queries for", () => {
    expect(creationRequest({ folder: "todos" }, "Untitled")).toEqual({
      type: "note",
      title: "Untitled",
      folder: "todos",
    });
  });
});

describe("useCreateInColumn", () => {
  it("returns the created id so the caller can open it", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useCreateInColumn(), { wrapper: harness.Wrapper });

    const id = await result.current.create({ folder: "finance" });

    expect(id).toBe("doc_created");
    expect(wire.writes("POST")).toEqual([
      {
        method: "POST",
        path: "/api/docs",
        search: "",
        body: { type: "note", title: UNTITLED_DOCUMENT_TITLE, folder: "finance" },
      },
    ]);
  });

  it("takes a title, which is how UI-009's omnibox will use it", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useCreateInColumn(), { wrapper: harness.Wrapper });

    await result.current.create(INBOX_TARGET, "Mortgage options");

    expect(wire.writes("POST")[0]?.body).toEqual({
      type: "note",
      title: "Mortgage options",
      folder: DEFAULT_DOC_FOLDER,
    });
  });

  it("surfaces a refusal", async () => {
    const wire = boardTransport({ failing: { "/api/docs": 400 } });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useCreateInColumn(), { wrapper: harness.Wrapper });

    await expect(result.current.create(INBOX_TARGET)).rejects.toThrow(/no such filter/);
  });
});
