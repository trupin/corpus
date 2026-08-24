import { MISSING_PROFILE_MARK, MISSING_PROFILE_NOTE } from "@corpus/kit";
import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * **Designating a resident from the board** — SPEC.md §7's rider (*"Naming none
 * is the ordinary case and requires nothing to exist first"*) reached through
 * §10's conversation menu, in a real browser.
 *
 * ## The reported defect, spelled as a test
 *
 * A person right-clicked a standalone thread in a **fresh workspace**, and the
 * only resident item the menu carried was a disabled line reading *"no agent-def
 * documents in this workspace"*. The feature v0.10.0 is named for could not be
 * reached from the UI at all. The first test here is that workspace, and it ends
 * with a resident on the board.
 *
 * ## Why it is worth a browser
 *
 * Two of the acceptance criteria are only true of one: `↵` on a focused menu
 * item is a native button default that jsdom does not perform (UI-028 found
 * exactly this, on this menu), and the badge that follows a designation is
 * repainted by a `["agents"]` invalidation crossing a real query cache.
 *
 * ## What is real, and what is not
 *
 * Everything above `fetch`. The corpus is `stubCorpus`, which since UI-122 has a
 * real handler for `POST`/`DELETE /api/threads/{id}/resident` — before that the
 * route fell through to the `{}` fallback and every designation any spec had
 * sent was answered by nothing at all (UI-116's trap). It models the three
 * things the route decides: a body with no `name` designates a **general**
 * resident, a name resolves against the workspace's `type: agent-def` documents,
 * and a name that resolves to nothing is a `404`.
 */

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { type: "thread" },
};

/** A standalone conversation: no parent, so §7 lets it designate. */
const SOLO: StubRow = {
  id: "th_solo",
  type: "thread",
  title: "Q3 planning",
  path: "data/docs/threads/th_solo.md",
  body: "## user · 2026-08-17T10:00:00Z\n\nWhere did the forecast land?\n",
};

/**
 * The workspace's one profile, for the tests that want the refinement.
 *
 * Under `.claude/agents/`, because since SERVER-125 that is what makes an
 * agent-def addressable at all: a `type: agent-def` document filed anywhere else
 * resolves under no spelling, and this fixture used to sit at
 * `data/docs/agents/researcher.md` — a path the server now refuses (UI-123).
 */
const PROFILE: StubRow = {
  id: "doc_researcher",
  type: "agent-def",
  title: "researcher",
  path: ".claude/agents/researcher.md",
};

/**
 * A document *about* a persona: `type: agent-def`, filed under `data/docs/`
 * where an explicit `--folder` still puts it (SERVER-122). Claude Code loads
 * nothing from here and no dispatch reaches it, so since SERVER-125 the server
 * resolves it under no name — its title included — and a designation of it is a
 * `404`.
 *
 * It is still a document, and the board still lists it.
 */
const ABOUT_A_PERSONA: StubRow = {
  id: "doc_legacy",
  type: "agent-def",
  title: "Legacy",
  path: "data/docs/inbox/legacy.md",
};

/**
 * An agent-def as the `profile` skill writes one: a titled document under
 * `.claude/agents/`, whose **stem** is what a designation of it resolves to
 * (SERVER-122, CLI-050). `Bookkeeper` and `bookkeeper` name one document here.
 */
const CREATED_PROFILE: StubRow = {
  id: "doc_bookkeeper",
  type: "agent-def",
  title: "Bookkeeper",
  path: ".claude/agents/bookkeeper.md",
};

/**
 * The same shape with a **padded** title, which is a row the projection really
 * produces: `asString` (`projection/project-document.ts`) only decides whether a
 * title is *there*, so `title: "  Padded Persona  "` reaches `documents.title`
 * with its padding on.
 *
 * The two ends of the designation disagree about that padding on purpose — the
 * menu offers and sends the title **trimmed** (`residentActions.ts`), and the
 * server keys both the index and the lookup through one `aliasKey`
 * (`threads/mentions.ts`), so the trimmed name lands. It is here because that
 * agreement was broken twice in one release, once on each side, and neither
 * break was visible in a browser: PR #50 NIT 7 fixed the server, and MINOR 4
 * then found the e2e stub still comparing the caller's trimmed name against
 * `row.title` untrimmed — so this designation `404`'d here and `200`'d against
 * the real server, and no spec held a title this shape to notice.
 */
const PADDED_PROFILE: StubRow = {
  id: "doc_padded",
  type: "agent-def",
  title: "  Padded Persona  ",
  path: ".claude/agents/padded.md",
};

/**
 * The workspace's own tier table, in the shape the shipped orchestrate skill
 * states it (AGENT-015) — the vocabulary a designation's weight is drawn from
 * (UI-168). It is the workspace's, so it is seeded per test rather than assumed:
 * a workspace that declares nothing is a real shipping state and gets no picker.
 */
function declaring(rows: readonly (readonly [string, string])[]): string {
  return [
    "## Delegation",
    "",
    "| Weight | Key | Model | What falls here |",
    "| ---------------------- | -------- | ---------- | ---------------- |",
    ...rows.map(([label, key]) => `| ${label} | ${key} | **A model** | Guidance. |`),
    "",
    "Nothing outside this table declares a level.",
  ].join("\n");
}

const ORCHESTRATE: StubRow = {
  id: "doc_orchestrate",
  type: "skill",
  title: "orchestrate",
  path: ".claude/skills/orchestrate/SKILL.md",
  body: declaring([
    ["Small and mechanical", "light"],
    ["Standard", "standard"],
    ["Heavy or judgment-laden", "heavy"],
  ]),
};

const CARD = '.thread-card[data-thread="th_solo"]';
const BADGE = '[data-thread-panel="th_solo"] .t-resident';
const TRIGGER = '[data-thread-panel="th_solo"] [data-thread-menu]';

async function board(page: Page, rows: readonly StubRow[]): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [THREADS_VIEW, SOLO, ...rows]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_solo"]').click();
  await expect(page.locator(CARD)).toBeVisible();
  return corpus;
}

async function openMenu(page: Page): Promise<void> {
  await page.locator(CARD).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
}

/** The same menu, through the affordance a left click can find (UI-167). */
async function openFromTrigger(page: Page): Promise<void> {
  await page.locator(TRIGGER).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/** Every item the open menu offers, in order — acts and weight rows alike. */
async function menuActs(page: Page): Promise<readonly (string | null)[]> {
  return page
    .getByRole("menu")
    .locator("[data-act]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-act")));
}

/**
 * What the conversation runs at **now**, read back off its own menu.
 *
 * The menu is where a designation's level is reported, deliberately — the board
 * badge names *who* and the composer's line names *at what* (the orchestrator's
 * decision, 2026-08-23; the measurement is in UI-168). An untouched menu seeds
 * its radio set from `Resident.weight`, so the checked row is this page's read of
 * what the last designation actually landed — a round trip, not an echo of the
 * click that made it.
 *
 * Opens and closes the menu, so it is safe to call between acts.
 */
async function residentLevel(page: Page): Promise<string | null> {
  await openFromTrigger(page);
  const checked = page
    .getByRole("menu")
    .locator('[data-act^="resident-weight-"][aria-checked=true]');
  await checked.first().waitFor();
  const act = await checked.first().getAttribute("data-act");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  return act === null ? null : act.replace("resident-weight-", "");
}

const posted = async (corpus: StubCorpus): Promise<readonly unknown[]> =>
  (await corpus.of("POST", "/api/threads/th_solo/resident")).map((call) => call.body);

test.describe("designating a resident", () => {
  /**
   * The user's exact reported case: a fresh workspace with no `agent-def`
   * documents at all. Nothing here is skipped because the directory is empty —
   * that is the point.
   */
  test("offers a resident in a workspace with no agent-defs, and designates one", async ({
    page,
  }) => {
    const corpus = await board(page, []);
    await openMenu(page);
    const menu = page.getByRole("menu");

    const offer = menu.locator('[data-act="resident-designate-general"]');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText("Designate a resident");
    await expect(offer).toBeEnabled();

    // The absence of profiles is stated, and stated as news: a resident does not
    // need one, so it cannot read as a misconfiguration.
    const note = menu.locator('[data-act="resident-no-profiles"]');
    await expect(note).toContainText("No profiles yet");
    await expect(note).toContainText("a resident does not need one");
    await expect(note).toBeDisabled();

    await offer.click();

    // Designated with no name at all — never a sentinel one (CONTRACT-061).
    await expect.poll(async () => posted(corpus)).toEqual([{}]);
    await expect(page.locator(".toast")).toContainText("has a resident, with no profile");

    // The board follows, because designating invalidates `["agents"]`.
    await expect(page.locator(BADGE)).toBeVisible();
    await expect(page.locator(BADGE)).toHaveAttribute("data-resident-kind", "general");
    await expect(page.locator(`${BADGE} .t-resident-kind`)).toHaveText("resident, no profile");
    // Not a name, and not the conversation's own title standing in for one.
    await expect(page.locator(`${BADGE} .t-resident-name`)).toHaveCount(0);
    await expect(page.locator(BADGE)).not.toContainText("Q3 planning");
  });

  /**
   * SPEC.md §10: *"`esc` dismisses, arrows navigate, `↵` activates"*. The new
   * item claims no key of its own and is reached like every other one — a real
   * browser, because only a real browser performs a focused button's default.
   */
  test("designates a general resident from the keyboard alone", async ({ page }) => {
    const corpus = await board(page, []);
    await openMenu(page);
    const menu = page.getByRole("menu");

    // Collapse, Resolve, then the act itself.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator('[data-act="resident-designate-general"]')).toBeFocused();

    await page.keyboard.press("Enter");

    await expect(menu).toBeHidden();
    await expect.poll(async () => posted(corpus)).toEqual([{}]);
    await expect(page.locator(BADGE)).toHaveAttribute("data-resident-kind", "general");
  });

  test("offers the profiles alongside the general act once the workspace has any", async ({
    page,
  }) => {
    const corpus = await board(page, [PROFILE]);
    await openMenu(page);
    const menu = page.getByRole("menu");

    // The act leads; the profile refines it. Nothing says there are none.
    await expect(menu.locator('[data-act="resident-designate-general"]')).toContainText(
      "Designate a resident",
    );
    await expect(menu.locator('[data-act="resident-designate-doc_researcher"]')).toContainText(
      "Designate researcher",
    );
    await expect(menu.locator('[data-act="resident-no-profiles"]')).toHaveCount(0);

    await menu.locator('[data-act="resident-designate-doc_researcher"]').click();

    await expect.poll(async () => posted(corpus)).toEqual([{ name: "researcher" }]);
    await expect(page.locator(BADGE)).toHaveAttribute("data-resident-kind", "profiled");
    await expect(page.locator(`${BADGE} .t-resident-name`)).toHaveText("researcher");
  });

  /**
   * The guard the PR #49 review measured, through the real menu.
   *
   * A designation resolves against an agent-def's stem *and* its title, and what
   * comes back is the name it resolved to — `bookkeeper` for a file the
   * `profile` skill wrote as `.claude/agents/bookkeeper.md` with the title
   * `Bookkeeper`. The menu compared that resolved name against the **title**
   * `GET /api/docs` carries, so the guard missed and the item came back offering
   * to replace Bookkeeper with Bookkeeper: harmless on the wire — the server
   * sees the state it already holds and re-announces — but an offer that does
   * nothing is not an action, which is the rule the skip exists to keep.
   */
  test("does not re-offer the resident's own profile when its title and its file differ", async ({
    page,
  }) => {
    await board(page, [CREATED_PROFILE, PROFILE]);
    await openMenu(page);
    await page.getByRole("menu").locator('[data-act="resident-designate-doc_bookkeeper"]').click();

    // What came back is the **stem**, which is the whole reason a name
    // comparison was not enough.
    await expect(page.locator(`${BADGE} .t-resident-name`)).toHaveText("bookkeeper");

    await openMenu(page);
    const menu = page.getByRole("menu");
    await expect(menu.locator('[data-act="resident-release"]')).toContainText("Release bookkeeper");
    await expect(menu.locator('[data-act="resident-designate-doc_bookkeeper"]')).toHaveCount(0);
    // Every other profile is still a replacement — the skip is one row wide.
    await expect(menu.locator('[data-act="resident-designate-doc_researcher"]')).toContainText(
      "Replace with researcher",
    );
  });

  /**
   * A padded title, designated through the real menu — PR #50 MINOR 4's case.
   *
   * The label is trimmed and so is the name on the wire, because a person picks
   * a row and not a string; what comes back is the row's **stem**, the same
   * answer `Bookkeeper` gets, because the resolved name is what a designation
   * stores whichever spelling found it.
   *
   * The badge turning `profiled` is the whole assertion: a copy of the rule that
   * keys `row.title` untrimmed answers this `404`, and the lane never appears.
   */
  test("designates a persona whose title is padded, sending it trimmed", async ({ page }) => {
    const corpus = await board(page, [PADDED_PROFILE]);
    await openMenu(page);
    const item = page.getByRole("menu").locator('[data-act="resident-designate-doc_padded"]');
    await expect(item).toContainText("Designate Padded Persona");
    await item.click();

    await expect.poll(async () => posted(corpus)).toEqual([{ name: "Padded Persona" }]);
    await expect(page.locator(BADGE)).toHaveAttribute("data-resident-kind", "profiled");
    await expect(page.locator(`${BADGE} .t-resident-name`)).toHaveText("padded");
  });

  /**
   * **UI-123, in a browser: the two menus offer what the server will resolve,
   * and the document they drop is still a document.**
   *
   * SERVER-125 stopped indexing an off-root `type: agent-def` as a mention
   * target under any spelling, the title alias included. Both client surfaces
   * went on offering those rows — the `@` autocomplete under the title, the
   * designate menu by sending it — so picking one inserted a mention that
   * resolved to nobody, and designating one earned a `404`.
   *
   * All three halves are asserted in one flow because they are one claim: the
   * row is **listed and readable**, and **not offered** by either menu. A fix
   * that filtered `GET /api/docs?type=agent-def` would pass the last two and
   * take the board's `type:` filter and the seeded "Skills & agents" view with
   * it.
   */
  test("lists a document about a persona, and offers it in neither menu", async ({ page }) => {
    await stubCorpus(page, [
      THREADS_VIEW,
      {
        id: "doc_view_personas",
        type: "view",
        title: "Skills & agents",
        path: "data/docs/views/personas.md",
        order: 2,
        query: { type: "agent-def" },
      },
      SOLO,
      PROFILE,
      ABOUT_A_PERSONA,
    ]);
    await page.goto("/");
    await page.locator(".board").waitFor();

    // Listed, both of them: nothing about the document changed.
    const listed = page.locator('.row[data-row-doc="doc_legacy"]');
    await expect(listed).toBeVisible();
    await expect(page.locator('.row[data-row-doc="doc_researcher"]')).toBeVisible();

    // …and readable. It opens like any other document.
    await listed.click();
    await expect(page.locator(".reader").first()).toBeVisible();
    await expect(page.locator(".reader").first()).toContainText("Legacy");

    await page.locator('.row[data-row-doc="th_solo"]').click();
    await expect(page.locator(CARD)).toBeVisible();

    // The `@` menu: the addressable persona, the generic `@agent`, and nothing
    // else. `Legacy` is a name the server would resolve to nobody.
    await page.locator('[data-composer="th_solo"]').click();
    await page.keyboard.type("@");
    const menu = page.getByRole("listbox", { name: "Reply completions" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(2);
    await expect(menu.getByRole("option", { name: /researcher/i })).toBeVisible();
    await expect(menu.getByRole("option", { name: /legacy/i })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The designate menu: the same set, by the same rule.
    await openMenu(page);
    const context = page.getByRole("menu");
    await expect(context.locator('[data-act="resident-designate-doc_researcher"]')).toContainText(
      "Designate researcher",
    );
    await expect(context.locator('[data-act="resident-designate-doc_legacy"]')).toHaveCount(0);
    // And not the empty-directory line either: the workspace does define a
    // profile, and one of its two agent-defs is offered.
    await expect(context.locator('[data-act="resident-no-profiles"]')).toHaveCount(0);
  });

  /**
   * **A designation whose profile has gone**, on the surface where the release
   * is chosen — SPEC.md §7's *"the missing profile is reported rather than
   * silently substituted"*.
   *
   * PR #49's second review found the report holding on the board badge, in the
   * recipient picker and in `corpus agents`, and **not** on the conversation's
   * own menu: a `profile-gone` lane offered `Release researcher`, byte-identical
   * to what a healthy lane offers, on the one surface where a person acts on the
   * fact.
   *
   * The lane is seeded rather than produced, because losing a profile is
   * something the workspace does between two page loads and not something this
   * page can cause: `{name: "researcher", docId: null}` is exactly what
   * `GET /api/agents` answers once the document behind a standing designation has
   * been renamed, deleted, or moved out of `.claude/agents/` (CONTRACT-061).
   * Archiving it is **not** one of those — an archived agent-def still resolves,
   * so its lane keeps its `docId` (`MISSING_PROFILE_CAUSES`).
   *
   * The workspace deliberately still holds a `researcher` agent-def — the
   * recreated-under-a-new-document case — because it is the sharpest reading of
   * the skip: the guard asks the **document** and `null` matches nothing, so the
   * whole directory is re-offered. That is correct and wanted. Designating there
   * is a write with a real effect, not the no-op the skip suppresses.
   */
  test("says on the menu that a resident's profile has gone", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, SOLO, PROFILE], {
      lanes: [
        {
          lane: "th_solo",
          resident: { name: "researcher", docId: null, weight: null, designationId: null },
          live: false,
          since: null,
          summary: null,
          origin: { id: "th_solo", title: "Q3 planning" },
        },
      ],
    });
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="th_solo"]').click();
    await expect(page.locator(CARD)).toBeVisible();

    // The badge already reported it, and still does — the designation stands, so
    // the resident is named by the profile it was designated with.
    await expect(page.locator(BADGE)).toHaveAttribute("data-resident-kind", "profile-gone");
    await expect(page.locator(`${BADGE} .t-resident-name`)).toHaveText("researcher");
    // At row width since UI-124 — the badge is one line in a head, and the whole
    // sentence overflowed it. The sentence is on the badge's own title, which is
    // SHARED-057's reveal, and `mark` and `note` are one fact off `LaneRow.kind`.
    await expect(page.locator(`${BADGE} .t-resident-note`)).toHaveText(MISSING_PROFILE_MARK);
    await expect(page.locator(BADGE)).toHaveAttribute(
      "title",
      new RegExp(MISSING_PROFILE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    await openMenu(page);
    const menu = page.getByRole("menu");
    const release = menu.locator('[data-act="resident-release"]');
    // Named, because the designation is what is being released…
    await expect(release).toContainText("Release researcher");
    // …and qualified in the sentence, which is the form a menu item has room for.
    await expect(release).toContainText(MISSING_PROFILE_NOTE);
    // The consequence is still said: the report is joined ahead of it, never in
    // place of it.
    await expect(release).toContainText("back to ordinary routing");

    // Re-offered, and that is the point: nothing resolves this designation now.
    await expect(menu.locator('[data-act="resident-designate-doc_researcher"]')).toContainText(
      "Replace with researcher",
    );
  });

  /**
   * The composer's own reading of the same designation (SPEC.md §7 — *"the
   * composer offers the live roster"*). A general lane is listed and pickable
   * like any other; it is named by the conversation it owns, because a list of
   * lanes has to tell them apart and it has no profile to be named by.
   */
  test("lists the general lane in the composer's recipient picker, and routes to it", async ({
    page,
  }) => {
    const corpus = await board(page, []);
    await openMenu(page);
    await page.getByRole("menu").locator('[data-act="resident-designate-general"]').click();
    await expect(page.locator(BADGE)).toBeVisible();

    const picker = '[data-composer-address="th_solo"]';
    // The composer foot first: in the 440px path column a row click opens
    // (UI-149, rider 3) the foot sits at the clipped edge, and a click on a
    // half-clipped control scrolls it under the pointer instead of pressing it.
    // Put the whole foot in view the way `address-room-geometry` does.
    await page.locator(".pcol .reader-scroll").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    // Two lanes now exist, which is when the line opens at all (UI-126: the
    // rows sit behind the composer's address line).
    await page.locator('button[data-address-line="th_solo"]').click();
    await expect(page.locator(`${picker} [data-recipient-lane]`)).toHaveCount(2);
    const lane = page.locator(`${picker} [data-recipient-lane="th_solo"]`);
    // UI-126 and SPEC.md §10's rider signed 2026-08-19: where the weight
    // control would be for a resident's lane, the composer states the answer
    // instead. A running agent cannot change what it is, so a control here
    // would discard the choice in silence — which is what a person reported.
    await expect(page.locator(`${picker} [data-resident-weight]`)).toContainText(
      "works at the weight chosen at launch",
    );
    await expect(page.locator(`${picker} [data-weight-key]`)).toHaveCount(0);
    await expect(lane).toContainText("Q3 planning");
    // Posting here goes to it without anybody saying so — §7's computed default.
    await expect(lane).toHaveAttribute("data-recipient-default", "true");

    await lane.click();
    await page.locator('[data-composer="th_solo"]').fill("Pick up the forecast thread, please.");
    await page.locator('[data-dropzone="th_solo"] .send').click();

    await expect
      .poll(async () =>
        (await corpus.of("POST", "/api/threads/th_solo/turns")).map(
          (call) => (call.body as { recipient?: string } | undefined)?.recipient,
        ),
      )
      .toEqual(["th_solo"]);
  });

  /**
   * SPEC.md §7: a resident is released by the person who designated it, and
   * *"resolving the thread releases its resident with it"*. Neither is named
   * after a profile it never had.
   */
  test("releases a general resident, and resolving takes the lane with it", async ({ page }) => {
    const corpus = await board(page, []);
    await openMenu(page);
    await page.getByRole("menu").locator('[data-act="resident-designate-general"]').click();
    await expect(page.locator(BADGE)).toBeVisible();

    await openMenu(page);
    const menu = page.getByRole("menu");
    const release = menu.locator('[data-act="resident-release"]');
    await expect(release).toContainText("Release the resident");
    await expect(release).not.toContainText("Q3 planning");
    // Already general, so designating one again is not offered: it would write
    // nothing (SPEC.md §7 — designation is single-valued).
    await expect(menu.locator('[data-act="resident-designate-general"]')).toHaveCount(0);

    await release.click();
    await expect
      .poll(async () => (await corpus.of("DELETE", "/api/threads/th_solo/resident")).length)
      .toBe(1);
    await expect(page.locator(BADGE)).toHaveCount(0);

    // Designate again, then resolve: the badge and the lane both go.
    await openMenu(page);
    await page.getByRole("menu").locator('[data-act="resident-designate-general"]').click();
    await expect(page.locator(BADGE)).toBeVisible();

    await page.locator(`${CARD} .t-resolve`).click();
    await expect(page.locator(BADGE)).toHaveCount(0);
  });

  /**
   * SPEC.md §7: *"a thread on a document is about that document, and a resident
   * owns a conversation rather than a passage"*. A comment's menu offers exactly
   * what it always offered — the general act is unconditional on the directory,
   * never on the rule that says who may designate.
   */
  test("offers nothing of the kind on a thread that hangs off a document", async ({ page }) => {
    await stubCorpus(page, [
      THREADS_VIEW,
      { id: "doc_note", type: "note", title: "The forecast", path: "data/docs/inbox/note.md" },
      {
        id: "th_on_doc",
        type: "thread",
        title: "on the forecast",
        path: "data/docs/threads/th_on_doc.md",
        parent: "doc_note",
        body: "## user · 2026-08-17T10:00:00Z\n\nIs this the final figure?\n",
      },
    ]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="th_on_doc"]').click();

    const card = '.thread-card[data-thread="th_on_doc"]';
    await expect(page.locator(card)).toBeVisible();
    await page.locator(card).click({ button: "right" });

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-act="resolve"]')).toBeVisible();
    await expect(menu.locator('[data-act="resident-designate-general"]')).toHaveCount(0);
    await expect(menu.locator('[data-act="resident-no-profiles"]')).toHaveCount(0);
  });
});

/**
 * **UI-167 in a real browser: the conversation's `⋯`.**
 *
 * The user's words were *"there's no longer a way to attach a resident to a
 * thread (at least not that I could find)"*. The act worked; the affordance did
 * not exist. `ThreadPanel`'s `openMenu` had two callers and both were
 * right-click, while the card's only buttons were resolve and the fold — so the
 * whole menu, the designation included, was reachable by one gesture that no
 * other object in the product requires.
 *
 * These assert the control's **presence** and its equality with the right-click
 * menu. The suite above passed throughout the defect, because every test in it
 * right-clicks.
 */
test.describe("reaching a conversation's actions with a left click", () => {
  test("draws a ⋯ on the card and designates a resident from it, pointer only", async ({
    page,
  }) => {
    const corpus = await board(page, []);

    const trigger = page.locator(TRIGGER);
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-label", "Actions for this standalone thread");

    await openFromTrigger(page);
    const offer = page.getByRole("menu").locator('[data-act="resident-designate-general"]');
    await expect(offer).toBeVisible();
    await offer.click();

    await expect.poll(async () => posted(corpus)).toEqual([{}]);
    await expect(page.locator(BADGE)).toHaveAttribute("data-resident-kind", "general");
  });

  /**
   * §10 binds the ⋯ sheet and the context menu to one set, and `menuModel.ts`
   * exists so they cannot drift. Asserted as an equality between two real
   * openings rather than as a claim about the code.
   */
  test("offers exactly the items the right-click offers", async ({ page }) => {
    await board(page, [PROFILE, ORCHESTRATE]);

    await openMenu(page);
    // The last items to arrive are the directory's and the declaration's, so
    // waiting on one of each is what makes this the settled set.
    await expect(
      page.getByRole("menu").locator('[data-act="resident-weight-heavy"]'),
    ).toBeVisible();
    const byPointer = await menuActs(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await openFromTrigger(page);
    await expect(
      page.getByRole("menu").locator('[data-act="resident-weight-heavy"]'),
    ).toBeVisible();
    expect(await menuActs(page)).toEqual(byPointer);
    expect(byPointer).toContain("resident-designate-doc_researcher");
  });

  /**
   * §10 adds no exclusive-pointer capability. Tab to the ⋯, `↵` to open — and a
   * key-opened menu focuses its first item, so the arrows and `↵` do the rest.
   * Only a real browser performs a focused button's default (UI-028 found this
   * on this very menu).
   */
  test("designates from the keyboard alone, reaching the ⋯ by Tab", async ({ page }) => {
    const corpus = await board(page, []);

    await page.locator(TRIGGER).focus();
    await expect(page.locator(TRIGGER)).toBeFocused();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-act="collapse"]')).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator('[data-act="resident-designate-general"]')).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(menu).toBeHidden();
    await expect.poll(async () => posted(corpus)).toEqual([{}]);
    await expect(page.locator(BADGE)).toBeVisible();
  });

  /**
   * A folded conversation is still a conversation (§10: *"collapsed is never
   * hidden"*). The line is one `<button>`, so the trigger is its sibling — a
   * button inside a button is markup no browser keeps, and this is the one place
   * that could be got wrong invisibly.
   */
  test("keeps the ⋯ beside a collapsed line, outside the line's own button", async ({ page }) => {
    await board(page, []);
    await openFromTrigger(page);
    await page.getByRole("menu").locator('[data-act="collapse"]').click();

    const chip = page.locator('[data-thread-panel="th_solo"] [data-thread-expand]');
    await expect(chip).toBeVisible();
    const trigger = page.locator(TRIGGER);
    await expect(trigger).toBeVisible();
    // Sibling, not descendant — measured in the DOM the browser actually built.
    expect(await trigger.evaluate((node) => node.closest("[data-thread-expand]") !== null)).toBe(
      false,
    );

    await trigger.click();
    await expect(page.getByRole("menu").locator('[data-act="collapse"]')).toContainText("Expand");
  });
});

/**
 * **UI-168 in a real browser: the level a resident runs at.**
 *
 * The user's words were *"I'm still not confident I can pick the model when
 * attaching a resident"*. They were right: `useResident`'s mutation took
 * `{id, designate}` and nothing else, so every designation the app ever made
 * sent no `weight`. The contract carried it, the server honoured it, and
 * `corpus resident` set it.
 *
 * A weight is a **level's key from the workspace's own tier table**, never a
 * model name — which is how §10's signed non-goal holds while the user's real
 * question is answered.
 */
test.describe("choosing what the resident runs at", () => {
  test("offers the workspace's levels and sends the chosen key with the designation", async ({
    page,
  }) => {
    const corpus = await board(page, [ORCHESTRATE]);
    await openFromTrigger(page);
    const menu = page.getByRole("menu");

    const heavy = menu.locator('[data-act="resident-weight-heavy"]');
    await expect(heavy).toBeVisible();
    // The declared label, never the key — and never a model name.
    await expect(heavy).toContainText("Heavy or judgment-laden");
    await expect(menu).not.toContainText(/haiku|sonnet|opus/i);
    // The set stands on "the launcher decides" until somebody moves it.
    await expect(menu.locator('[data-act="resident-weight-launch"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await heavy.click();
    // Still open: a level states what the act below will send.
    await expect(menu).toBeVisible();
    await expect(heavy).toHaveAttribute("aria-checked", "true");
    await expect(menu.locator('[data-act="resident-designate-general"]')).toContainText(
      "at Heavy or judgment-laden",
    );

    await menu.locator('[data-act="resident-designate-general"]').click();

    // The whole issue, on the wire.
    await expect.poll(async () => posted(corpus)).toEqual([{ weight: "heavy" }]);
    // The badge follows, naming **who** — and saying nothing about the level.
    await expect(page.locator(BADGE)).toBeVisible();
    await expect(page.locator(BADGE)).not.toContainText("Heavy or judgment-laden");
    // …and the level is reported where the choice is made, read back off the
    // designation rather than off the click that made it.
    expect(await residentLevel(page)).toBe("heavy");
  });

  /**
   * The ordinary case has to stay ordinary: the contract makes the field
   * optional so absence means what it meant before the field existed — the
   * launcher decides. The key must be **absent**, not null and not empty.
   */
  test("omits the key entirely when nobody touched the rows", async ({ page }) => {
    const corpus = await board(page, [ORCHESTRATE]);
    await openFromTrigger(page);
    await expect(
      page.getByRole("menu").locator('[data-act="resident-weight-launch"]'),
    ).toBeVisible();
    await page.getByRole("menu").locator('[data-act="resident-designate-general"]').click();

    await expect.poll(async () => posted(corpus)).toEqual([{}]);
    await expect.poll(async () => Object.keys((await posted(corpus))[0] as object)).toEqual([]);
    // …and the menu comes back standing on the launcher's row, which is what
    // `Resident.weight: null` means read back.
    expect(await residentLevel(page)).toBe("launch");
  });

  /**
   * *"Same profile, new level"* is a write the server performs and reports
   * (`threads/resident.ts:251` — a different weight is a different state) — so
   * the menu must not treat it as the no-op its skip suppresses. The reverse
   * direction is here too: coming back to the launcher's choice **clears** the
   * level server-side, so that act has to stay offered as well.
   */
  test("re-designates the same profile at a different level, and back again", async ({ page }) => {
    const corpus = await board(page, [PROFILE, ORCHESTRATE]);

    await openFromTrigger(page);
    await page.getByRole("menu").locator('[data-act="resident-weight-light"]').click();
    await page.getByRole("menu").locator('[data-act="resident-designate-doc_researcher"]').click();
    await expect(page.locator(BADGE)).toBeVisible();

    // Reopening shows what the resident runs at now — the menu is where the
    // level is reported, and where it is changed.
    await openFromTrigger(page);
    await expect(
      page.getByRole("menu").locator('[data-act="resident-weight-light"]'),
    ).toHaveAttribute("aria-checked", "true");
    // Same profile, same level: not offered, because it would write nothing.
    await expect(
      page.getByRole("menu").locator('[data-act="resident-designate-doc_researcher"]'),
    ).toHaveCount(0);

    // Same profile, new level: offered, and named as a re-designation rather
    // than as a swap that displaces somebody.
    await page.getByRole("menu").locator('[data-act="resident-weight-heavy"]').click();
    const again = page.getByRole("menu").locator('[data-act="resident-designate-doc_researcher"]');
    await expect(again).toContainText("Re-designate researcher");
    await again.click();

    await expect
      .poll(async () => posted(corpus))
      .toEqual([
        { name: "researcher", weight: "light" },
        { name: "researcher", weight: "heavy" },
      ]);
    expect(await residentLevel(page)).toBe("heavy");

    // Back to the launcher's choice, which is a real write: it clears the level.
    await openFromTrigger(page);
    await page.getByRole("menu").locator('[data-act="resident-weight-launch"]').click();
    await page.getByRole("menu").locator('[data-act="resident-designate-doc_researcher"]').click();
    await expect.poll(async () => (await posted(corpus)).at(-1)).toEqual({ name: "researcher" });
    expect(await residentLevel(page)).toBe("launch");
  });

  /**
   * A workspace whose guidance declares no levels offers no rows and still
   * designates. `weightLevels.ts` fails **clean**, so "declares nothing" and
   * "declares something unreadable" are one answer — and a workspace on a
   * template older than AGENT-015 is in that state today.
   */
  test("offers no rows where the workspace declares none, and designates anyway", async ({
    page,
  }) => {
    const corpus = await board(page, []);
    await openFromTrigger(page);
    const menu = page.getByRole("menu");
    await expect(menu.locator('[data-act="resident-designate-general"]')).toBeVisible();
    await expect(menu.getByRole("menuitemradio")).toHaveCount(0);

    await menu.locator('[data-act="resident-designate-general"]').click();
    await expect.poll(async () => posted(corpus)).toEqual([{}]);
  });
});
