/**
 * Defaults for a new hackathons row (plans/hackathon-platform.md §3, §9): team 1-5, one track per
 * project, approved RSVPs can submit, blind judging off, gallery after the reveal, unpublished.
 * The submission deadline defaults to the event end (end time, else start + duration hours).
 */
type PartyTimes = { date?: Date | null; endTime?: Date | null; duration?: number | null };

export function eventEnd(party: PartyTimes): Date | null {
  if (party.endTime) return new Date(party.endTime);
  if (party.date && party.duration && party.duration > 0) {
    return new Date(new Date(party.date).getTime() + party.duration * 3_600_000);
  }
  return null;
}

export function hackathonDefaults(party: PartyTimes) {
  return {
    submissionDeadline: eventEnd(party),
    teamMinSize: 1,
    teamMaxSize: 5,
    maxTracksPerSubmission: 1,
    eligibility: 'registered',
    blindJudging: false,
    galleryVisibility: 'after_reveal',
  };
}
