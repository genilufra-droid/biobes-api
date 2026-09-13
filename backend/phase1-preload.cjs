'use strict';

// Phase 1 cloud-safety guard.
// This preload patches Express route registration before server.js is loaded.
// It is intentionally small and isolated so the current ERP API can be hardened
// without changing unrelated business logic. Once the state route is refactored
// into record-level APIs, this guard can be folded into that route directly.

const express = require('express');
const originalPut = express.application.put;

express.application.put = function phase1GuardedPut(path, ...handlers) {
  if (path === '/api/state') {
    const requireBaseVersion = (req, res, next) => {
      const body = req.body || {};
      const value = body.baseVersion;

      if (value === undefined || value === null) {
        return res.status(400).json({
          ok: false,
          code: 'BASE_VERSION_REQUIRED',
          error: 'baseVersion është i detyrueshëm — merrni fillimisht /api/state'
        });
      }

      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < 0) {
        return res.status(400).json({
          ok: false,
          code: 'BASE_VERSION_INVALID',
          error: 'baseVersion i pavlefshëm'
        });
      }

      // Normalize once so server.js CAS logic receives an integer.
      req.body.baseVersion = numeric;
      next();
    };

    return originalPut.call(this, path, requireBaseVersion, ...handlers);
  }

  return originalPut.call(this, path, ...handlers);
};
