// Typical yearly cycles of popular mentorship programs.
// Dates shift a little every year - always confirm on the official site.

export const PROGRAMS = {
  gsoc: {
    name: "Google Summer of Code",
    site: "https://summerofcode.withgoogle.com/",
    phases: [
      { months: [10, 11, 0], name: "Off-season preparation", goal: "Pick 1-2 target orgs, get merged PRs, become a known face in their community." },
      { months: [1], name: "Org announcement", goal: "Accepted orgs are published (~late Feb). Confirm your target org is in, read its ideas list, talk to mentors." },
      { months: [2], name: "Proposal window", goal: "Contributor applications open (~mid/late March). Draft your proposal early and get mentor feedback." },
      { months: [3], name: "Applications close / review", goal: "Submit before the deadline (~early April). Keep contributing while orgs review." },
      { months: [4], name: "Results & community bonding", goal: "Accepted contributors are announced (~early May). Plan milestones with your mentor." },
      { months: [5, 6, 7], name: "Coding period", goal: "Ship weekly, write blog/status updates, pass midterm evaluation." },
      { months: [8, 9], name: "Final evaluations & extended timelines", goal: "Wrap up, document your work, write the final report." },
    ],
  },
  lfx: {
    name: "LFX Mentorship (Linux Foundation)",
    site: "https://mentorship.lfx.linuxfoundation.org/",
    phases: [
      { months: [0, 1], name: "Spring term applications", goal: "Spring term (Mar-May) projects are listed; apply to CNCF/LF projects with tasks completed." },
      { months: [2, 3], name: "Spring term running / prep Summer", goal: "Contribute to projects likely to appear in the Summer term (Jun-Aug)." },
      { months: [4], name: "Summer term applications", goal: "Summer term projects are listed; finish each project's pre-task and apply." },
      { months: [5, 6], name: "Summer term running / prep Fall", goal: "Contribute to projects likely in the Fall term (Sep-Nov)." },
      { months: [7], name: "Fall term applications", goal: "Fall term projects are listed; complete pre-tasks and apply." },
      { months: [8, 9, 10, 11], name: "Fall term running / prep Spring", goal: "Build history with CNCF projects for the next Spring term (applications ~Jan-Feb)." },
    ],
  },
  outreachy: {
    name: "Outreachy",
    site: "https://www.outreachy.org/",
    phases: [
      { months: [0, 1], name: "May-cohort initial applications", goal: "Initial applications for the May cohort usually open ~Jan-Feb." },
      { months: [2], name: "Contribution period", goal: "Make recorded contributions to your chosen project." },
      { months: [3, 4], name: "Selection / prep", goal: "Keep contributing; prepare for the August-application cycle." },
      { months: [5, 6], name: "Dec-cohort initial applications", goal: "Initial applications for the December cohort usually open ~Jul-Aug." },
      { months: [7, 8, 9], name: "Contribution period", goal: "Record contributions and submit your final application." },
      { months: [10, 11], name: "Internship running / prep", goal: "Prepare for the next cycle - build OSS history now." },
    ],
  },
  general: {
    name: "General open source",
    site: "https://github.com/explore",
    phases: [{ months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], name: "Continuous contribution", goal: "Grow from good-first-issues to owning features and reviewing others' work." }],
  },
};

export function currentPhase(programKey, date = new Date()) {
  const p = PROGRAMS[programKey] || PROGRAMS.general;
  const m = date.getMonth();
  const idx = p.phases.findIndex((ph) => ph.months.includes(m));
  const phase = p.phases[idx] ?? p.phases[0];
  const next = p.phases[(idx + 1) % p.phases.length];
  return { program: p.name, site: p.site, phase, next: p.phases.length > 1 ? next : null, phases: p.phases };
}
