import { Request, Response, NextFunction } from "express";

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

interface CounterState {
  count: number;
  resetAt: number;
}

const counters = new Map<string, CounterState>();

function getClientKey(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${ip}:${req.path}`;
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export function createAuthMiddleware(apiToken?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!apiToken) {
      next();
      return;
    }

    const token = getBearerToken(req);
    if (!token || token !== apiToken) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    next();
  };
}

export function createRateLimiter(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = getClientKey(req);
    const existing = counters.get(key);

    if (!existing || now >= existing.resetAt) {
      counters.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      next();
      return;
    }

    if (existing.count >= options.maxRequests) {
      const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ ok: false, error: "Rate limit exceeded" });
      return;
    }

    existing.count += 1;
    counters.set(key, existing);
    next();
  };
}
