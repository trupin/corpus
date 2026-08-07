import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-084 in a real browser: the three controls a form renders, and the Attention
 * row that survives being read (SPEC.md §6, §11).
 *
 * **The asymmetry is the point.** §7's read state clears when you look, so every
 * other Attention reason vanishes the moment the thread is opened — a question
 * the agent asked in prose leaves Attention answered or not. An unanswered form
 * does not: its row clears by **acting** on it (answering) or by resolving the
 * thread, and by nothing else. That is what a form buys over asking in prose,
 * and it is the reason this file's most valuable assertion is "open the thread,
 * close it, the row is still there" — with an unread agent reply in the same
 * board as the control that proves the assertion says something.
 *
 * The stub derives `attention` from each thread's own turns rather than taking a
 * seeded flag, so nothing here can clear a row by fiat: `POST …/seen` clears the
 * unread reason because the reason is computed from the unread mark, and only
 * the answer route clears the form reason because the reason is computed from
 * the open forms.
 */

const ATTENTION_VIEW = {
  id: "doc_view_attention",
  type: "view",
  title: "Attention",
  path: "data/docs/views/attention.md",
  pinned: true,
  order: 1,
  query: { needs: "me" },
};

/** A second column, for the threads that never reach Attention (answered, broken). */
const ALL_THREADS_VIEW = {
  id: "doc_view_all",
  type: "view",
  title: "Threads",
  path: "data/docs/views/threads.md",
  pinned: true,
  order: 2,
  query: { type: "thread" },
};

const FORM_TS = "2026-07-19T10:07:00Z";

const threeFieldForm = [
  "Two things before I file it.",
  "",
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

const threadBody = (turns: readonly (readonly [string, string, string])[]): string =>
  turns.map(([author, ts, body]) => `## ${author} · ${ts}\n${body}\n`).join("\n");

const FORM_THREAD = {
  id: "th_form",
  type: "thread",
  title: "Which quote",
  path: "data/threads/th_form.md",
  parent: null,
  unread: false,
  body: threadBody([
    ["user", "2026-07-19T10:05:00Z", "Which insurer should we go with?"],
    ["agent", FORM_TS, threeFieldForm],
  ]),
};

/** The control: a thread whose only signal is an unread agent reply. */
const REPLY_THREAD = {
  id: "th_reply",
  type: "thread",
  title: "Just a reply",
  path: "data/threads/th_reply.md",
  parent: null,
  unread: true,
  body: threadBody([
    ["user", "2026-07-19T09:00:00Z", "Any news?"],
    ["agent", "2026-07-19T09:02:00Z", "Filed it this morning."],
  ]),
};

const column = (page: import("@playwright/test").Page) =>
  page.locator('.col[data-col="doc_view_attention"]');

const row = (page: import("@playwright/test").Page, id: string) =>
  column(page).locator(`.row[data-row-doc="${id}"]`);

test.describe("the Attention row a form leaves behind", () => {
  test("survives being read, while an unread reply's row does not", async ({ page }) => {
    await stubCorpus(page, [ATTENTION_VIEW, FORM_THREAD, REPLY_THREAD]);
    await page.goto("/");

    // Both rows are there, each saying why.
    await expect(row(page, "th_form")).toBeVisible();
    await expect(row(page, "th_form").locator('[data-reason="form"]')).toHaveText(
      "awaiting your answer",
    );
    await expect(row(page, "th_reply").locator('[data-reason="unread-reply"]')).toHaveText(
      "agent replied",
    );

    // The control: reading the reply is what its reason asked for, so it goes.
    await row(page, "th_reply").click();
    await expect(column(page).locator(".thread-card")).toBeVisible();
    await column(page).getByRole("button", { name: "‹ Attention" }).click();
    await expect(row(page, "th_reply")).toHaveCount(0);

    // The assertion this whole feature exists for: the form's row is still here.
    await row(page, "th_form").click();
    await expect(column(page).locator(".form-comment")).toBeVisible();
    await column(page).getByRole("button", { name: "‹ Attention" }).click();
    await expect(row(page, "th_form")).toBeVisible();
    await expect(row(page, "th_form").locator('[data-reason="form"]')).toHaveText(
      "awaiting your answer",
    );
  });

  test("clears when the form is answered, from the keyboard alone", async ({ page }) => {
    const corpus = await stubCorpus(page, [ATTENTION_VIEW, FORM_THREAD]);
    await page.goto("/");

    await row(page, "th_form").click();
    const form = column(page).locator(".form-comment");
    await expect(form).toBeVisible();

    // Submit is unavailable until every required field has an answer, and the
    // form names the questions still missing rather than failing silently.
    const submit = form.locator(".form-submit");
    await expect(submit).toBeDisabled();
    await expect(form.locator(".form-missing")).toContainText("Which quote should I file?");
    await expect(form.locator(".form-missing")).toContainText("Which riders do you want?");

    // The `write` field is a real box, not a borderless strip: the growing
    // textarea's mirror forces the border onto the wrapper, and `.composer-grow
    // > textarea` out-specifies a class on the field itself.
    await expect(form.locator(".form-write")).toHaveCSS("border-top-width", "1px");

    // Everything reachable from the keyboard: no answer is pointer-only (§11).
    await form.locator('input[type="radio"]').first().focus();
    await page.keyboard.press("Space");
    await expect(form.locator(".form-opt.picked")).toHaveCount(1);
    await expect(submit).toBeDisabled();
    await expect(form.locator(".form-missing")).not.toContainText("Which quote should I file?");

    await form.locator('input[type="checkbox"]').first().focus();
    await page.keyboard.press("Space");
    await expect(form.locator(".form-missing")).toHaveCount(0);
    await expect(submit).toBeEnabled();

    // The optional `write` field is left blank, and sends no entry at all.
    await page.keyboard.press("ControlOrMeta+Enter");

    // The controls become the record, in place, each question beside what was given.
    const record = column(page).locator(".form-comment.form-answered");
    await expect(record).toBeVisible();
    await expect(record.locator(".form-record-row")).toHaveCount(3);
    await expect(record.locator(".form-record-a").nth(0)).toHaveText("Lemonade — $1,840/yr");
    await expect(record.locator(".form-record-a").nth(1)).toHaveText("Water backup");
    await expect(record.locator(".form-record-a").nth(2)).toHaveText("left blank");
    await expect(column(page).locator(".form-submit")).toHaveCount(0);

    const answered = (await corpus.of("POST")).find((call) => call.path.endsWith("/form"));
    expect(answered?.body).toEqual({
      answers: [
        { question: "Which quote should I file?", option: "Lemonade — $1,840/yr" },
        { question: "Which riders do you want?", options: ["Water backup"] },
      ],
    });

    // And the Attention row clears — the action, not the reading, is what did it.
    await column(page).getByRole("button", { name: "‹ Attention" }).click();
    await expect(row(page, "th_form")).toHaveCount(0);
  });

  test("survives a reload as the record it is", async ({ page }) => {
    await stubCorpus(page, [
      ATTENTION_VIEW,
      ALL_THREADS_VIEW,
      {
        ...FORM_THREAD,
        body: `${FORM_THREAD.body}\n${threadBody([
          [
            "user",
            "2026-07-19T10:20:00Z",
            [
              "**Answered:**",
              "",
              "**Which quote should I file?**",
              "",
              "State Farm — $1,975/yr",
              "",
              "**Which riders do you want?**",
              "",
              "- Extended replacement",
              "",
              "**Anything I should know?**",
              "",
              "_(left blank)_",
              "",
              "**Note:**",
              "",
              "the roof is new",
            ].join("\n"),
          ],
        ])}`,
      },
    ]);
    await page.goto("/");

    // Answered, so it is no longer awaiting an answer: nothing in Attention.
    await expect(row(page, "th_form")).toHaveCount(0);

    // Opened from the other column instead — a fresh load with no memory of any
    // submit, so the record can only have come off the turn's own prose.
    const all = page.locator('.col[data-col="doc_view_all"]');
    await all.locator('.row[data-row-doc="th_form"]').click();
    const record = all.locator(".form-comment.form-answered");
    await expect(record).toBeVisible();
    await expect(record.locator(".form-record-a").nth(0)).toHaveText("State Farm — $1,975/yr");
    await expect(record.locator(".form-record-a").nth(1)).toHaveText("Extended replacement");
    await expect(record.locator(".form-record-a").nth(2)).toHaveText("left blank");
    await expect(record).toContainText("the roof is new");
    await expect(all.locator(".form-submit")).toHaveCount(0);
  });

  test("shows both signals at once, and neither suppresses the other", async ({ page }) => {
    await stubCorpus(page, [ATTENTION_VIEW, { ...FORM_THREAD, unread: true }]);
    await page.goto("/");

    const reasons = row(page, "th_form").locator(".r-chip");
    await expect(reasons).toHaveCount(2);
    await expect(row(page, "th_form").locator('[data-reason="unread-reply"]')).toBeVisible();
    await expect(row(page, "th_form").locator('[data-reason="form"]')).toBeVisible();

    // Reading it takes the reply's reason and leaves the form's.
    await row(page, "th_form").click();
    await expect(column(page).locator(".form-comment")).toBeVisible();
    await column(page).getByRole("button", { name: "‹ Attention" }).click();
    await expect(row(page, "th_form").locator('[data-reason="unread-reply"]')).toHaveCount(0);
    await expect(row(page, "th_form").locator('[data-reason="form"]')).toBeVisible();
  });

  test("clears when the thread is resolved instead of answered", async ({ page }) => {
    const corpus = await stubCorpus(page, [ATTENTION_VIEW, FORM_THREAD]);
    await page.goto("/");

    await row(page, "th_form").click();
    await column(page).locator(".t-resolve").click();
    // Resolving re-asserts the collapse rule (§11), so the card folds — what is
    // being asserted here is the reason, not the card.
    await expect.poll(async () => (await corpus.doc("th_form"))?.status).toBe("resolved");
    await column(page).getByRole("button", { name: "‹ Attention" }).click();
    await expect(row(page, "th_form")).toHaveCount(0);
  });

  test("renders a form it cannot read as the broken block it is", async ({ page }) => {
    await stubCorpus(page, [
      ATTENTION_VIEW,
      ALL_THREADS_VIEW,
      {
        ...FORM_THREAD,
        id: "th_broken",
        path: "data/threads/th_broken.md",
        body: threadBody([
          [
            "agent",
            FORM_TS,
            [
              "```form",
              "fields:",
              "  - question: Which quote?",
              "    kind: choose one",
              "    options:",
              "      - Lemonade",
              "  - question: How much?",
              "    kind: number",
              "```",
            ].join("\n"),
          ],
        ]),
      },
    ]);
    await page.goto("/");

    const all = page.locator('.col[data-col="doc_view_all"]');
    await all.locator('.row[data-row-doc="th_broken"]').click();

    await expect(all.locator(".form-broken")).toBeVisible();
    await expect(all.locator(".form-warning")).toContainText("This form could not be read");
    // Never a partial set of controls: not the field it did understand either.
    await expect(all.locator(".form-comment")).toHaveCount(0);
    await expect(all.locator(".form-opt")).toHaveCount(0);
    await expect(all.locator(".form-submit")).toHaveCount(0);

    /*
     * PR #28 finding 6. The warning is all the reader gets, so it has to say
     * *what* is wrong: `FormSchema` is a union, and its own first issue message
     * is the useless "Invalid input" — which is exactly what this fence used to
     * render. The sentence now comes from the contract's `describeFormFailure`,
     * so the board and the answer route's `404` say the same thing about the
     * same bytes, and it names the second field, its `kind`, and the three kinds
     * it could have been.
     */
    const warning = all.locator(".form-warning");
    await expect(warning).toContainText("fields.1.kind");
    await expect(warning).toContainText("choose one");
    await expect(warning).toContainText("choose any");
    await expect(warning).toContainText("write");
    await expect(warning).not.toContainText("Invalid input");
  });

  /**
   * PR #28 re-review, MAJOR. An answer whose own text would make the record
   * unreadable is refused by the server — and `**Note:**` on its own line is
   * ordinary markdown in a documents app, while AGENT-017 pushes the agent
   * toward `write` fields. Before this, that typo cost a round trip and came
   * back as `POST /api/threads/{id}/turns/{ts}/form failed (HTTP 400): …` in a
   * toast that dismissed itself, with no field marked and no line pointed at.
   *
   * The whole point is the *absence* of a request, so that is what this asserts
   * alongside the message: `corpus.of("POST")` must never see the answer.
   */
  test("refuses an answer that would not read back, in the form and before the wire", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [
      ATTENTION_VIEW,
      {
        ...FORM_THREAD,
        id: "th_write",
        path: "data/threads/th_write.md",
        body: threadBody([
          [
            "agent",
            FORM_TS,
            [
              "```form",
              "fields:",
              "  - question: What happened?",
              "    kind: write",
              "  - question: Anything I should know?",
              "    kind: write",
              "    optional: true",
              "```",
            ].join("\n"),
          ],
        ]),
      },
    ]);
    await page.goto("/");

    await row(page, "th_write").click();
    const form = column(page).locator(".form-comment");
    await expect(form).toBeVisible();

    const first = form.locator(".form-field").first();
    const second = form.locator(".form-field").nth(1);
    await first.locator("textarea").fill("the file moved\n\n**Note:**\n\nmine");

    // Said at the field that earned it, naming the line to rewrite — and not at
    // the innocent one beside it.
    const fault = first.locator(".form-unreadable");
    await expect(fault).toBeVisible();
    await expect(fault).toContainText("**Note:**");
    await expect(fault).toContainText("rewrite that line");
    await expect(second.locator(".form-unreadable")).toHaveCount(0);
    await expect(first.locator("textarea")).toHaveAttribute("aria-invalid", "true");

    // Submit is unavailable, and the key that submits does nothing either.
    const submit = form.locator(".form-submit");
    await expect(submit).toBeDisabled();
    await page.keyboard.press("ControlOrMeta+Enter");
    expect((await corpus.of("POST")).filter((call) => call.path.endsWith("/form"))).toHaveLength(0);

    // Rewriting the line is all it takes; the rest of the draft never moved.
    await first.locator("textarea").fill("the file moved. Note: mine");
    await expect(first.locator(".form-unreadable")).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await page.keyboard.press("ControlOrMeta+Enter");

    const record = column(page).locator(".form-comment.form-answered");
    await expect(record).toBeVisible();
    await expect(record.locator(".form-record-a").nth(0)).toHaveText("the file moved. Note: mine");
  });

  /**
   * PR #28 finding 7. A radio group cannot un-click itself, so an optional
   * single-select had no way back to blank — and §6 answers a form once, as a
   * whole, so a mis-click was unrecoverable and silently changed what the agent
   * is told. AGENT-017 tells the agent to mark fields optional generously, which
   * makes this the common shape rather than the exotic one.
   */
  test("lets an optional choice be taken back to blank, from the keyboard", async ({ page }) => {
    const corpus = await stubCorpus(page, [
      ATTENTION_VIEW,
      {
        ...FORM_THREAD,
        id: "th_optional",
        path: "data/threads/th_optional.md",
        body: threadBody([
          [
            "agent",
            FORM_TS,
            [
              "```form",
              "fields:",
              "  - question: Which quote should I file?",
              "    kind: choose one",
              "    optional: true",
              "    options:",
              "      - Lemonade — $1,840/yr",
              "      - State Farm — $1,975/yr",
              "```",
            ].join("\n"),
          ],
        ]),
      },
    ]);
    await page.goto("/");

    await row(page, "th_optional").click();
    const form = column(page).locator(".form-comment");
    await expect(form).toBeVisible();

    // Blank is where an untouched optional field starts, and it is shown as a
    // chosen state rather than as the absence of one.
    const blank = form.locator(".form-opt-blank");
    await expect(blank).toContainText("Leave blank");
    await expect(blank).toHaveClass(/picked/);

    // The mis-click.
    await form.locator('.form-opt:not(.form-opt-blank) input[type="radio"]').first().click();
    await expect(form.locator(".form-opt.picked")).toHaveCount(1);
    await expect(blank).not.toHaveClass(/picked/);

    // The way back, reached with the arrow keys of the group it belongs to —
    // never a pointer-only affordance (§11). Two options plus the blank row, so
    // ArrowDown twice from the first lands on it.
    await form.locator('.form-opt:not(.form-opt-blank) input[type="radio"]').first().focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(blank).toHaveClass(/picked/);
    await expect(form.locator(".form-opt.picked")).toHaveCount(1);

    // And blank means blank: no entry at all, never `option: ""`.
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(column(page).locator(".form-comment.form-answered")).toBeVisible();
    const answered = (await corpus.of("POST")).find((call) => call.path.endsWith("/form"));
    expect(answered?.body).toEqual({ answers: [] });
    await expect(column(page).locator(".form-record-a")).toHaveText("left blank");
  });
});
