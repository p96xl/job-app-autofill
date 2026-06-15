const statusEl = document.getElementById('status');
const stopBtn = document.getElementById('stop');

function sendToTab(message, cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.tabs.sendMessage(tab.id, message, cb);
  });
}

document.getElementById('fill').addEventListener('click', () => {
  statusEl.textContent = 'Filling...';
  sendToTab({ action: 'FILL_FORM' }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = 'Could not reach this page. Try reloading it.';
      return;
    }
    if (response.error) {
      statusEl.textContent = response.error;
    } else {
      statusEl.textContent = `Filled ${response.filled} field${response.filled === 1 ? '' : 's'}.`;
    }
  });
});

document.getElementById('auto').addEventListener('click', () => {
  statusEl.textContent = 'Starting...';
  sendToTab({ action: 'START_AUTO' }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = 'Could not reach this page. Try reloading it.';
      return;
    }
    if (response.error) {
      statusEl.textContent = response.error;
      return;
    }
    statusEl.textContent = 'Running - will stop before Submit/Apply, or if a question needs your input.';
    stopBtn.style.display = 'block';
  });
});

stopBtn.addEventListener('click', () => {
  sendToTab({ action: 'STOP_AUTO' }, () => {
    statusEl.textContent = 'Stopped.';
    stopBtn.style.display = 'none';
  });
});

document.getElementById('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

const learnBtn = document.getElementById('learn');
let learnEnabled = false;

learnBtn.addEventListener('click', () => {
  sendToTab({ action: 'SET_LEARN_MODE', enabled: !learnEnabled }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = 'Could not reach this page. Try reloading it.';
      return;
    }
    learnEnabled = !!(response && response.enabled);
    learnBtn.textContent = `Learn mode: ${learnEnabled ? 'on' : 'off'}`;
    if (learnEnabled) {
      statusEl.textContent = 'Look for yellow "🎓 Learn" buttons next to unanswered fields on the page.';
    }
  });
});

sendToTab({ action: 'GET_LEARN_MODE' }, (response) => {
  if (chrome.runtime.lastError || !response) return;
  learnEnabled = !!response.enabled;
  learnBtn.textContent = `Learn mode: ${learnEnabled ? 'on' : 'off'}`;
});

// Show paused/running status from a previous auto-fill run on this page.
sendToTab({ action: 'GET_STATUS' }, (response) => {
  if (chrome.runtime.lastError || !response) return;
  if (response.state === 'paused') {
    const extra = response.questions && response.questions.length ? ` - ${response.questions.join(', ')}` : '';
    statusEl.textContent = `Paused (${response.reason})${extra}`;
  } else if (response.state === 'running') {
    statusEl.textContent = 'Auto-fill running on this page...';
    stopBtn.style.display = 'block';
  }
});
