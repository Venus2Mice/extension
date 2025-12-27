// Popup JavaScript - Clean UI
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadCacheInfo();
  loadDomainStats();

  // Save API Key
  document.getElementById('saveApiKey').addEventListener('click', saveApiKey);

  // Test connection
  document.getElementById('testConnection').addEventListener('click', testConnection);

  // Translate current page
  document.getElementById('translateCurrentPage').addEventListener('click', translateCurrentPage);

  // Screenshot translate
  document.getElementById('screenshotTranslate').addEventListener('click', screenshotTranslate);

  // Restore original page
  document.getElementById('restorePage').addEventListener('click', restorePage);

  // Clear cache
  document.getElementById('clearCache').addEventListener('click', clearCache);

  // Clear domains
  document.getElementById('clearDomains').addEventListener('click', clearDomainCache);

  // Toggle advanced settings
  document.getElementById('toggleAdvanced').addEventListener('click', toggleAdvanced);

  // Auto-save model selection
  document.getElementById('preferredModel').addEventListener('change', () => {
    const preferredModel = document.getElementById('preferredModel').value;
    chrome.storage.sync.set({ preferredModel }, () => {
      showStatus(`✓ Model: ${preferredModel}`, 'success');
    });
  });

  // Auto-save style override selection
  document.getElementById('styleOverride').addEventListener('change', () => {
    const styleOverride = document.getElementById('styleOverride').value;
    chrome.storage.sync.set({ styleOverride }, () => {
      showStatus(`✓ Văn phong đã lưu`, 'success');
    });
  });

  // Allow Enter key to save API key
  document.getElementById('apiKey').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveApiKey();
    }
  });

  // Direct Text Translation
  const translateBtn = document.getElementById('translateTextBtn');
  if (translateBtn) {
    translateBtn.addEventListener('click', handleTextTranslation);
  }

  const inputBox = document.getElementById('inputText');
  if (inputBox) {
    inputBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleTextTranslation();
      }
    });
  }
});

// Toggle advanced settings panel
function toggleAdvanced() {
  const panel = document.getElementById('advancedSettings');
  const btn = document.getElementById('toggleAdvanced');

  if (panel.style.display === 'none') {
    panel.style.display = 'block';
    btn.classList.add('open');
  } else {
    panel.style.display = 'none';
    btn.classList.remove('open');
  }
}

// Load settings from storage
function loadSettings() {
  chrome.storage.sync.get(['geminiApiKey', 'preferredModel', 'styleOverride'], (result) => {
    if (result.geminiApiKey) {
      document.getElementById('apiKey').value = result.geminiApiKey;
    }
    if (result.preferredModel) {
      document.getElementById('preferredModel').value = result.preferredModel;
    }
    if (result.styleOverride) {
      document.getElementById('styleOverride').value = result.styleOverride;
    }
  });
}

// Save API key to storage
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value.trim();

  if (!apiKey) {
    showStatus('Vui lòng nhập API key', 'error');
    return;
  }

  chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
    showStatus('✓ Đã lưu API key', 'success');
  });
}

// Translate current page
async function translateCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showStatus('Không tìm thấy tab', 'error');
      return;
    }

    chrome.storage.sync.get(['geminiApiKey'], async (result) => {
      if (!result.geminiApiKey) {
        showStatus('Vui lòng nhập API key', 'error');
        return;
      }

      try {
        await ensureContentScript(tab.id);
        chrome.tabs.sendMessage(tab.id, { action: 'translatePageStreaming' }, (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Lỗi: ' + chrome.runtime.lastError.message, 'error');
          } else {
            showStatus('Đang dịch...', 'success');
            setTimeout(() => window.close(), 1000);
          }
        });
      } catch (error) {
        showStatus('Lỗi: ' + error.message, 'error');
      }
    });
  } catch (error) {
    showStatus('Lỗi: ' + error.message, 'error');
  }
}

// Screenshot translate
async function screenshotTranslate() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showStatus('Không tìm thấy tab', 'error');
      return;
    }

    await ensureContentScript(tab.id);
    chrome.tabs.sendMessage(tab.id, { action: 'startScreenshotMode' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Lỗi: ' + chrome.runtime.lastError.message, 'error');
      } else {
        window.close();
      }
    });
  } catch (error) {
    showStatus('Lỗi: ' + error.message, 'error');
  }
}

// Restore original page
async function restorePage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showStatus('Không tìm thấy tab', 'error');
      return;
    }

    await ensureContentScript(tab.id);
    chrome.tabs.sendMessage(tab.id, { action: 'restoreOriginal' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Lỗi: ' + chrome.runtime.lastError.message, 'error');
      } else {
        showStatus('Đã khôi phục', 'success');
      }
    });
  } catch (error) {
    showStatus('Lỗi: ' + error.message, 'error');
  }
}

// Ensure content script is injected
async function ensureContentScript(tabId) {
  try {
    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });

    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['content.css']
    });

    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Show status message
function showStatus(message, type = 'info') {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;
  statusDiv.style.display = 'block';

  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 2500);
}

// Load cache info
async function loadCacheInfo() {
  try {
    const result = await chrome.storage.local.get(['translationCache']);
    const cacheInfo = document.getElementById('cacheInfo');

    if (result.translationCache) {
      const count = Object.keys(result.translationCache).length;
      cacheInfo.textContent = `${count} items`;
    } else {
      cacheInfo.textContent = 'Empty';
    }
  } catch (error) {
    document.getElementById('cacheInfo').textContent = '--';
  }
}

// Test connection
async function testConnection() {
  const apiKey = document.getElementById('apiKey').value.trim();

  if (!apiKey) {
    showStatus('Vui lòng nhập API key', 'error');
    return;
  }

  showStatus('Đang kiểm tra...', 'info');
  const btn = document.getElementById('testConnection');
  btn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'testModels',
      apiKey: apiKey
    });

    if (result.success) {
      showStatus(`✓ ${result.availableModels.length} model khả dụng`, 'success');
    } else {
      showStatus('Lỗi: ' + result.error, 'error');
    }
  } catch (error) {
    showStatus('Lỗi: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Clear cache
async function clearCache() {
  try {
    await chrome.storage.local.remove(['translationCache', 'cacheTimestamp']);
    showStatus('✓ Cache đã xóa', 'success');
    loadCacheInfo();
  } catch (error) {
    showStatus('Lỗi: ' + error.message, 'error');
  }
}

// Load domain stats
async function loadDomainStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getDomainStats' });
    const statsDiv = document.getElementById('domainStats');

    if (response.success && response.stats) {
      statsDiv.textContent = `${response.stats.totalDomains} domains`;
    } else {
      statsDiv.textContent = '--';
    }
  } catch (error) {
    document.getElementById('domainStats').textContent = '--';
  }
}

// Clear domain cache
async function clearDomainCache() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'clearDomainCache' });

    if (response.success) {
      showStatus('✓ Domain cache đã xóa', 'success');
      loadDomainStats();
    } else {
      showStatus('Lỗi: ' + response.error, 'error');
    }
  } catch (error) {
    showStatus('Lỗi: ' + error.message, 'error');
  }
}

// Handle direct text translation
async function handleTextTranslation() {
  const input = document.getElementById('inputText');
  const output = document.getElementById('outputText');
  const btn = document.getElementById('translateTextBtn');
  const text = input.value.trim();

  if (!text) return;

  // UI Loading State
  btn.disabled = true;
  const originalBtnText = btn.textContent;
  btn.textContent = 'Đang dịch...';
  output.style.display = 'none';
  output.textContent = '';

  try {
    const storage = await chrome.storage.sync.get(['geminiApiKey', 'styleOverride']);
    if (!storage.geminiApiKey) {
      showStatus('Vui lòng nhập API Key bên dưới', 'error');
      return;
    }

    // Prepare text with [N] indexing to match background.js expectations
    const lines = text.split('\n');
    const indexedText = lines.map((line, i) => `[${i}]${line}`).join('\n');

    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      text: indexedText,
      apiKey: storage.geminiApiKey,
      textStyle: { type: storage.styleOverride || 'general' },
      currentUrl: 'user-input'
    });

    if (response.success && response.translation) {
      // Clean up the [N] prefixes from response
      const cleanText = response.translation
        .replace(/^\[\d+\]/gm, '') // Remove start-of-line [N]
        .replace(/^\s+/gm, '')     // Remove leading space after [N] removal
        .trim();

      output.textContent = cleanText;
      output.style.display = 'block';
    } else {
      showStatus(response.error || 'Lỗi không xác định', 'error');
    }
  } catch (error) {
    showStatus('Lỗi: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalBtnText;
  }
}
