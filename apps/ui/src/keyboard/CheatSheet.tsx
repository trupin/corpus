import type { ReactElement } from "react";
import { EscapeLayerPriority, useEscapeLayer } from "../reader/useEscapeStack";
import { SHORTCUTS, type Shortcut } from "./shortcuts";
import "./keyboard.css";

/**
 * The `?` overlay (`design/index.html`'s `.kbd-panel`) — **generated** from the
 * registry, never written out.
 *
 * That is the whole point of the file: a legend maintained by hand is a legend
 * that is wrong the first time someone adds a binding in a hurry, and a wrong
 * legend is worse than none because it is the only place a user can look. Adding
 * an entry to `SHORTCUTS` adds a row here and no edit to this component is
 * possible that would prevent it.
 *
 * The panel is flat, not grouped: the prototype's grid is two columns of rows
 * with no headings, and `group` orders them rather than titling them.
 *
 * It carries `.overlay.open` because that class pair is how `isOverlayOpen()`
 * answers — a panel that manages its own visibility and skips them makes the
 * shortcut dispatcher think the board still owns the keyboard.
 */

export interface CheatSheetProps {
  readonly onClose: () => void;
}

/** The registry, in the order the panel lists it: by group band, then declaration. */
export function cheatSheetRows(): readonly Shortcut[] {
  const groups: string[] = [];
  for (const shortcut of SHORTCUTS) {
    if (!groups.includes(shortcut.group)) groups.push(shortcut.group);
  }
  return groups.flatMap((group) => SHORTCUTS.filter((shortcut) => shortcut.group === group));
}

export function CheatSheet({ onClose }: CheatSheetProps): ReactElement {
  useEscapeLayer({ active: true, priority: EscapeLayerPriority.Overlay, onEscape: onClose });

  return (
    <div
      className="overlay open"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="search-panel kbd-panel" role="dialog" aria-modal="true" aria-label="Keyboard">
        <h3>Keyboard</h3>
        <div className="kbd-grid">
          {cheatSheetRows().map((shortcut) => (
            <div className="kbd-row" key={shortcut.id} data-shortcut={shortcut.id}>
              <span className="keys">
                {shortcut.chords
                  .filter((chord) => chord.label !== undefined)
                  .map((chord) => (
                    <kbd key={chord.label}>{chord.label}</kbd>
                  ))}
              </span>
              <span className="d">{shortcut.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
