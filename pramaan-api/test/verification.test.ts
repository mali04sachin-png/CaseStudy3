// Phase 2 acceptance + behavior tests for the GRVL.
// Run with:  npm test    (from the pramaan-api folder)
//
// Phase 2 acceptance criteria (Pramaan_Implementation_Plan.md):
//   AC1. verifyGSTIN("27AAAAA1111A1Z1") returns normalized data from the primary.
//   AC2. Forcing the primary to return HTTP 500 routes to the secondary, no crash.

import { test } from 'node:test';
import assert from 'node:assert';

import { GRVL, InvalidFormatError } from '../src/verification/grvl.ts';
import { CircuitBreaker } from '../src/verification/circuit-breaker.ts';
import { MockVerificationProvider } from '../src/verification/providers/mock-provider.ts';
import { isValidGSTIN, isValidPAN, isValidIFSC } from '../src/verification/validation.ts';

const VALID_GSTIN = '27AAAAA1111A1Z1';

function makePair(primaryMode: 'ok' | 'http500' | 'timeout' = 'ok') {
  const primary = new MockVerificationProvider({ name: 'eKYCNow', mode: primaryMode, delayMs: 50 });
  const secondary = new MockVerificationProvider({ name: 'Deepvue' });
  return { primary, secondary };
}

test('AC1: verifyGSTIN returns normalized data from the primary provider', async () => {
  const { primary, secondary } = makePair('ok');
  const grvl = new GRVL(primary, secondary);

  const res = await grvl.verifyGSTIN(VALID_GSTIN);

  assert.equal(res.sourceProvider, 'eKYCNow');
  assert.equal(res.status, 'VALID');
  assert.equal(res.field, 'gst_number');
  assert.equal(res.input, VALID_GSTIN);
  assert.equal(res.sourceRegistry, 'GSTN');
  assert.equal(secondary.calls, 0, 'backup must not be touched when primary is healthy');
});

test('AC2: primary HTTP 500 fails over to the secondary without crashing', async () => {
  const { primary, secondary } = makePair('http500');
  const grvl = new GRVL(primary, secondary);

  const res = await grvl.verifyGSTIN(VALID_GSTIN);

  assert.equal(res.sourceProvider, 'Deepvue', 'result should come from the backup');
  assert.equal(res.status, 'VALID');
  assert.equal(primary.calls, 1, 'primary should have been attempted once');
});

test('circuit opens after 3 consecutive primary failures, then skips the primary', async () => {
  const { primary, secondary } = makePair('http500');
  const breaker = new CircuitBreaker({ failureThreshold: 3 });
  const grvl = new GRVL(primary, secondary, { breaker });

  for (let i = 0; i < 3; i++) await grvl.verifyGSTIN(VALID_GSTIN);
  assert.equal(grvl.circuitState, 'OPEN');

  const callsBefore = primary.calls;
  const res = await grvl.verifyGSTIN(VALID_GSTIN);
  assert.equal(res.sourceProvider, 'Deepvue');
  assert.equal(primary.calls, callsBefore, 'primary must NOT be called while circuit is OPEN');
});

test('a slow primary (timeout) counts as a failure and fails over', async () => {
  const { primary, secondary } = makePair('timeout'); // primary delays 50ms
  const grvl = new GRVL(primary, secondary, { timeoutMs: 10 }); // but we wait only 10ms

  const res = await grvl.verifyGSTIN(VALID_GSTIN);
  assert.equal(res.sourceProvider, 'Deepvue');
});

test('bad GSTIN format is rejected locally — no provider is ever called', async () => {
  const { primary, secondary } = makePair('ok');
  const grvl = new GRVL(primary, secondary);

  await assert.rejects(() => grvl.verifyGSTIN('NOT-A-GSTIN'), InvalidFormatError);
  assert.equal(primary.calls, 0);
  assert.equal(secondary.calls, 0);
});

test('half-open recovery: a healthy canary probe closes the circuit', async () => {
  let clock = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 1000,
    canaryRate: 1, // let the probe through deterministically
    now: () => clock,
  });
  const { primary, secondary } = makePair('http500');
  const grvl = new GRVL(primary, secondary, { breaker });

  for (let i = 0; i < 3; i++) await grvl.verifyGSTIN(VALID_GSTIN); // trip it OPEN
  assert.equal(grvl.circuitState, 'OPEN');

  clock = 2000; // advance past the cooldown
  primary.setMode('ok'); // primary is healthy again
  const res = await grvl.verifyGSTIN(VALID_GSTIN); // canary tries primary, succeeds

  assert.equal(res.sourceProvider, 'eKYCNow');
  assert.equal(grvl.circuitState, 'CLOSED', 'a successful probe should close the circuit');
});

test('local validators accept good inputs and reject malformed ones', () => {
  assert.ok(isValidGSTIN('27AAAAA1111A1Z1'));
  assert.ok(!isValidGSTIN('27AAAAA1111A1Z')); // too short
  assert.ok(isValidPAN('AAAAA1111A'));
  assert.ok(!isValidPAN('AAAAA111A')); // too short
  assert.ok(isValidIFSC('HDFC0001234'));
  assert.ok(!isValidIFSC('HDFC1001234')); // 5th char must be '0'
});
