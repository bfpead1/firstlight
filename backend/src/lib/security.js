// HTTP hardening shared by every response: security headers and a same-origin check
// on requests that change data.
import { config } from "../config.js";

// Everything the built frontend loads. Update this when adding a new third-party host.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Tailwind is compiled to a file, but React's style={} props need inline styles.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Google profile photos.
  "img-src 'self' data: https://*.googleusercontent.com",
  "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function securityHeaders(_req, res, next) {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), payment=(), geolocation=(self)",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  if (config.isProduction) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const allowedOrigins = new Set([new URL(config.frontendUrl).origin]);

/**
 * Rejects data-changing requests sent from another site. The session cookie is
 * SameSite=Lax, which already blocks most cross-site requests; this also covers
 * older browsers and same-site subdomains.
 */
export function sameOriginWrites(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "cross_origin_request" });
  }
  next();
}
