import { createServer } from "node:net";
import { UsageError } from "../../errors.js";
import { DEFAULT_HOST, DEFAULT_PORT } from "../../workspace.js";

/**
 * Port selection for a new workspace (SPEC.md §2.1: "each workspace has its own
 * port and token"). Availability is proved by actually binding a throwaway
 * socket — a `lsof`-style guess would hand the operator a config whose server
 * cannot start.
 *
 * This is inherently racy: something may take the port between the probe and the
 * first `corpus server start`. That is fine, because the failure surfaces where
 * it is actionable — `start`'s readiness poll shows `EADDRINUSE` from the log —
 * rather than being hidden by a config that quietly picked a different port than
 * the one the operator was told about.
 */

/** How far above the starting port the automatic probe will walk before giving up. */
export const PORT_PROBE_RANGE = 100;

export interface PortProbeOptions {
  readonly host?: string;
  /** Injectable prober; production binds a real socket. */
  readonly isFree?: (port: number, host: string) => Promise<boolean>;
}

/** True when a TCP listener can be bound on `host:port` right now. */
export async function isPortFree(port: number, host: string = DEFAULT_HOST): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    const probe = createServer();
    probe.once("error", () => {
      resolvePromise(false);
    });
    probe.once("listening", () => {
      probe.close(() => {
        resolvePromise(true);
      });
    });
    probe.listen({ port, host, exclusive: true });
  });
}

export interface FindFreePortOptions extends PortProbeOptions {
  /** First port to try. Defaults to the documented workspace default, 8765. */
  readonly start?: number;
  readonly range?: number;
}

/** The first free port at or above `start`, probing upward. */
export async function findFreePort(options: FindFreePortOptions = {}): Promise<number> {
  const start = options.start ?? DEFAULT_PORT;
  const range = options.range ?? PORT_PROBE_RANGE;
  const host = options.host ?? DEFAULT_HOST;
  const free = options.isFree ?? isPortFree;

  for (let port = start; port < start + range && port <= 65535; port += 1) {
    if (await free(port, host)) return port;
  }
  throw new UsageError(
    `no free port found between ${String(start)} and ${String(Math.min(start + range - 1, 65535))}.`,
    { hint: "Pass --port <n> to choose one explicitly." },
  );
}

/**
 * Honour an explicit `--port`, refusing loudly when it is taken. An operator who
 * named a port gets that port or an error — never a silent substitution.
 */
export async function claimPort(
  requested: number | undefined,
  options: FindFreePortOptions = {},
): Promise<number> {
  if (requested === undefined) return findFreePort(options);

  if (!Number.isInteger(requested) || requested < 1 || requested > 65535) {
    throw new UsageError(
      `--port must be a port number between 1 and 65535, got "${String(requested)}".`,
    );
  }

  const host = options.host ?? DEFAULT_HOST;
  const free = options.isFree ?? isPortFree;
  if (!(await free(requested, host))) {
    throw new UsageError(`port ${String(requested)} is already in use on ${host}.`, {
      hint: "Choose another port, or stop whatever is listening there.",
    });
  }
  return requested;
}
