/**
 * Test fixture (discover.test.ts): a routes module that throws at import time.
 * Discovery must skip it with a logged warning and boot everything else.
 */
throw new Error("broken plugin routes module");
