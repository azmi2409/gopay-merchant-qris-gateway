import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { logger, formatLog } from '../src/utils/logger';

describe('Logger', () => {
  it('formats log lines with timestamp and level', () => {
    const line = formatLog('INFO', 'Test log message', { key: 'val' });
    expect(line).toMatch(/^\[.+\] \[INFO\] Test log message \| \{"key":"val"\}$/);
  });

  it('writes log line to stdout/file', async () => {
    const logFile = process.env.LOG_FILE || path.join(process.cwd(), 'logs', 'app.log');
    logger.info('Logger integration test line');

    // Small delay to allow write stream buffer to flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('Logger integration test line');
  });
});
