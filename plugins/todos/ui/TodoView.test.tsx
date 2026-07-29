/** @vitest-environment jsdom */
import type { Lock } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TodoView } from "./TodoView.js";
import {
  TS,
  todoDoc,
  transport,
  wrapperFor,
  type RecordedCall,
  type Transport,
} from "./testing.js";

afterEach(cleanup);

const item = (text: string, done: boolean, due?: string): Record<string, unknown> => ({
  text,
  done,
  ts: `${TS.slice(0, 10)}T09:0${String(text.length % 10)}:00.000Z`,
  ...(due === undefined ? {} : { due }),
});

const ITEMS = [item("Renew passport", false), item("Send lease notice", true)];

interface Mounted {
  readonly wire: Transport;
  /** Resolves once the kit's queries have settled — see `wrapperFor`. */
  readonly settle: () => Promise<void>;
}

function mount(items: unknown, options: Partial<Parameters<typeof transport>[0]> = {}): Mounted {
  const doc = todoDoc("doc_week", { items });
  const wire = transport({ doc, ...options });
  const harness = wrapperFor(wire);
  render(<TodoView doc={doc} now={new Date("2026-07-20T12:00:00.000Z")} />, {
    wrapper: harness.Wrapper,
  });
  return {
    wire,
    settle: () =>
      waitFor(() => {
        expect(harness.fetching()).toBe(0);
      }),
  };
}

const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-todo-item]")];

const bodyOf = (call: RecordedCall | undefined): unknown => {
  const raw = call?.init?.body;
  return typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined;
};

describe("TodoView — the list", () => {
  it("renders one row per item, done ones distinguished", () => {
    mount(ITEMS);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.className).not.toContain("done");
    expect(rows()[1]?.className).toContain("done");
    expect(screen.getByRole("button", { name: /Check “Renew passport”/ }).textContent).toBe("☐");
    expect(screen.getByRole("button", { name: /Uncheck “Send lease notice”/ }).textContent).toBe(
      "☑",
    );
  });

  it("renders each label as an editable field carrying the item's text", () => {
    mount(ITEMS);
    const label = screen.getByLabelText<HTMLInputElement>("Item 1");
    expect(label.value).toBe("Renew passport");
    expect(label.readOnly).toBe(false);
  });

  it("shows a due chip and marks a past deadline overdue", () => {
    mount([item("Late", false, "2026-07-10"), item("Soon", false, "2026-07-25")]);
    const chips = [...document.querySelectorAll<HTMLElement>(".due")];
    expect(chips.map((chip) => chip.dataset["overdue"])).toEqual(["true", "false"]);
  });

  it("shows an empty state with the add affordance for an empty list", () => {
    mount([]);
    expect(screen.getByText("Nothing on this list yet.")).toBeTruthy();
    expect(screen.getByLabelText("Add an item")).toBeTruthy();
  });

  it("treats an absent `items` key as an empty list", () => {
    const doc = todoDoc("doc_new", {});
    render(<TodoView doc={doc} />, { wrapper: wrapperFor(transport({ doc })).Wrapper });
    expect(screen.getByText("Nothing on this list yet.")).toBeTruthy();
  });
});

describe("TodoView — writing", () => {
  it("flips the checkbox immediately and PUTs the change", async () => {
    const { wire } = mount(ITEMS);
    fireEvent.click(screen.getByRole("button", { name: /Check “Renew passport”/ }));

    // Optimistic: the box flips before any response could have arrived.
    expect(screen.getByRole("button", { name: /Uncheck “Renew passport”/ })).toBeTruthy();
    await waitFor(() => {
      expect(wire.pluginCalls()).toHaveLength(1);
    });
    const call = wire.pluginCalls()[0];
    expect(call?.url).toContain("/api/x/todos/doc_week/items/0");
    expect(call?.init?.method).toBe("PUT");
    // The guard travels with every write: the server 409s rather than toggling
    // whatever moved into that index.
    expect(bodyOf(call)).toEqual({
      done: true,
      expectedText: "Renew passport",
    });
  });

  it("POSTs a new item and clears the draft, without inventing a timestamp", async () => {
    const { wire } = mount(ITEMS);
    const field = screen.getByLabelText<HTMLInputElement>("Add an item");
    fireEvent.change(field, { target: { value: "Book dentist" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(wire.pluginCalls()).toHaveLength(1);
    });
    const call = wire.pluginCalls()[0];
    expect(call?.url).toContain("/api/x/todos/doc_week/items");
    expect(call?.init?.method).toBe("POST");
    expect(bodyOf(call)).toEqual({ text: "Book dentist" });
    expect(field.value).toBe("");
    // `ts` is the server's clock; the list still shows two items until it says
    // otherwise, rather than a third whose creation time is about to change.
    expect(rows()).toHaveLength(2);
  });

  it("ignores an empty or whitespace-only draft", () => {
    const { wire } = mount(ITEMS);
    fireEvent.change(screen.getByLabelText("Add an item"), { target: { value: "   " } });
    fireEvent.submit(screen.getByLabelText("Add an item").closest("form") as HTMLFormElement);
    expect(wire.pluginCalls()).toEqual([]);
  });

  it("renames an item on blur, and does nothing when the text is unchanged", async () => {
    const { wire } = mount(ITEMS);
    const label = screen.getByLabelText("Item 1");
    fireEvent.blur(label, { target: { value: "Renew passport" } });
    expect(wire.pluginCalls()).toEqual([]);

    fireEvent.blur(label, { target: { value: "Renew the passport" } });
    await waitFor(() => {
      expect(wire.pluginCalls()).toHaveLength(1);
    });
    expect(bodyOf(wire.pluginCalls()[0])).toEqual({
      text: "Renew the passport",
      expectedText: "Renew passport",
    });
  });

  /**
   * Both keys end editing through the field's own blur, which is where the
   * commit lives — so what each one owes is the *value* it leaves behind.
   */
  it("abandons an edit on Escape and ends it on Enter", () => {
    const { wire } = mount(ITEMS);
    const label = screen.getByLabelText<HTMLInputElement>("Item 1");
    label.focus();

    label.value = "Escaped";
    fireEvent.keyDown(label, { key: "Escape" });
    expect(label.value).toBe("Renew passport");
    expect(document.activeElement).not.toBe(label);
    expect(wire.pluginCalls()).toEqual([]);

    label.focus();
    label.value = "Committed";
    fireEvent.keyDown(label, { key: "Enter" });
    expect(label.value).toBe("Committed");
    expect(document.activeElement).not.toBe(label);
  });

  it("ignores every other key while editing", () => {
    const { wire } = mount(ITEMS);
    const label = screen.getByLabelText<HTMLInputElement>("Item 1");
    label.focus();
    fireEvent.keyDown(label, { key: "a" });
    expect(document.activeElement).toBe(label);
    expect(wire.pluginCalls()).toEqual([]);
  });

  it("ignores a rename to empty text", () => {
    const { wire } = mount(ITEMS);
    fireEvent.blur(screen.getByLabelText("Item 1"), { target: { value: "  " } });
    expect(wire.pluginCalls()).toEqual([]);
  });

  it("DELETEs an item, with the same concurrency guard", async () => {
    const { wire } = mount(ITEMS);
    fireEvent.click(screen.getByRole("button", { name: /Remove “Renew passport”/ }));
    await waitFor(() => {
      expect(wire.pluginCalls()).toHaveLength(1);
    });
    expect(wire.pluginCalls()[0]?.init?.method).toBe("DELETE");
    expect(bodyOf(wire.pluginCalls()[0])).toEqual({
      expectedText: "Renew passport",
    });
    // Removed optimistically: one row is left until the server confirms.
    expect(rows()).toHaveLength(1);
  });
});

describe("TodoView — refusals", () => {
  /**
   * The 409 case: the item changed under the open tab. The optimistic state is
   * dropped, the document is refetched, and the reason is shown where the user
   * is looking — never a silent overwrite.
   */
  it("surfaces a refused write, drops the optimistic flip and refetches", async () => {
    const { wire, settle } = mount(ITEMS, {
      write: {
        status: 409,
        body: { code: "conflict", message: "item 0 is now “Something else”" },
      },
    });
    // Settle first: a refetch issued while the initial read is in flight would
    // be deduped into it, and the assertion below would prove nothing.
    await settle();
    const before = wire.calls.filter((call) => call.url.includes("/api/docs/doc_week")).length;
    fireEvent.click(screen.getByRole("button", { name: /Check “Renew passport”/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Something else");
    });
    // Back to the document's own state.
    expect(screen.getByRole("button", { name: /Check “Renew passport”/ })).toBeTruthy();
    // And a refetch of the document, so the truth replaces the hope.
    await waitFor(() => {
      expect(
        wire.calls.filter((call) => call.url.includes("/api/docs/doc_week")).length,
      ).toBeGreaterThan(before);
    });
  });

  it("names the refused operation when the server sends no readable body", async () => {
    const { settle } = mount(ITEMS, { write: { status: 500, body: null } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Check “Renew passport”/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("PUT /api/x/todos/doc_week/items/0");
    });
  });

  it("renders a notice plus the raw markdown body when items are malformed", () => {
    mount("not a list");
    expect(screen.getByRole("alert").textContent).toContain("could not be read");
    expect(screen.getByText(/items: must be a list of items/)).toBeTruthy();
    // The body is still shown, so nothing is hidden and the document stays
    // fixable — and the checkbox list is not rendered over unreadable state.
    expect(screen.getByText(/The raw body/)).toBeTruthy();
    expect(rows()).toEqual([]);
  });
});

describe("TodoView — locks", () => {
  const agentLock: Lock = { docId: "doc_week", holder: "agent", acquired: TS, ttl: 300 };

  it("renders read-only while the other party holds the lock", () => {
    const { wire } = mount(ITEMS, { locks: [agentLock] });
    return waitFor(() => {
      const box = screen.getByRole<HTMLButtonElement>("button", { name: /Check “Renew passport”/ });
      expect(box.disabled).toBe(true);
      expect(screen.getByLabelText<HTMLInputElement>("Item 1").readOnly).toBe(true);
      expect(screen.getByLabelText<HTMLInputElement>("Add an item").disabled).toBe(true);
      fireEvent.click(box);
      expect(wire.pluginCalls()).toEqual([]);
    });
  });

  it("stays writable under this session's own user lock", async () => {
    const { wire } = mount(ITEMS, { locks: [{ ...agentLock, holder: "user" }] });
    fireEvent.click(screen.getByRole("button", { name: /Check “Renew passport”/ }));
    await waitFor(() => {
      expect(wire.pluginCalls()).toHaveLength(1);
    });
  });
});

/** The `View` replaces the document surface wholesale; it must never throw into it. */
describe("TodoView — the error boundary is never reached", () => {
  it.each([
    ["a string", "nope"],
    ["a number", 7],
    ["items missing fields", [{ text: "a" }]],
    ["a null entry", [null]],
  ])("renders %s without throwing", (_name, items) => {
    expect((): ReactElement => {
      mount(items);
      return <div />;
    }).not.toThrow();
    cleanup();
  });
});
