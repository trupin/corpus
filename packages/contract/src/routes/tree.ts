import { createRoute } from "@hono/zod-openapi";
import { FolderTreeSchema } from "../schemas/tree.js";
import { jsonContent, UNAUTHORIZED_RESPONSE } from "./responses.js";

export const getTree = createRoute({
  method: "get",
  path: "/api/tree",
  tags: ["tree"],
  summary: "The `data/docs/` folder tree with document counts",
  description:
    "Backs folder pickers, folder columns and filter chips (SPEC.md §9.2). `count` is the documents " +
    "filed directly in a folder; `totalCount` includes its descendants. Threads inherit their parent " +
    "document's folder, so both are counted where they are filed.",
  responses: {
    200: jsonContent(FolderTreeSchema, "The folder tree, roots first."),
    401: UNAUTHORIZED_RESPONSE,
  },
});
