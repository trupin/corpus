import type { TopicSpec } from "../../registry/types.js";
import { doctorCommand } from "./doctor.js";
import { rebuildCommand } from "./rebuild.js";

/**
 * The projection's maintenance surface (SPEC.md §11). Both verbs go over HTTP
 * for the same reason every other verb does: the server is the sole writer and
 * the process holding the open `cache.db` handle. A CLI that rebuilt the file
 * itself would leave a running server reading a replaced inode.
 */
export const dbTopic: TopicSpec = {
  name: "db",
  summary: "Maintain the SQLite projection.",
  description:
    "`.corpus/cache.db` is a **derived** cache: the whole database is reconstructible from the " +
    "workspace's files at any time (SPEC.md §9.1). `rebuild` re-derives it, `doctor` checks it, " +
    "and “rebuild then a clean doctor” is the standing invariant §11 gates v1 on. Neither verb " +
    "touches a document, so neither produces a commit.",
  commands: [rebuildCommand, doctorCommand],
};
