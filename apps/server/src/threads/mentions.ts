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
 * `[[ref]]` scanner and the turn-heading scanner use (`core/code.ts`), so a turn
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
 * `data/docs/` is a document about a skill, not an invocable one.
 */
export function invocableName(path: string): string | null {
  const root = classifyPath(path);
  if (root === null) return null;
  const rest = path.slice(root.path.length + 1);
  if (root.shape === "skill-tree") return rest.split("/")[0] ?? null;
  if (root.key !== "agents") return null;
  const filename = rest.split("/").at(-1);
  return filename === undefined ? null : filename.replace(/\.md$/, "");
}

type TargetRow = { id: string; path: string; title: string; status: string };

/**
 * Every document of `type`, indexed by the names it answers to — its invocable
 * name and its title, both lowercased, because nobody types a capital letter
 * after a slash. First row wins a collision, in id order, so the answer is at
 * least deterministic; two skills claiming one name is a `doc check` finding
 * (§14), not something to resolve arbitrarily at post time.
 */
function targetIndex(projection: ProjectionDb, type: string): Map<string, ResolvedTarget> {
  const rows = projection
    .prepare("SELECT id, path, title, status FROM documents WHERE type = ? ORDER BY id")
    .all(type) as TargetRow[];
  const index = new Map<string, ResolvedTarget>();
  for (const row of rows) {
    const invocable = invocableName(row.path);
    const target: ResolvedTarget = {
      name: invocable ?? row.title,
      docId: row.id,
      status: row.status,
    };
    for (const alias of [invocable, row.title]) {
      if (alias === null || alias === "") continue;
      const key = alias.toLowerCase();
      if (!index.has(key)) index.set(key, target);
    }
  }
  return index;
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
