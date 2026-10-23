const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  registerUser,
  loginUser,
  getUserProfile,
  generateAssessment,
  getHistoryByUser,
  deleteAssessment,
  buildChatResponse,
  getLegalFrameworks,
  languageMap,
  getRecommendations,
  getSupportLinks,
  buildSVIAssessment,
  translateStrings,
} = require('../services/demoService');
const {
  authenticateRequest,
  clearAuthCookies,
  compareAssessmentScores,
  createSupabaseClient,
  isSupabaseConfigured,
  parseCookies,
  requireMemoryConsent,
  setAuthCookies,
} = require('../services/supabaseService');
const {
  K10_ASSESSMENT_TYPE,
  K10_OPTIONS,
  K10_QUESTIONS,
  K10_SCALE_DEFINITION,
  compareK10History,
  getK10HistoryRecommendations,
  scoreK10,
} = require('../services/k10Service');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false });

function authWhenConfigured(req, res, next) {
  return isSupabaseConfigured() ? authenticateRequest(req, res, next) : next();
}

function requireSupabase(res) {
  if (isSupabaseConfigured()) return true;
  res.status(503).json({ ok: false, message: 'Persistent storage is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.' });
  return false;
}

async function deleteAllUserData(supabase, userId) {
  const tables = [
    'progress_history',
    'recommendations',
    'memory_summaries',
    'user_concerns',
    'daily_assessments',
    'conversations',
  ];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (error) throw error;
  }
}

async function getRelevantHistoricalMessage(supabase, userId, text) {
  const terms = String(text).toLowerCase().match(/[a-z]{4,}/g) || [];
  if (!terms.length) return null;
  const { data, error } = await supabase
    .from('messages')
    .select('content,created_at')
    .eq('user_id', userId)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const stopWords = new Set(['about', 'after', 'again', 'been', 'does', 'from', 'have', 'here', 'just', 'like', 'more', 'same', 'that', 'them', 'then', 'there', 'they', 'this', 'what', 'when', 'where', 'with', 'would']);
  const significantTerms = terms.filter((term) => !stopWords.has(term));
  if (!significantTerms.length) return null;
  const relevant = (data || []).find((entry) => significantTerms.some((term) => entry.content.toLowerCase().includes(term)));
  if (relevant) {
    return {
      quote: relevant.content.slice(0, 240),
      date: new Date(relevant.created_at).toLocaleDateString('en-IN'),
    };
  }
  const { data: memory, error: memoryError } = await supabase.from('memory_summaries')
    .select('confirmed_facts')
    .eq('user_id', userId)
    .maybeSingle();
  if (memoryError) throw memoryError;
  const fact = (memory?.confirmed_facts || []).find((entry) => significantTerms.some((term) => entry.toLowerCase().includes(term)));
  if (fact) return { quote: fact.slice(0, 240), date: 'your saved notes' };
  const { data: profile, error: profileError } = await supabase.from('user_profiles')
    .select('background')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  const background = profile?.background || '';
  return significantTerms.some((term) => background.toLowerCase().includes(term))
    ? { quote: background.slice(0, 240), date: 'the background you chose to save' }
    : null;
}

function detectReportedFactor(assessments) {
  const text = assessments.map((item) => (item.user_reported_observations || []).join(' ')).join(' ').toLowerCase();
  const factors = [
    { label: 'academic workload', pattern: /\b(exam|exams|assignment|assignments|study|studies|coursework|deadline)\b/ },
    { label: 'work pressure', pattern: /\b(work|workload|job|boss|shift)\b/ },
    { label: 'sleep or rest', pattern: /\b(sleep|insomnia|rest|nightmare)\b/ },
    { label: 'relationship or family circumstances', pattern: /\b(relationship|partner|family|conflict)\b/ },
    { label: 'social support', pattern: /\b(support|friend|trusted person|alone|lonely)\b/ },
    { label: 'routine changes', pattern: /\b(routine|schedule|habit)\b/ },
    { label: 'physical activity', pattern: /\b(exercise|walk|physical activity)\b/ },
    { label: 'relaxation strategies', pattern: /\b(breathing|meditation|relaxation|grounding)\b/ },
  ];
  return factors.find((factor) => factor.pattern.test(text))?.label || null;
}

function getAssessmentGroupKey(item) {
  const concern = item.assessment_type === K10_ASSESSMENT_TYPE ? '' : item.concern_category || '';
  return `${item.assessment_type}\u0000${item.scale_definition}\u0000${concern}`;
}

function getComparisonRecommendations(comparison, assessmentType) {
  if (assessmentType === K10_ASSESSMENT_TYPE) return getK10HistoryRecommendations(comparison);
  if (comparison.trend === 'Insufficient data') return ['More comparable reports are needed before a change can be summarized.'];
  if (comparison.trend === 'Improving') return ['The latest experimental reported-impact score is lower than the earliest comparable score. Consider continuing support that feels helpful; this unvalidated measure cannot explain why it changed.'];
  if (comparison.trend === 'Worsening') return ['The latest experimental reported-impact score is higher than the earliest comparable score. If the situation is affecting daily life, consider discussing support options with a qualified professional or trusted person. This unvalidated measure is not a diagnosis.'];
  if (comparison.trend === 'Fluctuating') return ['Comparable experimental scores have varied over time. Consider noting what support or circumstances feel relevant; these scores do not establish a cause.'];
  return ['Comparable experimental reported-impact scores are unchanged. Consider seeking support if the situation remains troubling or affects daily life.'];
}

router.get('/health', (req, res) => {
  res.json({ ok: true, mode: isSupabaseConfigured() ? 'supabase' : 'demo', message: 'SahayakAI API is running.' });
});

router.get('/assessment/k10/questions', (req, res) => {
  return res.json({ ok: true, timeframe: 'last 30 days', questions: K10_QUESTIONS, options: K10_OPTIONS });
});

router.post('/assessment/k10', authWhenConfigured, async (req, res) => {
  const { answers, concernCategory } = req.body || {};
  const score = scoreK10(answers);
  if (score === null) {
    return res.status(400).json({ ok: false, message: 'Answer all 10 fixed K10 items using an integer response from 1 to 5.' });
  }

  const assessment = {
    assessment_type: K10_ASSESSMENT_TYPE,
    scale_definition: K10_SCALE_DEFINITION,
    stress_score: score,
    concern_category: typeof concernCategory === 'string' ? concernCategory.trim().slice(0, 100) || null : null,
  };
  let historySaved = false;
  let persistenceWarning = false;
  let comparisonWarning = false;
  let comparison = compareK10History([]);
  if (req.authUser) {
    try {
      if (await requireMemoryConsent(req.supabase, req.authUser.id)) {
        const { data: savedAssessment, error: saveError } = await req.supabase.from('daily_assessments')
          .insert({
            user_id: req.authUser.id,
            ...assessment,
          })
          .select('id,assessed_at,stress_score,assessment_type,scale_definition,concern_category')
          .single();
        if (saveError) throw saveError;
        historySaved = true;

        const { data: history, error: historyError } = await req.supabase.from('daily_assessments')
          .select('id,assessed_at,stress_score,assessment_type,scale_definition,concern_category')
          .eq('user_id', req.authUser.id)
          .eq('assessment_type', K10_ASSESSMENT_TYPE)
          .order('assessed_at', { ascending: true })
          .limit(365);
        if (historyError) throw historyError;
        comparison = compareK10History(history || []);
        assessment.id = savedAssessment.id;
        assessment.assessed_at = savedAssessment.assessed_at;
      }
    } catch (error) {
      console.error('K10 assessment persistence failed:', error.message);
      if (historySaved) comparisonWarning = true;
      else persistenceWarning = true;
    }
  }

  return res.json({
    ok: true,
    score,
    range: '10-50',
    interpretation: 'Higher totals indicate greater reported psychological distress. This screening result is not a diagnosis.',
    historySaved,
    persistenceWarning,
    comparisonWarning,
    comparison,
    recommendations: getK10HistoryRecommendations(comparison),
    supportLinks: getSupportLinks('LOW', 'mental health distress'),
  });
});

router.post('/auth/register', registrationLimiter, async (req, res) => {
  if (isSupabaseConfigured()) {
    const { email, loginId, password, name = '' } = req.body || {};
    const accountEmail = email || loginId;
    if (typeof accountEmail !== 'string' || !accountEmail.includes('@') || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ ok: false, message: 'A valid email and password with at least 8 characters are required.' });
    }
    try {
      const client = createSupabaseClient();
      const { data, error } = await client.auth.signUp({
        email: accountEmail.trim(),
        password,
        options: {
          data: { display_name: String(name).trim().slice(0, 120) },
          ...(process.env.SUPABASE_AUTH_REDIRECT_URL
            ? { emailRedirectTo: process.env.SUPABASE_AUTH_REDIRECT_URL }
            : {}),
        },
      });
      if (error) return res.status(400).json({ ok: false, message: error.message });
      if (data.session) setAuthCookies(res, data.session);
      return res.status(201).json({
        ok: true,
        user: data.user ? { id: data.user.id, email: data.user.email, name: name || '', authMode: 'supabase' } : null,
        authMode: 'supabase',
        requiresEmailConfirmation: !data.session,
      });
    } catch (error) {
      console.error('Account creation failed:', error.message);
      return res.status(503).json({ ok: false, message: 'Account creation is temporarily unavailable.' });
    }
  }
  const payload = { ...(req.body || {}), username: req.body?.username || req.body?.loginId || req.body?.email };
  const result = registerUser(payload);
  if (!result.ok) return res.status(400).json(result);
  return res.status(201).json(result);
});

router.post('/auth/login', loginLimiter, async (req, res) => {
  if (isSupabaseConfigured()) {
    const { email, loginId, password } = req.body || {};
    const accountEmail = email || loginId;
    if (typeof accountEmail !== 'string' || !accountEmail.includes('@') || typeof password !== 'string' || !password) {
      return res.status(400).json({ ok: false, message: 'Email and password are required.' });
    }
    try {
      const { data, error } = await createSupabaseClient().auth.signInWithPassword({
        email: accountEmail.trim(),
        password,
      });
      if (error || !data.session) {
        return res.status(401).json({ ok: false, message: error?.message || 'Login failed.' });
      }
      setAuthCookies(res, data.session);
      return res.json({
        ok: true,
        user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.display_name || '', authMode: 'supabase' },
        authMode: 'supabase',
      });
    } catch (error) {
      console.error('Login failed:', error.message);
      return res.status(503).json({ ok: false, message: 'Login is temporarily unavailable.' });
    }
  }
  const payload = { ...(req.body || {}), username: req.body?.username || req.body?.loginId || req.body?.email };
  const result = loginUser(payload);
  if (!result.ok) return res.status(401).json(result);
  return res.json(result);
});

router.post('/auth/logout', async (req, res) => {
  if (isSupabaseConfigured()) {
    const { sahayak_access: accessToken, sahayak_refresh: refreshToken } = parseCookies(req.headers.cookie);
    if (accessToken && refreshToken) {
      try {
        const client = createSupabaseClient();
        await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) console.warn('Supabase logout could not revoke the session.');
      } catch {
        console.warn('Supabase logout could not revoke the session.');
      }
    }
  }
  clearAuthCookies(res);
  return res.json({ ok: true });
});

router.get('/auth/me', authenticateRequest, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('user_profiles')
      .select('display_name, memory_consent')
      .eq('user_id', req.authUser.id)
      .maybeSingle();
    if (error) throw error;
    return res.json({
      ok: true,
      user: {
        id: req.authUser.id,
        email: req.authUser.email,
        name: data?.display_name || req.authUser.user_metadata?.display_name || '',
        memoryConsent: data?.memory_consent === true,
        authMode: 'supabase',
      },
    });
  } catch (error) {
    console.error('Profile retrieval failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to load your profile.' });
  }
});

router.get('/user/profile', (req, res) => {
  if (isSupabaseConfigured()) {
    return authenticateRequest(req, res, async () => {
      try {
        const { data, error } = await req.supabase
          .from('user_profiles')
          .select('display_name, background, support_goals, preferences, memory_consent, created_at, updated_at')
          .eq('user_id', req.authUser.id)
          .single();
        if (error) throw error;
        return res.json({ ok: true, user: { id: req.authUser.id, email: req.authUser.email, ...data } });
      } catch (error) {
        console.error('Profile retrieval failed:', error.message);
        return res.status(500).json({ ok: false, message: 'Unable to load your profile.' });
      }
    });
  }
  const username = req.query.username;
  const result = getUserProfile(username);
  if (!result.ok) return res.status(404).json(result);
  return res.json(result);
});

router.patch('/user/profile', authenticateRequest, async (req, res) => {
  const updates = {};
  const body = req.body || {};
  if (typeof body.memoryConsent === 'boolean') updates.memory_consent = body.memoryConsent;
  if (typeof body.background === 'string') updates.background = body.background.slice(0, 4000);
  if (typeof body.displayName === 'string') updates.display_name = body.displayName.trim().slice(0, 120);
  if (Array.isArray(body.supportGoals)) updates.support_goals = body.supportGoals.filter((item) => typeof item === 'string').slice(0, 20);
  if (body.preferences && typeof body.preferences === 'object' && !Array.isArray(body.preferences)) {
    updates.preferences = body.preferences;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ ok: false, message: 'No valid profile fields were provided.' });

  try {
    if (updates.memory_consent === false) {
      updates.background = null;
      updates.support_goals = [];
      updates.preferences = {};
    }
    if ((typeof updates.background === 'string' || Array.isArray(updates.support_goals)) && updates.memory_consent !== true) {
      const { data: profile, error: profileError } = await req.supabase.from('user_profiles')
        .select('memory_consent')
        .eq('user_id', req.authUser.id)
        .single();
      if (profileError) throw profileError;
      if (!profile.memory_consent && updates.memory_consent !== true) {
        return res.status(403).json({ ok: false, message: 'Enable saved memory before saving personal background or goals.' });
      }
    }
    const { data, error } = await req.supabase.from('user_profiles')
      .update(updates)
      .eq('user_id', req.authUser.id)
      .select('display_name, background, support_goals, preferences, memory_consent')
      .single();
    if (error) throw error;
    if (updates.memory_consent === false) {
      try {
        await deleteAllUserData(req.supabase, req.authUser.id);
      } catch (deletionError) {
        const { error: rollbackError } = await req.supabase.from('user_profiles')
          .update({ memory_consent: true })
          .eq('user_id', req.authUser.id);
        if (rollbackError) console.error('Could not restore memory consent after incomplete deletion:', rollbackError.message);
        throw deletionError;
      }
    }
    return res.json({ ok: true, user: data });
  } catch (error) {
    console.error('Profile update failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to update profile settings.' });
  }
});

router.get('/user/memory', authenticateRequest, async (req, res) => {
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) {
      return res.json({ ok: true, memory: null, enabled: false });
    }
    const { data, error } = await req.supabase.from('memory_summaries')
      .select('summary_text,confirmed_facts,historical_observations,ai_hypotheses,relevant_concerns,source_message_ids,updated_at')
      .eq('user_id', req.authUser.id)
      .maybeSingle();
    if (error) throw error;
    return res.json({ ok: true, memory: data, enabled: true });
  } catch (error) {
    console.error('Memory retrieval failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to load saved memory.' });
  }
});

router.put('/user/memory', authenticateRequest, async (req, res) => {
  const facts = req.body?.confirmedFacts;
  if (!Array.isArray(facts) || facts.length > 20 || facts.some((fact) => typeof fact !== 'string' || fact.length > 500)) {
    return res.status(400).json({ ok: false, message: 'Provide up to 20 memory notes, each no longer than 500 characters.' });
  }
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) {
      return res.status(403).json({ ok: false, message: 'Enable saved memory before editing it.' });
    }
    const { data: oldMemory, error: oldMemoryError } = await req.supabase.from('memory_summaries')
      .select('source_message_ids,historical_observations,ai_hypotheses,relevant_concerns')
      .eq('user_id', req.authUser.id)
      .maybeSingle();
    if (oldMemoryError) throw oldMemoryError;
    const cleanedFacts = facts.map((fact) => fact.trim()).filter(Boolean);
    const { data, error } = await req.supabase.from('memory_summaries')
      .upsert({
        user_id: req.authUser.id,
        confirmed_facts: cleanedFacts,
        summary_text: [
          cleanedFacts.length ? `User-confirmed notes: ${cleanedFacts.join(' | ')}` : '',
          oldMemory?.historical_observations?.length
            ? `Past user-reported statements (not independently verified): ${oldMemory.historical_observations.join(' | ')}`
            : '',
        ].filter(Boolean).join('\n'),
        source_message_ids: oldMemory?.source_message_ids || [],
        historical_observations: oldMemory?.historical_observations || [],
        ai_hypotheses: oldMemory?.ai_hypotheses || [],
        relevant_concerns: oldMemory?.relevant_concerns || [],
      }, { onConflict: 'user_id' })
      .select('summary_text,confirmed_facts,updated_at')
      .single();
    if (error) throw error;
    return res.json({ ok: true, memory: data });
  } catch (error) {
    console.error('Memory update failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to update saved memory.' });
  }
});

router.post('/translate', async (req, res) => {
  const { strings = [], language = 'en' } = req.body || {};
  try {
    const result = await translateStrings(strings, language);
    if (!result.ok) return res.status(503).json(result);
    return res.json(result);
  } catch (error) {
    console.error('Translation request failed:', error);
    return res.status(503).json({ ok: false, message: 'Translation is temporarily unavailable.' });
  }
});

router.post('/chat', chatLimiter, authWhenConfigured, async (req, res) => {
  const { message = '', language = 'en', category = 'SC' } = req.body || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 12000) {
    return res.status(400).json({ ok: false, message: 'Enter a message of 1 to 12000 characters.' });
  }
  const userId = req.authUser?.id || req.body?.userId || 'guest';
  let memoryConsent = false;
  let conversationId = null;
  let historyMessages = [];
  let historicalContext = null;
  let persistenceWarning = false;

  if (req.authUser) {
    try {
      memoryConsent = await requireMemoryConsent(req.supabase, userId);
      if (memoryConsent) {
        conversationId = req.body?.conversationId || null;
        if (conversationId) {
          const { data, error } = await req.supabase.from('conversations')
            .select('id')
            .eq('id', conversationId)
            .eq('user_id', userId)
            .maybeSingle();
          if (error) throw error;
          if (!data) return res.status(404).json({ ok: false, message: 'Conversation not found.' });
        } else {
          const { data, error } = await req.supabase.from('conversations')
            .insert({ user_id: userId, title: message.trim().slice(0, 120) || 'Support conversation' })
            .select('id')
            .single();
          if (error) throw error;
          conversationId = data.id;
        }

        const { data: storedMessages, error: messagesError } = await req.supabase.from('messages')
          .select('role,content,created_at')
          .eq('conversation_id', conversationId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(40);
        if (messagesError) throw messagesError;
        historyMessages = (storedMessages || []).reverse();
        historicalContext = await getRelevantHistoricalMessage(req.supabase, userId, message);
      }
    } catch (error) {
      console.error('Conversation history retrieval failed:', error.message);
      persistenceWarning = true;
      conversationId = null;
      historyMessages = [];
      historicalContext = null;
    }
  }

  let bot;
  try {
    bot = await buildChatResponse(message, {
      category,
      language,
      userId,
      conversationId,
      historyMessages,
      historicalContext,
    });
  } catch (error) {
    console.error('Chat response generation failed:', error.message);
    return res.status(503).json({ ok: false, message: 'A response could not be generated. Please try again.' });
  }

  if (memoryConsent && conversationId) {
    try {
      const { data: savedUserMessage, error: userMessageError } = await req.supabase.from('messages').insert({
        conversation_id: conversationId,
        user_id: userId,
        role: 'user',
        content: message.trim(),
      }).select('id').single();
      if (userMessageError) throw userMessageError;
      const { error: assistantMessageError } = await req.supabase.from('messages').insert({
        conversation_id: conversationId,
        user_id: userId,
        role: 'assistant',
        content: [historicalContext ? `Earlier, on ${historicalContext.date}, you mentioned: “${historicalContext.quote}”` : '', bot.response]
          .filter(Boolean).join('\n\n').slice(0, 12000),
      });
      if (assistantMessageError) throw assistantMessageError;
      if (historicalContext) {
        bot.response = `Earlier, on ${historicalContext.date}, you mentioned: “${historicalContext.quote}” Is this still relevant?\n\n${bot.response}`;
      }
      const { data: currentMemory, error: memoryReadError } = await req.supabase.from('memory_summaries')
        .select('historical_observations,confirmed_facts,source_message_ids')
        .eq('user_id', userId)
        .maybeSingle();
      if (memoryReadError) throw memoryReadError;
      const observations = [...(currentMemory?.historical_observations || []), message.trim().slice(0, 500)].slice(-20);
      const confirmedFacts = currentMemory?.confirmed_facts || [];
      const sourceMessageIds = [...(currentMemory?.source_message_ids || []), savedUserMessage.id].slice(-100);
      const { error: memoryWriteError } = await req.supabase.from('memory_summaries')
        .upsert({
          user_id: userId,
          confirmed_facts: confirmedFacts,
          historical_observations: observations,
          source_message_ids: sourceMessageIds,
          summary_text: [
            confirmedFacts.length ? `User-confirmed notes: ${confirmedFacts.join(' | ')}` : '',
            observations.length ? `Past user-reported statements (not independently verified): ${observations.join(' | ')}` : '',
          ].filter(Boolean).join('\n'),
        }, { onConflict: 'user_id' });
      if (memoryWriteError) throw memoryWriteError;
      const { error: updateError } = await req.supabase.from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('user_id', userId);
      if (updateError) throw updateError;
    } catch (error) {
      console.error('Conversation save failed:', error.message);
      persistenceWarning = true;
    }
  }

  return res.json({
    ok: true,
    language: languageMap[language] || language,
    response: bot.response,
    risk: bot.risk,
    score: bot.score,
    rating: bot.rating,
    problemType: bot.problemType,
    needsMoreQuestions: bot.needsMoreQuestions === true,
    followUpQuestion: bot.followUpQuestion,
    nextQuestion: bot.nextQuestion,
    indicators: bot.indicators,
    facts: bot.facts,
    nlp: bot.nlp,
    contextQuestions: bot.contextQuestions || [],
    screeningQuestions: bot.screeningQuestions || [],
    summary: bot.summary,
    recommendations: bot.recommendations || getRecommendations(bot.risk || 'LOW'),
    supportLinks: bot.supportLinks || getSupportLinks(bot.risk || 'LOW'),
    legalFrameworks: bot.legalFrameworks || [],
    awaitingScreening: bot.awaitingScreening === true,
    chatbotConversation: bot.chatbotConversation || [],
    conversationId,
    historySaved: memoryConsent && !persistenceWarning,
    persistenceWarning,
    mode: bot.mode || 'demo',
  });
});

router.post('/assessment/screening', authWhenConfigured, async (req, res) => {
  const { screeningAnswers = [], userId = 'guest', category = 'SC', language = 'en', incidentText = '', conversationText = '', chatbotConversation = [], problemType } = req.body || {};
  if (typeof incidentText !== 'string' || incidentText.length > 12000
    || typeof conversationText !== 'string' || conversationText.length > 12000
    || !Array.isArray(screeningAnswers) || screeningAnswers.length !== 10) {
    return res.status(400).json({ ok: false, message: 'Assessment responses are invalid or too long.' });
  }
  const authenticatedUserId = req.authUser?.id || userId;
  const result = buildSVIAssessment({
    userId: authenticatedUserId,
    category,
    language,
    conversationText: incidentText,
    questionContextText: conversationText,
    problemType,
    chatbotConversation,
    screeningAnswers,
  });
  if (!result.ok) return res.status(400).json(result);
  let historySaved = false;
  let persistenceWarning = false;
  if (req.authUser) {
    try {
      if (await requireMemoryConsent(req.supabase, authenticatedUserId)) {
        const assessment = result.assessment;
        const { data: concern, error: concernError } = await req.supabase.from('user_concerns')
          .upsert({
            user_id: authenticatedUserId,
            concern_category: String(assessment.problemType || 'General support').slice(0, 100),
            initial_description: String(incidentText || '').slice(0, 2000),
            current_status: 'Active',
          }, { onConflict: 'user_id,concern_category' })
          .select('id')
          .single();
        if (concernError) throw concernError;

        const { data: savedAssessment, error: assessmentError } = await req.supabase.from('daily_assessments')
          .insert({
            user_id: authenticatedUserId,
            concern_category: String(assessment.problemType || 'General support').slice(0, 100),
            stress_score: Number.isFinite(assessment.screeningScore) ? assessment.screeningScore : null,
            screening_band: String(assessment.screeningBand || ''),
            assessment_type: 'svi_experimental_v1',
            scale_definition: 'Experimental condition-specific 10-item screening, score 10-50; higher indicates more frequent reported impact. Not validated and not the K10.',
            user_reported_observations: incidentText ? [String(incidentText).slice(0, 2000)] : [],
          })
          .select('id,assessed_at,stress_score,assessment_type,scale_definition,concern_category')
          .single();
        if (assessmentError) throw assessmentError;

        const { data: priorAssessments, error: priorError } = await req.supabase.from('daily_assessments')
          .select('id,assessed_at,stress_score,assessment_type,scale_definition,concern_category')
          .eq('user_id', authenticatedUserId)
          .order('assessed_at', { ascending: false })
          .limit(20);
        if (priorError) throw priorError;
        const prior = (priorAssessments || []).filter((item) => item.id !== savedAssessment.id
          && item.assessment_type === savedAssessment.assessment_type
          && item.scale_definition === savedAssessment.scale_definition
          && item.concern_category === assessment.problemType);
        if (prior.length) {
          const previous = prior.sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at))[0];
          const comparison = compareAssessmentScores([previous, savedAssessment]);
          const { error: progressError } = await req.supabase.from('progress_history').insert({
            user_id: authenticatedUserId,
            concern_id: concern.id,
            previous_assessment_id: previous.id,
            current_assessment_id: savedAssessment.id,
            score_difference: comparison.difference,
            trend: comparison.trend,
            supporting_evidence: comparison.evidence,
          });
          if (progressError) throw progressError;
          if (['Improving', 'Worsening', 'Stable'].includes(comparison.trend)) {
            const { error: statusError } = await req.supabase.from('user_concerns')
              .update({ current_status: comparison.trend })
              .eq('id', concern.id)
              .eq('user_id', authenticatedUserId);
            if (statusError) throw statusError;
          }
        }

        const { data: previousRecommendations, error: previousRecommendationsError } = await req.supabase.from('recommendations')
          .select('recommendation_text,user_feedback')
          .eq('user_id', authenticatedUserId)
          .eq('concern_id', concern.id)
          .not('user_feedback', 'is', null)
          .limit(100);
        if (previousRecommendationsError) throw previousRecommendationsError;
        const notHelpful = new Set((previousRecommendations || [])
          .filter((item) => item.user_feedback === 'Not helpful')
          .map((item) => item.recommendation_text));
        const recommendations = (assessment.recommendations || [])
          .filter((item) => typeof item === 'string' && !notHelpful.has(item))
          .slice(0, 12);
        if (recommendations.length) {
          const { error: recommendationError } = await req.supabase.from('recommendations').insert(
            recommendations.map((text) => ({
              user_id: authenticatedUserId,
              concern_id: concern.id,
              recommendation_text: text.slice(0, 2000),
              recommendation_category: 'Assessment support',
            })),
          );
          if (recommendationError) throw recommendationError;
        }
        historySaved = true;
      }
    } catch (error) {
      console.error('Assessment persistence failed:', error.message);
      persistenceWarning = true;
    }
  }
  return res.json({
    ok: true,
    ...result.assessment,
    assessment: result.assessment,
    questions: result.assessment.screeningQuestions,
    historySaved,
    persistenceWarning,
  });
});

router.post('/assessment/final', (req, res) => {
  const assessment = generateAssessment(req.body || {});
  return res.json({ ok: true, assessment, mode: 'demo' });
});

router.get('/history', authWhenConfigured, async (req, res) => {
  if (req.authUser) {
    try {
      if (!await requireMemoryConsent(req.supabase, req.authUser.id)) return res.json({ ok: true, data: [] });
      const { data, error } = await req.supabase.from('daily_assessments')
        .select('*')
        .eq('user_id', req.authUser.id)
        .order('assessed_at', { ascending: false });
      if (error) throw error;
      return res.json({ ok: true, data: (data || []).map((entry) => ({
        ...entry,
        id: entry.id,
        date: entry.assessed_at,
        screeningScore: entry.stress_score,
        problemType: entry.concern_category || entry.assessment_type,
        screeningBand: entry.screening_band || '',
      })) });
    } catch (error) {
      console.error('Assessment history retrieval failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Unable to load your history.' });
    }
  }
  const { userId } = req.query;
  const items = userId ? getHistoryByUser(userId) : [];
  return res.json({ ok: true, data: items });
});

router.delete('/history/:id', authWhenConfigured, async (req, res) => {
  if (req.authUser) {
    try {
      const { error, count } = await req.supabase.from('daily_assessments')
        .delete({ count: 'exact' })
        .eq('id', req.params.id)
        .eq('user_id', req.authUser.id);
      if (error) throw error;
      if (!count) return res.status(404).json({ ok: false, message: 'Assessment not found.' });
      return res.json({ ok: true });
    } catch (error) {
      console.error('Assessment deletion failed:', error.message);
      return res.status(500).json({ ok: false, message: 'Unable to delete this assessment.' });
    }
  }
  const result = deleteAssessment(req.params.id);
  if (!result.ok) return res.status(404).json(result);
  return res.json(result);
});

router.post('/conversations', authenticateRequest, async (req, res) => {
  if (!requireSupabase(res)) return;
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) {
      return res.status(403).json({ ok: false, message: 'Enable saved conversation memory in privacy settings before saving chats.' });
    }
    const { data, error } = await req.supabase.from('conversations')
      .insert({ user_id: req.authUser.id, title: title || 'Support conversation' })
      .select('id,title,started_at,updated_at')
      .single();
    if (error) throw error;
    return res.status(201).json({ ok: true, conversation: data });
  } catch (error) {
    console.error('Conversation creation failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to create a conversation.' });
  }
});

router.get('/conversations', authenticateRequest, async (req, res) => {
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) return res.json({ ok: true, data: [] });
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100).replace(/[%_]/g, '') : '';
    let query = req.supabase.from('conversations')
      .select('id,title,started_at,updated_at')
      .eq('user_id', req.authUser.id)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (search) query = query.ilike('title', `%${search}%`);
    const { data, error } = await query;
    if (error) throw error;
    let conversations = data || [];
    if (search) {
      const { data: matchingMessages, error: searchError } = await req.supabase.from('messages')
        .select('conversation_id')
        .eq('user_id', req.authUser.id)
        .ilike('content', `%${search}%`)
        .limit(100);
      if (searchError) throw searchError;
      const conversationIds = [...new Set((matchingMessages || []).map((item) => item.conversation_id))];
      const knownIds = new Set(conversations.map((item) => item.id));
      const missingIds = conversationIds.filter((id) => !knownIds.has(id));
      if (missingIds.length) {
        const { data: messageConversations, error: conversationError } = await req.supabase.from('conversations')
          .select('id,title,started_at,updated_at')
          .eq('user_id', req.authUser.id)
          .in('id', missingIds);
        if (conversationError) throw conversationError;
        conversations = [...conversations, ...(messageConversations || [])]
          .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
          .slice(0, 100);
      }
    }
    return res.json({ ok: true, data: conversations });
  } catch (error) {
    console.error('Conversation list failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to load conversations.' });
  }
});

router.get('/conversations/:id/messages', authenticateRequest, async (req, res) => {
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) {
      return res.status(403).json({ ok: false, message: 'Saved conversation memory is disabled.' });
    }
    const { data, error } = await req.supabase.from('messages')
      .select('id,role,content,created_at')
      .eq('conversation_id', req.params.id)
      .eq('user_id', req.authUser.id)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    if (!data?.length) {
      const { data: conversation, error: conversationError } = await req.supabase.from('conversations')
        .select('id')
        .eq('id', req.params.id)
        .eq('user_id', req.authUser.id)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation) return res.status(404).json({ ok: false, message: 'Conversation not found.' });
    }
    return res.json({ ok: true, data });
  } catch (error) {
    console.error('Conversation messages retrieval failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to load this conversation.' });
  }
});

router.delete('/conversations/:id', authenticateRequest, async (req, res) => {
  try {
    const { error, count } = await req.supabase.from('conversations')
      .delete({ count: 'exact' })
      .eq('id', req.params.id)
      .eq('user_id', req.authUser.id);
    if (error) throw error;
    if (!count) return res.status(404).json({ ok: false, message: 'Conversation not found.' });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Conversation deletion failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to delete this conversation.' });
  }
});

router.delete('/user/history', authenticateRequest, async (req, res) => {
  try {
    await deleteAllUserData(req.supabase, req.authUser.id);
    const { error: profileError } = await req.supabase.from('user_profiles')
      .update({ background: null, support_goals: [], preferences: {} })
      .eq('user_id', req.authUser.id);
    if (profileError) throw profileError;
    return res.json({ ok: true });
  } catch (error) {
    console.error('User history deletion failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to delete all saved history.' });
  }
});

router.get('/user/export', authenticateRequest, async (req, res) => {
  try {
    const tables = ['user_profiles', 'conversations', 'messages', 'daily_assessments', 'user_concerns', 'progress_history', 'recommendations', 'memory_summaries'];
    const entries = await Promise.all(tables.map(async (table) => {
      const { data, error } = await req.supabase.from(table).select('*').eq('user_id', req.authUser.id);
      if (error) throw error;
      return [table, data || []];
    }));
    return res.json({ ok: true, exportedAt: new Date().toISOString(), data: Object.fromEntries(entries) });
  } catch (error) {
    console.error('User export failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to export your data.' });
  }
});

router.get('/user/assessments', authenticateRequest, async (req, res) => {
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) return res.json({ ok: true, data: [] });
    const { data, error } = await req.supabase.from('daily_assessments')
      .select('id,assessed_at,stress_score,mood_score,assessment_type,scale_definition,concern_category,user_reported_observations')
      .eq('user_id', req.authUser.id)
      .order('assessed_at', { ascending: true })
      .limit(365);
    if (error) throw error;
    return res.json({ ok: true, data });
  } catch (error) {
    console.error('Assessment retrieval failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to load assessments.' });
  }
});

router.post('/user/assessments', authenticateRequest, async (req, res) => {
  const body = req.body || {};
  if (body.assessmentType !== 'user_reported'
    || !Number.isInteger(body.moodScore)
    || body.moodScore < 0
    || body.moodScore > 100
    || (body.stressScore !== null && body.stressScore !== undefined)) {
    return res.status(400).json({ ok: false, message: 'Only a user-reported mood check-in can be recorded through this endpoint.' });
  }
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) {
      return res.status(403).json({ ok: false, message: 'Enable saved memory before saving assessments.' });
    }
  } catch (error) {
    console.error('Assessment consent check failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to verify your privacy settings.' });
  }
  try {
    const { data, error } = await req.supabase.from('daily_assessments')
      .insert({
        user_id: req.authUser.id,
        assessment_type: 'user_reported',
        scale_definition: 'User-reported mood rating 0-100; higher means the user reports a more positive mood. Not a clinical measure.',
        stress_score: null,
        mood_score: body.moodScore,
        user_reported_observations: Array.isArray(body.observations)
          ? body.observations.filter((item) => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 1000))
          : [],
      })
      .select('id,assessed_at,stress_score,mood_score,assessment_type,scale_definition')
      .single();
    if (error) throw error;
    return res.status(201).json({ ok: true, assessment: data });
  } catch (error) {
    console.error('Assessment save failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to save this assessment.' });
  }
});

router.get('/user/progress', authenticateRequest, async (req, res) => {
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) {
      return res.json({
        ok: true,
        assessments: [],
        trend: { trend: 'Insufficient data', difference: null, evidence: [] },
        k10Comparison: compareK10History([]),
        k10Recommendations: ['Enable saved memory to store and compare K10 reports.'],
        k10SupportLinks: getSupportLinks('LOW', 'mental health distress'),
        weeklySummary: 'Insufficient data; saved memory is disabled.',
        monthlySummary: 'Insufficient data; saved memory is disabled.',
        concerns: [],
        empty: true,
      });
    }
    const { data: assessments, error } = await req.supabase.from('daily_assessments')
      .select('id,assessed_at,stress_score,mood_score,assessment_type,scale_definition,concern_category,user_reported_observations')
      .eq('user_id', req.authUser.id)
      .order('assessed_at', { ascending: true })
      .limit(365);
    if (error) throw error;
    const data = assessments || [];
    const k10History = data.filter((item) => item.assessment_type === K10_ASSESSMENT_TYPE);
    const k10Comparison = compareK10History(k10History);
    const comparableGroups = new Map();
    data.filter((item) => Number.isFinite(item.stress_score)).forEach((item) => {
      const key = getAssessmentGroupKey(item);
      const group = comparableGroups.get(key) || [];
      group.push(item);
      comparableGroups.set(key, group);
    });
    const largestGroup = [...comparableGroups.values()].sort((a, b) => b.length - a.length)[0] || [];
    const comparison = largestGroup[0]?.assessment_type === K10_ASSESSMENT_TYPE
      ? compareK10History(largestGroup)
      : compareAssessmentScores(largestGroup);
    const assessmentComparisons = [...comparableGroups.values()].map((group) => {
      const ordered = [...group].sort((a, b) => new Date(a.assessed_at) - new Date(b.assessed_at));
      const assessmentType = ordered[0].assessment_type;
      const groupComparison = assessmentType === K10_ASSESSMENT_TYPE
        ? compareK10History(ordered)
        : compareAssessmentScores(ordered);
      return {
        assessmentType,
        concernCategory: ordered[ordered.length - 1].concern_category,
        count: ordered.length,
        trend: groupComparison.trend,
        difference: groupComparison.difference,
        first: ordered[0],
        latest: ordered[ordered.length - 1],
        recommendations: getComparisonRecommendations(groupComparison, assessmentType),
      };
    }).sort((a, b) => new Date(b.latest.assessed_at) - new Date(a.latest.assessed_at));
    const latestPair = largestGroup.slice(-2);
    let possibleFactor = null;
    if (latestPair.length === 2) {
      const factor = detectReportedFactor(latestPair);
      const currentAssessment = latestPair[1];
      const { data: progressEntry, error: progressError } = await req.supabase.from('progress_history')
        .select('id,user_feedback')
        .eq('user_id', req.authUser.id)
        .eq('current_assessment_id', currentAssessment.id)
        .order('compared_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (progressError) throw progressError;
      possibleFactor = {
        progressId: progressEntry?.id || null,
        factor,
        feedback: progressEntry?.user_feedback || null,
        message: factor
          ? `You mentioned ${factor} in your recent reports. It may be relevant to the change, but these reports do not establish a cause. Does this interpretation fit?`
          : 'There is not enough information in your recent reports to identify a possible contributing factor.',
      };
    }
    const latestDate = data.length ? new Date(data[data.length - 1].assessed_at) : null;
    const weekly = latestDate ? data.filter((item) => new Date(item.assessed_at) >= new Date(latestDate.getTime() - 7 * 86400000)) : [];
    const monthly = latestDate ? data.filter((item) => new Date(item.assessed_at) >= new Date(latestDate.getTime() - 30 * 86400000)) : [];
    const summaryFor = (items) => {
      const groups = new Map();
      items.filter((item) => Number.isFinite(item.stress_score)).forEach((item) => {
        const key = getAssessmentGroupKey(item);
        const group = groups.get(key) || [];
        group.push(item);
        groups.set(key, group);
      });
      const group = [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
      return group.length < 2
        ? 'Insufficient comparable assessment data for a trend.'
        : `${group.length} comparable assessments recorded. ${(group[0].assessment_type === K10_ASSESSMENT_TYPE ? compareK10History(group) : compareAssessmentScores(group)).trend}; higher scores indicate more reported distress or impact on that scale.`;
    };
    const { data: concerns, error: concernsError } = await req.supabase.from('user_concerns')
      .select('id,concern_category,current_status,first_reported_at,last_updated_at')
      .eq('user_id', req.authUser.id)
      .order('last_updated_at', { ascending: false });
    if (concernsError) throw concernsError;
    return res.json({
      ok: true,
      assessments: data,
      trend: comparison,
      assessmentComparisons,
      k10Comparison,
      k10Recommendations: getK10HistoryRecommendations(k10Comparison),
      k10SupportLinks: getSupportLinks('LOW', 'mental health distress'),
      possibleFactor,
      weeklySummary: summaryFor(weekly),
      monthlySummary: summaryFor(monthly),
      concerns: concerns || [],
      empty: data.length === 0,
    });
  } catch (error) {
    console.error('Progress retrieval failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to calculate progress.' });
  }
});

router.post('/user/progress/feedback', authenticateRequest, async (req, res) => {
  const { progressId, feedback } = req.body || {};
  if (typeof progressId !== 'string' || !['Accurate', 'Not accurate'].includes(feedback)) {
    return res.status(400).json({ ok: false, message: 'Choose whether the possible-factor interpretation is accurate.' });
  }
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) {
      return res.status(403).json({ ok: false, message: 'Enable saved memory before saving progress feedback.' });
    }
    const { data, error } = await req.supabase.from('progress_history')
      .update({ user_feedback: feedback, user_feedback_at: new Date().toISOString() })
      .eq('id', progressId)
      .eq('user_id', req.authUser.id)
      .select('id,user_feedback')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, message: 'Progress comparison not found.' });
    return res.json({ ok: true, feedback: data.user_feedback });
  } catch (error) {
    console.error('Progress feedback update failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to save progress feedback.' });
  }
});

router.get('/user/recommendations', authenticateRequest, async (req, res) => {
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) return res.json({ ok: true, data: [] });
    const { data, error } = await req.supabase.from('recommendations')
      .select('id,concern_id,recommendation_text,recommendation_category,recommended_at,user_feedback,completion_status')
      .eq('user_id', req.authUser.id)
      .order('recommended_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return res.json({ ok: true, data });
  } catch (error) {
    console.error('Recommendation retrieval failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to load recommendations.' });
  }
});

router.post('/user/recommendations/feedback', authenticateRequest, async (req, res) => {
  const { id, feedback } = req.body || {};
  if (typeof id !== 'string' || !['Helpful', 'Not helpful', 'Not tried'].includes(feedback)) {
    return res.status(400).json({ ok: false, message: 'A recommendation and valid feedback are required.' });
  }
  try {
    if (!await requireMemoryConsent(req.supabase, req.authUser.id)) {
      return res.status(403).json({ ok: false, message: 'Enable saved memory before saving recommendation feedback.' });
    }
    const { data, error } = await req.supabase.from('recommendations')
      .update({ user_feedback: feedback })
      .eq('id', id)
      .eq('user_id', req.authUser.id)
      .select('id,user_feedback')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ ok: false, message: 'Recommendation not found.' });
    return res.json({ ok: true, recommendation: data });
  } catch (error) {
    console.error('Recommendation feedback update failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Unable to save recommendation feedback.' });
  }
});

router.get('/legal', (req, res) => {
  const text = req.query.text || 'Threats and intimidation';
  const category = req.query.category || 'SC';
  return res.json({ ok: true, frameworks: getLegalFrameworks(text, category) });
});

router.get('/helplines', (req, res) => {
  return res.json({
    ok: true,
    resource: {
      name: 'NHAA - National Helpline Against Atrocities',
      phone: '14566',
      alternate: '1800-202-1989',
      website: 'https://nhapoa.gov.in/',
      note: 'Use official Government of India information before deployment in a live production system.'
    },
    emergency: [
      { name: 'Emergency Services', value: '112' },
      { name: 'Women Helpline', value: '1091' },
      { name: 'Child Helpline', value: '1098' },
      { name: 'Mental Health Helpline', value: '14416' },
    ]
  });
});

module.exports = router;
