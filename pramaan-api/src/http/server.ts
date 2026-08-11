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
import { bulkVendors, changedVendors, vendorDetail } from '../pull/vendors.ts';
import { shareProfile } from '../sharing/share.ts';
import { getVendorReputation } from '../sharing/reputation.ts';
import { listConnections, setConnection } from '../erp/connections.ts';
import { submitConsent, submitKyc, withdrawConsent, getMyVendor } from '../services/vendor-kyc.ts';
import { setDiscoverable, searchDirectory, onboardVendor } from '../directory/directory.ts';
import { requireRole } from '../auth/guard.ts';
import { AppError, AuthenticationError, AuthorizationError } from '../auth/errors.ts';
import type { GRVL } from '../verification/grvl.ts';

export interface ServerDeps {
  db: any;
  grvl: GRVL;
}

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

/** Allow the browser frontend (a different origin) to call this API. */
export function applyCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (CORS_ORIGIN !== '*') res.setHeader('Vary', 'Origin');
}

/** CORS + preflight, then route. Used by both the local server and the
 *  serverless handler; the caller supplies deps (a per-request db client). */
export async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  applyCors(res);
  if ((req.method ?? 'GET') === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  return routeRequest(req, res, deps);
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
  return http.createServer((req, res) => handle(req, res, deps));
}

/** The route table. Errors are mapped to their HTTP status here. */
export async function routeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  {
    try {
      const parsed = new URL(req.url ?? '/', 'http://localhost');
      const url = parsed.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && (url === '/health' || url === '/')) {
        return send(res, 200, { ok: true, service: 'pramaan-api' });
      }

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

      // Password reset request — always 200 with a generic message (never reveal
      // whether an account exists). INTEGRATION.md: POST /auth/forgot.
      if (method === 'POST' && url === '/v1/auth/forgot') {
        await readJson(req);
        return send(res, 200, {
          ok: true,
          message: 'If that account exists, a reset link has been sent.',
        });
      }

      // ERP integrations (BUYER_ADMIN) — read the tenant's connections.
      if (method === 'GET' && url === '/v1/integrations') {
        const claims = verifyToken(bearer(req));
        return send(res, 200, { integrations: await listConnections(deps.db, claims) });
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

      // Vendor self-service (Ravi): consent → KYC verify → withdraw.
      if (method === 'GET' && url === '/v1/vendor/me') {
        return send(res, 200, await getMyVendor(deps.db, verifyToken(bearer(req))));
      }
      if (method === 'POST' && url === '/v1/vendor/consent') {
        return send(res, 200, await submitConsent(deps.db, verifyToken(bearer(req))));
      }
      if (method === 'POST' && url === '/v1/vendor/kyc') {
        const claims = verifyToken(bearer(req));
        const result = await submitKyc(deps.db, deps.grvl, claims, await readJson(req));
        return send(res, 200, result);
      }
      if (method === 'POST' && url === '/v1/vendor/withdraw') {
        return send(res, 200, await withdrawConsent(deps.db, verifyToken(bearer(req))));
      }
      if (method === 'POST' && url === '/v1/vendor/discoverable') {
        const claims = verifyToken(bearer(req));
        const body = await readJson(req);
        return send(res, 200, await setDiscoverable(deps.db, claims, body.enabled !== false));
      }

      // Verified-vendor directory (cross-buyer discovery + one-click onboard).
      if (method === 'GET' && url === '/v1/directory/vendors') {
        const claims = verifyToken(bearer(req));
        const items = await searchDirectory(deps.db, claims, parsed.searchParams.get('q') ?? undefined);
        return send(res, 200, { vendors: items });
      }

      let m: RegExpMatchArray | null;

      // Connect/disconnect an ERP (BUYER_ADMIN). Body: { connect: true|false }.
      if (method === 'POST' && (m = url.match(/^\/v1\/integrations\/([^/]+)\/connect$/))) {
        const claims = verifyToken(bearer(req));
        const body = await readJson(req);
        const result = await setConnection(deps.db, claims, m[1], body.connect !== false);
        return send(res, 200, result);
      }

      // Onboard a discoverable vendor into the caller's tenant.
      if (method === 'POST' && (m = url.match(/^\/v1\/directory\/vendors\/([^/]+)\/onboard$/))) {
        const claims = verifyToken(bearer(req));
        return send(res, 201, await onboardVendor(deps.db, claims, m[1]));
      }

      // Pull API (Phase 7) — path param buyer_id + query string.
      if (method === 'GET' && (m = url.match(/^\/v1\/buyers\/([^/]+)\/vendors$/))) {
        const claims = verifyToken(bearer(req));
        const psRaw = parsed.searchParams.get('page_size');
        const pgRaw = parsed.searchParams.get('page');
        const result = await bulkVendors(deps.db, claims, m[1], {
          pageSize: psRaw === null ? undefined : Number(psRaw),
          page: pgRaw === null ? undefined : Number(pgRaw),
          q: parsed.searchParams.get('q') ?? undefined,
        });
        return send(res, 200, result);
      }

      // Single vendor detail + history (Phase-7-adjacent; INTEGRATION.md GET /vendors/:id).
      if (method === 'GET' && (m = url.match(/^\/v1\/vendors\/([^/]+)$/))) {
        const claims = verifyToken(bearer(req));
        return send(res, 200, await vendorDetail(deps.db, claims, m[1]));
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
  }
}
