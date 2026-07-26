import type { ReactElement } from "react";
import { Board } from "./Board";
import { ConsoleStrip } from "./ConsoleStrip";
import { Topbar } from "./Topbar";
import "./Shell.css";

/** Top bar · board · console, in that document order (SPEC.md §11). No sidebar. */
export function Shell(): ReactElement {
  return (
    <div className="app">
      <Topbar />
      <Board />
      <ConsoleStrip />
    </div>
  );
}
