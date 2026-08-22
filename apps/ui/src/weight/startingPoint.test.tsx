/** @vitest-environment jsdom */
import { createCorpusTestHarness, resetWeightChoices } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CommentPopover } from "../anchors/CommentPopover";
import { composeTransport } from "../compose/composeFixture";
import { ComposeOverlay } from "../compose/ComposeOverlay";
import { ASK_AGENT_LABEL, NOTE_ONLY_LABEL, ThreadComposer } from "../thread/ThreadComposer";
import { NewChildThread } from "../thread/NewChildThread";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { readerTransport, threadFixture, type ReaderTransport } from "../testing/readerFixture";
import {
  ORCHESTRATE_SKILL_ID,
  skillDoc,
  skillRow,
  THREE_LEVELS,
  weightWiring,
} from "../testing/weightFixture";

/**
 * The **per-conversation starting point**, and the **liveness** rule — the two
 * halves of §10's rider with a plausible-looking wrong implementation each.
 *
 * The starting point is a starting point and not a setting: it is one value per
 * conversation, visible the moment a composer opens, changeable in one gesture,
 * shared by every surface showing that conversation, and gone on a reload. The
 * liveness rule is presentation and nothing else: it never touches the ask-agent
 * toggle, never clears a choice, and never stands between send and the wire.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetWeightChoices();
});

function wire(body = THREE_LEVELS): ReaderTransport {
  return readerTransport({
    threads: [threadFixture({ id: "th_a", turns: [] }), threadFixture({ id: "th_b", turns: [] })],
    ...weightWiring(body),
  });
}

function Host({
  transport,
  children,
}: {
  readonly transport: ReaderTransport;
  readonly children: ReactElement;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return <harness.Wrapper>{children}</harness.Wrapper>;
}

const reply = (threadId: string): ReactElement => (
  <ThreadComposer threadId={threadId} resolved={false} onNotify={() => undefined} />
);

const pickers = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>("[data-composer-address]"),
];

function lineOf(address: HTMLElement): HTMLElement {
  const line = address.querySelector<HTMLElement>("[data-address-line]");
  if (line === null) throw new Error("no address line");
  return line;
}

function pressed(within: ParentNode = document): string[] {
  return [...within.querySelectorAll<HTMLElement>("[data-weight-key][aria-pressed='true']")].map(
    (option) => option.dataset["weightKey"] ?? "",
  );
}

/**
 * Waits for `count` composers and opens every address popover that offers one
 * (UI-126) — the levels sit behind the line now. A line that is plain text (a
 * floor, or nothing declared) is left as it is.
 */
async function drawn(count = 1): Promise<void> {
  await waitFor(() => {
    expect(pickers()).toHaveLength(count);
    for (const address of pickers()) {
      const line = lineOf(address);
      if (line.tagName === "BUTTON" && line.getAttribute("aria-expanded") !== "true") {
        fireEvent.click(line);
      }
    }
    expect(document.querySelectorAll("[data-weight-key]").length).toBeGreaterThan(0);
  });
}

describe("the starting point is per conversation", () => {
  it("is shown by every surface on that conversation at once — two columns agree", async () => {
    render(
      <Host transport={wire()}>
        <>
          {reply("th_a")}
          {reply("th_a")}
        </>
      </Host>,
    );
    await drawn(2);
    expect(pressed()).toEqual([]);

    const [first] = pickers();
    fireEvent.click(
      first?.querySelector<HTMLElement>("[data-weight-key='standard']") as HTMLElement,
    );

    // One value for one conversation, exactly as a collapse state is.
    for (const picker of pickers()) expect(pressed(picker)).toEqual(["standard"]);
  });

  it("says nothing about a different conversation", async () => {
    render(
      <Host transport={wire()}>
        <>
          {reply("th_a")}
          {reply("th_b")}
        </>
      </Host>,
    );
    await drawn(2);
    const [a, b] = pickers();
    fireEvent.click(a?.querySelector<HTMLElement>("[data-weight-key='heavy']") as HTMLElement);
    expect(pressed(a as HTMLElement)).toEqual(["heavy"]);
    expect(pressed(b as HTMLElement)).toEqual([]);
  });

  it("survives a send: the next reply in the same conversation starts from it", async () => {
    const transport = wire();
    const view = render(<Host transport={transport}>{reply("th_a")}</Host>);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Small and mechanical" }));

    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "first" } });
    fireEvent.keyDown(screen.getByLabelText("Reply"), { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
    });

    // Visibly, on the composer that is standing there afterwards…
    expect(pressed()).toEqual(["light"]);
    // …and on the request the next send makes, without touching the control.
    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "second" } });
    fireEvent.keyDown(screen.getByLabelText("Reply"), { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(2);
    });
    const second = transport.of("POST", "/api/threads/th_a/turns")[1]?.body as { weight?: string };
    expect(second.weight).toBe("light");

    // And it is changed in one gesture, never a setting acting on anyone unseen.
    fireEvent.click(screen.getByRole("button", { name: "Heavy or judgment-laden" }));
    expect(pressed()).toEqual(["heavy"]);
    view.unmount();
  });

  /**
   * The comment-on-a-turn box is the one composer whose control can never act:
   * it sends `requestsAgent: false` unconditionally. So it keeps a scope of its
   * own, in **both** directions — a dead control never seeds the live reply box,
   * and the reply box's choice is not reflected on a control that cannot honour
   * it (UI-082's PR #35 review; it shared the parent thread's scope until then).
   */
  it("cannot be seeded by the comment-on-a-turn box, which offers no control at all", async () => {
    // The old surface gave that box a dead control and a scope of its own to
    // stop the dead control seeding this live one. UI-126 removes the control
    // instead: the box is on the floor, so there is nothing there to leak.
    render(
      <Host transport={wire()}>
        <>
          {reply("th_a")}
          <NewChildThread
            parentThreadId="th_a"
            anchorText="a line of the turn"
            onDone={() => undefined}
            onCancel={() => undefined}
            onNotify={() => undefined}
          />
        </>
      </Host>,
    );
    await drawn(2);
    const [replyBox, childBox] = pickers();
    expect(childBox?.dataset["addressLive"]).toBe("false");
    expect(childBox?.querySelectorAll("[data-weight-key]")).toHaveLength(0);

    fireEvent.click(
      replyBox?.querySelector<HTMLElement>("[data-weight-key='standard']") as HTMLElement,
    );
    expect(pressed(replyBox as HTMLElement)).toEqual(["standard"]);
    expect(pressed(childBox as HTMLElement)).toEqual([]);
  });

  it("is not shared with a comment on a document, which is a different scope", async () => {
    render(
      <Host transport={wire()}>
        <>
          {reply("th_a")}
          <CommentPopover
            quote="a passage"
            top={10}
            left={10}
            pending={false}
            weightScope="doc:doc_a"
            recipientScope="doc_a"
            onSubmit={() => undefined}
            onClose={() => undefined}
          />
        </>
      </Host>,
    );
    await drawn(2);
    const [thread, document_] = pickers();
    fireEvent.click(thread?.querySelector<HTMLElement>("[data-weight-key='heavy']") as HTMLElement);
    expect(pressed(thread as HTMLElement)).toEqual(["heavy"]);
    expect(pressed(document_ as HTMLElement)).toEqual([]);
  });
});

describe("the starting point is browser-local", () => {
  it("is written to no storage, so a reload starts from nothing", async () => {
    render(<Host transport={wire()}>{reply("th_a")}</Host>);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    // The whole of "a reload clears it": there is nowhere for it to come back
    // from. `threadCollapse.ts` persists because a fold should outlive a reload;
    // this is about the request you are about to send, and §10 puts it in the
    // browser-local class without a durable home.
    expect(JSON.stringify(globalThis.localStorage)).not.toContain("standard");
    expect(JSON.stringify(globalThis.sessionStorage)).not.toContain("standard");
  });

  it("writes no field to any thread or document", async () => {
    const transport = wire();
    render(<Host transport={transport}>{reply("th_a")}</Host>);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    // Choosing is not a mutation. SHARED-022's Decision 3 rejects a per-thread
    // value written to the thread document by name.
    expect(transport.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
});

describe("liveness is presentation only", () => {
  it("is live while the composer says it is asking the agent", async () => {
    render(<Host transport={wire()}>{reply("th_a")}</Host>);
    await drawn();
    expect(pickers()[0]?.dataset["addressLive"]).toBe("true");
  });

  it("offers nothing on note only, states nothing, and keeps the choice", async () => {
    const transport = wire();
    render(<Host transport={transport}>{reply("th_a")}</Host>);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    fireEvent.click(screen.getByRole("button", { name: ASK_AGENT_LABEL }));

    expect(screen.getByRole("button", { name: NOTE_ONLY_LABEL })).toBeTruthy();
    // The floor (UI-126): nothing to weigh, so no levels are offered at all —
    // the old surface kept a dimmed control here, and what that control had
    // accepted was sent while nothing would read it.
    expect(pickers()[0]?.dataset["addressLive"]).toBe("false");
    expect(document.querySelectorAll("[data-weight-key]")).toHaveLength(0);

    // Nothing is stated either: a value the surface no longer shows must not
    // ride the wire — that is §10's "acts on you unseen" in wire form.
    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "a note" } });
    fireEvent.keyDown(screen.getByLabelText("Reply"), { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
    });
    const sent = transport.of("POST", "/api/threads/th_a/turns")[0]?.body as {
      requestsAgent?: boolean;
      weight?: string;
    };
    expect(sent.requestsAgent).toBe(false);
    expect("weight" in sent).toBe(false);

    // The choice was kept, not cleared: back on ask, it stands and travels.
    fireEvent.click(screen.getByRole("button", { name: NOTE_ONLY_LABEL }));
    await drawn();
    expect(pressed()).toEqual(["standard"]);
  });

  it("never touches the ask-agent toggle in return", async () => {
    render(<Host transport={wire()}>{reply("th_a")}</Host>);
    await drawn();
    const toggle = (): HTMLElement => document.querySelector(".toggle") as HTMLElement;
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Heavy or judgment-laden" }));
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(toggle().hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Heavy or judgment-laden" }));
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("offers nothing at all on a composer that never asks the agent", async () => {
    render(
      <Host transport={wire()}>
        <NewChildThread
          parentThreadId="th_a"
          anchorText="a line of the turn"
          onDone={() => undefined}
          onCancel={() => undefined}
          onNotify={() => undefined}
        />
      </Host>,
    );
    // A comment on a turn is a note until the child card's own composer says
    // otherwise, so it sits on the floor: the line says nobody is asked, and
    // there is no level anywhere to choose (UI-126).
    await waitFor(() => {
      expect(pickers()[0]?.dataset["addressLive"]).toBe("false");
    });
    expect(lineOf(pickers()[0] as HTMLElement).textContent).toContain("Nobody is asked");
    expect(document.querySelectorAll("[data-weight-key]")).toHaveLength(0);
  });

  it("is live on the global composer, whose both submits reach the agent", async () => {
    const transport = composeTransport({
      rows: [skillRow()],
      docs: { [ORCHESTRATE_SKILL_ID]: skillDoc(THREE_LEVELS) },
    });
    function ComposeHost(): ReactElement {
      const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
      return (
        <harness.Wrapper>
          <ComposeOverlay onClose={() => undefined} onNotify={() => undefined} />
        </harness.Wrapper>
      );
    }
    render(<ComposeHost />);
    await drawn();
    expect(pickers()[0]?.dataset["addressLive"]).toBe("true");
  });
});

describe("a level the guidance stops declaring", () => {
  it("is still shown and still stated — never silently rewritten", async () => {
    // Chosen while the workspace declared it…
    const view = render(<Host transport={wire()}>{reply("th_a")}</Host>);
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Small and mechanical" }));
    view.unmount();

    // …and the guidance is then edited to drop that row. The choice stands; the
    // disclosure of an unhonourable weight is the agent's job (SPEC.md §7).
    const edited = readerTransport({
      threads: [threadFixture({ id: "th_a", turns: [] })],
      ...weightWiring(
        [
          "| Weight | Key | Model | What falls here |",
          "| --- | --- | --- | --- |",
          "| Standard | standard | **A model** | Most work. |",
        ].join("\n"),
      ),
    });
    render(<Host transport={edited}>{reply("th_a")}</Host>);
    await drawn();
    expect(pressed()).toEqual(["light"]);
    expect(
      document.querySelector("[data-weight-key='light']")?.getAttribute("data-weight-undeclared"),
    ).toBe("true");

    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "still light" } });
    fireEvent.keyDown(screen.getByLabelText("Reply"), { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(edited.of("POST", "/api/threads/th_a/turns")).toHaveLength(1);
    });
    const sent = edited.of("POST", "/api/threads/th_a/turns")[0]?.body as { weight?: string };
    expect(sent.weight).toBe("light");
  });
});
