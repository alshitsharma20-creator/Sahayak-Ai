const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const apiRouter = require('../server/routes/api');

const app = express();
app.use(express.json());
app.use('/api', apiRouter);
const server = app.listen(0);
let baseUrl;

test.before(() => new Promise((resolve) => {
  if (server.listening) {
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    resolve();
    return;
  }
  server.once('listening', () => {
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    resolve();
  });
}));

test.after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test('health and login validation match the configured auth mode', async () => {
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.ok(['demo', 'supabase'].includes(health.mode));

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: 'demo', password: 'demo' }),
  });
  const result = await response.json();
  if (health.mode === 'demo') {
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.user.username, 'demo');
  } else {
    assert.equal(response.status, 400);
    assert.equal(result.ok, false);
  }
});

test('chat and progress routes enforce the configured auth mode', async () => {
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  const response = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'I feel stressed about my exams', language: 'en', category: 'SC' }),
  });
  const result = await response.json();
  if (health.mode === 'demo') {
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(typeof result.response, 'string');
  } else {
    assert.equal(response.status, 401);
    assert.equal(result.ok, false);
  }

  const progress = await fetch(`${baseUrl}/user/progress`);
  assert.equal(progress.status, health.mode === 'demo' ? 503 : 401);
});

test('fixed K10 questions are served and scoring validates responses', async () => {
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  const questionsResponse = await fetch(`${baseUrl}/assessment/k10/questions`);
  const questionnaire = await questionsResponse.json();
  assert.equal(questionsResponse.status, 200);
  assert.equal(questionnaire.questions.length, 10);
  assert.equal(questionnaire.options.length, 5);
  assert.match(questionnaire.questions[0], /tired out for no good reason/);

  if (health.mode === 'supabase') {
    const unauthenticated = await fetch(`${baseUrl}/assessment/k10`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: Array(10).fill(3) }),
    });
    assert.equal(unauthenticated.status, 401);
    return;
  }

  const invalid = await fetch(`${baseUrl}/assessment/k10`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: Array(10).fill(0) }),
  });
  assert.equal(invalid.status, 400);

  const scored = await fetch(`${baseUrl}/assessment/k10`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: Array(10).fill(3), concernCategory: 'Work stress' }),
  });
  const result = await scored.json();
  assert.equal(scored.status, 200);
  assert.equal(result.score, 30);
  assert.equal(result.historySaved, false);
  assert.match(result.interpretation, /not a diagnosis/);
});
