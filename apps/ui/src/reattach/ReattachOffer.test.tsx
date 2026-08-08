/** @vitest-environment jsdom */
import type { ResolvedAnchor } from "@corpus/contract";
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_CANDIDATES } from "./candidates";
import {
  ATTACH_LABEL,
  DECLINE_LABEL,
  EMPTY_MESSAGE,
  OFFER_LABEL,
  ReattachOffer,
  TAKEN_MESSAGE,
} from "./ReattachOffer";

/**
 * The affordance under test is the *decision surface*, so these assert what the
 * person is shown and what leaves on the wire — never an internal shape.
 *
 * The three that matter most, and that a redesign must keep passing: nothing is
 * pre-selected, declining is always reachable and writes nothing, and the click
 * sends the **range** of the candidate that was clicked rather than its position
 * in a list (CONTRACT-041 — a stale list must not be able to mean a different
 * passage).
 */

const PARENT = "doc_parent";

/** Four byte-identical siblings, one of which the quote no longer matches. */
const BODY = [
  "# Weekly actions",
  "",
  "- Review the Q1 report by Friday",
  "- Review the Q3 report by Friday",
  "- Review the Q4 report by Friday",
  "",
].join("\n");

const ORPHAN_QUOTE = "Review the Q2 report by Friday";

function orphanAnchor(overrides: Partial<ResolvedAnchor> = {}): ResolvedAnchor {
  return {
    anchorId: "anc_orphan",
    threadId: "th_orphan",
    threadStatus: "open",
    selector: { exact: ORPHAN_QUOTE, prefix: "", suffix: "" },
    range: null,
    orphaned: true,
    ...overrides,
  };
}

interface Sent {
  readonly url: string;
  readonly body: unknown;
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly sent: Sent[];
}

function wire(response: { status: number; body: unknown } = { status: 200, body: null }): Wire {
  const sent: Sent[] = [];
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    /*
     * `openapi-fetch` builds its own `Request` and passes it as `input`, so the
     * body is read by cloning **that** object rather than by constructing a new
     * one around a foreign-realm value — the jsdom/undici realm split
     * `threadWriteHooks.test.tsx` documents.
     */
    const raw =
      typeof init?.body === "string"
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : "";
    sent.push({ url, body: JSON.parse(raw === "" ? "null" : raw) as unknown });
    const payload = response.body ?? {
      thread: {
        id: "th_orphan",
        title: "Comment",
        status: "open",
        parent: PARENT,
        anchor: "anc_orphan",
      },
      anchor: { ...orphanAnchor(), orphaned: false, range: { start: 0, end: 1 } },
      warnings: [],
    };
    return new Response(JSON.stringify(payload), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchMock, sent };
}

interface HostProps {
  readonly transport: Wire;
  readonly anchors?: readonly ResolvedAnchor[];
  readonly body?: string;
  readonly onNotify?: (notice: RowNotice) => void;
}

function Host({
  transport,
  anchors = [orphanAnchor()],
  body = BODY,
  onNotify = (): void => undefined,
}: HostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  const anchor = anchors.find((entry) => entry.orphaned) ?? orphanAnchor();
  return (
    <harness.Wrapper>
      <ReattachOffer
        anchor={anchor}
        parentId={PARENT}
        body={body}
        anchors={anchors}
        onNotify={onNotify}
      />
    </harness.Wrapper>
  );
}

function open(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-reattach-open]");
  if (button === null) throw new Error("no offer button");
  fireEvent.click(button);
}

function candidates(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-reattach-candidate]")];
}

/** Every notice the surface raised, in order. */
function noticed(onNotify: ReturnType<typeof vi.fn>): RowNotice[] {
  return onNotify.mock.calls.map((call) => call[0] as RowNotice);
}

function attachButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("[data-reattach-attach]")];
}

afterEach(() => {
  cleanup();
});

describe("ReattachOffer — before the picker is opened", () => {
  it("says the comment is detached and offers, rather than performing, a repair", () => {
    const transport = wire();
    render(<Host transport={transport} />);

    expect(document.querySelector("[data-reattach-open]")?.textContent).toBe(OFFER_LABEL);
    expect(candidates()).toHaveLength(0);
    expect(transport.sent).toEqual([]);
  });
});

describe("ReattachOffer — candidates are offered, never pre-selected", () => {
  it("lists every surviving sibling with nothing chosen among them", () => {
    render(<Host transport={wire()} />);
    open();

    const items = candidates();
    expect(items).toHaveLength(3);

    for (const item of items) {
      expect(item.getAttribute("aria-selected")).toBeNull();
      expect(item.getAttribute("aria-checked")).toBeNull();
      expect(item.querySelector("[checked]")).toBeNull();
      expect(item.querySelector("[autofocus]")).toBeNull();
    }
    // Every candidate is marked identically: no styling can read as a
    // recommendation if there is only one style.
    const marks = [...document.querySelectorAll("mark")].map((mark) => mark.className);
    expect(new Set(marks).size).toBe(1);

    // And no control has focus, so ↵ cannot commit a repair nobody chose.
    expect(document.activeElement).toBe(document.body);
  });

  it("shows surrounding text rather than a similarity score", () => {
    render(<Host transport={wire()} />);
    open();

    const first = candidates()[0];
    expect(first?.textContent).toContain("Review the Q1 report by Friday");
    expect(first?.textContent).toContain("Weekly actions");
    // Nothing that reads as a measurement: no percentage, no ratio, no "match".
    expect(first?.textContent ?? "").not.toMatch(/%|score|similar|match/i);
  });

  it("puts them in document order", () => {
    render(<Host transport={wire()} />);
    open();

    expect(candidates().map((item) => item.textContent)).toEqual([
      expect.stringContaining("Q1") as unknown as string,
      expect.stringContaining("Q3") as unknown as string,
      expect.stringContaining("Q4") as unknown as string,
    ]);
  });
});

describe("ReattachOffer — the choice travels as a range", () => {
  it("sends the clicked candidate's own offsets and bytes, not its position", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    open();

    const second = attachButtons()[1];
    expect(second).toBeDefined();
    fireEvent.click(second as HTMLButtonElement);

    await waitFor(() => {
      expect(transport.sent).toHaveLength(1);
    });
    const sent = transport.sent[0];
    expect(sent?.url).toContain("/api/threads/th_orphan/reattach");

    const payload = sent?.body as { range: { start: number; end: number }; expectedText: string };
    expect(payload.expectedText).toBe("Review the Q3 report by Friday");
    expect(BODY.slice(payload.range.start, payload.range.end)).toBe(payload.expectedText);
    expect(payload.expectedText.length).toBe(payload.range.end - payload.range.start);
    expect(Object.keys(payload).sort()).toEqual(["expectedText", "range"]);
  });

  it("reports the repair once it has committed", async () => {
    const onNotify = vi.fn();
    render(<Host transport={wire()} onNotify={onNotify} />);
    open();
    fireEvent.click(attachButtons()[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(noticed(onNotify)).toEqual([
        { tone: "info", message: expect.stringContaining("re-attached") as unknown },
      ]);
    });
  });
});

describe("ReattachOffer — leaving it detached", () => {
  it("is available in every branch and writes nothing", () => {
    const transport = wire();
    render(<Host transport={transport} />);
    open();

    const decline = document.querySelector<HTMLButtonElement>("[data-reattach-decline]");
    expect(decline?.textContent).toContain(DECLINE_LABEL);

    fireEvent.click(decline as HTMLButtonElement);
    expect(transport.sent).toEqual([]);
    expect(candidates()).toHaveLength(0);
    // Back to the offer: declining is not a one-way door either.
    expect(document.querySelector("[data-reattach-open]")).not.toBeNull();
  });

  it("is offered even when there is nothing to choose", () => {
    render(<Host transport={wire()} body={"# Notes\n\nUnrelated prose about containers.\n"} />);
    open();

    expect(document.querySelector("[data-reattach-empty]")?.textContent).toBe(EMPTY_MESSAGE);
    expect(attachButtons()).toHaveLength(0);
    expect(document.querySelector("[data-reattach-decline]")).not.toBeNull();
  });
});

describe("ReattachOffer — honesty about the list", () => {
  it("says so when the list is capped rather than showing a silent prefix", () => {
    const body = Array.from(
      { length: MAX_CANDIDATES + 3 },
      (_unused, index) => `- Review the R${String(index).padStart(2, "0")} report by Friday`,
    ).join("\n");
    render(<Host transport={wire()} body={body} />);
    open();

    const limit = document.querySelector("[data-reattach-limit]");
    expect(limit?.textContent).toContain(String(MAX_CANDIDATES + 3));
    expect(candidates()).toHaveLength(MAX_CANDIDATES);
  });

  it("claims nothing about truncation when the list is everything", () => {
    render(<Host transport={wire()} />);
    open();
    expect(document.querySelector("[data-reattach-limit]")).toBeNull();
  });

  it("shows text another thread claims, refused rather than hidden", () => {
    const occupant: ResolvedAnchor = {
      anchorId: "anc_other",
      threadId: "th_other",
      threadStatus: "open",
      selector: { exact: "Review the Q3 report by Friday", prefix: "", suffix: "" },
      range: { start: BODY.indexOf("Review the Q3"), end: BODY.indexOf("Review the Q3") + 30 },
      orphaned: false,
    };
    render(<Host transport={wire()} anchors={[orphanAnchor(), occupant]} />);
    open();

    expect(candidates()).toHaveLength(3);
    expect(attachButtons()).toHaveLength(2);
    expect(document.querySelector("[data-reattach-taken]")?.textContent).toBe(TAKEN_MESSAGE);
    expect(
      document.querySelector("[data-reattach-taken]")?.getAttribute("data-reattach-taken"),
    ).toBe("th_other");
  });
});

describe("ReattachOffer — refusals", () => {
  it.each([
    ["range-changed", "changed while you were choosing"],
    ["range-overlaps", "already anchored to that text"],
    ["not-anchored", "no anchor to repair"],
  ])("tells the person what %s means for them", async (reason, expected) => {
    const onNotify = vi.fn();
    const transport = wire({
      status: 409,
      body: { code: "conflict", message: "refused", reason },
    });
    render(<Host transport={transport} onNotify={onNotify} />);
    open();
    fireEvent.click(attachButtons()[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(noticed(onNotify)).toEqual([
        { tone: "error", message: expect.stringContaining(expected) as unknown },
      ]);
    });
  });

  it("falls back to the server's own sentence for a failure it does not know", async () => {
    const onNotify = vi.fn();
    const transport = wire({
      status: 423,
      body: { code: "locked", message: "the agent holds this document" },
    });
    render(<Host transport={transport} onNotify={onNotify} />);
    open();
    fireEvent.click(attachButtons()[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(noticed(onNotify)).toEqual([
        {
          tone: "error",
          message: expect.stringContaining("the agent holds this document") as unknown,
        },
      ]);
    });
  });

  it("leaves the picker open so the person can choose again", async () => {
    const transport = wire({
      status: 409,
      body: { code: "conflict", message: "refused", reason: "range-overlaps" },
    });
    render(<Host transport={transport} />);
    open();
    fireEvent.click(attachButtons()[0] as HTMLButtonElement);

    await waitFor(() => {
      expect(transport.sent).toHaveLength(1);
    });
    expect(candidates()).toHaveLength(3);
    expect(document.querySelector("[data-reattach-decline]")).not.toBeNull();
  });
});

describe("ReattachOffer — the whole flow", () => {
  it("opens, attaches to the third sibling, and reports it", async () => {
    const transport = wire();
    const onNotify = vi.fn();
    render(<Host transport={transport} onNotify={onNotify} />);

    open();
    expect(attachButtons()).toHaveLength(3);
    fireEvent.click(attachButtons()[2] as HTMLButtonElement);

    await waitFor(() => {
      expect(transport.sent).toHaveLength(1);
    });
    expect((transport.sent[0]?.body as { expectedText: string }).expectedText).toBe(
      "Review the Q4 report by Friday",
    );
    await waitFor(() => {
      expect(document.querySelector("[data-reattach-open]")?.textContent).toBe(OFFER_LABEL);
    });
    expect(onNotify).toHaveBeenCalledWith(expect.objectContaining({ tone: "info" }));
    expect(document.querySelector("[data-reattach-attach]")).toBeNull();
    expect(ATTACH_LABEL).toBe("Attach here");
  });
});
