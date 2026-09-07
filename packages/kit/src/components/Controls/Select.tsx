import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";

/**
 * The one dropdown (UI-191): a chip-shaped pill trigger with a chevron over a
 * **custom** popover menu. A styled native `<select>` was never the target,
 * because the popup is native chrome too — and two shipped workarounds die
 * with the native element:
 *
 * - values are real values, `null` included. A `<select>` value is a string,
 *   which is why `ComposeOverlay` carried a `"@none"` sentinel (UI-173); an
 *   {@link SelectItem} carries whatever the caller's state does, compared by
 *   `Object.is`.
 * - a custom trigger's `mousedown` **can** be cancelled, which is what the
 *   format toolbar needs to keep the editor's selection alive — the comment
 *   at the old `FormatToolbar.tsx:228` records losing that fight against the
 *   native element.
 *
 * **Long labels** (the truncated "its own agen…" defect this primitive was
 * asked to fix): the closed label ellipsises inside the pill's `max-width`
 * and the full value rides the trigger's `title`; the menu is free to be
 * wider than its trigger (`width: max-content`) and always shows the whole
 * option text, with each option's own `title` as a second reveal.
 *
 * **Keyboard**, in full: Enter/Space/ArrowDown/ArrowUp on the trigger opens
 * with the chosen option focused; arrows and Home/End move; typing runs a
 * type-ahead over the labels; Enter/Space chooses; Escape closes with the
 * value unchanged and focus returned to the trigger. Tab and an outside
 * click dismiss.
 *
 * **The open menu owns the board's keys.** It renders `role="menu"` (options
 * are `menuitemradio`, checked by selection), which is the selector the
 * app's `overlays.ts` already watches — the same contract every menu surface
 * in the product satisfies, met here by ARIA rather than by an import.
 *
 * **Focus on choose goes trigger-first, change second**: the trigger is
 * focused *before* `onChange` runs, so a caller that moves focus itself (the
 * editor toolbar's commands refocus the document) wins by acting last.
 */
export interface SelectItem<T> {
  readonly value: T;
  readonly label: string;
  /** A longer reveal for the option row; defaults to the label. */
  readonly title?: string;
}

export interface SelectProps<T> {
  readonly items: readonly SelectItem<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** The accessible name. Required — there is no unlabelled dropdown. */
  readonly label: string;
  /**
   * The explanatory hover text for the pill. The selected value's full label
   * still rides the inner `.select-value` span's `title`, so truncation stays
   * honest whether or not the caller explains the control.
   */
  readonly title?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  /** Rendered as `data-select`, the hook tests and e2e reach this control by. */
  readonly name?: string;
}

/** How long a type-ahead buffer survives between keystrokes. */
const TYPE_AHEAD_MS = 1000;

function optionsOf(menu: HTMLElement): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
}

export function Select<T>({
  items,
  value,
  onChange,
  label,
  title,
  disabled,
  className,
  name,
}: SelectProps<T>): ReactElement {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typeAhead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const selectedIndex = items.findIndex((item) => Object.is(item.value, value));
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;

  /**
   * Focus lands on the chosen option the moment the menu exists — on the
   * open *transition* only, so a re-render while it is up never yanks focus
   * back from an arrowed-to option.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opened || menu.current === null) return;
    const options = optionsOf(menu.current);
    (options[Math.max(selectedIndex, 0)] ?? options[0])?.focus();
  }, [open, selectedIndex]);

  /** An outside press dismisses. Capture, like every menu in the product. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (root.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [open]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const choose = (item: SelectItem<T>): void => {
    // Trigger first, change second — see the header note on focus order.
    close(true);
    onChange(item.value);
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(true);
  };

  const moveFocus = (options: readonly HTMLButtonElement[], to: number): void => {
    options[Math.min(Math.max(to, 0), options.length - 1)]?.focus();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const surface = menu.current;
    if (surface === null) return;
    const options = optionsOf(surface);
    const active = options.findIndex((option) => option === document.activeElement);

    if (event.key === "Escape") {
      // Consumed here, invisibly to the app's escape chain: an inner surface
      // that answered the key must not let the board act on it too.
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      // Tab is a dismissal, not a cycle; focus follows the tab order out.
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(options, active + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(options, active - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      moveFocus(options, 0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      moveFocus(options, options.length - 1);
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Type-ahead over the labels. The buffer survives a second between
      // keys, so "he" finds "heavy" while two slow "h"es probe twice.
      event.preventDefault();
      const now = Date.now();
      const held = typeAhead.current;
      const buffer =
        now - held.at > TYPE_AHEAD_MS
          ? event.key.toLowerCase()
          : held.buffer + event.key.toLowerCase();
      typeAhead.current = { buffer, at: now };
      const at = items.findIndex((item) => item.label.toLowerCase().startsWith(buffer));
      if (at >= 0) moveFocus(options, at);
    }
    // Enter and Space activate the focused option through the button's own
    // default action — no handler of ours.
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!open) return;
    const next = event.relatedTarget as Node | null;
    if (next !== null && root.current?.contains(next) === true) return;
    setOpen(false);
  };

  return (
    <div
      className={className === undefined ? "select" : `select ${className}`}
      ref={root}
      onBlur={onBlur}
    >
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-select={name}
        disabled={disabled}
        title={title ?? selected?.label}
        onClick={() => {
          // Guarded in code as well as by the attribute: a synthetic click
          // (tests, automation) reaches a disabled button's listeners.
          if (disabled === true) return;
          setOpen((held) => !held);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        {/* The full value always survives truncation, on the span the pointer
            is actually over when the ellipsis is what it sees. */}
        <span className="select-value" title={selected?.label}>
          {selected?.label ?? ""}
        </span>
        <span className="select-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="select-menu"
          role="menu"
          aria-label={label}
          // The marker the app's escape chain reads (`useEscapeStack`'s
          // capture listener yields close keys aimed inside it), so this
          // menu's own Escape handling wins without kit importing the chain
          // — the DOM is the contract, both ways.
          data-kit-menu=""
          ref={menu}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              // A value can legitimately repeat a label (never a value), and
              // index keeps the row identity stable for the focus effect.
              key={index}
              type="button"
              className="select-option"
              role="menuitemradio"
              aria-checked={index === selectedIndex}
              title={item.title ?? item.label}
              onClick={() => {
                choose(item);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
