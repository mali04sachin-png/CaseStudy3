// "Sign in with Google" — added alongside the email/password login.
//
// The browser gets a Google ID token (a signed JWT) from Google Identity Services
// and sends it here. We verify it with Google, confirm it was minted for OUR app,
// then look the email up in our own users table and issue OUR token — so the role
// still comes from the account we control, never from Google. A Google login can
// never grant a role; it only proves the email, exactly like a password would.

import { signToken } from '../auth/jwt.ts';
import type { AuthClaims } from '../auth/jwt.ts';
import { AuthenticationError } from '../auth/errors.ts';

interface GoogleClaims {
  email: string;
  email_verified: string | boolean;
  aud: string;
  iss: string;
  exp: string | number;
  sub: string;
  name?: string;
}

/** Ask Google to validate the ID token and return its claims. Using Google's
 *  tokeninfo endpoint keeps this dependency-free; it can be swapped for local
 *  JWKS verification later if call volume grows. */
async function verifyGoogleIdToken(idToken: string): Promise<GoogleClaims> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new AuthenticationError('Google sign-in is not configured');

  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
  if (!res.ok) throw new AuthenticationError('Google sign-in failed — please try again');
  const c = (await res.json()) as GoogleClaims;

  // The token must have been issued FOR this app, by Google, still valid, verified.
  if (c.aud !== clientId) throw new AuthenticationError('Google sign-in failed (wrong app)');
  if (!/accounts\.google\.com$/.test(String(c.iss).replace(/^https?:\/\//, ''))) {
    throw new AuthenticationError('Google sign-in failed (bad issuer)');
  }
  if (Number(c.exp) * 1000 < Date.now()) throw new AuthenticationError('Google sign-in expired — try again');
  if (c.email_verified !== true && c.email_verified !== 'true') {
    throw new AuthenticationError('Your Google email is not verified');
  }
  if (!c.email) throw new AuthenticationError('Google did not return an email');
  return c;
}

export async function loginWithGoogle(db: any, idToken: string) {
  const g = await verifyGoogleIdToken(idToken);
  const email = g.email.toLowerCase();

  const { rows } = await db.query(
    `select id, email, role, buyer_id, vendor_id, status from users where lower(email) = $1`,
    [email],
  );
  const user = rows[0];
  if (!user) {
    // The Google login is genuine, but this person has no Pramaan account.
    throw new AuthenticationError('No Pramaan account for ' + g.email + ' — ask an admin to invite you');
  }

  // Remember the Google identity on first use (nice-to-have audit link).
  await db.query(`update users set sso_subject = $1 where id = $2 and sso_subject is null`, [g.sub, user.id]);

  const claims: AuthClaims = {
    sub: user.id,
    email: user.email,
    role: user.role, // ← from our account, never from Google
    buyerId: user.buyer_id,
    vendorId: user.vendor_id,
  };
  return { token: signToken(claims), claims };
}
