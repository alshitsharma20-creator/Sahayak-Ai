const natural = require('natural');

const trainingExamples = {
  'Safety risk': [
    'Someone threatened me and I am afraid they will hurt me.',
    'I am in danger and cannot get to a safe place.',
    'They hit me and keep following me.',
    'I am being harassed and fear retaliation if I report it.',
    'I do not feel safe at home because of violence.',
    'I was forced out and have nowhere safe to go.',
    'They are intimidating me and threatening my family.',
    'I am scared to leave because someone is waiting outside.',
  ],
  Trauma: [
    'I experienced an assault and cannot stop thinking about it.',
    'The incident was humiliating and deeply upsetting.',
    'I was bullied and excluded by the people around me.',
    'I keep remembering the violence I witnessed.',
    'I was discriminated against because of my caste.',
    'They insulted and humiliated me in front of others.',
    'I went through a traumatic experience and feel shaken.',
    'I am being socially boycotted and excluded from the community.',
  ],
  Anxiety: [
    'I feel anxious and nervous all the time.',
    'I have panic attacks and racing thoughts.',
    'I am constantly worried and cannot calm down.',
    'I feel restless and overwhelmed by fear.',
    'My heart races when I think about what might happen.',
    'I feel tense and on edge every day.',
    'I am having trouble breathing when I get anxious.',
    'I feel scared even when nothing is happening.',
  ],
  Depression: [
    'I feel hopeless, empty, and sad most days.',
    'Nothing interests me and I have no motivation.',
    'I feel worthless and keep crying.',
    'I have lost interest in things I used to enjoy.',
    'I feel low and cannot see a way forward.',
    'I feel exhausted and deeply unhappy.',
    'I have been feeling depressed and isolated.',
    'I feel like a burden and nothing makes me happy.',
  ],
  Stress: [
    'I have too much pressure from work and study.',
    'I feel burned out and overwhelmed by my responsibilities.',
    'Financial problems are causing me a lot of stress.',
    'There is tension at home and I cannot relax.',
    'I am struggling to manage my workload.',
    'I feel stressed about exams and deadlines.',
    'Family responsibilities are becoming too much.',
    'I am under pressure and finding daily life difficult.',
  ],
  'General support': [
    'I feel hopeful and happy today.',
    'Things are going well and I feel positive.',
    'I feel calm, safe, and supported.',
    'I am doing okay and want information about available help.',
    'I feel good and would like to learn about support options.',
  ],
};

const classifier = new natural.BayesClassifier();
Object.entries(trainingExamples).forEach(([label, examples]) => {
  examples.forEach((example) => classifier.addDocument(example, label));
});
classifier.train();

const tokenizer = new natural.WordTokenizer();
const stopwords = new Set(natural.stopwords);
const sentimentAnalyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
const casteRelatedPattern = /\b(?:caste(?:[- ]based|ist|ism)?|scheduled castes?|scheduled tribes?|sc\s*(?:[/&-]\s*)?st|dalits?|untouchability|untouchable|obcs?|backward classes?|jaati|jati)\b/i;

function hasCasteRelatedTerms(text = '') {
  return casteRelatedPattern.test(String(text || ''));
}

function analyzeNaturalLanguage(input = '') {
  const text = String(input || '').trim();
  const tokens = tokenizer.tokenize(text.toLowerCase());
  const counts = new Map();

  tokens.forEach((token) => {
    if (!/^[a-z]+$/.test(token) || token.length < 3 || stopwords.has(token)) return;
    counts.set(token, (counts.get(token) || 0) + 1);
  });

  const sentimentScore = sentimentAnalyzer.getSentiment(tokens);
  const rankedTerms = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([term]) => term);
  const intent = hasCasteRelatedTerms(text)
    ? 'Discrimination due to caste'
    : text ? classifier.classify(text) : 'Stress';

  return {
    intent,
    sentiment: sentimentScore > 0.15 ? 'positive' : sentimentScore < -0.15 ? 'negative' : 'neutral',
    sentimentScore: Math.round(sentimentScore * 100) / 100,
    keyTerms: rankedTerms,
    tokenCount: tokens.length,
  };
}

module.exports = { analyzeNaturalLanguage, hasCasteRelatedTerms };
