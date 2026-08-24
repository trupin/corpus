import { useState, type ReactElement } from "react";
import type { MenuAction } from "./menuModel";

/**
 * A declared action list, rendered.
 *
 * Two presentations, one declaration (SPEC.md §10). `popover` is the reader's
 * anchored ⋯ sheet (`design/index.html`'s `.comments-pop`); `context` is the
 * pointer-positioned menu (`.ac-menu`, the same frame every other menu in the
 * app uses). Which one is chosen is the host's business; **what is in it** is
 * never the host's business, which is the whole point.
 */

export interface MenuItemsProps {
  readonly actions: readonly MenuAction[];
  readonly variant?: "popover" | "context";
  /** Dismiss the surface. Called after every action that does not keep it open. */
  readonly onDone: () => void;
}

export function MenuItems({ actions, variant = "context", onDone }: MenuItemsProps): ReactElement {
  /** Which item has been armed by a first activation, if any. */
  const [armed, setArmed] = useState<string | null>(null);
  const popover = variant === "popover";

  return (
    <>
      {actions.map((action) => {
        const isArmed = armed === action.id;
        const confirm = action.confirm;
        const label = isArmed && confirm !== undefined ? confirm.label : action.label;
        const meta = isArmed && confirm !== undefined ? confirm.meta : action.meta;
        return (
          <button
            key={action.id}
            type="button"
            className={[
              popover ? "cp-item" : "ac-item",
              action.danger === true ? (popover ? "cp-danger" : "ac-danger") : "",
            ]
              .filter((part) => part !== "")
              .join(" ")}
            /*
             * An act is a `menuitem`; an item that states a choice is a
             * `menuitemradio` and says which way it stands. Keyed on the field
             * being present rather than on its value, so an act never carries
             * `aria-checked="false"` — which would announce a state it does not
             * have.
             */
            role={action.checked === undefined ? "menuitem" : "menuitemradio"}
            {...(action.checked === undefined ? {} : { "aria-checked": action.checked })}
            data-act={action.id}
            disabled={action.disabled === true}
            onClick={() => {
              if (confirm !== undefined && !isArmed) {
                // Arming issues no request at all — the confirmation *is* the
                // two activations, and only the second reaches the wire.
                setArmed(action.id);
                return;
              }
              action.run(() => {
                setArmed(null);
              });
              if (action.keepOpen !== true) onDone();
            }}
          >
            {popover ? (
              <>
                <div className="cp-quote">{label}</div>
                <div className="cp-meta">{meta}</div>
              </>
            ) : (
              <>
                {label}
                <span className="d">{meta}</span>
              </>
            )}
          </button>
        );
      })}
    </>
  );
}
