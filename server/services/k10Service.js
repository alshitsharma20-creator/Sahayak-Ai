const K10_QUESTIONS = [
  'During the last 30 days, how often did you feel tired out for no good reason?',
  'During the last 30 days, how often did you feel nervous?',
  'During the last 30 days, how often did you feel so nervous that nothing could calm you down?',
  'During the last 30 days, how often did you feel hopeless?',
  'During the last 30 days, how often did you feel restless or fidgety?',
  'During the last 30 days, how often did you feel so restless that you could not sit still?',
  'During the last 30 days, how often did you feel depressed?',
  'During the last 30 days, how often did you feel that everything was an effort?',
  'During the last 30 days, how often did you feel so sad that nothing could cheer you up?',
  'During the last 30 days, how often did you feel worthless?',
];

const K10_OPTIONS = [
  'None of the time',
  'A little of the time',
  'Some of the time',
  'Most of the time',
  'All of the time',
];

const K10_ASSESSMENT_TYPE = 'k10_v1';
const K10_SCALE_DEFINITION = 'K10, 10 fixed items, last 30 days, each scored 1-5, total 10-50; higher scores indicate greater psychological distress.';

function scoreK10(answers) {
  if (!Array.isArray(answers) || answers.length !== K10_QUESTIONS.length
    || answers.some((answer) => !Number.isInteger(answer) || answer < 1 || answer > 5)) {
    return null;
  }
  return answers.reduce((total, answer) => total + answer, 0);
}

function compareK10History(assessments = []) {
  const comparable = assessments
    .filter((item) => item.assessment_type === K10_ASSESSMENT_TYPE
      && item.scale_definition === K10_SCALE_DEFINITION
      && Number.isInteger(item.stress_score)
      && item.stress_score >= 10
      && item.stress_score <= 50)
    .sort((a, b) => new Date(a.assessed_at) - new Date(b.assessed_at));
  if (comparable.length < 2) {
    return {
      trend: 'Insufficient data',
      difference: null,
      previous: comparable[0] || null,
      latest: comparable[0] || null,
      count: comparable.length,
    };
  }

  const previous = comparable[comparable.length - 2];
  const latest = comparable[comparable.length - 1];
  const difference = latest.stress_score - previous.stress_score;
  const directions = new Set(comparable.slice(1).map((item, index) => (
    Math.sign(item.stress_score - comparable[index].stress_score)
  )).filter(Boolean));
  return {
    trend: directions.size > 1 ? 'Fluctuating' : difference < 0 ? 'Lower than previous' : difference > 0 ? 'Higher than previous' : 'Unchanged',
    difference,
    previous,
    latest,
    count: comparable.length,
  };
}

function getK10HistoryRecommendations(comparison) {
  if (comparison.count === 0) {
    return ['There is no earlier saved K10 to compare. If saved history is enabled, this result can serve as a starting point; answer the same 30-day questions each time.'];
  }
  if (comparison.count === 1) {
    return ['This is your first saved K10 score, so a change over time cannot be compared yet. If you take it again later, answer for the stated last-30-days period.'];
  }
  let recommendation;
  if (comparison.trend === 'Lower than previous') {
    recommendation = `Your latest K10 total is ${Math.abs(comparison.difference)} point${Math.abs(comparison.difference) === 1 ? '' : 's'} lower than the previous one. Consider continuing support that feels helpful; the score alone cannot explain why it changed.`;
  } else if (comparison.trend === 'Higher than previous') {
    recommendation = `Your latest K10 total is ${comparison.difference} point${comparison.difference === 1 ? '' : 's'} higher than the previous one. If distress is affecting daily life, consider speaking with a qualified health professional or someone you trust. The score alone cannot explain why it changed.`;
  } else if (comparison.trend === 'Fluctuating') {
    recommendation = 'Your saved K10 totals have gone up and down. Consider noting what support or circumstances feel relevant and discussing ongoing distress with a qualified health professional. The scores do not establish a cause.';
  } else {
    recommendation = 'Your latest K10 total is the same as the previous one. If the feelings are troubling or affecting daily life, consider speaking with a qualified health professional or someone you trust.';
  }
  const recommendations = [recommendation];
  if (comparison.previous.concern_category && comparison.latest.concern_category
    && comparison.previous.concern_category !== comparison.latest.concern_category) {
    recommendations.push(`The concern context recorded by your AI chat changed from "${comparison.previous.concern_category}" to "${comparison.latest.concern_category}". The K10 measures general distress; this context does not show what caused the score change. Consider discussing both with a qualified support professional.`);
  }
  return recommendations;
}

module.exports = {
  K10_ASSESSMENT_TYPE,
  K10_OPTIONS,
  K10_QUESTIONS,
  K10_SCALE_DEFINITION,
  compareK10History,
  getK10HistoryRecommendations,
  scoreK10,
};
