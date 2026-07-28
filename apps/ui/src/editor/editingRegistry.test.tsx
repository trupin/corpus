/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginEditing,
  editingCount,
  endEditing,
  isEditing,
  resetEditingRegistry,
  useIsEditing,
} from "./editingRegistry.js";

afterEach(() => {
  cleanup();
  resetEditingRegistry();
});

describe("the registry", () => {
  it("records and clears a session", () => {
    expect(isEditing("doc_a")).toBe(false);
    beginEditing("doc_a");
    expect(isEditing("doc_a")).toBe(true);
    expect(editingCount()).toBe(1);
    endEditing("doc_a");
    expect(isEditing("doc_a")).toBe(false);
    expect(editingCount()).toBe(0);
  });

  it("is idempotent in both directions", () => {
    beginEditing("doc_a");
    beginEditing("doc_a");
    expect(editingCount()).toBe(1);
    endEditing("doc_a");
    endEditing("doc_a");
    expect(editingCount()).toBe(0);
  });

  it("ignores an empty id — there is no document to guard", () => {
    beginEditing("");
    expect(editingCount()).toBe(0);
  });

  it("is keyed by document, not global", () => {
    beginEditing("doc_a");
    expect(isEditing("doc_a")).toBe(true);
    // The whole point: doc B's reader keeps repainting while doc A is typed in.
    expect(isEditing("doc_b")).toBe(false);
  });
});

function Probe({ docId }: { readonly docId: string }): React.ReactElement {
  const editing = useIsEditing(docId);
  return <span data-testid={docId}>{editing ? "editing" : "idle"}</span>;
}

describe("the hook", () => {
  it("re-renders the subscriber when its own document starts and stops", () => {
    render(<Probe docId="doc_a" />);
    expect(screen.getByTestId("doc_a").textContent).toBe("idle");

    act(() => {
      beginEditing("doc_a");
    });
    expect(screen.getByTestId("doc_a").textContent).toBe("editing");

    act(() => {
      endEditing("doc_a");
    });
    expect(screen.getByTestId("doc_a").textContent).toBe("idle");
  });

  it("leaves a subscriber to another document alone", () => {
    render(
      <>
        <Probe docId="doc_a" />
        <Probe docId="doc_b" />
      </>,
    );
    act(() => {
      beginEditing("doc_a");
    });
    expect(screen.getByTestId("doc_a").textContent).toBe("editing");
    expect(screen.getByTestId("doc_b").textContent).toBe("idle");
  });

  it("releases every subscriber on reset", () => {
    render(<Probe docId="doc_a" />);
    act(() => {
      beginEditing("doc_a");
    });
    act(() => {
      resetEditingRegistry();
    });
    expect(screen.getByTestId("doc_a").textContent).toBe("idle");
  });
});
