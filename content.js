// Content Script - Handles page translation
let originalContent = null;
let isTranslated = false;
let translationCache = new Map();
let isLazyMode = false;
let pendingTranslations = [];
let scrollObserver = null;
let translationInProgress = false;
let cacheLoaded = false;
let isPaused = false;
let fatalErrorOccurred = false;
const CONCURRENCY_LIMIT = 10;

// ============================================================================
// STREAMING STATE
// ============================================================================
let isStreamingMode = false;
let streamingChunks = [];           // Array of chunk data { text, map, status }
let streamingTextMap = [];          // Full text map for streaming mode
let streamingCompletedCount = 0;    // Number of completed chunks
let streamingTotalChunks = 0;       // Total chunks for progress tracking

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
        console.log(`[Gemini Translator] Loaded ${translationCache.size} cached translations (age: ${Math.round(cacheAge / (24 * 60 * 60 * 1000))} days)`);
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
  } else if (request.action === 'translatePageStreaming') {
    // New: Streaming translation mode
    handleTranslatePageStreaming();
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

  // ============================================================================
  // STREAMING MESSAGE HANDLERS
  // ============================================================================

  if (request.action === 'streamChunk') {
    handleStreamChunk(request.chunkIndex, request.partialText, request.delta);
    return true;
  }

  if (request.action === 'streamComplete') {
    handleStreamComplete(request.chunkIndex, request.translation, request.modelUsed);
    return true;
  }

  if (request.action === 'streamError') {
    handleStreamError(request.chunkIndex, request.error);
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
    const { apiKey, preferredModel } = await chrome.runtime.sendMessage({ action: 'getApiKey' });
    console.log('[Gemini Translator] API key received:', apiKey ? 'Yes (length: ' + apiKey.length + ')' : 'No');
    console.log('[Gemini Translator] Preferred model:', preferredModel);

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
      apiKey: apiKey,
      currentUrl: window.location.href
    });

    if (!testResponse.success) {
      console.error('[Gemini Translator] API test failed:', testResponse.error);
      showNotification('Lỗi API: ' + testResponse.error, 'error');
      hideLoadingIndicator();
      return;
    }

    console.log('[Gemini Translator] API test successful! Response:', testResponse.translation);
    const actualModel = testResponse.modelUsed || preferredModel || 'gemini-2.5-flash';

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
    // CHANGED: Lower threshold to 3000 chars to make lazy mode default for most pages
    const LAZY_MODE_THRESHOLD = 3000; // If more than 3000 chars, use lazy mode

    if (totalChars > LAZY_MODE_THRESHOLD) {
      console.log('[Gemini Translator] Large page detected, using lazy translation mode');
      showNotification(`Trang lớn (${Math.round(totalChars / 1000)}KB text), dịch theo scroll...`, 'info');
      await startLazyTranslation(textNodes, apiKey, actualModel);
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

    // Show sticky notification with model and writing style
    showStickyNotification(actualModel, textStyle);
    showNotification(`Phát hiện văn phong: ${textStyle.name}`, 'info');

    // Translate each chunk with retry logic
    let totalApplied = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[Gemini Translator] Translating chunk ${i + 1}/${chunks.length} (${chunk.text.length} chars)...`);

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

          console.log(`[Gemini Translator] Chunk ${i + 1}: got ${allLines.length} raw lines, ${lines.length} valid lines, expected ${chunk.map.length}`);

          // Log first and last lines to check for missing chunks
          if (lines.length > 0) {
            console.log(`[Gemini Translator] Chunk ${i + 1} first line: ${lines[0].substring(0, 80)}`);
            console.log(`[Gemini Translator] Chunk ${i + 1} last line: ${lines[lines.length - 1].substring(0, 80)}`);
          }

          if (lines.length < chunk.map.length) {
            console.warn(`[Gemini Translator] Chunk ${i + 1}: Missing ${chunk.map.length - lines.length} translations!`);
            console.warn(`[Gemini Translator] Expected indices: ${chunk.map[0].index} to ${chunk.map[chunk.map.length - 1].index}`);

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

          console.log(`[Gemini Translator] Chunk ${i + 1} applied ${chunkApplied} translations`);
          showNotification(`Đã dịch ${i + 1}/${chunks.length} phần (${totalApplied} đoạn)...`, 'info');
          success = true;

        } catch (error) {
          console.error(`[Gemini Translator] Chunk ${i + 1} error:`, error);
          retryCount++;

          if (retryCount < maxRetries) {
            const waitTime = Math.min(1000 * Math.pow(2, retryCount), 5000);
            console.log(`[Gemini Translator] Waiting ${waitTime}ms before retry...`);
            showNotification(`Chunk ${i + 1} lỗi, thử lại sau ${waitTime / 1000}s...`, 'info');
            await sleep(waitTime);
          } else {
            showNotification(`Lỗi dịch chunk ${i + 1}: ${error.message}`, 'error');
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
        textStyle: textStyle,
        currentUrl: window.location.href
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
    // Validate that translation is actually in Vietnamese
    const translation = response.translation;
    if (!isVietnameseText(translation)) {
      console.warn('[Gemini Translator] Warning: Translation might not be Vietnamese');
      console.warn('[Gemini Translator] Sample:', translation.substring(0, 200));
      // Don't throw error, but log warning - still cache it
    }

    // Cache the result
    translationCache.set(cacheKey, translation);
    saveCache();
    return translation;
  } else {
    throw new Error(response.error);
  }
}

// Check if text contains Vietnamese characters
function isVietnameseText(text) {
  // Vietnamese has special characters with diacritics
  const vietnameseChars = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  const chineseChars = /[\u4e00-\u9fff]/;

  // Sample first 500 chars
  const sample = text.substring(0, 500);

  // If it has Chinese chars and no Vietnamese chars, it's likely Chinese
  if (chineseChars.test(sample) && !vietnameseChars.test(sample)) {
    return false;
  }

  // If it has Vietnamese chars, it's likely Vietnamese
  if (vietnameseChars.test(sample)) {
    return true;
  }

  // For text without special chars (like numbers, English), assume OK
  return true;
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
    const { apiKey, preferredModel } = await chrome.runtime.sendMessage({ action: 'getApiKey' });

    if (!apiKey) {
      showNotification('Vui lòng cấu hình Gemini API key trong popup extension', 'error');
      hideLoadingIndicator();
      hideProgressBar();
      return;
    }

    // Test API to get actual model being used
    const testResponse = await chrome.runtime.sendMessage({
      action: 'translate',
      text: 'Hello',
      apiKey: apiKey,
      currentUrl: window.location.href
    });
    const actualModel = testResponse.modelUsed || preferredModel || 'gemini-2.5-flash';

    // Save original content
    if (!originalContent) {
      originalContent = document.body.cloneNode(true);
    }

    // Get all text nodes
    const textNodes = getTextNodes(document.body);
    console.log('[Gemini Translator] Found', textNodes.length, 'text nodes');

    // Calculate total characters for balancing
    const totalChars = textNodes.reduce((sum, node) => {
      const text = node.textContent.trim();
      return text.length >= 3 ? sum + text.length : sum;
    }, 0);

    // Group text nodes into chunks
    // Balanced Chunking Algorithm (User Request: Min 3 threads, Max 15k chars, Even Load)
    const MIN_CHUNKS = 3;
    const MAX_CHUNK_SIZE = 15000;

    // Calculate optimal chunk count
    // 1. Minimum chunks needed to respect the 15k limit
    const chunksByLimit = Math.ceil(totalChars / MAX_CHUNK_SIZE);

    // 2. Enforce minimum concurrency (3) if text is large enough (> 3000 chars)
    // If text is tiny (e.g. 1000 chars), don't force 3 tiny requests of 300 chars.
    let targetChunkCount = chunksByLimit;
    if (totalChars > 3000) {
      targetChunkCount = Math.max(chunksByLimit, MIN_CHUNKS);
    }

    // 3. Calculate the ideal size for even distribution
    const optimalChunkSize = Math.ceil(totalChars / targetChunkCount);

    console.log(`[Gemini Translator] Balancing Load: Total ${totalChars} chars`);
    console.log(`[Gemini Translator] Target Chunks: ${targetChunkCount} (Limit needed: ${chunksByLimit}, Min needed: ${MIN_CHUNKS})`);
    console.log(`[Gemini Translator] Optimal Batch Size: ~${optimalChunkSize} chars`);

    // Group text nodes into balanced chunks
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

        // Use optimalChunkSize instead of fixed limit
        if (currentChunk.length + line.length > optimalChunkSize && currentChunk.length > 0) {
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
    updateProgressBar(0, chunks.length);

    // Detect text style
    const textStyle = detectTextStyle(textMap);
    console.log('[Gemini Translator] Detected text style:', textStyle);

    // Show sticky notification with model and writing style
    showStickyNotification(actualModel, textStyle);

    // Translate chunks with Worker Queue logic (High Concurrency + Pause + Fail-Fast)
    let totalApplied = 0;

    // reset states
    isPaused = false;
    fatalErrorOccurred = false;

    // Create a queue of tasks
    const queue = chunks.map((chunk, index) => ({ chunk, index }));
    let activeRequests = 0;
    let completedChunks = 0;

    console.log(`[Gemini Translator] Starting worker queue with ${CONCURRENCY_LIMIT} threads`);

    // Main loop: keep dispatching while there is work or active requests
    while ((queue.length > 0 || activeRequests > 0) && !fatalErrorOccurred) {

      // 1. Check Pause
      if (isPaused) {
        await sleep(200);
        continue;
      }

      // 2. Dispatch new workers if slot available
      while (queue.length > 0 && activeRequests < CONCURRENCY_LIMIT && !isPaused && !fatalErrorOccurred) {
        const item = queue.shift();
        activeRequests++;

        // Process chunk asynchronously (FIRE AND FORGET - but tracked via activeRequests)
        processChunkWithRetry(item.chunk, item.index, chunks.length, apiKey, textStyle)
          .then((success) => {
            activeRequests--;
            if (success) {
              completedChunks++;
              totalApplied++; // Note: strictly this should count actual applied segments, simplified here
              updateProgressBar(completedChunks, chunks.length);
            }
          })
          .catch((error) => {
            activeRequests--;
            console.error(`[Gemini Translator] Fatal error in chunk ${item.index}:`, error);
            fatalErrorOccurred = true; // Trigger Fail-Fast
            showNotification(`Lỗi dừng dịch: ${error.message}`, 'error');
          });
      }

      // 3. Wait a bit before next loop iteration to prevent tight CPU loop
      await sleep(50);
    }

    if (fatalErrorOccurred) {
      throw new Error('Dịch bị dừng do lỗi.');
    }

    console.log('[Gemini Translator] Translation queue finished.');
    isTranslated = true;
    hideProgressBar();
    showNotification('Đã dịch toàn bộ trang thành công!', 'success');

  } catch (error) {
    // Fail-fast handled here
    if (fatalErrorOccurred) {
      // Already notified
    } else {
      console.error('[Gemini Translator] Translation error:', error);
      showNotification('Lỗi khi dịch: ' + error.message, 'error');
    }
    hideProgressBar();
  } finally {
    hideLoadingIndicator();
  }
}

// Helper: Process single chunk with retry (Moved out of loop for clarity)
async function processChunkWithRetry(chunk, index, totalChunks, apiKey, textStyle) {
  if (fatalErrorOccurred) return false;

  console.log(`[Gemini Translator] Worker starting chunk ${index + 1}/${totalChunks}...`);

  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount <= maxRetries) {
    if (fatalErrorOccurred) return false;
    if (isPaused) {
      // If paused mid-retry, wait.
      await sleep(500);
      continue;
    }

    try {
      const translation = await translateWithCache(chunk.text, apiKey, textStyle);

      // Validate
      if (!isVietnameseText(translation)) {
        if (retryCount < maxRetries) {
          console.warn(`[Gemini Translator] Chunk ${index + 1}: Validation failed, retrying...`);
          const cacheKey = getCacheKey(chunk.text, textStyle);
          translationCache.delete(cacheKey);
          retryCount++;
          await sleep(500);
          continue;
        } else {
          throw new Error(`Chunk ${index + 1} failed validation (not Vietnamese)`);
        }
      }

      // Apply
      applyTranslationToMap(translation, chunk.map);
      return true; // Success

    } catch (error) {
      // Check for Response too long (Permanent Error -> Fail Fast)
      if (error.message && error.message.includes('Response too long')) {
        throw error; // Fatal
      }

      if (retryCount < maxRetries) {
        retryCount++;
        await sleep(1000 * Math.pow(2, retryCount));
      } else {
        throw error; // Failed all retries -> Fatal
      }
    }
  }
  return false;
}

// Helper to apply translation
function applyTranslationToMap(translatedText, map) {
  const allLines = translatedText.split('\n');
  allLines.forEach(line => {
    const match = line.match(/^\[(\d+)\](.*)$/);
    if (match) {
      const idx = parseInt(match[1]);
      let txt = match[2].trim();
      const entry = map.find(e => e.index === idx);
      if (entry) {
        if (!txt && entry.trimmed.length === 1) txt = entry.trimmed;
        if (txt) {
          let final = txt;
          if (entry.hasLeadingSpace) final = ' ' + final;
          if (entry.hasTrailingSpace) final = final + ' ';
          entry.node.textContent = final;
        }
      }
    }
  });
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

// ============================================================================
// STREAMING TRANSLATION FUNCTIONS
// ============================================================================

/**
 * Handle full page translation with STREAMING mode
 * Text appears progressively as API responds
 */
async function handleTranslatePageStreaming() {
  console.log('[Gemini Translator] Starting STREAMING page translation...');

  // Stop other modes if active
  if (isLazyMode && scrollObserver) {
    scrollObserver.disconnect();
    scrollObserver = null;
    isLazyMode = false;
  }

  if (isTranslated) {
    console.log('[Gemini Translator] Page already translated, restoring original...');
    restoreOriginalContent();
    return;
  }

  showLoadingIndicator();
  showProgressBar();
  showStreamingIndicator();

  try {
    // Get API key
    const { apiKey, preferredModel } = await chrome.runtime.sendMessage({ action: 'getApiKey' });

    if (!apiKey) {
      showNotification('Vui lòng cấu hình Gemini API key trong popup extension', 'error');
      hideLoadingIndicator();
      hideProgressBar();
      hideStreamingIndicator();
      return;
    }

    // Save original content
    if (!originalContent) {
      originalContent = document.body.cloneNode(true);
    }

    // Get all text nodes
    const textNodes = getTextNodes(document.body);
    console.log('[Gemini Translator] Found', textNodes.length, 'text nodes');

    // Calculate total characters
    const totalChars = textNodes.reduce((sum, node) => {
      const text = node.textContent.trim();
      return text.length >= 3 ? sum + text.length : sum;
    }, 0);

    // Balanced chunking (similar to handleTranslatePageFull)
    const MIN_CHUNKS = 3;
    const MAX_CHUNK_SIZE = 15000;
    const chunksByLimit = Math.ceil(totalChars / MAX_CHUNK_SIZE);
    let targetChunkCount = chunksByLimit;
    if (totalChars > 3000) {
      targetChunkCount = Math.max(chunksByLimit, MIN_CHUNKS);
    }
    const optimalChunkSize = Math.ceil(totalChars / targetChunkCount);

    console.log(`[Gemini Translator] Streaming: ${totalChars} chars, ${targetChunkCount} chunks`);

    // Build text map and chunks
    streamingTextMap = [];
    streamingChunks = [];
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
        streamingTextMap.push(entry);

        const line = `[${index}]${trimmed}\n`;

        if (currentChunk.length + line.length > optimalChunkSize && currentChunk.length > 0) {
          streamingChunks.push({ text: currentChunk, map: chunkMap, status: 'pending' });
          currentChunk = line;
          chunkMap = [entry];
        } else {
          currentChunk += line;
          chunkMap.push(entry);
        }
      }
    });

    if (currentChunk.length > 0) {
      streamingChunks.push({ text: currentChunk, map: chunkMap, status: 'pending' });
    }

    // Initialize streaming state
    isStreamingMode = true;
    streamingCompletedCount = 0;
    streamingTotalChunks = streamingChunks.length;
    fatalErrorOccurred = false;

    console.log(`[Gemini Translator] Starting ${streamingChunks.length} streaming requests`);
    updateProgressBar(0, streamingChunks.length);

    // Detect text style
    const textStyle = detectTextStyle(streamingTextMap);
    showStickyNotification(preferredModel, textStyle);

    // Start streaming requests for all chunks (concurrent)
    for (let i = 0; i < streamingChunks.length; i++) {
      const chunk = streamingChunks[i];
      chunk.status = 'streaming';

      // Send streaming request to background
      chrome.runtime.sendMessage({
        action: 'streamTranslate',
        text: chunk.text,
        apiKey: apiKey,
        textStyle: textStyle,
        currentUrl: window.location.href,
        chunkIndex: i
      });
    }

    showNotification(`Đang dịch streaming ${streamingChunks.length} phần...`, 'info');

  } catch (error) {
    console.error('[Gemini Translator] Streaming setup error:', error);
    showNotification('Lỗi khi khởi tạo streaming: ' + error.message, 'error');
    hideProgressBar();
    hideStreamingIndicator();
  } finally {
    hideLoadingIndicator();
  }
}

/**
 * Handle incoming stream chunk - update UI in real-time
 */
function handleStreamChunk(chunkIndex, partialText, delta) {
  if (!isStreamingMode || chunkIndex >= streamingChunks.length) return;

  const chunk = streamingChunks[chunkIndex];
  if (!chunk) return;

  // Apply partial translation to UI
  // Parse whatever lines are complete so far
  const lines = partialText.split('\n');

  for (const line of lines) {
    const match = line.match(/^\[(\d+)\](.+)$/);
    if (match) {
      const idx = parseInt(match[1]);
      const translation = match[2].trim();

      const entry = chunk.map.find(e => e.index === idx);
      if (entry && translation) {
        // Apply with whitespace preservation
        let finalText = translation;
        if (entry.hasLeadingSpace) finalText = ' ' + finalText;
        if (entry.hasTrailingSpace) finalText = finalText + ' ';

        // Only update if text changed
        if (entry.node.textContent !== finalText) {
          entry.node.textContent = finalText;

          // Add streaming highlight effect
          entry.node.parentElement?.classList.add('gemini-streaming-active');
          setTimeout(() => {
            entry.node.parentElement?.classList.remove('gemini-streaming-active');
          }, 500);
        }
      }
    }
  }

  // Update streaming indicator
  updateStreamingIndicator(chunkIndex, delta);
}

/**
 * Handle stream completion for a chunk
 */
function handleStreamComplete(chunkIndex, translation, modelUsed) {
  if (!isStreamingMode || chunkIndex >= streamingChunks.length) return;

  const chunk = streamingChunks[chunkIndex];
  if (!chunk) return;

  console.log(`[Gemini Translator] Stream complete for chunk ${chunkIndex + 1}/${streamingTotalChunks}`);

  // Apply final translation
  applyTranslationToMap(translation, chunk.map);
  chunk.status = 'completed';

  streamingCompletedCount++;
  updateProgressBar(streamingCompletedCount, streamingTotalChunks);

  // Check if all chunks are done
  if (streamingCompletedCount >= streamingTotalChunks) {
    finishStreamingTranslation(modelUsed);
  }
}

/**
 * Handle stream error for a chunk
 */
function handleStreamError(chunkIndex, errorMessage) {
  console.error(`[Gemini Translator] Stream error for chunk ${chunkIndex}: ${errorMessage}`);

  if (chunkIndex < streamingChunks.length) {
    streamingChunks[chunkIndex].status = 'error';
  }

  // Show error but don't stop other chunks
  showNotification(`Lỗi chunk ${chunkIndex + 1}: ${errorMessage}`, 'error');

  // If too many errors, stop
  const errorCount = streamingChunks.filter(c => c.status === 'error').length;
  if (errorCount > streamingTotalChunks / 2) {
    fatalErrorOccurred = true;
    showNotification('Quá nhiều lỗi, dừng dịch streaming', 'error');
    hideProgressBar();
    hideStreamingIndicator();
    isStreamingMode = false;
  }
}

/**
 * Finish streaming translation
 */
function finishStreamingTranslation(modelUsed) {
  console.log('[Gemini Translator] All streaming chunks completed!');

  isStreamingMode = false;
  isTranslated = true;

  hideProgressBar();
  hideStreamingIndicator();

  const successCount = streamingChunks.filter(c => c.status === 'completed').length;
  const errorCount = streamingChunks.filter(c => c.status === 'error').length;

  if (errorCount > 0) {
    showNotification(`Hoàn thành ${successCount}/${streamingTotalChunks} phần (${errorCount} lỗi)`, 'warning');
  } else {
    showNotification('Đã dịch streaming toàn bộ trang thành công!', 'success');
  }
}

/**
 * Show streaming indicator
 */
function showStreamingIndicator() {
  let indicator = document.getElementById('gemini-streaming-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'gemini-streaming-indicator';
    indicator.className = 'gemini-streaming-indicator';
    indicator.innerHTML = `
      <div class="streaming-content">
        <div class="streaming-icon">⚡</div>
        <div class="streaming-text">
          <span class="streaming-label">Streaming...</span>
          <span class="streaming-delta"></span>
        </div>
      </div>
    `;
    document.body.appendChild(indicator);
  }
  indicator.style.display = 'flex';
}

/**
 * Hide streaming indicator
 */
function hideStreamingIndicator() {
  const indicator = document.getElementById('gemini-streaming-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
}

/**
 * Update streaming indicator with latest delta
 */
function updateStreamingIndicator(chunkIndex, delta) {
  const indicator = document.getElementById('gemini-streaming-indicator');
  if (indicator) {
    const deltaEl = indicator.querySelector('.streaming-delta');
    const labelEl = indicator.querySelector('.streaming-label');

    if (labelEl) {
      labelEl.textContent = `Chunk ${chunkIndex + 1}/${streamingTotalChunks}`;
    }
    if (deltaEl && delta) {
      // Show last 30 chars of delta
      deltaEl.textContent = delta.length > 30 ? '...' + delta.slice(-30) : delta;
    }
  }
}


// Get all text nodes in the document
function getTextNodes(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
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

  // Store selection range for positioning
  const selection = window.getSelection();
  let selectionRect = null;
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    selectionRect = range.getBoundingClientRect();
  }

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
      apiKey: apiKey,
      currentUrl: window.location.href
    });

    if (response.success) {
      showTranslationPopup(text, response.translation, selectionRect);
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

// Show translation popup for selected text with smart positioning
function showTranslationPopup(original, translation, selectionRect) {
  // Remove existing popup if any
  const existingPopup = document.getElementById('gemini-translator-popup');
  if (existingPopup) existingPopup.remove();

  const popup = document.createElement('div');
  popup.id = 'gemini-translator-popup';
  popup.className = 'gemini-translator-popup';
  popup.innerHTML = `
    <div class="popup-header">
      <span>📖 Bản dịch</span>
      <button class="popup-close">&times;</button>
    </div>
    <div class="popup-content">
      <div class="original-text">
        <strong>Văn bản gốc:</strong>
        <div class="text-content">${escapeHtml(original)}</div>
      </div>
      <div class="translated-text">
        <strong>🇻🇳 Tiếng Việt:</strong>
        <div class="text-content">${escapeHtml(translation)}</div>
      </div>
      <div class="popup-actions">
        <button class="action-btn explain-btn" title="Giải thích ngữ nghĩa chi tiết">
          <span class="btn-icon">💡</span>
          <span class="btn-text">Giải thích ngữ nghĩa</span>
        </button>
        <button class="action-btn copy-btn" title="Sao chép bản dịch">
          <span class="btn-icon">📋</span>
          <span class="btn-text">Sao chép</span>
        </button>
      </div>
      <div class="explanation-section" style="display: none;">
        <strong>📚 Giải thích ngữ nghĩa:</strong>
        <div class="explanation-content">
          <div class="explanation-loading">
            <div class="mini-spinner"></div>
            <span>Đang phân tích...</span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  // Calculate optimal position
  positionPopupOptimally(popup, selectionRect);

  // Event handlers
  const closeBtn = popup.querySelector('.popup-close');
  const explainBtn = popup.querySelector('.explain-btn');
  const copyBtn = popup.querySelector('.copy-btn');
  const explanationSection = popup.querySelector('.explanation-section');

  // Close handler
  closeBtn.addEventListener('click', () => {
    popup.classList.add('popup-closing');
    setTimeout(() => popup.remove(), 200);
  });

  // Explain handler
  let explanationLoaded = false;
  let autoCloseTimer = null;

  explainBtn.addEventListener('click', async () => {
    if (!explanationLoaded) {
      explanationSection.style.display = 'block';
      await loadSemanticExplanation(original, explanationSection.querySelector('.explanation-content'));
      explanationLoaded = true;
      explainBtn.classList.add('active');

      // Extend auto-close time when explanation is loaded
      if (autoCloseTimer) {
        clearTimeout(autoCloseTimer);
      }
      autoCloseTimer = setTimeout(() => {
        if (popup.parentElement) {
          popup.classList.add('popup-closing');
          setTimeout(() => popup.remove(), 200);
        }
      }, 60000); // 60 seconds instead of 30
    } else {
      // Toggle visibility
      if (explanationSection.style.display === 'none') {
        explanationSection.style.display = 'block';
        explainBtn.classList.add('active');
      } else {
        explanationSection.style.display = 'none';
        explainBtn.classList.remove('active');
      }
    }
  });

  // Copy handler
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(translation);
      copyBtn.innerHTML = '<span class="btn-icon">✅</span><span class="btn-text">Đã sao chép!</span>';
      setTimeout(() => {
        copyBtn.innerHTML = '<span class="btn-icon">📋</span><span class="btn-text">Sao chép</span>';
      }, 2000);
    } catch (err) {
      showNotification('Không thể sao chép', 'error');
    }
  });

  // Click outside to close
  setTimeout(() => {
    const closeOnClickOutside = (e) => {
      if (!popup.contains(e.target)) {
        popup.classList.add('popup-closing');
        setTimeout(() => popup.remove(), 200);
        document.removeEventListener('click', closeOnClickOutside);
      }
    };
    document.addEventListener('click', closeOnClickOutside);
  }, 100);

  // Auto close after 30 seconds (initial timeout)
  autoCloseTimer = setTimeout(() => {
    if (popup.parentElement) {
      popup.classList.add('popup-closing');
      setTimeout(() => popup.remove(), 200);
    }
  }, 15000);
}

// Calculate optimal popup position
function positionPopupOptimally(popup, selectionRect) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // Get popup dimensions (approximate before actual render)
  popup.style.visibility = 'hidden';
  popup.style.display = 'block';
  const popupWidth = popup.offsetWidth;
  const popupHeight = popup.offsetHeight;
  popup.style.visibility = '';
  popup.style.display = '';

  const margin = 10;
  let top, left;
  let positionClass = '';

  if (selectionRect) {
    // Try positions in order of preference
    const positions = [
      // Below selection
      {
        top: selectionRect.bottom + scrollY + margin,
        left: selectionRect.left + scrollX,
        class: 'position-below'
      },
      // Above selection
      {
        top: selectionRect.top + scrollY - popupHeight - margin,
        left: selectionRect.left + scrollX,
        class: 'position-above'
      },
      // Right of selection
      {
        top: selectionRect.top + scrollY,
        left: selectionRect.right + scrollX + margin,
        class: 'position-right'
      },
      // Left of selection
      {
        top: selectionRect.top + scrollY,
        left: selectionRect.left + scrollX - popupWidth - margin,
        class: 'position-left'
      }
    ];

    // Find first position that fits in viewport
    let bestPosition = null;
    for (const pos of positions) {
      const fitsVertically = pos.top >= scrollY && (pos.top + popupHeight) <= (scrollY + viewportHeight);
      const fitsHorizontally = pos.left >= scrollX && (pos.left + popupWidth) <= (scrollX + viewportWidth);

      if (fitsVertically && fitsHorizontally) {
        bestPosition = pos;
        break;
      }
    }

    // Use best position or fallback to center
    if (bestPosition) {
      top = bestPosition.top;
      left = bestPosition.left;
      positionClass = bestPosition.class;
    } else {
      // Fallback: center in viewport
      top = scrollY + (viewportHeight - popupHeight) / 2;
      left = scrollX + (viewportWidth - popupWidth) / 2;
      positionClass = 'position-center';
    }

    // Ensure popup stays within bounds
    left = Math.max(scrollX + margin, Math.min(left, scrollX + viewportWidth - popupWidth - margin));
    top = Math.max(scrollY + margin, Math.min(top, scrollY + viewportHeight - popupHeight - margin));
  } else {
    // No selection rect - center in viewport
    top = scrollY + (viewportHeight - popupHeight) / 2;
    left = scrollX + (viewportWidth - popupWidth) / 2;
    positionClass = 'position-center';
  }

  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup.classList.add(positionClass);
}

// Load semantic explanation
async function loadSemanticExplanation(text, container) {
  try {
    const { apiKey } = await chrome.runtime.sendMessage({ action: 'getApiKey' });

    if (!apiKey) {
      container.innerHTML = '<div class="explanation-error">⚠️ Vui lòng cấu hình API key</div>';
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: 'explainText',
      text: text,
      apiKey: apiKey
    });

    if (response.success) {
      // Format explanation with nice styling
      const formattedExplanation = formatExplanation(response.explanation);
      container.innerHTML = `<div class="explanation-text">${formattedExplanation}</div>`;
    } else {
      container.innerHTML = `<div class="explanation-error">❌ Lỗi: ${escapeHtml(response.error)}</div>`;
    }
  } catch (error) {
    container.innerHTML = `<div class="explanation-error">❌ Lỗi: ${escapeHtml(error.message)}</div>`;
  }
}

// Format explanation text with proper markdown parsing
function formatExplanation(text) {
  if (!text) return '';

  // Split into lines for processing
  let lines = text.split('\n');
  let html = [];
  let inList = false;
  let inCodeBlock = false;
  let inNumberedList = false;
  let codeBlockContent = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let trimmedLine = line.trim();

    // Handle code blocks
    if (trimmedLine.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        html.push('<div class="code-block">');
        html.push(codeBlockContent.map(l => escapeHtml(l)).join('\n'));
        html.push('</div>');
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        // Start code block
        if (inList) {
          html.push('</ul>');
          inList = false;
        }
        if (inNumberedList) {
          html.push('</ol>');
          inNumberedList = false;
        }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Skip empty lines with proper spacing
    if (!trimmedLine) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      if (inNumberedList) {
        html.push('</ol>');
        inNumberedList = false;
      }
      html.push('<div class="explanation-spacer"></div>');
      continue;
    }

    // Headers: ### Header or ## Header or # Header
    if (/^#{1,6}\s+/.test(trimmedLine)) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      if (inNumberedList) {
        html.push('</ol>');
        inNumberedList = false;
      }

      const level = trimmedLine.match(/^#+/)[0].length;
      let headerText = trimmedLine.replace(/^#{1,6}\s+/, '').replace(/\s*#+\s*$/, '');
      headerText = processInlineFormatting(headerText);
      html.push(`<div class="explanation-header level-${level}">${headerText}</div>`);
      continue;
    }

    // Headers with numbers at start: "1. **Text**" or just "1. Text"
    if (/^(\d+)\.\s+\*\*/.test(trimmedLine)) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      if (inNumberedList) {
        html.push('</ol>');
        inNumberedList = false;
      }

      let headerText = trimmedLine.replace(/^\d+\.\s+/, '').replace(/^\*\*/, '').replace(/\*\*:?\s*$/, '');
      headerText = processInlineFormatting(headerText);
      html.push(`<div class="explanation-header">${headerText}</div>`);
      continue;
    }

    // Numbered list items: "1. text" or "1) text"
    if (/^(\d+)[.)]\s+/.test(trimmedLine)) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      if (!inNumberedList) {
        html.push('<ol class="explanation-numbered-list">');
        inNumberedList = true;
      }

      let itemText = trimmedLine.replace(/^\d+[.)]\s+/, '');
      itemText = processInlineFormatting(itemText);
      html.push(`<li>${itemText}</li>`);
      continue;
    }

    // Bullet list items: lines starting with -, •, *, or +
    if (/^[\-\•\*\+]\s+/.test(trimmedLine)) {
      if (inNumberedList) {
        html.push('</ol>');
        inNumberedList = false;
      }
      if (!inList) {
        html.push('<ul class="explanation-list">');
        inList = true;
      }

      let itemText = trimmedLine.replace(/^[\-\•\*\+]\s+/, '');
      itemText = processInlineFormatting(itemText);
      html.push(`<li>${itemText}</li>`);
      continue;
    }

    // Blockquotes: > text
    if (trimmedLine.startsWith('> ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      if (inNumberedList) {
        html.push('</ol>');
        inNumberedList = false;
      }

      let quoteText = trimmedLine.replace(/^>\s+/, '');
      quoteText = processInlineFormatting(quoteText);
      html.push(`<div class="explanation-blockquote">${quoteText}</div>`);
      continue;
    }

    // Horizontal rules: --- or *** or ___
    if (/^([-*_]){3,}$/.test(trimmedLine)) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      if (inNumberedList) {
        html.push('</ol>');
        inNumberedList = false;
      }
      html.push('<hr class="explanation-divider">');
      continue;
    }

    // Regular paragraph
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    if (inNumberedList) {
      html.push('</ol>');
      inNumberedList = false;
    }

    trimmedLine = processInlineFormatting(trimmedLine);
    html.push(`<div class="explanation-paragraph">${trimmedLine}</div>`);
  }

  // Close any open lists or code blocks
  if (inList) {
    html.push('</ul>');
  }
  if (inNumberedList) {
    html.push('</ol>');
  }
  if (inCodeBlock && codeBlockContent.length > 0) {
    html.push('<div class="code-block">');
    html.push(codeBlockContent.map(l => escapeHtml(l)).join('\n'));
    html.push('</div>');
  }

  return html.join('\n');
}

// Process inline markdown formatting (bold, italic, inline code, strikethrough)
function processInlineFormatting(text) {
  // Escape HTML first
  text = escapeHtml(text);

  // Inline code: `code` (must come first to preserve content)
  text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold: **text** or __text__ (must come before italic)
  text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_ (single char, not in middle of word)
  text = text.replace(/(?<!\w)\*([^*\s][^*]*?)\*(?!\w)/g, '<em>$1</em>');
  text = text.replace(/(?<!\w)_([^_\s][^_]*?)_(?!\w)/g, '<em>$1</em>');

  // Strikethrough: ~~text~~
  text = text.replace(/~~([^~]+?)~~/g, '<del>$1</del>');

  // Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Highlight/mark: ==text==
  text = text.replace(/==([^=]+)==/g, '<mark>$1</mark>');

  return text;
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

// Show sticky notification with model and writing style info
function showStickyNotification(modelName, textStyle) {
  // Remove existing sticky notification if any
  const existing = document.getElementById('gemini-translator-sticky-notification');
  if (existing) {
    existing.remove();
  }

  const notification = document.createElement('div');
  notification.id = 'gemini-translator-sticky-notification';
  notification.className = 'gemini-translator-sticky-notification';
  notification.innerHTML = `
    <div class="sticky-notification-header">
      <span class="sticky-notification-title">🌐 Gemini Translator</span>
      <button class="sticky-notification-close" title="Đóng">✕</button>
    </div>
    <div class="sticky-notification-content">
      <div class="sticky-notification-item">
        <strong>Model:</strong> <span class="sticky-notification-value">${escapeHtml(modelName)}</span>
      </div>
      <div class="sticky-notification-item">
        <strong>Văn phong:</strong> <span class="sticky-notification-value">${escapeHtml(textStyle.name)}</span>
      </div>
    </div>
  `;

  document.body.appendChild(notification);

  // Add close button handler
  const closeBtn = notification.querySelector('.sticky-notification-close');
  closeBtn.addEventListener('click', () => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  });

  // Show with animation
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
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
        <div class="progress-header">
          <div class="progress-text">Đang dịch: <span id="progress-current">0</span>/<span id="progress-total">0</span></div>
          <button id="gemini-translator-pause-btn" class="pause-btn" title="Tạm dừng/Tiếp tục">⏯</button>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="progress-bar-fill" style="width: 0%"></div>
        </div>
        <div class="progress-percent" id="progress-percent">0%</div>
      </div>
    `;
    document.body.appendChild(progressBar);

    // Add pause listener
    const pauseBtn = document.getElementById('gemini-translator-pause-btn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        isPaused = !isPaused;
        pauseBtn.textContent = isPaused ? '▶' : '⏯';
        pauseBtn.title = isPaused ? 'Tiếp tục' : 'Tạm dừng';
        showNotification(isPaused ? 'Đã tạm dừng dịch' : 'Đang tiếp tục dịch...', 'info');
      });
    }
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
async function startLazyTranslation(textNodes, apiKey, modelName) {
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

  // Show sticky notification with model and writing style
  showStickyNotification(modelName || 'gemini-2.5-flash', textStyle);

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
      console.log(`[Gemini Translator] Lazy chunk ${i + 1}: got ${allLines.length} raw lines, ${lines.length} valid, expected ${chunk.map.length}`);
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
