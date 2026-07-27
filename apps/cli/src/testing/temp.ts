import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Real temporary directories and real ephemeral ports for the tests. Nothing in
 * `corpus init` or the server lifecycle is worth testing against a mocked
 * filesystem: the behaviour under test *is* what lands on disk and which socket
 * answers.
 *
 * The prefix is this issue's own (sprint-003 "Scratch directories"), so parallel
 * agents cannot delete each other's evidence, and only paths created here are
 * ever removed.
 */

export const TEMP_PREFIX = "corpus-cli002-";

const created = new Set<string>();

export function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${TEMP_PREFIX}${label}-`));
  created.add(dir);
  return dir;
}

/** Removes only the directories this helper made. Safe to call from `afterEach`. */
export function removeTempDirs(): void {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
  created.clear();
}

/**
 * A port that was free a moment ago, obtained by binding zero and letting the
 * kernel choose. Tests must never hard-code a port: sprint-003 assigns fixed
 * ports to *humans* running E2E, and the suite runs alongside them.
 */
export async function ephemeralPort(host = "127.0.0.1"): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({ port: 0, host, exclusive: true }, () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** Holds `port` open for the duration of `body`, so "already in use" is real. */
export async function withListener<T>(
  port: number,
  body: () => Promise<T>,
  host = "127.0.0.1",
): Promise<T> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host, exclusive: true }, resolve);
  });
  try {
    return await body();
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}
