const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildChatResponse,
  detectProblemType,
  getConditionScreeningQuestions,
  getRecommendations,
  getSupportLinks,
} = require('../server/services/demoService');
const { analyzeNaturalLanguage } = require('../server/services/nlpService');

test('caste-related terms are consistently classified as caste discrimination', () => {
  const examples = [
    'I am facing caste discrimination.',
    'Someone insulted me because I am Dalit.',
    'There is discrimination due to jaati.',
    'I want help about SC/ST rights.',
    'I face discrimination related to OBC status.',
    'I was treated unfairly because of untouchability.',
  ];

  examples.forEach((message) => {
    assert.equal(detectProblemType(message), 'Discrimination due to caste');
    assert.equal(analyzeNaturalLanguage(message).intent, 'Discrimination due to caste');
  });
});

test('caste concern provides relevant support and non-presumptive legal information', () => {
  const resources = getSupportLinks('LOW', 'caste', 'SC');
  assert.ok(resources.some((item) => item.label.startsWith('NALSA')));
  assert.ok(resources.some((item) => item.label === 'National Commission for Scheduled Castes'));
  assert.ok(resources.some((item) => item.label === 'National Human Rights Commission'));
  const recommendations = getRecommendations('LOW', 'caste');
  assert.ok(recommendations.some((item) => /does not establish eligibility or an offence/i.test(item)));
  assert.ok(!recommendations.some((item) => /Write down dates/i.test(item)));
});

test('caste concern selects the correct commission for an explicit Scheduled Tribe mention', () => {
  const resources = getSupportLinks('LOW', 'Scheduled Tribe caste discrimination', 'SC');
  assert.ok(resources.some((item) => item.label === 'National Commission for Scheduled Tribes'));
  assert.ok(!resources.some((item) => item.label === 'National Commission for Scheduled Castes'));
});

test('caste concern selects the backward-class commission when OBC is explicitly mentioned', () => {
  const resources = getSupportLinks('LOW', 'OBC caste discrimination', 'SC');
  assert.ok(resources.some((item) => item.label === 'National Commission for Backward Classes'));
  assert.ok(!resources.some((item) => item.label === 'National Commission for Scheduled Castes'));
});

test('caste discrimination has its own ten-item condition-specific screening set', () => {
  const questions = getConditionScreeningQuestions('Discrimination due to caste');
  assert.equal(questions.length, 10);
  assert.ok(questions.some((question) => /legal or practical information/i.test(question)));
});

test('chat response categorizes caste mentions and returns official resources immediately', async () => {
  const result = await buildChatResponse('I am being discriminated against because of my caste.', {
    userId: `caste-test-${Date.now()}`,
    category: 'SC',
  });

  assert.equal(result.problemType, 'Discrimination due to caste');
  assert.ok(result.supportLinks.some((item) => item.label.startsWith('NALSA')));
  assert.ok(result.recommendations.some((item) => /SC\/ST \(Prevention of Atrocities\) Act/.test(item)));
});

test('caste-related rights recommendations include actionable NALSA guidance and matching commission', () => {
  const resources = getSupportLinks('HIGH', 'caste discrimination and harassment', 'SC');
  const nalsa = resources.find((item) => item.label.startsWith('NALSA'));
  assert.equal(nalsa.url, 'https://nalsa.gov.in/legal-aid/');
  assert.match(nalsa.detail, /Taluk, District, State/);
  assert.match(nalsa.detail, /no fee/i);
  assert.match(nalsa.nextStep, /appropriate authority/);
  assert.ok(resources.some((item) => item.label === 'National Commission for Scheduled Castes'));
  assert.ok(!resources.some((item) => item.label === 'National Commission for Scheduled Tribes'));
});

test('mental-health links provide a non-diagnostic official support option', () => {
  const resources = getSupportLinks('LOW', 'anxiety and distress');
  const teleManas = resources.find((item) => item.label.startsWith('Tele-MANAS'));
  assert.equal(teleManas.url, 'https://telemanas.mohfw.gov.in/');
  assert.match(teleManas.nextStep, /qualified mental-health professional/);
});

test('emergency resources appear only when immediate danger or critical violence is reported', () => {
  const routine = getSupportLinks('LOW', 'I am worried about my studies');
  assert.ok(!routine.some((item) => item.url === 'tel:112'));
  const danger = getSupportLinks('CRITICAL', 'I am being attacked right now');
  assert.ok(danger.some((item) => item.url === 'tel:112'));
  assert.ok(danger.some((item) => item.url === 'https://112.gov.in/'));
});

test('unrelated concerns do not receive unrelated official agency recommendations', () => {
  const resources = getSupportLinks('LOW', 'I feel tired and need help with sleep');
  assert.equal(resources.length, 1);
  assert.match(resources[0].label, /Tele-MANAS/);
});
