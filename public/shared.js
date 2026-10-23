function getSavedUser() {
  try {
    return JSON.parse(localStorage.getItem('sahayakUser') || 'null');
  } catch {
    return null;
  }
}

function setSavedUser(user) {
  const safeUser = {};
  ['id', 'name', 'username', 'category', 'preferredLanguage', 'authMode', 'memoryConsent'].forEach((key) => {
    if (user[key] !== undefined) safeUser[key] = user[key];
  });
  localStorage.setItem('sahayakUser', JSON.stringify(safeUser));
}

function loadRememberedUsername(form) {
  const usernameInput = form.querySelector('[name="loginId"], [name="username"], [name="email"]');
  const rememberCheckbox = form.querySelector('#remember-me');
  const rememberedUsername = localStorage.getItem('sahayakRememberedLogin')
    || localStorage.getItem('sahayakRememberedUsername');

  if (!usernameInput || !rememberCheckbox || !rememberedUsername) return;
  usernameInput.value = rememberedUsername;
  rememberCheckbox.checked = true;
}

function saveRememberedUsername(form) {
  const usernameInput = form.querySelector('[name="loginId"], [name="username"], [name="email"]');
  const rememberCheckbox = form.querySelector('#remember-me');
  if (!usernameInput || !rememberCheckbox) return;

  if (rememberCheckbox.checked) {
    localStorage.setItem('sahayakRememberedLogin', usernameInput.value.trim());
  } else {
    localStorage.removeItem('sahayakRememberedLogin');
    localStorage.removeItem('sahayakRememberedUsername');
  }
}

function getSelectedCategory() {
  return localStorage.getItem('sahayakCategory') || 'SC';
}

function setSelectedCategory(category) {
  localStorage.setItem('sahayakCategory', category);
}

function getSelectedLanguage() {
  return localStorage.getItem('sahayakLanguage') || 'en';
}

function setSelectedLanguage(language) {
  localStorage.setItem('sahayakLanguage', language);
  translatePage(language);
}

const translationTextSources = new WeakMap();
const translationAttributeSources = new WeakMap();
const appliedTextTranslations = new WeakMap();
const appliedAttributeTranslations = new WeakMap();
const translatedNodes = [];
const translatedAttributes = [];
let pageTranslationObserver;
let pageTranslationTimer;
let savedTranslations;
let translationRequestId = 0;
let translationNoticeShown = false;

function getTranslationCache() {
  if (!savedTranslations) {
    try {
      savedTranslations = JSON.parse(localStorage.getItem('sahayakTranslations') || '{}');
    } catch {
      savedTranslations = {};
    }
  }
  return savedTranslations;
}

function saveTranslation(language, source, translation) {
  const cache = getTranslationCache();
  cache[JSON.stringify([language, source])] = translation;
}

function persistTranslationCache() {
  const cache = getTranslationCache();
  const entries = Object.entries(cache);
  if (entries.length > 2000) {
    savedTranslations = Object.fromEntries(entries.slice(-2000));
  }
  try {
    localStorage.setItem('sahayakTranslations', JSON.stringify(savedTranslations));
  } catch {
    if (!translationNoticeShown) {
      translationNoticeShown = true;
      showNotice('Translations are available for this page but could not be saved on this device.');
    }
  }
}

function collectTranslationEntries(root) {
  const entries = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim() || node.parentElement.closest('script, style, textarea, svg, .chat-message.user, [data-no-translate]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) entries.push({ node: walker.currentNode });
  if (root.nodeType === Node.TEXT_NODE && root.nodeValue.trim() && !root.parentElement?.closest('.chat-message.user, [data-no-translate]')) {
    entries.push({ node: root });
  }

  const attributeNames = ['placeholder', 'title', 'aria-label', 'alt'];
  const elements = [];
  if (root.nodeType === Node.ELEMENT_NODE && root.matches('input, textarea, select, button, a, [aria-label], [title], [alt]')) elements.push(root);
  root.querySelectorAll?.('input, textarea, select, button, a, [aria-label], [title], [alt]').forEach((element) => elements.push(element));
  elements.forEach((element) => {
    if (element.closest('[data-no-translate]')) return;
    attributeNames.forEach((name) => {
      if (element.hasAttribute(name)) entries.push({ element, name });
    });
    if (element.matches('input[type="button"], input[type="submit"], input[type="reset"]') && element.hasAttribute('value')) {
      entries.push({ element, name: 'value' });
    }
  });
  return entries;
}

function writeTranslationEntry(entry, value) {
  if (entry.node) {
    entry.node.nodeValue = value;
    appliedTextTranslations.set(entry.node, value);
  } else {
    entry.element.setAttribute(entry.name, value);
    let applied = appliedAttributeTranslations.get(entry.element);
    if (!applied) {
      applied = {};
      appliedAttributeTranslations.set(entry.element, applied);
    }
    applied[entry.name] = value;
  }
}

function chunkTranslationEntries(entries, maxStrings = 80, maxCharacters = 16000) {
  const chunks = [];
  let chunk = [];
  let characters = 0;
  entries.forEach((entry) => {
    const size = entry.source.length;
    if (chunk.length && (chunk.length >= maxStrings || characters + size > maxCharacters)) {
      chunks.push(chunk);
      chunk = [];
      characters = 0;
    }
    chunk.push(entry);
    characters += size;
  });
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

async function translatePage(language = getSelectedLanguage(), root = document.documentElement) {
  const requestId = ++translationRequestId;
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ur' ? 'rtl' : 'ltr';
  const entries = collectTranslationEntries(root).map((entry) => {
    if (entry.node) {
      if (!translationTextSources.has(entry.node)) {
        translationTextSources.set(entry.node, entry.node.nodeValue);
        translatedNodes.push(entry.node);
      }
      entry.source = translationTextSources.get(entry.node);
    } else {
      if (!translationAttributeSources.has(entry.element)) translationAttributeSources.set(entry.element, {});
      const sources = translationAttributeSources.get(entry.element);
      if (sources[entry.name] === undefined) {
        sources[entry.name] = entry.element.getAttribute(entry.name);
        translatedAttributes.push({ element: entry.element, name: entry.name });
      }
      entry.source = sources[entry.name];
    }
    return entry;
  }).filter((entry) => entry.source.trim());

  if (language === 'en') {
    translatedNodes.forEach((node) => {
      if (node.isConnected) writeTranslationEntry({ node }, translationTextSources.get(node));
    });
    translatedAttributes.forEach((entry) => {
      if (entry.element.isConnected) writeTranslationEntry(entry, translationAttributeSources.get(entry.element)[entry.name]);
    });
    return;
  }

  const cache = getTranslationCache();
  const uncachedEntries = entries.filter((entry) => {
    const translation = cache[JSON.stringify([language, entry.source])];
    if (translation === undefined) return true;
    writeTranslationEntry(entry, translation);
    return false;
  });
  const uniqueEntries = [...new Map(uncachedEntries.map((entry) => [entry.source, entry])).values()];
  const entriesBySource = new Map();
  uncachedEntries.forEach((entry) => {
    const matchingEntries = entriesBySource.get(entry.source) || [];
    matchingEntries.push(entry);
    entriesBySource.set(entry.source, matchingEntries);
  });

  for (const batch of chunkTranslationEntries(uniqueEntries)) {
    if (requestId !== translationRequestId) return;
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, strings: batch.map((entry) => entry.source) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Translation unavailable.');
      if (!Array.isArray(result.translations) || result.translations.length !== batch.length
        || result.translations.some((translation) => typeof translation !== 'string' || !translation.trim())) {
        throw new Error('The translation service returned an incomplete result.');
      }
      batch.forEach((entry, index) => {
        const translation = result.translations[index].trim();
        saveTranslation(language, entry.source, translation);
        (entriesBySource.get(entry.source) || []).forEach((candidate) => {
          if (requestId === translationRequestId && language === getSelectedLanguage() && candidate.node?.isConnected !== false && candidate.element?.isConnected !== false) {
            writeTranslationEntry(candidate, translation);
          }
        });
      });
      persistTranslationCache();
    } catch (error) {
      if (language === getSelectedLanguage()) showNotice(error.message || 'Translation is unavailable.');
      return;
    }
  }
}

function observePageTranslations() {
  if (pageTranslationObserver || !document.body) return;
  pageTranslationObserver = new MutationObserver((mutations) => {
    let shouldTranslate = false;
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length) shouldTranslate = true;
      if (mutation.type === 'characterData' && mutation.target.nodeValue !== appliedTextTranslations.get(mutation.target)) {
        translationTextSources.set(mutation.target, mutation.target.nodeValue);
        shouldTranslate = true;
      }
      if (mutation.type === 'attributes') {
        const element = mutation.target;
        const name = mutation.attributeName;
        const value = element.getAttribute(name);
        const applied = appliedAttributeTranslations.get(element);
        if (value !== applied?.[name]) {
          const sources = translationAttributeSources.get(element) || {};
          sources[name] = value;
          translationAttributeSources.set(element, sources);
          shouldTranslate = true;
        }
      }
    });
    if (!shouldTranslate) return;
    clearTimeout(pageTranslationTimer);
    pageTranslationTimer = setTimeout(() => translatePage(getSelectedLanguage()), 250);
  });
  pageTranslationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'title', 'aria-label', 'alt', 'value'],
  });
}

observePageTranslations();
requestAnimationFrame(() => translatePage(getSelectedLanguage()));

async function logoutUser() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    showNotice('Could not contact the server. Local sign-in data was cleared.');
  }
  localStorage.removeItem('sahayakUser');
  localStorage.removeItem('sahayakCategory');
  localStorage.removeItem('sahayakResult');
  sessionStorage.removeItem('sahayakResult');
  window.location.replace('/login.html');
}

function requireAuth() {
  const user = getSavedUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  fetch('/api/health', { credentials: 'same-origin' })
    .then((response) => response.json())
    .then((health) => health.mode === 'supabase'
      ? fetch('/api/auth/me', { credentials: 'same-origin' }).then((response) => {
        if (!response.ok) throw new Error('Session expired');
        return response.json();
      })
      : { user })
    .then((result) => {
      if (result.user) setSavedUser({ ...user, ...result.user });
    })
    .catch(() => {
      localStorage.removeItem('sahayakUser');
      window.location.replace('/login.html');
    });
  return user;
}

function renderUserInfo() {
  const user = getSavedUser();
  if (!user) return;
  const nameNode = document.getElementById('dashboard-user-name');
  const categoryNode = document.getElementById('dashboard-category');
  if (nameNode) nameNode.textContent = user.name || user.username || 'Account';
  if (categoryNode) categoryNode.textContent = getSelectedCategory();
}

function renderCategoryChip() {
  const category = getSelectedCategory();
  const node = document.getElementById('selected-category-chip');
  if (node) node.textContent = `Selected category: ${category}`;
}

function showNotice(message) {
  const node = document.getElementById('status-toast');
  if (!node) return;
  node.textContent = message;
  node.classList.remove('hidden');
  setTimeout(() => node.classList.add('hidden'), 2200);
}

function setResultData(data) {
  sessionStorage.setItem('sahayakResult', JSON.stringify(data));
}

function getResultData() {
  try {
    localStorage.removeItem('sahayakResult');
    return JSON.parse(sessionStorage.getItem('sahayakResult') || 'null');
  } catch {
    return null;
  }
}
