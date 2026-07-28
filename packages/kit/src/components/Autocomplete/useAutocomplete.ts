import type { DocRow } from "@corpus/contract";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useDocs } from "../../query/useDocs.js";
import {
  applyCompletion,
  detectTrigger,
  type CompletionResult,
  type TriggerKind,
  type TriggerMatch,
} from "./triggers.js";

/**
 * The data half of SPEC.md §11's smart input: `@` routes, `/` skills and `[[`
 * links, **all three answered by `GET /api/docs` with a type filter**. There is
 * no registry — §11 says so in as many words — so a document created a second
 * ago with `corpus doc create --type agent-def` is completable on the next
 * keystroke, because the only thing standing between it and this menu is a
 * cache the SSE stream already invalidates.
 */

/** Document types the two sigils resolve against (`mentions.ts`, SPEC.md §8). */
export const MENTION_DOC_TYPE = "agent-def";
export const SKILL_DOC_TYPE = "skill";

/** The generic mention, which is not a document and therefore not a row. */
export const GENERIC_AGENT_TOKEN = "agent";
const GENERIC_AGENT_DESCRIPTION = "the agent — routing is its own triage";

export interface AutocompleteItem {
  /** Stable React key. */
  readonly key: string;
  /** What the completion inserts after the sigil (or between the brackets). */
  readonly token: string;
  /** The mono `.k` label. */
  readonly label: string;
  /** The dim `.d` description. */
  readonly description: string;
}

/**
 * The name a `type: skill` / `type: agent-def` document is **invocable** by,
 * derived from its path exactly as the server derives it (`mentions.ts`):
 *
 *   - `.claude/skills/<name>/SKILL.md`          → `<name>`
 *   - `.claude/skills-archived/<name>/SKILL.md` → `<name>`
 *   - `.claude/agents/<name>.md`                → `<name>`
 *
 * `null` for a document outside those roots, which the server also treats as not
 * invocable — a `type: skill` note filed under `data/docs/` is a document *about*
 * a skill. Such a row still appears in the menu under its title, because the
 * server's index answers to the title too.
 */
export function invocableName(path: string): string | null {
  const skill = /^\.claude\/skills(?:-archived)?\/([^/]+)\//.exec(path);
  if (skill?.[1] !== undefined) return skill[1];
  const agent = /^\.claude\/agents\/([^/]+)\.md$/.exec(path);
  return agent?.[1] ?? null;
}

/** The token a mention/invocation row is completed to. */
export function rowToken(row: DocRow): string {
  return invocableName(row.path) ?? row.title;
}

/**
 * The charset the server's token scanner accepts after a sigil
 * (`mentions.ts`'s `TOKEN`). A row whose only name is a multi-word title is
 * **not offered**: the server indexes it under that title, but nobody can type
 * it as one token, and a menu entry that inserts text the server will not parse
 * teaches a grammar that does not exist.
 */
const TYPEABLE_TOKEN = /^[A-Za-z0-9_-]+$/;

/** One line, and short: the `.d` column is a hint, not the document. */
const MAX_DESCRIPTION = 90;

function describe(row: DocRow): string {
  const source = row.excerpt !== "" ? row.excerpt : row.title;
  const line = source.replace(/\s+/g, " ").trim();
  return line.length <= MAX_DESCRIPTION ? line : `${line.slice(0, MAX_DESCRIPTION - 1)}…`;
}

function toItem(row: DocRow, kind: TriggerKind): AutocompleteItem {
  const token = kind === "ref" ? row.id : rowToken(row);
  return {
    key: row.id,
    token,
    label: kind === "ref" ? row.title : token,
    description: kind === "ref" ? row.id : describe(row),
  };
}

/** How many rows the menu ever offers; it scrolls at `max-height: 200px` anyway. */
export const AUTOCOMPLETE_LIMIT = 12;

/** How many `agent-def` / `skill` documents a workspace's menus draw from. */
const DIRECTORY_LIMIT = 50;

export interface UseAutocompleteOptions {
  /** The whole input value. */
  readonly value: string;
  /** Caret offset into `value`. */
  readonly caret: number;
  /** False suspends detection entirely (a locked surface, a closed composer). */
  readonly enabled?: boolean;
  /** Applies a chosen completion; the caller owns the input's state. */
  readonly onComplete: (result: CompletionResult) => void;
}

export interface AutocompleteState {
  readonly isOpen: boolean;
  readonly trigger: TriggerMatch | null;
  readonly items: readonly AutocompleteItem[];
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  /** Closes the menu, leaving the literal trigger characters in the input. */
  readonly dismiss: () => void;
  readonly choose: (index: number) => void;
  /**
   * ↑ ↓ ↵ esc while the menu is open. Returns true when it consumed the key, so
   * a host can fall through to its own handling when it did not — the composer's
   * ↵ must still send when no menu is open, and esc must still reach the
   * reader's escape layer.
   */
  readonly handleKeyDown: (event: KeyboardEvent) => boolean;
}

export function useAutocomplete({
  value,
  caret,
  enabled = true,
  onComplete,
}: UseAutocompleteOptions): AutocompleteState {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const detected = enabled ? detectTrigger(value, caret) : null;
  // A dismissal survives until the trigger run itself changes: esc must close
  // the menu for good, not for one keystroke.
  const trigger = detected !== null && detected.start === dismissedAt ? null : detected;

  const kind = trigger?.kind;
  const query = trigger?.query ?? "";

  const directory = useDocs(
    kind === "mention" || kind === "skill"
      ? { type: kind === "mention" ? MENTION_DOC_TYPE : SKILL_DOC_TYPE, limit: DIRECTORY_LIMIT }
      : {},
  );
  const links = useDocs(
    kind === "ref"
      ? { ...(query.trim() === "" ? {} : { q: query.trim() }), limit: AUTOCOMPLETE_LIMIT }
      : {},
  );

  const items = useMemo<readonly AutocompleteItem[]>(() => {
    if (kind === undefined) return [];
    if (kind === "ref") {
      return (links.data?.items ?? []).slice(0, AUTOCOMPLETE_LIMIT).map((row) => toItem(row, kind));
    }
    const rows = (directory.data?.items ?? [])
      .map((row) => toItem(row, kind))
      .filter((item) => TYPEABLE_TOKEN.test(item.token));
    // `@agent` is the generic request (SPEC.md §8) and no document backs it, so
    // it is offered explicitly rather than hoped for in the corpus.
    const all =
      kind === "mention"
        ? [
            {
              key: "@agent",
              token: GENERIC_AGENT_TOKEN,
              label: GENERIC_AGENT_TOKEN,
              description: GENERIC_AGENT_DESCRIPTION,
            },
            ...rows,
          ]
        : rows;
    const needle = query.toLowerCase();
    const filtered =
      needle === ""
        ? all
        : all.filter(
            (item) =>
              item.token.toLowerCase().startsWith(needle) ||
              item.label.toLowerCase().includes(needle),
          );
    return filtered.slice(0, AUTOCOMPLETE_LIMIT);
  }, [directory.data, kind, links.data, query]);

  const isOpen = trigger !== null && items.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [trigger?.kind, trigger?.query]);

  const dismiss = useCallback(() => {
    setDismissedAt(trigger?.start ?? null);
  }, [trigger?.start]);

  const choose = useCallback(
    (index: number) => {
      const item = items[index];
      if (trigger === null || item === undefined) return;
      onComplete(applyCompletion(value, trigger, item.token));
      setDismissedAt(null);
    },
    [items, onComplete, trigger, value],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!isOpen) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        choose(activeIndex);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Stopped here so the reader's escape layer does not also close the
        // document behind the menu (`useEscapeStack` listens on capture).
        event.stopPropagation();
        dismiss();
        return true;
      }
      return false;
    },
    [activeIndex, choose, dismiss, isOpen, items.length],
  );

  return {
    isOpen,
    trigger,
    items,
    activeIndex,
    setActiveIndex,
    dismiss,
    choose,
    handleKeyDown,
  };
}
