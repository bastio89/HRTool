function buildMatchingSummary(result = {}) {
  const matchRows = Array.isArray(result.results)
    ? result.results
    : Array.isArray(result.matrix)
      ? result.matrix
      : [];
  const getScore = (value) => {
    const score = Number(value);
    if (!Number.isFinite(score)) return 0;
    return score > 1 ? score / 100 : score;
  };
  const candidateNames = [...new Set([
    ...(Array.isArray(result.candidates) ? result.candidates.map((candidate) => candidate?.name) : []),
    ...matchRows.map((match) => match?.candidateName),
  ].filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()))];
  let totalScore = 0;
  const topCandidates = [];
  for (const match of matchRows) {
    const candidate = { candidateName: match?.candidateName || '', score: getScore(match?.score) };
    totalScore += candidate.score;

    const insertAt = topCandidates.findIndex((current) => candidate.score > current.score);
    if (insertAt >= 0) topCandidates.splice(insertAt, 0, candidate);
    else if (topCandidates.length < 3) topCandidates.push(candidate);
    if (topCandidates.length > 3) topCandidates.pop();
  }

  return {
    candidateCount: Array.isArray(result.candidates) ? result.candidates.length : candidateNames.length || matchRows.length,
    candidateNames,
    topScore: topCandidates[0]?.score || 0,
    averageScore: matchRows.length ? Number((totalScore / matchRows.length).toFixed(4)) : 0,
    topCandidates,
  };
}

module.exports = { buildMatchingSummary };