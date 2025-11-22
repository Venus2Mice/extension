// Content Script - Handles page translation
let originalContent = null;
let isTranslated = false;
let translationCache = new Map();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'ready' });
    return true;
  }
  
  if (request.action === 'translatePage') {
    handleTranslatePage();
    sendResponse({ status: 'started' });
    return true;
  } else if (request.action === 'translateSelection') {
    handleTranslateSelection(request.text);
    sendResponse({ status: 'started' });
    return true;
  } else if (request.action === 'restoreOriginal') {
    restoreOriginalContent();
    sendResponse({ status: 'restored' });
    return true;
  }
  return true;
});

// Handle page translation
async function handleTranslatePage() {
  console.log('[Gemini Translator] Starting page translation...');
  
  if (isTranslated) {
    console.log('[Gemini Translator] Page already translated, restoring original...');
    restoreOriginalContent();
    return;
  }

  showLoadingIndicator();

  try {
    // Get API key
    console.log('[Gemini Translator] Fetching API key...');
    const { apiKey } = await chrome.runtime.sendMessage({ action: 'getApiKey' });
    console.log('[Gemini Translator] API key received:', apiKey ? 'Yes (length: ' + apiKey.length + ')' : 'No');
    
    if (!apiKey) {
      showNotification('Vui lòng cấu hình Gemini API key trong popup extension', 'error');
      hideLoadingIndicator();
      return;
    }

    // Test API connection first
    console.log('[Gemini Translator] Testing API connection...');
    const testResponse = await chrome.runtime.sendMessage({
      action: 'translate',
      text: 'Hello',
      apiKey: apiKey
    });
    
    if (!testResponse.success) {
      console.error('[Gemini Translator] API test failed:', testResponse.error);
      showNotification('Lỗi API: ' + testResponse.error, 'error');
      hideLoadingIndicator();
      return;
    }
    
    console.log('[Gemini Translator] API test successful! Response:', testResponse.translation);

    // Save original content
    if (!originalContent) {
      console.log('[Gemini Translator] Saving original content...');
      originalContent = document.body.cloneNode(true);
    }

    // Get all text nodes and combine them
    console.log('[Gemini Translator] Getting text nodes...');
    const textNodes = getTextNodes(document.body);
    console.log('[Gemini Translator] Found', textNodes.length, 'text nodes');
    
    // Group text nodes into chunks to avoid token limits
    const textMap = [];
    const chunks = [];
    let currentChunk = '';
    let chunkMap = [];
    
    textNodes.forEach((node, index) => {
      const text = node.textContent.trim();
      if (text && text.length >= 3) {
        const entry = { node, original: text, index };
        textMap.push(entry);
        
        const line = `[${index}]${text}\n`;
        
        // Reduce chunk size to 2000 chars to avoid MAX_TOKENS
        if (currentChunk.length + line.length > 2000 && currentChunk.length > 0) {
          chunks.push({ text: currentChunk, map: chunkMap });
          currentChunk = line;
          chunkMap = [entry];
        } else {
          currentChunk += line;
          chunkMap.push(entry);
        }
      }
    });
    
    // Add last chunk
    if (currentChunk.length > 0) {
      chunks.push({ text: currentChunk, map: chunkMap });
    }
    
    console.log('[Gemini Translator] Split into', chunks.length, 'chunks');
    
    // Translate each chunk
    let totalApplied = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[Gemini Translator] Translating chunk ${i+1}/${chunks.length} (${chunk.text.length} chars)...`);
      
      const response = await chrome.runtime.sendMessage({
        action: 'translate',
        text: chunk.text,
        apiKey: apiKey
      });
      
      if (!response.success) {
        console.error('[Gemini Translator] Translation failed:', response.error);
        showNotification(`Lỗi dịch chunk ${i+1}: ${response.error}`, 'error');
        continue;
      }
      
      // Parse and apply translations
      const translatedText = response.translation;
      const lines = translatedText.split('\n');
      
      lines.forEach(line => {
        const match = line.match(/^\[(\d+)\](.+)$/);
        if (match) {
          const index = parseInt(match[1]);
          const translation = match[2].trim();
          const entry = textMap.find(e => e.index === index);
          if (entry) {
            entry.node.textContent = translation;
            totalApplied++;
          }
        }
      });
      
      showNotification(`Đã dịch ${i+1}/${chunks.length} phần...`, 'info');
      
      // Small delay between chunks to avoid rate limit
      if (i < chunks.length - 1) {
        await sleep(500);
      }
    }
    
    console.log('[Gemini Translator] Applied', totalApplied, 'translations out of', textMap.length);

    isTranslated = true;
    console.log('[Gemini Translator] Translation complete!');
    showNotification('Đã dịch trang thành công!', 'success');
  } catch (error) {
    console.error('[Gemini Translator] Translation error:', error);
    showNotification('Lỗi khi dịch: ' + error.message, 'error');
  } finally {
    hideLoadingIndicator();
  }
}

// Translate a batch of text nodes
async function translateBatch(nodes, apiKey) {
  // This function is no longer used - keeping for compatibility
  for (const node of nodes) {
    const text = node.textContent.trim();
    if (!text || text.length < 3) continue;
    node.textContent = text; // Keep original if single batch fails
  }
}

// Get all text nodes in the document
function getTextNodes(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip script, style, and other non-visible elements
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        const tagName = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'iframe', 'object'].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Skip if text is just whitespace
        if (node.textContent.trim().length === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }

  return textNodes;
}

// Handle selection translation
async function handleTranslateSelection(text) {
  if (!text || text.trim().length === 0) return;

  showLoadingIndicator();

  try {
    const { apiKey } = await chrome.runtime.sendMessage({ action: 'getApiKey' });
    
    if (!apiKey) {
      showNotification('Vui lòng cấu hình Gemini API key', 'error');
      hideLoadingIndicator();
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      text: text,
      apiKey: apiKey
    });

    if (response.success) {
      showTranslationPopup(text, response.translation);
    } else {
      showNotification('Lỗi: ' + response.error, 'error');
    }
  } catch (error) {
    showNotification('Lỗi khi dịch: ' + error.message, 'error');
  } finally {
    hideLoadingIndicator();
  }
}

// Restore original content
function restoreOriginalContent() {
  if (originalContent) {
    document.body.replaceWith(originalContent.cloneNode(true));
    isTranslated = false;
    translationCache.clear();
    showNotification('Đã khôi phục nội dung gốc', 'success');
  }
}

// Show translation popup for selected text
function showTranslationPopup(original, translation) {
  // Remove existing popup if any
  const existingPopup = document.getElementById('gemini-translator-popup');
  if (existingPopup) existingPopup.remove();

  const popup = document.createElement('div');
  popup.id = 'gemini-translator-popup';
  popup.className = 'gemini-translator-popup';
  popup.innerHTML = `
    <div class="popup-header">
      <span>Bản dịch</span>
      <button class="popup-close">&times;</button>
    </div>
    <div class="popup-content">
      <div class="original-text">
        <strong>Gốc:</strong><br>${escapeHtml(original)}
      </div>
      <div class="translated-text">
        <strong>Tiếng Việt:</strong><br>${escapeHtml(translation)}
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  // Position popup near cursor or center of screen
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    popup.style.top = (rect.bottom + window.scrollY + 10) + 'px';
    popup.style.left = (rect.left + window.scrollX) + 'px';
  }

  // Close popup handler
  popup.querySelector('.popup-close').addEventListener('click', () => {
    popup.remove();
  });

  // Auto close after 10 seconds
  setTimeout(() => {
    if (popup.parentElement) popup.remove();
  }, 10000);
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `gemini-translator-notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Show loading indicator
function showLoadingIndicator() {
  let indicator = document.getElementById('gemini-translator-loading');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'gemini-translator-loading';
    indicator.className = 'gemini-translator-loading';
    indicator.innerHTML = '<div class="spinner"></div><span>Đang dịch...</span>';
    document.body.appendChild(indicator);
  }
  indicator.style.display = 'flex';
}

// Hide loading indicator
function hideLoadingIndicator() {
  const indicator = document.getElementById('gemini-translator-loading');
  if (indicator) {
    indicator.style.display = 'none';
  }
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
