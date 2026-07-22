// Reuse the synthetic-data insert helpers from @curiolab/db's test suite so the
// runtime tests build accounts/chapters the same way the db guarantee tests do.
export {
  makeAdult,
  makeChapter,
  makeMinor,
  makeMembership,
} from '../../../db/test/helpers/fixtures.js'
