// Local dev Postgres for the CurioLab app, using the same embedded-postgres
// the test suite uses (no Docker needed). Boots a PERSISTENT cluster under
// .dev-postgres/, applies every migration once into a `curiolab` database,
// seeds a `cwru` chapter so Stage-2 submit works, then stays alive so the
// Next dev server can connect via DATABASE_URL. Ctrl-C stops it cleanly.
//
//   node scripts/dev-db.mjs
//   DATABASE_URL=postgres://postgres:postgres@localhost:5433/curiolab
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, ".dev-postgres");
const MIG_DIR = join(ROOT, "packages", "db", "migrations");
const MARKER = join(DATA_DIR, ".migrated");
const PORT = 5433;
const DB = "curiolab";
const URL = `postgres://postgres:postgres@localhost:${PORT}/${DB}`;

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

const freshCluster = !existsSync(join(DATA_DIR, "PG_VERSION"));
if (freshCluster) {
  console.log("[dev-db] initialising a new cluster in .dev-postgres/ ...");
  await pg.initialise();
}
await pg.start();
console.log(`[dev-db] postgres running on port ${PORT}`);

const admin = postgres(`postgres://postgres:postgres@localhost:${PORT}/postgres`, {
  onnotice: () => {},
  max: 1,
});
const dbExists = await admin`select 1 from pg_database where datname = ${DB}`;
if (dbExists.length === 0) {
  await admin.unsafe(`CREATE DATABASE ${DB}`);
  console.log(`[dev-db] created database ${DB}`);
}
await admin.end({ timeout: 5 });

if (!existsSync(MARKER)) {
  const db = postgres(URL, { onnotice: () => {}, max: 1 });
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    process.stdout.write(`[dev-db] migrate ${file} ... `);
    await db.unsafe(readFileSync(join(MIG_DIR, file), "utf8"));
    console.log("ok");
  }
  await db`
    insert into chapter (name, slug, tier, status, timezone)
    values ('Case Western Reserve University', 'cwru', 'active', 'active', 'America/New_York')
    on conflict (slug) do nothing
  `;
  console.log("[dev-db] seeded chapter slug=cwru");
  await db.end({ timeout: 5 });
  writeFileSync(MARKER, new Date().toISOString());
}

console.log(`DB READY ${URL}`);

async function shutdown() {
  console.log("\n[dev-db] stopping ...");
  try {
    await pg.stop();
  } catch {
    /* already gone */
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Keep the process (and thus the server) alive.
setInterval(() => {}, 1 << 30);
