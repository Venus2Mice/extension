# Gemini Translator Extension - AI Agent Instructions

## Project Overview
Browser extension (Manifest V3) that translates web pages to Vietnamese using Google's Gemini API. Built for Microsoft Edge/Chrome with smart caching, lazy loading for large pages, and dual translation modes.

## Architecture & Key Components

### Three-Layer Message Passing Architecture
```
background.js (Service Worker) ←→ content.js (Injected Script) ←→ popup.js (UI)
```

1. **`background.js`** - Service worker handling:
   - Context menu registration (`translatePage`, `translatePageFull`, `translateSelection`)
   - API key retrieval from `chrome.storage.sync`
   - Translation orchestration with model fallback chain
   - Content script injection via `chrome.scripting.executeScript`

2. **`content.js`** - Page manipulation layer (1417 lines):
   - DOM traversal using `TreeWalker` API to find text nodes
   - Cache management (500 entries max, 7-day expiry) in `chrome.storage.local`
   - Lazy vs. full translation modes (threshold: 3000 chars)
   - Translation state: `originalContent` clone, `isTranslated` flag, `translationCache` Map

3. **`popup.js`** - Extension popup UI:
   - API key configuration
   - Manual page translation trigger
   - Cache statistics display

### Critical Communication Pattern
All components use **`chrome.runtime.sendMessage`** for async messaging. Always return `true` from listeners to keep channel open for async responses:

```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getApiKey') {
    chrome.storage.sync.get(['geminiApiKey'], (result) => {
      sendResponse({ apiKey: result.geminiApiKey });
    });
    return true; // CRITICAL: keeps message channel open
  }
});
```

### Model Fallback Strategy (Nov 2025 Active Models)
`background.js` implements cascading model fallback with dynamic preferred model switching:

```javascript
const models = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest', 
                'gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-exp-1206'];
```

- Prioritizes user's `preferredModel` from storage
- Silently skips 404 (NOT_FOUND) models
- Retries 429 (RESOURCE_EXHAUSTED) with delay extraction from `RetryInfo`
- Auto-updates `preferredModel` when alternative succeeds

## Translation Modes

### Lazy Mode (Default for >3000 chars)
- Triggered in `handleTranslatePage()` when `totalChars > 3000`
- Translates viewport-visible content first via `IntersectionObserver`
- Queues remaining nodes for scroll-triggered translation
- Uses `startLazyTranslation()` with `translateVisibleContent()`

### Full Mode
- Chunks text into 2000-char batches (avoid MAX_TOKENS error)
- Format: `[0]text\n[1]more text\n[2]...` with preserved line numbers
- Applies **text style detection** via `detectTextStyle()` - analyzes for formal/casual/technical tone
- Shows sticky notification with model + detected writing style

## Text Style Detection System
`detectTextStyle()` analyzes content patterns to apply context-appropriate translation:

```javascript
// Detected styles: formal, academic, technical, casual, literary
const textStyle = detectTextStyle(textMap);
// Returns: { type: 'formal', name: 'Văn bản trang trọng', instruction: '...' }
```

Translation prompt includes style-specific instructions for better Vietnamese output quality.

## Caching Strategy

### In-Memory Cache
- `translationCache` Map with hash-based keys: `getCacheKey(text, textStyle)`
- Hash function for long text (>200 chars): first 100 + last 100 chars + style + length
- Debounced persistence to `chrome.storage.local` (2s delay)

### Cache Lifecycle
```javascript
// Load on init (7-day expiry check)
(async function loadCache() { ... })();

// Trim on overflow (500 entry limit)
if (translationCache.size > CACHE_MAX_SIZE) {
  const trimmed = entries.slice(-CACHE_MAX_SIZE);
}

// Clear on extension reload detection
if (!isExtensionContextValid()) { /* skip save */ }
```

## Content Script Injection Pattern
Both `background.js` and `popup.js` use identical injection logic:

```javascript
async function ensureContentScript(tabId) {
  try {
    // Ping existing script
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch {
    // Inject if not present
    await chrome.scripting.executeScript({ target: {tabId}, files: ['content.js'] });
    await chrome.scripting.insertCSS({ target: {tabId}, files: ['content.css'] });
  }
}
```

Always call `ensureContentScript()` before sending messages to tabs.

## Error Handling Patterns

### API Error Parsing
`parseApiError()` extracts structured info from Gemini API responses:
- `isNotFound` (404) → skip model silently
- `isQuotaExceeded` (429) → extract retry delay from `RetryInfo.retryDelay`
- `MAX_TOKENS` finish reason → reduce chunk size

### Extension Context Validation
Check before storage operations after page unload/extension reload:

```javascript
function isExtensionContextValid() {
  try {
    return chrome.runtime && chrome.runtime.id;
  } catch { return false; }
}
```

## Development Workflow

### Testing Translation
1. Save API key in popup (`chrome.storage.sync.set`)
2. Right-click page → "Dịch trang (Lazy - Mặc định)" for auto-mode
3. Right-click page → "Dịch toàn bộ trang (Full)" to force full translation
4. Check DevTools console for `[Gemini Translator]` prefixed logs

### Debugging Model Issues
- Look for `⊗ Model not available` (404s expected for deprecated models)
- Check `✓ Success with model: X` to see which model worked
- Use popup's "Test Connection" to verify API key

### Icon Generation
Run `generate_icons.py` (requires Pillow) or open `icons/generate-icons.html` in browser to auto-download PNGs.

## Configuration

### `config.js` Constants
- `BATCH_SIZE: 10` - deprecated (not actively used)
- `SKIP_TAGS` - Elements ignored during TreeWalker traversal
- `MIN_TEXT_LENGTH: 3` - Minimum chars to translate

### Storage Keys
- `chrome.storage.sync`: `geminiApiKey`, `preferredModel`
- `chrome.storage.local`: `translationCache`, `cacheTimestamp`

## Vietnamese-Specific Patterns

### Translation Prompt Format
Critical instruction in `background.js` prompt:

```
CRITICAL INSTRUCTION: You MUST translate ALL text to VIETNAMESE (Tiếng Việt) language!
DO NOT keep original Chinese/English text.
```

Enforces Vietnamese output with numbered line format preservation: `[0]原文` → `[0]Bản dịch`

### UI Text
All notifications, popup labels, and error messages use Vietnamese. Maintain this convention for user-facing strings.

## Common Pitfalls

1. **Message Channel Closure**: Always `return true` in message listeners for async operations
2. **Content Script Not Injected**: Call `ensureContentScript()` before messaging tabs
3. **MAX_TOKENS Error**: Reduce chunk size in `handleTranslatePage()` (currently 2000 chars)
4. **Cache Quota**: Monitor for QUOTA errors, auto-clears on overflow
5. **Model 404s**: Expected for deprecated models (1.5-flash, 1.5-pro, gemini-pro) - fallback handles this

## File Responsibilities Summary
- **manifest.json**: V3 config, permissions, content script matching
- **background.js**: API orchestration, model fallback, context menus
- **content.js**: DOM manipulation, caching, lazy loading, UI overlays
- **popup.{js,html,css}**: Settings UI, manual triggers
- **content.css**: Injected styles for popups, notifications, loading indicators
- **config.js**: Shared constants (lightweight, minimal usage)
- **generate_icons.py**: Icon asset generation utility
