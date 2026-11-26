import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qadam-boot-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
process.env.ORGANIZER_PIN = '908172';
process.env.VERCEL_GIT_COMMIT_SHA = 'deploy-one';
delete process.env.TURSO_DATABASE_URL;
const { get, run } = await import('../server/db.js');

test('a deploy sets the database up once and later cold starts only check the stamp', async () => {
  const first = await import('../server/app.js?first');
  await first.whenReady();
  assert.equal((await get("SELECT value FROM settings WHERE key = 'boot'")).value, 'deploy-one:-');

  // A second cold start of the same deploy skips the set-up: the index it would make stays missing.
  await run('DROP INDEX idx_link_attempts_root');
  const second = await import('../server/app.js?second');
  await second.whenReady();
  assert.equal(await get("SELECT 1 AS ok FROM sqlite_master WHERE name = 'idx_link_attempts_root'"), undefined);

  // A new deploy runs the full set-up again.
  process.env.VERCEL_GIT_COMMIT_SHA = 'deploy-two';
  const third = await import('../server/app.js?third');
  await third.whenReady();
  assert.ok(await get("SELECT 1 AS ok FROM sqlite_master WHERE name = 'idx_link_attempts_root'"));
  assert.equal((await get("SELECT value FROM settings WHERE key = 'boot'")).value, 'deploy-two:-');
});
