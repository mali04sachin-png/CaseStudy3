// Phase 5 — acting on an alert, with unified transactional auditing.
// Assigning / resolving / muting an alert updates its status AND appends a
// non-deletable entry to audit_log_entries, both in ONE transaction. If either
// fails, neither happens. The audit log is append-only (Phase 1 trigger), so the
// record can never be altered or deleted afterwards — regulatory defensibility.

import type { AuthClaims } from '../auth/jwt.ts';
import { requireRole } from '../auth/guard.ts';
import { AppError, AuthorizationError, ValidationError } from '../auth/errors.ts';

export type AlertAction = 'ASSIGN' | 'RESOLVE' | 'MUTE' | 'REASSESS';

const ACTION_TO_STATUS: Record<AlertAction, string> = {
  ASSIGN: 'ASSIGNED',
  RESOLVE: 'RESOLVED',
  MUTE: 'MUTED',
  REASSESS: 'REASSESSED',
};

export async function actOnAlert(
  db: any,
  actor: AuthClaims,
  alertId: string,
  action: AlertAction,
): Promise<{ alertId: string; status: string }> {
  requireRole(actor, ['COMPLIANCE']);

  const newStatus = ACTION_TO_STATUS[action];
  if (!newStatus) {
    throw new ValidationError(`Unknown alert action: ${action}`);
  }

  try {
    await db.query('begin');

    // Lock the alert and confirm it belongs to the actor's tenant.
    const { rows } = await db.query(
      'select buyer_id, status from alerts where id = $1 for update',
      [alertId],
    );
    const alert = rows[0];
    if (!alert) {
      throw new AppError('Alert not found', 404);
    }
    if (alert.buyer_id !== actor.buyerId) {
      throw new AuthorizationError('Alert belongs to another tenant');
    }

    // Update status.
    await db.query('update alerts set status = $1, updated_at = now() where id = $2', [
      newStatus,
      alertId,
    ]);

    // Append the immutable audit entry (same transaction).
    await db.query(
      `insert into audit_log_entries
         (entity_type, entity_id, action, actor, old_state, new_state)
       values ('alerts', $1, $2, $3, $4, $5)`,
      [
        alertId,
        `ALERT_${action}`,
        actor.email,
        JSON.stringify({ status: alert.status }),
        JSON.stringify({ status: newStatus }),
      ],
    );

    await db.query('commit');
    return { alertId, status: newStatus };
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}
