// -------------------------------------------------------------------------
// The password policy. ONE definition, in the pure core, because it has to be
// stated in three places that must never disagree: the service that writes a new
// argon2id hash (packages/app), the HTTP surface that refuses a weak one, and
// the form that tells a person what is wrong before they submit. A second copy
// in the frontend would drift, and the drift would show up as a form that
// accepts a password the server then rejects with no explanation.
//
// It is pure (no IO, no dependencies), so a client component can import it and
// render the same rules the server enforces.
//
// WHY THESE RULES. Length is the rule that actually resists offline attack, so
// the floor is 12 rather than the customary 8, and there is no upper limit worth
// imposing below the argon2id input bound. The composition rule is deliberately
// weak (two of four character classes) because forcing four classes reliably
// produces "Password1!" and pushes people to reuse; length plus a small block
// list of the passwords that are actually tried first buys far more.
//
// There is no maximum-age or forced-rotation rule, on purpose: NIST withdrew
// that recommendation because scheduled rotation drives predictable increments.
// -------------------------------------------------------------------------

/** The minimum length. Length, not composition, is what resists offline cracking. */
export const PASSWORD_MIN_LENGTH = 12

/**
 * The upper bound. Not a security rule: argon2id happily hashes far more, but an
 * unbounded field is a cheap way to make the server do expensive work, and no
 * real passphrase is this long.
 */
export const PASSWORD_MAX_LENGTH = 200

/** How many of {lowercase, uppercase, digit, symbol} a password must contain. */
export const PASSWORD_MIN_CHARACTER_CLASSES = 2

/**
 * The passwords a credential-stuffing list opens with, normalized to lowercase.
 * Short on purpose: this is not a substitute for a real breached-password check
 * (that needs a corpus and a k-anonymity lookup we do not run today), it just
 * refuses the handful that would otherwise sail through the length rule as a
 * passphrase. Kept as a value so extending it is a config edit.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd123',
  'qwertyuiop',
  'qwerty123456',
  '123456789012',
  '1234567890123',
  'letmein12345',
  'iloveyou1234',
  'administrator',
  'welcome12345',
  'curiolab12345',
])

/** A single unmet rule, phrased as the sentence the form shows the person. */
export type PasswordProblem = string

/**
 * Every rule this password fails, in the order a person would fix them. An empty
 * array means it is acceptable. Returning ALL problems (rather than the first)
 * is deliberate: a form that reveals one rule at a time turns a single decision
 * into four round trips.
 */
export function passwordPolicyProblems(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = []

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Be at least ${PASSWORD_MIN_LENGTH} characters long.`)
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Be at most ${PASSWORD_MAX_LENGTH} characters long.`)
  }

  const classes =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(password) ? 1 : 0)
  if (classes < PASSWORD_MIN_CHARACTER_CLASSES) {
    problems.push(
      'Mix at least two of: lowercase letters, uppercase letters, numbers, symbols.',
    )
  }

  // A single repeated character clears both rules above and is worthless.
  if (password.length > 0 && /^(.)\1*$/.test(password)) {
    problems.push('Use more than one repeated character.')
  }

  if (COMMON_PASSWORDS.has(password.trim().toLowerCase())) {
    problems.push('Not be one of the passwords attackers try first.')
  }

  return problems
}

/** Whether a password satisfies every rule. */
export function passwordMeetsPolicy(password: string): boolean {
  return passwordPolicyProblems(password).length === 0
}

/**
 * The rules as a person reads them BEFORE typing, for the hint list under a new
 * password field. Same source as the enforcement, so the hint cannot drift from
 * what the server will accept.
 */
export const PASSWORD_POLICY_HINTS: readonly string[] = [
  `At least ${PASSWORD_MIN_LENGTH} characters.`,
  'A mix of at least two of: lowercase, uppercase, numbers, symbols.',
  'Not a password attackers try first (for example "password123").',
]
