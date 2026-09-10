import fs from 'fs';
import path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'WARNING' | 'ERROR' | 'SUCCESS' | 'SYSTEM';

const LOGS_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const LOG_FILE = process.env.LOG_FILE || path.join(LOGS_DIR, 'app.log');

// Ensure log directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ponytail: single append stream without log-rotation library; upgrade to rotating-file-stream if multi-GB logs expected.
const fileStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

export function formatLog(level: LogLevel, message: string, details?: unknown): string {
  const timestamp = new Date().toISOString();
  const detailStr = details !== undefined && details !== null
    ? ` | ${typeof details === 'object' ? JSON.stringify(details) : String(details)}`
    : '';
  return `[${timestamp}] [${level}] ${message}${detailStr}`;
}

export function writeLog(level: LogLevel, message: string, details?: unknown): void {
  const line = formatLog(level, message, details);

  if (level === 'ERROR') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }

  fileStream.write(line + '\n');
}

export const logger = {
  debug: (msg: string, details?: unknown) => writeLog('DEBUG', msg, details),
  info: (msg: string, details?: unknown) => writeLog('INFO', msg, details),
  warn: (msg: string, details?: unknown) => writeLog('WARN', msg, details),
  error: (msg: string, details?: unknown) => writeLog('ERROR', msg, details),
  system: (msg: string, details?: unknown) => writeLog('SYSTEM', msg, details),
  log: writeLog,
  close: () => fileStream.end()
};
