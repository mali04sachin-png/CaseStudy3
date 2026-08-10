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
import { requireRole } from '../auth/guard.ts';
import { verifyToken } from '../auth/jwt.ts';
import { AppError, AuthenticationError } from '../auth/errors.ts';
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
      const url = (req.url ?? '').split('?')[0];
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
        requireRole(claims, ['COMPLIANCE']); // VENDOR / BUYER_ADMIN → 403
        return send(res, 200, { alerts: [] });
      }

      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      const status = err instanceof AppError ? err.httpStatus : 500;
      const message = err instanceof Error ? err.message : 'Internal error';
      return send(res, status, { error: message });
    }
  });
}
