import type { WorkspaceCommandSpec } from "../registry/types.js";

/**
 * The one built-in verb CLI-001 ships (sprint-002 adjudication 2). It is the
 * end-to-end proof that registry → dispatch → workspace resolution → typed
 * client → socket works, and it is the probe `corpus server start` waits on.
 *
 * `GET /api/health` is deliberately unauthenticated (SPEC.md §2.1), so this verb
 * cannot demonstrate the 401 mapping — a guarded route does that.
 */
export const healthCommand: WorkspaceCommandSpec = {
  name: "health",
  summary: "Check that this workspace's server is up and answering.",
  description:
    "Calls `GET /api/health` on the server configured in `.corpus/config.json` and reports " +
    "its version, uptime and the workspace it owns. Exits 4 when nothing is listening, so " +
    "scripts can use it as a readiness probe.",
  args: [],
  flags: [],
  examples: [
    { command: "corpus health", description: "Check the server for the current workspace." },
    {
      command: "corpus health --json",
      description: "Machine-readable form: one JSON value on stdout.",
    },
    {
      command: "corpus health --workspace ~/notes --timeout 1000",
      description: "Probe another workspace's server, failing fast.",
    },
  ],
  handler: async (context) => {
    const health = await context.client.request((api) => api.GET("/api/health"));
    context.out.emit(health);
    context.out.line(
      `ok — corpus ${health.version}, up ${String(Math.round(health.uptimeSeconds))}s, workspace ${health.workspace}`,
    );
  },
};
