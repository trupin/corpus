import { AUTOCOMPLETE_LIMIT, handleAutocompleteKeyDown, type AutocompleteItem } from "@corpus/kit";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { QUERY_FIELDS, queryField, type QueryField, type ValueSource } from "./grammar";
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
 * §10 smart-input one (`@` / `/` / `[[`) and its data source is three hardcoded
 * `useDocs` calls, neither of which describes a query string. What is reused is
 * everything a user can perceive — the item shape, `AUTOCOMPLETE_LIMIT`, the
 * `.ac-menu` the kit renders, and, since UI-053, the ↑ ↓ ⇥ ↵ esc contract as
 * literally the kit's `handleAutocompleteKeyDown` rather than a second copy of
 * it — so the query field behaves like every other completing input in the
 * product and differs only in what it lists.
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
    /*
     * SPEC.md §5's **Structured fields**. There is nothing to offer *after* the
     * `=`: the vocabulary is the workspace's own values, and a workspace with a
     * `customer` field on four hundred documents would put four hundred strings
     * in one menu. What can be offered is the **key**, before the `=`, and
     * UI-178 is where that arrives from.
     */
    case "extraKey":
      return [];
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

/**
 * What accepting a field puts in the box.
 *
 * An open namespace is offered as `extra.` rather than `extra`, and the trailing
 * dot is what tells {@link applyQueryCompletion} to stop before the `=` — the
 * caret then sits exactly where the workspace's own key goes (SPEC.md §5).
 * Offering the bare name would complete to `extra=`, which is a query the server
 * does not honour.
 */
function fieldToken(field: QueryField): string {
  return field.values.kind === "extraKey" ? `${field.name}.` : field.name;
}

function fieldItems(needle: string, vocabulary: QueryVocabulary): readonly AutocompleteItem[] {
  const namespace = openNamespace(needle);
  if (namespace !== undefined) return extraKeyItems(namespace, vocabulary);
  return QUERY_FIELDS.filter(
    (field) => needle === "" || field.name.toLowerCase().startsWith(needle),
  ).map((field) => ({
    key: `field:${field.name}`,
    token: fieldToken(field),
    label: fieldToken(field),
    description: field.summary,
  }));
}

/**
 * The part of a field token that sits after an open namespace's dot, or
 * `undefined` when the token is an ordinary field name.
 *
 * Matched against the grammar's own namespace fields rather than the literal
 * string `extra.`, so this file keeps naming no field.
 */
function openNamespace(needle: string): string | undefined {
  for (const field of QUERY_FIELDS) {
    if (field.values.kind !== "extraKey") continue;
    const prefix = `${field.name.toLowerCase()}.`;
    if (needle.startsWith(prefix)) return needle.slice(prefix.length);
  }
  return undefined;
}

/**
 * The **field names** a workspace invented, offered after `extra.`
 * (SPEC.md §5's **Structured fields**, CONTRACT-092).
 *
 * This is the only completion in the editor that offers part of a field name,
 * and it has to be: an invented field appears in no list anywhere, so a person
 * who has not memorised their own convention has no way to find it. The token
 * carries the whole dotted name, because that is what the caret is replacing.
 */
function extraKeyItems(needle: string, vocabulary: QueryVocabulary): readonly AutocompleteItem[] {
  const field = QUERY_FIELDS.find((entry) => entry.values.kind === "extraKey");
  if (field === undefined) return [];
  return vocabulary.extraKey
    .filter((option) => matches(option, needle))
    .map((option) => ({
      key: `extra:${option.value}`,
      token: `${field.name}.${option.value}`,
      label: `${field.name}.${option.value}`,
      description: option.detail,
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
    const all =
      kind === "field" ? fieldItems(needle, vocabulary) : valueItems(field, needle, vocabulary);
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
   * completable token, so an empty field already lists every field there is.
   * Taking `↵` there would mean an empty query commits `q=` instead of clearing
   * the column, and a fully typed value would refuse to submit. So the menu
   * claims `↵` only when it has something to add: the user has moved the
   * selection, or has typed a prefix the highlighted item extends. `⇥` is the
   * unconditional accept for everything else.
   *
   * This is the one qualification any host makes to the shared contract
   * (`handleAutocompleteKeyDown`'s `enterAccepts`), and it is a qualification of
   * `↵` only: `⇥`, the arrows and `esc` behave exactly as they do everywhere.
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
    (event: KeyboardEvent): boolean =>
      handleAutocompleteKeyDown(event, {
        isOpen,
        count: items.length,
        activeIndex,
        // Only the arrows set `navigated` — hovering the mouse over a row is not
        // the user telling the field that `↵` now means "take this one".
        setActiveIndex: (index) => {
          setNavigated(true);
          setActiveIndex(index);
        },
        accept: () => {
          choose(activeIndex);
        },
        dismiss,
        enterAccepts: enterCompletes,
      }),
    [activeIndex, choose, dismiss, enterCompletes, isOpen, items.length],
  );

  return { isOpen, trigger, items, activeIndex, setActiveIndex, dismiss, choose, handleKeyDown };
}
