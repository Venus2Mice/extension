// Background Service Worker
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
    chrome.storage.sync.get(['geminiApiKey', 'preferredModel'], (result) => {
      sendResponse({ apiKey: result.geminiApiKey || '', preferredModel: result.preferredModel || 'gemini-2.5-flash-lite' });
    });
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'translate') {
    translateText(request.text, request.apiKey, request.textStyle)
      .then(result => sendResponse({ 
        success: true, 
        translation: result.translation,
        modelUsed: result.modelUsed
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
async function translateText(text, apiKey, textStyle) {
  console.log('[Gemini Translator BG] Translating text:', text.substring(0, 100));
  console.log('[Gemini Translator BG] Text style:', textStyle ? textStyle.name : 'default');
  
  if (!apiKey) {
    console.error('[Gemini Translator BG] No API key provided');
    throw new Error('API key chưa được cấu hình. Vui lòng thêm Gemini API key trong popup.');
  }

  // Get preferred model from settings
  const settings = await chrome.storage.sync.get(['preferredModel']);
  const preferredModel = settings.preferredModel || 'gemini-2.5-flash-lite';

  // List of Gemini models to try (only active models, verified as of Nov 2025)
  // Removed: gemini-1.5-flash-latest, gemini-1.5-flash, gemini-1.5-pro-latest, gemini-pro (404 errors)
  const allModels = [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-exp-1206',
    'gemini-3-pro-preview',
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
      const result = await tryTranslate(text, apiKey, model, textStyle);
      console.log('[Gemini Translator BG] ✓ Success with model:', model);
      
      // Update preferred model if this one succeeded and it's not already preferred
      if (model !== preferredModel) {
        console.log('[Gemini Translator BG] Switching preferred model to:', model);
        chrome.storage.sync.set({ preferredModel: model });
      }
      
      return { translation: result, modelUsed: model };
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
        console.log(`[Gemini Translator BG] ⚠ Quota exceeded for ${model}, waiting ${Math.round(retryAfter/1000)}s...`);
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
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-exp-1206'
  ];
  
  const availableModels = [];
  let workingModel = null;
  
  // Test each model with a simple translation
  for (const model of allModels) {
    try {
      console.log('[Gemini Translator BG] Testing model:', model);
      await tryTranslate('Hello', apiKey, model, null);
      availableModels.push(model);
      if (!workingModel) workingModel = model;
      console.log('[Gemini Translator BG] ✓ Model working:', model);
    } catch (error) {
      const errorInfo = error.apiError || {};
      if (errorInfo.isNotFound) {
        console.log(`[Gemini Translator BG] ⊗ Model not available: ${model}`);
      } else if (errorInfo.isQuotaExceeded) {
        console.log(`[Gemini Translator BG] ⚠ Quota exceeded: ${model}`);
      } else {
        console.log(`[Gemini Translator BG] ✗ Model failed: ${model}`);
      }
    }
  }
  
  console.log('[Gemini Translator BG] Available models:', availableModels);
  
  return {
    success: true,
    availableModels: availableModels,
    workingModel: workingModel || 'gemini-2.5-flash-lite'
  };
}

async function tryTranslate(text, apiKey, model, textStyle) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  // Optimized prompt - balance between clarity and token usage
  let instruction = '';
  if (textStyle && textStyle.type !== 'general') {
    instruction = textStyle.instruction + '\n';
  }
  
  const promptText = `${instruction}CRITICAL INSTRUCTION: You MUST translate ALL text to VIETNAMESE (Tiếng Việt) language!

DO NOT keep original Chinese/English text. Every line MUST be translated to Vietnamese.

Format requirement:
- Input: [0]原文 [1]文本 [2]内容
- Output: [0]Bản dịch [1]Văn bản [2]Nội dung

Rules:
1. Keep [number] prefix EXACTLY as shown
2. Translate EVERY line to Vietnamese - NO exceptions
3. Process from FIRST [0] to LAST line in order
4. If you return Chinese/English text instead of Vietnamese, the task FAILS

Text to translate:
${text}`;
  
  const requestBody = {
    contents: [{
      parts: [{
        text: promptText
      }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    }
  };
  
  console.log('[Gemini Translator BG] Calling API URL:', url.replace(apiKey, 'KEY_HIDDEN'));
  
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
    
    // Check for various response formats
    if (data.candidates && data.candidates.length > 0) {
      const candidate = data.candidates[0];
      
      // Check if response was truncated
      if (candidate.finishReason === 'MAX_TOKENS') {
        console.warn('[Gemini Translator BG] Response truncated due to MAX_TOKENS');
        throw new Error('Response too long - text được cắt ngắn, thử giảm số lượng text');
      }
      
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        const translation = candidate.content.parts[0].text;
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
