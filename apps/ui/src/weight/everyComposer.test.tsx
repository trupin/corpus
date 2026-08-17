/** @vitest-environment jsdom */
import { createCorpusTestHarness, resetWeightChoices } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentPopover } from "../anchors/CommentPopover";
import { composeTransport } from "../compose/composeFixture";
import { ComposeOverlay } from "../compose/ComposeOverlay";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { readerTransport, threadFixture } from "../testing/readerFixture";
import {
  FOUR_LEVELS,
  NO_LEVELS,
  ORCHESTRATE_SKILL_ID,
  RENAMED_LEVELS,
  skillDoc,
  skillRow,
  THREE_LEVELS,
  weightWiring,
} from "../testing/weightFixture";
import { NewChildThread } from "../thread/NewChildThread";
import { ThreadComposer } from "../thread/ThreadComposer";

/**
 * **Every** composer offers the weight, and the surfaces are enumerated here
 * rather than sampled (SPEC.md §11's rider, signed 2026-08-06; UI-082).
 *
 * The enumeration is the point. SHARED-012's lesson, learned the expensive way
 * in UI-070, is that a spec sentence phrased per surface gets implemented on one
 * of them: three of five composers shipped without attachments because the tests
 * checked one and asserted the rest by inspection. So the table below is §11's
 * table, one case each, and adding a composer to the app without adding it here
 * leaves a row of the spec untested rather than quietly satisfied.
 *
 * What each case pins is the same four sentences:
 *
 *   - the control is there, offering exactly what the workspace's guidance
 *     declares, in that order and with those names;
 *   - **nothing is preselected**, and an untouched composer states no weight;
 *   - a stated level rides out on the request the surface makes;
 *   - a workspace declaring nothing gets **no control at all** — the composer is
 *     indistinguishable from before this feature existed.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetWeightChoices();
});

/** What a surface stated, once it has sent. */
type Stated = Record<string, unknown>;

interface Probe {
  /** Types something and sends; resolves with the outgoing statement. */
  readonly send: () => Promise<Stated>;
  /** True once the workspace's skill has actually been read. */
  readonly declarationRead: () => boolean;
  /** The writing field, for the key-contract assertions. */
  readonly field: () => HTMLTextAreaElement;
}

interface Surface {
  readonly name: string;
  readonly mount: (body: string) => Probe;
}

/* -------------------------------------------------------------------------- */
/* Hosts                                                                      */
/* -------------------------------------------------------------------------- */

function ComposeHost({ transport }: { readonly transport: ReturnType<typeof composeTransport> }) {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <ComposeOverlay onClose={() => undefined} onNotify={() => undefined} />
    </harness.Wrapper>
  );
}

function ReaderHost({
  transport,
  children,
}: {
  readonly transport: ReturnType<typeof readerTransport>;
  readonly children: ReactElement;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return <harness.Wrapper>{children}</harness.Wrapper>;
}

function composeProbe(body: string, mode: "ask" | "capture"): Probe {
  const transport = composeTransport({
    rows: [skillRow()],
    docs: { [ORCHESTRATE_SKILL_ID]: skillDoc(body) },
  });
  render(<ComposeHost transport={transport} />);
  const field = (): HTMLTextAreaElement =>
    screen.getByLabelText<HTMLTextAreaElement>("Ask the agent, or capture a thought");
  const path = mode === "ask" ? "/api/threads" : "/api/capture";
  return {
    field,
    declarationRead: () => transport.to(`/api/docs/${ORCHESTRATE_SKILL_ID}`).length > 0,
    send: async () => {
      fireEvent.change(field(), { target: { value: "something to do" } });
      fireEvent.click(screen.getByRole("button", { name: mode === "ask" ? /^Ask/u : /^Capture/u }));
      await waitFor(() => {
        expect(transport.to(path)).toHaveLength(1);
      });
      const call = transport.to(path)[0];
      return call?.json ?? call?.form ?? {};
    },
  };
}

function threadProbe(body: string): Probe {
  const transport = readerTransport({
    threads: [threadFixture({ id: "th_a", turns: [] })],
    ...weightWiring(body),
  });
  render(
    <ReaderHost transport={transport}>
      <ThreadComposer threadId="th_a" resolved={false} onNotify={() => undefined} />
    </ReaderHost>,
  );
  const field = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>("Reply");
  return {
    field,
    declarationRead: () => transport.of("GET", `/api/docs/${ORCHESTRATE_SKILL_ID}`).length > 0,
    send: async () => {
      fireEvent.change(field(), { target: { value: "a reply" } });
      fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
      await waitFor(() => {
        expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
      });
      return (transport.of("POST", "/api/threads/th_a/turns")[0]?.body ?? {}) as Stated;
    },
  };
}

function childThreadProbe(body: string): Probe {
  const transport = readerTransport(weightWiring(body));
  render(
    <ReaderHost transport={transport}>
      <NewChildThread
        parentThreadId="th_a"
        anchorText="the line the comment hangs off"
        onDone={() => undefined}
        onCancel={() => undefined}
        onNotify={() => undefined}
      />
    </ReaderHost>,
  );
  const field = (): HTMLTextAreaElement =>
    screen.getByLabelText<HTMLTextAreaElement>("Comment on this turn");
  return {
    field,
    declarationRead: () => transport.of("GET", `/api/docs/${ORCHESTRATE_SKILL_ID}`).length > 0,
    send: async () => {
      fireEvent.change(field(), { target: { value: "a comment" } });
      fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
      await waitFor(() => {
        expect(transport.of("POST", "/api/threads")).toHaveLength(1);
      });
      return (transport.of("POST", "/api/threads")[0]?.body ?? {}) as Stated;
    },
  };
}

function commentPopoverProbe(body: string): Probe {
  const transport = readerTransport(weightWiring(body));
  const onSubmit = vi.fn();
  render(
    <ReaderHost transport={transport}>
      <CommentPopover
        quote="assume a 30-year fixed at 6.1%"
        top={120}
        left={80}
        pending={false}
        weightScope="doc:doc_a"
        recipientScope="doc_a"
        onSubmit={onSubmit}
        onClose={() => undefined}
      />
    </ReaderHost>,
  );
  const field = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>("Comment");
  return {
    field,
    declarationRead: () => transport.of("GET", `/api/docs/${ORCHESTRATE_SKILL_ID}`).length > 0,
    send: async () => {
      fireEvent.change(field(), { target: { value: "a comment" } });
      fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      // The popover's whole outgoing statement is what it hands its host; the
      // host forwarding it to `POST /api/threads` is pinned in
      // `useAnchorLayer.test.tsx` and `turnSelectionComment.test.tsx`.
      const [text, requestsAgent, weight] = onSubmit.mock.calls[0] as [
        string,
        boolean,
        Record<string, unknown>,
      ];
      return { body: text, requestsAgent, ...weight };
    },
  };
}

/** §11's enumeration, in §11's order. */
const SURFACES: readonly Surface[] = [
  { name: "the global composer — Ask", mount: (body) => composeProbe(body, "ask") },
  { name: "the global composer — Capture", mount: (body) => composeProbe(body, "capture") },
  { name: "a thread's reply box", mount: threadProbe },
  { name: "a comment on a document selection", mount: commentPopoverProbe },
  { name: "a comment on a turn", mount: childThreadProbe },
];

const picker = (): HTMLElement | null => document.querySelector("[data-weight-picker]");
const optionKeys = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-weight-key]")].map(
    (option) => option.dataset["weightKey"] ?? "",
  );
const optionLabels = (): (string | null)[] =>
  [...document.querySelectorAll("[data-weight-key]")].map((option) => option.textContent);

async function drawn(): Promise<HTMLElement> {
  return screen.findByRole("group", { name: "Weight" });
}

describe.each(SURFACES)("$name", (surface) => {
  it("offers the levels the workspace's guidance declares, in that order", async () => {
    surface.mount(THREE_LEVELS);
    await drawn();
    expect(optionKeys()).toEqual(["light", "standard", "heavy"]);
    expect(optionLabels()).toEqual(["Small and mechanical", "Standard", "Heavy or judgment-laden"]);
  });

  it("offers a renamed level under its new name, with no code change", async () => {
    surface.mount(RENAMED_LEVELS);
    await drawn();
    expect(optionLabels()).toEqual(["Small and mechanical", "Ordinary", "Heavy or judgment-laden"]);
    // The Key is untouched by the rename, which is what keeps a standing choice
    // resolvable across a guidance edit.
    expect(optionKeys()).toEqual(["light", "standard", "heavy"]);
  });

  it("offers a fourth level when the table declares a fourth row", async () => {
    surface.mount(FOUR_LEVELS);
    await drawn();
    expect(optionKeys()).toEqual(["light", "standard", "heavy", "exhaustive"]);
  });

  it("names no model — the Model column never reaches a composer", async () => {
    surface.mount(THREE_LEVELS);
    const group = await drawn();
    expect(group.textContent).not.toMatch(/A model|Haiku|Sonnet|Opus/u);
  });

  it("preselects nothing, and states no weight when nothing was chosen", async () => {
    const probe = surface.mount(THREE_LEVELS);
    await drawn();
    for (const option of document.querySelectorAll("[data-weight-key]")) {
      expect(option.getAttribute("aria-pressed")).toBe("false");
    }
    const sent = await probe.send();
    expect("weight" in sent).toBe(false);
  });

  it("carries the chosen level's Key on the request", async () => {
    const probe = surface.mount(THREE_LEVELS);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Heavy or judgment-laden" }));
    const sent = await probe.send();
    expect(sent["weight"]).toBe("heavy");
  });

  it("goes back to stating nothing when the choice is cleared", async () => {
    const probe = surface.mount(THREE_LEVELS);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    const sent = await probe.send();
    expect("weight" in sent).toBe(false);
  });

  it("offers no control at all when the workspace declares no levels", async () => {
    const probe = surface.mount(NO_LEVELS);
    await waitFor(() => {
      expect(probe.declarationRead()).toBe(true);
    });
    // Not a fallback list, not a disabled control, not a hint: nothing. A
    // workspace on an older template (SPEC.md §2.4) must be indistinguishable
    // from the app before this feature.
    expect(picker()).toBeNull();
    expect(optionKeys()).toEqual([]);
    const sent = await probe.send();
    expect("weight" in sent).toBe(false);
  });

  it("claims no key: ↵ is still a newline and ⌘↵ still sends", async () => {
    const probe = surface.mount(THREE_LEVELS);
    await drawn();
    fireEvent.change(probe.field(), { target: { value: "half a thought" } });
    // Not prevented — the field's own insertion is the behaviour (SPEC.md §11).
    expect(fireEvent.keyDown(probe.field(), { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(probe.field(), { key: "Enter", shiftKey: true })).toBe(true);
    // …and the control adds no binding of its own to the composer's field.
    const sent = await probe.send();
    expect(sent["body"] ?? sent["text"]).toBeDefined();
  });

  it("is operable from the keyboard — every option is a plain button", async () => {
    surface.mount(THREE_LEVELS);
    await drawn();
    for (const option of document.querySelectorAll("[data-weight-key]")) {
      expect(option.tagName).toBe("BUTTON");
      expect(option.getAttribute("type")).toBe("button");
    }
  });
});
