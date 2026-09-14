import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.chdir(mkdtempSync(join(tmpdir(), 'gopay-test-')));
process.env.DATABASE_URL = 'file::memory:';
process.env.GOPAY_MASTER_KEY = 'ab'.repeat(32);
delete process.env.GOPAY_COOKIE;
