// Fills job application form fields from a profile saved via the options page,
// learns answers to questions it doesn't recognize, and can step through
// multi-page application wizards (Workday "Save and Continue" etc.).
//
// Safety boundary: this script will click "Next"/"Continue"/"Save and
// Continue" buttons on its own, but never "Submit"/"Apply"/"Finish"/"Review" -
// those always require a manual click after you've reviewed the page.

const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['DC', 'District of Columbia'],
];
const STATE_ABBR_TO_NAME = Object.fromEntries(US_STATES.map(([a, n]) => [a.toLowerCase(), n.toLowerCase()]));
const STATE_NAME_TO_ABBR = Object.fromEntries(US_STATES.map(([a, n]) => [n.toLowerCase(), a.toLowerCase()]));

const get = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);

// Questions whose correct answer depends on the specific company/application,
// not on you - e.g. "Have you applied to this company before?" or "How did
// you hear about this role?". These are never auto-filled and never learned,
// so the auto-progress loop always pauses and asks you fresh each time.
const PER_APPLICATION_RE = /this (company|organization|employer|position|role|job)|applied (to|for|with).*(before|previously)|previously applied|worked (for|at).*(before|previously)|previously (worked|employed)|relatives?.*(work|employ)|family member.*(work|employ)|how did you (hear|learn)|where did you (hear|learn)|referral source|conflict of interest|non-?compete/i;

function isPerApplicationQuestion(text) {
  return PER_APPLICATION_RE.test(text);
}

// Order matters: matchField returns the FIRST entry whose pattern matches and
// whose getter returns a non-empty value, so put specific patterns before
// broad fallbacks (e.g. first/last name before the generic "name" fallback).
const FIELD_MAP = [
  { patterns: [/first\s*name|given\s*name/i], kinds: ['text'], get: p => get(p, 'personal.firstName') },
  { patterns: [/middle\s*name/i], kinds: ['text'], get: p => get(p, 'personal.middleName') },
  { patterns: [/last\s*name|family\s*name|surname/i], kinds: ['text'], get: p => get(p, 'personal.lastName') },

  { patterns: [/date of birth|birth\s*date|^dob$/i], kinds: ['text'], get: p => get(p, 'personal.dob') },
  { patterns: [/e-?mail/i], kinds: ['text'], get: p => get(p, 'personal.email') },
  { patterns: [/phone|mobile|cell/i], kinds: ['text'], get: p => get(p, 'personal.phone') },
  { patterns: [/linkedin/i], kinds: ['text'], get: p => get(p, 'personal.linkedin') },
  { patterns: [/github/i], kinds: ['text'], get: p => get(p, 'personal.github') },
  { patterns: [/portfolio|personal\s*website|personal\s*site/i], kinds: ['text'], get: p => get(p, 'personal.website') },

  { patterns: [/address\s*line\s*2|apartment|apt\.?\s*\/?\s*suite|unit\s*number/i], kinds: ['text'], get: p => get(p, 'personal.addressLine2') },
  { patterns: [/address\s*line\s*1|street\s*address|^address$/i], kinds: ['text'], get: p => get(p, 'personal.addressLine1') },
  { patterns: [/city|town/i], kinds: ['text'], get: p => get(p, 'personal.city') },
  { patterns: [/state|province|region/i], kinds: ['text', 'select'], get: p => get(p, 'personal.state') },
  { patterns: [/zip|postal/i], kinds: ['text'], get: p => get(p, 'personal.zip') },
  { patterns: [/country/i], kinds: ['text', 'select'], get: p => get(p, 'personal.country') },

  { patterns: [/school|university|college|institution/i], kinds: ['text'], get: p => get(p, 'education.school') },
  { patterns: [/degree/i], kinds: ['text', 'select'], get: p => get(p, 'education.degree') },
  { patterns: [/field\s*of\s*study|major|discipline/i], kinds: ['text'], get: p => get(p, 'education.fieldOfStudy') },
  { patterns: [/gpa|grade\s*point/i], kinds: ['text'], get: p => get(p, 'education.gpa') },

  { patterns: [/employer|company\s*name|organization\s*name/i], kinds: ['text'], get: p => get(p, 'experience.company') },
  { patterns: [/job\s*title|current\s*title|most\s*recent\s*title|position\s*title/i], kinds: ['text'], get: p => get(p, 'experience.title') },

  { patterns: [/desired\s*salary|salary\s*expectation|expected\s*salary|compensation\s*expectation/i], kinds: ['text'], get: p => get(p, 'workAuth.desiredSalary') },
  { patterns: [/available to start|start date|when (can|could|would) you (be able to )?start|notice period/i], kinds: ['text'], get: p => get(p, 'workAuth.startDate') },
  { patterns: [/summary|objective|about\s*you|tell us about yourself/i], kinds: ['text'], get: p => get(p, 'personal.summary') },

  // Yes/No and multiple-choice style questions (radio groups or selects).
  { patterns: [/authorized to (lawfully )?work/i], kinds: ['choice', 'select'], get: p => get(p, 'workAuth.authorizedToWorkUS') },
  { patterns: [/require.*sponsorship|sponsorship.*(now|future|order to)/i], kinds: ['choice', 'select'], get: p => get(p, 'workAuth.requireSponsorship') },
  { patterns: [/18 years/i], kinds: ['choice', 'select'], get: p => get(p, 'workAuth.over18') },
  { patterns: [/willing to relocate|relocation/i], kinds: ['choice', 'select'], get: p => get(p, 'workAuth.willingToRelocate') },
  { patterns: [/gender|^sex$/i], kinds: ['choice', 'select'], get: p => get(p, 'eeo.gender') },
  { patterns: [/race|ethnicity/i], kinds: ['choice', 'select'], get: p => get(p, 'eeo.race') },
  { patterns: [/veteran/i], kinds: ['choice', 'select'], get: p => get(p, 'eeo.veteranStatus') },
  { patterns: [/disability/i], kinds: ['choice', 'select'], get: p => get(p, 'eeo.disabilityStatus') },

  // Generic single "Name" field - lowest priority so it never shadows the
  // first/last/company/school "name" patterns above.
  { patterns: [/^name$|full\s*name|your name/i], kinds: ['text'], get: p => `${get(p, 'personal.firstName') || ''} ${get(p, 'personal.lastName') || ''}`.trim() },
];

const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'will', 'would', 'do', 'does', 'did',
  'you', 'your', 'yours', 'please', 'what', 'which', 'how', 'of', 'to', 'for', 'in', 'on', 'at', 'this', 'that',
  'if', 'any', 'have', 'has', 'had', 'be', 'been', 'can', 'could', 'i', 'my', 'me', 'we', 'our', 'and', 'or']);

function humanize(str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cssEscape(id) {
  return window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/([^\w-])/g, '\\$1');
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

// True for elements that are part of this extension's own injected UI (the
// STOP panel, Learn-mode buttons/popovers) - these should never be treated
// as page form fields by the scanners below.
function isOwnUI(el) {
  return !!el.closest('[data-ja-ui]');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Resolves once the DOM has been quiet for `idleMs`, or after `maxMs` total.
function waitForIdle(maxMs = 4000, idleMs = 500) {
  return new Promise(resolve => {
    let timer;
    const finish = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(maxTimer); resolve(); };
    const reset = () => { clearTimeout(timer); timer = setTimeout(finish, idleMs); };
    const observer = new MutationObserver(reset);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    const maxTimer = setTimeout(finish, maxMs);
    reset();
  });
}

function getLabelText(el) {
  const parts = [];
  if (el.id) {
    const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (label) parts.push(label.textContent);
  }
  const parentLabel = el.closest('label');
  if (parentLabel) parts.push(parentLabel.textContent);
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) parts.push(ariaLabel);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    labelledBy.split(/\s+/).forEach(id => {
      const ref = document.getElementById(id);
      if (ref) parts.push(ref.textContent);
    });
  }
  if (el.placeholder) parts.push(el.placeholder);
  if (el.name) parts.push(humanize(el.name));
  const automationId = el.getAttribute('data-automation-id');
  if (automationId) parts.push(humanize(automationId));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Some ATSes (Workday in particular) label every radio/checkbox group with a
// generic description of the *answer type* - "Multiple Choice Response",
// "Single Select Response" - via the fieldset legend or aria-labelledby,
// rather than the actual question wording. If we trusted that text, every
// such question would normalize to the same string and collide in the
// learned-answers DB (one entry overwriting another). Treat these as "not a
// real question" and keep looking.
const GENERIC_GROUP_LABEL_RE = /^(multiple\s*choice|single\s*select|short\s*answer|free\s*text|long\s*text|yes\s*\/?\s*no)(\s*(response|answer|question))?$/i;

// Walks up from `container`, checking earlier siblings at each level for
// text that looks like the actual question - i.e. not one of the group's
// own option labels, not the generic answer-type text above, and a
// plausible question length.
function findPrecedingQuestionText(container, group) {
  const optionTexts = new Set(group.map(g => normalize(getLabelText(g))));
  let node = container;
  for (let depth = 0; node && depth < 5; depth++) {
    let sib = node.previousElementSibling;
    while (sib) {
      if (isVisible(sib) && !isOwnUI(sib)) {
        const text = sib.textContent.trim();
        if (text.length > 3 && text.length < 300 && !GENERIC_GROUP_LABEL_RE.test(text) && !optionTexts.has(normalize(text))) {
          return text;
        }
      }
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
  }
  return null;
}

function getGroupQuestionText(group) {
  const el = group[0];
  const fieldset = el.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    const legendText = legend && legend.textContent.trim();
    if (legendText && !GENERIC_GROUP_LABEL_RE.test(legendText)) return legendText;
  }
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy.split(/\s+/)[0]);
    const refText = ref && ref.textContent.trim();
    if (refText && !GENERIC_GROUP_LABEL_RE.test(refText)) return refText;
  }
  const container = fieldset || el.closest('[role="radiogroup"], [role="group"]') || el.parentElement;
  if (container) {
    const preceding = findPrecedingQuestionText(container, group);
    if (preceding) return preceding;
  }
  if (el.name && !GENERIC_GROUP_LABEL_RE.test(humanize(el.name))) return humanize(el.name);
  return getLabelText(el);
}

function matchField(labelText, kind, profile) {
  const text = labelText.toLowerCase();
  if (!text) return null;
  for (const entry of FIELD_MAP) {
    if (!entry.kinds.includes(kind)) continue;
    if (entry.patterns.some(re => re.test(text))) {
      const value = entry.get(profile);
      if (value) return String(value);
    }
  }
  return null;
}

// Fuzzy-matches a question against the learned-answers DB: exact normalized
// match first, then best token-overlap match (>= 60% of the smaller set).
function matchLearned(labelText, learned) {
  if (isPerApplicationQuestion(labelText)) return null;
  const norm = normalize(labelText);
  if (!norm) return null;
  if (learned[norm]) return learned[norm].value;

  const tokens = new Set(norm.split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w)));
  if (tokens.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const [key, entry] of Object.entries(learned)) {
    const keyTokens = new Set(key.split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w)));
    if (keyTokens.size === 0) continue;
    const overlap = [...keyTokens].filter(t => tokens.has(t)).length;
    const score = overlap / Math.max(keyTokens.size, tokens.size);
    if (score > bestScore) {
      bestScore = score;
      best = entry.value;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

// Checks the manually-added regex rules (options page -> "Regex learned
// answers"). Each rule has a question pattern (tested against the field's
// full label/question text) and an answer pattern (tested against each
// choice/option's text to pick which one to select). Returns
// { regex, flags } for the answer side, or null if no rule's question
// pattern matches. Only useful for choice/select kinds - there's no single
// literal value to type into a text field.
function matchLearnedRegex(labelText, learnedRegex) {
  if (isPerApplicationQuestion(labelText)) return null;
  for (const entry of learnedRegex || []) {
    try {
      const qRe = new RegExp(entry.questionPattern, entry.flags || 'i');
      if (qRe.test(labelText)) return { regex: entry.answerPattern, flags: entry.flags || 'i' };
    } catch (e) { /* invalid regex saved - skip it */ }
  }
  return null;
}

function saveLearned(labelText, value) {
  if (isPerApplicationQuestion(labelText)) return Promise.resolve();
  const norm = normalize(labelText);
  if (!norm || norm.length < 3 || !value) return Promise.resolve();
  return new Promise(resolve => {
    chrome.storage.local.get('learned', (data) => {
      const learned = data.learned || {};
      learned[norm] = { label: labelText.trim().slice(0, 200), value: value.slice(0, 500) };
      chrome.storage.local.set({ learned }, () => resolve(learned));
    });
  });
}

// Significant (non-stopword, length > 2) tokens of a question's text -
// shared by the learned-answer matcher and the regex-rule suggester.
function significantTokens(text) {
  return new Set(normalize(text).split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w)));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// After teaching a choice/select answer, checks whether other learned
// questions with the same answer share enough wording to suggest a single
// regex rule covering all of them (Learn-mode "did you mean to generalize
// this?" prompt).
function suggestRegexRule(questionText, value, learned) {
  const newTokens = significantTokens(questionText);
  if (newTokens.size === 0) return null;
  const valNorm = value.trim().toLowerCase();

  const shared = new Set();
  let matchedCount = 0;
  for (const entry of Object.values(learned || {})) {
    if (entry.value.trim().toLowerCase() !== valNorm) continue;
    const keyTokens = significantTokens(entry.label || '');
    const overlap = [...keyTokens].filter(t => newTokens.has(t));
    if (overlap.length === 0) continue;
    const score = overlap.length / Math.min(keyTokens.size, newTokens.size);
    if (score < 0.4) continue;
    matchedCount++;
    overlap.forEach(t => shared.add(t));
  }
  if (matchedCount === 0 || shared.size === 0) return null;

  return {
    questionPattern: [...shared].map(escapeRegex).join('|'),
    answerPattern: `\\b${escapeRegex(value.trim())}\\b`,
    flags: 'i',
    matchedCount,
    answerValue: value.trim(),
  };
}

function loadData() {
  return new Promise(resolve => {
    chrome.storage.local.get(['profile', 'learned', 'learnedRegex'], (data) => {
      resolve({ profile: data.profile || {}, learned: data.learned || {}, learnedRegex: data.learnedRegex || [] });
    });
  });
}

function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function selectOption(select, target) {
  const t = target.trim().toLowerCase();
  const candidates = [t, STATE_ABBR_TO_NAME[t], STATE_NAME_TO_ABBR[t]].filter(Boolean);
  const options = Array.from(select.options);

  let opt = options.find(o => candidates.includes(o.value.trim().toLowerCase()) || candidates.includes(o.text.trim().toLowerCase()));
  if (!opt) {
    opt = options.find(o => {
      const text = o.text.trim().toLowerCase();
      return text && candidates.some(c => text.includes(c) || c.includes(text));
    });
  }
  if (!opt || opt.disabled) return false;

  select.value = opt.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

// Picks the first option whose visible text matches `pattern` (a regex from
// a manual "Regex learned answer" rule).
function selectOptionByRegex(select, pattern, flags) {
  let re;
  try { re = new RegExp(pattern, flags); } catch (e) { return false; }
  const opt = Array.from(select.options).find(o => !o.disabled && re.test(o.text.trim()));
  if (!opt) return false;

  select.value = opt.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

// Many "state"/"country"-style fields aren't a real <select> - they're a text
// <input> that opens a popup listbox as you type (a combobox). Setting the
// input's value alone doesn't register a selection with the site's own JS,
// so it looks filled but the page treats it as empty/invalid. Detect that
// pattern and click the matching option in the popup after typing.
function isCombobox(el) {
  return el.tagName === 'INPUT' && (
    el.getAttribute('role') === 'combobox'
    || el.hasAttribute('aria-autocomplete')
    || el.getAttribute('aria-haspopup') === 'listbox'
  );
}

function getComboboxListbox(el) {
  const ids = (el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '').split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const ref = document.getElementById(id);
    if (ref) return ref;
  }
  return document.querySelector('[role="listbox"]');
}

// Waits (briefly, repeatedly) for the popup to render its options, then clicks
// the one matching `target`. Returns true if an option was clicked.
async function selectComboboxOption(el, target) {
  const t = target.trim().toLowerCase();
  const candidates = [t, STATE_ABBR_TO_NAME[t], STATE_NAME_TO_ABBR[t]].filter(Boolean);

  for (let i = 0; i < 10; i++) {
    await sleep(150);
    const listbox = getComboboxListbox(el);
    if (listbox) {
      const options = Array.from(listbox.querySelectorAll('[role="option"], li'));
      const opt = options.find(o => {
        const text = o.textContent.trim().toLowerCase();
        return text && candidates.some(c => text === c || text.includes(c) || c.includes(text));
      });
      if (opt) {
        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type => {
          opt.dispatchEvent(new MouseEvent(type, { bubbles: true }));
        });
        return true;
      }
    }
  }
  return false;
}

function applyChoice(group, targetText) {
  const target = targetText.trim().toLowerCase();
  for (const el of group) {
    const optionText = getLabelText(el).trim().toLowerCase();
    if (!optionText) continue;
    if (optionText === target || optionText.includes(target) || target.includes(optionText)) {
      if (!el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('click', { bubbles: true }));
      }
      return true;
    }
  }
  return false;
}

// Checks each option's visible text against `pattern` (a regex from a manual
// "Regex learned answer" rule) and selects the first one that matches.
function applyChoiceByRegex(group, pattern, flags) {
  let re;
  try { re = new RegExp(pattern, flags); } catch (e) { return false; }
  for (const el of group) {
    const optionText = getLabelText(el).trim();
    if (!optionText || !re.test(optionText)) continue;
    if (!el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('click', { bubbles: true }));
    }
    return true;
  }
  return false;
}

const HIGHLIGHT_COLORS = { filled: '#34a853', error: '#ea4335' };

function highlight(el, kind = 'filled') {
  const original = el.style.outline;
  el.style.outline = `2px solid ${HIGHLIGHT_COLORS[kind]}`;
  if (kind !== 'error') {
    setTimeout(() => { el.style.outline = original; }, 2500);
  }
}

// Returns { filled, pending }: `filled` is a synchronous count, `pending` is
// a list of promises for combobox option-selection that finish shortly after
// (callers should await these before treating the form as settled).
function fillForm(profile, learned, learnedRegex) {
  let filled = 0;
  const pending = [];
  const handledRadioGroups = new Set();
  const fields = document.querySelectorAll('input, select, textarea');

  fields.forEach(el => {
    if (el.disabled || el.readOnly || isOwnUI(el)) return;
    if (['hidden', 'submit', 'button', 'file', 'image', 'reset'].includes(el.type)) return;

    if (el.type === 'radio' || el.type === 'checkbox') {
      const groupKey = el.name || el.id;
      if (!groupKey || handledRadioGroups.has(groupKey)) return;
      handledRadioGroups.add(groupKey);
      const group = el.name ? Array.from(document.getElementsByName(el.name)) : [el];
      const questionText = getGroupQuestionText(group);
      const target = matchField(questionText, 'choice', profile) || matchLearned(questionText, learned);
      if (target && applyChoice(group, target)) {
        group.forEach(g => highlight(g, 'filled'));
        filled++;
        return;
      }
      const regexTarget = matchLearnedRegex(questionText, learnedRegex);
      if (regexTarget && applyChoiceByRegex(group, regexTarget.regex, regexTarget.flags)) {
        group.forEach(g => highlight(g, 'filled'));
        filled++;
      }
      return;
    }

    const labelText = getLabelText(el);

    if (el.tagName === 'SELECT') {
      if (el.value) return;
      const target = matchField(labelText, 'select', profile) || matchLearned(labelText, learned);
      if (target && selectOption(el, target)) {
        highlight(el, 'filled');
        filled++;
        return;
      }
      const regexTarget = matchLearnedRegex(labelText, learnedRegex);
      if (regexTarget && selectOptionByRegex(el, regexTarget.regex, regexTarget.flags)) {
        highlight(el, 'filled');
        filled++;
      }
      return;
    }

    if (el.value) return; // don't clobber fields the user already filled
    // "select"-kind patterns (state, country, degree, etc.) also count for
    // text inputs, since the same question can render as a real <select> or
    // as a combobox text input depending on the site.
    const target = matchField(labelText, 'text', profile) || matchField(labelText, 'select', profile) || matchLearned(labelText, learned);
    if (target) {
      setNativeValue(el, target);
      highlight(el, 'filled');
      filled++;
      if (isCombobox(el)) pending.push(selectComboboxOption(el, target));
    }
  });

  return { filled, pending };
}

// Finds fields/groups that fillForm would leave untouched: nothing in
// FIELD_MAP, the learned DB, or the regex rules matches, and the field is
// still empty/unselected. Used by Learn mode to offer a "🎓 Learn" button
// next to each one. Lone checkboxes (agreements, not multiple-choice
// questions) and per-application questions (always answered fresh) are
// skipped.
function findUnansweredFields(profile, learned, learnedRegex) {
  const results = [];
  const handledRadioGroups = new Set();
  const fields = document.querySelectorAll('input, select, textarea');

  fields.forEach(el => {
    if (el.disabled || el.readOnly || !isVisible(el) || isOwnUI(el)) return;
    if (['hidden', 'submit', 'button', 'file', 'image', 'reset'].includes(el.type)) return;

    if (el.type === 'radio' || el.type === 'checkbox') {
      const groupKey = el.name || el.id;
      if (!groupKey || handledRadioGroups.has(groupKey)) return;
      handledRadioGroups.add(groupKey);
      const group = el.name ? Array.from(document.getElementsByName(el.name)) : [el];
      if (group.length < 2) return; // lone checkbox, not a multiple-choice question
      if (group.some(g => g.checked)) return; // already answered
      const questionText = getGroupQuestionText(group);
      if (!questionText || isPerApplicationQuestion(questionText)) return;
      if (matchField(questionText, 'choice', profile) || matchLearned(questionText, learned) || matchLearnedRegex(questionText, learnedRegex)) return;
      results.push({ kind: 'choice', group, questionText, anchor: group[group.length - 1] });
      return;
    }

    const labelText = getLabelText(el);
    if (!labelText || isPerApplicationQuestion(labelText)) return;

    if (el.tagName === 'SELECT') {
      if (el.value) return;
      if (matchField(labelText, 'select', profile) || matchLearned(labelText, learned) || matchLearnedRegex(labelText, learnedRegex)) return;
      results.push({ kind: 'select', el, questionText: labelText, anchor: el });
      return;
    }

    if (el.value) return;
    if (matchField(labelText, 'text', profile) || matchField(labelText, 'select', profile) || matchLearned(labelText, learned)) return;
    results.push({ kind: 'text', el, questionText: labelText, anchor: el });
  });

  return results;
}

// Whenever the user manually answers a field, remember it so the same
// question (by wording) gets auto-filled next time. Per-application
// questions (see PER_APPLICATION_RE) are skipped by saveLearned itself.
function attachLearningListeners() {
  document.querySelectorAll('input, select, textarea').forEach(el => {
    if (el.dataset.jaListening) return;
    el.dataset.jaListening = '1';
    el.addEventListener('change', () => {
      if (el.type === 'radio' || el.type === 'checkbox') {
        if (!el.checked) return;
        const group = el.name ? Array.from(document.getElementsByName(el.name)) : [el];
        const q = getGroupQuestionText(group);
        const v = getLabelText(el).trim();
        if (q && v) saveLearned(q, v);
        return;
      }
      const q = getLabelText(el);
      const v = (el.value || '').trim();
      if (q && v) saveLearned(q, v);
    });
  });
}

// --- Auto-progression -------------------------------------------------

function visibleText(el) {
  return (el.value || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const NEXT_RE = /^(next|continue|next step|save and continue|save & continue|continue application)$/;
const SUBMIT_RE = /^(submit|submit application|apply|apply now|finish|finish application|review application|review and submit|done)$/;

function findActionButton(matchRe, excludeRe) {
  const candidates = document.querySelectorAll('button, [role="button"], a, input[type="submit"], input[type="button"]');
  for (const el of candidates) {
    if (!isVisible(el) || el.disabled) continue;
    const text = visibleText(el);
    if (!text) continue;
    if (excludeRe && excludeRe.test(text)) continue;
    if (matchRe.test(text)) return el;
  }
  return null;
}

function findNextButton() {
  return findActionButton(NEXT_RE, SUBMIT_RE);
}

function findSubmitButton() {
  return findActionButton(SUBMIT_RE);
}

const REQUIRED_TEXT_RE = /this field is required|is required\.?$|please (enter|select|complete|provide|choose)/i;

function findValidationErrors() {
  const seen = new Set();
  const errors = [];

  document.querySelectorAll('[aria-invalid="true"]').forEach(el => {
    if (isOwnUI(el)) return;
    if (isVisible(el) && !seen.has(el)) { seen.add(el); errors.push(el); }
  });

  document.querySelectorAll('[role="alert"]').forEach(el => {
    if (isOwnUI(el)) return;
    if (isVisible(el) && el.textContent.trim() && !seen.has(el)) { seen.add(el); errors.push(el); }
  });

  document.querySelectorAll('span, div, p, li').forEach(el => {
    if (isOwnUI(el)) return;
    if (el.children.length > 0) return; // leaf nodes only
    const text = el.textContent.trim();
    if (text && REQUIRED_TEXT_RE.test(text) && isVisible(el) && !seen.has(el)) { seen.add(el); errors.push(el); }
  });

  return errors;
}

function describeError(el) {
  if (el.matches('input, select, textarea')) return getLabelText(el) || el.name || 'a field';
  if (el.id) {
    const field = document.querySelector(`[aria-describedby~="${cssEscape(el.id)}"]`);
    if (field) return getLabelText(field) || el.textContent.trim().slice(0, 80);
  }
  return el.textContent.trim().slice(0, 80) || 'a field';
}

// Catches "silent" validation errors that don't use aria-invalid, role="alert",
// or "required"-style text - e.g. a site that just turns a field's border red
// and shows a custom-styled message via its own CSS classes.
const ERROR_CLASS_RE = /error|invalid|danger/i;

function isReddish(color) {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  const [r, g, b] = m.slice(1).map(Number);
  return r > 140 && r - g > 40 && r - b > 40;
}

function findSilentErrors() {
  const seen = new Set();
  const errors = [];

  document.querySelectorAll('input, select, textarea').forEach(el => {
    if (!isVisible(el) || seen.has(el) || isOwnUI(el)) return;
    if (el.getAttribute('aria-invalid') === 'true') return; // already caught by findValidationErrors
    const cls = (el.className || '') + ' ' + (el.closest('[class]')?.className || '');
    const border = window.getComputedStyle(el).borderColor;
    if (ERROR_CLASS_RE.test(cls) || isReddish(border)) {
      seen.add(el);
      errors.push(el);
    }
  });

  document.querySelectorAll('[class]').forEach(el => {
    if (el.children.length > 0 || seen.has(el) || isOwnUI(el)) return; // leaf nodes only
    const text = el.textContent.trim();
    if (!text || !isVisible(el)) return;
    if (ERROR_CLASS_RE.test(el.className)) { seen.add(el); errors.push(el); }
  });

  return errors;
}

// A cheap fingerprint of the current step: URL, nearest heading, and the
// labels of every visible field. Used to detect "Next" clicks that silently
// do nothing (no page change, no error markers we already recognize).
function stepSignature() {
  const heading = document.querySelector('h1, h2, h3');
  const headingText = heading ? heading.textContent.trim() : '';
  const fields = Array.from(document.querySelectorAll('input, select, textarea'))
    .filter(isVisible)
    .filter(el => !isOwnUI(el))
    .map(getLabelText);
  return `${location.href}::${headingText}::${fields.join('|')}`;
}

const AUTO_FLAG = 'jobAutofillAutoActive';
let autoRunning = false;
let lastStatus = { state: 'idle' };
let panelEl = null;

// Single fixed bottom-right panel: status text + a big red kill switch while
// running, or a small dismiss button while paused/stopped.
function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.setAttribute('data-ja-ui', '1');
  panelEl.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;'
    + 'background:#202124;color:#fff;padding:12px;border-radius:10px;'
    + 'font:13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);'
    + 'width:260px;text-align:center;';

  const status = document.createElement('div');
  status.id = 'ja-status-text';
  status.style.cssText = 'margin-bottom:8px;text-align:left;line-height:1.4;';
  panelEl.appendChild(status);

  const stopBtn = document.createElement('button');
  stopBtn.id = 'ja-stop-btn';
  stopBtn.textContent = '⏹ STOP AUTOFILL';
  stopBtn.style.cssText = 'width:100%;background:#d32f2f;color:#fff;border:none;'
    + 'border-radius:8px;padding:14px;font:bold 15px system-ui,sans-serif;cursor:pointer;';
  stopBtn.addEventListener('click', stopAuto);
  panelEl.appendChild(stopBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.id = 'ja-dismiss-btn';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.style.cssText = 'width:100%;margin-top:6px;background:#444;color:#fff;border:none;'
    + 'border-radius:6px;padding:6px;font:12px system-ui,sans-serif;cursor:pointer;display:none;';
  dismissBtn.addEventListener('click', hidePanel);
  panelEl.appendChild(dismissBtn);

  document.body.appendChild(panelEl);
  return panelEl;
}

function showRunning(text) {
  const panel = ensurePanel();
  panel.querySelector('#ja-status-text').textContent = text;
  panel.querySelector('#ja-stop-btn').style.display = 'block';
  panel.querySelector('#ja-dismiss-btn').style.display = 'none';
}

function showPaused(text) {
  const panel = ensurePanel();
  panel.querySelector('#ja-status-text').textContent = text;
  panel.querySelector('#ja-stop-btn').style.display = 'none';
  panel.querySelector('#ja-dismiss-btn').style.display = 'block';
}

function hidePanel() {
  if (panelEl) { panelEl.remove(); panelEl = null; }
}

async function autoProgress() {
  if (autoRunning) return;
  autoRunning = true;
  sessionStorage.setItem(AUTO_FLAG, '1');
  lastStatus = { state: 'running' };
  showRunning('Auto-fill running...');

  const MAX_STEPS = 25;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (!autoRunning) return;
    await waitForIdle();
    if (!autoRunning) return;

    const { profile, learned, learnedRegex } = await loadData();
    if (!autoRunning) return;
    const { pending } = fillForm(profile, learned, learnedRegex);
    attachLearningListeners();
    await Promise.all(pending);
    await sleep(300);
    if (!autoRunning) return;

    let errors = findValidationErrors();
    if (errors.length) return pauseAuto('error', errors);

    if (findSubmitButton()) return pauseAuto('ready-to-submit');

    const next = findNextButton();
    if (!next) return pauseAuto('no-next-button');

    const before = stepSignature();
    showRunning(`Auto-fill running... (step ${step + 1})`);
    next.click();
    await waitForIdle();
    if (!autoRunning) return;
    await sleep(300);
    if (!autoRunning) return;

    errors = findValidationErrors();
    if (errors.length) return pauseAuto('error', errors);

    // Next/Continue didn't navigate and the page looks the same - likely a
    // validation error the site shows in a way we don't normally recognize.
    if (stepSignature() === before) {
      const silent = findSilentErrors();
      if (silent.length) return pauseAuto('silent-error', silent);
      return pauseAuto('stuck');
    }
  }
  pauseAuto('max-steps');
}

function pauseAuto(reason, errorEls = []) {
  autoRunning = false;
  sessionStorage.removeItem(AUTO_FLAG);
  const questions = errorEls.map(describeError);
  lastStatus = { state: 'paused', reason, questions };
  errorEls.forEach(el => highlight(el, 'error'));

  const messages = {
    'error': `Stopped - needs your input: ${questions.join(', ')}. Fill it in, then click "Auto-fill & Continue" again.`,
    'silent-error': `Stopped - clicking Next/Continue didn't move on, and this looks wrong: ${questions.join(', ')}. Fix it, then click "Auto-fill & Continue" again.`,
    'stuck': 'Stopped - clicking Next/Continue didn\'t change the page and no error was found. Check the page manually - something may be silently invalid.',
    'ready-to-submit': 'Filled - review the page and click Submit/Apply yourself.',
    'no-next-button': 'No Next/Continue button found - check the page manually.',
    'max-steps': 'Stopped after 25 steps as a safety limit.',
  };
  showPaused(messages[reason] || 'Stopped.');
}

function stopAuto() {
  autoRunning = false;
  sessionStorage.removeItem(AUTO_FLAG);
  lastStatus = { state: 'stopped' };
  hidePanel();
}

// --- Learn mode -----------------------------------------------------------
// Lets the user manually teach an answer for any field the matcher couldn't
// fill - a small "🎓 Learn" button appears next to each unanswered field;
// clicking it shows the exact question text the matcher will use, plus the
// real on-page options (for choice/select fields) or a text box, so the
// saved answer is guaranteed to be valid for that field.

let learnModeActive = false;
let learnButtons = [];
let learnPopoverEl = null;
let learnPanelEl = null;
let learnObserver = null;
let learnRescanTimer = null;

function closeLearnPopover() {
  if (learnPopoverEl) { learnPopoverEl.remove(); learnPopoverEl = null; }
}

function clearLearnButtons() {
  learnButtons.forEach(b => b.remove());
  learnButtons = [];
  closeLearnPopover();
}

function showLearnPanel(count) {
  if (!learnPanelEl) {
    learnPanelEl = document.createElement('div');
    learnPanelEl.setAttribute('data-ja-ui', '1');
    learnPanelEl.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483647;'
      + 'background:#202124;color:#fff;padding:10px 12px;border-radius:8px;'
      + 'font:13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);max-width:260px;';
    const text = document.createElement('div');
    text.id = 'ja-learn-text';
    text.style.cssText = 'margin-bottom:6px;line-height:1.4;';
    learnPanelEl.appendChild(text);
    const off = document.createElement('button');
    off.textContent = 'Turn off Learn mode';
    off.style.cssText = 'width:100%;background:#444;color:#fff;border:none;border-radius:6px;padding:6px;font-size:12px;cursor:pointer;';
    off.addEventListener('click', () => setLearnMode(false));
    learnPanelEl.appendChild(off);
    document.body.appendChild(learnPanelEl);
  }
  learnPanelEl.querySelector('#ja-learn-text').textContent = count > 0
    ? `🎓 Learn mode - ${count} unanswered field${count === 1 ? '' : 's'} found. Click a yellow "🎓 Learn" button to teach an answer.`
    : '🎓 Learn mode - everything visible looks answered.';
}

function hideLearnPanel() {
  if (learnPanelEl) { learnPanelEl.remove(); learnPanelEl = null; }
}

function applyAnswerToField(item, value) {
  if (item.kind === 'choice') {
    applyChoice(item.group, value);
    item.group.forEach(g => highlight(g, 'filled'));
  } else if (item.kind === 'select') {
    selectOption(item.el, value);
    highlight(item.el, 'filled');
  } else {
    setNativeValue(item.el, value);
    highlight(item.el, 'filled');
  }
}

function rescanLearnMode() {
  if (!learnModeActive) return;
  setTimeout(scanLearnMode, 400);
}

// Shown right after saving a choice/select answer, if other learned
// questions with the same answer share enough wording to suggest a single
// regex rule covering all of them.
function showRegexSuggestion(suggestion, item) {
  closeLearnPopover();
  const rect = item.anchor.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.setAttribute('data-ja-ui', '1');
  pop.style.cssText = 'position:fixed;z-index:2147483646;background:#fff;color:#202124;'
    + 'border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);'
    + 'padding:10px;font:13px system-ui,sans-serif;width:300px;max-height:80vh;overflow:auto;'
    + `top:${Math.max(0, Math.min(rect.bottom + 4, window.innerHeight - 10))}px;left:${Math.max(0, Math.min(rect.left, window.innerWidth - 310))}px;`;

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:bold;margin-bottom:4px;';
  const n = suggestion.matchedCount;
  title.textContent = `Saved! This looks similar to ${n} other question${n === 1 ? '' : 's'} you answered "${suggestion.answerValue}" to.`;
  pop.appendChild(title);

  const note = document.createElement('div');
  note.style.cssText = 'font-size:11px;color:#666;margin:4px 0;';
  note.textContent = 'Add a regex rule so similarly-worded questions get this answer automatically?';
  pop.appendChild(note);

  const qLabel = document.createElement('label');
  qLabel.style.cssText = 'display:block;font-size:11px;color:#666;margin-top:4px;';
  qLabel.textContent = 'Question pattern:';
  pop.appendChild(qLabel);
  const qInput = document.createElement('input');
  qInput.value = suggestion.questionPattern;
  qInput.style.cssText = 'width:100%;box-sizing:border-box;font-family:monospace;font-size:12px;';
  pop.appendChild(qInput);

  const aLabel = document.createElement('label');
  aLabel.style.cssText = 'display:block;font-size:11px;color:#666;margin-top:4px;';
  aLabel.textContent = 'Answer pattern:';
  pop.appendChild(aLabel);
  const aInput = document.createElement('input');
  aInput.value = suggestion.answerPattern;
  aInput.style.cssText = 'width:100%;box-sizing:border-box;font-family:monospace;font-size:12px;';
  pop.appendChild(aInput);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'margin-top:8px;display:flex;gap:6px;';

  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add rule';
  addBtn.style.cssText = 'background:#1a73e8;color:#fff;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;';
  addBtn.addEventListener('click', async () => {
    try {
      new RegExp(qInput.value, suggestion.flags);
      new RegExp(aInput.value, suggestion.flags);
    } catch (e) {
      alert(`Invalid regex: ${e.message}`);
      return;
    }
    const { learnedRegex } = await loadData();
    learnedRegex.push({ questionPattern: qInput.value, answerPattern: aInput.value, flags: suggestion.flags });
    await new Promise(resolve => chrome.storage.local.set({ learnedRegex }, resolve));
    rescanLearnMode();
  });

  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Skip';
  skipBtn.style.cssText = 'background:#eee;color:#333;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;';
  skipBtn.addEventListener('click', rescanLearnMode);

  btnRow.append(addBtn, skipBtn);
  pop.appendChild(btnRow);

  document.body.appendChild(pop);
  learnPopoverEl = pop;
}

async function saveLearnedAnswer(item, questionText, value) {
  if (!value) return;
  const { learned: oldLearned } = await loadData();
  const suggestion = (item.kind === 'choice' || item.kind === 'select')
    ? suggestRegexRule(questionText, value, oldLearned)
    : null;

  await saveLearned(questionText, value);
  applyAnswerToField(item, value);

  if (suggestion) {
    showRegexSuggestion(suggestion, item);
  } else {
    closeLearnPopover();
    rescanLearnMode();
  }
}

function openLearnPopover(item, anchorBtn) {
  closeLearnPopover();
  const rect = anchorBtn.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.setAttribute('data-ja-ui', '1');
  pop.style.cssText = 'position:fixed;z-index:2147483646;background:#fff;color:#202124;'
    + 'border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);'
    + 'padding:10px;font:13px system-ui,sans-serif;width:280px;max-height:80vh;overflow:auto;'
    + `top:${Math.max(0, Math.min(rect.bottom + 4, window.innerHeight - 10))}px;left:${Math.max(0, Math.min(rect.left, window.innerWidth - 290))}px;`;

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:bold;margin-bottom:4px;';
  title.textContent = 'Teach this answer';
  pop.appendChild(title);

  const qLabel = document.createElement('label');
  qLabel.style.cssText = 'display:block;font-size:11px;color:#666;margin-top:6px;';
  qLabel.textContent = 'Question text (as detected - edit if needed):';
  pop.appendChild(qLabel);

  const qInput = document.createElement('textarea');
  qInput.value = item.questionText;
  qInput.style.cssText = 'width:100%;box-sizing:border-box;font:12px system-ui,sans-serif;margin-top:2px;min-height:40px;';
  pop.appendChild(qInput);

  const getQuestionText = () => qInput.value.trim() || item.questionText;

  if (item.kind === 'choice') {
    const optWrap = document.createElement('div');
    optWrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;';
    item.group.forEach(el => {
      const text = getLabelText(el).trim();
      if (!text) return;
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = 'background:#1a73e8;color:#fff;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;';
      b.addEventListener('click', () => saveLearnedAnswer(item, getQuestionText(), text));
      optWrap.appendChild(b);
    });
    pop.appendChild(optWrap);
  } else if (item.kind === 'select') {
    const sel = document.createElement('select');
    sel.style.cssText = 'width:100%;margin-top:6px;';
    Array.from(item.el.options).forEach(o => {
      const text = o.text.trim();
      if (!text) return;
      const opt = document.createElement('option');
      opt.value = text;
      opt.textContent = text;
      sel.appendChild(opt);
    });
    pop.appendChild(sel);

    const useBtn = document.createElement('button');
    useBtn.textContent = 'Use this answer';
    useBtn.style.cssText = 'margin-top:6px;background:#1a73e8;color:#fff;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;';
    useBtn.addEventListener('click', () => saveLearnedAnswer(item, getQuestionText(), sel.value));
    pop.appendChild(useBtn);
  } else {
    const ansInput = document.createElement('input');
    ansInput.value = item.el.value || '';
    ansInput.placeholder = 'Your answer';
    ansInput.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px;';
    pop.appendChild(ansInput);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'margin-top:6px;background:#1a73e8;color:#fff;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;';
    saveBtn.addEventListener('click', () => saveLearnedAnswer(item, getQuestionText(), ansInput.value.trim()));
    pop.appendChild(saveBtn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'margin-top:6px;margin-left:6px;background:#eee;color:#333;border:none;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:12px;';
  cancelBtn.addEventListener('click', closeLearnPopover);
  pop.appendChild(cancelBtn);

  document.body.appendChild(pop);
  learnPopoverEl = pop;
}

function injectLearnButton(item) {
  const btn = document.createElement('button');
  btn.setAttribute('data-ja-ui', '1');
  btn.textContent = '🎓 Learn';
  btn.title = `Teach an answer for: ${item.questionText.slice(0, 100)}`;
  btn.style.cssText = 'display:inline-block;z-index:2147483645;background:#fbbc04;color:#202124;'
    + 'border:none;border-radius:4px;padding:2px 6px;margin:2px 4px;font:11px system-ui,sans-serif;'
    + 'cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.3);vertical-align:middle;';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openLearnPopover(item, btn);
  });
  item.anchor.insertAdjacentElement('afterend', btn);
  learnButtons.push(btn);
}

async function scanLearnMode() {
  if (!learnModeActive) return;
  if (learnObserver) learnObserver.disconnect();
  clearLearnButtons();

  const { profile, learned, learnedRegex } = await loadData();
  if (!learnModeActive) return;
  const items = findUnansweredFields(profile, learned, learnedRegex);
  items.forEach(injectLearnButton);
  showLearnPanel(items.length);

  if (learnModeActive && learnObserver) learnObserver.observe(document.body, { childList: true, subtree: true });
}

// Mutations caused by our own injected UI (learn buttons, popovers, panels -
// all tagged data-ja-ui) shouldn't trigger a rescan: that would close the
// popover the user just opened a moment ago, before they can click anything.
function isOwnUiNode(node) {
  if (node.nodeType !== 1) {
    node = node.parentElement;
    if (!node) return false;
  }
  return node.matches('[data-ja-ui]') || !!node.closest('[data-ja-ui]');
}

function mutationsTouchPage(mutations) {
  return mutations.some(m => {
    const nodes = [...m.addedNodes, ...m.removedNodes];
    if (nodes.length) return nodes.some(n => !isOwnUiNode(n));
    return !isOwnUiNode(m.target);
  });
}

function setLearnMode(enabled) {
  learnModeActive = enabled;
  if (enabled) {
    if (!learnObserver) {
      learnObserver = new MutationObserver((mutations) => {
        if (learnPopoverEl || !mutationsTouchPage(mutations)) return;
        clearTimeout(learnRescanTimer);
        learnRescanTimer = setTimeout(() => {
          if (learnPopoverEl) return;
          scanLearnMode();
        }, 600);
      });
    }
    scanLearnMode();
  } else {
    if (learnObserver) learnObserver.disconnect();
    clearTimeout(learnRescanTimer);
    clearLearnButtons();
    hideLearnPanel();
  }
}

// --- Messaging ----------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'FILL_FORM') {
    loadData().then(async ({ profile, learned, learnedRegex }) => {
      if (!profile.personal) {
        sendResponse({ filled: 0, error: 'No profile saved yet - open the extension options first.' });
        return;
      }
      const { filled, pending } = fillForm(profile, learned, learnedRegex);
      attachLearningListeners();
      await Promise.all(pending);
      sendResponse({ filled });
    });
    return true;
  }

  if (msg.action === 'START_AUTO') {
    loadData().then(({ profile }) => {
      if (!profile.personal) {
        sendResponse({ ok: false, error: 'No profile saved yet - open the extension options first.' });
        return;
      }
      autoProgress();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === 'STOP_AUTO') {
    stopAuto();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'GET_STATUS') {
    sendResponse(lastStatus);
    return true;
  }

  if (msg.action === 'SET_LEARN_MODE') {
    setLearnMode(!!msg.enabled);
    sendResponse({ enabled: learnModeActive });
    return true;
  }

  if (msg.action === 'GET_LEARN_MODE') {
    sendResponse({ enabled: learnModeActive });
    return true;
  }
});

// If auto-progress was running when a real page navigation happened (rather
// than an in-place SPA update), resume it on the new page.
if (sessionStorage.getItem(AUTO_FLAG) === '1') {
  setTimeout(() => autoProgress(), 1000);
}
