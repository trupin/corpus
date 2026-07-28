/** @vitest-environment jsdom */
import type { Turn } from "@corpus/contract";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { readerTransport, threadFixture, type ReaderTransport } from "../testing/readerFixture";
import { ThreadCard } from "./ThreadCard";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetSeenMarks();
});

const FORM_TS = "2026-07-01T10:07:00.000Z";

function fence(info: string): string {
  return [
    "Which quote should I file?",
    "",
    "```" + info,
    "prompt: Which quote should I file?",
    "options:",
    "  - Lemonade — $1,840/yr",
    "  - State Farm — $1,975/yr",
    "```",
  ].join("\n");
}

function wire(turns: readonly Turn[], failing?: Record<string, number>): ReaderTransport {
  return readerTransport({
    threads: [threadFixture({ id: "th_a", parent: null, turns: [...turns] })],
    ...(failing ? { failing } : {}),
  });
}

function Host({
  transport,
  onNotify,
}: {
  readonly transport: ReaderTransport;
  readonly onNotify?: (notice: { tone: string; message: string }) => void;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <ThreadCard
        threadId="th_a"
        host="standalone"
        onOpenDoc={() => undefined}
        onNotify={onNotify ?? (() => undefined)}
      />
    </harness.Wrapper>
  );
}

const formTurn = (info = "form"): Turn => ({ author: "agent", ts: FORM_TS, body: fence(info) });

describe("a form in an agent turn", () => {
  it("renders the prototype's option cards", async () => {
    const { container } = render(<Host transport={wire([formTurn()])} />);
    await waitFor(() => {
      expect(container.querySelector(".form-comment")).not.toBeNull();
    });
    const options = container.querySelectorAll(".form-opt");
    expect(options).toHaveLength(2);
    expect(options[0]?.querySelector(".form-opt-label")?.textContent).toBe("Lemonade");
    expect(options[0]?.querySelector(".price")?.textContent).toBe("$1,840/yr");
    expect(container.querySelector(".form-submit")?.textContent).toBe("Answer");
    // The fence is replaced in place: the YAML is not also rendered as prose.
    expect(container.querySelector(".turn-body")?.textContent).not.toContain("options:");
  });

  /** The contract matches the info string whole (`schemas/form.ts`). */
  it.each(["formula", "form-builder"])("leaves ```%s an ordinary code block", async (info) => {
    const { container } = render(<Host transport={wire([formTurn(info)])} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".turn")).toHaveLength(1);
    });
    expect(container.querySelector(".form-comment")).toBeNull();
    expect(container.querySelector(".turn-body pre code")?.textContent).toContain("prompt:");
  });

  it("marks the picked option and answers through the form route", async () => {
    const transport = wire([formTurn()]);
    const { container } = render(<Host transport={transport} />);
    await waitFor(() => {
      expect(container.querySelector(".form-comment")).not.toBeNull();
    });
    expect((container.querySelector(".form-submit") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(container.querySelectorAll(".form-opt")[0] as HTMLElement);
    expect(container.querySelectorAll(".form-opt")[0]?.className).toContain("picked");

    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "cheapest" } });
    fireEvent.click(container.querySelector(".form-submit") as HTMLElement);

    await waitFor(() => {
      expect(transport.of("POST").some((call) => call.path.endsWith("/form"))).toBe(true);
    });
    const call = transport.of("POST").find((entry) => entry.path.endsWith("/form"));
    // Open Conflict 1: the dedicated route, with the timestamp URL-encoded.
    expect(call?.path).toBe(`/api/threads/th_a/turns/${encodeURIComponent(FORM_TS)}/form`);
    expect(call?.body).toEqual({ option: "Lemonade — $1,840/yr", note: "cheapest" });
    // Never a hand-built turn on `/turns`.
    expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(0);
  });

  it("renders inert once a later turn records the answer", async () => {
    const { container } = render(
      <Host
        transport={wire([
          formTurn(),
          {
            author: "user",
            ts: "2026-07-01T10:09:00.000Z",
            body: "**Answered:** State Farm — $1,975/yr",
          },
        ])}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".form-comment")).not.toBeNull();
    });
    expect(container.querySelector(".form-submit")).toBeNull();
    expect(container.querySelector(".form-answered")?.textContent).toBe(
      "Answered — State Farm — $1,975/yr",
    );
    expect(container.querySelectorAll(".form-opt")[1]?.className).toContain("picked");
  });

  it("surfaces a rejected answer as a toast and keeps the controls", async () => {
    const notify = vi.fn();
    const transport = wire([formTurn()], {
      [`POST /api/threads/th_a/turns/${encodeURIComponent(FORM_TS)}/form`]: 409,
    });
    const { container } = render(<Host transport={transport} onNotify={notify} />);
    await waitFor(() => {
      expect(container.querySelector(".form-comment")).not.toBeNull();
    });
    fireEvent.click(container.querySelectorAll(".form-opt")[0] as HTMLElement);
    fireEvent.click(container.querySelector(".form-submit") as HTMLElement);
    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ tone: "error" });
    expect(container.querySelector(".form-submit")).not.toBeNull();
  });

  it("degrades malformed YAML to a code block with a warning, and throws nothing", async () => {
    const broken: Turn = {
      author: "agent",
      ts: FORM_TS,
      body: ["```form", "prompt: [unclosed", "```"].join("\n"),
    };
    const { container } = render(<Host transport={wire([broken])} />);
    await waitFor(() => {
      expect(container.querySelector(".form-broken")).not.toBeNull();
    });
    expect(container.querySelector(".form-warning")?.textContent).toContain(
      "This form could not be read",
    );
    expect(container.querySelector(".form-submit")).toBeNull();
  });

  /** §6 says a form is something an *agent* turn carries. */
  it("does not offer controls for a form quoted in a user turn", async () => {
    const { container } = render(
      <Host transport={wire([{ author: "user", ts: FORM_TS, body: fence("form") }])} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".turn")).toHaveLength(1);
    });
    expect(container.querySelector(".form-submit")).toBeNull();
  });
});
