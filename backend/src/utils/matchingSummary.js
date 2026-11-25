function buildMatchingSummary(result = {}) {
  const matchRows = Array.isArray(result.results)
    ? result.results
    : Array.isArray(result.matrix)
      ? result.matrix
      : [];
  const getScore = (value, method) => {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error('Ungueltiger Matching-Score in der Historie');
    }
    return ['ai', 'vector'].includes(method) || value > 1 ? value / 100 : value;
  };
  const candidateNames = [...new Set([
    ...(Array.isArray(result.candidates) ? result.candidates.map((candidate) => candidate?.name) : []),
    ...matchRows.map((match) => match?.candidateName),
  ].filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()))];
  let totalScore = 0;
  let scoredCount = 0;
  const topCandidates = [];
  for (const match of matchRows) {
    const candidate = {
      candidateName: match?.candidateName || '',
      score: getScore(match?.score, match?.method ?? result.method),
      method: match?.method ?? result.method,
      matchedAt: match?.matchedAt,
      evaluationId: match?.evaluationId,
      cacheStatus: match?.cacheStatus,
    };
    if (candidate.score === null) continue;
    totalScore += candidate.score;
    scoredCount += 1;

    const insertAt = topCandidates.findIndex((current) => candidate.score > current.score);
    if (insertAt >= 0) topCandidates.splice(insertAt, 0, candidate);
    else if (topCandidates.length < 3) topCandidates.push(candidate);
    if (topCandidates.length > 3) topCandidates.pop();
  }

  return {
    method: result.method,
    runId: result.runId,
    matchedAt: result.matchedAt,
    candidateCount: Array.isArray(result.candidates) ? result.candidates.length : candidateNames.length || matchRows.length,
    candidateNames,
    topScore: topCandidates[0]?.score ?? null,
    averageScore: scoredCount ? Number((totalScore / scoredCount).toFixed(4)) : null,
    topCandidates,
  };
}

module.exports = { buildMatchingSummary };