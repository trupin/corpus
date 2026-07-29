import type { ListItemProps } from "@corpus/kit/plugin";
import { createElement, type ReactElement } from "react";

/**
 * The fixture's `ListItem`: replaces the kit `Row` for `fixture-note` rows in
 * every column list. Keeps the row's open affordance so the reader still
 * works, and marks itself so tests and the E2E drill can prove the default
 * row was replaced.
 */
export function FixtureListItem({ row, onOpen, cursor }: ListItemProps): ReactElement {
  return createElement(
    "div",
    {
      className: cursor === true ? "row kbd fixture-row" : "row fixture-row",
      role: "button",
      tabIndex: 0,
      "data-fixture-row": row.id,
      "data-row-doc": row.id,
      onClick: () => {
        if (onOpen !== undefined) onOpen(row);
      },
      onKeyDown: (event: { key: string }) => {
        if ((event.key === "Enter" || event.key === " ") && onOpen !== undefined) onOpen(row);
      },
    },
    createElement("span", { "aria-hidden": "true" }, "▣ "),
    createElement("span", { className: "fixture-row-title" }, row.title),
  );
}
