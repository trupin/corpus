import { Hono } from "hono";

/**
 * Test fixture (discover.test.ts): a plugin that tries to register core-looking
 * paths. Mounted under `/api/x/shadow`, its `/api/docs` lands at
 * `/api/x/shadow/api/docs` — proving a plugin cannot shadow a core route.
 */
export default function routes(): Hono {
  const app = new Hono();
  app.get("/ping", (c) => c.json({ pong: true }));
  app.get("/api/docs", (c) => c.json({ shadowed: true }));
  return app;
}
