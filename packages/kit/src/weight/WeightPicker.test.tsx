/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerWeight } from "./weightChoice.js";
import type { WeightLevel } from "./weightLevels.js";
import { WeightPicker, WEIGHT_INERT_TITLE, WEIGHT_LIVE_TITLE } from "./WeightPicker.js";

/**
 * The control itself, driven from a hand-built {@link ComposerWeight} so the
 * component's own rules are pinned without a transport in the way.
 */

afterEach(cleanup);

const LEVELS: readonly WeightLevel[] = [
  { label: "Small and mechanical", key: "light" },
  { label: "Standard", key: "standard" },
  { label: "Heavy or judgment-laden", key: "heavy" },
];

function draw(
  overrides: Partial<ComposerWeight> & { readonly live?: boolean } = {},
): ReturnType<typeof vi.fn> {
  const choose = vi.fn();
  const weight: ComposerWeight = {
    levels: overrides.levels ?? LEVELS,
    chosen: overrides.chosen,
    request: overrides.chosen === undefined ? {} : { weight: overrides.chosen },
    choose: overrides.choose ?? choose,
  };
  render(<WeightPicker weight={weight} live={overrides.live ?? true} surface="probe" />);
  return choose;
}

function options(): readonly HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-weight-key]")];
}

describe("what it offers", () => {
  it("offers exactly the declared levels, in the declared order", () => {
    draw();
    expect(options().map((option) => option.dataset["weightKey"])).toEqual([
      "light",
      "standard",
      "heavy",
    ]);
    expect(options().map((option) => option.textContent)).toEqual(LEVELS.map((l) => l.label));
  });

  it("shows the Weight cell and never a model name", () => {
    draw();
    const picker = document.querySelector("[data-weight-picker]");
    expect(picker?.textContent).not.toMatch(/Haiku|Sonnet|Opus/u);
  });

  it("is not there at all when the workspace declares no levels", () => {
    draw({ levels: [] });
    // Not an empty control, not a disabled one, not a hint: nothing.
    expect(document.querySelector("[data-weight-picker]")).toBeNull();
    expect(options()).toHaveLength(0);
  });
});

describe("nothing is preselected", () => {
  it("shows no chosen level on a composer nobody has touched", () => {
    draw();
    for (const option of options()) expect(option.getAttribute("aria-pressed")).toBe("false");
  });

  it("states a level on one click", () => {
    const choose = draw();
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    expect(choose).toHaveBeenCalledWith("standard");
  });

  it("clears the standing choice by pressing it again — one gesture, both ways", () => {
    const choose = draw({ chosen: "standard" });
    expect(screen.getByRole("button", { name: "Standard" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    expect(choose).toHaveBeenCalledWith(undefined);
  });

  it("changes to another level in one gesture", () => {
    const choose = draw({ chosen: "standard" });
    fireEvent.click(screen.getByRole("button", { name: "Small and mechanical" }));
    expect(choose).toHaveBeenCalledWith("light");
  });
});

describe("liveness is presentation", () => {
  it("says so when the composer is reaching the agent", () => {
    draw({ live: true });
    const picker = document.querySelector<HTMLElement>("[data-weight-picker]");
    expect(picker?.dataset["weightLive"]).toBe("true");
    expect(picker?.getAttribute("title")).toBe(WEIGHT_LIVE_TITLE);
  });

  it("shows as having nothing to act on otherwise — without disabling anything", () => {
    const choose = draw({ live: false, chosen: "light" });
    const picker = document.querySelector<HTMLElement>("[data-weight-picker]");
    expect(picker?.dataset["weightLive"]).toBe("false");
    expect(picker?.getAttribute("title")).toBe(WEIGHT_INERT_TITLE);
    // The choice is kept, and the control still answers: clearing it or freezing
    // it would be the control acting on the person unseen.
    expect(screen.getByRole("button", { name: "Small and mechanical" })).toBeTruthy();
    for (const option of options()) expect(option.hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    expect(choose).toHaveBeenCalledWith("standard");
  });
});

describe("a level the guidance no longer declares", () => {
  it("is still shown, marked, and still what the request states", () => {
    draw({ chosen: "exhaustive" });
    const keys = options().map((option) => option.dataset["weightKey"]);
    expect(keys).toEqual(["light", "standard", "heavy", "exhaustive"]);
    const stale = screen.getByRole("button", { name: "exhaustive" });
    expect(stale.getAttribute("aria-pressed")).toBe("true");
    expect(stale.dataset["weightUndeclared"]).toBe("true");
  });

  it("is never silently rewritten to a surviving level", () => {
    const choose = draw({ chosen: "exhaustive" });
    // Drawing it changes nothing: the disclosure of an unhonourable weight is
    // the agent's job (§7), not a substitution here.
    expect(choose).not.toHaveBeenCalled();
  });

  it("adds no such option when nobody chose it", () => {
    draw();
    expect(options()).toHaveLength(3);
  });
});

describe("the keyboard", () => {
  it("claims no key: every option is an ordinary button", () => {
    draw();
    for (const option of options()) {
      expect(option.tagName).toBe("BUTTON");
      // `type="button"` matters inside a composer: a submit button would give
      // the control a key — `↵` — which §11 says it must not claim.
      expect(option.getAttribute("type")).toBe("button");
      expect(option.hasAttribute("tabindex")).toBe(false);
    }
  });

  it("is a labelled group, so a screen reader announces what it is", () => {
    draw();
    expect(screen.getByRole("group", { name: "Weight" })).toBeTruthy();
  });
});
