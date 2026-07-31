/** @vitest-environment jsdom */
import type { DocStatus } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocMenu } from "../reader/DocMenu";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { docFixture, readerTransport, type ReaderTransport } from "../testing/readerFixture";
import { DocMenuItems } from "./DocMenuItems";
import { useDocActions, unarchivedMessage, type DocActionSubject } from "./docActions";
import { RowMenuItems } from "./RowMenuItems";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

/**
 * The declaration itself (SPEC.md §11's "one source of actions, two
 * presentations"). These read the array rather than a rendered menu, because
 * the availability rule is the thing under test and two hand-written UI
 * assertions are exactly the drift the shape exists to prevent.
 */

const NOTE: DocActionSubject = {
  id: "doc_m",
  title: "Mortgage options",
  type: "note",
  status: "open",
};

const ARCHIVED_SKILL: DocActionSubject = {
  id: "doc_skill",
  title: "Weekly review",
  type: "skill",
  status: "archived",
};

function actionsOf(
  subject: DocActionSubject,
  wire: ReaderTransport = readerTransport({ docs: [] }),
  onNotify: (notice: RowNotice) => void = () => undefined,
): { ids: () => string[]; run: (id: string) => void } {
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const { result } = renderHook(
    () =>
      useDocActions(subject, {
        surface: "reader",
        onNotify,
        close: () => undefined,
      }),
    { wrapper: harness.Wrapper },
  );
  return {
    ids: () => result.current.map((action) => action.id),
    run: (id) => {
      const action = result.current.find((item) => item.id === id);
      if (action === undefined) throw new Error(`no ${id} action`);
      action.run(() => undefined);
    },
  };
}

describe("Archive and Unarchive are the two halves of one act", () => {
  it("offers Archive on a live document and Unarchive on an archived one, never both", () => {
    const live = actionsOf(NOTE).ids();
    cleanup();
    const archived = actionsOf(ARCHIVED_SKILL).ids();

    expect(live).toContain("archive");
    expect(live).not.toContain("unarchive");
    expect(archived).toContain("unarchive");
    expect(archived).not.toContain("archive");
  });

  /**
   * SERVER-039 refuses `PUT {status: "open"}` on an archived document with a
   * `400` naming this very route, so wiring the affordance to the `PUT` would
   * ship an action whose only possible outcome is the error message telling you
   * to use the action.
   */
  it("restores through POST …/unarchive, never through a doc write", async () => {
    const wire = readerTransport({ docs: [docFixture({ frontmatter: { id: "doc_skill" } })] });
    actionsOf(ARCHIVED_SKILL, wire).run("unarchive");

    await waitFor(() => {
      expect(wire.of("POST", "/api/docs/doc_skill/unarchive")).toHaveLength(1);
    });
    expect(wire.of("PUT")).toHaveLength(0);
  });

  it("archives through POST …/archive, which is what moves a skill's folder", async () => {
    const wire = readerTransport({ docs: [docFixture({ frontmatter: { id: "doc_m" } })] });
    actionsOf(NOTE, wire).run("archive");

    await waitFor(() => {
      expect(wire.of("POST", "/api/docs/doc_m/archive")).toHaveLength(1);
    });
    expect(wire.of("PUT")).toHaveLength(0);
  });

  it("says what restoring did, in the app's own voice", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const wire = readerTransport({ docs: [docFixture({ frontmatter: { id: "doc_skill" } })] });
    actionsOf(ARCHIVED_SKILL, wire, notify).run("unarchive");

    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    expect(notify.mock.calls.at(-1)?.[0]).toEqual({
      tone: "info",
      message: unarchivedMessage("Weekly review"),
    });
  });

  it("reports a refused restore rather than committing in silence", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const wire = readerTransport({
      docs: [docFixture({ frontmatter: { id: "doc_skill" } })],
      failing: { "POST /api/docs/doc_skill/unarchive": 423 },
    });
    actionsOf(ARCHIVED_SKILL, wire, notify).run("unarchive");

    await waitFor(() => {
      expect(notify.mock.calls.at(-1)?.[0]?.tone).toBe("error");
    });
    expect(notify.mock.calls.at(-1)?.[0]?.message).toContain("Unarchive failed");
  });

  /** A reversible act; §11 keeps the two-click ceremony for the one that is not. */
  it("asks for no confirmation, because nothing is destroyed", () => {
    const harness = createCorpusTestHarness({ fetch: readerTransport({ docs: [] }).fetch });
    const { result } = renderHook(
      () =>
        useDocActions(ARCHIVED_SKILL, {
          surface: "reader",
          onNotify: () => undefined,
          close: () => undefined,
        }),
      { wrapper: harness.Wrapper },
    );
    const unarchive = result.current.find((action) => action.id === "unarchive");
    expect(unarchive?.confirm).toBeUndefined();
    expect(unarchive?.danger).not.toBe(true);
    expect(unarchive?.meta).not.toBe("");
  });
});

/**
 * SPEC.md §11's right-click bullet: the context menu lists "exactly that item's
 * existing actions — the same set its ⋯ / header menu offers, nothing
 * invented". Asserted as an equality between the two presentations rather than
 * as two hand-written expectations, which could drift apart the day one of them
 * is edited.
 */
describe("both presentations show one set", () => {
  const rendered = (): string[] =>
    [...document.querySelectorAll("[role='menuitem']")].map(
      (node) => (node as HTMLElement).dataset["act"] ?? "",
    );

  it.each<DocStatus>(["open", "archived"])(
    "the ⋯ sheet and the context menu agree on a %s document, new item included",
    (status) => {
      const doc = docFixture({ frontmatter: { id: "doc_m", title: "Mortgage options", status } });
      const harness = createCorpusTestHarness({ fetch: readerTransport({ docs: [doc] }).fetch });
      const props = {
        doc,
        threadStatus: null,
        onGone: () => undefined,
        onNotify: () => undefined,
      };

      render(<DocMenu {...props} onClose={() => undefined} />, { wrapper: harness.Wrapper });
      const fromSheet = rendered();
      cleanup();

      render(<DocMenuItems {...props} close={() => undefined} />, { wrapper: harness.Wrapper });
      expect(rendered()).toEqual(fromSheet);
      expect(fromSheet).toContain(status === "archived" ? "unarchive" : "archive");
      expect(fromSheet).not.toContain(status === "archived" ? "archive" : "unarchive");
    },
  );

  /** The row's menu reads the same declaration; only its own two openers differ. */
  it("a row menu carries whichever half its own status calls for", () => {
    const harness = createCorpusTestHarness({ fetch: readerTransport({ docs: [] }).fetch });
    render(
      <RowMenuItems
        subject={{
          id: "doc_m",
          title: "Mortgage options",
          type: "note",
          status: "archived",
          staleLevel: 0,
        }}
        close={() => undefined}
        onOpen={() => undefined}
        onOpenFocus={() => undefined}
        onNotify={() => undefined}
      />,
      { wrapper: harness.Wrapper },
    );
    expect(rendered()).toEqual(["open", "open-focus", "unarchive", "delete"]);
    expect(screen.getByText("Unarchive")).toBeDefined();
  });
});
