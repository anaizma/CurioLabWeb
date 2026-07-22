// -------------------------------------------------------------------------
// The one error the client ever sees for an authorization failure.
//
// 03-authorization.md / must-not #21: out_of_scope, role_not_permitted, and
// subject_consent_missing must be indistinguishable from outside, so a denial
// reveals nothing about which children or chapters exist. `Forbidden` therefore
// carries NO reason and NO detail — the structured DenyReason goes only to the
// audit log, never onto this object.
// -------------------------------------------------------------------------

export class Forbidden extends Error {
  constructor() {
    super('Forbidden')
    this.name = 'Forbidden'
  }
}
