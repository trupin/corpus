import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * INFRA-040 — the raw-control ratchet's teeth.
 *
 * `eslint.config.js` builds a `no-restricted-syntax` rule out of
 * `scripts/raw-controls-baseline.json`, so the check itself costs no hook step
 * and no CI step (sprint-026 P6). What a config alone cannot express is the
 * *ratchet*: that the grandfathered list may shrink and may never grow, and
 * that a file which leaves it can never take a raw control back. That is what
 * this file holds.
 *
 * Three records must agree:
 *
 *   1. the tree — which files actually carry a raw `<button>`, `<select>`,
 *      `<option>` or hand-written `role="dialog"` today;
 *   2. `scripts/raw-controls-baseline.json` — the grandfathered list, which
 *      must name exactly those files and no others;
 *   3. `CLOSED_CENSUS` below — the census taken the day the ratchet landed,
 *      which the baseline may never exceed.
 *
 * (1) === (2) forces a migrated file out of the baseline, and the rule then
 * locks it out. (2) ⊆ (3) is what stops a new violation being "fixed" by
 * appending a line to the JSON.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "raw-controls-baseline.json");
const UI_191_PATH = join(REPO_ROOT, "issues", "ui", "191-one-button-one-dropdown-everywhere.md");

/**
 * The census INFRA-040 took of the migrated tree on 2026-09-07, the day the
 * ratchet landed. **This list is closed.** The baseline may lose members as
 * UI-191's leftovers are migrated. It may never gain one: a file that wants a
 * raw interactive element and is not named here is a design conversation
 * (`design/index.html` and a kit primitive), never a config edit.
 *
 * UI-191 migrated the sprint's enumerated 22 files and recorded, in its own
 * Census discrepancy paragraph, that more files carried raw `<button>` than
 * the sprint had counted. These are those files, enumerated exactly.
 *
 * A second census joined on 2026-09-07 with the `role-dialog` ban (UI-193
 * criterion 2, landed via PR #77 finding 3): the nine product overlays that
 * predate kit's `Modal`/`Popover` and hand-write the role, from
 * `CommentPopover.tsx` to `UpgradePanel.tsx` below. Each ban's census is
 * closed the day the ban lands, and this list is their union — still closed:
 * a NEW overlay wants a kit primitive, never a baseline entry.
 */
const CLOSED_CENSUS: readonly string[] = [
  "apps/ui/src/anchors/CommentPopover.tsx",
  "apps/ui/src/board/Column.tsx",
  "apps/ui/src/board/ColumnHead.tsx",
  "apps/ui/src/board/ColumnStrip.tsx",
  "apps/ui/src/board/KanbanDialog.tsx",
  "apps/ui/src/board/NewListGhost.tsx",
  "apps/ui/src/board/NewListPicker.tsx",
  "apps/ui/src/board/PathColumn.tsx",
  "apps/ui/src/board/query/QueryEditor.tsx",
  "apps/ui/src/board/query/QueryHelp.tsx",
  "apps/ui/src/comments/CommentsSwitch.tsx",
  "apps/ui/src/comments/CommentsTab.tsx",
  "apps/ui/src/comments/NewCommentComposer.tsx",
  "apps/ui/src/compose/ComposeOverlay.tsx",
  "apps/ui/src/console/Console.tsx",
  "apps/ui/src/console/JobDetail.tsx",
  "apps/ui/src/console/LaneScope.tsx",
  "apps/ui/src/dev/DataProbe.tsx",
  "apps/ui/src/editor/SelectionToolbar.tsx",
  "apps/ui/src/explorer/ExplorerTree.tsx",
  "apps/ui/src/image/ImageViewer.tsx",
  "apps/ui/src/keyboard/CheatSheet.tsx",
  "apps/ui/src/menu/MenuItems.tsx",
  "apps/ui/src/reader/Backlinks.tsx",
  "apps/ui/src/reader/FocusMode.tsx",
  "apps/ui/src/reader/FrontmatterForm.tsx",
  "apps/ui/src/reader/ReaderHead.tsx",
  "apps/ui/src/reader/RelatedPanel.tsx",
  "apps/ui/src/reader/ScopeProvenance.tsx",
  "apps/ui/src/reattach/ReattachOffer.tsx",
  "apps/ui/src/reflect/ReflectControl.tsx",
  "apps/ui/src/search/CreateRow.tsx",
  "apps/ui/src/search/FilterChips.tsx",
  "apps/ui/src/search/SearchOverlay.tsx",
  "apps/ui/src/search/SearchResults.tsx",
  "apps/ui/src/shell/Toasts.tsx",
  "apps/ui/src/shell/Topbar.tsx",
  "apps/ui/src/thread/CollapsedThread.tsx",
  "apps/ui/src/thread/FormBlock.tsx",
  "apps/ui/src/thread/NewChildThread.tsx",
  "apps/ui/src/thread/ThreadCard.tsx",
  "apps/ui/src/thread/Turn.tsx",
  "apps/ui/src/upgrade/UpgradePanel.tsx",
  "packages/kit/src/components/Autocomplete/AutocompleteMenu.tsx",
  "packages/kit/src/components/Composer/PendingAttachments.tsx",
  "packages/kit/src/markdown/CodeFence.tsx",
  "packages/kit/src/row/Row.tsx",
];

const ratchetSchema = z.object({
  $comment: z.string().min(1),
  scope: z.array(z.string()).min(1),
  outOfScope: z.array(z.string()),
  banned: z.array(z.object({ tag: z.string(), selector: z.string(), message: z.string() })).min(1),
  primitives: z.array(z.string()).min(1),
  baseline: z.record(z.string(), z.array(z.string()).min(1)),
});

const ratchet = ratchetSchema.parse(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));
const bannedTags = ratchet.banned.map((entry) => entry.tag);

/**
 * Which banned tags each in-scope file still renders, measured by the same
 * selectors the real rule uses. This instance parses without a TypeScript
 * program on purpose — the check is pure syntax, and the type-aware run over
 * the whole UI tree costs minutes where this costs seconds.
 */
async function censusOfTree(): Promise<Map<string, string[]>> {
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.tsx"],
        ignores: [...ratchet.outOfScope, ...ratchet.primitives],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: {
          // The message is the tag, so a result maps straight back to it.
          "no-restricted-syntax": [
            "error",
            ...ratchet.banned.map((entry) => ({ selector: entry.selector, message: entry.tag })),
          ],
        },
      },
    ],
  });
  const census = new Map<string, string[]>();
  for (const result of await eslint.lintFiles([...ratchet.scope])) {
    if (result.messages.length === 0) continue;
    const tags = [...new Set(result.messages.map((message) => message.message))].sort();
    census.set(relative(REPO_ROOT, result.filePath), tags);
  }
  return census;
}

/** The selectors the real, committed config applies to one path. */
async function selectorsAppliedTo(eslint: ESLint, path: string): Promise<string[]> {
  const config = (await eslint.calculateConfigForFile(join(REPO_ROOT, path))) as Linter.Config;
  const entry = config.rules?.["no-restricted-syntax"];
  if (!Array.isArray(entry)) return [];
  return entry
    .slice(1)
    .filter(
      (option): option is { selector: string } => typeof option === "object" && option !== null,
    )
    .map((option) => option.selector)
    .sort();
}

/** Every selector, as the un-grandfathered scope sees them. */
const allSelectors = ratchet.banned.map((entry) => entry.selector).sort();

describe("the raw-control ratchet fires (INFRA-040)", () => {
  const PROBE = join(REPO_ROOT, "apps", "ui", "src", "shell", "raw-controls-probe.tmp.tsx");
  let messages: { readonly ruleId: string | null; readonly message: string }[] = [];

  beforeAll(async () => {
    // A file under `apps/ui/src` that no baseline entry names, written to disk
    // because the repository's real config parses with a TypeScript program.
    writeFileSync(
      PROBE,
      [
        "export function RawControlsProbe(): JSX.Element {",
        "  return (",
        '    <div role="dialog">',
        '      <button type="button">raw</button>',
        "      <select>",
        '        <option value="a">a</option>',
        "      </select>",
        '      <input type="text" />',
        '      <a href="#anchor">link</a>',
        "      <textarea />",
        '      <span role="tooltip">not a dialog</span>',
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
    try {
      const results = await new ESLint({ cwd: REPO_ROOT }).lintFiles([PROBE]);
      messages = results.flatMap((result) => result.messages);
    } finally {
      rmSync(PROBE, { force: true });
    }
  }, 180_000);

  afterAll(() => {
    rmSync(PROBE, { force: true });
  });

  function refusals(): string[] {
    return messages
      .filter((message) => message.ruleId === "no-restricted-syntax")
      .map((message) => message.message);
  }

  it("refuses a raw <button> and names the kit primitive to use", () => {
    const message = refusals().find((text) => text.includes("<button>"));
    expect(message).toBeDefined();
    expect(message).toContain("Button");
    expect(message).toContain("IconButton");
    expect(message).toContain("Chip");
    expect(message).toContain("@corpus/kit");
  });

  it("refuses a raw <select> and names Select", () => {
    const message = refusals().find((text) => text.includes("<select>"));
    expect(message).toBeDefined();
    expect(message).toContain("Select from @corpus/kit");
  });

  it("refuses a raw <option> and names Select", () => {
    const message = refusals().find((text) => text.includes("<option>"));
    expect(message).toBeDefined();
    expect(message).toContain("Select from @corpus/kit");
  });

  it('refuses a hand-written role="dialog" and names the kit overlay primitives', () => {
    // UI-193 criterion 2 (landed via PR #77 finding 3): an overlay outside
    // kit's Controls is refused at the role, so it is built on Modal/Popover
    // or it does not lint.
    const message = refusals().find((text) => text.includes('role="dialog"'));
    expect(message).toBeDefined();
    expect(message).toContain("Modal");
    expect(message).toContain("Popover");
    expect(message).toContain("@corpus/kit");
  });

  it("leaves the elements the kit does not replace alone", () => {
    // <input>, <a>, <textarea> and a `role="tooltip"` are in the probe too.
    // Four refusals means the rule banned exactly what UI-191 replaced plus
    // UI-193's overlay role, and nothing beyond them (sprint-026 → Out of
    // scope: "a text input is not a button"; a non-dialog role is not an
    // overlay).
    expect(refusals()).toHaveLength(4);
  });
});

describe("the raw-control ratchet's exemptions (INFRA-040)", () => {
  const eslint = new ESLint({ cwd: REPO_ROOT });

  it("exempts the kit's own Controls implementations — a primitive must render something", async () => {
    for (const primitive of ratchet.primitives) {
      expect(await selectorsAppliedTo(eslint, primitive), primitive).toEqual([]);
    }
  }, 120_000);

  it("exempts nothing else in the kit", async () => {
    expect(
      await selectorsAppliedTo(eslint, "packages/kit/src/components/Controls/ScrollArea.tsx"),
    ).toEqual(allSelectors);
  }, 120_000);

  it("grandfathers exactly the listed tags — a baselined file is still refused every other", async () => {
    // A `<button>` file keeps its buttons and is still refused a `<select>`
    // and a hand-written `role="dialog"`; a `role-dialog` overlay keeps its
    // role and is still refused a raw `<button>`. Per file, never per tag-set.
    for (const [path, tags] of Object.entries(ratchet.baseline)) {
      const kept = ratchet.banned
        .filter((entry) => !tags.includes(entry.tag))
        .map((entry) => entry.selector)
        .sort();
      expect(await selectorsAppliedTo(eslint, path), path).toEqual(kept);
    }
  }, 300_000);
});

describe("the raw-control baseline is a ratchet (INFRA-040)", () => {
  it("names exactly the files that still carry a raw control", async () => {
    const census = await censusOfTree();
    // Both directions in one assertion. A file missing from the baseline is an
    // unlisted violator the rule already refuses. A baseline entry the tree no
    // longer needs is a migration whose gain is not yet locked in — delete the
    // entry, and the file can never take a raw control back.
    expect(Object.fromEntries([...census].sort())).toEqual(
      Object.fromEntries(Object.entries(ratchet.baseline).sort()),
    );
  }, 120_000);

  it("names no file outside the census closed the day it landed", () => {
    const added = Object.keys(ratchet.baseline).filter((path) => !CLOSED_CENSUS.includes(path));
    expect(
      added,
      "The baseline may only shrink. A file that wants a raw interactive element and is " +
        "not in CLOSED_CENSUS needs a kit primitive, not a baseline entry (INFRA-040).",
    ).toEqual([]);
  });

  it("never grandfathers a file that is already permanently exempt", () => {
    const overlap = ratchet.primitives.filter((path) => path in ratchet.baseline);
    expect(overlap).toEqual([]);
  });

  it("grandfathers only tags the rule actually bans", () => {
    const unknown = Object.entries(ratchet.baseline)
      .flatMap(([path, tags]) => tags.map((tag) => `${path}: ${tag}`))
      .filter((entry) => !bannedTags.some((tag) => entry.endsWith(`: ${tag}`)));
    expect(unknown).toEqual([]);
  });
});

describe("the raw-control exemptions are pinned to UI-191's record (INFRA-040)", () => {
  it("matches the allowed raw-element list UI-191 recorded", () => {
    const issue = readFileSync(UI_191_PATH, "utf8");
    const section = issue.split(/^#{2,3} .*allowed raw-element list.*$/im)[1];
    expect(
      section,
      `UI-191's allowed raw-element list is missing from ${UI_191_PATH}`,
    ).toBeDefined();
    const recorded = [...(section ?? "").split(/^#{2,3} /m)[0]!.matchAll(/^- `([^`]+)`$/gm)].map(
      (match) => match[1]!,
    );
    expect(
      [...recorded].sort(),
      "UI-191 records which files may keep a raw interactive element, and " +
        "scripts/raw-controls-baseline.json's `primitives` encodes it. Change both or neither.",
    ).toEqual([...ratchet.primitives].sort());
  });
});

describe("the raw-control check rides the gates that already exist (sprint-026 P6)", () => {
  const preCommit = readFileSync(join(REPO_ROOT, ".githooks", "pre-commit"), "utf8");
  const ci = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

  it("adds no pre-commit step — the staged eslint run is the whole local gate", () => {
    expect(preCommit).toContain("npx eslint $staged_ts");
    expect(preCommit).not.toMatch(/raw-controls/);
  });

  it("adds no CI step — `npm run lint` is the whole-repo gate, unchanged", () => {
    expect(ci).toContain("npm run lint");
    expect(ci).not.toMatch(/raw-controls/);
  });

  it("is disabled inline nowhere", () => {
    // Lint Discipline: the fix for this rule is a kit primitive, never a
    // suppression comment. The baseline is the only sanctioned exemption and
    // it lives in one committed file.
    // The needle is assembled from parts so this scanner's own source never
    // matches it (it joined its own scan the moment the file was committed).
    const needle = new RegExp(["eslint-", "disable[^\\n]*no-restricted-", "syntax"].join(""));
    const offenders = trackedTypeScriptFiles().filter((file) =>
      needle.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => relative(REPO_ROOT, file))).toEqual([]);
  });
});

/** Every tracked TypeScript source file, for the inline-disable sweep. */
function trackedTypeScriptFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => join(REPO_ROOT, line));
}
