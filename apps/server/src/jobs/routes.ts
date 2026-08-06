import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { localhostOnly, noBrowserOrigin } from "../middleware/localhost.js";
import { methodOnly, toHonoPath } from "../middleware/route-path.js";
import type { JobService } from "./service.js";
import type { LogSource } from "./store.js";

/**
 * Which path wrote a line. The tokenless caller is a Claude Code hook (it has no
 * token to send); a caller that authenticated is `corpus job log`. One file, one
 * append implementation, two callers — recorded so an operator reading the
 * `.jsonl` can tell them apart. It never reaches the wire.
 */
function sourceOf(authorization: string | undefined): LogSource {
  return authorization === undefined ? "hook" : "cli";
}

export function mountJobRoutes(app: OpenAPIHono, jobs: JobService): void {
  // The hardened ingest (SPEC.md §7). Both guards are scoped to POST on exactly
  // this path: `GET /api/jobs/{id}/log` shares the path and stays authenticated,
  // and widening either guard to the path or the prefix would change which
  // requests the API accepts without a token.
  const ingestPath = toHonoPath(contractRoutes.appendJobLog.path);
  app.use(ingestPath, methodOnly("POST", localhostOnly));
  app.use(ingestPath, methodOnly("POST", noBrowserOrigin));

  app.openapi(contractRoutes.listJobs, (c) => {
    const { recent, originId, status } = c.req.valid("query");
    return c.json({ jobs: jobs.list(recent, { originId, status }) }, 200);
  });

  app.openapi(contractRoutes.getJobLog, async (c) => {
    const { id } = c.req.valid("param");
    const { cursor } = c.req.valid("query");
    return c.json(await jobs.readLog(id, cursor), 200);
  });

  app.openapi(contractRoutes.appendJobLog, async (c) => {
    const { id } = c.req.valid("param");
    const { line } = c.req.valid("json");
    // A line refused by the file-size cap still answers `201`: the request
    // itself was well formed, and the cap is a property of the log rather than
    // of the call. The status code therefore cannot carry the refusal, so
    // `appended` does: it is the outcome's own answer to "did this line reach
    // the file", not a constant. The refusal is also recorded in the server log
    // and as the final line in the file.
    const outcome = await jobs.appendLine(id, line, sourceOf(c.req.header("Authorization")));
    return c.json({ eventId: id, appended: outcome.stored !== undefined }, 201);
  });

  app.openapi(contractRoutes.retryJob, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await jobs.retry(id), 200);
  });

  app.openapi(contractRoutes.abandonJob, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await jobs.abandon(id), 200);
  });
}
