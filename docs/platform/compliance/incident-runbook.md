# Incident response runbook (DRAFT SKELETON)

> **DRAFT.** The Milestone 1 incident runbook. It needs the real names, numbers, and notification language filled in by the founder and, for the notification wording, counsel. The technical procedures are drawn from the platform's design. The vision document commits to notifying the national organization within 24 hours of a suspected breach and affected families within 72 hours; those windows are encoded below. Cross-reference: [information-security-program.md](information-security-program.md).

## Roles and contacts

- **Incident coordinator:** [PLACEHOLDER: founder name, phone, email]. Owns the response.
- **National organization contact:** [PLACEHOLDER: name, phone] — notified within 24 hours of a suspected breach.
- **Legal counsel:** [PLACEHOLDER] — engaged before any external notification.
- **Hosting and vendor support:** [PLACEHOLDER: Postgres host, R2, Resend support contacts].

## Step 0: Declare

Any suspected exposure of a child's personal information is an incident. When in doubt, declare. Start a timestamped log immediately (the 24-hour clock starts at discovery).

## Step 1: Contain

- **Revoke all sessions at once** if account compromise is suspected: delete all rows in the `session` table (or set `revoked_at = now()`), which takes effect immediately because sessions are validated at decision time. [PLACEHOLDER: the exact command or admin action once the ops tooling exists.]
- **Suspend or close** specific compromised accounts (`account.status = 'suspended'`/`'closed'`), which revokes their sessions.
- **Rotate secrets** if any credential may be exposed: database credentials, the Resend key, R2 keys, the session secret. Rotation is also standard on any contributor offboarding.
- If a subprocessor is the source, engage their support and follow their breach process.

## Step 2: Assess the blast radius using the audit log

The append-only audit log is the instrument for "what could this account see." Query it:

- Reads of a minor's record: `audit_entry` where `action = 'minor_record.read'` and `actor_account_id = <suspect>` (or `real_actor_account_id` for impersonation), by time.
- Everything the actor did: `audit_entry` where `actor_account_id = <suspect>`, ordered by `at`.
- Permission-denied spikes (probing): `audit_entry` where `action = 'permission.denied'`, grouped by actor.
- Impersonation sessions: `session` rows with `impersonated_account_id`/`real_actor_account_id` set.

Determine which children's data was reachable and whether it was actually accessed. Record the affected families.

## Step 3: Notify

- **National organization: within 24 hours** of a suspected breach. [PLACEHOLDER: channel and template.]
- **Affected families: within 72 hours.** [PLACEHOLDER: template, reviewed by counsel — what happened, what data, what you are doing, what they can do.]
- **Regulators:** [PLACEHOLDER: counsel determines whether and when FTC or state notification is required.]

Do not send any external notification before counsel has reviewed the wording.

## Step 4: Remediate and record

- Fix the root cause; add a failing-first test that would have caught it.
- Write the incident up: timeline, blast radius, actions, notifications sent, root cause, and the preventive change.
- Feed the lessons into the next § 312.8(b)(5) evaluation of the information security program.

## Drill

Run a tabletop of this runbook [PLACEHOLDER: cadence, e.g. annually], using the audit-log queries against synthetic data, so the steps are familiar before they are needed.
