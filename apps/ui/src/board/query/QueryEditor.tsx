import { AutocompleteMenu } from "@corpus/kit";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { parseQueryString } from "../viewDoc";
import { unknownQueryFields } from "./grammar";
import { QueryHelp } from "./QueryHelp";
import { useQueryAutocomplete } from "./useQueryAutocomplete";
import "./queryEditor.css";

/**
 * The column's query field (SPEC.md §10 — reconfiguring a column edits its view
 * document), with the two things a bare text input never had: completions and a
 * way to learn the language without leaving it (UI-039).
 *
 * The field itself is unchanged in every way that matters — same class, same
 * label, same `↵` commits / `esc` abandons, same "a no-op edit writes nothing"
 * rule in the host. Nothing here validates, rewrites or blocks a query: what is
 * typed is what is stored and what the server is asked, so an invalid query
 * still fails exactly where it failed before, on the column's own request.
 *
 * **Escape is layered, deliberately**: the menu takes the first press, the help
 * panel the first press when it is open, and only an otherwise-idle field lets
 * it through to abandon the edit. Each layer stops propagation, which is what
 * keeps a single press from doing two things.
 *
 * **Blur commits, but only when focus leaves the editor.** The help button and
 * the panel are inside the same container precisely so `relatedTarget` can tell
 * "the user is done" from "the user reached for the help" — a `?` that saved
 * your half-typed query and closed the field would be a trap.
 */

export interface QueryEditorProps {
  /** Names the field and its help, so two open columns are distinguishable. */
  readonly columnTitle: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** `↵`, or focus leaving the editor entirely. */
  readonly onCommit: () => void;
  /** `esc` with nothing else open. */
  readonly onCancel: () => void;
}

export function QueryEditor({
  columnTitle,
  value,
  onChange,
  onCommit,
  onCancel,
}: QueryEditorProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const [helpStyle, setHelpStyle] = useState<CSSProperties | undefined>(undefined);
  // The menu stays shut until the field is actually used. Opening the editor
  // selects the whole stored query, and a menu that sprang open over a query the
  // person came to read would be noise before it was ever help.
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  // `onChange` is the host's and may be a fresh closure each render; the
  // completion callback must not be rebuilt on every keystroke because of it.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const applyCompletion = useCallback((result: { text: string; caret: number }) => {
    onChangeRef.current(result.text);
    setCaret(result.caret);
    const element = input.current;
    if (element === null) return;
    element.value = result.text;
    element.setSelectionRange(result.caret, result.caret);
    element.focus();
  }, []);

  const autocomplete = useQueryAutocomplete({
    value,
    caret,
    enabled: engaged && !helpOpen,
    onComplete: applyCompletion,
  });

  useLayoutEffect(() => {
    if (input.current === null) return;
    const rect = input.current.getBoundingClientRect();
    if (autocomplete.isOpen) setMenuStyle({ top: rect.bottom + 4, left: rect.left });
    if (helpOpen) setHelpStyle({ top: rect.bottom + 4, left: rect.left });
  }, [autocomplete.isOpen, autocomplete.items.length, helpOpen]);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    helpButton.current?.focus();
  }, []);

  const unknown = unknownQueryFields(parseQueryString(value));

  return (
    <div
      className="col-query-editor"
      ref={container}
      onBlur={(event) => {
        // Focus moving to the help button or into the panel is not "done".
        if (container.current?.contains(event.relatedTarget) === true) return;
        onCommit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (helpOpen) {
          closeHelp();
          return;
        }
        onCancel();
      }}
    >
      <div className="col-query-row">
        <input
          ref={input}
          className="col-query-input"
          aria-label={`Edit query for ${columnTitle}`}
          placeholder="type=thread&status=open"
          spellCheck={false}
          autoComplete="off"
          // A completing text field is a combobox; `aria-expanded` without the
          // role would be an attribute no assistive technology is obliged to
          // read. The menu itself is the kit's `role="listbox"`.
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={autocomplete.isOpen}
          value={value}
          onChange={(event) => {
            setEngaged(true);
            onChange(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0);
          }}
          onKeyDown={(event) => {
            // ↓ on an untouched field is the standard "show me the options".
            if (event.key === "ArrowDown" && !engaged) setEngaged(true);
            if (autocomplete.handleKeyDown(event)) return;
            // `↵` commits the query. This is **not** a composer, so SPEC.md
            // §10's composer key contract (`↵` newline, `⌘↵` submit) does not
            // reach it: a query is one line of filter syntax, never prose, and
            // there is no newline for the key to insert.
            if (event.key === "Enter") {
              event.preventDefault();
              onCommit();
            }
          }}
        />
        <button
          ref={helpButton}
          type="button"
          className="col-query-help-toggle"
          aria-label={`Query syntax for ${columnTitle}`}
          title="Query syntax"
          aria-haspopup="dialog"
          aria-expanded={helpOpen}
          onClick={() => {
            setHelpOpen((open) => !open);
          }}
        >
          ?
        </button>
      </div>

      {unknown.length === 0 ? null : (
        <p className="col-query-notice" role="status">
          {unknown.length === 1 ? "Unknown field" : "Unknown fields"}: {unknown.join(", ")} — the
          server ignores what it does not recognise.
        </p>
      )}

      <AutocompleteMenu
        open={autocomplete.isOpen}
        items={autocomplete.items}
        activeIndex={autocomplete.activeIndex}
        onHover={autocomplete.setActiveIndex}
        onChoose={autocomplete.choose}
        style={menuStyle}
        label={`Query completions for ${columnTitle}`}
      />

      {helpOpen ? <QueryHelp onClose={closeHelp} style={helpStyle} /> : null}
    </div>
  );
}
