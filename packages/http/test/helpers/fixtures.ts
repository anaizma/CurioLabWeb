// Reuse the synthetic-data insert helpers from @curiolab/db (packages/db/test/
// helpers/fixtures.ts). Names and dates are obviously synthetic per the
// test-data policy, so a real record in a test database is a visible incident.
export {
  makeChapter,
  makeTerm,
  makePod,
  makeAdult,
  makeMinor,
  makeMembership,
  makeApplication,
  makeEnrollment,
} from '../../../db/test/helpers/fixtures.js'
