// Content Script - Handles page translation
let originalContent = null;
let isTranslated = false;
let translationCache = new Map();
let isLazyMode = false;
let pendingTranslations = [];
let scrollObserver = null;
let translationInProgress = false;
let cacheLoaded = false;

// Helper: Check if extension context is valid
function isExtensionContextValid() {
  try {
    return chrome.runtime && chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// Cache configuration
const CACHE_MAX_SIZE = 500; // Maximum 500 entries
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Load cache from storage on initialization
(async function loadCache() {
  try {
    // Check if extension context is valid
    if (!isExtensionContextValid()) {
      console.warn('[Gemini Translator] Extension context not available during cache load');
      cacheLoaded = true;
      return;
    }
    
    const result = await chrome.storage.local.get(['translationCache', 'cacheTimestamp']);
    if (result.translationCache) {
      const cacheAge = Date.now() - (result.cacheTimestamp || 0);
      
      // Clear old cache if expired
      if (cacheAge > CACHE_MAX_AGE) {
        console.log('[Gemini Translator] Cache expired, clearing...');
        await chrome.storage.local.remove(['translationCache', 'cacheTimestamp']);
        translationCache = new Map();
      } else {
        translationCache = new Map(Object.entries(result.translationCache));
        console.log(`[Gemini Translator] Loaded ${translationCache.size} cached translations (age: ${Math.round(cacheAge / (24*60*60*1000))} days)`);
      }
    }
    cacheLoaded = true;
  } catch (error) {
    console.error('[Gemini Translator] Failed to load cache:', error);
    cacheLoaded = true;
  }
})();

// Save cache to storage (debounced)
let saveCacheTimer = null;
function saveCache() {
  clearTimeout(saveCacheTimer);
  saveCacheTimer = setTimeout(async () => {
    // Check if extension context is still valid
    if (!isExtensionContextValid()) {
      console.warn('[Gemini Translator] Extension context invalidated, skipping cache save');
      return;
    }
    
    try {
      // Limit cache size - keep most recent entries
      if (translationCache.size > CACHE_MAX_SIZE) {
        console.log(`[Gemini Translator] Cache size (${translationCache.size}) exceeds limit, trimming...`);
        const entries = Array.from(translationCache.entries());
        const trimmed = entries.slice(-CACHE_MAX_SIZE); // Keep last N entries
        translationCache = new Map(trimmed);
      }
      
      const cacheObj = Object.fromEntries(translationCache);
      await chrome.storage.local.set({ 
        translationCache: cacheObj,
        cacheTimestamp: Date.now()
      });
      console.log(`[Gemini Translator] Saved ${translationCache.size} translations to cache`);
    } catch (error) {
      // Silently ignore if context invalidated
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[Gemini Translator] Cannot save cache: extension reloaded');
        return;
      }
      
      console.error('[Gemini Translator] Failed to save cache:', error);
      
      // If storage quota exceeded, clear old cache
      if (error.message && error.message.includes('QUOTA')) {
        console.log('[Gemini Translator] Storage quota exceeded, clearing cache...');
        translationCache.clear();
        try {
          await chrome.storage.local.remove(['translationCache', 'cacheTimestamp']);
        } catch (e) {
          // Ignore if context invalid
        }
      }
    }
  }, 2000);
}

// Generate cache key from text (optimized for memory)
function getCacheKey(text, textStyle) {
  const styleKey = textStyle ? textStyle.type : 'general';
  
  // For long text, use hash of first/last parts + length
  if (text.length > 200) {
    const firstPart = text.substring(0, 100);
    const lastPart = text.substring(text.length - 100);
    const combined = firstPart + lastPart + styleKey;
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `${styleKey}_${hash}_${text.length}`;
  }
  
  // For short text, hash entire text
  let hash = 0;
  const str = text + styleKey;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${styleKey}_${hash}_${text.length}`;
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'ready' });
    return true;
  }
  
  if (request.action === 'clearCache') {
    translationCache.clear();
    console.log('[Gemini Translator] In-memory cache cleared');
    sendResponse({ status: 'ok' });
    return true;
  }
  
  if (request.action === 'translatePage') {
    handleTranslatePage();
    sendResponse({ status: 'started' });
    return true;
  } else if (request.action === 'translatePageFull') {
    // Force full translation, stop lazy mode
    handleTranslatePageFull();
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
    
    // Calculate total characters
    const totalChars = textNodes.reduce((sum, node) => {
      const text = node.textContent.trim();
      return text.length >= 3 ? sum + text.length : sum;
    }, 0);
    console.log('[Gemini Translator] Total characters:', totalChars);
    
    // Determine translation strategy
    const LAZY_MODE_THRESHOLD = 5000; // If more than 5000 chars, use lazy mode
    
    if (totalChars > LAZY_MODE_THRESHOLD) {
      console.log('[Gemini Translator] Large page detected, using lazy translation mode');
      showNotification(`Trang lớn (${Math.round(totalChars/1000)}KB text), dịch theo scroll...`, 'info');
      await startLazyTranslation(textNodes, apiKey);
      return;
    }
    
    // For small pages, translate all at once
    console.log('[Gemini Translator] Small page, translating all at once');
    
    // Group text nodes into chunks to avoid token limits
    const textMap = [];
    const chunks = [];
    let currentChunk = '';
    let chunkMap = [];
    
    textNodes.forEach((node, index) => {
      const text = node.textContent;
      const trimmed = text.trim();
      if (trimmed && trimmed.length >= 3) {
        // Store both original (with whitespace) and trimmed version
        const entry = { 
          node, 
          original: text, 
          trimmed: trimmed,
          index,
          hasLeadingSpace: text.startsWith(' ') || text.startsWith('\t'),
          hasTrailingSpace: text.endsWith(' ') || text.endsWith('\t')
        };
        textMap.push(entry);
        
        // Use trimmed version for translation, but preserve whitespace info
        const line = `[${index}]${trimmed}\n`;
        
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
    
    // Detect text style/tone for better translation
    const textStyle = detectTextStyle(textMap);
    console.log('[Gemini Translator] Detected text style:', textStyle);
    showNotification(`Phát hiện văn phong: ${textStyle.name}`, 'info');
    
    // Translate each chunk with retry logic
    let totalApplied = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[Gemini Translator] Translating chunk ${i+1}/${chunks.length} (${chunk.text.length} chars)...`);
      
      let success = false;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (!success && retryCount < maxRetries) {
        try {
          // Check if chunk is cached
          const translation = await translateWithCache(chunk.text, apiKey, textStyle);
          
          // Parse and apply translations
          const translatedText = translation;
          // Split and filter properly
          const allLines = translatedText.split('\n');
          const lines = allLines
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .filter(l => /^\[\d+\]/.test(l));
          
          console.log(`[Gemini Translator] Chunk ${i+1}: got ${allLines.length} raw lines, ${lines.length} valid lines, expected ${chunk.map.length}`);
          
          // Log first and last lines to check for missing chunks
          if (lines.length > 0) {
            console.log(`[Gemini Translator] Chunk ${i+1} first line: ${lines[0].substring(0, 80)}`);
            console.log(`[Gemini Translator] Chunk ${i+1} last line: ${lines[lines.length-1].substring(0, 80)}`);
          }
          
          if (lines.length < chunk.map.length) {
            console.warn(`[Gemini Translator] Chunk ${i+1}: Missing ${chunk.map.length - lines.length} translations!`);
            console.warn(`[Gemini Translator] Expected indices: ${chunk.map[0].index} to ${chunk.map[chunk.map.length-1].index}`);
            
            // Find which indices are missing
            const receivedIndices = new Set();
            lines.forEach(line => {
              const match = line.match(/^\[(\d+)\]/);
              if (match) receivedIndices.add(parseInt(match[1]));
            });
            const missingIndices = chunk.map.filter(e => !receivedIndices.has(e.index)).map(e => e.index);
            console.warn(`[Gemini Translator] Missing indices: [${missingIndices.join(', ')}]`);
            console.warn(`[Gemini Translator] Raw response preview: ${translatedText.substring(0, 300)}`);
          }
          
          let chunkApplied = 0;
          lines.forEach((line, lineIdx) => {
            // More flexible regex to handle edge cases
            const match = line.match(/^\[(\d+)\](.*)$/);
            if (match) {
              const index = parseInt(match[1]);
              let translation = match[2].trim();
              
              const entry = textMap.find(e => e.index === index);
              if (entry) {
                // Allow empty translations for single chars like punctuation
                if (!translation && entry.trimmed.length === 1) {
                  translation = entry.trimmed; // Keep original for single char
                }
                
                if (translation) {
                  // Restore original whitespace padding
                  let finalText = translation;
                  if (entry.hasLeadingSpace) finalText = ' ' + finalText;
                  if (entry.hasTrailingSpace) finalText = finalText + ' ';
                  
                  entry.node.textContent = finalText;
                  totalApplied++;
                  chunkApplied++;
                } else {
                  console.warn(`[Gemini Translator] Empty translation for index ${index}, original: "${entry.trimmed}"`);
                }
              } else {
                console.warn(`[Gemini Translator] Index ${index} not found in textMap (line ${lineIdx}: "${line.substring(0, 50)}...")`);
              }
            } else {
              console.warn(`[Gemini Translator] Line ${lineIdx} did not match format: "${line.substring(0, 50)}..."`);
            }
          });
          
          console.log(`[Gemini Translator] Chunk ${i+1} applied ${chunkApplied} translations`);
          showNotification(`Đã dịch ${i+1}/${chunks.length} phần (${totalApplied} đoạn)...`, 'info');
          success = true;
          
        } catch (error) {
          console.error(`[Gemini Translator] Chunk ${i+1} error:`, error);
          retryCount++;
          
          if (retryCount < maxRetries) {
            const waitTime = Math.min(1000 * Math.pow(2, retryCount), 5000);
            console.log(`[Gemini Translator] Waiting ${waitTime}ms before retry...`);
            showNotification(`Chunk ${i+1} lỗi, thử lại sau ${waitTime/1000}s...`, 'info');
            await sleep(waitTime);
          } else {
            showNotification(`Lỗi dịch chunk ${i+1}: ${error.message}`, 'error');
          }
        }
      }
      
      // Small delay between chunks
      if (i < chunks.length - 1 && success) {
        await sleep(300);
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

// Translate text with caching
async function translateWithCache(text, apiKey, textStyle) {
  const cacheKey = getCacheKey(text, textStyle);
  
  // Check cache first
  if (translationCache.has(cacheKey)) {
    console.log('[Gemini Translator] Cache HIT for', text.substring(0, 50));
    return translationCache.get(cacheKey);
  }
  
  console.log('[Gemini Translator] Cache MISS, calling API for', text.substring(0, 50));
  
  // Check if extension context is valid before making API call
  if (!isExtensionContextValid()) {
    throw new Error('Extension context invalidated - please reload the page');
  }
  
  // Call API with promise wrapper to handle channel closing
  const response = await new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        action: 'translate',
        text: text,
        apiKey: apiKey,
        textStyle: textStyle
      }, (response) => {
        // Check for runtime errors
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (!response) {
          reject(new Error('No response from background script'));
          return;
        }
        
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
  
  if (response.success) {
    // Cache the result
    translationCache.set(cacheKey, response.translation);
    saveCache();
    return response.translation;
  } else {
    throw new Error(response.error);
  }
}

// Handle full page translation (no lazy mode, with progress bar)
async function handleTranslatePageFull() {
  console.log('[Gemini Translator] Starting FULL page translation...');
  
  // Stop lazy translation if active
  if (isLazyMode && scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
    isLazyMode = false;
    console.log('[Gemini Translator] Stopped lazy mode');
  }
  
  if (isTranslated) {
    console.log('[Gemini Translator] Page already translated, restoring original...');
    restoreOriginalContent();
    return;
  }

  showLoadingIndicator();
  showProgressBar();

  try {
    // Get API key
    const { apiKey } = await chrome.runtime.sendMessage({ action: 'getApiKey' });
    
    if (!apiKey) {
      showNotification('Vui lòng cấu hình Gemini API key trong popup extension', 'error');
      hideLoadingIndicator();
      hideProgressBar();
      return;
    }

    // Save original content
    if (!originalContent) {
      originalContent = document.body.cloneNode(true);
    }

    // Get all text nodes
    const textNodes = getTextNodes(document.body);
    console.log('[Gemini Translator] Found', textNodes.length, 'text nodes');
    
    // Group text nodes into chunks
    const textMap = [];
    const chunks = [];
    let currentChunk = '';
    let chunkMap = [];
    
    textNodes.forEach((node, index) => {
      const text = node.textContent;
      const trimmed = text.trim();
      if (trimmed && trimmed.length >= 3) {
        const entry = { 
          node, 
          original: text, 
          trimmed: trimmed,
          index,
          hasLeadingSpace: text.startsWith(' ') || text.startsWith('\t'),
          hasTrailingSpace: text.endsWith(' ') || text.endsWith('\t')
        };
        textMap.push(entry);
        
        const line = `[${index}]${trimmed}\n`;
        
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
    
    if (currentChunk.length > 0) {
      chunks.push({ text: currentChunk, map: chunkMap });
    }
    
    console.log('[Gemini Translator] Split into', chunks.length, 'chunks');
    updateProgressBar(0, chunks.length);
    
    // Detect text style
    const textStyle = detectTextStyle(textMap);
    console.log('[Gemini Translator] Detected text style:', textStyle);
    
    // Translate each chunk with progress
    let totalApplied = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[Gemini Translator] Translating chunk ${i+1}/${chunks.length}...`);
      updateProgressBar(i, chunks.length);
      
      try {
        const translation = await translateWithCache(chunk.text, apiKey, textStyle);
        
        const allLines = translation.split('\n');
        const lines = allLines
          .map(l => l.trim())
          .filter(l => l.length > 0)
          .filter(l => /^\[\d+\]/.test(l));
        
        console.log(`[Gemini Translator] Full chunk ${i+1}: got ${allLines.length} raw lines, ${lines.length} valid lines, expected ${chunk.map.length}`);
        
        // Log first and last for debugging
        if (lines.length > 0) {
          console.log(`[Gemini Translator] Full chunk ${i+1} first: ${lines[0].substring(0, 80)}`);
          console.log(`[Gemini Translator] Full chunk ${i+1} last: ${lines[lines.length-1].substring(0, 80)}`);
        }
        if (lines.length < chunk.map.length) {
          console.warn(`[Gemini Translator] Full chunk ${i+1}: Missing translations!`);
          console.warn(`[Gemini Translator] Raw response: ${translation.substring(0, 300)}`);
        }
        
        lines.forEach((line, lineIdx) => {
          const match = line.match(/^\[(\d+)\](.*)$/);
          if (match) {
            const index = parseInt(match[1]);
            let translation = match[2].trim();
            
            const entry = textMap.find(e => e.index === index);
            if (entry) {
              // Allow empty translations for single chars
              if (!translation && entry.trimmed.length === 1) {
                translation = entry.trimmed;
              }
              
              if (translation) {
                let finalText = translation;
                if (entry.hasLeadingSpace) finalText = ' ' + finalText;
                if (entry.hasTrailingSpace) finalText = finalText + ' ';
                
                entry.node.textContent = finalText;
                totalApplied++;
              } else {
                console.warn(`[Gemini Translator] Empty translation for index ${index}`);
              }
            } else {
              console.warn(`[Gemini Translator] Index ${index} not found (line ${lineIdx})`);
            }
          } else {
            console.warn(`[Gemini Translator] Line ${lineIdx} format error: "${line.substring(0, 40)}..."`);
          }
        });
        
        updateProgressBar(i + 1, chunks.length);
        
      } catch (error) {
        console.error(`[Gemini Translator] Chunk ${i+1} error:`, error);
        showNotification(`Lỗi dịch chunk ${i+1}: ${error.message}`, 'error');
      }
      
      if (i < chunks.length - 1) await sleep(300);
    }
    
    console.log('[Gemini Translator] Applied', totalApplied, 'translations');
    isTranslated = true;
    hideProgressBar();
    showNotification('Đã dịch toàn bộ trang thành công!', 'success');
    
  } catch (error) {
    console.error('[Gemini Translator] Translation error:', error);
    showNotification('Lỗi khi dịch: ' + error.message, 'error');
    hideProgressBar();
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
    // Stop lazy translation if active
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }
    isLazyMode = false;
    pendingTranslations = [];
    
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

// Show progress bar
function showProgressBar() {
  let progressBar = document.getElementById('gemini-translator-progress');
  if (!progressBar) {
    progressBar = document.createElement('div');
    progressBar.id = 'gemini-translator-progress';
    progressBar.className = 'gemini-translator-progress';
    progressBar.innerHTML = `
      <div class="progress-container">
        <div class="progress-text">Đang dịch: <span id="progress-current">0</span>/<span id="progress-total">0</span></div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="progress-bar-fill" style="width: 0%"></div>
        </div>
        <div class="progress-percent" id="progress-percent">0%</div>
      </div>
    `;
    document.body.appendChild(progressBar);
  }
  progressBar.style.display = 'block';
}

// Hide progress bar
function hideProgressBar() {
  const progressBar = document.getElementById('gemini-translator-progress');
  if (progressBar) {
    progressBar.style.display = 'none';
  }
}

// Update progress bar
function updateProgressBar(current, total) {
  const currentEl = document.getElementById('progress-current');
  const totalEl = document.getElementById('progress-total');
  const fillEl = document.getElementById('progress-bar-fill');
  const percentEl = document.getElementById('progress-percent');
  
  if (currentEl) currentEl.textContent = current;
  if (totalEl) totalEl.textContent = total;
  
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  if (fillEl) fillEl.style.width = percent + '%';
  if (percentEl) percentEl.textContent = percent + '%';
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

// Start lazy translation mode (translate as user scrolls)
async function startLazyTranslation(textNodes, apiKey) {
  isLazyMode = true;
  
  // Detect text style and preserve whitespace
  const textMap = textNodes.map((node, index) => {
    const text = node.textContent;
    const trimmed = text.trim();
    return {
      node,
      original: text,
      trimmed: trimmed,
      index,
      hasLeadingSpace: text.startsWith(' ') || text.startsWith('\t'),
      hasTrailingSpace: text.endsWith(' ') || text.endsWith('\t')
    };
  }).filter(e => e.trimmed.length >= 3);
  
  const textStyle = detectTextStyle(textMap);
  console.log('[Gemini Translator] Detected text style:', textStyle);
  
  // Mark all nodes as pending
  pendingTranslations = textMap;
  
  // Translate visible content first
  await translateVisibleContent(apiKey, textStyle);
  
  // Set up intersection observer for lazy translation
  setupScrollObserver(apiKey, textStyle);
  
  isTranslated = true;
  hideLoadingIndicator();
  showNotification('Đã dịch phần hiển thị. Scroll để dịch tiếp...', 'success');
}

// Translate only visible content
async function translateVisibleContent(apiKey, textStyle) {
  const viewportHeight = window.innerHeight;
  const visibleNodes = [];
  
  for (const entry of pendingTranslations) {
    // Text nodes don't have getBoundingClientRect, use parent element
    const element = entry.node.parentElement;
    if (!element) continue;
    
    const rect = element.getBoundingClientRect();
    // Check if node is in viewport or near it (within 3x viewport height)
    if (rect.top < viewportHeight * 3 && rect.bottom > -viewportHeight * 2) {
      visibleNodes.push(entry);
    }
  }
  
  console.log(`[Gemini Translator] Translating ${visibleNodes.length} visible nodes`);
  
  if (visibleNodes.length === 0) return;
  
  // Group into chunks
  const chunks = [];
  let currentChunk = '';
  let chunkMap = [];
  
  visibleNodes.forEach((entry) => {
    // Use trimmed version for translation
    const line = `[${entry.index}]${entry.trimmed}\n`;
    
    if (currentChunk.length + line.length > 2000 && currentChunk.length > 0) {
      chunks.push({ text: currentChunk, map: chunkMap });
      currentChunk = line;
      chunkMap = [entry];
    } else {
      currentChunk += line;
      chunkMap.push(entry);
    }
  });
  
  if (currentChunk.length > 0) {
    chunks.push({ text: currentChunk, map: chunkMap });
  }
  
  // Translate chunks
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      const translation = await translateWithCache(chunk.text, apiKey, textStyle);
      
      // Filter: only keep lines starting with [number]
      const allLines = translation.split('\n');
      const lines = allLines
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .filter(l => /^\[\d+\]/.test(l));
      console.log(`[Gemini Translator] Lazy chunk ${i+1}: got ${allLines.length} raw lines, ${lines.length} valid, expected ${chunk.map.length}`);        
      lines.forEach((line, lineIdx) => {
        const match = line.match(/^\[(\d+)\](.*)$/);
        if (match) {
          const index = parseInt(match[1]);
          let translation = match[2].trim();
          
          const entry = chunk.map.find(e => e.index === index);
          if (entry) {
            // Allow empty for single chars
            if (!translation && entry.trimmed.length === 1) {
              translation = entry.trimmed;
            }
            
            if (translation) {
              // Restore original whitespace
              let finalText = translation;
              if (entry.hasLeadingSpace) finalText = ' ' + finalText;
              if (entry.hasTrailingSpace) finalText = finalText + ' ';
              
              entry.node.textContent = finalText;
              // Mark as translated
              const idx = pendingTranslations.findIndex(e => e.index === index);
              if (idx !== -1) pendingTranslations.splice(idx, 1);
            }
          } else {
            console.warn(`[Gemini Translator] Lazy: Index ${index} not found (line ${lineIdx})`);
          }
        } else {
          console.warn(`[Gemini Translator] Lazy: Line ${lineIdx} format error: "${line.substring(0, 40)}..."`);
        }
      });
      
      if (i < chunks.length - 1) await sleep(300);
    } catch (error) {
      console.error('[Gemini Translator] Error translating visible chunk:', error);
    }
  }
}

// Setup intersection observer for scroll-based translation
function setupScrollObserver(apiKey, textStyle) {
  if (scrollObserver) {
    scrollObserver.disconnect();
  }
  
  const options = {
    root: null,
    rootMargin: '1000px', // Start translating when element is 1000px from viewport
    threshold: 0.01
  };
  
  scrollObserver = new IntersectionObserver(async (entries) => {
    if (translationInProgress) return;
    
    const nodesToTranslate = [];
    const processedIndexes = new Set();
    
    for (const entry of entries) {
      if (entry.isIntersecting) {
        // Find all pending translations in this element
        for (const pending of pendingTranslations) {
          if (!processedIndexes.has(pending.index) && isDescendantOf(pending.node, entry.target)) {
            nodesToTranslate.push(pending);
            processedIndexes.add(pending.index);
          }
        }
      }
    }
    
    if (nodesToTranslate.length > 0) {
      translationInProgress = true;
      await translateNodes(nodesToTranslate, apiKey, textStyle);
      translationInProgress = false;
    }
  }, options);
  
  // Observe parent elements of all pending translations
  const observedElements = new Set();
  for (const pending of pendingTranslations) {
    const element = pending.node.parentElement;
    if (element && !observedElements.has(element)) {
      observedElements.add(element);
      scrollObserver.observe(element);
    }
  }
  
  console.log(`[Gemini Translator] Observing ${observedElements.size} elements for lazy translation`);
  
  // Fallback: Translate remaining nodes after 10 seconds of inactivity
  let inactivityTimer = null;
  const checkRemainingNodes = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(async () => {
      if (pendingTranslations.length > 0 && !translationInProgress) {
        console.log(`[Gemini Translator] Translating ${pendingTranslations.length} remaining nodes after inactivity`);
        translationInProgress = true;
        await translateNodes([...pendingTranslations], apiKey, textStyle);
        translationInProgress = false;
      }
    }, 10000);
  };
  
  // Reset timer on scroll
  window.addEventListener('scroll', checkRemainingNodes, { passive: true });
  checkRemainingNodes();
}

// Translate a set of nodes
async function translateNodes(nodes, apiKey, textStyle) {
  if (nodes.length === 0) return;
  
  // Check extension context before starting
  if (!isExtensionContextValid()) {
    console.warn('[Gemini Translator] Extension context invalid, stopping lazy translation');
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }
    isLazyMode = false;
    return;
  }
  
  console.log(`[Gemini Translator] Lazy translating ${nodes.length} nodes...`);
  
  // Group into chunks
  const chunks = [];
  let currentChunk = '';
  let chunkMap = [];
  
  nodes.forEach((entry) => {
    // Use trimmed version for translation
    const line = `[${entry.index}]${entry.trimmed}\n`;
    
    if (currentChunk.length + line.length > 2000 && currentChunk.length > 0) {
      chunks.push({ text: currentChunk, map: chunkMap });
      currentChunk = line;
      chunkMap = [entry];
    } else {
      currentChunk += line;
      chunkMap.push(entry);
    }
  });
  
  if (currentChunk.length > 0) {
    chunks.push({ text: currentChunk, map: chunkMap });
  }
  
  // Translate chunks
  for (const chunk of chunks) {
    // Check context validity before each chunk
    if (!isExtensionContextValid()) {
      console.warn('[Gemini Translator] Extension context lost during translation');
      showNotification('Extension bị reload, vui lòng refresh trang', 'error');
      break;
    }
    
    try {
      const translation = await translateWithCache(chunk.text, apiKey, textStyle);
      
      // Filter: only keep lines starting with [number]
      const allLines = translation.split('\n');
      const lines = allLines
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .filter(l => /^\[\d+\]/.test(l));
      console.log(`[Gemini Translator] Scroll chunk: got ${allLines.length} raw lines, ${lines.length} valid, expected ${chunk.map.length}`);
      lines.forEach((line, lineIdx) => {
        const match = line.match(/^\[(\d+)\](.*)$/);
        if (match) {
          const index = parseInt(match[1]);
          let translation = match[2].trim();
          
          const entry = chunk.map.find(e => e.index === index);
          if (entry) {
            // Allow empty for single chars
            if (!translation && entry.trimmed.length === 1) {
              translation = entry.trimmed;
            }
            
            if (translation) {
              // Restore original whitespace
              let finalText = translation;
              if (entry.hasLeadingSpace) finalText = ' ' + finalText;
              if (entry.hasTrailingSpace) finalText = finalText + ' ';
              
              entry.node.textContent = finalText;
              // Remove from pending
              const idx = pendingTranslations.findIndex(e => e.index === index);
              if (idx !== -1) {
                pendingTranslations.splice(idx, 1);
                console.log(`[Gemini Translator] Translated index ${index}, ${pendingTranslations.length} remaining`);
              }
            }
          } else {
            console.warn(`[Gemini Translator] Scroll: Index ${index} not found (line ${lineIdx})`);
          }
        } else {
          console.warn(`[Gemini Translator] Scroll: Line ${lineIdx} format error: "${line.substring(0, 40)}..."`);
        }
      });
    } catch (error) {
      console.error('[Gemini Translator] Error in lazy translation:', error);
    }
  }
}

// Helper: check if node is descendant of element
function isDescendantOf(node, element) {
  let current = node;
  while (current) {
    if (current === element) return true;
    current = current.parentNode;
  }
  return false;
}

// Detect text style/tone for better translation
function detectTextStyle(textMap) {
  if (!textMap || textMap.length === 0) {
    return { type: 'general', name: 'Văn bản thông thường', instruction: '' };
  }
  
  // Combine sample text (first 1000 chars) - use trimmed if available
  const sampleText = textMap.slice(0, 50).map(e => e.trimmed || e.original).join(' ').substring(0, 1000).toLowerCase();
  
  // Count indicators
  const indicators = {
    // Academic/Technical
    technical: (sampleText.match(/\b(algorithm|function|method|class|interface|database|api|protocol|implementation|architecture)\b/gi) || []).length,
    academic: (sampleText.match(/\b(research|study|analysis|conclusion|hypothesis|methodology|experiment|data|results|findings)\b/gi) || []).length,
    
    // News/Journalism
    news: (sampleText.match(/\b(reported|according to|sources|announced|stated|officials|government|president|minister)\b/gi) || []).length,
    
    // Business/Formal
    business: (sampleText.match(/\b(company|business|market|industry|investment|profit|revenue|strategy|management|executive)\b/gi) || []).length,
    
    // Medical/Health
    medical: (sampleText.match(/\b(patient|treatment|disease|symptom|diagnosis|therapy|clinical|medical|health|doctor)\b/gi) || []).length,
    
    // Legal
    legal: (sampleText.match(/\b(law|legal|court|attorney|contract|agreement|clause|regulation|compliance|jurisdiction)\b/gi) || []).length,
    
    // Creative/Literary
    creative: (sampleText.match(/\b(story|character|novel|poem|imagination|adventure|journey|dream|beautiful|wonder)\b/gi) || []).length,
    
    // Conversational/Casual
    casual: (sampleText.match(/\b(hey|cool|awesome|great|wow|yeah|okay|basically|actually|pretty much)\b/gi) || []).length,
    
    // Educational/Tutorial
    tutorial: (sampleText.match(/\b(step|guide|tutorial|how to|learn|lesson|example|practice|exercise|instruction)\b/gi) || []).length
  };
  
  // Find dominant style
  let maxCount = 0;
  let dominantStyle = 'general';
  
  for (const [style, count] of Object.entries(indicators)) {
    if (count > maxCount && count >= 3) { // Minimum threshold
      maxCount = count;
      dominantStyle = style;
    }
  }
  
  // Style definitions with translation instructions
  const styles = {
    technical: {
      type: 'technical',
      name: 'Kỹ thuật/Công nghệ',
      instruction: 'This is technical/programming content. Keep technical terms in English when appropriate (e.g., API, function, class). Use precise, formal Vietnamese.'
    },
    academic: {
      type: 'academic',
      name: 'Học thuật/Nghiên cứu',
      instruction: 'This is academic/research content. Use formal, scholarly Vietnamese. Maintain academic terminology accurately.'
    },
    news: {
      type: 'news',
      name: 'Tin tức/Báo chí',
      instruction: 'This is news/journalism content. Use journalistic Vietnamese style, clear and objective tone.'
    },
    business: {
      type: 'business',
      name: 'Kinh doanh/Chính thức',
      instruction: 'This is business/corporate content. Use professional, formal Vietnamese appropriate for business context.'
    },
    medical: {
      type: 'medical',
      name: 'Y tế/Sức khỏe',
      instruction: 'This is medical/health content. Use accurate medical terminology in Vietnamese, maintain professional tone.'
    },
    legal: {
      type: 'legal',
      name: 'Pháp lý/Luật',
      instruction: 'This is legal content. Use precise legal Vietnamese terminology, maintain formal and exact language.'
    },
    creative: {
      type: 'creative',
      name: 'Văn học/Sáng tạo',
      instruction: 'This is creative/literary content. Use expressive, natural Vietnamese that captures the mood and emotion.'
    },
    casual: {
      type: 'casual',
      name: 'Thông thường/Đời thường',
      instruction: 'This is casual/conversational content. Use natural, everyday Vietnamese as people normally speak.'
    },
    tutorial: {
      type: 'tutorial',
      name: 'Hướng dẫn/Giáo dục',
      instruction: 'This is tutorial/educational content. Use clear, instructional Vietnamese that is easy to follow.'
    },
    general: {
      type: 'general',
      name: 'Văn bản thông thường',
      instruction: 'Translate naturally to Vietnamese.'
    }
  };
  
  return styles[dominantStyle] || styles.general;
}
