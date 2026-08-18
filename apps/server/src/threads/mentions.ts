// Mentions and invocations (SPEC.md §8): "the server parses mentions and
// invocations at post time, validates them against the projection, and puts
// structured `mentions`/`skills` fields in the event payload".
//
// Three token kinds, and the difference between them is what the orchestrator
// dispatches on:
//
//   - `@agent`      — generic request. Routing is the orchestrator's triage.
//   - `@<subagent>` — a `type: agent-def` document's name. A *directive*.
//   - `/<skill>`    — a `type: skill` document's name. Also a directive.
//
// A token that resolves to nothing is reported but **never wakes the agent** on
// its own: `@here`, `/tmp/x` and a stray `@todo` are ordinary prose, and a rule
// that woke the agent for any `@word` would make every plain comment an event.
// An **archived** target does wake it, with its status attached — §8 hands the
// "missing or archived" case to the orchestrator to answer in its reply, which
// it cannot do if the server swallows the request first.

import { classifyPath, type ProjectionDb } from "../projection/index.js";
import { codeRanges, overlapsRange } from "../core/index.js";

/** The token that means "the agent, whoever that turns out to be" (SPEC.md §8). */
export const GENERIC_AGENT_MENTION = "agent";

/** Document types the two sigils resolve against. */
export const MENTION_TYPE = "agent-def";
export const INVOCATION_TYPE = "skill";

export interface ResolvedTarget {
  readonly name: string;
  readonly docId: string;
  /** The target's document status; `archived` is a legitimate, reported answer. */
  readonly status: string;
}

export interface ParsedMentions {
  /** True when the body carries a bare `@agent`. */
  readonly generic: boolean;
  readonly mentions: ResolvedTarget[];
  readonly skills: ResolvedTarget[];
  /** Tokens that matched no document, with their sigil, in first-seen order. */
  readonly unresolved: string[];
}

export const NO_MENTIONS: ParsedMentions = {
  generic: false,
  mentions: [],
  skills: [],
  unresolved: [],
};

/**
 * True when the parse asks for the agent. Deliberately *not* a function of
 * `unresolved`: see the module header.
 */
export const requestsAgent = (parsed: ParsedMentions): boolean =>
  parsed.generic || parsed.mentions.length > 0 || parsed.skills.length > 0;

/**
 * A token starts a mention only at a boundary that is not inside a word, a path,
 * or an address. The character *before* the sigil is the whole test:
 *
 *   - `me@agent.example`  — preceded by `e`, so not a mention (an email).
 *   - `path/comment/x`    — preceded by `h`, so not an invocation (a path).
 *   - `a@agentb`          — preceded by `a`, so not a mention.
 *   - `https://x/comment` — preceded by `x`, so not an invocation (a URL).
 *
 * Trailing punctuation is deliberately *not* tested: "@agent." ending a sentence
 * and "/comment," in a list are both ordinary writing, and a rule that rejected
 * them would silently drop the request the person meant to make.
 */
const TOKEN = /(?<![A-Za-z0-9_/@.-])([@/])([A-Za-z0-9_-]+)/g;

interface Token {
  readonly sigil: string;
  readonly name: string;
}

/**
 * Every mention-shaped token outside code. Code is opaque by the same rule the
 * `[[ref]]` scanner and the turn-heading scanner use (the contract's `code.ts`),
 * so a turn
 * documenting the mention syntax in a fenced block or an inline span does not
 * summon anyone.
 */
export function scanMentionTokens(body: string): Token[] {
  const opaque = codeRanges(body);
  const tokens: Token[] = [];
  for (const match of body.matchAll(TOKEN)) {
    const sigil = match[1];
    const name = match[2];
    if (sigil === undefined || name === undefined) continue;
    if (overlapsRange(opaque, match.index, match.index + match[0].length)) continue;
    tokens.push({ sigil, name });
  }
  return tokens;
}

/**
 * The name a document is **invocable** by, from its path — which is exactly what
 * Claude Code discovers it as, and therefore what a person types after the
 * sigil:
 *
 *   - `.claude/skills/<name>/SKILL.md`          → `<name>`
 *   - `.claude/skills-archived/<name>/SKILL.md` → `<name>`
 *   - `.claude/agents/<name>.md`                → `<name>`
 *
 * Matching on `documents.title` alone is not enough and the seeded corpus proves
 * it: `comment/SKILL.md` carries **both** Claude Code's `name: comment` and
 * Corpus's `title: Comment` (§7 — "the two sets coexist in the same YAML
 * block"), the projection keeps the title, and `/comment` would resolve to
 * nothing. There is no `name` column to consult, and the path already encodes
 * the answer — a skill whose directory does not match its `name` is not
 * discoverable by Claude Code either.
 *
 * `null` for anything outside those roots: a `type: skill` document filed under
 * `data/docs/` is a document about a skill, not an invocable one. That answer is
 * not only about spelling — {@link targetIndex} takes it as the gate on being
 * addressable at all, so a document with no invocable name resolves to nothing
 * under any spelling, its title included (SERVER-125).
 *
 * **A skill's name is the directory holding it, so a `SKILL.md` sitting
 * directly in a skills root has none** (SERVER-127). Claude Code discovers a
 * skill by that folder; a file the folder does not name is loaded by nothing,
 * which is SERVER-125's own gate condition in a shape that change did not
 * reach. Slicing the first segment answered `"SKILL.md"` there, and while that
 * spelling is untypeable — the token charset excludes `.` — indexing the row
 * indexed its **title** alias too, and `titleFromPath` falls back to the parent
 * directory, so an untitled bare `SKILL.md` answered `/skills`. Worse, ties
 * break by `doc_*` id order, which is minted at random: such a file could take
 * a working skill's key. So the remainder must carry a directory segment before
 * the filename, exactly as the kit's regex requires one
 * (`packages/kit/src/components/Autocomplete/invocable.ts`, compared over one
 * workspace by `scripts/mention-offer-parity.test.ts`). The row stays projected
 * — listed, readable, editable; only its addressability goes.
 */
export function invocableName(path: string): string | null {
  const root = classifyPath(path);
  if (root === null) return null;
  const rest = path.slice(root.path.length + 1);
  if (root.shape === "skill-tree") {
    const segments = rest.split("/");
    const directory = segments.length > 1 ? segments[0] : undefined;
    return directory === undefined || directory === "" ? null : directory;
  }
  if (root.key !== "agents") return null;
  const filename = rest.split("/").at(-1);
  return filename === undefined ? null : filename.replace(/\.md$/, "");
}

type TargetRow = { id: string; path: string; title: string; status: string };

const targetRows = (projection: ProjectionDb, type: string): TargetRow[] =>
  projection
    .prepare("SELECT id, path, title, status FROM documents WHERE type = ? ORDER BY id")
    .all(type) as TargetRow[];

/**
 * Every **addressable** document of `type`, indexed by the names it answers to.
 *
 * **Two aliases per document, and both are load-bearing.** A row is indexed
 * under its {@link invocableName} *and* its `title`, lowercased, because nobody
 * types a capital letter after a sigil and because the two spellings are
 * routinely different documents' worth of apart: the `profile` skill writes
 * title `Bookkeeper` to `.claude/agents/bookkeeper.md`, so a person in a
 * composer types the **stem** (`@bookkeeper`) while the board's designate menu
 * sends the **title** it read off the document row (`residentActions.ts` —
 * "a designation resolves against an agent-def's invocable name *and* its title
 * alike"). Drop either alias and one of those two callers stops working. The
 * resolved target carries the invocable name whichever spelling found it, which
 * is why a designation stores `bookkeeper` however it was addressed.
 *
 * **The invocable name is also the gate, and it decides the whole row**
 * (SERVER-125). `invocableName` is `null` for a document filed outside the root
 * its type is discovered from, and says in as many words what that means: "a
 * `type: skill` document filed under `data/docs/` is a document about a skill,
 * not an invocable one". SERVER-122 kept an explicit `--folder` winning over the
 * by-type default for exactly that case. But the title alias was applied to
 * those rows too, which made the document about a persona *into* a persona on
 * every surface except the one that matters: `type: agent-def` under
 * `data/docs/` resolved `@bookkeeper`, was offered by the `@` autocomplete and
 * was designatable as a resident, while carrying none of Claude Code's
 * frontmatter (`claudeCodeFields` returns `{}` off-root), being loaded by
 * nothing, and answering no dispatch. §8 routes a `@<subagent>` mention to a
 * Claude Code subagent; there was none, so the directive named a persona that
 * could not be reached and nothing anywhere said so.
 *
 * It was also a way to take a working persona's name away from it. Ties are
 * broken by id order and a created document's `doc_*` id is minted at random, so
 * an inert note titled `Researcher` under `data/docs/` won the `researcher` key
 * from `.claude/agents/researcher.md` whenever its id happened to sort first.
 *
 * So an unaddressable row is skipped whole rather than indexed under its title
 * alone: a name that names nobody is a state this module already has, reports as
 * `unresolved`, and deliberately does not wake the agent for — see the module
 * header. What it is *not* is a second, invisible address for a document that
 * answers nothing. {@link unaddressableTarget} is how a caller that has already
 * failed to resolve can say which document was skipped and why.
 *
 * First row wins a collision, in id order, so the answer is at least
 * deterministic; two skills claiming one name is a `doc check` finding (§14),
 * not something to resolve arbitrarily at post time.
 */
function targetIndex(projection: ProjectionDb, type: string): Map<string, ResolvedTarget> {
  const index = new Map<string, ResolvedTarget>();
  for (const row of targetRows(projection, type)) {
    const invocable = invocableName(row.path);
    if (invocable === null) continue;
    const target: ResolvedTarget = { name: invocable, docId: row.id, status: row.status };
    for (const alias of [invocable, row.title]) {
      if (alias === "") continue;
      const key = alias.toLowerCase();
      if (!index.has(key)) index.set(key, target);
    }
  }
  return index;
}

/** A document that answers to a name it cannot be addressed by; see {@link unaddressableTarget}. */
export type UnaddressableTarget = {
  readonly docId: string;
  /** Workspace-relative path — the whole reason it is not addressable. */
  readonly path: string;
  readonly title: string;
};

/**
 * The document of `type` whose **title** is `name` but whose path gives it no
 * invocable name — the row {@link targetIndex} deliberately skipped (SERVER-125).
 *
 * Asked only after a resolution has already failed, and only so the refusal can
 * say *why*. "No agent named Bookkeeper in this workspace" is true and useless
 * when a document titled exactly that is sitting in the inbox, and the person
 * reading it has no way to tell a typo from a persona filed one directory away.
 *
 * The mention path has no channel for this — an unresolved token is a bare
 * string in the event payload — so the caller is the one surface where somebody
 * asks the server for a persona by name and waits for the answer: a designation
 * (§7). Everywhere else the state is reported by being inert, which is what §8
 * already does with a target that names nobody.
 *
 * Matched on the title alone, because that is the only alias such a row ever
 * had; id order breaks a tie the same way {@link targetIndex} does.
 */
export function unaddressableTarget(
  projection: ProjectionDb,
  type: string,
  name: string,
): UnaddressableTarget | null {
  const wanted = name.trim().toLowerCase();
  if (wanted === "") return null;
  for (const row of targetRows(projection, type)) {
    if (invocableName(row.path) !== null) continue;
    if (row.title.toLowerCase() !== wanted) continue;
    return { docId: row.id, path: row.path, title: row.title };
  }
  return null;
}

/**
 * One name, resolved the way a mention of it would resolve (SPEC.md §8) — the
 * lookup a designation makes (§7, SERVER-109).
 *
 * Shares {@link targetIndex} with `parseMentions` rather than querying for the
 * one row, because the answer must be the *same* answer: the aliases a document
 * responds to (its invocable name and its title), the case-insensitivity, and
 * the id-order tie-break are all decisions this index already makes, and a
 * second `WHERE title = ?` would resolve `@researcher` and
 * `POST .../resident {"name":"researcher"}` to different documents the first
 * time a workspace held two.
 *
 * Trimmed before lookup — a mention token cannot carry surrounding whitespace
 * and a typed name can — and the resolved target's **own** name is what a caller
 * stores, never the spelling that found it.
 */
export function resolveMentionTarget(
  projection: ProjectionDb,
  type: string,
  name: string,
): ResolvedTarget | null {
  return targetIndex(projection, type).get(name.trim().toLowerCase()) ?? null;
}

/** Parse a turn body's mentions and invocations, resolved against the projection (§8). */
export function parseMentions(projection: ProjectionDb, body: string): ParsedMentions {
  let generic = false;
  const mentions: ResolvedTarget[] = [];
  const skills: ResolvedTarget[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  // Built at most once per sigil, and only when the body carries one: a plain
  // comment — the common case — queries nothing at all.
  const indexes = new Map<string, Map<string, ResolvedTarget>>();

  for (const token of scanMentionTokens(body)) {
    const literal = `${token.sigil}${token.name}`;
    if (seen.has(literal)) continue;
    seen.add(literal);

    if (token.sigil === "@" && token.name === GENERIC_AGENT_MENTION) {
      generic = true;
      continue;
    }
    const type = token.sigil === "@" ? MENTION_TYPE : INVOCATION_TYPE;
    let index = indexes.get(type);
    if (index === undefined) {
      index = targetIndex(projection, type);
      indexes.set(type, index);
    }
    const target = index.get(token.name.toLowerCase());
    if (target === undefined) {
      unresolved.push(literal);
      continue;
    }
    (type === MENTION_TYPE ? mentions : skills).push(target);
  }

  return { generic, mentions, skills, unresolved };
}
