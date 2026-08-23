/** @vitest-environment jsdom */
import type { FolderRefusal } from "@corpus/contract";
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REFUSALS_NAMED,
  TreeFolderMenuItems,
  folderDeleteNotice,
  folderStatusNotice,
  refusedClause,
  type ExplorerActs,
} from "./explorerMenus";

/**
 * What a folder act says when the server refused part of it (UI-164,
 * CONTRACT-078).
 *
 * The rule under test is SPEC.md §11's: a non-blocking failure is **reported**,
 * not swallowed. Before this, a folder archive over twelve documents that
 * refused one reported plain success, and the user saw eleven change with
 * nothing on screen saying which or why.
 */

let harness: CorpusTestHarness | undefined;

afterEach(() => {
  cleanup();
  harness?.queryClient.clear();
  harness = undefined;
  vi.unstubAllGlobals();
});

const refusal = (id: string, message = "the file is not under `data/docs/`"): FolderRefusal => ({
  id,
  message,
});

const many = (count: number): readonly FolderRefusal[] =>
  Array.from({ length: count }, (_, index) => refusal(`doc_r${String(index)}`));

describe("the refused clause", () => {
  it("names each document and renders the server's message verbatim", () => {
    expect(refusedClause([refusal("doc_a", "frontmatter is invalid: `due` is not a date")])).toBe(
      "doc_a — frontmatter is invalid: `due` is not a date",
    );
  });

  it("says how many it did not name rather than presenting a cut list as whole", () => {
    const clause = refusedClause(many(REFUSALS_NAMED + 4));
    expect(clause).toContain("(and 4 more not named here)");
    expect(clause.split(";")).toHaveLength(REFUSALS_NAMED);
  });

  it("leaves an id with no dangling dash when the message arrives empty", () => {
    expect(refusedClause([refusal("doc_a", "   ")])).toBe("doc_a — no reason given");
  });
});

describe("a folder status act", () => {
  it("reports plain success when nothing was refused", () => {
    const notice = folderStatusNotice("finance", 12, [], true);
    expect(notice.tone).toBe("info");
    expect(notice.message).toContain("Archived finance/ — committed");
    expect(notice.message).not.toContain("refused");
  });

  it("reads as partial, keeps the successful half, and names the refusal", () => {
    const notice = folderStatusNotice(
      "finance",
      12,
      [refusal("doc_x", "the file has vanished")],
      true,
    );
    // Eleven of twelve did change, and describing that as a failure would be
    // its own lie — so the tone stays informational and the words say "in part".
    expect(notice.tone).toBe("info");
    expect(notice.message).toContain("in part");
    expect(notice.message).toContain("11 of 12 documents");
    expect(notice.message).toContain("doc_x — the file has vanished");
    expect(notice.message).not.toMatch(/^Archived finance\/ — committed\./);
  });

  it("reads as a failure when every document was refused", () => {
    const notice = folderStatusNotice("finance", 3, many(3), false);
    expect(notice.tone).toBe("error");
    expect(notice.message).toContain("changed nothing");
    expect(notice.message).toContain("every one of its 3 documents was refused");
  });

  it("says one refusal out of one without arithmetic that reads oddly", () => {
    const notice = folderStatusNotice("finance", 1, [refusal("doc_x")], true);
    expect(notice.tone).toBe("error");
    expect(notice.message).toContain("every one of its 1 document was refused");
  });
});

describe("a folder delete", () => {
  it("reports plain success when nothing was refused", () => {
    const notice = folderDeleteNotice("finance", 4, []);
    expect(notice.tone).toBe("info");
    expect(notice.message).toContain("Deleted 4 documents under finance/");
    expect(notice.message).not.toContain("refused");
  });

  /*
   * A refused delete leaves the document in place, so it is **not** in
   * `documents` — the total is the two halves added, and nothing is inferred
   * from either alone.
   */
  it("counts the refused documents into the total, since deletion omits them", () => {
    const notice = folderDeleteNotice("finance", 11, [refusal("doc_x", "the file has vanished")]);
    expect(notice.tone).toBe("info");
    expect(notice.message).toContain("Deleted 11 of 12 documents under finance/");
    expect(notice.message).toContain("1 document was refused and still exists");
    expect(notice.message).toContain("doc_x — the file has vanished");
  });

  it("reads as a failure when every document was refused", () => {
    const notice = folderDeleteNotice("finance", 0, many(2));
    expect(notice.tone).toBe("error");
    expect(notice.message).toContain("Deleted nothing under finance/");
  });
});

/**
 * The menu itself, against a server that refuses one document of three — the
 * path from the wire to the toast, which is the half a pure-function test
 * cannot reach.
 */
describe("the folder menu, against a refusing server", () => {
  function acts(notify: (notice: { tone: string; message: string }) => void): ExplorerActs {
    return {
      defaultBoard: null,
      boards: [],
      open: () => undefined,
      openFullScreen: () => undefined,
      openBoard: () => undefined,
      renameFolder: () => undefined,
      createInFolder: () => undefined,
      pinFolder: () => undefined,
      folders: [],
      notify,
    };
  }

  async function archive(payload: unknown): Promise<{ tone: string; message: string }[]> {
    const notices: { tone: string; message: string }[] = [];
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(new Request(input, init).url);
      return Promise.resolve(
        url.pathname === "/api/folders/archive"
          ? json(payload)
          : json({ items: [], page: { total: 0, limit: 50, offset: 0 } }),
      );
    });
    harness = createCorpusTestHarness({ fetch });
    render(
      <harness.Wrapper>
        <TreeFolderMenuItems
          path="finance"
          count={3}
          acts={acts((notice) => notices.push(notice))}
          close={() => undefined}
        />
      </harness.Wrapper>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("menuitem", { name: /Archive folder/ }));
    await waitFor(() => {
      expect(notices).toHaveLength(1);
    });
    return notices;
  }

  it("names the refused document instead of reporting success", async () => {
    const [notice] = await archive({
      documents: [
        { id: "doc_a", status: "archived" },
        { id: "doc_b", status: "archived" },
        { id: "doc_c", status: "open" },
      ],
      refused: [{ id: "doc_c", message: "the file has vanished" }],
      warnings: [],
    });
    expect(notice?.message).toContain("2 of 3 documents");
    expect(notice?.message).toContain("doc_c — the file has vanished");
  });

  /*
   * A required field the client does not validate can still arrive absent, and
   * the strip's lesson (UI-098) is that a `.length` on it is a blank screen
   * rather than a missing sentence. Absent degrades to "nothing was refused".
   */
  it("degrades to plain success when the server omits `refused` entirely", async () => {
    const [notice] = await archive({
      documents: [{ id: "doc_a", status: "archived" }],
      warnings: [],
    });
    expect(notice?.tone).toBe("info");
    expect(notice?.message).toContain("Archived finance/ — committed");
  });
});
