'use strict';
/* middleware/security.js — headerë sigurie + CORS multi-origin, PA varësi shtesë.
 *
 * package.json i biobes-api nuk ka `helmet`; ky modul jep të njëjtat mbrojtje me
 * Express të pastër (nëse shtohet helmet, mund të zëvendësohet 1:1 — shih APPLY.md).
 * CORS: jo `*`, por lista e saktë nga CORS_ORIGINS (frontend-i Render + preview).
 */

function originList() {
  const raw = process.env.CORS_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  // HSTS vetëm mbi HTTPS (Render e terminon TLS; 1 vit, pa preload)
  if (req.secure || String(req.get('x-forwarded-proto') || '').toLowerCase() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP për API JSON: asnjë burim i jashtëm, vetëm vetja (parandalon XSS nëse dikush
  // hap përgjigjen JSON si HTML). Skedaret e eksportit shkarkohen si attachment.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  next();
}

function corsMultiOrigin(req, res, next) {
  const allow = originList();
  const origin = req.get('origin') || '';
  if (origin && allow.length) {
    if (allow.includes(origin) || allow.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
      res.setHeader('Vary', 'Origin');
    }
  }
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Company-Id,X-Requested-With,If-Match');
  res.setHeader('Access-Control-Expose-Headers', 'X-Company-Id,X-State-Version,Content-Disposition');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

/* Kufizim i madhësisë së trupit JSON: gjendja e plotë është ~2.7 MB; patch-et janë të vogla. */
function jsonLimit() {
  const express = require('express');
  return express.json({ limit: process.env.JSON_LIMIT || '12mb' });
}

/* Rate limit i thjeshtë në memorie (për 20 përdorues; në multi-instance përdor Redis/PG). */
function rateLimit(options) {
  const opt = options || {};
  const windowMs = opt.windowMs || 15 * 60 * 1000;
  const max = opt.max || 500;
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return function rateLimitMw(req, res, next) {
    const key = (opt.keyBy ? opt.keyBy(req) : (req.ip || '')) + '|' + (req.path || '');
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) { rec = { start: now, n: 0 }; hits.set(key, rec); }
    rec.n++;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - rec.n)));
    if (rec.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((rec.start + windowMs - now) / 1000)));
      return res.status(429).json({ ok: false, error: opt.message || 'Shumë kërkesa — prit pak dhe provo përsëri' });
    }
    next();
  };
}

module.exports = { securityHeaders, corsMultiOrigin, jsonLimit, rateLimit, originList };
