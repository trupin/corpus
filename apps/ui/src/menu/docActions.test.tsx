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
import {
  docStatusNotice,
  useDocActions,
  unarchivedMessage,
  type DocActionSubject,
} from "./docActions";
import { RowMenuItems } from "./RowMenuItems";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

/**
 * The declaration itself (SPEC.md §10's "one source of actions, two
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
): { ids: () => string[]; labelOf: (id: string) => string | undefined; run: (id: string) => void } {
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
    labelOf: (id) => result.current.find((action) => action.id === id)?.label,
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
      failing: { "POST /api/docs/doc_skill/unarchive": 409 },
    });
    actionsOf(ARCHIVED_SKILL, wire, notify).run("unarchive");

    await waitFor(() => {
      expect(notify.mock.calls.at(-1)?.[0]?.tone).toBe("error");
    });
    expect(notify.mock.calls.at(-1)?.[0]?.message).toContain("Unarchive failed");
  });

  /** A reversible act; §10 keeps the two-click ceremony for the one that is not. */
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
 * SPEC.md §10's right-click bullet: the context menu lists "exactly that item's
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

/**
 * UI-094 — Resolve/Reopen on **every** document, not only a thread.
 *
 * SPEC.md §5's status ladder is one vocabulary for every type (rider signed
 * 2026-08-12), and the menu was the last surface holding a per-type one: the
 * frontmatter form has always offered `resolved` on a note. These assert which
 * **mutation** each subject dispatches, not only that an item rendered — the two
 * write paths are deliberately different and a menu that sent a note through the
 * thread route would look identical here.
 */
describe("Resolve is offered wherever a status is settable", () => {
  const RESOLVED_NOTE: DocActionSubject = { ...NOTE, status: "resolved" };
  const THREAD: DocActionSubject = {
    id: "th_fixture",
    title: "About the rate",
    type: "thread",
    status: "open",
  };
  const TODO: DocActionSubject = {
    id: "doc_todo",
    title: "Inbox chores",
    type: "todo" as const,
    status: "open",
  };

  it("offers Resolve on an ordinary note, which nothing but this menu withheld", () => {
    const resolve = actionsOf(NOTE).labelOf("resolve");
    expect(resolve).toBe("Resolve");
  });

  it("flips the label to Reopen on an already-resolved document", () => {
    expect(actionsOf(RESOLVED_NOTE).labelOf("resolve")).toBe("Reopen");
  });

  it("writes a note's status through PUT /api/docs/{id}, never the thread route", async () => {
    const wire = readerTransport({ docs: [docFixture({ frontmatter: { id: "doc_m" } })] });
    actionsOf(NOTE, wire).run("resolve");

    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    });
    expect(wire.of("PUT", "/api/docs/doc_m")[0]?.body).toEqual({ status: "resolved" });
    expect(wire.of("POST")).toHaveLength(0);
  });

  it("reopens by writing `open` back", async () => {
    const wire = readerTransport({
      docs: [docFixture({ frontmatter: { id: "doc_m", status: "resolved" } })],
    });
    actionsOf(RESOLVED_NOTE, wire).run("resolve");

    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    });
    expect(wire.of("PUT", "/api/docs/doc_m")[0]?.body).toEqual({ status: "open" });
  });

  /**
   * SPEC.md §6/§7: the thread route rewrites and commits the thread file and
   * releases a designated resident. A note has no such route and a thread must
   * not lose one, so the menu picks by subject rather than unifying them.
   */
  it("keeps a thread on POST …/resolve, with no doc write beside it", async () => {
    const wire = readerTransport({ docs: [] });
    actionsOf(THREAD, wire).run("resolve");

    await waitFor(() => {
      expect(wire.of("POST", "/api/threads/th_fixture/resolve")).toHaveLength(1);
    });
    expect(wire.of("PUT")).toHaveLength(0);
  });

  it("says what resolving did, and that the document has not moved", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const wire = readerTransport({ docs: [docFixture({ frontmatter: { id: "doc_m" } })] });
    actionsOf(NOTE, wire, notify).run("resolve");

    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    expect(notify.mock.calls.at(-1)?.[0]).toEqual({
      tone: "info",
      message: docStatusNotice("Mortgage options", true),
    });
    expect(docStatusNotice("Mortgage options", true)).toContain("stays where it is");
  });

  it("reports a refused status write rather than committing in silence", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const wire = readerTransport({
      docs: [docFixture({ frontmatter: { id: "doc_m" } })],
      failing: { "PUT /api/docs/doc_m": 409 },
    });
    actionsOf(NOTE, wire, notify).run("resolve");

    await waitFor(() => {
      expect(notify.mock.calls.at(-1)?.[0]?.tone).toBe("error");
    });
    expect(notify.mock.calls.at(-1)?.[0]?.message).toContain("Resolve failed");
  });

  /**
   * SERVER-039 refuses `PUT {status}` on an archived document, so the item would
   * promise a refusal. SHARED-031 says the same thing from the other end:
   * `archived` already *is* settled, and Unarchive — which the menu does offer —
   * returns it to `resolved`.
   */
  it("withholds it from an archived document, whose write path refuses it", () => {
    expect(actionsOf(ARCHIVED_SKILL).ids()).not.toContain("resolve");
  });

  /**
   * Nothing computes a document's status from its content, so every document's
   * status is its own to set whatever its `type:` says — and a workspace's
   * `type: todo` documents, an unrecognised type real workspaces already hold,
   * get the full action set like any other (SPEC.md §12's M6).
   */
  it("offers it on a type this build does not recognise, exactly as on a note", () => {
    expect(actionsOf(TODO).ids()).toContain("resolve");
  });

  it("decides by the subject's status, never by its type", () => {
    expect(actionsOf({ ...TODO, status: "archived" }).ids()).not.toContain("resolve");
    expect(actionsOf({ ...TODO, status: "resolved" }).labelOf("resolve")).toBe("Reopen");
  });

  /**
   * The whole point of one declaration: the ⋯ sheet and the row menu are the
   * same array, so they were wrong together and are right together. The issue's
   * premise that the row menu was the broken half is wrong — measured in a real
   * browser, neither offered it.
   */
  it("reaches the row menu and the reader's ⋯ sheet in the same change", () => {
    const harness = createCorpusTestHarness({ fetch: readerTransport({ docs: [] }).fetch });
    render(
      <RowMenuItems
        subject={{ ...NOTE, staleLevel: 0 }}
        close={() => undefined}
        onOpen={() => undefined}
        onOpenFocus={() => undefined}
        onNotify={() => undefined}
      />,
      { wrapper: harness.Wrapper },
    );
    const fromRow = [...document.querySelectorAll("[role='menuitem']")].map(
      (node) => (node as HTMLElement).dataset["act"] ?? "",
    );
    expect(fromRow).toEqual(["open", "open-focus", "resolve", "archive", "delete"]);
    cleanup();

    const doc = docFixture({ frontmatter: { id: "doc_m", title: "Mortgage options" } });
    render(
      <DocMenuItems
        doc={doc}
        threadStatus={null}
        close={() => undefined}
        onGone={() => undefined}
        onNotify={() => undefined}
      />,
      {
        wrapper: createCorpusTestHarness({ fetch: readerTransport({ docs: [doc] }).fetch }).Wrapper,
      },
    );
    expect(
      [...document.querySelectorAll("[role='menuitem']")].map(
        (node) => (node as HTMLElement).dataset["act"] ?? "",
      ),
    ).toEqual(["review", "resolve", "archive", "delete"]);
  });
});
