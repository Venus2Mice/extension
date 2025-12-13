// Popup JavaScript
document.addEventListener('DOMContentLoaded', () => {
  loadApiKey();
  loadCacheInfo();
  loadDomainStats();

  // Save API Key
  document.getElementById('saveApiKey').addEventListener('click', saveApiKey);

  // Test connection
  document.getElementById('testConnection').addEventListener('click', testConnection);

  // Translate current page
  document.getElementById('translateCurrentPage').addEventListener('click', translateCurrentPage);

  // Restore original page
  document.getElementById('restorePage').addEventListener('click', restorePage);

  // Clear cache
  document.getElementById('clearCache').addEventListener('click', clearCache);

  // Domain management
  document.getElementById('refreshDomains').addEventListener('click', loadDomainStats);
  document.getElementById('clearDomains').addEventListener('click', clearDomainCache);

  // Auto-save model selection
  document.getElementById('preferredModel').addEventListener('change', () => {
    const preferredModel = document.getElementById('preferredModel').value;
    chrome.storage.sync.set({ preferredModel }, () => {
      console.log('Auto-saved preferredModel:', preferredModel);
      showStatus(`✓ Đã lưu model: ${preferredModel}`, 'success');
    });
  });

  // Allow Enter key to save API key
  document.getElementById('apiKey').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveApiKey();
    }
  });
});

// Load API key from storage
function loadApiKey() {
  chrome.storage.sync.get(['geminiApiKey', 'preferredModel'], (result) => {
    if (result.geminiApiKey) {
      document.getElementById('apiKey').value = result.geminiApiKey;
    }
    if (result.preferredModel) {
      document.getElementById('preferredModel').value = result.preferredModel;
    }
  });
}

// Save API key to storage
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const preferredModel = document.getElementById('preferredModel').value;

  if (!apiKey) {
    showStatus('Vui lòng nhập API key', 'error');
    return;
  }

  chrome.storage.sync.set({
    geminiApiKey: apiKey,
    preferredModel: preferredModel
  }, () => {
    console.log('Saved preferredModel:', preferredModel);
    showStatus(`✓ Đã lưu! Model ưu tiên: ${preferredModel}`, 'success');
  });
}

// Translate current page
async function translateCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showStatus('Không tìm thấy tab đang hoạt động', 'error');
      return;
    }

    // Check if API key exists
    chrome.storage.sync.get(['geminiApiKey'], async (result) => {
      if (!result.geminiApiKey) {
        showStatus('Vui lòng cấu hình API key trước', 'error');
        return;
      }

      try {
        // Ensure content script is injected
        await ensureContentScript(tab.id);

        chrome.tabs.sendMessage(tab.id, { action: 'translatePageFull' }, (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Lỗi: ' + chrome.runtime.lastError.message, 'error');
          } else {
            showStatus('Đang dịch toàn bộ trang...', 'success');
            setTimeout(() => window.close(), 1500);
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

// Restore original page
async function restorePage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showStatus('Không tìm thấy tab đang hoạt động', 'error');
      return;
    }

    await ensureContentScript(tab.id);

    chrome.tabs.sendMessage(tab.id, { action: 'restoreOriginal' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Lỗi: ' + chrome.runtime.lastError.message, 'error');
      }
    });
  } catch (error) {
    showStatus('Lỗi: ' + error.message, 'error');
  }
}

// Ensure content script is injected into the tab
async function ensureContentScript(tabId) {
  try {
    // Try to ping the content script
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
    // Content script not loaded, inject it
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });

    // Also inject CSS
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['content.css']
    });

    // Wait a bit for script to initialize
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
  }, 3000);
}

// Load cache info
async function loadCacheInfo() {
  try {
    const result = await chrome.storage.local.get(['translationCache', 'cacheTimestamp']);
    const cacheInfo = document.getElementById('cacheInfo');

    if (result.translationCache) {
      const count = Object.keys(result.translationCache).length;
      const age = result.cacheTimestamp ? Math.round((Date.now() - result.cacheTimestamp) / (24 * 60 * 60 * 1000)) : 0;
      cacheInfo.textContent = `${count} bản dịch đã cache (${age} ngày)`;
    } else {
      cacheInfo.textContent = 'Chưa có cache';
    }
  } catch (error) {
    console.error('Error loading cache info:', error);
    document.getElementById('cacheInfo').textContent = 'Không thể tải';
  }
}

// Test connection to available models
async function testConnection() {
  const apiKey = document.getElementById('apiKey').value.trim();

  if (!apiKey) {
    showStatus('Vui lòng nhập API key trước', 'error');
    return;
  }

  showStatus('Đang kiểm tra các model...', 'info');

  const testButton = document.getElementById('testConnection');
  testButton.disabled = true;
  testButton.textContent = '⏳ Đang kiểm tra...';

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'testModels',
      apiKey: apiKey
    });

    if (result.success) {
      const availableModels = result.availableModels;
      const modelErrors = result.modelErrors || {};
      const workingModel = result.workingModel;

      // Update the select dropdown to show only available models
      const select = document.getElementById('preferredModel');
      const currentValue = select.value;

      // Store all options
      const allOptions = Array.from(select.options).map(opt => ({
        value: opt.value,
        text: opt.text.replace(/ [✓✗].*$/, '') // Remove existing markers
      }));

      // Clear and repopulate
      select.innerHTML = '';

      allOptions.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.value;

        if (availableModels.includes(option.value)) {
          opt.text = option.text + ' ✓';
          opt.style.color = 'green';
        } else {
          const errorType = modelErrors[option.value] || 'UNKNOWN';
          opt.text = option.text + ` ✗ (${errorType})`;
          opt.style.color = 'gray';
        }

        select.appendChild(opt);
      });

      // Restore or set to working model
      if (availableModels.includes(currentValue)) {
        select.value = currentValue;
      } else {
        select.value = workingModel;
      }

      showStatus(`✓ Tìm thấy ${availableModels.length} model khả dụng!`, 'success');
    } else {
      showStatus('Lỗi: ' + result.error, 'error');
    }
  } catch (error) {
    showStatus('Lỗi khi kiểm tra: ' + error.message, 'error');
  } finally {
    testButton.disabled = false;
    testButton.textContent = '🔍 Kiểm tra Kết nối';
  }
}

// Clear cache
async function clearCache() {
  if (!confirm('Bạn có chắc muốn xóa toàn bộ cache dịch? Việc này sẽ làm chậm lần dịch tiếp theo.')) {
    return;
  }

  try {
    await chrome.storage.local.remove(['translationCache', 'cacheTimestamp']);
    showStatus('✓ Đã xóa cache thành công!', 'success');
    loadCacheInfo();

    // Also notify content scripts to clear their in-memory cache
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'clearCache' }, () => {
        if (chrome.runtime.lastError) {
          // Ignore errors if content script not loaded
        }
      });
    }
  } catch (error) {
    showStatus('Lỗi khi xóa cache: ' + error.message, 'error');
  }
}

// Load domain statistics
async function loadDomainStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getDomainStats' });
    const statsDiv = document.getElementById('domainStats');

    if (response.success && response.stats) {
      const stats = response.stats;

      if (stats.totalDomains === 0) {
        statsDiv.innerHTML = '<div style="color: #999;">Chưa có domain nào được phân tích</div>';
      } else {
        let html = `<div style="margin-bottom: 8px;"><strong>${stats.totalDomains} domains</strong> - ${stats.totalUsage} lần sử dụng</div>`;

        // Show top 5 domains
        const topDomains = stats.domains
          .sort((a, b) => b.usageCount - a.usageCount)
          .slice(0, 5);

        html += '<div style="font-size: 12px; max-height: 120px; overflow-y: auto;">';
        for (const d of topDomains) {
          html += `
            <div style="padding: 4px 0; border-bottom: 1px solid #eee;">
              <div style="font-weight: 500;">${d.domain}</div>
              <div style="color: #666; font-size: 11px;">
                ${d.type} • ${d.usageCount} lần • ${d.age} ngày
              </div>
            </div>
          `;
        }
        html += '</div>';

        statsDiv.innerHTML = html;
      }
    } else {
      statsDiv.textContent = 'Không thể tải thống kê';
    }
  } catch (error) {
    console.error('Error loading domain stats:', error);
    document.getElementById('domainStats').textContent = 'Lỗi khi tải';
  }
}

// Clear domain cache
async function clearDomainCache() {
  if (!confirm('Xóa tất cả domain profiles? AI sẽ phải học lại văn phong các trang web.')) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: 'clearDomainCache' });

    if (response.success) {
      showStatus('✓ Đã xóa domain cache!', 'success');
      loadDomainStats();
    } else {
      showStatus('Lỗi: ' + response.error, 'error');
    }
  } catch (error) {
    showStatus('Lỗi: ' + error.message, 'error');
  }
}
