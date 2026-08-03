import { AUTOCOMPLETE_LIMIT, type AutocompleteItem } from "@corpus/kit";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { QUERY_FIELDS, queryField, type ValueSource } from "./grammar";
import {
  applyQueryCompletion,
  detectQueryTrigger,
  type QueryCompletion,
  type QueryTrigger,
} from "./queryCompletion";
import { useQueryVocabulary, type QueryVocabulary, type ValueOption } from "./queryVocabulary";

/**
 * The column query editor's completions (UI-039).
 *
 * It is deliberately *not* `useAutocomplete`: that hook's trigger grammar is the
 * §11 smart-input one (`@` / `/` / `[[`) and its data source is three hardcoded
 * `useDocs` calls, neither of which describes a query string. What is reused is
 * everything a user can perceive — the item shape, `AUTOCOMPLETE_LIMIT`, the
 * `.ac-menu` the kit renders, and the ↑ ↓ ↵ esc contract including
 * `handleKeyDown`'s "true means I consumed it" — so the query field behaves like
 * every other completing input in the product and differs only in what it lists.
 */

/** Fields whose values need no vocabulary; `q=` is prose, not an enumeration. */
function optionsFor(source: ValueSource, vocabulary: QueryVocabulary): readonly ValueOption[] {
  switch (source.kind) {
    case "fixed":
      return source.values.map((value) => ({ value, detail: "" }));
    case "docType":
      return vocabulary.docType;
    case "tag":
      return vocabulary.tag;
    case "folder":
      return vocabulary.folder;
    case "docId":
      return vocabulary.docId;
    case "free":
      return [];
  }
}

/**
 * Prefix first, then substring — the ordering every completing menu in the
 * product uses. A document id is matched on its *title* as well, because that is
 * what the menu shows and what a person is looking for (§5: nobody types ids).
 */
function matches(option: ValueOption, needle: string): boolean {
  if (needle === "") return true;
  return (
    option.value.toLowerCase().startsWith(needle) ||
    option.value.toLowerCase().includes(needle) ||
    option.detail.toLowerCase().includes(needle)
  );
}

function fieldItems(needle: string): readonly AutocompleteItem[] {
  return QUERY_FIELDS.filter(
    (field) => needle === "" || field.name.toLowerCase().startsWith(needle),
  ).map((field) => ({
    key: `field:${field.name}`,
    token: field.name,
    label: field.name,
    description: field.summary,
  }));
}

function valueItems(
  field: string,
  needle: string,
  vocabulary: QueryVocabulary,
): AutocompleteItem[] {
  const known = queryField(field);
  if (known === undefined) return [];
  return optionsFor(known.values, vocabulary)
    .filter((option) => matches(option, needle))
    .map((option) => ({
      key: `value:${field}:${option.value}`,
      token: option.value,
      label: option.value,
      description: option.detail,
    }));
}

export interface UseQueryAutocompleteOptions {
  readonly value: string;
  readonly caret: number;
  /** False suspends detection entirely — the menu stays shut until asked for. */
  readonly enabled: boolean;
  readonly onComplete: (result: QueryCompletion) => void;
}

export interface QueryAutocompleteState {
  readonly isOpen: boolean;
  readonly trigger: QueryTrigger | null;
  readonly items: readonly AutocompleteItem[];
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  readonly dismiss: () => void;
  readonly choose: (index: number) => void;
  /** True when the key was consumed, so the host can fall through when it was not. */
  readonly handleKeyDown: (event: KeyboardEvent) => boolean;
}

export function useQueryAutocomplete({
  value,
  caret,
  enabled,
  onComplete,
}: UseQueryAutocompleteOptions): QueryAutocompleteState {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const vocabulary = useQueryVocabulary();

  const detected = enabled ? detectQueryTrigger(value, caret) : null;
  // A dismissal survives until the token itself moves: esc closes the menu for
  // good, not for one keystroke (kit's `useAutocomplete` makes the same promise).
  const trigger = detected !== null && detected.start === dismissedAt ? null : detected;

  const kind = trigger?.kind;
  const field = trigger?.field ?? "";
  const query = trigger?.query ?? "";

  const items = useMemo<readonly AutocompleteItem[]>(() => {
    if (kind === undefined) return [];
    const needle = query.toLowerCase();
    const all = kind === "field" ? fieldItems(needle) : valueItems(field, needle, vocabulary);
    return all.slice(0, AUTOCOMPLETE_LIMIT);
  }, [field, kind, query, vocabulary]);

  const isOpen = trigger !== null && items.length > 0;

  useEffect(() => {
    setActiveIndex(0);
    setNavigated(false);
  }, [kind, field, query]);

  /**
   * Whether `↵` belongs to the menu or to the field.
   *
   * Unlike the `@` / `/` / `[[` menus, this one can be open without the user
   * having typed anything at all — every position in a query string is a
   * completable token, so an empty field already lists all nineteen fields.
   * Taking `↵` there would mean an empty query commits `q=` instead of clearing
   * the column, and a fully typed value would refuse to submit. So the menu
   * claims `↵` only when it has something to add: the user has moved the
   * selection, or has typed a prefix the highlighted item extends. `⇥` is the
   * unconditional accept for everything else.
   */
  const active = items[activeIndex];
  const enterCompletes =
    isOpen &&
    (navigated ||
      (query !== "" && active !== undefined && active.token.toLowerCase() !== query.toLowerCase()));

  const dismiss = useCallback(() => {
    setDismissedAt(trigger?.start ?? null);
  }, [trigger?.start]);

  const choose = useCallback(
    (index: number) => {
      const item = items[index];
      if (trigger === null || item === undefined) return;
      onComplete(applyQueryCompletion(value, trigger, item.token));
      setDismissedAt(null);
    },
    [items, onComplete, trigger, value],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!isOpen) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setNavigated(true);
        setActiveIndex((current) => (current + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setNavigated(true);
        setActiveIndex((current) => (current - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Tab" || (event.key === "Enter" && enterCompletes)) {
        event.preventDefault();
        choose(activeIndex);
        return true;
      }
      if (event.key === "Enter") return false;
      if (event.key === "Escape") {
        event.preventDefault();
        // Stopped so the editor's own Escape — which cancels the edit — does not
        // also fire: the first esc closes the menu, the second abandons the edit.
        event.stopPropagation();
        dismiss();
        return true;
      }
      return false;
    },
    [activeIndex, choose, dismiss, enterCompletes, isOpen, items.length],
  );

  return { isOpen, trigger, items, activeIndex, setActiveIndex, dismiss, choose, handleKeyDown };
}
