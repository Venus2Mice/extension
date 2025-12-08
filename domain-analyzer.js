// Domain Analyzer - Uses Gemini tools to learn website style
// Stores domain-specific translation context for better accuracy

const DOMAIN_CACHE_KEY = 'domainStyleProfiles';
const DOMAIN_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_DOMAINS = 50; // Limit cache size

/**
 * Analyze a domain using Gemini with Google Search + URL Context tools
 * @param {string} domain - Domain to analyze (e.g., 'wikipedia.org')
 * @param {string} url - Sample URL from the domain
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Object>} Domain style profile
 */
async function analyzeDomain(domain, url, apiKey) {
  console.log(`[Domain Analyzer] Analyzing ${domain} using URL: ${url}`);
  
  const model = 'gemini-2.5-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const prompt = `Analyze this website and determine its characteristics for translation purposes:

Website URL: ${url}
Domain: ${domain}

Tasks:
1. Website type (news, blog, e-commerce, documentation, social media, forum, academic, etc.)
2. Content tone (formal, casual, technical, literary, conversational)
3. Target audience (general public, professionals, students, enthusiasts)
4. Common vocabulary themes (technology, medicine, business, entertainment, etc.)
5. Translation style recommendations for Vietnamese

Return ONLY a valid JSON object (no extra text):
{
  "websiteType": "type of website",
  "contentTone": "primary tone",
  "audience": "target audience",
  "themes": ["theme1", "theme2"],
  "translationGuidelines": "specific guidelines for translating this type of content to Vietnamese"
}`;

  const requestBody = {
    contents: [{
      role: 'user',
      parts: [{
        text: prompt
      }]
    }],
    tools: [
      { 
        google_search: {}
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ]
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Domain Analyzer] API error:', errorText.substring(0, 200));
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Check for blocking
    if (data.promptFeedback?.blockReason) {
      console.warn(`[Domain Analyzer] Blocked: ${data.promptFeedback.blockReason}`);
      return createFallbackProfile(domain, url);
    }

    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.warn('[Domain Analyzer] No valid response, using fallback');
      return createFallbackProfile(domain, url);
    }

    const rawText = data.candidates[0].content.parts[0].text;
    console.log('[Domain Analyzer] Raw response:', rawText.substring(0, 300));
    
    // Parse JSON response
    let analysis;
    try {
      // Remove markdown code blocks if present
      let cleanText = rawText.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '');
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      
      // Try to extract JSON if embedded in text
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }
      
      analysis = JSON.parse(cleanText);
    } catch (e) {
      console.warn('[Domain Analyzer] JSON parse failed:', e.message);
      console.warn('[Domain Analyzer] Raw text was:', rawText.substring(0, 500));
      return createFallbackProfile(domain, url);
    }

    // Create profile
    const profile = {
      domain,
      websiteType: analysis.websiteType || 'general',
      contentTone: analysis.contentTone || 'neutral',
      audience: analysis.audience || 'general',
      themes: analysis.themes || [],
      translationGuidelines: analysis.translationGuidelines || '',
      examplePhrases: analysis.examplePhrases || [],
      analyzedAt: Date.now(),
      sampleUrl: url,
      usageCount: 0
    };

    console.log('[Domain Analyzer] ✓ Analysis complete:', profile.websiteType);
    return profile;

  } catch (error) {
    console.error('[Domain Analyzer] Analysis failed:', error);
    return createFallbackProfile(domain, url);
  }
}

/**
 * Create a basic fallback profile when analysis fails
 */
function createFallbackProfile(domain, url) {
  return {
    domain,
    websiteType: 'general',
    contentTone: 'neutral',
    audience: 'general',
    themes: [],
    translationGuidelines: 'Dịch tự nhiên, giữ nguyên ý nghĩa gốc',
    examplePhrases: [],
    analyzedAt: Date.now(),
    sampleUrl: url,
    usageCount: 0,
    isFallback: true
  };
}

/**
 * Get domain profile from cache or analyze if needed
 * @param {string} url - Full URL
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Object|null>} Domain profile or null
 */
async function getDomainProfile(url, apiKey) {
  try {
    const domain = extractDomain(url);
    if (!domain) return null;

    // Load cache
    const result = await chrome.storage.local.get([DOMAIN_CACHE_KEY]);
    const cache = result[DOMAIN_CACHE_KEY] || {};

    // Check if profile exists and is fresh
    if (cache[domain]) {
      const profile = cache[domain];
      const age = Date.now() - profile.analyzedAt;
      
      if (age < DOMAIN_CACHE_MAX_AGE) {
        console.log(`[Domain Analyzer] Using cached profile for ${domain} (${Math.round(age / (24*60*60*1000))} days old)`);
        profile.usageCount++;
        
        // Update usage count (debounced)
        setTimeout(() => saveDomainProfile(profile), 1000);
        
        return profile;
      } else {
        console.log(`[Domain Analyzer] Profile expired for ${domain}, re-analyzing...`);
      }
    }

    // No cache or expired - analyze domain
    console.log(`[Domain Analyzer] No cache for ${domain}, analyzing...`);
    const profile = await analyzeDomain(domain, url, apiKey);
    
    // Save to cache
    await saveDomainProfile(profile);
    
    return profile;

  } catch (error) {
    console.error('[Domain Analyzer] Error getting profile:', error);
    return null;
  }
}

/**
 * Save domain profile to cache
 */
async function saveDomainProfile(profile) {
  try {
    const result = await chrome.storage.local.get([DOMAIN_CACHE_KEY]);
    let cache = result[DOMAIN_CACHE_KEY] || {};

    // Add/update profile
    cache[profile.domain] = profile;

    // Trim cache if too large
    if (Object.keys(cache).length > MAX_DOMAINS) {
      console.log(`[Domain Analyzer] Cache size exceeded, trimming...`);
      
      // Sort by usage count and keep most used domains
      const sorted = Object.entries(cache)
        .sort((a, b) => (b[1].usageCount || 0) - (a[1].usageCount || 0))
        .slice(0, MAX_DOMAINS);
      
      cache = Object.fromEntries(sorted);
    }

    await chrome.storage.local.set({ [DOMAIN_CACHE_KEY]: cache });
    console.log(`[Domain Analyzer] Saved profile for ${profile.domain}`);

  } catch (error) {
    console.error('[Domain Analyzer] Failed to save profile:', error);
  }
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Build translation instruction from domain profile
 */
function buildDomainInstruction(profile) {
  if (!profile || profile.isFallback) return '';

  let instruction = `Website Context: ${profile.websiteType}`;
  
  if (profile.contentTone) {
    instruction += `, tone: ${profile.contentTone}`;
  }
  
  if (profile.translationGuidelines) {
    instruction += `\nTranslation Guidelines: ${profile.translationGuidelines}`;
  }

  if (profile.themes && profile.themes.length > 0) {
    instruction += `\nCommon Themes: ${profile.themes.join(', ')}`;
  }

  return instruction + '\n';
}

/**
 * Clear domain cache (for debugging)
 */
async function clearDomainCache() {
  await chrome.storage.local.remove([DOMAIN_CACHE_KEY]);
  console.log('[Domain Analyzer] Cache cleared');
}

/**
 * Get cache statistics
 */
async function getDomainCacheStats() {
  const result = await chrome.storage.local.get([DOMAIN_CACHE_KEY]);
  const cache = result[DOMAIN_CACHE_KEY] || {};
  
  const domains = Object.keys(cache);
  const totalUsage = Object.values(cache).reduce((sum, p) => sum + (p.usageCount || 0), 0);
  
  return {
    totalDomains: domains.length,
    totalUsage,
    domains: domains.map(d => ({
      domain: d,
      type: cache[d].websiteType,
      usageCount: cache[d].usageCount || 0,
      age: Math.round((Date.now() - cache[d].analyzedAt) / (24*60*60*1000))
    }))
  };
}
