// Reuse the synthetic-data insert helpers from @curiolab/db's test suite so the
// app-service tests build accounts/chapters the same way the db and runtime
// suites do. Names and dates in those helpers are obviously synthetic.
export {
  makeAdult,
  makeChapter,
  makeMinor,
  makeMembership,
  makeTerm,
  makeApplication,
  makeEnrollment,
} from '../../../db/test/helpers/fixtures.js'
