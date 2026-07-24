// Side-effect module: enable the mentor-student DM feature for a test file by
// setting MENTOR_DM_ENABLED BEFORE @curiolab/app's config.ts is first imported
// (the flag is read once at module evaluation). Import this FIRST, ahead of any
// @curiolab import, so the config picks it up. Also seeds a synthetic field-crypto
// key (read lazily at encrypt/decrypt time) so encrypted sends work.
import { randomBytes } from 'node:crypto'

process.env.MENTOR_DM_ENABLED = 'true'
if (process.env.DM_ENCRYPTION_KEY === undefined) {
  process.env.DM_ENCRYPTION_KEY = randomBytes(32).toString('base64')
}
