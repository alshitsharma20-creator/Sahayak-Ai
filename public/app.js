const state = {
  screen: 'landing',
  user: null,
  category: 'SC',
  language: 'en',
  history: [],
  chatAssessment: null,
  k10Questions: [],
  conversationId: new URLSearchParams(window.location.search).get('conversation'),
  transcript: '',
  mediaRecorder: null,
  audioChunks: [],
  isRecording: false,
};

const elements = {
  landingPage: document.getElementById('landing-page'),
  authPage: document.getElementById('auth-page'),
  appShell: document.getElementById('app-shell'),
  categoryPage: document.getElementById('category-page'),
  toast: document.getElementById('toast'),
  loginForm: document.getElementById('login-form'),
  registerForm: document.getElementById('register-form'),
  tabButtons: document.querySelectorAll('.tab-btn'),
  authForms: document.querySelectorAll('.auth-form'),
  headerUser: document.getElementById('header-user'),
  selectedCategoryLabel: document.getElementById('selected-category-label'),
  summaryScreening: document.getElementById('summary-screening'),
  summaryLegal: document.getElementById('summary-legal'),
  summaryVoice: document.getElementById('summary-voice'),
  summaryHelp: document.getElementById('summary-help'),
  languageSelect: document.getElementById('language-select'),
  chatBox: document.getElementById('chat-box'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  transcriptOutput: document.getElementById('transcript-output'),
  screeningForm: document.getElementById('screening-form'),
  screeningResult: document.getElementById('screening-result'),
  legalResults: document.getElementById('legal-results'),
  historyList: document.getElementById('history-list'),
  helplineContent: document.getElementById('helpline-content'),
  voiceScoreBox: document.getElementById('voice-score-box'),
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 2200);
}

async function renderSavedConversations() {
  const list = document.getElementById('saved-conversations-list');
  if (!list) return;
  list.replaceChildren();
  if (state.user?.authMode !== 'supabase') {
    list.textContent = 'Persistent conversation history is unavailable in demo mode.';
    return;
  }
  const response = await fetch('/api/conversations');
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || 'Unable to load conversations.');
  (result.data || []).forEach((conversation) => {
    const link = document.createElement('a');
    link.href = `/?conversation=${encodeURIComponent(conversation.id)}`;
    link.textContent = `${conversation.title} — ${new Date(conversation.updated_at).toLocaleDateString()}`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      resumeSavedConversation(conversation.id);
    });
    list.appendChild(link);
  });
  if (!list.childElementCount) list.textContent = 'No saved conversations yet.';
}

async function resumeSavedConversation(conversationId) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
  const result = await response.json();
  if (!response.ok || !result.ok) return showToast(result.message || 'Conversation could not be opened.');
  state.conversationId = conversationId;
  history.replaceState(null, '', `/?conversation=${encodeURIComponent(conversationId)}`);
  elements.chatBox.replaceChildren();
  (result.data || []).forEach((message) => {
    const bubble = document.createElement('div');
    bubble.className = `chat-message ${message.role === 'user' ? 'user' : 'ai'}`;
    bubble.textContent = message.content;
    elements.chatBox.appendChild(bubble);
  });
  setActiveView('chat-view');
}

function showScreen(screen) {
  state.screen = screen;
  elements.landingPage.classList.toggle('hidden', screen !== 'landing');
  elements.authPage.classList.toggle('hidden', screen !== 'auth');
  elements.appShell.classList.toggle('hidden', screen !== 'app');
  elements.categoryPage.classList.toggle('hidden', screen !== 'category');
}

function setActiveTab(tab) {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  elements.authForms.forEach((form) => {
    form.classList.toggle('active', form.id === `${tab}-form`);
  });
}

function setActiveView(viewId) {
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active', view.id === viewId);
    view.classList.toggle('hidden', view.id !== viewId);
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === viewId);
  });
}

function updateHeader() {
  if (!state.user) return;
  elements.headerUser.textContent = state.user.name || state.user.username || state.user.email;
  elements.selectedCategoryLabel.textContent = state.category || 'SC';
}

function handleRegister(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    name: formData.get('name'),
    email: formData.get('email'),
    loginId: formData.get('email'),
    password: formData.get('password'),
    category: state.category || 'SC',
    language: state.language || 'en',
  };

  fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((result) => {
      if (!result.ok) {
        showToast(result.message || 'Registration failed');
        return;
      }
      if (result.requiresEmailConfirmation) {
        showToast('Check your email to confirm your account, then log in.');
        setActiveTab('login');
        return;
      }
      state.user = result.user;
      setSavedUser(result.user);
      showToast('Account created. Please select a category.');
      showScreen('category');
      loadSpaMemoryConsent().catch((error) => showToast(error.message || 'Unable to load privacy settings.'));
    })
    .catch(() => showToast('Unable to connect to the server.'));
}

function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    loginId: formData.get('loginId'),
    password: formData.get('password'),
  };

  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((result) => {
      if (!result.ok) {
        showToast(result.message || 'Login failed');
        return;
      }
      saveRememberedUsername(event.target);
      state.user = result.user;
      setSavedUser(result.user);
      state.category = result.user.category || 'SC';
      state.language = result.user.preferredLanguage || state.language;
      elements.languageSelect.value = state.language;
      updateHeader();
      showScreen('category');
      showToast('Welcome back.');
      loadSpaMemoryConsent().catch((error) => showToast(error.message || 'Unable to load privacy settings.'));
    })
    .catch(() => showToast('Unable to connect to the server.'));
}

async function renderK10Questions() {
  elements.screeningForm.replaceChildren();
  document.getElementById('spa-k10-submit').disabled = true;
  try {
    const response = await fetch('/api/assessment/k10/questions');
    const result = await response.json();
    if (!response.ok || !result.ok || result.questions?.length !== 10 || result.options?.length !== 5) {
      throw new Error(result.message || 'The fixed K10 questions could not be loaded.');
    }
    state.k10Questions = result.questions;
    result.questions.forEach((question, index) => {
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'k10-question';
      const legend = document.createElement('legend');
      legend.textContent = `${index + 1}. ${question}`;
      fieldset.appendChild(legend);
      const optionRow = document.createElement('div');
      optionRow.className = 'option-row';
      result.options.forEach((option, optionIndex) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `q${index}`;
        input.value = String(optionIndex + 1);
        input.required = true;
        label.append(input, document.createTextNode(` ${option}`));
        optionRow.appendChild(label);
      });
      fieldset.appendChild(optionRow);
      elements.screeningForm.appendChild(fieldset);
    });
    document.getElementById('spa-k10-submit').disabled = false;
    document.getElementById('spa-k10-concern').textContent = state.chatAssessment?.problemType
      ? `AI-chat concern noted: ${state.chatAssessment.problemType}. This is context only; the K10 questions and score remain unchanged.`
      : 'The 10 K10 questions and response options stay fixed. Your AI-chat concern is context only and does not change the questions or score.';
  } catch (error) {
    showToast(error.message || 'The K10 questionnaire could not be loaded.');
  }
}

async function submitK10Assessment(event) {
  event.preventDefault();
  if (state.k10Questions.length !== 10) {
    showToast('The fixed K10 questions are not ready yet.');
    return;
  }
  const formData = new FormData(event.target);
  const answers = Array.from({ length: 10 }, (_, index) => Number(formData.get(`q${index}`) || 0));
  if (answers.some((answer) => answer < 1 || answer > 5)) {
    showToast('Select one response for each of the 10 K10 questions.');
    return;
  }

  try {
    const response = await fetch('/api/assessment/k10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers, concernCategory: state.chatAssessment?.problemType || null }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || 'K10 could not be completed.');
    if (result.comparisonWarning) showToast('Your K10 score was saved, but its history comparison could not be loaded.');
    else if (result.persistenceWarning) showToast('Your K10 score is available, but it could not be saved.');
    else if (!result.historySaved) showToast('Your K10 score was calculated but not saved. Enable saved memory in Privacy to keep a history.');
    elements.screeningResult.classList.remove('hidden');
    document.getElementById('screening-score').textContent = `K10 total: ${result.score} / 50`;
    document.getElementById('screening-band').textContent = result.comparison?.count > 1
      ? `Compared with previous K10: ${result.comparison.difference > 0 ? '+' : ''}${result.comparison.difference} points (${result.comparison.trend}).`
      : 'No previous saved K10 to compare.';
    document.getElementById('screening-priority').textContent = result.interpretation;
    const recommendations = document.getElementById('screening-recommendations');
    recommendations.replaceChildren();
    (result.recommendations || []).forEach((recommendation) => {
      const item = document.createElement('p');
      item.className = 'support-item';
      item.textContent = recommendation;
      recommendations.appendChild(item);
    });
    renderOfficialSupportResources(document.getElementById('screening-official-resources'), result.supportLinks || []);
    elements.summaryScreening.textContent = `${result.score} / 50`;
    renderHistory();
    showToast('K10 assessment completed.');
  } catch (error) {
    showToast(error.message || 'Screening could not be completed. Please try again.');
  }
}

function renderOfficialSupportResources(container, resources) {
  container.replaceChildren();
  resources.forEach((resource) => {
    const card = document.createElement('article');
    card.className = 'support-item';
    const heading = document.createElement('h4');
    heading.textContent = resource.label;
    const detail = document.createElement('p');
    detail.textContent = resource.detail;
    const nextStep = document.createElement('p');
    nextStep.textContent = `Possible next step: ${resource.nextStep}`;
    const link = document.createElement('a');
    link.href = resource.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = resource.url.startsWith('tel:') ? 'Call 112' : `Open official source${resource.source ? `: ${resource.source}` : ''}`;
    card.append(heading, detail, nextStep, link);
    container.appendChild(card);
  });
  if (!container.childElementCount) container.textContent = 'No official support links are available for this result.';
}

function buildLegalCards(text = 'Threats and intimidation') {
  fetch(`/api/legal?text=${encodeURIComponent(text)}`)
    .then((res) => res.json())
    .then((data) => {
      const frameworks = data.frameworks || [];
      elements.legalResults.innerHTML = frameworks
        .map(
          (item) => `
            <article class="legal-card">
              <h4>${item.law}</h4>
              <p><strong>Why it may be relevant:</strong> ${item.relevance}</p>
              <p><strong>Consider doing:</strong> ${item.action}</p>
              <p><strong>Official source:</strong> ${item.url ? `<a href="${item.url}" target="_blank" rel="noreferrer">${item.source}</a>` : item.source}</p>
              <p><strong>Disclaimer:</strong> ${item.disclaimer}</p>
            </article>
          `
        )
        .join('');
    })
    .catch(() => {
      elements.legalResults.innerHTML = '<div class="legal-card"><p>Legal guidance is unavailable right now.</p></div>';
    });
}

function renderHistory() {
  if (!state.user) return;
  fetch(`/api/history?userId=${encodeURIComponent(state.user.id)}`)
    .then((res) => res.json())
    .then((result) => {
      state.history = result.data || [];
      elements.historyList.replaceChildren();
      if (!state.history.length) {
        elements.historyList.textContent = 'No history yet. Complete an assessment to save it.';
        return;
      }

      state.history.forEach((item) => {
        const card = document.createElement('article');
        card.className = 'history-item';
        const title = document.createElement('h4');
        title.textContent = `Assessment — ${new Date(item.date).toLocaleDateString('en-IN')}`;
        const details = document.createElement('p');
        details.textContent = item.assessment_type === 'k10_v1'
          ? `K10 psychological distress score: ${item.screeningScore ?? 'Not available'} / 50. Higher totals indicate greater reported distress; this is not a diagnosis. Concern context: ${item.problemType || 'not recorded'}.`
          : `Concern: ${item.problemType || item.category || 'Not recorded'}. Experimental condition-specific score: ${item.screeningScore ?? 'Not available'} / 50; unvalidated and not the K10.`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ghost-btn';
        remove.textContent = 'Delete';
        remove.addEventListener('click', () => deleteHistory(item.id));
        card.append(title, details, remove);
        elements.historyList.appendChild(card);
      });
    })
    .catch(() => {
      elements.historyList.textContent = 'Unable to load history.';
    });
}

async function renderK10History() {
  const summary = document.getElementById('spa-k10-comparison');
  const officialResources = document.getElementById('spa-k10-official-resources');
  const timeline = document.getElementById('spa-k10-timeline');
  const otherComparisons = document.getElementById('spa-other-comparisons');
  summary.replaceChildren();
  officialResources.replaceChildren();
  timeline.replaceChildren();
  otherComparisons.replaceChildren();
  if (state.user?.authMode !== 'supabase') {
    summary.textContent = 'K10 history comparison requires a Supabase account with saved memory enabled.';
    timeline.textContent = 'Persistent K10 history is unavailable in demo mode.';
    otherComparisons.textContent = 'Persistent report comparisons are unavailable in demo mode.';
    return;
  }
  try {
    const response = await fetch('/api/user/progress');
    const progress = await response.json();
    if (!response.ok || !progress.ok) throw new Error(progress.message || 'Unable to load K10 history.');
    const comparison = progress.k10Comparison;
    const summaryText = document.createElement('p');
    if (comparison?.count > 1) {
      const contextChange = comparison.previous.concern_category && comparison.latest.concern_category
        && comparison.previous.concern_category !== comparison.latest.concern_category
        ? ` AI-chat concern context changed from "${comparison.previous.concern_category}" to "${comparison.latest.concern_category}"; this does not explain the score change.`
        : '';
      summaryText.textContent = `Across ${comparison.count} fixed K10 reports, your latest score is ${comparison.latest.stress_score}/50, ${comparison.trend.toLowerCase()}. Change from the previous report: ${comparison.difference > 0 ? '+' : ''}${comparison.difference} points. Higher totals indicate greater reported psychological distress. This comparison is not a diagnosis and does not show what caused a change.${contextChange}`;
    } else {
      summaryText.textContent = comparison?.count === 1
        ? 'One K10 score is saved; at least two saved K10 reports are needed to compare change over time.'
        : 'No saved K10 reports yet. Enable saved memory and complete the fixed K10 to start a timeline.';
    }
    summary.appendChild(summaryText);
    const recommendationsHeading = document.createElement('h4');
    recommendationsHeading.textContent = 'Suggestions based on comparison';
    summary.appendChild(recommendationsHeading);
    (progress.k10Recommendations || []).forEach((text) => {
      const recommendation = document.createElement('p');
      recommendation.className = 'support-item';
      recommendation.textContent = text;
      summary.appendChild(recommendation);
    });
    renderOfficialSupportResources(officialResources, progress.k10SupportLinks || []);
    const history = (progress.assessments || [])
      .filter((item) => item.assessment_type === 'k10_v1' && Number.isInteger(item.stress_score))
      .sort((a, b) => new Date(a.assessed_at) - new Date(b.assessed_at));
    history.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'info-box';
      const heading = document.createElement('h4');
      heading.textContent = `K10 — ${new Date(item.assessed_at).toLocaleDateString('en-IN')}`;
      const detail = document.createElement('p');
      const previous = history[index - 1];
      const change = previous
        ? `Change since previous: ${item.stress_score > previous.stress_score ? '+' : ''}${item.stress_score - previous.stress_score} points.`
        : 'Starting score; no earlier K10 to compare.';
      detail.textContent = `Score ${item.stress_score}/50. ${change} Concern context: ${item.concern_category || 'not recorded'}. The K10 measures general distress and does not determine its cause.`;
      card.append(heading, detail);
      timeline.appendChild(card);
    });
    if (!history.length) timeline.textContent = 'No saved K10 score timeline yet.';
    const groups = (progress.assessmentComparisons || []).filter((item) => item.assessmentType !== 'k10_v1');
    groups.forEach((group) => {
      const card = document.createElement('article');
      card.className = 'info-box';
      const heading = document.createElement('h4');
      heading.textContent = `${group.assessmentType === 'svi_experimental_v1' ? 'Experimental condition-specific screening' : group.assessmentType} — ${group.concernCategory || 'General concern'}`;
      const detail = document.createElement('p');
      detail.textContent = group.count > 1
        ? `${group.count} comparable reports: ${group.first.stress_score} to ${group.latest.stress_score}; trend ${group.trend}; change ${group.difference > 0 ? '+' : ''}${group.difference}. This experimental measure is unvalidated and does not establish cause.`
        : `One report saved (score ${group.latest.stress_score}); more comparable reports are needed to identify change over time.`;
      card.append(heading, detail);
      (group.recommendations || []).forEach((text) => {
        const recommendation = document.createElement('p');
        recommendation.className = 'support-item';
        recommendation.textContent = text;
        card.appendChild(recommendation);
      });
      otherComparisons.appendChild(card);
    });
    if (!otherComparisons.childElementCount) otherComparisons.textContent = 'No other comparable assessment reports yet.';
  } catch (error) {
    summary.textContent = error.message || 'Unable to load K10 history.';
  }
}

function deleteHistory(id) {
  fetch(`/api/history/${id}`, { method: 'DELETE' })
    .then((res) => res.json())
    .then((result) => {
      if (result.ok) {
        renderHistory();
        renderK10History();
        showToast('Assessment deleted.');
      }
    })
    .catch(() => showToast('Unable to delete history item.'));
}

function renderHelplines() {
  fetch('/api/helplines')
    .then((res) => res.json())
    .then((result) => {
      const resource = result.resource || {};
      const entries = result.emergency || [];

      elements.helplineContent.innerHTML = `
        <div class="help-card">
          <h4>${resource.name}</h4>
          <p><strong>Shortcode:</strong> ${resource.phone}</p>
          <p><strong>Alternate:</strong> ${resource.alternate}</p>
          <p><strong>Website:</strong> <a href="${resource.website}" target="_blank" rel="noreferrer">${resource.website}</a></p>
          <div class="voice-controls">
            <a class="primary-btn" href="tel:${resource.phone}">Call NHAA</a>
            <a class="secondary-btn" href="${resource.website}" target="_blank" rel="noreferrer">Visit the official NHAA website</a>
          </div>
          <p><strong>Note:</strong> ${resource.note}</p>
        </div>

        <div class="help-card">
          <h4>Emergency and support</h4>
          ${entries
            .map(
              (item) => `
                <p><strong>${item.name}:</strong> ${item.value}</p>
              `
            )
            .join('')}
        </div>
      `;
    })
    .catch(() => {
      elements.helplineContent.innerHTML = '<div class="help-card"><p>Helpline information is currently unavailable.</p></div>';
    });
}

function attachNavigationHandlers() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const viewId = button.dataset.view;
      setActiveView(viewId);
      if (viewId === 'k10-view') renderK10Questions();
      if (viewId === 'history-view') renderHistory();
      if (viewId === 'history-view') renderK10History();
      if (viewId === 'history-view') renderSavedConversations().catch((error) => showToast(error.message));
      if (viewId === 'help-view') renderHelplines();
      if (viewId === 'legal-view') buildLegalCards();
    });
  });

  document.getElementById('landing-login-btn').addEventListener('click', () => showScreen('auth'));
  document.getElementById('hero-start-btn')?.addEventListener('click', () => showScreen('auth'));
  document.getElementById('hero-emergency-btn')?.addEventListener('click', () => {
    showScreen('app');
    setActiveView('help-view');
    renderHelplines();
  });
  document.getElementById('hero-how-btn')?.addEventListener('click', () => {
    document.getElementById('how-it-works').scrollIntoView({ behavior: 'smooth' });
  });

  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.tab));
  });

  elements.languageSelect.addEventListener('change', (event) => {
    state.language = event.target.value;
    setSelectedLanguage(state.language);
    if (state.user) {
      state.user.preferredLanguage = state.language;
      setSavedUser(state.user);
    }
  });

  document.getElementById('profile-btn').addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });

  document.getElementById('logout-btn').addEventListener('click', logoutUser);

  document.getElementById('change-category-btn').addEventListener('click', () => {
    showScreen('category');
  });

  document.querySelectorAll('.category-option').forEach((button) => {
    button.addEventListener('click', () => {
      state.category = button.dataset.category;
      if (state.user) {
        state.user.category = state.category;
      }
      updateHeader();
      showScreen('app');
      setActiveView('home-view');
      showToast(`Selected category: ${state.category}`);
    });
  });

  elements.loginForm.addEventListener('submit', handleLogin);
  elements.registerForm.addEventListener('submit', handleRegister);
  document.getElementById('new-chat-btn').addEventListener('click', () => {
    state.conversationId = null;
    history.replaceState(null, '', '/');
    elements.chatBox.replaceChildren();
    ['Hello. I am SahayakAI. I am here to help you understand your situation and find appropriate support.', 'Would you like to tell me what happened?']
      .forEach((text) => {
        const message = document.createElement('div');
        message.className = 'chat-message ai';
        message.textContent = text;
        elements.chatBox.appendChild(message);
      });
  });
  elements.chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = elements.chatInput.value.trim();
    if (!message) return;

    const userBubble = document.createElement('div');
    userBubble.className = 'chat-message user';
    userBubble.textContent = message;
    elements.chatBox.appendChild(userBubble);
    elements.chatInput.value = '';

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        language: state.language,
        category: state.category,
        ...(state.conversationId ? { conversationId: state.conversationId } : {}),
      }),
    })
      .then((res) => res.json())
      .then((result) => {
        const aiBubble = document.createElement('div');
        aiBubble.className = 'chat-message ai';
        aiBubble.textContent = result.response;
        elements.chatBox.appendChild(aiBubble);
        if (result.conversationId) {
          state.conversationId = result.conversationId;
          history.replaceState(null, '', `/?conversation=${encodeURIComponent(state.conversationId)}`);
        }
        if (result.persistenceWarning) showToast('Your reply is available, but this message could not be saved.');
        if (result.awaitingScreening === true) {
          state.chatAssessment = {
            problemType: result.problemType || 'General support',
            summary: result.summary || '',
            conversationText: result.summary || '',
            chatbotConversation: result.chatbotConversation || [],
            screeningQuestions: result.screeningQuestions || [],
          };
          renderK10Questions();
          setActiveView('k10-view');
          showToast('The fixed K10 questions are ready.');
          return;
        }
        if (result.risk === 'CRITICAL') {
          showToast('Critical support alert: emergency support should be prioritized.');
        }
      })
      .catch(() => showToast('Chat service is unavailable.'));
  });

  document.getElementById('start-recording-btn').addEventListener('click', startRecording);
  document.getElementById('stop-recording-btn').addEventListener('click', stopRecording);
  document.getElementById('view-transcript-btn').addEventListener('click', () => {
    elements.transcriptOutput.value = state.transcript || 'No transcript yet.';
  });

  document.getElementById('play-recording-btn').addEventListener('click', () => {
    if (!state.audioBlob) {
      showToast('No recording available yet.');
      return;
    }
    const audioUrl = URL.createObjectURL(state.audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
  });

  elements.screeningForm.addEventListener('submit', submitK10Assessment);
  document.getElementById('summary-help').addEventListener('click', () => {
    setActiveView('help-view');
    renderHelplines();
  });
}

function startRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Microphone access is unavailable in this browser.');
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    const recorder = new MediaRecorder(stream, mimeType ? { type: mimeType } : undefined);
    state.mediaRecorder = recorder;
    state.audioChunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) state.audioChunks.push(event.data);
    };
    recorder.onstop = () => {
      state.audioBlob = new Blob(state.audioChunks, { type: mimeType || 'audio/webm' });
      elements.transcriptOutput.value = state.transcript || 'Transcript captured. Review and edit if needed.';
      elements.voiceScoreBox.textContent = 'Voice recordings and transcripts are not scored or clinically interpreted. For a standardized self-report screen, use the fixed K10 questionnaire; it is not a diagnosis.';
      stream.getTracks().forEach((track) => track.stop());
    };

    recorder.start();
    state.isRecording = true;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-IN';
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join(' ');
        state.transcript = transcript;
        elements.transcriptOutput.value = transcript;
      };
      recognition.onend = () => {
        if (state.isRecording) recognition.start();
      };
      recognition.start();
    }

    showToast('Recording started. Speak naturally.');
  }).catch(() => {
    showToast('Microphone permission was denied.');
  });
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    showToast('Recording stopped.');
  }
}

function initializeApp() {
  const savedUser = JSON.parse(localStorage.getItem('sahayakUser') || 'null');
  loadRememberedUsername(elements.loginForm);
  state.language = savedUser?.preferredLanguage || localStorage.getItem('sahayakLanguage') || 'en';
  elements.languageSelect.value = state.language;
  buildLegalCards();
  renderHelplines();
  attachNavigationHandlers();
  setActiveView('home-view');

  if (savedUser) {
    state.user = savedUser;
    state.category = savedUser.category || state.category;
    state.language = savedUser.preferredLanguage || state.language;
    elements.languageSelect.value = state.language;
    showScreen('app');
    setActiveView('home-view');
    updateHeader();
    renderHistory();
    renderSavedConversations().catch((error) => showToast(error.message));
    if (state.conversationId) {
      resumeSavedConversation(state.conversationId).catch((error) => showToast(error.message));
    }
  }
  loadSpaMemoryConsent().catch((error) => showToast(error.message || 'Unable to load privacy settings.'));
  setSelectedLanguage(state.language);
}

initializeApp();

async function loadSpaMemoryConsent() {
  const checkbox = document.getElementById('spa-memory-consent');
  const status = document.getElementById('spa-memory-status');
  if (!checkbox || !status) return;
  if (!state.user) {
    status.textContent = 'Log in to manage saved memory settings.';
    return;
  }
  const health = await fetch('/api/health').then((response) => response.json());
  if (health.mode !== 'supabase') {
    status.textContent = 'Cloud history is not configured. Demo mode does not save persistent history.';
    return;
  }
  const authResponse = await fetch('/api/auth/me');
  const authResult = await authResponse.json();
  if (!authResponse.ok || !authResult.ok) {
    localStorage.removeItem('sahayakUser');
    window.location.replace('/login.html');
    return;
  }
  state.user = authResult.user;
  setSavedUser(authResult.user);
  updateHeader();
  const response = await fetch('/api/user/profile');
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || 'Unable to load privacy settings.');
  checkbox.checked = result.user.memory_consent === true;
  checkbox.disabled = false;
  status.textContent = checkbox.checked ? 'Memory is enabled.' : 'Memory is off; chats are not saved.';
  checkbox.addEventListener('change', async () => {
    if (!checkbox.checked && !window.confirm('Turning off memory permanently deletes saved chats, assessments, and progress. Continue?')) {
      checkbox.checked = true;
      return;
    }
    const update = await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memoryConsent: checkbox.checked }),
    });
    const updateResult = await update.json();
    if (!update.ok || !updateResult.ok) {
      checkbox.checked = !checkbox.checked;
      return showToast(updateResult.message || 'Privacy setting could not be saved.');
    }
    status.textContent = checkbox.checked ? 'Memory is enabled.' : 'Memory is off; saved history was deleted.';
    showToast('Privacy setting updated.');
  });
}
