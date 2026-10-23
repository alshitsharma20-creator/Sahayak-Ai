const test = require('node:test');
const assert = require('node:assert/strict');
const { compareAssessmentScores, parseCookies } = require('../server/services/supabaseService');

const assessment = (id, score, scale = 'test-scale', date = `2026-10-${id}T00:00:00.000Z`) => ({
  id,
  stress_score: score,
  assessment_type: 'test',
  scale_definition: scale,
  assessed_at: date,
});

test('lower comparable reported-impact scores are classified as improving', () => {
  const result = compareAssessmentScores([assessment('01', 35), assessment('02', 20)]);
  assert.equal(result.trend, 'Improving');
  assert.equal(result.difference, -15);
});

test('higher comparable reported-impact scores are classified as worsening', () => {
  const result = compareAssessmentScores([assessment('01', 20), assessment('02', 35)]);
  assert.equal(result.trend, 'Worsening');
  assert.equal(result.difference, 15);
});

test('equal comparable scores are stable', () => {
  assert.equal(compareAssessmentScores([assessment('01', 20), assessment('02', 20)]).trend, 'Stable');
});

test('reversals in comparable scores are classified as fluctuating', () => {
  const result = compareAssessmentScores([
    assessment('01', 30),
    assessment('02', 20),
    assessment('03', 25),
  ]);
  assert.equal(result.trend, 'Fluctuating');
  assert.equal(result.difference, -5);
});

test('different scales and insufficient samples do not produce a trend', () => {
  assert.equal(compareAssessmentScores([assessment('01', 20)]).trend, 'Insufficient data');
  assert.equal(compareAssessmentScores([assessment('01', 20), assessment('02', 30, 'different')]).trend, 'Insufficient data');
  assert.equal(compareAssessmentScores([
    { ...assessment('01', 20), concern_category: 'Stress' },
    { ...assessment('02', 30), concern_category: 'Anxiety' },
  ]).trend, 'Insufficient data');
});

test('cookie parsing decodes values without throwing on malformed encoding', () => {
  assert.deepEqual(parseCookies('a=hello%20world; broken=%E0%A4%A'), {
    a: 'hello world',
    broken: '%E0%A4%A',
  });
});
