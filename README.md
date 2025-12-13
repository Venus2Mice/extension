<div align="center">

# Gemini Translator

**AI-Powered Web Page Translation for Microsoft Edge**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Gemini AI](https://img.shields.io/badge/Powered%20by-Gemini%20AI-4285F4.svg)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A browser extension that leverages Google's Gemini AI to provide seamless, context-aware translations of web content into Vietnamese.

</div>

---



| Component | File | Description |
|-----------|------|-------------|
| **Popup UI** | `popup.html`, `popup.js`, `popup.css` | User interface for configuration and manual triggers |
| **Background Worker** | `background.js` | Handles API communication and context menu events |
| **Content Script** | `content.js`, `content.css` | Traverses DOM, manages text replacement, and caching |

---

## Features

| Feature | Description |
|---------|-------------|
| **Full Page Translation** | Translates all visible text content while preserving layout |
| **Selection Translation** | Translate specific text via right-click context menu |
| **Smart Caching** | Stores translations locally to reduce API calls |
| **One-Click Restore** | Instantly revert to original content |
| **DOM Preservation** | Maintains page structure, styles, and interactivity |

---

## Installation

### Prerequisites

- Microsoft Edge (Chromium-based)
- [Gemini API Key](https://makersuite.google.com/app/apikey) (free tier available)

### Setup

1. **Clone or download** this repository

2. **Generate icons** (if not present):
   - Open `icons/generate-icons.html` in your browser
   - Icons will be auto-generated and downloaded

3. **Load the extension**:
   ```
   edge://extensions → Enable Developer mode → Load unpacked → Select extension folder
   ```

4. **Configure API key**:
   - Click the extension icon in toolbar
   - Enter your Gemini API key
   - Click Save

---

## Usage

### Context Menu

| Action | How to |
|--------|--------|
| Translate page | Right-click → *Translate this page to Vietnamese* |
| Translate selection | Select text → Right-click → *Translate selected text* |
| Restore original | Right-click → *Translate this page to Vietnamese* (toggles) |

### Popup Interface

| Button | Function |
|--------|----------|
| **Translate Page** | Initiates full page translation |
| **Restore Original** | Reverts all translations |

---

## Project Structure

```
extension/
├── manifest.json       # Extension configuration (Manifest V3)
├── background.js       # Service worker for API & events
├── content.js          # DOM traversal and translation injection
├── content.css         # Styling for translation UI elements
├── popup.html          # Extension popup markup
├── popup.js            # Popup interaction logic
├── popup.css           # Popup styling
├── config.js           # Configuration constants
└── icons/              # Extension icons (16, 48, 128px)
```

---

## Technical Stack

| Technology | Purpose |
|------------|---------|
| Manifest V3 | Latest Chrome/Edge extension standard |
| Gemini Pro API | Advanced language model for translation |
| TreeWalker API | Efficient text node traversal |
| Chrome Storage API | Secure local configuration storage |
| Context Menus API | Native browser integration |

---

## Troubleshooting

| Error | Solution |
|-------|----------|
| `API key not configured` | Enter API key in extension popup |
| `403 Forbidden` | Verify API key validity in [Google AI Studio](https://makersuite.google.com/) |
| `429 Too Many Requests` | Wait briefly, then retry (rate limiting) |
| Extension inactive on page | Refresh page; some sites block content scripts via CSP |

---

## Roadmap

- [ ] Multi-language target support
- [ ] Auto-detect source language
- [ ] Translation history
- [ ] Dynamic content (AJAX) support
- [ ] Keyboard shortcuts
- [ ] Video subtitle translation

---

## License

This project is licensed under the MIT License.

---

<div align="right">

**Version 1.2.0** · Built with Gemini AI

</div>
