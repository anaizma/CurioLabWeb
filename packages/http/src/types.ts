// -------------------------------------------------------------------------
// Shared HTTP-layer types. A controller is a framework-agnostic function
// `(input) => Promise<ControllerResult>`: `input` carries the injected `sql`,
// the parsed body/params, and (for authed endpoints) the opaque session token.
// The Next route.ts adapters translate a Web Request into this input and a
// ControllerResult back into a Response.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'

/** A session cookie directive a controller asks the adapter to apply. */
export interface SessionDirective {
  /** The opaque token to set, or `null` to clear the cookie (logout). */
  token: string | null
  /** Absolute expiry for the cookie (set path only). */
  expiresAt?: Date
}

/** The uniform controller return: an HTTP status, a JSON body, and an optional cookie directive. */
export interface ControllerResult<B = unknown> {
  status: number
  body: B
  /** Present on login (set) and logout (clear); the adapter writes the cookie. */
  session?: SessionDirective
}

/** Base input for an authenticated controller (the session token is optional; absent = anonymous). */
export interface AuthedInputBase {
  sql: Sql
  sessionToken?: string | null
  /** Decision-time clock; defaults to `new Date()`. Injected in tests. */
  now?: Date
}

/** Base input for an unauthenticated / token-gated controller. */
export interface PublicInputBase {
  sql: Sql
  now?: Date
}

/** The name of the session cookie the auth controllers set and read. */
export const SESSION_COOKIE = 'cl_session'
