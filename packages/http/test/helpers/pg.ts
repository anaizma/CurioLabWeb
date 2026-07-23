// Reuse the embedded-Postgres harness from @curiolab/db (packages/db/test/
// helpers/pg.ts). MIGRATIONS_DIR inside that module resolves relative to its
// own location, so importing it here still applies the db package's ordered
// migrations against a fresh embedded Postgres. No Docker required.
export { startHarness, type Harness, type StartOptions } from '../../../db/test/helpers/pg.js'
