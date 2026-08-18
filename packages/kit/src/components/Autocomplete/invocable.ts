/**
 * **Which `type: agent-def` / `type: skill` documents may be *offered*, and
 * under what name** — the client's half of SPEC.md §8's resolution rule, in one
 * file because two independent copies of it is what UI-123 is.
 *
 * Deliberately dependency-free: no React, no `@corpus/contract`, nothing but the
 * rule. It is the client side of a parity test that runs the same fixture
 * through this and through the server's `threads/mentions.ts`
 * (`scripts/mention-offer-parity.test.ts`), and that test may not drag a UI
 * runtime into repo tooling to ask its question.
 */

/** The one field of a document row the rule reads. */
export interface PathRow {
  /** Workspace-relative path, as `GET /api/docs` reports it. */
  readonly path: string;
}

/**
 * The name a `type: skill` / `type: agent-def` document is **invocable** by,
 * derived from its path exactly as the server derives it (`mentions.ts`):
 *
 *   - `.claude/skills/<name>/SKILL.md`          → `<name>`
 *   - `.claude/skills-archived/<name>/SKILL.md` → `<name>`
 *   - `.claude/agents/<name>.md`                → `<name>`
 *
 * `null` for a document outside those roots — a `type: skill` note filed under
 * `data/docs/` is a document *about* a skill, and Claude Code loads neither it
 * nor an `agent-def` filed beside it.
 */
export function invocableName(path: string): string | null {
  const skill = /^\.claude\/skills(?:-archived)?\/([^/]+)\//.exec(path);
  if (skill?.[1] !== undefined) return skill[1];
  const agent = /^\.claude\/agents\/([^/]+)\.md$/.exec(path);
  return agent?.[1] ?? null;
}

/**
 * The token a mention/invocation row is completed to, or **`null` when the row
 * has no name at all** and must not be offered.
 *
 * It used to fall back to `row.title`, because the server's index carried a
 * title alias for every row and that alias resolved. SERVER-125 took the fallback
 * away at the source: `targetIndex` now skips a row whose {@link invocableName}
 * is null *whole*, title alias included, so an off-root `agent-def` is
 * addressable under no spelling. A title is still a working alias — it is what
 * the designate menu sends — but only for a row that has an invocable name to be
 * an alias *of*.
 *
 * So the fallback is gone rather than moved. Offering a row the server will
 * resolve to nothing teaches a name that summons nobody, and §8 answers such a
 * mention by being inert: the turn posts, the token is reported unresolved, and
 * nothing wakes. A menu that offered it would be the only place in the product
 * claiming that persona exists.
 */
export function rowToken(row: PathRow): string | null {
  return invocableName(row.path);
}

/**
 * **The gate both offer surfaces apply**: true when the server would resolve
 * this row under some spelling, and false when it would resolve it under none.
 *
 * One predicate, exported, because the bug it closes was two of them. The `@`
 * autocomplete derived a token and the designate menu derived a name, each from
 * its own reading of what an agent-def answers to, and when the server changed
 * its mind both were wrong in the same way at once and neither noticed.
 *
 * Only about being **offered**. Nothing here decides what is listed, readable or
 * editable: `GET /api/docs?type=agent-def` still returns every agent-def, the
 * board's `type:` filter and the seeded "Skills & agents" view still show them,
 * and a document about a persona stays a document. What it loses is a place in a
 * menu that promises resolution.
 */
export function isAddressableTarget(row: PathRow): boolean {
  return rowToken(row) !== null;
}
