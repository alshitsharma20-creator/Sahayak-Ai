const test = require('node:test');
const assert = require('node:assert/strict');
const {
  K10_ASSESSMENT_TYPE,
  K10_OPTIONS,
  K10_QUESTIONS,
  K10_SCALE_DEFINITION,
  compareK10History,
  getK10HistoryRecommendations,
  scoreK10,
} = require('../server/services/k10Service');

const entry = (score, day, concern = 'Work stress') => ({
  assessment_type: K10_ASSESSMENT_TYPE,
  scale_definition: K10_SCALE_DEFINITION,
  stress_score: score,
  concern_category: concern,
  assessed_at: `2026-10-${day}T00:00:00.000Z`,
});

test('K10 uses the fixed 10 questions and five standard frequency options', () => {
  assert.equal(K10_QUESTIONS.length, 10);
  assert.equal(K10_OPTIONS.length, 5);
  assert.match(K10_QUESTIONS[0], /last 30 days/);
  assert.match(K10_QUESTIONS[9], /feel worthless/);
});

test('K10 score is the sum of ten integer answers from one to five', () => {
  assert.equal(scoreK10(Array(10).fill(1)), 10);
  assert.equal(scoreK10(Array(10).fill(5)), 50);
  assert.equal(scoreK10([1, 2, 3, 4, 5, 1, 2, 3, 4, 5]), 30);
});

test('invalid K10 answers are rejected', () => {
  assert.equal(scoreK10(Array(9).fill(3)), null);
  assert.equal(scoreK10([...Array(9).fill(3), 0]), null);
  assert.equal(scoreK10([...Array(9).fill(3), 5.5]), null);
});

test('K10 comparisons remain comparable when the associated concern changes', () => {
  const comparison = compareK10History([entry(30, '01', 'Work stress'), entry(24, '02', 'Family concern')]);
  assert.equal(comparison.trend, 'Lower than previous');
  assert.equal(comparison.difference, -6);
  assert.match(getK10HistoryRecommendations(comparison)[0], /6 points lower/);
  assert.match(getK10HistoryRecommendations(comparison)[1], /Work stress.*Family concern/);
});

test('K10 comparison separates fixed scales and recognizes fluctuation', () => {
  const otherScale = { ...entry(40, '02'), scale_definition: 'another scale' };
  assert.equal(compareK10History([entry(30, '01'), otherScale]).count, 1);
  assert.equal(compareK10History([entry(30, '01'), entry(20, '02'), entry(25, '03')]).trend, 'Fluctuating');
});
