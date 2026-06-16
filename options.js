// Generic starting defaults - common answers most US-based applicants give.
// Everything personal (name, email, school, employer, etc.) is left blank
// for each person to fill in on their own first run.
const DEFAULTS = {
  personal: {
    country: 'United States',
  },
  workAuth: {
    authorizedToWorkUS: 'Yes',
    requireSponsorship: 'No',
    over18: 'Yes',
    willingToRelocate: 'Yes',
  },
  eeo: {
    gender: 'Decline to self-identify',
    race: 'Decline to self-identify',
    veteranStatus: 'I am not a protected veteran',
    disabilityStatus: "I don't wish to answer",
  },
};

const get = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    o[keys[i]] = o[keys[i]] || {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

const fields = document.querySelectorAll('[data-key]');

chrome.storage.local.get('profile', ({ profile }) => {
  fields.forEach(el => {
    const key = el.dataset.key;
    const value = get(profile, key);
    el.value = value !== undefined ? value : (get(DEFAULTS, key) || '');
  });
});

document.getElementById('save').addEventListener('click', () => {
  const profile = {};
  fields.forEach(el => setPath(profile, el.dataset.key, el.value.trim()));
  chrome.storage.local.set({ profile }, () => {
    const saved = document.getElementById('saved');
    saved.textContent = 'Saved!';
    setTimeout(() => { saved.textContent = ''; }, 2000);
  });
});

function renderLearned(learned) {
  const tbody = document.querySelector('#learnedTable tbody');
  tbody.innerHTML = '';
  const entries = Object.entries(learned);

  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#888; padding:8px 0;">No learned answers yet.</td></tr>';
    return;
  }

  entries.forEach(([key, entry]) => {
    const tr = document.createElement('tr');

    const qTd = document.createElement('td');
    qTd.textContent = entry.label;
    qTd.style.padding = '4px 8px 4px 0';

    const vTd = document.createElement('td');
    const input = document.createElement('input');
    input.value = entry.value;
    input.addEventListener('change', () => {
      chrome.storage.local.get('learned', (data) => {
        const learned = data.learned || {};
        if (learned[key]) {
          learned[key].value = input.value;
          chrome.storage.local.set({ learned });
        }
      });
    });
    vTd.appendChild(input);

    const delTd = document.createElement('td');
    delTd.style.width = '24px';
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = 'Forget this answer';
    delBtn.style.cssText = 'width:auto; padding:2px 6px; margin:0;';
    delBtn.addEventListener('click', () => {
      chrome.storage.local.get('learned', (data) => {
        const learned = data.learned || {};
        delete learned[key];
        chrome.storage.local.set({ learned }, () => renderLearned(learned));
      });
    });
    delTd.appendChild(delBtn);

    tr.append(qTd, vTd, delTd);
    tbody.appendChild(tr);
  });
}

chrome.storage.local.get('learned', ({ learned }) => renderLearned(learned || {}));

// Same normalization the content script uses, so a manually-added entry
// matches the same way an auto-learned one would.
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

document.getElementById('addLearned').addEventListener('click', () => {
  const qEl = document.getElementById('newLearnedQ');
  const aEl = document.getElementById('newLearnedA');
  const q = qEl.value.trim();
  const a = aEl.value.trim();
  const msg = document.getElementById('addLearnedMsg');
  const norm = normalize(q);

  if (!norm || norm.length < 3 || !a) {
    msg.style.color = '#c62828';
    msg.textContent = 'Enter both a question/label and an answer.';
    setTimeout(() => { msg.textContent = ''; }, 2500);
    return;
  }

  chrome.storage.local.get('learned', (data) => {
    const learned = data.learned || {};
    learned[norm] = { label: q.slice(0, 200), value: a.slice(0, 500) };
    chrome.storage.local.set({ learned }, () => {
      renderLearned(learned);
      qEl.value = '';
      aEl.value = '';
      msg.style.color = '#2e7d32';
      msg.textContent = 'Added!';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    });
  });
});

function renderRegexRules(rules) {
  const tbody = document.querySelector('#regexTable tbody');
  tbody.innerHTML = '';

  if (rules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:#888; padding:8px 0;">No regex rules yet.</td></tr>';
    return;
  }

  rules.forEach((rule, index) => {
    const tr = document.createElement('tr');

    const qTd = document.createElement('td');
    qTd.textContent = rule.questionPattern;
    qTd.style.padding = '4px 8px 4px 0';
    qTd.style.fontFamily = 'monospace';

    const aTd = document.createElement('td');
    aTd.textContent = rule.answerPattern;
    aTd.style.padding = '4px 8px 4px 0';
    aTd.style.fontFamily = 'monospace';

    const fTd = document.createElement('td');
    fTd.textContent = rule.flags || 'i';
    fTd.style.padding = '4px 8px 4px 0';
    fTd.style.fontFamily = 'monospace';

    const delTd = document.createElement('td');
    delTd.style.width = '24px';
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = 'Delete this rule';
    delBtn.style.cssText = 'width:auto; padding:2px 6px; margin:0;';
    delBtn.addEventListener('click', () => {
      chrome.storage.local.get('learnedRegex', (data) => {
        const rules = data.learnedRegex || [];
        rules.splice(index, 1);
        chrome.storage.local.set({ learnedRegex: rules }, () => renderRegexRules(rules));
      });
    });
    delTd.appendChild(delBtn);

    tr.append(qTd, aTd, fTd, delTd);
    tbody.appendChild(tr);
  });
}

chrome.storage.local.get('learnedRegex', ({ learnedRegex }) => renderRegexRules(learnedRegex || []));

function loadExport() {
  chrome.storage.local.get(['profile', 'learned', 'learnedRegex'], (data) => {
    document.getElementById('exportBox').value = JSON.stringify(data, null, 2);
  });
}

loadExport();

document.getElementById('copyExport').addEventListener('click', () => {
  const box = document.getElementById('exportBox');
  box.select();
  navigator.clipboard.writeText(box.value).catch(() => document.execCommand('copy'));
  const msg = document.getElementById('copyMsg');
  msg.textContent = 'Copied!';
  setTimeout(() => { msg.textContent = ''; }, 2000);
});

document.getElementById('doImport').addEventListener('click', () => {
  const raw = document.getElementById('importBox').value.trim();
  const msg = document.getElementById('importMsg');

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    msg.style.color = '#c62828';
    msg.textContent = `Invalid JSON: ${e.message}`;
    setTimeout(() => { msg.textContent = ''; }, 4000);
    return;
  }

  const allowed = ['profile', 'learned', 'learnedRegex'];
  const toSet = {};
  for (const key of allowed) {
    if (key in data) toSet[key] = data[key];
  }

  if (Object.keys(toSet).length === 0) {
    msg.style.color = '#c62828';
    msg.textContent = 'No recognized keys found (expected profile, learned, learnedRegex).';
    setTimeout(() => { msg.textContent = ''; }, 4000);
    return;
  }

  chrome.storage.local.set(toSet, () => {
    // Reload all UI
    chrome.storage.local.get('profile', ({ profile }) => {
      fields.forEach(el => {
        const key = el.dataset.key;
        const value = get(profile, key);
        el.value = value !== undefined ? value : (get(DEFAULTS, key) || '');
      });
    });
    chrome.storage.local.get('learned', ({ learned }) => renderLearned(learned || {}));
    chrome.storage.local.get('learnedRegex', ({ learnedRegex }) => renderRegexRules(learnedRegex || []));
    loadExport();
    document.getElementById('importBox').value = '';
    msg.style.color = '#2e7d32';
    msg.textContent = 'Imported!';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  });
});

document.getElementById('addRegex').addEventListener('click', () => {
  const qEl = document.getElementById('newRegexQ');
  const aEl = document.getElementById('newRegexA');
  const flagsEl = document.getElementById('newRegexFlags');
  const q = qEl.value.trim();
  const a = aEl.value.trim();
  const flags = flagsEl.value.trim() || 'i';
  const msg = document.getElementById('addRegexMsg');

  if (!q || !a) {
    msg.style.color = '#c62828';
    msg.textContent = 'Enter both a question pattern and an answer pattern.';
    setTimeout(() => { msg.textContent = ''; }, 2500);
    return;
  }

  try {
    new RegExp(q, flags);
    new RegExp(a, flags);
  } catch (e) {
    msg.style.color = '#c62828';
    msg.textContent = `Invalid regex: ${e.message}`;
    setTimeout(() => { msg.textContent = ''; }, 4000);
    return;
  }

  chrome.storage.local.get('learnedRegex', (data) => {
    const rules = data.learnedRegex || [];
    rules.push({ questionPattern: q, answerPattern: a, flags });
    chrome.storage.local.set({ learnedRegex: rules }, () => {
      renderRegexRules(rules);
      qEl.value = '';
      aEl.value = '';
      flagsEl.value = 'i';
      msg.style.color = '#2e7d32';
      msg.textContent = 'Added!';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    });
  });
});
