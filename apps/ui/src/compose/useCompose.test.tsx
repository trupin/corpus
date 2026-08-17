/** @vitest-environment jsdom */
import type { RowNotice } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { composeTransport, type ComposeTransport } from "./composeFixture";
import { askMessage, captureMessage, useCompose, type ComposeApi } from "./useCompose";

function mount(wire: ComposeTransport, notices: RowNotice[]) {
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return <harness.Wrapper>{children}</harness.Wrapper>;
  }
  return renderHook<ComposeApi, unknown>(
    () =>
      useCompose((notice) => {
        notices.push(notice);
      }),
    { wrapper: Wrapper },
  );
}

const file = (name: string): File => new File(["bytes"], name, { type: "image/png" });

describe("useCompose", () => {
  describe("Ask", () => {
    it("creates a standalone thread: no parent, no selector, agent requested", async () => {
      const wire = composeTransport();
      const notices: RowNotice[] = [];
      const { result } = mount(wire, notices);

      await act(async () => {
        expect(
          await result.current.submit("ask", {
            text: "  What is due?  ",
            files: [],
            weight: {},
            recipient: {},
          }),
        ).toEqual({ ok: true });
      });

      const [call] = wire.to("/api/threads");
      expect(call?.method).toBe("POST");
      expect(call?.json).toEqual({
        parent: null,
        selector: null,
        body: "What is due?",
        requestsAgent: true,
      });
      expect(notices).toEqual([{ tone: "info", message: askMessage(true) }]);
    });

    it("switches to multipart when the first turn carries files", async () => {
      const wire = composeTransport();
      const notices: RowNotice[] = [];
      const { result } = mount(wire, notices);

      await act(async () => {
        await result.current.submit("ask", {
          text: "look",
          files: [file("a.png"), file("b.png")],
          weight: {},
          recipient: {},
        });
      });

      const [call] = wire.to("/api/threads");
      expect(call?.json).toBeUndefined();
      expect(call?.form).toEqual({ text: "look", requestsAgent: "true" });
      expect(call?.files).toEqual(["a.png", "b.png"]);
    });

    it("allows an attachment-only ask — the multipart form simply carries no text", async () => {
      const wire = composeTransport();
      const { result } = mount(wire, []);
      await act(async () => {
        await result.current.submit("ask", {
          text: "   ",
          files: [file("shot.png")],
          weight: {},
          recipient: {},
        });
      });
      const [call] = wire.to("/api/threads");
      expect(call?.form).toEqual({ requestsAgent: "true" });
      expect(call?.files).toEqual(["shot.png"]);
    });

    it("narrates honestly when the server enqueued nothing", async () => {
      const wire = composeTransport({ eventId: null });
      const notices: RowNotice[] = [];
      const { result } = mount(wire, notices);
      await act(async () => {
        await result.current.submit("ask", { text: "hello", files: [], weight: {}, recipient: {} });
      });
      expect(notices).toEqual([{ tone: "info", message: askMessage(false) }]);
      expect(askMessage(false)).not.toContain("queued the agent");
    });
  });

  describe("Capture", () => {
    it("is exactly one call — the server composes the document and its filing thread", async () => {
      const wire = composeTransport();
      const notices: RowNotice[] = [];
      const { result } = mount(wire, notices);

      await act(async () => {
        expect(
          await result.current.submit("capture", {
            text: "a thought",
            files: [],
            weight: {},
            recipient: {},
          }),
        ).toEqual({ ok: true });
      });

      expect(wire.to("/api/capture")).toHaveLength(1);
      expect(wire.to("/api/docs").filter((call) => call.method === "POST")).toHaveLength(0);
      expect(wire.to("/api/threads")).toHaveLength(0);
      expect(wire.to("/api/capture")[0]?.form).toEqual({
        text: "a thought",
        requestsAgent: "true",
      });
      expect(notices).toEqual([{ tone: "info", message: captureMessage(true) }]);
      expect(captureMessage(true)).toContain("inbox/");
    });

    it("carries attachments on the same call", async () => {
      const wire = composeTransport();
      const { result } = mount(wire, []);
      await act(async () => {
        await result.current.submit("capture", {
          text: "with a shot",
          files: [file("s.png")],
          weight: {},
          recipient: {},
        });
      });
      expect(wire.to("/api/capture")[0]?.files).toEqual(["s.png"]);
    });
  });

  it("surfaces the server's warnings alongside the narration", async () => {
    const wire = composeTransport({
      warnings: [{ code: "attachment_skipped", detail: "one file was empty" }],
    });
    const notices: RowNotice[] = [];
    const { result } = mount(wire, notices);
    await act(async () => {
      await result.current.submit("ask", { text: "hi", files: [], weight: {}, recipient: {} });
    });
    expect(notices[0]).toEqual({
      tone: "error",
      message: "attachment_skipped — one file was empty",
    });
    expect(notices[1]?.tone).toBe("info");
  });

  it("reports a failure rather than claiming something happened", async () => {
    const wire = composeTransport({ failing: { "/api/capture": 413 } });
    const notices: RowNotice[] = [];
    const { result } = mount(wire, notices);

    await act(async () => {
      const outcome = await result.current.submit("capture", {
        text: "too big",
        files: [],
        weight: {},
        recipient: {},
      });
      expect(outcome.ok).toBe(false);
      // The refusal itself, not just "it failed": the overlay settles its
      // recipient pick against it, and only a `422` naming that pick may keep
      // it (UI-118).
      expect(outcome.ok ? undefined : outcome.error).toBeInstanceOf(Error);
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.tone).toBe("error");
    expect(notices[0]?.message).toContain("Capture failed");
  });

  it("reports whether a submit is in flight", async () => {
    const wire = composeTransport();
    const { result } = mount(wire, []);
    expect(result.current.isPending).toBe(false);
    await act(async () => {
      await result.current.submit("ask", { text: "hi", files: [], weight: {}, recipient: {} });
    });
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
  });
});
