// Domain Analyzer - Uses Gemini tools to learn website style
// Stores domain-specific translation context for better accuracy

const DOMAIN_CACHE_KEY = 'domainStyleProfiles';
const DOMAIN_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_DOMAINS = 50; // Limit cache size

// ============================================================================
// SMART CONTENT FILTER - Intelligent detection with warning system
// ============================================================================

const CONTENT_FILTER_KEY = 'contentFilterData';

// =============================================================================
// ABSOLUTE BLOCK: ALWAYS block, NO exceptions (illegal content)
// These patterns are checked FIRST before any other filters
// =============================================================================
const ABSOLUTE_BLOCK_PATTERNS = [
  // CSAM - CRITICAL (CẤM TUYỆT ĐỐI - Báo cáo cơ quan chức năng)
  /child.{0,10}(porn|sex|nude|naked|abuse)/i,
  /\b(csam|pedo|pedophil|loli|shota)\b/i,
  /minor.{0,10}(sex|nude|naked|exploit)/i,
  /\b(jailbait|preteen)\b/i,

  // Terrorism instruction
  /\b(bomb[.\s-]?making|explosive[.\s-]?recipe)\b/i,
  /\b(how[.\s-]?to[.\s-]?kill|murder[.\s-]?guide|assassination)\b/i,
  /\b(terrorist[.\s-]?manual|jihad[.\s-]?training)\b/i,

  // Extreme illegal
  /\b(drug[.\s-]?recipe|meth[.\s-]?cook|heroin[.\s-]?make)\b/i,
  /\b(human[.\s-]?trafficking|slave[.\s-]?trade)\b/i
];

// CRITICAL: Always block (explicit adult sites)
const CRITICAL_DOMAIN_PATTERNS = [
  /\b(pornhub|xvideos|xhamster|xnxx|redtube|youporn)\b/i,
  /\b(brazzers|bangbros|realitykings)\b/i,
  /\bchild(porn|abuse)\b/i,
  /\b(darkweb|darknet)market\b/i
];

// HIGH SEVERITY: Block after warning
const HIGH_SEVERITY_PATTERNS = [
  /\bporn\b/i, /\bxxx\b/i, /\bhentai\b/i,
  /\bneonazi\b/i, /\bwhitesupremac/i
];

// MEDIUM SEVERITY: Contextual - may be legitimate (news, education)
const MEDIUM_SEVERITY_KEYWORDS = [
  'nazi', 'fascist', 'terrorism', 'war', 'military', 'weapon',
  'violence', 'killing', 'death', 'murder', 'drug', 'bomb'
];

// WHITELIST: Trusted categories that should never be blocked
const WHITELISTED_DOMAINS = [
  // News
  /\b(bbc|cnn|reuters|nytimes|washingtonpost|theguardian|foxnews)\b/i,
  /\b(vnexpress|dantri|tuoitre|thanhnien|vietnamnet|vtv|vov)\b/i,
  /\b(nhk|rt|aljazeera|france24|dw)\b/i,
  // Education
  /\b(wikipedia|wikimedia|britannica|edu|university|college)\b/i,
  /\b(coursera|udemy|edx|khan.*academy)\b/i,
  // Government/Official
  /\b(\.gov|\.edu|\.mil|\.org)\b/i,
  // Research
  /\b(arxiv|pubmed|scholar\.google|researchgate|jstor)\b/i,
  // Documentation
  /\b(github|stackoverflow|mdn|docs\.)\b/i
];

// Safe content categories (from domain analysis)
const SAFE_CATEGORIES = [
  'news', 'journalism', 'education', 'academic', 'research',
  'government', 'military-news', 'history', 'documentation',
  'encyclopedia', 'reference', 'legal', 'medical', 'science'
];


/**
 * Get content filter data from storage
 */
async function getContentFilterData() {
  try {
    const result = await chrome.storage.local.get([CONTENT_FILTER_KEY]);
    return result[CONTENT_FILTER_KEY] || {
      warningHistory: {},    // { domain: { count, lastWarning, reasons } }
      blockedDomains: [],    // Permanently blocked after repeated violations
      allowedDomains: [],    // User explicitly allowed despite warning
      customBlocked: [],     // User manually blocked
      safetyBlocks: {        // Track API safety blocks
        count: 0,
        domains: []
      }
    };
  } catch (error) {
    return {
      warningHistory: {},
      blockedDomains: [],
      allowedDomains: [],
      customBlocked: [],
      safetyBlocks: { count: 0, domains: [] }
    };
  }
}

/**
 * Save content filter data
 */
async function saveContentFilterData(data) {
  try {
    await chrome.storage.local.set({ [CONTENT_FILTER_KEY]: data });
  } catch (error) {
    console.error('[Smart Filter] Error saving data:', error);
  }
}

/**
 * ABSOLUTE CHECK: Check for content that must NEVER be sent to API
 * This is the FIRST check, bypasses all other filters
 * @param {string} url - URL to check
 * @param {string} textContent - Page content to check
 * @returns {Object} { blocked: boolean, reason: string, critical: boolean }
 */
function isAbsolutelyBlocked(url, textContent = '') {
  const textToCheck = ((url || '') + ' ' + (textContent || '')).toLowerCase();

  for (const pattern of ABSOLUTE_BLOCK_PATTERNS) {
    if (pattern.test(textToCheck)) {
      console.error('[CRITICAL BLOCK] Absolute block pattern matched:', pattern);
      return {
        blocked: true,
        reason: '⛔ NỘI DUNG BỊ CẤM TUYỆT ĐỐI - Không thể dịch',
        category: 'absolute_block',
        critical: true,
        canAppeal: false
      };
    }
  }

  return { blocked: false };
}

/**
 * Record when Gemini API blocks content due to safety
 * Used to track and potentially auto-block domains
 */
async function recordSafetyBlock(domain, safetyRatings = null) {
  const filterData = await getContentFilterData();

  filterData.safetyBlocks = filterData.safetyBlocks || { count: 0, domains: [] };
  filterData.safetyBlocks.count++;

  if (domain && !filterData.safetyBlocks.domains.includes(domain)) {
    filterData.safetyBlocks.domains.push(domain);
  }

  // Alert if too many blocks (potential issue with filter patterns)
  if (filterData.safetyBlocks.count >= 10) {
    console.warn('[ALERT] 10+ safety blocks detected! Review filter patterns.');
  }

  await saveContentFilterData(filterData);
  console.log(`[Safety Block] Recorded for ${domain}. Total: ${filterData.safetyBlocks.count}`);
}

/**
 * Handle API SAFETY response - warning first, block on repeat
 */
async function handleApiSafetyBlock(domain) {
  const filterData = await getContentFilterData();

  // Check if this domain has been safety-blocked before
  const previousBlocks = filterData.safetyBlocks?.domains?.includes(domain);

  if (previousBlocks) {
    // Second offense - permanent block
    await blockDomainPermanently(domain);
    await recordSafetyBlock(domain);
    return {
      blocked: true,
      reason: `Domain bị chặn vĩnh viễn do vi phạm an toàn nhiều lần: ${domain}`,
      permanent: true
    };
  }

  // First offense - record and warn
  await recordSafetyBlock(domain);
  return {
    blocked: false,
    warning: true,
    reason: `⚠️ Gemini đã chặn nội dung từ ${domain}. Lần sau sẽ bị block vĩnh viễn.`,
    domain: domain
  };
}

/**
 * Check if domain is whitelisted (trusted sources)
 */
function isDomainWhitelisted(domain) {
  for (const pattern of WHITELISTED_DOMAINS) {
    if (pattern.test(domain)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if domain profile indicates safe category
 */
async function isDomainSafeCategory(domain) {
  try {
    const result = await chrome.storage.local.get([DOMAIN_CACHE_KEY]);
    const cache = result[DOMAIN_CACHE_KEY] || {};
    const profile = cache[domain];

    if (profile && profile.websiteType) {
      const type = profile.websiteType.toLowerCase();
      return SAFE_CATEGORIES.some(cat => type.includes(cat));
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Smart content filter with severity levels and warning system
 * @param {string} url - URL to check
 * @param {string} textContent - Optional page content for deeper analysis
 * @returns {Promise<Object>} Filter result
 */
async function isContentBlocked(url, textContent = '') {
  const domain = extractDomain(url);
  if (!domain) return { blocked: false };

  // ==========================================
  // STEP 0: ABSOLUTE BLOCK CHECK (FIRST!)
  // These patterns MUST be blocked, no exceptions
  // ==========================================
  const absoluteCheck = isAbsolutelyBlocked(url, textContent);
  if (absoluteCheck.blocked) {
    console.error('[CRITICAL] Absolute block triggered for:', domain);
    return absoluteCheck;
  }

  const filterData = await getContentFilterData();

  // 1. Check if user explicitly allowed this domain
  if (filterData.allowedDomains.includes(domain)) {
    console.log(`[Smart Filter] Domain explicitly allowed: ${domain}`);
    return { blocked: false, allowed: true };
  }

  // 2. Check if permanently blocked (repeated violations)
  if (filterData.blockedDomains.includes(domain)) {
    return {
      blocked: true,
      reason: `Domain đã bị chặn vĩnh viễn do vi phạm nhiều lần: ${domain}`,
      category: 'permanent_block',
      canAppeal: false
    };
  }

  // 3. Check user's custom blocked list
  if (filterData.customBlocked.includes(domain)) {
    return {
      blocked: true,
      reason: `Domain trong danh sách chặn của bạn: ${domain}`,
      category: 'custom_blocked',
      canAppeal: true
    };
  }

  // 4. Check CRITICAL patterns (always block, no warning)
  for (const pattern of CRITICAL_DOMAIN_PATTERNS) {
    if (pattern.test(domain) || pattern.test(url)) {
      // Auto-add to permanent block
      filterData.blockedDomains.push(domain);
      await saveContentFilterData(filterData);

      return {
        blocked: true,
        reason: `Nội dung bị cấm hoàn toàn: ${domain}`,
        category: 'critical_blocked',
        canAppeal: false
      };
    }
  }

  // 5. Check if whitelisted (skip further checks)
  if (isDomainWhitelisted(domain)) {
    console.log(`[Smart Filter] Trusted domain: ${domain}`);
    return { blocked: false, trusted: true };
  }

  // 6. Check if domain has safe category from analysis
  const isSafe = await isDomainSafeCategory(domain);
  if (isSafe) {
    console.log(`[Smart Filter] Safe category domain: ${domain}`);
    return { blocked: false, safeCategory: true };
  }

  // 7. Check HIGH severity patterns
  for (const pattern of HIGH_SEVERITY_PATTERNS) {
    if (pattern.test(domain) || pattern.test(url)) {
      return await handleWarning(domain, filterData, 'high',
        `Domain có dấu hiệu nội dung không phù hợp`);
    }
  }

  // 8. Check MEDIUM severity in URL (contextual)
  const urlLower = url.toLowerCase();
  for (const keyword of MEDIUM_SEVERITY_KEYWORDS) {
    if (urlLower.includes(keyword)) {
      // Only warn for medium severity, don't auto-block
      const warning = filterData.warningHistory[domain];
      if (warning && warning.count >= 3) {
        return await handleWarning(domain, filterData, 'medium',
          `URL chứa từ khóa nhạy cảm: "${keyword}"`);
      }
      // First time - just log and allow
      console.log(`[Smart Filter] Medium keyword detected but allowing: ${keyword} in ${domain}`);
      return { blocked: false, warning: `Phát hiện từ khóa: ${keyword}`, severity: 'low' };
    }
  }

  return { blocked: false };
}

/**
 * Handle warning and escalation logic
 */
async function handleWarning(domain, filterData, severity, reason) {
  const now = Date.now();
  let warning = filterData.warningHistory[domain];

  if (!warning) {
    // First warning
    warning = { count: 1, lastWarning: now, reasons: [reason], severity };
    filterData.warningHistory[domain] = warning;
    await saveContentFilterData(filterData);

    return {
      blocked: false,
      warning: true,
      firstWarning: true,
      reason: `⚠️ CẢNH BÁO: ${reason}`,
      message: `Đây là lần đầu phát hiện nội dung nhạy cảm trên ${domain}. Tiếp tục?`,
      domain: domain,
      canContinue: true,
      canBlock: true
    };
  }

  // Subsequent access
  warning.count++;
  warning.lastWarning = now;
  if (!warning.reasons.includes(reason)) {
    warning.reasons.push(reason);
  }

  // After 3 warnings, permanently block
  if (warning.count >= 3) {
    filterData.blockedDomains.push(domain);
    delete filterData.warningHistory[domain];
    await saveContentFilterData(filterData);

    return {
      blocked: true,
      reason: `Domain bị chặn sau ${warning.count} lần cảnh báo: ${domain}`,
      category: 'escalated_block',
      canAppeal: true
    };
  }

  // Warning but allow (2nd time)
  await saveContentFilterData(filterData);

  return {
    blocked: false,
    warning: true,
    warningCount: warning.count,
    reason: `⚠️ Cảnh báo lần ${warning.count}/3: ${reason}`,
    message: `Còn ${3 - warning.count} lần cảnh báo trước khi bị chặn vĩnh viễn.`,
    domain: domain,
    canContinue: true,
    canBlock: true
  };
}

/**
 * Allow a domain (user chooses to continue despite warning)
 */
async function allowDomain(domain) {
  const filterData = await getContentFilterData();

  if (!filterData.allowedDomains.includes(domain)) {
    filterData.allowedDomains.push(domain);
    // Remove from warning history
    delete filterData.warningHistory[domain];
    await saveContentFilterData(filterData);
    console.log(`[Smart Filter] User allowed domain: ${domain}`);
  }
  return true;
}

/**
 * Block a domain permanently (user choice)
 */
async function blockDomainPermanently(domain) {
  const filterData = await getContentFilterData();

  if (!filterData.blockedDomains.includes(domain)) {
    filterData.blockedDomains.push(domain);
  }
  // Remove from allowed if was there
  const allowedIdx = filterData.allowedDomains.indexOf(domain);
  if (allowedIdx > -1) filterData.allowedDomains.splice(allowedIdx, 1);

  await saveContentFilterData(filterData);
  console.log(`[Smart Filter] User blocked domain permanently: ${domain}`);
  return true;
}

/**
 * Add to custom blocked list
 */
async function addCustomBlockedDomain(domain) {
  const filterData = await getContentFilterData();
  if (!filterData.customBlocked.includes(domain)) {
    filterData.customBlocked.push(domain);
    await saveContentFilterData(filterData);
    return true;
  }
  return false;
}

/**
 * Remove from custom blocked list
 */
async function removeCustomBlockedDomain(domain) {
  const filterData = await getContentFilterData();
  const idx = filterData.customBlocked.indexOf(domain);
  if (idx > -1) {
    filterData.customBlocked.splice(idx, 1);
    await saveContentFilterData(filterData);
    return true;
  }
  return false;
}

/**
 * Get all blocked domains
 */
async function getCustomBlockedDomains() {
  const filterData = await getContentFilterData();
  return [...filterData.blockedDomains, ...filterData.customBlocked];
}

/**
 * Get filter statistics
 */
async function getFilterStats() {
  const filterData = await getContentFilterData();
  return {
    permanentlyBlocked: filterData.blockedDomains.length,
    customBlocked: filterData.customBlocked.length,
    allowed: filterData.allowedDomains.length,
    warnings: Object.keys(filterData.warningHistory).length,
    warningDetails: Object.entries(filterData.warningHistory).map(([domain, data]) => ({
      domain,
      count: data.count,
      severity: data.severity
    }))
  };
}

/**
 * Reset warning for a domain
 */
async function resetDomainWarning(domain) {
  const filterData = await getContentFilterData();

  // Remove from blocked
  const blockedIdx = filterData.blockedDomains.indexOf(domain);
  if (blockedIdx > -1) filterData.blockedDomains.splice(blockedIdx, 1);

  // Remove from warning history
  delete filterData.warningHistory[domain];

  await saveContentFilterData(filterData);
  console.log(`[Smart Filter] Reset warnings for: ${domain}`);
  return true;
}


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

    // Create profile with self-learning fields
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
      usageCount: 0,

      // Self-learning fields (simplified - no vocabulary to save storage)
      userFeedback: {
        positive: 0,
        negative: 0,
        lastFeedback: null
      },
      visitedUrls: [url],
      refinedGuidelines: '',
      lastUpdated: Date.now()
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
    isFallback: true,

    // Self-learning fields (simplified - no vocabulary to save storage)
    userFeedback: {
      positive: 0,
      negative: 0,
      lastFeedback: null
    },
    visitedUrls: [url],
    refinedGuidelines: '',
    lastUpdated: Date.now()
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
        console.log(`[Domain Analyzer] Using cached profile for ${domain} (${Math.round(age / (24 * 60 * 60 * 1000))} days old)`);
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
 * Now includes learned vocabulary and refined guidelines
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

  // Add user-refined guidelines (higher priority)
  if (profile.refinedGuidelines) {
    instruction += `\nUser Preferences: ${profile.refinedGuidelines}`;
  }

  if (profile.themes && profile.themes.length > 0) {
    instruction += `\nCommon Themes: ${profile.themes.join(', ')}`;
  }

  // Add feedback context
  if (profile.userFeedback) {
    const score = (profile.userFeedback.positive || 0) - (profile.userFeedback.negative || 0);
    if (score < -2) {
      instruction += '\nNote: Users have reported quality issues. Please translate more carefully.';
    } else if (score > 5) {
      instruction += '\nNote: Current translation style is well-received. Maintain this quality.';
    }
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
      feedbackScore: (cache[d].userFeedback?.positive || 0) - (cache[d].userFeedback?.negative || 0),
      age: Math.round((Date.now() - cache[d].analyzedAt) / (24 * 60 * 60 * 1000))
    }))
  };
}

// ============================================================================
// SELF-LEARNING FUNCTIONS
// ============================================================================

/**
 * Record user feedback on translation quality
 * @param {string} url - Current URL
 * @param {boolean} isPositive - true for 👍, false for 👎
 * @param {string} comment - Optional feedback comment
 */
async function recordFeedback(url, isPositive, comment = '') {
  try {
    const domain = extractDomain(url);
    if (!domain) return;

    const result = await chrome.storage.local.get([DOMAIN_CACHE_KEY]);
    const cache = result[DOMAIN_CACHE_KEY] || {};

    if (!cache[domain]) {
      console.log(`[Domain Feedback] No profile for ${domain}`);
      return;
    }

    const profile = cache[domain];

    // Initialize if needed
    if (!profile.userFeedback) {
      profile.userFeedback = { positive: 0, negative: 0, lastFeedback: null };
    }

    if (isPositive) {
      profile.userFeedback.positive++;
    } else {
      profile.userFeedback.negative++;
    }

    profile.userFeedback.lastFeedback = {
      type: isPositive ? 'positive' : 'negative',
      comment: comment,
      timestamp: Date.now()
    };

    profile.lastUpdated = Date.now();
    cache[domain] = profile;
    await chrome.storage.local.set({ [DOMAIN_CACHE_KEY]: cache });

    const score = profile.userFeedback.positive - profile.userFeedback.negative;
    console.log(`[Domain Feedback] ${domain}: ${isPositive ? '👍' : '👎'} (score: ${score})`);

  } catch (error) {
    console.error('[Domain Feedback] Error recording feedback:', error);
  }
}

/**
 * Track visited URLs to improve analysis over time
 * @param {string} url - URL being visited
 */
async function trackVisitedUrl(url) {
  try {
    const domain = extractDomain(url);
    if (!domain) return;

    const result = await chrome.storage.local.get([DOMAIN_CACHE_KEY]);
    const cache = result[DOMAIN_CACHE_KEY] || {};

    if (!cache[domain]) return;

    const profile = cache[domain];

    // Initialize if needed
    if (!profile.visitedUrls) {
      profile.visitedUrls = [];
    }

    // Add URL if not already tracked (limit to 20 URLs)
    if (!profile.visitedUrls.includes(url)) {
      profile.visitedUrls.push(url);
      if (profile.visitedUrls.length > 20) {
        profile.visitedUrls = profile.visitedUrls.slice(-20);
      }

      profile.lastUpdated = Date.now();
      cache[domain] = profile;
      await chrome.storage.local.set({ [DOMAIN_CACHE_KEY]: cache });
      console.log(`[Domain Tracker] Tracked new URL for ${domain} (${profile.visitedUrls.length} URLs)`);
    }

  } catch (error) {
    console.error('[Domain Tracker] Error tracking URL:', error);
  }
}

/**
 * Update refined guidelines based on user preferences
 * @param {string} url - Current URL
 * @param {string} guidelines - User-adjusted translation guidelines
 */
async function updateRefinedGuidelines(url, guidelines) {
  try {
    const domain = extractDomain(url);
    if (!domain || !guidelines) return;

    const result = await chrome.storage.local.get([DOMAIN_CACHE_KEY]);
    const cache = result[DOMAIN_CACHE_KEY] || {};

    if (!cache[domain]) return;

    const profile = cache[domain];
    profile.refinedGuidelines = guidelines;
    profile.lastUpdated = Date.now();

    cache[domain] = profile;
    await chrome.storage.local.set({ [DOMAIN_CACHE_KEY]: cache });
    console.log(`[Domain Guidelines] Updated guidelines for ${domain}`);

  } catch (error) {
    console.error('[Domain Guidelines] Error updating guidelines:', error);
  }
}
