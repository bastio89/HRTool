function pairKey(row) {
  const jobId = row?.jobId ?? row?.sourceJobId
  const candidateId = row?.candidateId ?? row?.sourceCandidateId
  return jobId == null || candidateId == null ? null : JSON.stringify([String(jobId), String(candidateId)])
}

export function attachSkillMatchingResults(aiResults, skillResponse = {}) {
  const skillResults = new Map((skillResponse.results || []).map(row => [pairKey(row), row]))
  const failures = new Map((skillResponse.failures || []).map(row => [pairKey(row), row.error]))

  return aiResults.map(row => {
    const key = pairKey(row)
    return {
      ...row,
      skillMatch: key == null ? null : skillResults.get(key) || null,
      skillMatchFailure: key == null ? null : failures.get(key) || null,
    }
  })
}
