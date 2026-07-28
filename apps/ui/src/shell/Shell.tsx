import type { ReactElement } from "react";
import { Board } from "./Board";
import { ConsoleStrip } from "./ConsoleStrip";
import { ToastProvider } from "./Toasts";
import { Topbar } from "./Topbar";
import "./Shell.css";

/**
 * Top bar · board · console, in that document order (SPEC.md §11). No sidebar.
 *
 * The toast surface wraps rather than joins them: it is `position: fixed`
 * chrome, and putting it inside `.app` would make it a fourth region of a
 * layout the spec says has three.
 */
export function Shell(): ReactElement {
  return (
    <ToastProvider>
      <div className="app">
        <Topbar />
        <Board />
        <ConsoleStrip />
      </div>
    </ToastProvider>
  );
}
