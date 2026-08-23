/**
 * `folders` — SPEC.md §9.2's acts whose subject is a directory rather than a
 * document (rider 7, signed 2026-08-22): rename, archive, unarchive, delete.
 */

export { deleteFolder, renameFolder, setFolderArchived } from "./acts.js";
export {
  assertFolderExists,
  documentsUnder,
  folderExists,
  folderPath,
  membersUnder,
  threadsUnder,
  type FolderMember,
} from "./members.js";
export { mountFolderRoutes } from "./routes.js";
