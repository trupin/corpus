/** @vitest-environment jsdom */
import { formAnswerRecords, formatFormAnswerBody, FormSchema, type Turn } from "@corpus/contract";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { readerTransport, threadFixture, type ReaderTransport } from "../testing/readerFixture";
import { ALREADY_ANSWERED_NOTICE } from "./FormBlock";
import { ThreadCard } from "./ThreadCard";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetSeenMarks();
});

const FORM_TS = "2026-07-01T10:07:00.000Z";

/** The legacy short spelling — one required choose-one field (SPEC.md §6). */
function legacyFence(info: string): string {
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

/** One of each of §6's three kinds, with the write field optional. */
const THREE_KINDS = [
  "```form",
  "fields:",
  "  - question: Which quote should I file?",
  "    kind: choose one",
  "    options:",
  "      - Lemonade — $1,840/yr",
  "      - State Farm — $1,975/yr",
  "  - question: Which riders do you want?",
  "    kind: choose any",
  "    options:",
  "      - Water backup",
  "      - Extended replacement",
  "  - question: Anything I should know?",
  "    kind: write",
  "    optional: true",
  "```",
].join("\n");

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

const agentTurn = (body: string): Turn => ({ author: "agent", ts: FORM_TS, body, model: null });

const formPost = `/api/threads/th_a/turns/${encodeURIComponent(FORM_TS)}/form`;

async function mounted(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(container.querySelector(".form-comment")).not.toBeNull();
  });
}

const submitButton = (container: HTMLElement): HTMLButtonElement =>
  container.querySelector(".form-submit") as HTMLButtonElement;

const fieldFor = (container: HTMLElement, question: string): HTMLElement => {
  const legend = [...container.querySelectorAll(".form-prompt")].find((node) =>
    node.textContent?.startsWith(question),
  );
  const field = legend?.closest(".form-field");
  if (!(field instanceof HTMLElement)) throw new Error(`no field for ${question}`);
  return field;
};

describe("a form in an agent turn", () => {
  it("renders one control per field, matched to what the field asks", async () => {
    const { container } = render(<Host transport={wire([agentTurn(THREE_KINDS)])} />);
    await mounted(container);

    expect(container.querySelectorAll(".form-field")).toHaveLength(3);

    const one = fieldFor(container, "Which quote should I file?");
    expect(within(one).getAllByRole("radio")).toHaveLength(2);
    expect(one.querySelector(".form-opt-label")?.textContent).toBe("Lemonade");
    expect(one.querySelector(".price")?.textContent).toBe("$1,840/yr");

    const any = fieldFor(container, "Which riders do you want?");
    expect(within(any).getAllByRole("checkbox")).toHaveLength(2);

    const write = fieldFor(container, "Anything I should know?");
    expect(write.querySelector("textarea")).not.toBeNull();
    expect(write.querySelectorAll(".form-opt")).toHaveLength(0);

    // The YAML itself is gone — the controls took its place.
    expect(container.querySelector(".turn-body")?.textContent).not.toContain("kind: choose any");
  });

  it("marks the required fields and leaves the optional one unmarked", async () => {
    const { container } = render(<Host transport={wire([agentTurn(THREE_KINDS)])} />);
    await mounted(container);
    expect(fieldFor(container, "Which quote should I file?").textContent).toContain("(required)");
    expect(fieldFor(container, "Which riders do you want?").textContent).toContain("(required)");
    expect(fieldFor(container, "Anything I should know?").textContent).not.toContain("(required)");
  });

  it("gates submit on the required fields and names the ones still missing", async () => {
    const { container } = render(<Host transport={wire([agentTurn(THREE_KINDS)])} />);
    await mounted(container);

    expect(submitButton(container).disabled).toBe(true);
    const missing = container.querySelector(".form-missing");
    expect(missing?.textContent).toContain("Which quote should I file?");
    expect(missing?.textContent).toContain("Which riders do you want?");
    // The submit points at the message rather than failing silently (§10).
    expect(submitButton(container).getAttribute("aria-describedby")).toBe(missing?.id);

    fireEvent.click(
      within(fieldFor(container, "Which quote should I file?")).getAllByRole(
        "radio",
      )[0] as HTMLElement,
    );
    expect(container.querySelector(".form-missing")?.textContent).not.toContain(
      "Which quote should I file?",
    );
    expect(submitButton(container).disabled).toBe(true);

    fireEvent.click(
      within(fieldFor(container, "Which riders do you want?")).getAllByRole(
        "checkbox",
      )[1] as HTMLElement,
    );
    expect(container.querySelector(".form-missing")).toBeNull();
    expect(submitButton(container).disabled).toBe(false);
  });

  it("submits every kind at once, and omits the field left blank", async () => {
    const transport = wire([agentTurn(THREE_KINDS)]);
    const { container } = render(<Host transport={transport} />);
    await mounted(container);

    const quote = fieldFor(container, "Which quote should I file?");
    fireEvent.click(within(quote).getAllByRole("radio")[1] as HTMLElement);
    const riders = within(fieldFor(container, "Which riders do you want?")).getAllByRole(
      "checkbox",
    );
    fireEvent.click(riders[0] as HTMLElement);
    fireEvent.click(riders[1] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "  cheapest  " } });
    fireEvent.click(submitButton(container));

    await waitFor(() => {
      expect(transport.of("POST").some((call) => call.path.endsWith("/form"))).toBe(true);
    });
    const call = transport.of("POST").find((entry) => entry.path.endsWith("/form"));
    expect(call?.path).toBe(formPost);
    expect(call?.body).toEqual({
      answers: [
        { question: "Which quote should I file?", option: "State Farm — $1,975/yr" },
        {
          question: "Which riders do you want?",
          options: ["Water backup", "Extended replacement"],
        },
      ],
      note: "cheapest",
    });
    // Never a hand-composed turn: that path writes no `form.respond` event.
    expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(0);
  });

  it("selects one option at a time in a choose-one field", async () => {
    const { container } = render(<Host transport={wire([agentTurn(THREE_KINDS)])} />);
    await mounted(container);
    const quote = fieldFor(container, "Which quote should I file?");
    const radios = within(quote).getAllByRole("radio");
    fireEvent.click(radios[0] as HTMLElement);
    fireEvent.click(radios[1] as HTMLElement);
    expect(quote.querySelectorAll(".form-opt.picked")).toHaveLength(1);
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
  });

  /**
   * §10: "everything is reachable from the keyboard: no answer is available only
   * to a pointer". Asserted rather than assumed — the mockup's `hidden` radios
   * would pass every click test above and be unreachable by tab.
   */
  it("keeps every control in the tab order, submit included", async () => {
    const { container } = render(<Host transport={wire([agentTurn(THREE_KINDS)])} />);
    await mounted(container);
    const form = container.querySelector(".form-comment") as HTMLElement;
    const focusable = [
      ...form.querySelectorAll<HTMLElement>("input, textarea, button, select, [tabindex]"),
    ].filter((node) => node.getAttribute("tabindex") !== "-1" && !node.hasAttribute("hidden"));
    // 2 radios + 2 checkboxes + 1 textarea + the note + the submit.
    expect(focusable).toHaveLength(7);
    expect(focusable.at(-1)).toBe(submitButton(container));
  });

  it("answers on the key the submit names", async () => {
    const transport = wire([agentTurn(THREE_KINDS)]);
    const { container } = render(<Host transport={transport} />);
    await mounted(container);
    expect(submitButton(container).textContent).toContain("⌘↵");

    fireEvent.click(
      within(fieldFor(container, "Which quote should I file?")).getAllByRole(
        "radio",
      )[0] as HTMLElement,
    );
    fireEvent.click(
      within(fieldFor(container, "Which riders do you want?")).getAllByRole(
        "checkbox",
      )[0] as HTMLElement,
    );
    fireEvent.keyDown(container.querySelector(".form-comment") as HTMLElement, {
      key: "Enter",
      metaKey: true,
    });
    await waitFor(() => {
      expect(transport.of("POST").some((call) => call.path.endsWith("/form"))).toBe(true);
    });
  });

  it("sends nothing for a blank write field, rather than an empty string", async () => {
    const optional = [
      "```form",
      "fields:",
      "  - question: Anything?",
      "    kind: write",
      "    optional: true",
      "```",
    ].join("\n");
    const transport = wire([agentTurn(optional)]);
    const { container } = render(<Host transport={transport} />);
    await mounted(container);
    // A form whose only field is optional: submit is available immediately.
    expect(submitButton(container).disabled).toBe(false);
    fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, {
      target: { value: "   " },
    });
    fireEvent.click(submitButton(container));
    await waitFor(() => {
      expect(transport.of("POST").some((call) => call.path.endsWith("/form"))).toBe(true);
    });
    expect(transport.of("POST").find((entry) => entry.path.endsWith("/form"))?.body).toEqual({
      answers: [],
    });
  });

  it("renders a legacy prompt+options form as one required choose-one control", async () => {
    const transport = wire([agentTurn(legacyFence("form"))]);
    const { container } = render(<Host transport={transport} />);
    await mounted(container);
    expect(container.querySelectorAll(".form-field")).toHaveLength(1);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(submitButton(container).disabled).toBe(true);

    fireEvent.click(screen.getAllByRole("radio")[0] as HTMLElement);
    fireEvent.click(submitButton(container));
    await waitFor(() => {
      expect(transport.of("POST").some((call) => call.path.endsWith("/form"))).toBe(true);
    });
    expect(transport.of("POST").find((entry) => entry.path.endsWith("/form"))?.body).toEqual({
      answers: [{ question: "Which quote should I file?", option: "Lemonade — $1,840/yr" }],
    });
  });

  /** The contract matches the info string whole (`schemas/form.ts`). */
  it.each(["formula", "form-builder"])("leaves ```%s an ordinary code block", async (info) => {
    const { container } = render(<Host transport={wire([agentTurn(legacyFence(info))])} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".turn")).toHaveLength(1);
    });
    expect(container.querySelector(".form-comment")).toBeNull();
    expect(container.querySelector(".turn-body pre code")?.textContent).toContain("prompt:");
  });
});

/**
 * PR #28 finding 7. §6 says an optional field is one the person may leave blank,
 * and that a form is answered once as a whole — so an optional single-select
 * that cannot be un-chosen makes a mis-click unrecoverable *and* silent: what
 * the agent is told changes and nothing says so. AGENT-017 tells the agent to
 * mark fields optional generously, so this is the common case, not the exotic
 * one.
 */
describe("an optional choose-one can be returned to blank", () => {
  const OPTIONAL_CHOICE = [
    "```form",
    "fields:",
    "  - question: Which quote should I file?",
    "    kind: choose one",
    "    optional: true",
    "    options:",
    "      - Lemonade — $1,840/yr",
    "      - State Farm — $1,975/yr",
    "```",
  ].join("\n");

  const blankRow = (container: HTMLElement): HTMLInputElement =>
    container.querySelector(".form-opt-blank input") as HTMLInputElement;

  it("starts blank, and says so, rather than starting on nothing at all", async () => {
    const { container } = render(<Host transport={wire([agentTurn(OPTIONAL_CHOICE)])} />);
    await mounted(container);

    const field = fieldFor(container, "Which quote should I file?");
    // The two offered answers, plus the way back out of them.
    expect(within(field).getAllByRole("radio")).toHaveLength(3);
    expect(blankRow(container).checked).toBe(true);
    expect(field.querySelector(".form-opt-blank")?.textContent).toContain("Leave blank");
    // Blank is shown as a chosen state, not as the absence of one.
    expect(field.querySelectorAll(".form-opt.picked")).toHaveLength(1);
    expect(field.querySelector(".form-opt.picked")?.classList).toContain("form-opt-blank");
  });

  it("un-chooses a mis-clicked option and sends no entry at all", async () => {
    const transport = wire([agentTurn(OPTIONAL_CHOICE)]);
    const { container } = render(<Host transport={transport} />);
    await mounted(container);

    const field = fieldFor(container, "Which quote should I file?");
    const radios = within(field).getAllByRole("radio");
    fireEvent.click(radios[0] as HTMLElement);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    expect(blankRow(container).checked).toBe(false);

    fireEvent.click(blankRow(container));
    expect((radios[0] as HTMLInputElement).checked).toBe(false);
    expect(blankRow(container).checked).toBe(true);

    fireEvent.click(submitButton(container));
    await waitFor(() => {
      expect(transport.of("POST").some((call) => call.path.endsWith("/form"))).toBe(true);
    });
    // `formDraft`'s single spelling of blank: absent, never `option: ""` — which
    // the server reads as a value and refuses.
    expect(transport.of("POST").find((entry) => entry.path.endsWith("/form"))?.body).toEqual({
      answers: [],
    });
  });

  /**
   * PR #28 re-review, MINOR. `Leave blank` is a legal option — `collidingOption`
   * correctly does not ban it — so a `choose one` that offers it would put two
   * radios with the same accessible name in one group, and nothing but DOM order
   * would tell them apart. The escape hatch is the one control the UI adds
   * itself, so it is the one that says which field it empties; the visible label
   * is unchanged and is a prefix of the name (WCAG 2.5.3).
   */
  it("stays distinguishable from an option literally spelled “Leave blank”", async () => {
    const colliding = [
      "```form",
      "fields:",
      "  - question: Which quote should I file?",
      "    kind: choose one",
      "    optional: true",
      "    options:",
      "      - Leave blank",
      "      - Lemonade — $1,840/yr",
      "```",
    ].join("\n");
    const { container } = render(<Host transport={wire([agentTurn(colliding)])} />);
    await mounted(container);

    const field = fieldFor(container, "Which quote should I file?");
    const names = within(field)
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("aria-label") ?? radio.closest("label")?.textContent);
    expect(new Set(names).size).toBe(names.length);

    // The offered answer keeps the form's own words, verbatim.
    expect(names).toContain("Leave blank");
    // And the escape hatch still reads as "Leave blank" on screen.
    expect(field.querySelector(".form-opt-blank .form-opt-label")?.textContent).toBe("Leave blank");
    expect(field.querySelector(".form-opt-blank input")?.getAttribute("aria-label")).toContain(
      "Which quote should I file?",
    );
  });

  /**
   * A member of the group, not a button beside it: that is what puts it under
   * the same arrow keys as every other option (SPEC.md §10 — no answer is
   * available only to a pointer).
   */
  it("is a member of the same radio group as the options", async () => {
    const { container } = render(<Host transport={wire([agentTurn(OPTIONAL_CHOICE)])} />);
    await mounted(container);
    const names = new Set(
      within(fieldFor(container, "Which quote should I file?"))
        .getAllByRole("radio")
        .map((radio) => (radio as HTMLInputElement).name),
    );
    expect(names.size).toBe(1);
  });

  /**
   * Only a radio group needs one. A required field has no blank state to return
   * to, a checkbox unticks itself, and a `write` field empties when the text is
   * deleted — a clear affordance on any of those would be a second way to say
   * something the control already says.
   */
  it("appears on no other field", async () => {
    const { container } = render(<Host transport={wire([agentTurn(THREE_KINDS)])} />);
    await mounted(container);
    expect(container.querySelectorAll(".form-opt-blank")).toHaveLength(0);
    expect(
      within(fieldFor(container, "Which quote should I file?")).getAllByRole("radio"),
    ).toHaveLength(2);
  });
});

describe("an answered form is a record", () => {
  const FORM = FormSchema.parse(
    // Same YAML the fence carries, read through the contract so the test cannot
    // drift from what the component is handed.
    {
      fields: [
        {
          question: "Which quote should I file?",
          kind: "choose one",
          options: ["Lemonade — $1,840/yr", "State Farm — $1,975/yr"],
        },
        {
          question: "Which riders do you want?",
          kind: "choose any",
          options: ["Water backup", "Extended replacement"],
        },
        { question: "Anything I should know?", kind: "write", optional: true },
      ],
    },
  );

  /** Exactly the prose the server writes — the answered form's only durable input. */
  const answerTurn = (): Turn => ({
    author: "user",
    ts: "2026-07-01T10:09:00.000Z",
    body: formatFormAnswerBody({
      answers: formAnswerRecords(FORM, {
        answers: [
          { question: "Which quote should I file?", option: "State Farm — $1,975/yr" },
          { question: "Which riders do you want?", options: ["Water backup"] },
        ],
        note: "cheapest one",
      }),
      note: "cheapest one",
    }),
    model: null,
  });

  it("shows each question beside what was given, and no controls at all", async () => {
    const { container } = render(<Host transport={wire([agentTurn(THREE_KINDS), answerTurn()])} />);
    await mounted(container);

    const record = container.querySelector(".form-comment.form-answered");
    expect(record).not.toBeNull();
    const rows = [...(record?.querySelectorAll(".form-record-row") ?? [])];
    expect(rows.map((row) => row.querySelector(".form-record-q")?.textContent)).toEqual([
      "Which quote should I file?",
      "Which riders do you want?",
      "Anything I should know?",
    ]);
    expect(rows.map((row) => row.querySelector(".form-record-a")?.textContent)).toEqual([
      "State Farm — $1,975/yr",
      "Water backup",
      "left blank",
    ]);
    expect(record?.textContent).toContain("cheapest one");

    // There is no way to submit a second answer: the controls are gone, not
    // disabled (SPEC.md §10).
    expect(container.querySelector(".form-submit")).toBeNull();
    expect(container.querySelectorAll(".form-opt")).toHaveLength(0);
    expect(container.querySelector(".form-comment textarea")).toBeNull();
  });

  it("reads the same record after a reload, from the turn's prose alone", async () => {
    // No `submitted` pairing exists here — this is a fresh mount over turns
    // fetched from the server, which is what a reload is.
    const { container } = render(<Host transport={wire([agentTurn(THREE_KINDS), answerTurn()])} />);
    await mounted(container);
    expect(container.querySelector('[data-answered="true"]')).not.toBeNull();
  });

  it("becomes the record in place once submitted, without a reload", async () => {
    const transport = wire([agentTurn(THREE_KINDS)]);
    const { container } = render(<Host transport={transport} />);
    await mounted(container);
    fireEvent.click(
      within(fieldFor(container, "Which quote should I file?")).getAllByRole(
        "radio",
      )[0] as HTMLElement,
    );
    fireEvent.click(
      within(fieldFor(container, "Which riders do you want?")).getAllByRole(
        "checkbox",
      )[0] as HTMLElement,
    );
    fireEvent.click(submitButton(container));

    await waitFor(() => {
      expect(container.querySelector('[data-answered="true"]')).not.toBeNull();
    });
    expect(container.querySelector(".form-record-a")?.textContent).toBe("Lemonade — $1,840/yr");
  });

  /**
   * A form answered by another column or another browser between render and
   * submit. `409` says the *state* refused a well-formed request, and a message
   * reading like a validation failure would send someone hunting for a bad
   * option (SPEC.md §6, §10).
   */
  it("reports a refused re-answer as already answered, not as an error to retry", async () => {
    const notify = vi.fn();
    const transport = wire([agentTurn(THREE_KINDS)], { [`POST ${formPost}`]: 409 });
    const { container } = render(<Host transport={transport} onNotify={notify} />);
    await mounted(container);
    fireEvent.click(
      within(fieldFor(container, "Which quote should I file?")).getAllByRole(
        "radio",
      )[0] as HTMLElement,
    );
    fireEvent.click(
      within(fieldFor(container, "Which riders do you want?")).getAllByRole(
        "checkbox",
      )[0] as HTMLElement,
    );
    fireEvent.click(submitButton(container));

    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    expect(notify.mock.calls[0]?.[0]).toEqual({ tone: "error", message: ALREADY_ANSWERED_NOTICE });
    expect(container.querySelector(".form-submit")).not.toBeNull();
  });

  /**
   * The backstop is still a backstop, and what it says is a sentence rather
   * than a request (PR #28 re-review, MAJOR). A refusal the client cannot
   * anticipate — an unterminated fence, a fabricated turn heading, anything a
   * later server grows — still arrives as a toast, and that toast used to lead
   * with `POST /api/threads/{id}/turns/{ts}/form failed (HTTP 400): `: an
   * un-substituted route template and a status ahead of the only sentence a
   * person can act on, in a 360px box that dismisses itself after six seconds.
   */
  it("surfaces any other rejection as itself and keeps the controls", async () => {
    const notify = vi.fn();
    const transport = wire([agentTurn(THREE_KINDS)], { [`POST ${formPost}`]: 400 });
    const { container } = render(<Host transport={transport} onNotify={notify} />);
    await mounted(container);
    fireEvent.click(
      within(fieldFor(container, "Which quote should I file?")).getAllByRole(
        "radio",
      )[0] as HTMLElement,
    );
    fireEvent.click(
      within(fieldFor(container, "Which riders do you want?")).getAllByRole(
        "checkbox",
      )[0] as HTMLElement,
    );
    fireEvent.click(submitButton(container));
    await waitFor(() => {
      expect(notify).toHaveBeenCalled();
    });
    const notice = notify.mock.calls[0]?.[0] as { tone: string; message: string } | undefined;
    expect(notice?.tone).toBe("error");
    expect(notice?.message).not.toBe(ALREADY_ANSWERED_NOTICE);
    // The server's own sentence, and nothing of the request's shape.
    expect(notice?.message).toBe("Answer failed — the server refused");
    expect(notice?.message).not.toContain("/api/");
    expect(notice?.message).not.toContain("HTTP");
    expect(container.querySelector(".form-submit")).not.toBeNull();
  });
});

/**
 * PR #28 re-review, MAJOR. An answer whose own text would make the record
 * unreadable is refused by the server; `**Note:**` on its own line is ordinary
 * markdown in a documents app, and AGENT-017 pushes the agent toward `write`
 * fields, so this is a mainline typo rather than an exotic one. §10's posture
 * for a form that cannot be submitted is that the form says which question is
 * the problem — not that the attempt fails and a toast explains it afterwards.
 */
describe("an answer that would not read back is refused in the form", () => {
  const TWO_WRITES = [
    "```form",
    "fields:",
    "  - question: What happened?",
    "    kind: write",
    "  - question: Anything I should know?",
    "    kind: write",
    "    optional: true",
    "```",
  ].join("\n");

  const typeInto = (container: HTMLElement, question: string, value: string): void => {
    fireEvent.change(
      fieldFor(container, question).querySelector("textarea") as HTMLTextAreaElement,
      { target: { value } },
    );
  };

  const faultIn = (container: HTMLElement, question: string): HTMLElement | null =>
    fieldFor(container, question).querySelector(".form-unreadable");

  it("says so at the field, names the offending line, and sends nothing", async () => {
    const transport = wire([agentTurn(TWO_WRITES)]);
    const { container } = render(<Host transport={transport} />);
    await mounted(container);

    typeInto(container, "What happened?", "the file moved\n\n**Note:**\n\nmine");

    const fault = faultIn(container, "What happened?");
    expect(fault?.textContent).toContain("**Note:**");
    expect(fault?.textContent).toContain("rewrite that line");
    // The other field is innocent and is not marked.
    expect(faultIn(container, "Anything I should know?")).toBeNull();

    // The control points at its own explanation, and so does the submit.
    const textarea = fieldFor(container, "What happened?").querySelector("textarea");
    expect(textarea?.getAttribute("aria-invalid")).toBe("true");
    expect(textarea?.getAttribute("aria-describedby")).toBe(fault?.id);
    expect(submitButton(container).getAttribute("aria-describedby")).toContain(fault?.id ?? "");

    // Nothing reaches the wire: the round trip is what this replaces.
    expect(submitButton(container).disabled).toBe(true);
    fireEvent.click(submitButton(container));
    fireEvent.keyDown(container.querySelector(".form-comment") as HTMLElement, {
      key: "Enter",
      metaKey: true,
    });
    expect(transport.of("POST").filter((call) => call.path.endsWith("/form"))).toHaveLength(0);
  });

  it("clears the moment the line is rewritten, and then submits", async () => {
    const transport = wire([agentTurn(TWO_WRITES)]);
    const { container } = render(<Host transport={transport} />);
    await mounted(container);

    typeInto(container, "What happened?", "**Note:**");
    expect(submitButton(container).disabled).toBe(true);

    typeInto(container, "What happened?", "Note: the file moved");
    expect(faultIn(container, "What happened?")).toBeNull();
    expect(submitButton(container).disabled).toBe(false);

    fireEvent.click(submitButton(container));
    await waitFor(() => {
      expect(transport.of("POST").some((call) => call.path.endsWith("/form"))).toBe(true);
    });
  });

  /** The note is arbitrary text too, and it is checked with the rest of the record. */
  it("keeps the draft intact so the person can fix it rather than retype it", async () => {
    const { container } = render(<Host transport={wire([agentTurn(TWO_WRITES)])} />);
    await mounted(container);

    typeInto(container, "What happened?", "the roof leaked");
    typeInto(container, "Anything I should know?", "**Note:**");
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "keep me" } });

    expect(faultIn(container, "Anything I should know?")).not.toBeNull();
    expect(
      (fieldFor(container, "What happened?").querySelector("textarea") as HTMLTextAreaElement)
        .value,
    ).toBe("the roof leaked");
    expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("keep me");
  });
});

/**
 * §10: a form the app cannot read renders as the visibly broken code block it
 * is — **never as a partial set of controls**. One case per failure mode: the
 * tempting implementation renders the fields it understood and drops the one it
 * did not, which shows a person three of four questions as though they were the
 * whole ask.
 */
describe("a form the app cannot read", () => {
  const broken = async (yaml: readonly string[]): Promise<HTMLElement> => {
    const { container } = render(
      <Host transport={wire([agentTurn(["```form", ...yaml, "```"].join("\n"))])} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".form-broken")).not.toBeNull();
    });
    return container;
  };

  const assertNoControls = (container: HTMLElement): void => {
    expect(container.querySelector(".form-comment")).toBeNull();
    expect(container.querySelector(".form-submit")).toBeNull();
    expect(container.querySelectorAll(".form-opt")).toHaveLength(0);
    expect(container.querySelector(".form-warning")?.textContent).toContain(
      "This form could not be read",
    );
  };

  it("renders unparseable YAML raw", async () => {
    const container = await broken(["prompt: [unclosed"]);
    assertNoControls(container);
    expect(container.querySelector(".form-broken pre code")?.textContent).toContain("prompt:");
  });

  it("renders a fourth kind raw, rather than the fields it did understand", async () => {
    const container = await broken([
      "fields:",
      "  - question: Which quote?",
      "    kind: choose one",
      "    options:",
      "      - Lemonade",
      "  - question: How much?",
      "    kind: number",
    ]);
    assertNoControls(container);
    // The half it could read must not be on screen as a whole ask.
    expect(container.querySelector(".turn-body")?.textContent).not.toContain("Lemonade — ");
  });

  it("renders a write field carrying options raw", async () => {
    assertNoControls(
      await broken([
        "fields:",
        "  - question: Anything?",
        "    kind: write",
        "    options:",
        "      - a",
      ]),
    );
  });

  it("renders a misspelled key raw rather than silently leaving a field required", async () => {
    assertNoControls(
      await broken([
        "fields:",
        "  - question: Anything?",
        "    kind: write",
        "    optionnal: true",
      ]),
    );
  });
});

/** §6 says a form is something an *agent* turn carries. */
it("does not offer controls for a form quoted in a user turn", async () => {
  const { container } = render(
    <Host transport={wire([{ author: "user", ts: FORM_TS, body: THREE_KINDS, model: null }])} />,
  );
  await waitFor(() => {
    expect(container.querySelectorAll(".turn")).toHaveLength(1);
  });
  expect(container.querySelector(".form-submit")).toBeNull();
  expect(container.querySelector(".form-comment")).toBeNull();
});
