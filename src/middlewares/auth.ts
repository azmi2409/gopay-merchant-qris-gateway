import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to authenticate requests using API key via header or query param
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey =
    req.headers['x-api-key'] ||
    (req.query.api_key as string) ||
    (req.query.apikey as string);

  if (!apiKey || apiKey !== process.env.API_KEY) {
    res.status(401).json({
      success: false,
      message: 'Autentikasi Gagal: API Key tidak valid'
    });
    return;
  }

  next();
}
