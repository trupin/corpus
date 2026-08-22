import { definePlugin } from "@corpus/kit/plugin";
import { FixtureColumn } from "./ui/FixtureColumn.js";
import { FixtureDocPanel } from "./ui/FixtureDocPanel.js";
import { FixtureListItem } from "./ui/FixtureListItem.js";
import { FixtureView } from "./ui/FixtureView.js";
import { FIXTURE_COLUMN_TYPE, FIXTURE_DOC_TYPE } from "./shared.js";

/**
 * The test-only fixture plugin (PLUGINS-001). It exists to exercise every §10
 * extension point — one doc type with all three renderers, one column type,
 * one server route, one CLI verb, one skill — and to be deleted: §12 M6's
 * subtractive check runs against this directory. The leading underscore keeps
 * it out of production bundles, `docs/cli.md` and packaging (sprint-012
 * Adjudication 9). It is not a design study; the real reference plugin is
 * `todos` (PLUGINS-002).
 */
export default definePlugin({
  id: "_fixture",
  name: "Fixture",
  icon: "▣",
  docTypes: [
    {
      type: FIXTURE_DOC_TYPE,
      View: FixtureView,
      ListItem: FixtureListItem,
      DocPanel: FixtureDocPanel,
    },
  ],
  columns: [
    {
      type: FIXTURE_COLUMN_TYPE,
      label: "Fixture notes",
      icon: "▣",
      Component: FixtureColumn,
      defaultQuery: { type: FIXTURE_DOC_TYPE },
    },
  ],
});
