/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Board } from "./Board";

afterEach(cleanup);

describe("Board", () => {
  it("renders a labelled main scroller carrying the board class", () => {
    const { container } = render(<Board />);
    const board = container.querySelector(".board");
    expect(board?.tagName).toBe("MAIN");
    expect(board?.getAttribute("aria-label")).toBe("Document lists");
  });

  it("renders its empty state until columns arrive", () => {
    const { container } = render(<Board />);
    expect(container.querySelector(".board-empty")?.textContent).toBe("No lists yet");
  });
});
