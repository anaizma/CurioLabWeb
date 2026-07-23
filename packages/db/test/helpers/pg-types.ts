// -------------------------------------------------------------------------
// Shared harness types/constants with NO runtime `vitest` import, so this module
// is safe to pull into BOTH the worker-side harness (helpers/pg.ts, which uses
// `inject`) AND the globalSetup (helpers/global-pg.ts). Importing the `vitest`
// runtime inside a globalSetup module is forbidden ("Vitest failed to access its
// internal state"), so the value `inject` must never reach that module graph.
// The `declare module` below is a type-only augmentation and needs no runtime
// import.
// -------------------------------------------------------------------------

/** The migrated template database every per-file test database is cloned from. */
export const TEMPLATE_DB = 'curiolab_tmpl'

/** Connection info globalSetup hands the test workers via provide/inject. */
export interface PgHandle {
  port: number
  /** The migrated template database name to clone per test file. */
  template: string
  /**
   * The migration level baked into the template (the `uptoInclusive` prefix, or
   * null for "every migration"). A test asking for a different level is a
   * mismatch the per-file harness rejects rather than silently cloning wrong.
   */
  upto: string | null
}

// Augment vitest's typed provide/inject channel with our handle. A type-only
// `declare module` — no runtime `import ... from 'vitest'` — so this stays safe
// to import from the globalSetup context.
declare module 'vitest' {
  interface ProvidedContext {
    curiolabPg: PgHandle
  }
}
