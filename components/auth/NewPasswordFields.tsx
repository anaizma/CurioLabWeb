"use client";

// A new-password + confirm pair with live policy feedback.
//
// The rules come from @curiolab/core's password-policy, the SAME module the
// service enforces when it writes the argon2id hash, so the hints under the field
// cannot drift from what the server will accept. It is a pure module with no
// database dependency, which is why a client component can import it.
//
// The parent owns the values; this component owns the presentation and reports
// whether the pair is currently submittable.

import { PASSWORD_POLICY_HINTS, passwordPolicyProblems } from "@curiolab/core";

export interface NewPasswordState {
  password: string;
  confirm: string;
}

/** Whether the pair satisfies the policy AND matches. The parent's submit gate. */
export function newPasswordReady(s: NewPasswordState): boolean {
  return s.password.length > 0 && s.password === s.confirm && passwordPolicyProblems(s.password).length === 0;
}

export default function NewPasswordFields({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
}: {
  value: NewPasswordState;
  onChange: (next: NewPasswordState) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  // Only nag once they have started typing: an untouched field showing three red
  // failures reads as an error the person has already made.
  const touched = value.password.length > 0;
  const problems = touched ? passwordPolicyProblems(value.password) : [];
  const mismatch = value.confirm.length > 0 && value.password !== value.confirm;

  return (
    <>
      <div>
        <label className="label block mb-2" htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
          type="password"
          autoComplete="new-password"
          autoFocus={autoFocus}
          required
          disabled={disabled}
          value={value.password}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
        />
        <ul className="mt-2 space-y-1">
          {PASSWORD_POLICY_HINTS.map((hint) => (
            <li key={hint} className="text-xs text-muted">
              {hint}
            </li>
          ))}
        </ul>
        {problems.length > 0 && (
          <ul className="mt-2 space-y-1">
            {problems.map((p) => (
              <li key={p} className="text-xs text-coral font-medium">
                Your password must: {p.charAt(0).toLowerCase()}
                {p.slice(1)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <label className="label block mb-2" htmlFor="confirm-password">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          className="w-full border border-black/20 rounded-md px-4 py-3 bg-white"
          type="password"
          autoComplete="new-password"
          required
          disabled={disabled}
          value={value.confirm}
          onChange={(e) => onChange({ ...value, confirm: e.target.value })}
        />
        {mismatch && <p className="text-xs text-coral font-medium mt-2">The two passwords do not match.</p>}
      </div>
    </>
  );
}
