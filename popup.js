// Popup JavaScript
document.addEventListener('DOMContentLoaded', () => {
  loadApiKey();
  
  // Save API Key
  document.getElementById('saveApiKey').addEventListener('click', saveApiKey);
  
  // Translate current page
  document.getElementById('translateCurrentPage').addEventListener('click', translateCurrentPage);
  
  // Restore original page
  document.getElementById('restorePage').addEventListener('click', restorePage);
  
  // Allow Enter key to save API key
  document.getElementById('apiKey').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveApiKey();
    }
  });
});

// Load API key from storage
function loadApiKey() {
  chrome.storage.sync.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
      document.getElementById('apiKey').value = result.geminiApiKey;
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
    showStatus('✓ Đã lưu API key thành công!', 'success');
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
        
        chrome.tabs.sendMessage(tab.id, { action: 'translatePage' }, (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Lỗi: ' + chrome.runtime.lastError.message, 'error');
          } else {
            showStatus('Đang dịch trang...', 'info');
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
