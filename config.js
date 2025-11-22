// Configuration file for the extension
const CONFIG = {
  // API endpoint
  GEMINI_API_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
  
  // Translation settings
  BATCH_SIZE: 10, // Number of text nodes to translate per batch
  DELAY_BETWEEN_TRANSLATIONS: 100, // Milliseconds between API calls
  
  // UI settings
  NOTIFICATION_DURATION: 3000, // Milliseconds
  POPUP_AUTO_CLOSE_DURATION: 10000, // Milliseconds
  
  // Translation cache
  MAX_CACHE_SIZE: 1000, // Maximum number of cached translations
  
  // Prompt template
  TRANSLATION_PROMPT: (text) => `Translate the following text to Vietnamese. Only provide the translation, nothing else:\n\n${text}`,
  
  // Elements to skip during translation
  SKIP_TAGS: ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'link', 'meta'],
  
  // Minimum text length to translate
  MIN_TEXT_LENGTH: 3
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
