// Phase 3 — the HTTP surface. Thin handlers over the service layer.
// Endpoints (ERD Section 3):
//   POST /v1/auth/login          — one shared login for all roles
//   POST /v1/vendors/register    — vendor self-registration (consent mandatory)
//   POST /v1/buyer-users/invite  — BUYER_ADMIN-only; creates a COMPLIANCE user
//   GET  /v1/compliance/alerts   — COMPLIANCE-only; a VENDOR token gets 403

import http from 'node:http';
import { login } from '../services/auth.ts';
import { registerVendor } from '../services/vendors.ts';
import { inviteComplianceUser } from '../services/invites.ts';
import { verifyToken } from '../auth/jwt.ts';
import { listPendingAlerts } from '../alerts/dashboard.ts';
import { actOnAlert } from '../alerts/actions.ts';
import { bulkVendors, changedVendors } from '../pull/vendors.ts';
import { shareProfile } from '../sharing/share.ts';
import { getVendorReputation } from '../sharing/reputation.ts';
import { requireRole } from '../auth/guard.ts';
import { AppError, AuthenticationError, AuthorizationError } from '../auth/errors.ts';
import type { GRVL } from '../verification/grvl.ts';

export interface ServerDeps {
  db: any;
  grvl: GRVL;
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new AppError('Malformed JSON body', 400));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, obj: unknown): void {
  const payload = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function bearer(req: http.IncomingMessage): string {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) throw new AuthenticationError('Missing bearer token');
  return h.slice('Bearer '.length);
}

export function createServer(deps: ServerDeps): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url ?? '/', 'http://localhost');
      const url = parsed.pathname;
      const method = req.method ?? 'GET';

      if (method === 'POST' && url === '/v1/auth/login') {
        const { email, password } = await readJson(req);
        const { token, claims } = await login(deps.db, email, password);
        // We tell the user their role; we never asked them to pick it.
        return send(res, 200, { token, role: claims.role });
      }

      if (method === 'POST' && url === '/v1/vendors/register') {
        const result = await registerVendor(deps.db, deps.grvl, await readJson(req));
        return send(res, 201, result);
      }

      if (method === 'POST' && url === '/v1/buyer-users/invite') {
        const claims = verifyToken(bearer(req));
        const result = await inviteComplianceUser(deps.db, claims, await readJson(req));
        return send(res, 201, result);
      }

      if (method === 'GET' && url === '/v1/compliance/alerts') {
        const claims = verifyToken(bearer(req));
        // listPendingAlerts enforces COMPLIANCE-only (403 for VENDOR / BUYER_ADMIN).
        const alerts = await listPendingAlerts(deps.db, claims);
        return send(res, 200, { alerts });
      }

      if (method === 'POST' && url === '/v1/alerts/act') {
        const claims = verifyToken(bearer(req));
        const { alertId, action } = await readJson(req);
        const result = await actOnAlert(deps.db, claims, alertId, action);
        return send(res, 200, result);
      }

      // Profile sharing & reputation (Phase 8).
      if (method === 'POST' && url === '/v1/vendor/share') {
        const claims = verifyToken(bearer(req));
        const { buyerId } = await readJson(req);
        const result = await shareProfile(deps.db, claims, buyerId);
        return send(res, 201, result);
      }

      if (method === 'GET' && url === '/v1/vendor/reputation') {
        const claims = verifyToken(bearer(req));
        requireRole(claims, ['VENDOR']);
        if (!claims.vendorId) throw new AuthorizationError('No vendor bound to this token');
        const result = await getVendorReputation(deps.db, claims.vendorId);
        return send(res, 200, result);
      }

      // Pull API (Phase 7) — path param buyer_id + query string.
      let m: RegExpMatchArray | null;
      if (method === 'GET' && (m = url.match(/^\/v1\/buyers\/([^/]+)\/vendors$/))) {
        const claims = verifyToken(bearer(req));
        const psRaw = parsed.searchParams.get('page_size');
        const pgRaw = parsed.searchParams.get('page');
        const result = await bulkVendors(deps.db, claims, m[1], {
          pageSize: psRaw === null ? undefined : Number(psRaw),
          page: pgRaw === null ? undefined : Number(pgRaw),
        });
        return send(res, 200, result);
      }

      if (method === 'GET' && (m = url.match(/^\/v1\/buyers\/([^/]+)\/vendors\/changes$/))) {
        const claims = verifyToken(bearer(req));
        const since = parsed.searchParams.get('since') ?? new Date(0).toISOString();
        const result = await changedVendors(deps.db, claims, m[1], { since });
        return send(res, 200, result);
      }

      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      const status = err instanceof AppError ? err.httpStatus : 500;
      const message = err instanceof Error ? err.message : 'Internal error';
      return send(res, status, { error: message });
    }
  });
}
