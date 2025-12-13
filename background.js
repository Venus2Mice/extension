// Background Service Worker
importScripts('domain-analyzer.js');

chrome.runtime.onInstalled.addListener(() => {
  // Create context menu
  chrome.contextMenus.create({
    id: 'translatePage',
    title: 'Dịch trang (Lazy - Mặc định)',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'translatePageFull',
    title: 'Dịch toàn bộ trang (Full)',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'translatePageStreaming',
    title: '⚡ Dịch Streaming (Real-time)',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'translateSelection',
    title: 'Dịch văn bản đã chọn',
    contexts: ['selection']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    // Ensure content script is injected
    await ensureContentScript(tab.id);

    if (info.menuItemId === 'translatePage') {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translatePage'
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error:', chrome.runtime.lastError.message);
        }
      });
    } else if (info.menuItemId === 'translatePageFull') {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translatePageFull'
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error:', chrome.runtime.lastError.message);
        }
      });
    } else if (info.menuItemId === 'translatePageStreaming') {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translatePageStreaming'
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error:', chrome.runtime.lastError.message);
        }
      });
    } else if (info.menuItemId === 'translateSelection') {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translateSelection',
        text: info.selectionText
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error:', chrome.runtime.lastError.message);
        }
      });
    }
  } catch (error) {
    console.error('Error handling context menu:', error);
  }
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getApiKey') {
    chrome.storage.sync.get(['geminiApiKey', 'preferredModel', 'styleOverride'], (result) => {
      sendResponse({
        apiKey: result.geminiApiKey || '',
        preferredModel: result.preferredModel || 'gemini-2.5-flash',
        styleOverride: result.styleOverride || 'auto'
      });
    });
    return true; // Keep the message channel open for async response
  }

  if (request.action === 'translate') {
    translateText(request.text, request.apiKey, request.textStyle, request.currentUrl)
      .then(result => sendResponse({
        success: true,
        translation: result.translation,
        modelUsed: result.modelUsed,
        domainContext: result.domainContext
      }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'testModels') {
    testAvailableModels(request.apiKey)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'analyzeDomain') {
    getDomainProfile(request.url, request.apiKey)
      .then(profile => sendResponse({ success: true, profile }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getDomainStats') {
    getDomainCacheStats()
      .then(stats => sendResponse({ success: true, stats }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'clearDomainCache') {
    clearDomainCache()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // ============================================================================
  // SMART CONTENT FILTER HANDLERS
  // ============================================================================

  if (request.action === 'checkContentFilter') {
    isContentBlocked(request.url, request.textContent || '')
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'allowDomain') {
    allowDomain(request.domain)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'blockDomainPermanently') {
    blockDomainPermanently(request.domain)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'addBlockedDomain') {
    addCustomBlockedDomain(request.domain)
      .then(added => sendResponse({ success: true, added }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'removeBlockedDomain') {
    removeCustomBlockedDomain(request.domain)
      .then(removed => sendResponse({ success: true, removed }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getBlockedDomains') {
    getCustomBlockedDomains()
      .then(domains => sendResponse({ success: true, domains }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getFilterStats') {
    getFilterStats()
      .then(stats => sendResponse({ success: true, stats }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'resetDomainWarning') {
    resetDomainWarning(request.domain)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'explainText') {
    explainTextSemantics(request.text, request.apiKey)
      .then(result => sendResponse({ success: true, explanation: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Streaming translation - sends chunks progressively to content script
  if (request.action === 'streamTranslate') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return true;
    }

    // Start streaming in background, respond immediately
    streamTranslateText(
      request.text,
      request.apiKey,
      request.textStyle,
      request.currentUrl,
      request.chunkIndex,
      tabId
    ).catch(error => {
      console.error('[Gemini Translator BG] Stream error:', error);
      // Notify content script of error
      chrome.tabs.sendMessage(tabId, {
        action: 'streamError',
        chunkIndex: request.chunkIndex,
        error: error.message
      });
    });

    sendResponse({ success: true, started: true });
    return true;
  }

  // ============================================================================
  // SELF-LEARNING HANDLERS (simplified - no vocabulary)
  // ============================================================================

  if (request.action === 'recordFeedback') {
    recordFeedback(request.url, request.isPositive, request.comment)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'trackUrl') {
    trackVisitedUrl(request.url)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'updateGuidelines') {
    updateRefinedGuidelines(request.url, request.guidelines)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

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

// Helper: Parse API error to get meaningful info
function parseApiError(errorText, statusCode) {
  try {
    const errorData = JSON.parse(errorText);
    if (errorData.error) {
      const error = errorData.error;
      return {
        code: error.code || statusCode,
        message: error.message || 'Unknown error',
        status: error.status || 'UNKNOWN',
        isNotFound: error.code === 404 || error.status === 'NOT_FOUND',
        isQuotaExceeded: error.code === 429 || error.status === 'RESOURCE_EXHAUSTED',
        retryAfter: extractRetryDelay(errorData)
      };
    }
  } catch (e) {
    // If can't parse, return basic info
  }
  return {
    code: statusCode,
    message: errorText.substring(0, 200),
    status: 'UNKNOWN',
    isNotFound: statusCode === 404,
    isQuotaExceeded: statusCode === 429,
    retryAfter: null
  };
}

// Helper: Extract retry delay from error response
function extractRetryDelay(errorData) {
  try {
    if (errorData.error && errorData.error.details) {
      for (const detail of errorData.error.details) {
        if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && detail.retryDelay) {
          const delay = detail.retryDelay.replace('s', '');
          return parseFloat(delay) * 1000; // Convert to milliseconds
        }
      }
    }
  } catch (e) {
    // Ignore parsing errors
  }
  return null;
}

// Translate text using Gemini API
async function translateText(text, apiKey, textStyle, currentUrl) {
  console.log('[Gemini Translator BG] Translating text:', text.substring(0, 100));
  console.log('[Gemini Translator BG] Text style:', textStyle ? textStyle.name : 'default');
  console.log('[Gemini Translator BG] Current URL:', currentUrl);

  if (!apiKey) {
    console.error('[Gemini Translator BG] No API key provided');
    throw new Error('API key chưa được cấu hình. Vui lòng thêm Gemini API key trong popup.');
  }

  // Get domain profile if URL provided
  let domainProfile = null;
  if (currentUrl) {
    try {
      domainProfile = await getDomainProfile(currentUrl, apiKey);
      if (domainProfile && !domainProfile.isFallback) {
        console.log(`[Gemini Translator BG] Using domain profile: ${domainProfile.websiteType} (${domainProfile.contentTone})`);
      }
    } catch (error) {
      console.warn('[Gemini Translator BG] Failed to get domain profile:', error);
    }
  }

  // Get preferred model from settings
  const settings = await chrome.storage.sync.get(['preferredModel']);
  const preferredModel = settings.preferredModel || 'gemini-2.5-flash';

  // List of Gemini models to try (only active models, verified as of Dec 2025)
  // Removed: gemini-1.5-flash-latest, gemini-1.5-flash, gemini-1.5-pro-latest, gemini-pro (404 errors)
  // Note: gemini-3-pro-preview requires paid API and has NO free tier
  // Note: gemini-2.5-pro is the advanced thinking model (paid, stable)
  const allModels = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',           // Paid - advanced thinking model
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-exp-1206',
    'gemini-3-pro-preview',     // Paid only - no free tier
    'gemini-flash-lite-latest',
  ];

  // Prioritize preferred model first, then others
  const models = [preferredModel, ...allModels.filter(m => m !== preferredModel)];

  console.log('[Gemini Translator BG] Model priority:', models[0], '(preferred)');

  let lastError = null;
  let quotaErrors = 0;
  let notFoundErrors = 0;

  for (const model of models) {
    try {
      console.log('[Gemini Translator BG] Trying model:', model);
      const result = await tryTranslate(text, apiKey, model, textStyle, domainProfile);
      console.log('[Gemini Translator BG] ✓ Success with model:', model);

      // Update preferred model if this one succeeded and it's not already preferred
      if (model !== preferredModel) {
        console.log('[Gemini Translator BG] Switching preferred model to:', model);
        chrome.storage.sync.set({ preferredModel: model });
      }

      return {
        translation: result,
        modelUsed: model,
        domainContext: domainProfile ? {
          domain: domainProfile.domain,
          type: domainProfile.websiteType,
          tone: domainProfile.contentTone
        } : null
      };
    } catch (error) {
      const errorInfo = error.apiError || {};

      // Handle 404 - Model not found (silently skip)
      if (errorInfo.isNotFound) {
        notFoundErrors++;
        console.log(`[Gemini Translator BG] ⊗ Model not available: ${model}`);
        continue;
      }

      // Handle 429 - Quota exceeded
      if (errorInfo.isQuotaExceeded) {
        quotaErrors++;
        const retryAfter = errorInfo.retryAfter || 500;
        console.log(`[Gemini Translator BG] ⚠ Quota exceeded for ${model}, waiting ${Math.round(retryAfter / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter, 2000))); // Max 2s wait
        lastError = error;
        continue;
      }

      // Other errors
      console.warn(`[Gemini Translator BG] ✗ Error with ${model}: ${errorInfo.status || error.message}`);
      lastError = error;
    }
  }

  // If all models failed, throw informative error
  console.error('[Gemini Translator BG] All models failed!');
  console.error(`[Gemini Translator BG] Summary: ${notFoundErrors} not found, ${quotaErrors} quota exceeded`);

  if (quotaErrors > 0 && notFoundErrors === models.length - quotaErrors) {
    throw new Error('Tất cả models đã hết quota. Vui lòng đợi hoặc nâng cấp API key.');
  } else if (notFoundErrors === models.length) {
    throw new Error('Không tìm thấy model nào khả dụng. Vui lòng kiểm tra lại API key.');
  } else if (lastError) {
    throw lastError;
  } else {
    throw new Error('Không thể dịch văn bản. Vui lòng thử lại.');
  }
}

// Test available models
async function testAvailableModels(apiKey) {
  console.log('[Gemini Translator BG] Testing available models...');

  const allModels = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',           // Paid - advanced thinking model
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-exp-1206',
    'gemini-3-pro-preview',     // Paid only - no free tier
  ];

  const availableModels = [];
  const modelErrors = {};
  let workingModel = null;

  // Test each model with a simple translation
  for (const model of allModels) {
    try {
      console.log('[Gemini Translator BG] Testing model:', model);
      await tryTranslate('Hello', apiKey, model, null, null);
      availableModels.push(model);
      if (!workingModel) workingModel = model;
      console.log('[Gemini Translator BG] ✓ Model working:', model);
    } catch (error) {
      const errorInfo = error.apiError || {};
      if (errorInfo.isNotFound) {
        console.log(`[Gemini Translator BG] ⊗ Model not available (404): ${model}`);
        modelErrors[model] = 'NOT_FOUND';
      } else if (errorInfo.isQuotaExceeded) {
        console.log(`[Gemini Translator BG] ⚠ Quota exceeded (429): ${model}`);
        modelErrors[model] = 'QUOTA_EXCEEDED';
      } else {
        console.log(`[Gemini Translator BG] ✗ Model failed: ${model} - ${error.message}`);
        modelErrors[model] = errorInfo.status || error.message;
      }
    }
  }

  console.log('[Gemini Translator BG] Available models:', availableModels);
  console.log('[Gemini Translator BG] Model errors:', modelErrors);

  return {
    success: true,
    availableModels: availableModels,
    modelErrors: modelErrors,
    workingModel: workingModel || 'gemini-2.5-flash'
  };
}

// Parse translation response - handles JSON format with fallback
function parseTranslationResponse(rawText) {
  try {
    // Remove markdown code blocks if present
    let cleanText = rawText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    // Try parse as JSON first
    if (cleanText.startsWith('{')) {
      try {
        const jsonData = JSON.parse(cleanText);
        const translations = jsonData.translations || jsonData;

        // Convert back to [0]text\n[1]text format
        const lines = [];
        const keys = Object.keys(translations).sort((a, b) => parseInt(a) - parseInt(b));

        // Fill missing indexes
        if (keys.length > 0) {
          const maxKey = Math.max(...keys.map(k => parseInt(k)));
          for (let i = 0; i <= maxKey; i++) {
            const key = i.toString();
            if (translations[key] !== undefined) {
              lines.push(`[${i}]${translations[key]}`);
            } else {
              console.warn(`[Gemini Translator BG] Missing index ${i}`);
              lines.push(`[${i}]`);
            }
          }
        }

        console.log('[Gemini Translator BG] Parsed JSON successfully:', lines.length, 'lines');
        return lines.join('\n');
      } catch (e) {
        console.warn('[Gemini Translator BG] JSON parse failed, trying text format');
      }
    }

    // Fallback: Treat as text format [0]...\n[1]...
    if (cleanText.includes('[0]') || cleanText.includes('[1]')) {
      console.log('[Gemini Translator BG] Using text format');
      return cleanText;
    }

    // Last resort: return raw
    console.warn('[Gemini Translator BG] No valid format, returning raw text');
    return rawText;

  } catch (error) {
    console.warn('[Gemini Translator BG] Parser error:', error.message);
    return rawText;
  }
}

async function tryTranslate(text, apiKey, model, textStyle, domainProfile) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build instruction from textStyle and domainProfile
  let instruction = '';

  // Add domain-specific context first (higher priority)
  if (domainProfile && !domainProfile.isFallback) {
    const domainInstruction = buildDomainInstruction(domainProfile);
    if (domainInstruction) {
      instruction += domainInstruction + '\n';
    }
  }

  // Add text style instruction
  if (textStyle && textStyle.type !== 'general') {
    instruction += textStyle.instruction + '\n';
  }

  const promptText = `${instruction}Translate ALL text to Vietnamese (Tiếng Việt).

Format: Keep [number] prefix exactly as shown
Input:  [0]text [1]more text [2]content
Output: [0]bản dịch [1]nhiều text hơn [2]nội dung

Rules:
1. Keep [N] prefix for EVERY line
2. Translate line-by-line in order
3. Do NOT skip any line numbers
4. Empty lines → [N] with no text

Text to translate:
${text}`;

  // Gemini 3 models require temperature=1.0, other models work better with lower temperature
  const isGemini3Model = model.includes('gemini-3');
  const temperature = isGemini3Model ? 1.0 : 0.2;

  const requestBody = {
    contents: [{
      parts: [{
        text: promptText
      }]
    }],
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: 65536,
    },
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_NONE"
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_NONE"
      }
    ]
  };

  console.log('[Gemini Translator BG] Calling API URL:', url.replace(apiKey, 'KEY_HIDDEN'));
  console.log('[Gemini Translator BG] Using temperature:', temperature, 'for model:', model);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[Gemini Translator BG] API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      const errorInfo = parseApiError(errorText, response.status);

      // Log concisely based on error type
      if (errorInfo.isNotFound) {
        console.log(`[Gemini Translator BG] Model not found (404): ${model}`);
      } else if (errorInfo.isQuotaExceeded) {
        console.warn(`[Gemini Translator BG] Quota exceeded (429) for ${model}`);
      } else {
        console.error(`[Gemini Translator BG] API error ${errorInfo.code}:`, errorInfo.message.substring(0, 150));
      }

      const error = new Error(errorInfo.message);
      error.apiError = errorInfo;
      throw error;
    }

    const data = await response.json();
    console.log('[Gemini Translator BG] API response data:', JSON.stringify(data).substring(0, 300));

    // Check for content blocking
    if (data.promptFeedback && data.promptFeedback.blockReason) {
      const blockReason = data.promptFeedback.blockReason;
      console.error(`[Gemini Translator BG] Content blocked: ${blockReason}`);
      throw new Error(`Gemini blocked content (${blockReason}). Vui lòng thử lại hoặc chọn nội dung khác.`);
    }

    // Check for various response formats
    if (data.candidates && data.candidates.length > 0) {
      const candidate = data.candidates[0];

      // Check if response was truncated
      if (candidate.finishReason === 'MAX_TOKENS') {
        console.warn('[Gemini Translator BG] Response truncated due to MAX_TOKENS');
        throw new Error('Response too long - text được cắt ngắn, thử giảm số lượng text');
      }

      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        const rawText = candidate.content.parts[0].text;
        console.log('[Gemini Translator BG] Raw response:', rawText.substring(0, 200));

        // Parse JSON response
        const translation = parseTranslationResponse(rawText);
        console.log('[Gemini Translator BG] Translation successful:', translation.substring(0, 100));
        return translation;
      }
    }

    console.error('[Gemini Translator BG] Invalid response format:', JSON.stringify(data));
    throw new Error('Không thể dịch văn bản - Invalid response format');
  } catch (error) {
    console.error('[Gemini Translator BG] Fetch error:', error);
    throw error;
  }
}

// ============================================================================
// STREAMING TRANSLATION
// ============================================================================

/**
 * Stream translate text using Gemini streamGenerateContent API
 * Sends partial results to content script as they arrive
 */
async function streamTranslateText(text, apiKey, textStyle, currentUrl, chunkIndex, tabId) {
  console.log(`[Gemini Translator BG] Starting stream for chunk ${chunkIndex}`);

  // Get preferred model
  const settings = await chrome.storage.sync.get(['preferredModel']);
  const model = settings.preferredModel || 'gemini-2.5-flash';

  // Use streaming endpoint
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  // Build prompt (same as tryTranslate)
  let instruction = '';
  if (textStyle && textStyle.type !== 'general') {
    instruction = textStyle.instruction + '\n';
  }

  const promptText = `${instruction}Translate ALL text to Vietnamese (Tiếng Việt).

Format: Keep [number] prefix exactly as shown
Input:  [0]text [1]more text [2]content
Output: [0]bản dịch [1]nhiều text hơn [2]nội dung

Rules:
1. Keep [N] prefix for EVERY line
2. Translate line-by-line in order
3. Do NOT skip any line numbers
4. Empty lines → [N] with no text

Text to translate:
${text}`;

  const requestBody = {
    contents: [{
      parts: [{ text: promptText }]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 65536,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText.substring(0, 200)}`);
    }

    // Read streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        console.log(`[Gemini Translator BG] Stream complete for chunk ${chunkIndex}`);
        break;
      }

      // Decode chunk
      buffer += decoder.decode(value, { stream: true });

      // Process SSE events (each line starts with "data: ")
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6); // Remove "data: " prefix

          if (jsonStr.trim() === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);

            // Extract text from response
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
              const newText = data.candidates[0].content.parts[0].text;
              accumulatedText += newText;

              // Send partial update to content script
              chrome.tabs.sendMessage(tabId, {
                action: 'streamChunk',
                chunkIndex: chunkIndex,
                partialText: accumulatedText,
                delta: newText
              });
            }

            // Check for finish reason
            if (data.candidates?.[0]?.finishReason) {
              console.log(`[Gemini Translator BG] Finish reason: ${data.candidates[0].finishReason}`);
            }
          } catch (parseError) {
            // Ignore JSON parse errors for incomplete chunks
            console.warn('[Gemini Translator BG] Parse error:', parseError.message);
          }
        }
      }
    }

    // Send completion message
    const finalTranslation = parseTranslationResponse(accumulatedText);
    chrome.tabs.sendMessage(tabId, {
      action: 'streamComplete',
      chunkIndex: chunkIndex,
      translation: finalTranslation,
      modelUsed: model
    });

    console.log(`[Gemini Translator BG] Stream finished for chunk ${chunkIndex}, total length: ${accumulatedText.length}`);

  } catch (error) {
    console.error(`[Gemini Translator BG] Stream error for chunk ${chunkIndex}:`, error);

    // Send error to content script
    chrome.tabs.sendMessage(tabId, {
      action: 'streamError',
      chunkIndex: chunkIndex,
      error: error.message
    });

    throw error;
  }
}

// Explain text semantics using Gemini API
async function explainTextSemantics(text, apiKey) {
  console.log('[Gemini Translator BG] Explaining text semantics...');

  const models = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-exp-1206'
  ];

  // Get preferred model from storage
  let preferredModel = 'gemini-2.5-flash';
  try {
    const result = await chrome.storage.sync.get(['preferredModel']);
    if (result.preferredModel) {
      preferredModel = result.preferredModel;
      // Move preferred model to front of list
      const index = models.indexOf(preferredModel);
      if (index > 0) {
        models.splice(index, 1);
        models.unshift(preferredModel);
      }
    }
  } catch (error) {
    console.warn('[Gemini Translator BG] Failed to get preferred model:', error);
  }

  const prompt = `Bạn là chuyên gia ngôn ngữ học. Hãy phân tích và giải thích chi tiết văn bản sau bằng Tiếng Việt:

"${text}"

Vui lòng cung cấp:
1. **Ý nghĩa tổng quan**: Giải thích ngắn gọn ý chính của văn bản
2. **Phân tích từ vựng**: Giải thích các từ khóa, thành ngữ, hoặc cụm từ quan trọng
3. **Ngữ cảnh sử dụng**: Văn bản này thường được dùng trong hoàn cảnh nào
4. **Sắc thái ngữ nghĩa**: Văn bản mang tính chất gì (trang trọng, thân mật, kỹ thuật, văn học...)
5. **Lưu ý dịch thuật**: Những điểm cần chú ý khi dịch sang ngôn ngữ khác

Trả lời bằng Tiếng Việt, rõ ràng và dễ hiểu.`;

  let lastError = null;

  for (const modelName of models) {
    try {
      console.log(`[Gemini Translator BG] Trying model: ${modelName}`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
          }
        })
      });

      const responseText = await response.text();
      const errorInfo = parseApiError(responseText, response.status);

      if (errorInfo.isNotFound) {
        console.log(`[Gemini Translator BG] ⊗ Model ${modelName} not available (404), trying next...`);
        continue;
      }

      if (errorInfo.isQuotaExceeded) {
        const retryDelay = errorInfo.retryDelay || 60;
        console.log(`[Gemini Translator BG] ⏱ Model ${modelName} quota exceeded, retry in ${retryDelay}s`);
        lastError = new Error(`Vượt quá quota API. Vui lòng thử lại sau ${retryDelay} giây.`);
        continue;
      }

      if (!response.ok) {
        console.error(`[Gemini Translator BG] ✗ Model ${modelName} error: ${errorInfo.message}`);
        lastError = new Error(errorInfo.message);
        continue;
      }

      const data = JSON.parse(responseText);

      if (data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          const explanation = candidate.content.parts[0].text;
          console.log(`[Gemini Translator BG] ✓ Explanation success with model: ${modelName}`);

          // Update preferred model if different from current
          if (modelName !== preferredModel) {
            chrome.storage.sync.set({ preferredModel: modelName });
          }

          return explanation;
        }
      }

      throw new Error('Invalid response format from API');
    } catch (error) {
      console.error(`[Gemini Translator BG] Model ${modelName} failed:`, error.message);
      lastError = error;
    }
  }

  throw lastError || new Error('All models failed to generate explanation');
}
