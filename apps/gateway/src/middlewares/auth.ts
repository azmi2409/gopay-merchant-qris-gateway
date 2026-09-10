import { Request, Response, NextFunction } from 'express';
import { verifyJWT } from '../utils/jwt';

// Extend Express Request to include optional authenticated user/token payload
declare global {
  namespace Express {
    interface Request {
      user?: unknown;
    }
  }
}

/**
 * Middleware to authenticate requests.
 * Supports two selectable modes via AUTH_MODE environment variable:
 * - 'api_key' (default): Static API Key via `x-api-key` header or `?api_key=` query param
 * - 'jwt': JWT Bearer token signed using `JWT_SECRET` (e.g. `Authorization: Bearer <token>`)
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const authMode = (process.env.AUTH_MODE || 'api_key').toLowerCase();

  if (authMode === 'jwt') {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : (req.query.token as string) || (req.query.jwt as string);

    const jwtSecret = process.env.JWT_SECRET || process.env.API_KEY || '';

    if (!jwtSecret) {
      res.status(500).json({
        success: false,
        message: 'Server configuration error: JWT_SECRET is not configured'
      });
      return;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Authentication Failed: Missing Bearer token'
      });
      return;
    }

    const payload = verifyJWT(token, jwtSecret);
    if (!payload) {
      res.status(401).json({
        success: false,
        message: 'Authentication Failed: Invalid or expired JWT token'
      });
      return;
    }

    req.user = payload;
    return next();
  }

  // Fallback: Static API Key mode ('api_key')
  const apiKey =
    req.headers['x-api-key'] ||
    (req.query.api_key as string) ||
    (req.query.apikey as string);

  if (!apiKey || apiKey !== process.env.API_KEY) {
    res.status(401).json({
      success: false,
      message: 'Authentication Failed: Invalid API Key'
    });
    return;
  }

  next();
}
