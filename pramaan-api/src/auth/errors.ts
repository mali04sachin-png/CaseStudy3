// Phase 3 — typed errors that carry an HTTP status, so the API layer can map
// each failure to the right response code without guessing.

export class AppError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = new.target.name;
    this.httpStatus = httpStatus;
  }
}

/** Bad input shape/format → 400. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

/** Registration attempted without DPDP consent → 400 (mandatory by law). */
export class ConsentRequiredError extends AppError {
  constructor(message = 'DPDP consent is required before registration') {
    super(message, 400);
  }
}

/** Wrong credentials or an invalid/expired token → 401. */
export class AuthenticationError extends AppError {
  constructor(message = 'Invalid credentials') {
    super(message, 401);
  }
}

/** Authenticated but not allowed (e.g. a VENDOR hitting a COMPLIANCE route) → 403. */
export class AuthorizationError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}
