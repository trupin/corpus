import type { DocRow } from "@corpus/contract";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useDocs } from "../../query/useDocs.js";
import { handleAutocompleteKeyDown } from "./autocompleteKeys.js";
import { rowToken } from "./invocable.js";
import {
  applyCompletion,
  detectTrigger,
  type CompletionResult,
  type TriggerKind,
  type TriggerMatch,
} from "./triggers.js";

/**
 * The data half of SPEC.md §10's smart input: `@` routes, `/` skills and `[[`
 * links, **all three answered by `GET /api/docs` with a type filter**. There is
 * no registry — §10 says so in as many words — so a document created a second
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
 * The charset the server's token scanner accepts after a sigil
 * (`mentions.ts`'s `TOKEN`). A row whose name cannot be typed as one token —
 * `.claude/agents/my persona.md`, whose stem carries a space — is **not
 * offered**: the server indexes it under that name, but a menu entry that
 * inserts text the scanner will not read back teaches a grammar that does not
 * exist.
 *
 * The second of two gates and the narrower one. {@link rowToken} decides whether
 * the row can be addressed at all; this decides whether the name it is addressed
 * by can be written after a sigil.
 */
const TYPEABLE_TOKEN = /^[A-Za-z0-9_-]+$/;

/** One line, and short: the `.d` column is a hint, not the document. */
const MAX_DESCRIPTION = 90;

function describe(row: DocRow): string {
  const source = row.excerpt !== "" ? row.excerpt : row.title;
  const line = source.replace(/\s+/g, " ").trim();
  return line.length <= MAX_DESCRIPTION ? line : `${line.slice(0, MAX_DESCRIPTION - 1)}…`;
}

/**
 * A document as a `[[` row: its title, and its type beside it — the shape
 * `design/index.html` draws (`<span class="k">{title}</span><span
 * class="d">{type}</span>`).
 *
 * Exactly one function builds it, for both `[[` menus. Before UI-053 the
 * composers' menu put the document *id* in the `.d` column and the document
 * editor's put the type, which is a difference a user can see and nobody chose.
 */
function refItem(row: DocRow): AutocompleteItem {
  return { key: row.id, token: row.id, label: row.title, description: row.type };
}

/**
 * A row as a menu item, or `null` where it is not one.
 *
 * `null` for a mention/invocation row the server would resolve under no spelling
 * at all ({@link rowToken}, SERVER-125) — a document *about* a persona is a
 * document, and it stays listed, readable and editable; it is only not an offer.
 * The `[[` kind never drops a row: a link addresses a document by id, which
 * every document has.
 */
function toItem(row: DocRow, kind: TriggerKind): AutocompleteItem | null {
  if (kind === "ref") return refItem(row);
  const token = rowToken(row);
  if (token === null) return null;
  return { key: row.id, token, label: token, description: describe(row) };
}

/** How many rows the menu ever offers; it scrolls at `max-height: 200px` anyway. */
export const AUTOCOMPLETE_LIMIT = 12;

export interface RefCompletions {
  readonly items: readonly AutocompleteItem[];
  /** In flight, for a menu that reports the difference from "no matches". */
  readonly isPending: boolean;
}

/**
 * The `[[` list — **the** list, for both menus that offer one (UI-053).
 *
 * The document editor's `[[` cannot share this hook's *trigger* (that is a
 * ProseMirror range, not an offset into a string) or its *insertion* (a ref
 * node, not text), but the thing between them — which documents are offered, in
 * what order, how many, and how each row reads — has no reason to differ, and
 * differed in three ways until this existed.
 *
 * `query === null` means the caller is not asking. The `useDocs` call still
 * happens, because hooks are unconditional; it asks for the unfiltered list,
 * which every board column has already put in the cache.
 */
export function useRefCompletions(query: string | null): RefCompletions {
  const needle = query?.trim() ?? "";
  const docs = useDocs(
    query === null ? {} : { ...(needle === "" ? {} : { q: needle }), limit: AUTOCOMPLETE_LIMIT },
  );
  const rows = docs.data?.items;
  const items = useMemo<readonly AutocompleteItem[]>(
    () => (query === null ? [] : (rows ?? []).slice(0, AUTOCOMPLETE_LIMIT).map(refItem)),
    [query, rows],
  );
  return { items, isPending: docs.isPending };
}

/** How many `agent-def` / `skill` documents a workspace's menus draw from. */
const DIRECTORY_LIMIT = 50;

export interface UseAutocompleteOptions {
  /** The whole input value. */
  readonly value: string;
  /** Caret offset into `value`. */
  readonly caret: number;
  /** False suspends detection entirely (a closed composer, a non-editing surface). */
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
   * SPEC.md §10's one keyboard contract — ↑ ↓ ⇥ ↵ esc — applied while the menu
   * is open, from {@link handleAutocompleteKeyDown}. Returns true when it
   * consumed the key, so a host can fall through to its own handling when it did
   * not: the composer's ↵ must still insert a newline when no menu is open, ⇥
   * must still move focus, and esc must still reach the reader's escape layer.
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
  const links = useRefCompletions(kind === "ref" ? query : null);

  const items = useMemo<readonly AutocompleteItem[]>(() => {
    if (kind === undefined) return [];
    if (kind === "ref") return links.items;
    const rows = (directory.data?.items ?? [])
      .flatMap((row) => toItem(row, kind) ?? [])
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
  }, [directory.data, kind, links.items, query]);

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
    (event: KeyboardEvent): boolean =>
      handleAutocompleteKeyDown(event, {
        isOpen,
        count: items.length,
        activeIndex,
        setActiveIndex,
        accept: () => {
          choose(activeIndex);
        },
        dismiss,
      }),
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
