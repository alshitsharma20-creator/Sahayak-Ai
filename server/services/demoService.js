const { users, assessments, chatSessions } = require('../data/store');
const { analyzeNaturalLanguage, hasCasteRelatedTerms } = require('./nlpService');

const languageMap = {
  en: 'English',
  hi: 'Hindi',
  pa: 'Punjabi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  or: 'Odia',
  ur: 'Urdu',
};

function safeText(text = '') {
  return String(text).trim();
}

function createSession(userId) {
  const session = {
    id: `sess_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    summary: '',
  };
  chatSessions.push(session);
  return session;
}

function getChatSession(userId, category = 'SC') {
  const sessions = chatSessions.filter((entry) => entry.userId === userId);
  const activeSession = sessions.find((entry) => !entry.completed);
  if (activeSession) return activeSession;
  const session = createSession(userId);
  session.category = category;
  session.chatbotConversation = [];
  session.askedQuestions = [];
  session.lastQuestion = 'Would you like to tell me what has been happening?';
  return session;
}

function registerUser({ name, username, password, category = 'SC', language = 'en' }) {
  const trimmedName = safeText(name);
  const trimmedUsername = safeText(username);
  const trimmedPassword = safeText(password);

  if (!trimmedName || !trimmedUsername || !trimmedPassword) {
    return { ok: false, message: 'Name, username, and password are required.' };
  }

  const exists = users.some((user) => user.username.toLowerCase() === trimmedUsername.toLowerCase());
  if (exists) {
    return { ok: false, message: 'This username is already registered.' };
  }

  const user = {
    id: `user_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    name: trimmedName,
    username: trimmedUsername,
    passwordHash: Buffer.from(trimmedPassword).toString('base64'),
    category,
    preferredLanguage: language,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  return { ok: true, user: { id: user.id, name: user.name, username: user.username, category: user.category, preferredLanguage: user.preferredLanguage } };
}

function loginUser({ username, password }) {
  const trimmedUsername = safeText(username);
  const trimmedPassword = safeText(password);

  const demoUsername = 'demo';
  const demoPassword = 'demo';

  if (trimmedUsername.toLowerCase() === demoUsername && trimmedPassword === demoPassword) {
    const exists = users.some((entry) => entry.username.toLowerCase() === demoUsername);
    if (!exists) {
      users.push({
        id: 'demo_user',
        name: 'Demo User',
        username: demoUsername,
        passwordHash: Buffer.from(demoPassword).toString('base64'),
        category: 'SC',
        preferredLanguage: 'en',
        createdAt: new Date().toISOString(),
      });
    }
  }

  const user = users.find((entry) => entry.username.toLowerCase() === trimmedUsername.toLowerCase());
  if (!user) {
    return { ok: false, message: 'No account found for this username.' };
  }

  const providedHash = Buffer.from(trimmedPassword).toString('base64');
  if (user.passwordHash !== providedHash) {
    return { ok: false, message: 'Incorrect password.' };
  }

  return {
    ok: true,
    user: { id: user.id, name: user.name, username: user.username, category: user.category, preferredLanguage: user.preferredLanguage },
  };
}

function getUserProfile(username) {
  const user = users.find((entry) => entry.username.toLowerCase() === String(username).toLowerCase());
  if (!user) return { ok: false, message: 'User not found.' };
  return { ok: true, user: { id: user.id, name: user.name, username: user.username, category: user.category, preferredLanguage: user.preferredLanguage } };
}

const conditionScreeningQuestions = {
  Anxiety: [
    'How often has worry about {topic} been hard to set aside?',
    'How often have you felt tense when dealing with {topic}?',
    'How often has anxiety made it difficult to focus on what you needed to do?',
    'How often have you avoided a situation because you expected to feel anxious?',
    'How often has worry affected your sleep or rest?',
    'How often have physical signs of anxiety, such as a racing heart, made daily tasks harder?',
    'How often have anxious thoughts returned even after you tried to reassure yourself?',
    'How often has anxiety affected your ability to finish usual responsibilities?',
    'How often have you been unable to calm yourself when anxiety increased?',
    'How often have you lacked someone supportive to talk with when you felt anxious?',
  ],
  Depression: [
    'How often has low mood made it harder to manage your usual day?',
    'How often have activities that matter to you felt less enjoyable?',
    'How often has low energy made it difficult to start or finish tasks?',
    'How often have you felt disconnected from people you care about?',
    'How often has it been difficult to imagine something you can look forward to?',
    'How often have changes in mood affected your sleep or daily routine?',
    'How often have you found it difficult to ask someone for support?',
    'How often have you been unable to do something that helps you feel supported?',
    'How often have your responsibilities felt harder because of how you have been feeling?',
    'How often have you felt misunderstood by people you trust?',
  ],
  Stress: [
    'How often has pressure related to {topic} felt difficult to manage?',
    'How often have these demands made it hard to take a break?',
    'How often has stress affected your concentration on important tasks?',
    'How often has pressure interfered with your sleep or rest?',
    'How often have you felt there was too much to handle at once?',
    'How often has stress affected your relationships or communication with others?',
    'How often have you been unable to identify one manageable next step?',
    'How often have you lacked enough support or resources to handle these demands?',
    'How often has stress made your usual responsibilities harder?',
    'How often have you lacked time to do something restorative for yourself?',
  ],
  Trauma: [
    'How often have reminders of this experience felt difficult to manage?',
    'How often have you felt on edge in situations that remind you of what happened?',
    'How often have you avoided places or activities because they bring up difficult memories?',
    'How often have memories of the experience interrupted your sleep or routine?',
    'How often has what happened affected your sense of trust or connection with others?',
    'How often have you felt unable to choose what you share and when you share it?',
    'How often have you lacked access to a person or place where you feel supported?',
    'How often have the effects of the experience made daily tasks harder?',
    'How often have you been unable to use something that helps you feel grounded?',
    'How often have you felt pressured or unheard when discussing this experience?',
  ],
  'Safety risk': [
    'How often have you felt unsafe in connection with {topic}?',
    'How often have you worried that someone may threaten or harm you again?',
    'How often have safety concerns changed where you go or what you do?',
    'How often have you been unable to reach a place where you feel safer?',
    'How often have you lacked a trusted person to contact about safety?',
    'How often have you worried about retaliation for speaking up or seeking help?',
    'How often have safety concerns affected your sleep or concentration?',
    'How often have you been unsure what support option you could use next?',
    'How often have you felt pressured to handle a safety concern alone?',
    'How often have you lacked practical support for your immediate needs?',
  ],
  'Discrimination due to caste': [
    'How often has the caste-related situation affected your sense of safety or dignity?',
    'How often has it affected your access to education, work, housing, services, or public places?',
    'How often have you felt excluded, insulted, or treated unfairly in connection with caste?',
    'How often has this situation affected your sleep, concentration, or daily routine?',
    'How often have you worried about retaliation or further harm if you speak up?',
    'How often have you lacked a trusted person or service to help you consider your options?',
    'How often have you been unsure where to seek legal or practical information?',
    'How often has the situation affected your relationships or participation in your community?',
    'How often have you felt pressured to handle this situation alone?',
    'How often have you been unable to access support that felt safe and appropriate?',
  ],
  'General support': [
    'How often has the situation you described made daily life harder?',
    'How often have you felt unsure about what step to take next?',
    'How often has the situation affected your sleep, focus, or routine?',
    'How often have you lacked someone you trust to discuss this with?',
    'How often have you felt that your concerns were not taken seriously?',
    'How often have you been unable to get the information or help you needed?',
    'How often have you felt unable to make choices about the support you receive?',
    'How often has the situation affected your relationships or responsibilities?',
    'How often have you been unable to find a practical step that helped, even a little?',
    'How often have you felt hopeless about getting useful support?',
  ],
};

function getConditionScreeningQuestions(problemType = 'General support', conversationText = '') {
  const templates = conditionScreeningQuestions[problemType] || conditionScreeningQuestions['General support'];
  const text = String(conversationText || '');
  const safetyTopic = problemType === 'Safety risk'
    ? /(threat|intimidat)/i.test(text)
      ? 'the threats or intimidation'
      : /(violence|assault|attack|hit|hurt)/i.test(text)
        ? 'the violence or risk of harm'
        : /(retaliat|afraid|fear)/i.test(text)
          ? 'the fear of retaliation'
          : 'your safety concerns'
    : '';
  const topic = safetyTopic || getConversationTopic(text).replace(/^your |^the /i, '') || 'this situation';
  return templates.map((question) => question.replaceAll('{topic}', topic));
}

function calculateScreeningScore(answers = []) {
  const score = answers.reduce((total, value) => total + Number(value || 0), 0);
  return score;
}

function getScreeningBand(score) {
  if (score <= 19) return 'Lower reported impact';
  if (score <= 29) return 'Some reported impact';
  if (score <= 39) return 'Elevated reported impact';
  return 'High reported impact';
}

function normalizeScreeningScore(score) {
  return ((score - 10) / 40) * 100;
}

function clampScore(value) {
  return Math.round(Math.max(0, Math.min(100, Number(value) || 0)) * 100) / 100;
}

function calculateSVI(distressScore, traumaScore, vulnerabilityScore, functioningImpactScore, isolationScore) {
  const svi =
    0.30 * distressScore +
    0.30 * traumaScore +
    0.20 * vulnerabilityScore +
    0.10 * functioningImpactScore +
    0.10 * isolationScore;
  return Math.round(svi * 100) / 100;
}

function classifySVI(sviScore, immediateSafetyConcern) {
  if (immediateSafetyConcern) return 'CRITICAL';
  if (sviScore >= 75) return 'HIGH';
  if (sviScore >= 50) return 'MODERATE';
  if (sviScore >= 25) return 'MILD';
  return 'LOW';
}

function getSVIRecommendations(riskCategory, text = '') {
  const recommendations = [];
  const normalizedText = String(text).toLowerCase();
  const immediateThreat = /(immediate danger|danger now|in danger|being attacked|threatened right now|someone is coming)/.test(normalizedText);
  const violence = /(hit|beat|slap|punch|assault|injur|violence|hurt|attack)/.test(normalizedText);
  const casteConcern = hasCasteRelatedTerms(normalizedText);
  const rightsConcern = /(discriminat|harass|humiliat|excluded|boycott|denied|refus|threat|violence|assault|abuse|forced|insult|intimidat|casteist|caste slur|abusive language|complaint|police|legal|rights)/.test(normalizedText);
  const mentalHealthConcern = /(anxious|anxiety|panic|depress|hopeless|trauma|distress|stress|sleep|suicid|self.harm|overwhelm)/.test(normalizedText);

  if (immediateThreat || (riskCategory === 'CRITICAL' && violence)) {
    recommendations.push('If you are in immediate danger, move to a safer place if possible and call 112 or contact someone you trust.');
  }
  if (casteConcern && rightsConcern) {
    recommendations.push('Write down dates, locations, exact words or actions, witnesses, and any complaint reference. Keep messages or other records only if it is safe.');
  }
  if (casteConcern) {
    recommendations.push('For a caste-related concern, NALSA and the appropriate commission can explain support and complaint options. The SC/ST (Prevention of Atrocities) Act applies only when the affected person and conduct meet its legal requirements; a caste-related term alone does not establish eligibility or an offence.');
    if (rightsConcern) {
      recommendations.push('If the conduct involves threats, assault, or another offence, ask a lawyer or police about protections under general criminal law, which are not limited to one caste.');
    }
  } else if (rightsConcern) {
    recommendations.push('Keep a factual record of what happened, when, where, who was involved, witnesses, and any complaint or response. Preserve relevant messages or documents if safe.');
    recommendations.push('For discrimination, threats, violence, or denial of rights, consider legal advice or a complaint to the authority with jurisdiction. The applicable law depends on the conduct and evidence.');
  }
  if (mentalHealthConcern) {
    recommendations.push('If distress is affecting daily life, consider speaking with a qualified mental-health professional or Tele-MANAS. You can also choose a trusted person to accompany you when seeking help.');
  }
  if (riskCategory === 'HIGH' || riskCategory === 'CRITICAL') {
    recommendations.push('Consider contacting a trusted person and planning a safe next step. Do not confront anyone or collect evidence if that could put you at risk.');
  } else if (!recommendations.length) {
    recommendations.push('Consider what kind of support would feel useful, and speak with someone you trust if the situation continues or becomes harder to manage.');
  }
  return recommendations;
}

function analyzeConversationIndicators(conversationText = '') {
  const text = String(conversationText || '').toLowerCase();
  const countMatches = (patterns) => patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
  const intensity = (count) => clampScore(Math.min(100, count * 28));
  const immediateSafetyConcern = /(immediate danger|danger now|someone is coming|need help now|i am in danger|can't leave|being attacked|threatened right now)/.test(text)
    && !/(not in danger|not unsafe|do not feel unsafe|don't feel unsafe|feel safe)/.test(text);

  const fearCount = countMatches([/fear|afraid|scared|panic|threat|unsafe|retaliat/]);
  const traumaCount = countMatches([/violence|assault|abuse|trauma|traumatic|hurt|attack|humiliat|sexual/]);
  const vulnerabilityCount = countMatches([/caste|scheduled caste|scheduled tribe|discriminat|harass|forced|displaced|denied|property|complaint/]);
  const isolationCount = countMatches([/alone|isolat|boycott|excluded|no one|nobody|unsupported|no support|cut off/]);
  const functioningCount = countMatches([/sleep|work|study|concentrat|daily|relationship|family|unable|can't|cannot|not functioning/]);

  return {
    fearScore: intensity(fearCount),
    traumaScore: intensity(traumaCount),
    vulnerabilityScore: intensity(vulnerabilityCount),
    isolationScore: intensity(isolationCount),
    functioningImpactScore: intensity(functioningCount),
    immediateSafetyConcern,
  };
}

function buildSVIAssessment({ userId = 'guest', category = 'SC', language = 'en', chatbotConversation = [], conversationText = '', questionContextText = '', problemType: identifiedProblemType, screeningAnswers = [] } = {}) {
  const answers = Array.from({ length: 10 }, (_, index) => Number(screeningAnswers[index] || 0));
  const screeningScore = calculateScreeningScore(answers);
  if (answers.some((answer) => answer < 1 || answer > 5) || screeningScore < 10 || screeningScore > 50) {
    return { ok: false, message: 'Answer all 10 condition-specific questions using a value from 1 to 5.' };
  }

  const indicators = analyzeConversationIndicators(conversationText);
  const distressScore = clampScore(normalizeScreeningScore(screeningScore));
  const screeningBand = getScreeningBand(screeningScore);
  const screeningRecommendations = screeningScore >= 30
    ? ['Your responses suggest that this situation is having a substantial impact. Consider speaking with a qualified support professional or someone you trust.']
    : screeningScore >= 22
      ? ['Your responses suggest that this situation may be affecting you. Consider discussing practical support options with someone you trust.']
      : [];
  const sviScore = calculateSVI(
    distressScore,
    indicators.traumaScore,
    indicators.vulnerabilityScore,
    indicators.functioningImpactScore,
    indicators.isolationScore,
  );
  const sviBand = classifySVI(sviScore, indicators.immediateSafetyConcern);
  let riskCategory = sviBand;
  const recommendations = [...new Set([
    ...getSVIRecommendations(riskCategory, conversationText),
    ...screeningRecommendations,
  ])];
  const supportedProblemTypes = ['Safety risk', 'Discrimination due to caste', 'Trauma', 'Anxiety', 'Depression', 'Stress', 'General support'];
  const problemType = supportedProblemTypes.includes(identifiedProblemType)
    ? identifiedProblemType
    : detectProblemType(conversationText);
  const questions = getConditionScreeningQuestions(problemType, questionContextText || conversationText);
  const assessment = {
    id: `svi_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    userId,
    category,
    language,
    date: new Date().toISOString(),
    chatbotConversation,
    screeningAnswers: answers,
    screeningQuestions: questions,
    screeningScore,
    screeningBand,
    distressScore,
    traumaScore: indicators.traumaScore,
    vulnerabilityScore: indicators.vulnerabilityScore,
    functioningImpactScore: indicators.functioningImpactScore,
    isolationScore: indicators.isolationScore,
    fearScore: indicators.fearScore,
    immediateSafetyConcern: indicators.immediateSafetyConcern,
    problemType,
    nlp: { ...analyzeNaturalLanguage(conversationText), intent: problemType },
    contextQuestions: buildContextQuestions(conversationText, problemType),
    sviScore,
    sviBand,
    riskCategory,
    recommendations,
    legalFrameworks: getLegalFrameworks(conversationText, category),
    supportLinks: getSupportLinks(riskCategory, conversationText, category),
    explanation: 'This prototype combines responses to questions tailored to the concern with conversation-based indicators. The questions, scores, bands, and priority thresholds are experimental and unvalidated.',
    disclaimer: 'This is an experimental, unvalidated support screening—not the K10, a clinical assessment, or a diagnosis. The combined priority is a prototype heuristic, not a validated risk measure. Use results only as a prompt to discuss support needs.',
  };
  assessments.push(assessment);
  return { ok: true, assessment };
}

function classifySupport(level) {
  if (level >= 9) return 'CRITICAL';
  if (level >= 6) return 'HIGH';
  if (level >= 3) return 'MODERATE';
  return 'LOW';
}

function analyzeText(message = '') {
  const text = String(message || '').toLowerCase();
  const indicators = [];
  const facts = [];
  const nlp = analyzeNaturalLanguage(text);

  const keywordMap = {
    'threats': /threat|threatened|warned|intimidat|menace|danger/i,
    'physical violence': /hit|beat|slap|punch|assault|injur|violence|hurt/i,
    'harassment': /harass|abuse|bully|molest|taunt/i,
    'fear of retaliation': /afraid|fear|scared|retaliat|reporting|report me|wont report/i,
    'social boycott': /boycott|excluded|denied|not allowed|refused service|blocked|isolat/i,
    'displacement': /forced to leave|evicted|displaced|homeless|left home/i,
    'denial of rights or services': /denied|refuse|blocked service|not allowed to access|service denied/i,
    'anxiety or distress': /panic|anxious|distress|stress|confused|helpless|unsafe/i,
  };

  Object.entries(keywordMap).forEach(([label, regex]) => {
    if (regex.test(text)) {
      indicators.push(label);
    }
  });

  if (hasCasteRelatedTerms(text) && /(discriminat|harass|humiliat|exclu|boycott|denied|refus|insult|abuse|untouchability)/.test(text)) {
    indicators.push('caste-related discrimination');
  }

  if (/threat|intimidat|afraid|scared|fear|danger|retaliat/.test(text)) {
    facts.push('Threat / intimidation');
  }

  if (hasCasteRelatedTerms(text) && /(discriminat|harass|humiliat|exclu|boycott|denied|refus|insult|abuse|untouchability)/.test(text)) {
    facts.push('Possible caste-related discrimination');
  }

  if (/violence|hit|beat|injur|hurt|assault/.test(text)) {
    facts.push('Possible violence / assault');
  }

  if (!indicators.length && !facts.length) {
    indicators.push('General distress');
  }

  return { indicators: [...new Set(indicators)], facts: [...new Set(facts)], nlp };
}

function getLegalFrameworks(text = '', category = 'SC') {
  const normalizedText = String(text).toLowerCase();
  const frameworks = [];
  const casteRelatedConcern = hasCasteRelatedTerms(normalizedText);
  const untouchabilityConcern = /untouch|barred from (?:a )?(?:temple|public place|water source)|denied access to (?:a )?(?:temple|public place|water source)/.test(normalizedText);
  const discriminationConcern = /(discriminat|harass|humiliat|excluded|boycott|denied|refus|threat|violence|assault|abuse|forced|insult|intimidat|casteist|caste slur|abusive language)/.test(normalizedText);
  const generalOffenceConcern = /(threat|violence|assault|hit|beat|hurt|injur|intimidat|sexual|stalk|damage|destroy|attack|abuse)/.test(normalizedText);
  const legalConcern = discriminationConcern || /(legal|police|complaint|rights|denied|refus)/.test(normalizedText);

  if (casteRelatedConcern && discriminationConcern) {
    frameworks.push({
      law: 'Constitution of India: equality and anti-discrimination protections',
      relevance: 'Articles 14 and 15 protect equality and address specified forms of discrimination; Article 17 concerns untouchability. Their application depends on the facts, the parties, and the setting, and does not by itself establish a criminal offence.',
      action: 'Describe the specific conduct, setting, and people involved to a legal-services authority or lawyer, who can identify the provisions that apply.',
      source: 'India Code (official legislation database)',
      url: 'https://www.indiacode.nic.in/',
      disclaimer: 'General legal information only; applicability depends on the facts and current law.',
    });
  }

  if (casteRelatedConcern && untouchabilityConcern) {
    frameworks.push({
      law: 'Protection of Civil Rights Act, 1955 (possible relevance)',
      relevance: 'This Act may be relevant to conduct involving the practice of untouchability, subject to its statutory definitions and the facts.',
      action: 'Ask a lawyer or legal-services authority whether the described conduct falls within the Act and what complaint process is available.',
      source: 'India Code (official legislation database)',
      url: 'https://www.indiacode.nic.in/',
      disclaimer: 'Possible framework only; this is not a finding that an offence occurred.',
    });
  }

  if (casteRelatedConcern && discriminationConcern) {
    frameworks.push({
      law: 'SC/ST (Prevention of Atrocities) Act, 1989 (conditional)',
      relevance: 'This Act is specifically for members of Scheduled Castes and Scheduled Tribes. It may apply only where the affected person has the legally relevant SC/ST status and the conduct meets the elements of a listed offence and other statutory conditions, including any conditions concerning the alleged offender. Mentioning caste or selecting a profile category alone does not establish eligibility or an offence.',
      action: 'If the affected person is SC/ST, ask a lawyer or legal-services authority to assess the precise facts, eligibility, and reporting route. If not, other constitutional, criminal, civil, or employment protections may still apply.',
      source: 'India Code (official legislation database)',
      url: 'https://www.indiacode.nic.in/',
      disclaimer: 'Conditional legal information only; it is not a determination of caste status, guilt, or legal eligibility.',
    });
  }

  if (generalOffenceConcern) {
    frameworks.push({
      law: 'Bharatiya Nyaya Sanhita, 2023 and other applicable criminal law (possible relevance)',
      relevance: 'General criminal-law provisions may apply to conduct such as assault, criminal intimidation, stalking, or property damage, regardless of a person’s caste. The specific offence and applicable law depend on the facts and date of the conduct.',
      action: 'If there is immediate danger, contact emergency services. Otherwise, consider seeking legal advice or reporting the specific incident to the appropriate authority.',
      source: 'India Code (official legislation database)',
      url: 'https://www.indiacode.nic.in/',
      disclaimer: 'Possible legal framework only; facts and current law must be reviewed by a qualified professional.',
    });
  }

  if (!frameworks.length && legalConcern) {
    frameworks.push({
      law: 'Applicable civil, constitutional, service, or criminal protections',
      relevance: 'A legal remedy may be available depending on the nature of the incident, who was involved, and the setting.',
      action: 'Record the specific events and ask a lawyer or legal-services authority to identify the relevant law and complaint route.',
      source: 'India Code (official legislation database)',
      url: 'https://www.indiacode.nic.in/',
      disclaimer: 'General information only; this is not a legal determination.',
    });
  }

  return frameworks;
}

function generateAssessment(data) {
  const { screeningScore = 0, incidentText = '', indicators = [], dangerStatus = 'NO', category = 'SC', language = 'en' } = data;
  const textAnalysis = analyzeText(incidentText);
  const finalIndicators = Array.from(new Set([...indicators, ...textAnalysis.indicators]));
  const riskScore = Math.min(10, Math.max(0, Number(screeningScore || 0) / 10 + (dangerStatus === 'YES' ? 4 : 0) + Math.min(3, finalIndicators.length)));
  const supportLevel = classifySupport(riskScore >= 9 ? 9 : Math.round(riskScore));

  const assessment = {
    id: `assessment_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    userId: data.userId || 'guest',
    category,
    language,
    date: new Date().toISOString(),
    incidentSummary: incidentText || 'User provided a brief first-contact account.',
    possibleIndicators: finalIndicators,
    nlp: textAnalysis.nlp,
    screeningScore: Number(screeningScore || 0),
    safetyStatus: dangerStatus,
    overallSupportLevel: supportLevel,
    recommendations: getRecommendations(supportLevel, incidentText),
    legalFrameworks: getLegalFrameworks(incidentText, category),
    supportLinks: getSupportLinks(supportLevel, incidentText, category),
    voiceIndicator: data.voiceIndicator || 'Prototype voice distress indicator — not a clinical diagnosis.',
  };

  assessments.push(assessment);
  return assessment;
}

function getSupportLinks(level = 'LOW', text = '', category = '') {
  const normalizedText = String(text).toLowerCase();
  const links = [];
  const casteConcern = hasCasteRelatedTerms(normalizedText);
  const rightsConcern = /(discriminat|harass|humiliat|excluded|boycott|denied|refus|threat|violence|assault|abuse|forced|insult|intimidat|casteist|caste slur|abusive language|complaint|police|legal|rights)/.test(normalizedText);
  const violenceConcern = /(unsafe|danger|threat|violence|assault|hit|beat|hurt|injur|attack|stalk|abuse)/.test(normalizedText);
  const mentalHealthConcern = /(anxious|anxiety|panic|depress|hopeless|trauma|distress|stress|sleep|suicid|self.harm|overwhelm)/.test(normalizedText);
  const genderConcern = /(woman|women|girl|female|sexual|domestic violence|dowry|gender)/.test(normalizedText);

  const add = (label, url, detail, nextStep, source = label, sourceUrl = url) => {
    if (!links.some((link) => link.url === url)) {
      links.push({ label, url, detail, nextStep, source, sourceUrl });
    }
  };

  if (casteConcern) {
    add(
      'NALSA: free legal services and legal aid',
      'https://nalsa.gov.in/legal-aid/',
      'NALSA says people seeking free legal aid can approach the relevant Taluk, District, State, High Court, or Supreme Court Legal Services Authority. Applications can be made online or in person; there is no fee to obtain or submit an application. Eligibility and required documents depend on the legal-aid category and case.',
      'Use the official NALSA portal to find the appropriate authority or application route. Share incident details only through the official service.',
    );
    const mentionsSC = /\b(?:scheduled castes?|sc\s*(?:[/&-]\s*)?st|dalits?)\b/i.test(normalizedText);
    const mentionsST = /\b(?:scheduled tribes?|sc\s*(?:[/&-]\s*)?st)\b/i.test(normalizedText);
    const mentionsOBC = /\b(?:obcs?|backward classes?)\b/i.test(normalizedText);
    const mentionsSpecificCategory = mentionsSC || mentionsST || mentionsOBC;
    if (mentionsSC || (!mentionsSpecificCategory && category === 'SC')) {
      add(
        'National Commission for Scheduled Castes',
        'https://ncsc.nic.in/',
        'Official portal of the National Commission for Scheduled Castes. Its role concerns safeguards for Scheduled Castes; the portal is a starting point for official information.',
        'Review the Commission’s current complaint and contact instructions to check whether your matter falls within its remit.',
      );
    }
    if (mentionsST || (!mentionsSpecificCategory && category === 'ST')) {
      add(
        'National Commission for Scheduled Tribes',
        'https://ncst.gov.in/',
        'The Commission oversees safeguards for Scheduled Tribes under the Constitution, laws, and government orders.',
        'Review the Commission’s current complaint and contact instructions to check whether your matter falls within its remit.',
      );
    }
    if (mentionsOBC || (!mentionsSpecificCategory && (category === 'OBC' || category === 'BC'))) {
      add(
        'National Commission for Backward Classes',
        'https://ncbc.nic.in/',
        'Official portal of the National Commission for Backward Classes. The Commission’s remit is specific; not every individual or local dispute is within its jurisdiction.',
        'Check the Commission’s official mandate and current contact or grievance instructions before submitting a complaint.',
      );
    }
    add(
      'National Human Rights Commission',
      'https://nhrc.nic.in/',
      'Official National Human Rights Commission portal with information about its mandate and complaint process.',
      'Review the current complaint instructions and jurisdiction before filing; urgent danger should be handled through emergency services.',
    );
  } else if (rightsConcern) {
    add(
      'NALSA: free legal services and legal aid',
      'https://nalsa.gov.in/legal-aid/',
      'NALSA explains how to approach the appropriate Taluk, District, State, High Court, or Supreme Court Legal Services Authority. Applications can be made online or in person; there is no fee to obtain or submit an application. Eligibility depends on the applicable legal-aid category.',
      'Use the official NALSA portal to find the appropriate authority or application route. Share incident details only through the official service.',
    );
    add(
      'National Human Rights Commission',
      'https://nhrc.nic.in/',
      'Official National Human Rights Commission portal with information about its mandate and complaint process.',
      'Review the current complaint instructions and jurisdiction before filing; urgent danger should be handled through emergency services.',
    );
  }
  if (genderConcern && rightsConcern) {
    add(
      'National Commission for Women',
      'https://www.ncw.gov.in/',
      'Official National Commission for Women portal, relevant for information on women’s rights and the Commission’s complaint channels.',
      'Check the Commission’s current online complaint guidance and consider local emergency or legal support if there is immediate risk.',
    );
  }
  if (violenceConcern && (level === 'CRITICAL' || /(immediate danger|danger now|in danger|threatened right now|being attacked)/.test(normalizedText))) {
    add(
      'Emergency response: call 112',
      'tel:112',
      '112 is India’s emergency response number. Use it for an immediate threat to life or safety.',
      'Move to a safer place if possible and call 112. Do not delay emergency help to use a website.',
      'Emergency Response Support System',
      'https://112.gov.in/',
    );
    add(
      'Emergency Response Support System',
      'https://112.gov.in/',
      'Official portal for India’s Emergency Response Support System.',
      'Use the emergency number for immediate danger; use the portal for service information.',
    );
  }
  if (mentalHealthConcern) {
    add(
      'Tele-MANAS mental-health support',
      'https://telemanas.mohfw.gov.in/',
      'Government of India Tele-MANAS service information for mental-health support. The app does not diagnose; confirm current access and contact details on the official portal.',
      'If distress is affecting daily life, consider contacting Tele-MANAS or a qualified mental-health professional. In immediate danger, call 112.',
    );
  }
  return links;
}

function getRecommendations(level, text = '') {
  return getSVIRecommendations(level, text);
}

function getHistoryByUser(userId) {
  return assessments.filter((entry) => entry.userId === userId).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function deleteAssessment(id) {
  const index = assessments.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    assessments.splice(index, 1);
    return { ok: true };
  }
  return { ok: false, message: 'Assessment not found.' };
}

function getRiskRating(score) {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 35) return 'MODERATE';
  return 'LOW';
}

function getRequiredChatAnswers(text = '') {
  const lower = String(text).toLowerCase();
  const strongSignals = /(unsafe|threat|violence|abuse|panic|anxious|hopeless|depressed|trauma|suicid|danger)/.test(lower);
  const categorySignals = /(stress|pressure|sleep|fear|sad|worry|harass|discriminat|relationship|family|work|study)/.test(lower);
  if (strongSignals) return 6;
  if (categorySignals) return 8;
  return 9;
}

const conversationQuestions = [
  'Can you tell me what happened and what you are feeling right now?',
  'When did this start, and how often does it happen?',
  'How is it affecting your sleep, studies, work, or relationships?',
  'Do you feel unsafe, threatened, or afraid of retaliation?',
  'Are you noticing stress, panic, sadness, hopelessness, or trouble concentrating?',
];

const scstScreeningQuestions = [
  'Are you a member of a Scheduled Caste (SC) community?',
  'Are you a member of a Scheduled Tribe (ST) community?',
  'Were you assaulted because of your SC/ST identity?',
  'Has anyone physically attacked you while knowing that you belong to an SC/ST community?',
  'Has anyone threatened to harm you because of your caste or tribal identity?',
  'Has anyone intentionally insulted or humiliated you because of your SC/ST identity?',
  'Did the caste-based insult or humiliation happen in a place within public view?',
  'Has anyone used caste-based abusive language against you publicly?',
  'Have you experienced sexual harassment because of your SC/ST identity?',
  'Have you been sexually assaulted because of your SC/ST identity?',
  'Has an SC/ST woman been sexually assaulted or sexually humiliated because of her caste or tribal identity?',
  'Has anyone attempted to disrobe or sexually humiliate you because of your SC/ST identity?',
  'Have you experienced rape or sexual violence connected with your SC/ST identity?',
  'Has a group of people committed sexual violence against an SC/ST victim because of their identity?',
  'Has anyone touched or assaulted an SC/ST woman with sexual intent because of her identity?',
  'Have you been forcibly removed from your house, land, or property because you are SC/ST?',
  'Is someone trying to take possession of your land because of your SC/ST identity?',
  'Have you been prevented from entering or using a public place because you are SC/ST?',
  'Were you prevented from using a public road because of your caste or tribal identity?',
  'Were you prevented from using a public water source because of your caste?',
  'Were you denied access to a public temple or religious place because of your caste?',
  'Were you stopped from entering a public place because you are SC/ST?',
  'Were you denied service at a shop because of your caste?',
  'Were you refused accommodation because of your caste?',
  'Were you refused employment or work because of your caste in circumstances covered by the law?',
  'Has anyone socially boycotted you because of your SC/ST identity?',
  'Has your community been subjected to a social boycott because of caste?',
  'Has anyone prevented you from participating in a social or religious function because of caste?',
  'Has anyone stopped you from exercising a lawful right because you belong to an SC/ST community?',
  'Has anyone forced you to perform manual or degrading work because of your caste?',
  'Has anyone forced you to carry or dispose of human remains because of your caste?',
  'Have you been forced to eat or drink something against your will because of caste-based hostility?',
  'Has someone damaged your property because you belong to an SC/ST community?',
  'Has someone burned or destroyed your house or property because of your caste or tribal identity?',
  'Has someone threatened to force you or your family to leave your village because of caste?',
  'Have you or your family been forcibly displaced because of an atrocity against your SC/ST community?',
  'Has anyone prevented you from exercising a lawful democratic or voting right because of your caste?',
  'Have you been falsely implicated in a criminal case because you are SC/ST?',
  'Has anyone provided false information to authorities to cause harm to you because of caste?',
  'Has a person in authority deliberately failed to perform a legal duty relating to your SC/ST atrocity complaint?',
  'Did the police refuse to register or properly process your complaint concerning an SC/ST atrocity?',
  'Has your complaint been delayed despite you reporting an SC/ST atrocity?',
  'Have you been denied relief or rehabilitation after an SC/ST atrocity?',
  'Have you been threatened or intimidated after reporting an SC/ST atrocity?',
  'Has a witness in your SC/ST atrocity case been threatened or intimidated?',
  'Has anyone pressured you to withdraw your SC/ST atrocity complaint?',
  'Were you denied equal treatment because of the practice of untouchability?',
  'Has someone encouraged or justified the practice of untouchability against you?',
  'Has someone socially or professionally boycotted you because of untouchability?',
  'Has someone insulted or humiliated you specifically on the ground of untouchability because you are SC?',
];

function getRandomItems(items, count) {
  return [...items].sort(() => Math.random() - 0.5).slice(0, count);
}

function getQuestionSet(category) {
  if (category === 'SC' || category === 'ST') {
    return [conversationQuestions[0], conversationQuestions[1], ...getRandomItems(scstScreeningQuestions, 4)];
  }
  return [...conversationQuestions, conversationQuestions[0]].slice(0, 6);
}

const followUpQuestionsByType = {
  Stress: 'What is the main source of stress right now? Choose one: work/studies, family, money, relationships, or tell me in your own words.',
  Anxiety: 'Which anxiety pattern is strongest for you? Choose one: panic/fear, worry, sleep disruption, concentration trouble, or add your own details.',
  Depression: 'Which mood pattern is most common right now? Choose one: hopelessness, sadness, low energy, loss of interest, or add your own details.',
  Trauma: 'What happened that feels traumatic or upsetting? Choose one: violence, intimidation, humiliation, stalking, or tell me more in your own words.',
  'Safety risk': 'Are you feeling physically unsafe right now? Choose one: immediate danger, threats, being followed, violence, or write any detail you want to share.',
  'General support': 'What kind of information or support would be most helpful to you right now?',
};

function getConversationTopic(text = '') {
  const topics = [
    { pattern: /\b(caste|dalit|jaati|jati|untouchability|scheduled caste|scheduled tribe)\b/i, label: 'caste-related discrimination' },
    { pattern: /\b(exam|exams|study|studies|school|college|deadline|coursework)\b/i, label: 'your studies' },
    { pattern: /\b(work|workplace|job|boss|coworker|colleague|workload)\b/i, label: 'work' },
    { pattern: /\b(family|parent|mother|father|sibling|home)\b/i, label: 'your family or home situation' },
    { pattern: /\b(partner|relationship|marriage|spouse)\b/i, label: 'your relationship' },
    { pattern: /\b(money|financial|debt|rent|bills|income)\b/i, label: 'financial pressure' },
    { pattern: /\b(caste|tribe|discriminat|harass|boycott|excluded)\b/i, label: 'the discrimination or exclusion' },
    { pattern: /\b(sleep|insomnia|nightmare)\b/i, label: 'sleep' },
  ];
  return topics.find(({ pattern }) => pattern.test(text))?.label || '';
}

function buildContextQuestions(text = '', problemType = 'General support') {
  const topic = getConversationTopic(text);
  const focus = topic ? `around ${topic}` : 'in this situation';
  const topicFocus = topic ? `around ${topic}` : 'right now';
  const questionsByType = {
    'Safety risk': [
      `Would you like help with practical safety steps, legal information, or emotional support ${topicFocus}?`,
      'What would help you feel more in control of the next step?',
    ],
    'Discrimination due to caste': [
      'Would you like information about legal aid, an official complaint channel, or emotional support?',
      'What practical outcome or support would feel most helpful to you now?',
    ],
    Trauma: [
      `Are there particular situations connected with ${topic || 'this experience'} that you find difficult now?`,
      'What would help you feel more supported while managing reminders of the experience?',
    ],
    Anxiety: [
      `What situations ${focus} do you find yourself avoiding because of anxiety?`,
      'What would you like to feel more able to do despite the anxiety?',
    ],
    Depression: [
      `Which activities ${focus} feel harder to start or enjoy than they used to?`,
      'What small, manageable form of support could help you through the next week?',
    ],
    Stress: [
      `Which responsibility ${focus} would you most like to make easier first?`,
      'What boundary, resource, or adjustment could reduce the pressure?',
    ],
    'General support': [
      `What would a helpful outcome ${topicFocus} look like for you?`,
      'Is there a concern we have not discussed that should shape your next steps?',
    ],
  };
  return questionsByType[problemType] || questionsByType['General support'];
}

function getAdaptiveChatQuestion(text = '', problemType = 'General support', session = {}) {
  const topic = getConversationTopic(text);
  const focus = topic ? `, particularly around ${topic}` : '';
  const asked = new Set(session.askedQuestions || []);
  const hasTimeframe = /\b(since|for \d+|days?|weeks?|months?|years?|recently|every day|daily|ongoing|started|last week|last month)\b/i.test(text);
  const hasImpact = /\b(sleep|work|study|studies|relationship|daily|concentrat|appetite|routine|school|family|unable|can't|cannot|affected)\b/i.test(text);
  const hasSupport = /\b(trusted|support|help|counsel|therap|friend|family|reported|police|safe person)\b/i.test(text);
  const saysSafe = /\b(i am safe|i feel safe|safe right now|not in danger|not unsafe)\b/i.test(text);
  const candidates = [];

  if (hasExplicitSafetySignal(text) && !saysSafe) {
    candidates.push('Before we continue: are you safe right now, and can you move to a safer place or contact someone you trust?');
  }
  if (problemType === 'Anxiety') {
    candidates.push(`When do the anxious feelings tend to become strongest${focus}?`);
    candidates.push('How have the worry or anxious feelings affected your sleep or usual activities?');
    candidates.push('What helps you feel calmer or supported when the worry becomes difficult?');
  } else if (problemType === 'Depression') {
    candidates.push(`How have these feelings affected your daily activities or relationships${focus}?`);
    candidates.push('How long have you been feeling this way, and has it been changing over time?');
    candidates.push('Is there someone you trust whom you can talk with about how you have been feeling?');
  } else if (problemType === 'Trauma') {
    candidates.push(`What part of what happened is affecting you most now${focus}? Share only what feels comfortable.`);
    candidates.push('How has this affected your sense of safety or your day-to-day routine?');
    candidates.push('What kind of support would feel safe and helpful for you right now?');
  } else if (problemType === 'Safety risk') {
    candidates.push(`What happened most recently${focus}, and is the situation still ongoing?`);
    candidates.push('Has anyone you trust or an appropriate support service been told about this?');
    candidates.push('What would help you feel safer over the next day?');
  } else if (problemType === 'Discrimination due to caste') {
    candidates.push('What happened, and where did it take place? Share only the details you feel comfortable sharing.');
    candidates.push('Has this affected your access to a service, education, work, housing, or a public place?');
    candidates.push('Would you like help finding legal aid, an official complaint route, or emotional support?');
  } else if (problemType === 'Stress') {
    candidates.push(`What part of the pressure feels hardest to manage${topic ? ` around ${topic}` : ' right now'}?`);
    candidates.push('How long has this pressure been affecting you, and how is it changing your routine?');
    candidates.push('What practical support or change would make the next few days easier?');
  } else {
    candidates.push('What has been the most difficult part of this situation for you?');
    candidates.push('What kind of support or information are you hoping to get?');
  }

  const nextUnasked = candidates.find((question) => !asked.has(question) && (
    question.startsWith('Before we continue')
      || (!hasTimeframe && /how long|how often|changing over time|ongoing/.test(question.toLowerCase()))
      || (!hasImpact && /affect|affecting|routine|daily activities|part of the pressure|difficult part/.test(question.toLowerCase()))
      || (!hasSupport && /trusted|support|help|told about|hoping to get/.test(question.toLowerCase()))
      || /what happened most recently|what part of what happened|when do the anxious|what part of the pressure/.test(question.toLowerCase())
  ));
  if (nextUnasked) return nextUnasked;
  const unused = candidates.find((question) => !asked.has(question));
  if (unused) return unused;
  return buildContextQuestions(text, problemType)[0];
}

function detectProblemType(text = '') {
  const lower = String(text).toLowerCase();
  const saysSafe = /(not unsafe|do not feel unsafe|don't feel unsafe|feel safe|safe right now)/.test(lower);

  if (hasCasteRelatedTerms(lower)) return 'Discrimination due to caste';
  if (!saysSafe && hasExplicitSafetySignal(lower)) return 'Safety risk';
  return analyzeNaturalLanguage(text).intent;
}

function hasExplicitSafetySignal(text = '') {
  return /\b(threat(?:ened|s)?|unsafe|violence|abuse|retaliat\w*|forced|hurt|attack\w*|danger|being followed|stalked|stalking|afraid to go out|fear of retaliation)\b/i.test(text);
}

function deriveTextSupportScore(text = '') {
  const lower = String(text || '').toLowerCase();
  let score = 0;

  const k10Checks = [
    { pattern: /(panic|anxious|nervous|fear|overwhelmed)/, weight: 2 },
    { pattern: /(sad|hopeless|empty|worthless|depressed|low mood)/, weight: 2 },
    { pattern: /(stress|pressure|burnout|tension|too much)/, weight: 2 },
    { pattern: /(cannot sleep|sleep|insomnia)/, weight: 2 },
    { pattern: /(difficult to focus|cannot focus|concentrat)/, weight: 2 },
    { pattern: /(unsafe|afraid|threat|retaliat|danger|violence|hurt|attack|abuse)/, weight: 3 },
    { pattern: /(caste|discriminat|harass|excluded|humiliat)/, weight: 2 },
    { pattern: /(work|study|relationship|home|school|family)/, weight: 1 },
  ];

  k10Checks.forEach(({ pattern, weight }) => {
    if (pattern.test(lower)) score += weight;
  });

  if (/very|strong|severe|constant|all day|every day/.test(lower)) score += 2;
  if (/two weeks|month|months|long time|ongoing|for days|for weeks|for months/.test(lower)) score += 2;
  if (/cannot sleep|sleep poorly|sleep issues/.test(lower)) score += 2;

  return Math.min(40, Math.max(0, score));
}

function buildConversationAssessment(conversationText = '', category = 'SC', identifiedProblemType) {
  const text = String(conversationText || '').trim();
  const lower = text.toLowerCase();
  const problemType = identifiedProblemType || detectProblemType(text);
  const analysis = analyzeText(text);
  const textSupportScore = deriveTextSupportScore(text);

  let score = 20 + textSupportScore;
  if (/(panic|anxious|fear|nervous|restless)/.test(lower)) score += 8;
  if (/(sad|hopeless|empty|worthless|depressed|low mood)/.test(lower)) score += 8;
  if (/(stress|pressure|burnout|overloaded|overwhelmed)/.test(lower)) score += 7;
  if (/(threat|unsafe|afraid|violence|abuse|retaliat|hurt|attack|danger)/.test(lower)) score += 16;
  if (hasCasteRelatedTerms(lower) && /(discriminat|harass|humiliat|exclu|boycott|denied|refus|insult|abuse|untouchability)/.test(lower)) score += 8;
  if (analysis.indicators.length > 0) score += Math.min(18, analysis.indicators.length * 6);
  score = Math.min(100, score);

  const risk = getRiskRating(score);
  const recommendations = getRecommendations(risk, text);
  const supportLinks = getSupportLinks(risk, text, category);
  const legalFrameworks = getLegalFrameworks(text, category);
  const response = `Based on what you shared, the main concern appears to be ${problemType}. I will now ask condition-specific support screening questions. Their score is experimental and unvalidated, not the K10 or a diagnosis.`;

  return {
    response,
    risk,
    score,
    rating: risk,
    problemType,
    recommendations,
    supportLinks,
    legalFrameworks,
    indicators: analysis.indicators,
    facts: analysis.facts,
    nlp: { ...analysis.nlp, intent: problemType },
    contextQuestions: buildContextQuestions(text, problemType),
    summary: text,
    needsMoreQuestions: false,
  };
}

async function callGeminiForChat(message, state = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!apiKey) {
    return null;
  }

  try {
    const userCategory = state.category || 'SC';
    const prompt = `You are SahayakAI, a safe first-contact support assistant for vulnerable users in India. The user category is ${userCategory}. The user says: "${String(message || '').slice(0, 700)}". Determine if the situation suggests danger, threats, discrimination, violence, or mental distress. Return ONLY valid JSON with keys: response, risk, score, rating, nextQuestion, indicators, facts, summary. Use risk values: LOW, MODERATE, HIGH, CRITICAL. score should be a number from 0 to 100. indicators and facts must be arrays of strings. summary should be brief. Keep tone empathetic and practical.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'You are a calm, trauma-informed support assistant. Give structured output only.' }],
        },
        contents: [{
          role: 'user',
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 300,
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const candidateText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    if (!candidateText) {
      return null;
    }

    const cleaned = candidateText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    const responseText = String(parsed.response || '').trim() || 'I am here to help you understand the situation and find appropriate support.';
    const risk = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(String(parsed.risk || '').toUpperCase())
      ? String(parsed.risk).toUpperCase()
      : 'LOW';
    const score = Number(parsed.score || 0);
    const rating = String(parsed.rating || risk).toUpperCase();
    const recommendationList = getRecommendations(risk, message);
    const supportLinks = getSupportLinks(risk, message, userCategory);

    return {
      response: responseText,
      risk,
      score: Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0)),
      rating,
      nextQuestion: parsed.nextQuestion || 'Would you like to share more details about what happened?',
      indicators: Array.isArray(parsed.indicators) ? parsed.indicators : [],
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      summary: parsed.summary || responseText,
      recommendations: recommendationList,
      supportLinks,
      mode: 'gemini',
    };
  } catch (error) {
    return null;
  }
}

async function translateStrings(strings = [], language = 'en') {
  if (!Array.isArray(strings) || strings.length > 80) {
    return { ok: false, message: 'Provide up to 80 strings per translation request.' };
  }

  const languageName = languageMap[language];
  if (!languageName) return { ok: false, message: 'Unsupported language.' };
  const sourceStrings = strings.map(String);
  const totalCharacters = sourceStrings.reduce((total, string) => total + string.length, 0);
  if (totalCharacters > 20000) {
    return { ok: false, message: 'The translation request is too large. Send smaller batches.' };
  }
  if (language === 'en') return { ok: true, translations: sourceStrings };

  const protectedTerms = sourceStrings.map(protectTranslationTerms);
  const prompt = `Translate every input string into natural, clear ${languageName}. Keep the same order and return exactly ${sourceStrings.length} output strings, one for each input. Do not omit, combine, summarize, explain, or add text. Preserve meaning, respectful tone, punctuation, numbers, and all ZXQKEEP...QXZ markers exactly as written. The markers stand for URLs, product names, official legal titles, or helpline identifiers; do not translate or change them. Use fluent everyday ${languageName}, not word-for-word phrasing. Return only JSON in this shape: {"translations":["..."]}.\n${JSON.stringify(protectedTerms.map(({ text }) => text))}`;
  const maxOutputTokens = Math.min(8192, Math.max(1024, Math.ceil(totalCharacters * 1.5)));
  const providers = [
    {
      name: 'Gemini',
      apiKey: process.env.GEMINI_API_KEY,
      request: async () => {
        const model = process.env.GEMINI_TRANSLATION_MODEL || 'gemini-3.8-flash';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens,
              responseMimeType: 'application/json',
            },
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
      },
    },
    {
      name: 'Groq',
      apiKey: process.env.GROQ_API_KEY,
      request: () => requestOpenAICompatibleTranslation({
        apiKey: process.env.GROQ_API_KEY,
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: process.env.GROQ_TRANSLATION_MODEL || 'openai/gpt-oss-120b',
        prompt,
      }),
    },
    {
      name: 'OpenAI',
      apiKey: process.env.OPENAI_API_KEY,
      request: () => requestOpenAICompatibleTranslation({
        apiKey: process.env.OPENAI_API_KEY,
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini',
        prompt,
      }),
    },
  ].filter((provider) => provider.apiKey);
  const providerPriority = { Groq: 0, Gemini: 1, OpenAI: 2 };
  providers.sort((first, second) => providerPriority[first.name] - providerPriority[second.name]);

  if (!providers.length) {
    return { ok: false, message: 'Set GEMINI_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY to enable translation.' };
  }

  const failures = [];
  for (const provider of providers) {
    try {
      const responseText = await provider.request();
      const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      const translations = Array.isArray(parsed) ? parsed : parsed.translations;
      if (!Array.isArray(translations) || translations.length !== sourceStrings.length
        || translations.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new Error('incomplete translation');
      }
      const restoredTranslations = translations.map((translation, index) => restoreTranslationTerms(translation.trim(), protectedTerms[index]));
      return { ok: true, translations: restoredTranslations, provider: provider.name };
    } catch (error) {
      failures.push(`${provider.name}: ${error.message}`);
    }
  }

  return { ok: false, message: `All configured translation providers failed (${failures.join('; ')}).` };
}

function protectTranslationTerms(source) {
  const protectedValues = [];
  const patterns = [
    /https?:\/\/[^\s<>"']+/gi,
    /SC\/ST \(Prevention of Atrocities\) Act, 1989/gi,
    /Protection of Civil Rights Act, 1955/gi,
    /Bharatiya Nyaya Sanhita, 2023/gi,
    /Constitution of India/gi,
    /\b(?:India Code|SahayakAI|NHAA|NALSA|Tele-MANAS)\b/g,
    /\b(?:tel:)?\+?\d[\d -]{5,}\d\b/gi,
  ];
  let text = source;
  patterns.forEach((pattern) => {
    text = text.replace(pattern, (value) => {
      const token = `ZXQKEEP${protectedValues.length}QXZ`;
      protectedValues.push({ token, value });
      return token;
    });
  });
  return { text, protectedValues };
}

function restoreTranslationTerms(translation, { protectedValues }) {
  let restored = translation;
  protectedValues.forEach(({ token, value }) => {
    const occurrences = restored.split(token).length - 1;
    if (occurrences !== 1) throw new Error('The translation changed a protected legal title, URL, or identifier.');
    restored = restored.replace(token, value);
  });
  if (/ZXQKEEP\d+QXZ/.test(restored)) {
    throw new Error('The translation returned an unexpected protected-term marker.');
  }
  return restored;
}

async function requestOpenAICompatibleTranslation({ apiKey, endpoint, model, prompt }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a precise translator. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 8192,
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || '';
}

async function buildChatResponse(message, state = {}) {
  const text = String(message || '').trim();
  const userId = state.userId || 'guest';
  const sessionKey = state.conversationId ? `${userId}:${state.conversationId}` : userId;
  let session = getChatSession(sessionKey, state.category || 'SC');
  if (!session.answers?.length && Array.isArray(state.historyMessages) && state.historyMessages.length) {
    session.answers = [];
    session.chatbotConversation = [];
    let previousQuestion = 'Would you like to tell me what has been happening?';
    state.historyMessages.slice(-40).forEach((entry) => {
      if (entry.role === 'assistant') {
        previousQuestion = String(entry.content || '').slice(0, 1200);
      } else if (entry.role === 'user') {
        const answer = String(entry.content || '').slice(0, 1200);
        session.answers.push(answer);
        session.chatbotConversation.push({ question: previousQuestion, answer });
      }
    });
    session.lastQuestion = previousQuestion;
  }

  if (text) {
    session.answers = Array.isArray(session.answers) ? session.answers : [];
    session.answers.push(text);
    session.updatedAt = new Date().toISOString();
    session.chatbotConversation = Array.isArray(session.chatbotConversation) ? session.chatbotConversation : [];
    session.chatbotConversation.push({
      question: session.lastQuestion || 'Would you like to tell me what has been happening?',
      answer: text,
    });
  }

  const conversationText = (session.answers || []).join(' ');
  const answerCount = (session.answers || []).length;
  const currentType = detectProblemType(conversationText);
  const latestType = detectProblemType(text);
  if (!session.problemType || session.problemType === 'General support') {
    session.problemType = latestType;
  } else if (latestType === 'Discrimination due to caste') {
    session.problemType = latestType;
  } else if (latestType === 'Safety risk' && hasExplicitSafetySignal(text)) {
    session.problemType = latestType;
  }
  const problemType = session.problemType || currentType;

  if (answerCount < 4) {
    const question = getAdaptiveChatQuestion(conversationText, problemType, session);
    session.askedQuestions = Array.isArray(session.askedQuestions) ? session.askedQuestions : [];
    session.askedQuestions.push(question);
    session.lastQuestion = question;
    const indicators = analyzeText(conversationText);
    const safetyNote = hasExplicitSafetySignal(conversationText)
      && /(immediate danger|danger now|in danger|being attacked|threatened right now)/i.test(conversationText)
      ? 'If you are in immediate danger, move to a safer place if possible and call emergency services on 112 or contact someone you trust. '
      : '';
    return {
      response: `${safetyNote}${question}`,
      risk: 'LOW',
      score: 0,
      rating: 'LOW',
      problemType,
      nextQuestion: question,
      followUpQuestion: question,
      indicators: indicators.indicators,
      facts: indicators.facts,
      nlp: indicators.nlp,
      summary: conversationText,
      recommendations: [
        'Share only what feels comfortable. The follow-up screening questions will be tailored to your concern.',
        ...getRecommendations('LOW', conversationText),
      ],
      supportLinks: getSupportLinks('LOW', conversationText, state.category || 'SC'),
      needsMoreQuestions: true,
      mode: 'local-nlp',
    };
  }

  const assessment = buildConversationAssessment(conversationText, state.category, problemType);
  assessment.nextQuestion = assessment.contextQuestions[0];
  assessment.followUpQuestion = assessment.nextQuestion;
  assessment.screeningQuestions = getConditionScreeningQuestions(problemType, conversationText);
  assessment.mode = 'local-nlp';
  assessment.needsMoreQuestions = false;
  assessment.awaitingScreening = true;
  assessment.chatbotConversation = session.chatbotConversation;
  session.completed = true;
  session.finalAssessment = assessment;

  return assessment;
}

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  generateAssessment,
  getHistoryByUser,
  deleteAssessment,
  buildChatResponse,
  translateStrings,
  languageMap,
  getLegalFrameworks,
  getRecommendations,
  getSupportLinks,
  analyzeText,
  detectProblemType,
  getConditionScreeningQuestions,
  createSession,
  getRiskRating,
  getRequiredChatAnswers,
  calculateSVI,
  analyzeConversationIndicators,
  buildSVIAssessment,
  classifySVI,
  getSVIRecommendations,
};
