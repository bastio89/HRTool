const { buildMatchingSummary } = require('../utils/matchingSummary');

test.each(['ai', 'vector'])('%s history preserves a one-percent score and original pair metadata', method => {
  const original = {
    method, score: 1, candidateName: 'Anna', evaluationId: 31,
    matchedAt: '2025-01-01T10:00:00Z', cacheStatus: 'hit',
  };
  const summary = buildMatchingSummary({
    method, results: [original, { method, score: null, candidateName: 'Uncomputed', vectorScore: 0.9 }],
  });
  expect(summary.topScore).toBe(0.01);
  expect(summary.averageScore).toBe(0.01);
  expect(summary.topCandidates).toEqual([{ ...original, score: 0.01 }]);
  expect(summary.candidateCount).toBe(2);
});

test('missing scores stay uncomputed while a confirmed zero remains rankable', () => {
  const empty = buildMatchingSummary({ method: 'ai', results: [{ candidateName: 'Uncomputed', score: null }] });
  expect(empty.topScore).toBeNull();
  expect(empty.averageScore).toBeNull();
  expect(empty.topCandidates).toEqual([]);
  const zero = buildMatchingSummary({ method: 'ai', results: [{ candidateName: 'Confirmed', score: 0 }] });
  expect(zero.topScore).toBe(0);
  expect(zero.averageScore).toBe(0);
  expect(zero.topCandidates).toHaveLength(1);
});

test('legacy fractions retain their original units without gaining validity evidence', () => {
  const summary = buildMatchingSummary({ results: [{ candidateName: 'Legacy', score: 0.85 }] });
  expect(summary.topScore).toBe(0.85);
  expect(summary.topCandidates[0].evaluationId).toBeUndefined();
  expect(summary.topCandidates[0].cacheStatus).toBeUndefined();
});
