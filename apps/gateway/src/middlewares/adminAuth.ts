import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

export function adminApiAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_API_KEY || '';
  const supplied = String(req.headers['x-admin-api-key'] || '');
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  const valid = expectedBuffer.length >= 32 && suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
  if (!valid) {
    res.status(401).json({ success: false, message: 'Invalid admin service credential' });
    return;
  }
  next();
}
