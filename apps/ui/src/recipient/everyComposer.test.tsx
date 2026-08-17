/** @vitest-environment jsdom */
import { CorpusRequestError, ORCHESTRATOR_LABEL } from "@corpus/kit";
import { createCorpusTestHarness, resetWeightChoices } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentPopover, restoredRecipient } from "../anchors/CommentPopover";
import { composeTransport } from "../compose/composeFixture";
import { ComposeOverlay } from "../compose/ComposeOverlay";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { readerTransport, threadFixture } from "../testing/readerFixture";
import { residentLane, RESIDENT_NAME, RESIDENT_THREAD_ID } from "../testing/recipientFixture";
import { NewChildThread } from "../thread/NewChildThread";
import { ThreadComposer } from "../thread/ThreadComposer";

/**
 * **Every** composer that can wake an agent offers the recipient, and the
 * surfaces are enumerated here rather than sampled (SPEC.md §7's *"the composer
 * offers the live roster"*; UI-108).
 *
 * The enumeration is the point, and it is the same lesson `../weight/
 * everyComposer.test.tsx` was written for (SHARED-012, learned the expensive way
 * in UI-070): a sentence phrased per surface gets implemented on one of them.
 *
 * What each case pins is §7's paragraph, clause by clause:
 *
 *   - **the default is computed, never chosen** — the composer shows who will
 *     answer without anyone touching it;
 *   - **and it travels by being absent** — an untouched composer states no
 *     `recipient` at all, which is what stops the client's rule and the server's
 *     from ever disagreeing about it;
 *   - **an override routes that message and nothing else** — it appears on the
 *     wire once, it re-designates nothing, it rewires no scope, and the next
 *     message is back to the default;
 *   - **the roster is what is offered**, and a workspace with nothing designated
 *     gets no control at all.
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
  /** Every request the surface made, as `"<METHOD> <pathname>"`. */
  readonly calls: () => readonly string[];
}

interface Surface {
  readonly name: string;
  readonly mount: (lanes: readonly ReturnType<typeof residentLane>[]) => Probe;
  /**
   * The lane a send from this surface goes to with nothing picked — §7's
   * *"posting inside a designated scope addresses that scope's resident;
   * posting anywhere else addresses the orchestrator"*, one surface at a time.
   */
  readonly computed: string;
  /** The other lane on the roster, which is therefore this surface's override. */
  readonly other: string;
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

/* -------------------------------------------------------------------------- */
/* Probes                                                                     */
/* -------------------------------------------------------------------------- */

function composeProbe(lanes: readonly ReturnType<typeof residentLane>[]): Probe {
  const transport = composeTransport({ lanes });
  render(<ComposeHost transport={transport} />);
  const field = (): HTMLTextAreaElement =>
    screen.getByLabelText<HTMLTextAreaElement>("Ask the agent, or capture a thought");
  return {
    calls: () => transport.calls.map((call) => `${call.method} ${call.path}`),
    send: async () => {
      fireEvent.change(field(), { target: { value: "something to do" } });
      fireEvent.click(screen.getByRole("button", { name: /^Ask/u }));
      await waitFor(() => {
        expect(transport.to("/api/threads")).toHaveLength(1);
      });
      const call = transport.to("/api/threads")[0];
      return call?.json ?? call?.form ?? {};
    },
  };
}

function threadProbe(lanes: readonly ReturnType<typeof residentLane>[]): Probe {
  const transport = readerTransport({
    lanes,
    threads: [threadFixture({ id: RESIDENT_THREAD_ID, turns: [] })],
  });
  render(
    <ReaderHost transport={transport}>
      <ThreadComposer threadId={RESIDENT_THREAD_ID} resolved={false} onNotify={() => undefined} />
    </ReaderHost>,
  );
  const field = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>("Reply");
  const path = `/api/threads/${RESIDENT_THREAD_ID}/turns`;
  return {
    calls: () => transport.calls.map((call) => `${call.method} ${call.path}`),
    send: async () => {
      fireEvent.change(field(), { target: { value: "a reply" } });
      fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
      await waitFor(() => {
        expect(transport.of("POST", path).length).toBeGreaterThan(0);
      });
      const sent = transport.of("POST", path);
      return (sent[sent.length - 1]?.body ?? {}) as Stated;
    },
  };
}

function childThreadProbe(lanes: readonly ReturnType<typeof residentLane>[]): Probe {
  const transport = readerTransport({ lanes });
  render(
    <ReaderHost transport={transport}>
      <NewChildThread
        parentThreadId={RESIDENT_THREAD_ID}
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
    calls: () => transport.calls.map((call) => `${call.method} ${call.path}`),
    send: async () => {
      fireEvent.change(field(), { target: { value: "a comment" } });
      fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
      await waitFor(() => {
        expect(transport.of("POST", "/api/threads").length).toBeGreaterThan(0);
      });
      const sent = transport.of("POST", "/api/threads");
      return (sent[sent.length - 1]?.body ?? {}) as Stated;
    },
  };
}

/**
 * The popover in both placements at once is not worth a second probe: it is one
 * component whose host supplies `recipientScope`, and what it hands its host is
 * what the host puts on the wire (pinned in `useAnchorLayer.test.tsx` and
 * `turnSelectionComment.test.tsx`). Mounted here on the *thread* placement,
 * which is the one where the scope is designated.
 */
function commentPopoverProbe(lanes: readonly ReturnType<typeof residentLane>[]): Probe {
  const transport = readerTransport({ lanes });
  const onSubmit = vi.fn();
  render(
    <ReaderHost transport={transport}>
      <CommentPopover
        quote="assume a 30-year fixed at 6.1%"
        top={120}
        left={80}
        pending={false}
        weightScope={`thread:${RESIDENT_THREAD_ID}`}
        recipientScope={RESIDENT_THREAD_ID}
        onSubmit={onSubmit}
        onClose={() => undefined}
      />
    </ReaderHost>,
  );
  const field = (): HTMLTextAreaElement => screen.getByLabelText<HTMLTextAreaElement>("Comment");
  return {
    calls: () => transport.calls.map((call) => `${call.method} ${call.path}`),
    send: async () => {
      fireEvent.change(field(), { target: { value: "a comment" } });
      fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      const calls = onSubmit.mock.calls;
      const [text, requestsAgent, stated] = calls[calls.length - 1] as [
        string,
        boolean,
        Record<string, unknown>,
      ];
      return { body: text, requestsAgent, ...stated };
    },
  };
}

/**
 * §7's surfaces, in §11's order — each with the lane its location computes.
 *
 * The global composer is the one whose default is the orchestrator, because its
 * Ask creates a **standalone** thread that is in no scope by construction; on it
 * the override is the resident, which is §7's summons. Everywhere else the
 * composer sits inside the designated conversation and the default is its
 * resident.
 */
const SURFACES: readonly Surface[] = [
  {
    name: "the global composer — Ask",
    mount: composeProbe,
    computed: "orchestrator",
    other: RESIDENT_THREAD_ID,
  },
  {
    name: "a thread's reply box",
    mount: threadProbe,
    computed: RESIDENT_THREAD_ID,
    other: "orchestrator",
  },
  {
    name: "a comment on a selection",
    mount: commentPopoverProbe,
    computed: RESIDENT_THREAD_ID,
    other: "orchestrator",
  },
  {
    name: "a comment on a turn",
    mount: childThreadProbe,
    computed: RESIDENT_THREAD_ID,
    other: "orchestrator",
  },
];

const lanesShown = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-recipient-lane]")].map(
    (option) => option.dataset["recipientLane"] ?? "",
  );

const picker = (): HTMLElement | null => document.querySelector("[data-recipient-picker]");

const laneOption = (lane: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-recipient-lane="${lane}"]`);
  if (found === null) throw new Error(`no option for lane ${lane}`);
  return found;
};

async function offered(): Promise<void> {
  await waitFor(() => {
    expect(lanesShown()).toEqual(["orchestrator", RESIDENT_THREAD_ID]);
  });
}

describe.each(SURFACES)("$name", (surface) => {
  it("offers the roster's lanes, the orchestrator's first", async () => {
    surface.mount([residentLane()]);
    await offered();
    expect(laneOption("orchestrator").textContent).toContain(ORCHESTRATOR_LABEL);
    expect(laneOption(RESIDENT_THREAD_ID).textContent).toContain(RESIDENT_NAME);
  });

  it("offers no control at all when the workspace has designated nothing", async () => {
    const probe = surface.mount([]);
    // Nothing to choose between, one possible answer: the composer is
    // indistinguishable from before this feature.
    await waitFor(() => {
      expect(probe.calls()).toContain("GET /api/agents");
    });
    expect(picker()).toBeNull();
    const sent = await probe.send();
    expect("recipient" in sent).toBe(false);
  });

  it("states no recipient when nothing was picked — the default travels by absence", async () => {
    const probe = surface.mount([residentLane()]);
    await offered();
    const sent = await probe.send();
    expect("recipient" in sent).toBe(false);
  });

  it("marks the lane this location computes, and nothing is pressed but that", async () => {
    surface.mount([residentLane()]);
    await offered();
    expect(laneOption(surface.computed).dataset["recipientDefault"]).toBe("true");
    expect(laneOption(surface.other).dataset["recipientDefault"]).toBe("false");
    expect(laneOption(surface.computed).getAttribute("aria-pressed")).toBe("true");
    expect(laneOption(surface.other).getAttribute("aria-pressed")).toBe("false");
  });

  it("carries the picked lane on the request, and only then", async () => {
    const probe = surface.mount([residentLane()]);
    await offered();
    fireEvent.click(laneOption(surface.other));
    const sent = await probe.send();
    expect(sent["recipient"]).toBe(surface.other);
  });

  /**
   * UI-118. `computed` is *this* build's walk, over a cached roster and bounded
   * at `MAX_SCOPE_WALK`; the server's is unbounded over the live projection. So
   * pressing the lane the default names is not agreement with whatever the
   * server works out a moment later — it is addressing that lane, and it has to
   * say so on the wire or the server's `422` can never happen.
   */
  it("carries a pick that happens to equal the computed lane — it was still a pick", async () => {
    const probe = surface.mount([residentLane()]);
    await offered();
    fireEvent.click(laneOption(surface.computed));
    await waitFor(() => {
      expect(laneOption(surface.computed).dataset["recipientChosen"]).toBe("true");
    });
    const sent = await probe.send();
    expect(sent["recipient"]).toBe(surface.computed);
  });

  it("goes back to stating nothing when the pick is pressed off again", async () => {
    const probe = surface.mount([residentLane()]);
    await offered();
    fireEvent.click(laneOption(surface.other));
    fireEvent.click(laneOption(surface.other));
    await waitFor(() => {
      expect(laneOption(surface.other).dataset["recipientChosen"]).toBe("false");
    });
    const sent = await probe.send();
    expect("recipient" in sent).toBe(false);
  });

  it("re-designates nothing and rewires no scope — the send is the only write", async () => {
    // §7's first two prohibitions, read off the wire: the *only* non-GET the
    // surface makes is the message itself, so nothing touched
    // `POST/DELETE /api/threads/{id}/resident` and no scope changed.
    const probe = surface.mount([residentLane()]);
    await offered();
    fireEvent.click(laneOption(surface.other));
    await probe.send();
    expect(probe.calls().filter((call) => call.includes("/resident"))).toEqual([]);
    const writes = probe.calls().filter((call) => !call.startsWith("GET "));
    expect(writes.every((call) => call.startsWith("POST /api/threads"))).toBe(true);
  });

  it("is operable from the keyboard — every option is a plain button", async () => {
    surface.mount([residentLane()]);
    await offered();
    for (const option of document.querySelectorAll("[data-recipient-lane]")) {
      expect(option.tagName).toBe("BUTTON");
      expect(option.getAttribute("type")).toBe("button");
    }
  });
});

/**
 * A pick can go stale between the roster read and the post — the person releases
 * the resident in one tab and posts from another — and the server refuses it
 * with a `422` naming the lane (SPEC.md §7, `assertRecipientResolvable`). What
 * the surface must not do is swallow that and quietly try again somewhere else.
 */
describe("a pick the server refuses", () => {
  it("says so, keeps the message, and does not silently reroute the retry", async () => {
    const transport = readerTransport({
      lanes: [residentLane()],
      threads: [threadFixture({ id: RESIDENT_THREAD_ID, turns: [] })],
    });
    const notices: string[] = [];
    render(
      <ReaderHost transport={transport}>
        <ThreadComposer
          threadId={RESIDENT_THREAD_ID}
          resolved={false}
          onNotify={(notice) => notices.push(notice.message)}
        />
      </ReaderHost>,
    );
    await offered();

    // The other tab: the resident is released, and this page is told nothing.
    transport.releaseLane(RESIDENT_THREAD_ID);
    // The person presses the lane they mean to address — still the default here,
    // because this page's roster has not refetched.
    fireEvent.click(laneOption(RESIDENT_THREAD_ID));
    const field = screen.getByLabelText<HTMLTextAreaElement>("Reply");
    fireEvent.change(field, { target: { value: "are these numbers still right?" } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });

    const path = `/api/threads/${RESIDENT_THREAD_ID}/turns`;
    await waitFor(() => {
      expect(transport.of("POST", path).length).toBe(1);
    });
    // It reached the wire at all, which is what lets the server refuse it.
    expect((transport.of("POST", path)[0]?.body as Stated)["recipient"]).toBe(RESIDENT_THREAD_ID);

    // The refusal is said in the server's own words…
    await waitFor(() => {
      expect(notices.join(" ")).toContain("names no lane");
    });
    // …and stays on the row after the toast is gone.
    await waitFor(() => {
      expect(laneOption(RESIDENT_THREAD_ID).dataset["recipientRefused"]).toBe("true");
    });
    expect(document.querySelector("[data-recipient-statement]")?.textContent).toContain(
      "is not a lane any more",
    );
    // The message came back whole — words and lane alike.
    expect(screen.getByLabelText<HTMLTextAreaElement>("Reply").value).toBe(
      "are these numbers still right?",
    );

    // The retry is refused again rather than delivered to the orchestrator: the
    // person addressed a lane, and nothing here substitutes another for it.
    fireEvent.keyDown(screen.getByLabelText("Reply"), { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(transport.of("POST", path).length).toBe(2);
    });
    expect((transport.of("POST", path)[1]?.body as Stated)["recipient"]).toBe(RESIDENT_THREAD_ID);
  });

  it("refetches the roster, so the picker stops offering the released lane as the default", async () => {
    const transport = readerTransport({
      lanes: [residentLane()],
      threads: [threadFixture({ id: RESIDENT_THREAD_ID, turns: [] })],
    });
    render(
      <ReaderHost transport={transport}>
        <ThreadComposer threadId={RESIDENT_THREAD_ID} resolved={false} onNotify={() => undefined} />
      </ReaderHost>,
    );
    await offered();

    transport.releaseLane(RESIDENT_THREAD_ID);
    fireEvent.click(laneOption(RESIDENT_THREAD_ID));
    const field = screen.getByLabelText<HTMLTextAreaElement>("Reply");
    fireEvent.change(field, { target: { value: "still there?" } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });

    // Nothing else would: `useAgentsRoster` has no poll, and the SSE frame that
    // would have said so never arrived — which is why the pick went stale.
    await waitFor(() => {
      expect(laneOption("orchestrator").dataset["recipientDefault"]).toBe("true");
    });
    // The refused lane is still on screen, because the pick that names it is.
    expect(laneOption(RESIDENT_THREAD_ID).dataset["recipientRefused"]).toBe("true");
  });
});

describe("a pick the server refuses — the other three surfaces", () => {
  it("the global composer keeps and marks it, and the panel stays open", async () => {
    const transport = composeTransport({ lanes: [residentLane()] });
    render(<ComposeHost transport={transport} />);
    await offered();

    transport.releaseLane(RESIDENT_THREAD_ID);
    // On Ask the resident is the *override* — §7's summons — so this is the
    // same staleness reached from the other side.
    fireEvent.click(laneOption(RESIDENT_THREAD_ID));
    const field = screen.getByLabelText<HTMLTextAreaElement>("Ask the agent, or capture a thought");
    fireEvent.change(field, { target: { value: "can you re-run this?" } });
    fireEvent.click(screen.getByRole("button", { name: /^Ask/u }));

    await waitFor(() => {
      expect(transport.to("/api/threads")).toHaveLength(1);
    });
    expect((transport.to("/api/threads")[0]?.json as Stated)["recipient"]).toBe(RESIDENT_THREAD_ID);
    await waitFor(() => {
      expect(laneOption(RESIDENT_THREAD_ID).dataset["recipientRefused"]).toBe("true");
    });
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Ask the agent, or capture a thought").value,
    ).toBe("can you re-run this?");
  });

  it("a comment on a turn keeps and marks it", async () => {
    const transport = readerTransport({ lanes: [residentLane()] });
    render(
      <ReaderHost transport={transport}>
        <NewChildThread
          parentThreadId={RESIDENT_THREAD_ID}
          anchorText="the line the comment hangs off"
          onDone={() => undefined}
          onCancel={() => undefined}
          onNotify={() => undefined}
        />
      </ReaderHost>,
    );
    await offered();

    transport.releaseLane(RESIDENT_THREAD_ID);
    fireEvent.click(laneOption(RESIDENT_THREAD_ID));
    const field = screen.getByLabelText<HTMLTextAreaElement>("Comment on this turn");
    fireEvent.change(field, { target: { value: "is this still the number?" } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(transport.of("POST", "/api/threads").length).toBe(1);
    });
    expect((transport.of("POST", "/api/threads")[0]?.body as Stated)["recipient"]).toBe(
      RESIDENT_THREAD_ID,
    );
    await waitFor(() => {
      expect(laneOption(RESIDENT_THREAD_ID).dataset["recipientRefused"]).toBe("true");
    });
  });

  /**
   * The popover does not survive its own send — its host unmounts it on submit
   * and re-opens it holding what it held (UI-111) — so its pick comes back the
   * way its words do, and comes back **marked** where the server named it.
   */
  it("a comment on a selection comes back holding the refused pick", async () => {
    const transport = readerTransport({ lanes: [residentLane()] });
    const onSubmit = vi.fn();
    render(
      <ReaderHost transport={transport}>
        <CommentPopover
          quote="assume a 30-year fixed at 6.1%"
          top={120}
          left={80}
          pending={false}
          weightScope={`thread:${RESIDENT_THREAD_ID}`}
          recipientScope={RESIDENT_THREAD_ID}
          restore={{
            text: "is this still the number?",
            attachments: [],
            recipient: { chosen: RESIDENT_THREAD_ID, refused: true },
          }}
          onSubmit={onSubmit}
          onClose={() => undefined}
        />
      </ReaderHost>,
    );
    await offered();

    await waitFor(() => {
      expect(laneOption(RESIDENT_THREAD_ID).dataset["recipientRefused"]).toBe("true");
    });
    // …and the retry still addresses it, rather than falling back to a default
    // computed from the same roster the server has just called stale.
    fireEvent.keyDown(screen.getByLabelText("Comment"), { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    const [, , stated] = onSubmit.mock.calls[0] as [string, boolean, Record<string, unknown>];
    expect(stated["recipient"]).toBe(RESIDENT_THREAD_ID);
  });

  it("names the refused lane in the host's restore, and only for a 422 naming it", () => {
    const refusedByName = new CorpusRequestError("POST /api/threads", 422, {
      code: "unknown_recipient",
      message: "no lane",
      recipient: RESIDENT_THREAD_ID,
    });
    expect(restoredRecipient({ recipient: RESIDENT_THREAD_ID }, refusedByName)).toEqual({
      chosen: RESIDENT_THREAD_ID,
      refused: true,
    });
    // An upload that failed says nothing about the lane: the pick comes back
    // unmarked rather than wearing a verdict the server never gave.
    expect(
      restoredRecipient({ recipient: RESIDENT_THREAD_ID }, new Error("upload failed")),
    ).toEqual({ chosen: RESIDENT_THREAD_ID, refused: false });
    expect(restoredRecipient({}, refusedByName)).toBeUndefined();
  });
});

/**
 * The third prohibition needs a composer that survives its own send, so it is
 * asserted on the two that do: the global composer is unmounted by its host on
 * success, and the comment popover is unmounted by its host on submit — for both
 * of those, *the surface's own lifetime* is the enforcement, and there is
 * nothing left to leak into.
 */
describe("an override never persists past the message it was set on", () => {
  it("a reply box is back to the default on the next message", async () => {
    const probe = threadProbe([residentLane()]);
    await offered();
    fireEvent.click(laneOption("orchestrator"));
    const first = await probe.send();
    expect(first["recipient"]).toBe("orchestrator");

    await waitFor(() => {
      expect(laneOption("orchestrator").getAttribute("aria-pressed")).toBe("false");
    });
    expect(laneOption(RESIDENT_THREAD_ID).getAttribute("aria-pressed")).toBe("true");

    const second = await probe.send();
    expect("recipient" in second).toBe(false);
  });

  it("a comment on a turn is back to the default on the next comment", async () => {
    const probe = childThreadProbe([residentLane()]);
    await offered();
    fireEvent.click(laneOption("orchestrator"));
    const first = await probe.send();
    expect(first["recipient"]).toBe("orchestrator");

    await waitFor(() => {
      expect(laneOption("orchestrator").getAttribute("aria-pressed")).toBe("false");
    });
    const second = await probe.send();
    expect("recipient" in second).toBe(false);
  });
});
