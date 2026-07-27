import type { GuardianView } from "./types";

// This module used to export an invented family ("Ari", with consent grants,
// activity, and a mentor conversation) that the guardian portal served whenever
// it could not read live data. Fabricated CONSENT states are especially wrong to
// put in front of a parent: a made-up "granted", or "expires in 3 weeks", is
// something they might act on. The fixture is gone; what remains is an EMPTY view
// rendered behind SampleBanner, which says the data could not be loaded.
//
// The export name is unchanged so the existing call sites need no churn.
export const REPRESENTATIVE_GUARDIAN_VIEW: GuardianView = {
  child: { id: "", displayName: "", ageBand: "", chapterName: "" },
  grants: [],
  activity: [],
  messages: [],
  nominations: [],
  isSample: true,
};
