# Not losing an application

The question this answers: once a parent submits an application, what guarantees
we still have it later?

A submitted application lives in three places: the `application` row, the
`application_draft` row it was built from, and the email copy sent to the
director at submit. Losing all three at once is the only way to lose a
submission, and they do not fail together.

## What already protects it

**The submit is atomic.** `Stage2Service.submitStage2` writes the `application`,
its opening `application_event`, the lead conversion and the draft's submitted
state in ONE transaction. There is no state where a family has "half submitted".
If the write fails they get an error and their draft is untouched, so they can
retry and lose nothing — 2A and 2B were saved before submit.

**Nothing in the app deletes a submitted application.** The only hard-delete path
over funnel data is `sweepExpiredLeads`, and it deletes only leads where
`converted_at IS NULL`. Submitting sets `converted_at`, so a submitted
application is outside its reach by construction. That sweep is also not
currently scheduled anywhere in the app (see the risk note below).

**Every submission is emailed to the director in full.** `POST
/api/public/stage2/submit` sends the complete set of answers to
`DIRECTOR_NOTIFY_EMAIL` after the transaction commits. This is deliberate
redundancy: the mailbox does not share failure modes with the database, so a
submission could be reconstructed by hand from that email alone. Set
`APPLICATION_EMAIL_INCLUDE_ANSWERS=false` to reduce it to a bare pointer if the
privacy trade-off (child details in a mailbox) is not wanted; the notification
survives, the off-site copy does not.

## What you must do at deploy

These are not optional, and none of them are code.

**1. Turn on Neon point-in-time restore and know its window.**
Neon's history retention is what decides how far back you can rewind after a bad
migration or an accidental `DELETE`. The default on the free tier is short (24h).
Set it to at least 7 days. This is the single highest-value setting.

**2. Take an independent nightly dump.**
PITR protects against mistakes *inside* the database. It does not protect against
losing the Neon project or account. Take a nightly `pg_dump` to storage under a
different vendor (R2 is already in the stack) and keep 30 days:

```
pg_dump "$DATABASE_URL" --format=custom --no-owner --file=curiolab-$(date +%F).dump
# then upload to R2, and set a 30-day lifecycle rule on the bucket
```

**3. Restore-test it once, before launch.**
A backup you have never restored is a hypothesis. Restore last night's dump into
a scratch database and confirm the `application` rows are there:

```
pg_restore --dbname="$SCRATCH_URL" --no-owner curiolab-YYYY-MM-DD.dump
psql "$SCRATCH_URL" -c "select count(*), max(created_at) from application;"
```

**4. Never run ad-hoc SQL against production without a fresh dump.**
Most real data loss at this scale is a person, not a disk. Take the dump first.

## Known risks, stated plainly

**A family mid-application at day 31 loses their work.** `sweepExpiredLeads`
deletes unconverted leads and their drafts once `expires_at` passes, 30 days after
the lead was created. That window is a deliberate COPPA obligation (16 CFR
312.4(c)(1)(vii)): the contact details were collected to seek consent, and if no
application results they must go. But it also deletes a half-finished
application, including anything the child wrote, with no warning and no recovery.

Two things to know:
- The sweep is **not scheduled anywhere in the app today**, so nothing is being
  deleted right now. It runs only when someone wires it to pg-boss.
- Before wiring it, add a warning email a few days before `expires_at`. Deleting
  a family's work with no notice is a bad experience even when the deletion is
  legally correct. Re-applying with the same email already refreshes the window,
  so a warning with a link is a complete fix.

**Answers are only saved when the applicant presses Save.** Both applicant pages
save and resume, but there is no autosave. Someone who fills a long form and
closes the tab without saving loses that sitting's typing. The draft they last
saved is safe. Autosave-on-blur is the obvious next improvement.

**Mail delivery is best-effort by design.** If Resend is down at the moment of
submit, the application is still stored — only the email copy is missed. That
case is logged loudly (`submitted-application email FAILED`), so watch for it
rather than assuming silence means success.
