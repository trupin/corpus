export { AutocompleteMenu, type AutocompleteMenuProps } from "./AutocompleteMenu.js";
export {
  handleAutocompleteKeyDown,
  type AutocompleteKeyEvent,
  type AutocompleteKeyOptions,
} from "./autocompleteKeys.js";
export {
  applyCompletion,
  completionText,
  detectTrigger,
  TRIGGER_KINDS,
  type CompletionResult,
  type TriggerKind,
  type TriggerMatch,
} from "./triggers.js";
export {
  AUTOCOMPLETE_LIMIT,
  GENERIC_AGENT_TOKEN,
  invocableName,
  MENTION_DOC_TYPE,
  rowToken,
  SKILL_DOC_TYPE,
  useAutocomplete,
  useRefCompletions,
  type AutocompleteItem,
  type AutocompleteState,
  type RefCompletions,
  type UseAutocompleteOptions,
} from "./useAutocomplete.js";
