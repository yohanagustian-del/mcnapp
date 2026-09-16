/**
 * M7 v2 (PRD R4): `project_participants.target_gmv` is now NOT NULL — every
 * participant needs a personal target the moment they're added/approved. The system
 * suggests `sisa target / sisa kuota` (remaining project target / remaining quota),
 * the team can still override it. Pure function so the suggestion can be tested
 * without a DB (CLAUDE.md #4: one implementation, reused by add-participant and,
 * later, decideProjectJoinRequest's approve path).
 */
export function suggestParticipantTargetGmv({
  projectTargetGmv,
  targetCreators,
  existingParticipantTargets,
}: {
  projectTargetGmv: number;
  targetCreators: number | null;
  existingParticipantTargets: number[];
}): number {
  const sumExisting = existingParticipantTargets.reduce((s, v) => s + v, 0);
  const remainingTarget = Math.max(projectTargetGmv - sumExisting, 0);
  // Without a known quota, assume "one more slot" (this participant) as the divisor.
  const quota = targetCreators ?? existingParticipantTargets.length + 1;
  const remainingQuota = Math.max(quota - existingParticipantTargets.length, 1);
  return Math.round(remainingTarget / remainingQuota);
}
