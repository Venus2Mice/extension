// Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  // Create context menu
  chrome.contextMenus.create({
    id: 'translatePage',
    title: 'Dịch trang này sang tiếng Việt',
    contexts: ['page', 'selection']
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
    chrome.storage.sync.get(['geminiApiKey'], (result) => {
      sendResponse({ apiKey: result.geminiApiKey || '' });
    });
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'translate') {
    translateText(request.text, request.apiKey)
      .then(translation => sendResponse({ success: true, translation }))
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

// Translate text using Gemini API
async function translateText(text, apiKey) {
  console.log('[Gemini Translator BG] Translating text:', text.substring(0, 100));
  
  if (!apiKey) {
    console.error('[Gemini Translator BG] No API key provided');
    throw new Error('API key chưa được cấu hình. Vui lòng thêm Gemini API key trong popup.');
  }

  // Only use models that work with free tier
  const models = [
    'gemini-flash-latest',      // faster, free tier available
    'gemini-1.5-flash-latest',  // backup
    'gemini-1.5-flash'          // stable fallback
  ];
  
  let lastError = null;
  
  for (const model of models) {
    try {
      console.log('[Gemini Translator BG] Trying model:', model);
      const result = await tryTranslate(text, apiKey, model);
      console.log('[Gemini Translator BG] Success with model:', model);
      return result;
    } catch (error) {
      console.warn('[Gemini Translator BG] Failed with model:', model, error.message);
      lastError = error;
      // Continue to next model
    }
  }
  
  // If all models failed, throw the last error
  throw lastError;
}

async function tryTranslate(text, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const requestBody = {
    contents: [{
      parts: [{
        text: `Translate the following text to Vietnamese. Keep the [number] markers intact at the start of each line:\n\n${text}`
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
      console.error('[Gemini Translator BG] API error response:', errorText);
      throw new Error(`API error: ${response.status} - ${errorText.substring(0, 100)}`);
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
