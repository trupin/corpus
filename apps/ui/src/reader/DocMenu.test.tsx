/** @vitest-environment jsdom */
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docFixture, readerTransport, type ReaderTransport } from "../testing/readerFixture";
import {
  DELETE_ARMED_LABEL,
  DELETE_ARMED_META,
  DELETE_LABEL,
  DELETE_META,
  DocMenu,
} from "./DocMenu";
import { resetEscapeLayers } from "./useEscapeStack";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const NOTE = docFixture({ frontmatter: { id: "doc_m", title: "Mortgage options" } });
const THREAD = docFixture({
  frontmatter: { id: "th_rate", type: "thread", title: "Rate assumption", status: "open" },
  path: "data/threads/th_rate.md",
});

interface MountOptions {
  readonly doc?: typeof NOTE;
  readonly threadStatus?: string | null;
  readonly wire?: ReaderTransport;
  readonly onNotify?: (notice: RowNotice) => void;
  readonly onGone?: () => void;
  readonly onClose?: () => void;
}

function mount(options: MountOptions = {}): ReaderTransport {
  const doc = options.doc ?? NOTE;
  const wire = options.wire ?? readerTransport({ docs: [doc] });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  render(
    <DocMenu
      doc={doc}
      threadStatus={options.threadStatus ?? null}
      onClose={options.onClose ?? (() => undefined)}
      onGone={options.onGone ?? (() => undefined)}
      onNotify={options.onNotify ?? (() => undefined)}
    />,
    { wrapper: harness.Wrapper },
  );
  return wire;
}

function itemLabels(): string[] {
  return [...document.querySelectorAll(".cp-item .cp-quote")].map((node) => node.textContent ?? "");
}

describe("DocMenu", () => {
  it("offers Still current, Archive and Delete on a note", () => {
    mount();
    expect(itemLabels()).toEqual(["Still current", "Archive", DELETE_LABEL]);
  });

  it("adds Resolve on a thread document, labelled by its current status", () => {
    mount({ doc: THREAD, threadStatus: "open" });
    expect(itemLabels()).toEqual(["Still current", "Resolve", "Archive", DELETE_LABEL]);
    cleanup();
    mount({ doc: THREAD, threadStatus: "resolved" });
    expect(itemLabels()).toContain("Reopen");
  });

  /**
   * SPEC.md §10/§13: the publish plugin adds "Copy for Google Docs" and "Push
   * update to Google Doc…" through the manifest. Core rendering them — even
   * inert — is core knowing a plugin's name.
   */
  it("carries no publish-plugin items", () => {
    mount();
    expect(itemLabels().join(" ")).not.toContain("Google");
  });

  /** SPEC.md §5: a committed act distinct from editing — `reviewed`, nothing else. */
  it("marks still current through the kit's shared unit, writing reviewed and nothing else", async () => {
    const wire = mount();
    fireEvent.click(screen.getByText("Still current"));
    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_m")).toHaveLength(1);
    });
    const body = wire.of("PUT")[0]?.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["reviewed"]);
    expect(typeof body["reviewed"]).toBe("string");
  });

  it("archives through the same unit, reversibly", async () => {
    const wire = mount();
    fireEvent.click(screen.getByText("Archive"));
    await waitFor(() => {
      expect(wire.of("PUT")).toHaveLength(1);
    });
    expect(wire.of("PUT")[0]?.body).toEqual({ status: "archived" });
  });

  it("flips a thread's status through the thread route, not through a doc write", async () => {
    const wire = mount({ doc: THREAD, threadStatus: "open" });
    fireEvent.click(screen.getByText("Resolve"));
    await waitFor(() => {
      expect(wire.of("POST", "/api/threads/th_rate/resolve")).toHaveLength(1);
    });
    expect(wire.of("PUT")).toHaveLength(0);
  });

  it("arms Delete on the first click and issues nothing", () => {
    const wire = mount();
    fireEvent.click(screen.getByText(DELETE_LABEL));

    expect(screen.getByText(DELETE_ARMED_LABEL)).toBeDefined();
    expect(screen.getByText(DELETE_ARMED_META)).toBeDefined();
    expect(wire.calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
  });

  it("labels Delete as user-only before it is armed", () => {
    mount();
    expect(screen.getByText(DELETE_META)).toBeDefined();
    expect(document.querySelector(".cp-item.cp-danger")).not.toBeNull();
  });

  it("deletes on the second click, and says what it cost", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const onGone = vi.fn();
    const wire = mount({ onNotify: notify, onGone });
    fireEvent.click(screen.getByText(DELETE_LABEL));
    fireEvent.click(screen.getByText(DELETE_ARMED_LABEL));

    await waitFor(() => {
      expect(wire.of("DELETE", "/api/docs/doc_m")).toHaveLength(1);
    });
    expect(onGone).toHaveBeenCalled();
    expect(notify.mock.calls[0]?.[0]?.message).toContain("git retains its history");
  });

  it("disarms and reports a refused delete", async () => {
    const notify = vi.fn<(notice: RowNotice) => void>();
    const wire = readerTransport({
      docs: [NOTE],
      failing: { "DELETE /api/docs/doc_m": 403 },
    });
    mount({ wire, onNotify: notify });
    fireEvent.click(screen.getByText(DELETE_LABEL));
    fireEvent.click(screen.getByText(DELETE_ARMED_LABEL));

    await waitFor(() => {
      expect(notify.mock.calls[0]?.[0]?.message).toContain("Delete failed");
    });
    expect(screen.getByText(DELETE_LABEL)).toBeDefined();
  });

  it("closes on Escape rather than letting the surface below act on it", () => {
    const onClose = vi.fn();
    mount({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * jsdom applies no stylesheet, so the colours are asserted against the
 * stylesheet itself — the same approach `theme.test.ts` takes to `index.html`'s
 * pre-paint script. The browser measurement lives in the issue's E2E log.
 */
describe("the destructive item's treatment (TEST-18)", () => {
  const css = readFileSync(join(import.meta.dirname, "Reader.css"), "utf8");
  const rule = (selector: string): string =>
    new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  it.each([".cp-danger .cp-quote", ".cp-danger .cp-meta"])(
    "renders %s in --signal, so both of Delete's lines read as the warning they are",
    (selector) => {
      expect(rule(selector)).toContain("color: var(--signal)");
    },
  );

  it("leaves every other item's sub-label in --ink-3", () => {
    expect(rule(".cp-meta")).toContain("color: var(--ink-3)");
  });
});
