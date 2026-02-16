/*
  DealFlow API Proxy — Cloudflare Worker

  HOW TO DEPLOY:
  1. Go to https://dash.cloudflare.com (create free account if needed)
  2. Click "Workers & Pages" in the left sidebar
  3. Click "Create" → "Create Worker"
  4. Give it a name like "dealflow-proxy"
  5. Click "Deploy"
  6. Click "Edit Code"
  7. Delete everything in the editor and paste this entire file
  8. Click "Deploy"
  9. Copy the URL (looks like: https://dealflow-proxy.YOUR_NAME.workers.dev)
  10. Paste that URL into DealFlow Settings → Proxy URL field
*/

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // POST /enrich — accepts { domain, perplexityApiKey, apolloApiKey, tavilyApiKey, firecrawlApiKey }
      if (path === '/enrich' && request.method === 'POST') {
        const body = await request.json();
        const { domain, perplexityApiKey, apolloApiKey, tavilyApiKey, firecrawlApiKey } = body;

        if (!domain) {
          return jsonResponse({ error: 'domain is required' }, 400);
        }

        const results = {};

        // Run both APIs in parallel
        const tasks = [];

        // Perplexity
        if (perplexityApiKey) {
          tasks.push(
            fetchPerplexity(domain, perplexityApiKey)
              .then(data => Object.assign(results, data))
              .catch(() => {})
          );
        }

        // Apollo
        if (apolloApiKey) {
          tasks.push(
            fetchApollo(domain, apolloApiKey)
              .then(data => {
                // Apollo fills in gaps only (Perplexity takes priority)
                Object.keys(data).forEach(key => {
                  if (!results[key]) results[key] = data[key];
                });
              })
              .catch(() => {})
          );
        }

        await Promise.allSettled(tasks);

        // Follow-up search for NYC address and careers page if missing
        const needsAddress = !results.nycAddress || results.nycAddress === '' || results.nycAddress === 'N/A' || results.nycAddress === 'Unknown';
        const needsCareers = !results.careersUrl || results.careersUrl === '';
        const companyName = results.companyName || domain.split('.')[0];

        // Try Tavily first for address (better for specific searches)
        if (tavilyApiKey && needsAddress) {
          try {
            const tavilyData = await fetchTavilyAddress(companyName, domain, tavilyApiKey);
            if (tavilyData.nycAddress) {
              results.nycAddress = tavilyData.nycAddress;
              results.nycOfficeConfirmed = 'Yes';
            }
            if (tavilyData.careersUrl && !results.careersUrl) {
              results.careersUrl = tavilyData.careersUrl;
            }
          } catch {}
        }

        // Fallback to Perplexity if still missing
        const stillNeedsAddress = !results.nycAddress || results.nycAddress === '' || results.nycAddress === 'N/A';
        if (perplexityApiKey && (stillNeedsAddress || needsCareers)) {
          try {
            const extraData = await fetchNYCAddress(companyName, domain, perplexityApiKey);
            if (extraData.nycAddress && extraData.nycAddress !== 'Unknown' && extraData.nycAddress !== 'N/A' && extraData.nycAddress !== '') {
              results.nycAddress = extraData.nycAddress;
            }
            if (extraData.nycOfficeConfirmed) {
              results.nycOfficeConfirmed = extraData.nycOfficeConfirmed;
            }
            if (extraData.careersUrl && !results.careersUrl) {
              results.careersUrl = extraData.careersUrl;
            }
          } catch {}
        }

        return jsonResponse(results);
      }

      // POST /agent — Full research agent that chains multiple API calls
      if (path === '/agent' && request.method === 'POST') {
        const body = await request.json();
        const { domain, perplexityApiKey, apolloApiKey, tavilyApiKey, firecrawlApiKey } = body;

        if (!domain) {
          return jsonResponse({ error: 'domain is required' }, 400);
        }

        const dossier = {
          domain,
          generatedAt: new Date().toISOString(),
          company: {},
          contacts: [],
          nycIntel: {},
          recentNews: [],
          hiring: {},
          outreachEmail: '',
        };

        const companyNameGuess = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);

        // STEP 1: Company Overview (Perplexity + Apollo in parallel)
        const step1Tasks = [];
        if (perplexityApiKey) {
          step1Tasks.push(
            fetchPerplexity(domain, perplexityApiKey)
              .then(data => Object.assign(dossier.company, data))
              .catch(() => {})
          );
        }
        if (apolloApiKey) {
          step1Tasks.push(
            fetchApollo(domain, apolloApiKey)
              .then(data => {
                Object.keys(data).forEach(key => {
                  if (!dossier.company[key]) dossier.company[key] = data[key];
                });
              })
              .catch(() => {})
          );
        }
        await Promise.allSettled(step1Tasks);

        const companyName = dossier.company.companyName || companyNameGuess;

        // STEP 2: Find Decision Makers (Apollo primary, Perplexity fallback)
        if (apolloApiKey || perplexityApiKey) {
          try {
            const contactsData = await fetchDecisionMakers(companyName, domain, perplexityApiKey, apolloApiKey);
            if (contactsData.contacts && contactsData.contacts.length > 0) {
              dossier.contacts = contactsData.contacts;
            }
          } catch {}
        }

        // STEP 2B: Founder Due Diligence (after identifying decision makers)
        const founderProfiles = [];
        {
          // Identify founders from contacts
          const founders = (dossier.contacts || []).filter(c =>
            c.title && /founder|co-founder|cofounder|ceo.*founder|founder.*ceo/i.test(c.title)
          );

          // If no founders found, treat the CEO as a founder
          if (founders.length === 0) {
            const ceo = (dossier.contacts || []).find(c =>
              c.title && /^ceo$|chief executive/i.test(c.title)
            );
            if (ceo) founders.push(ceo);
          }

          // Run DD on up to 3 founders (in parallel)
          if (founders.length > 0 && (perplexityApiKey || firecrawlApiKey || apolloApiKey)) {
            const ddPromises = founders.slice(0, 3).map(founder =>
              performFounderDD(founder, companyName, domain, firecrawlApiKey, apolloApiKey, perplexityApiKey)
                .catch(() => null)
            );
            const results = await Promise.allSettled(ddPromises);
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value) {
                founderProfiles.push(result.value);
              }
            }
          }
        }
        dossier.founderProfiles = founderProfiles;

        // STEP 3: NYC Address Deep Search (multi-source with confirmation logic)
        {
          const nycSources = []; // Track independent sources that found an address
          let nycAddress = dossier.company.nycAddress || '';
          let nycHeadcount = null;
          let careersUrl = dossier.company.careersUrl || '';
          let nycStatus = 'No'; // "Yes" | "No" | "Planned"

          // Source 1: Tavily web search cascade
          if (tavilyApiKey) {
            try {
              const tavilyData = await fetchTavilyAddress(companyName, domain, tavilyApiKey);
              if (tavilyData.nycAddress) {
                nycAddress = tavilyData.nycAddress;
                nycSources.push('tavily');
              }
              if (tavilyData.careersUrl) careersUrl = tavilyData.careersUrl;
            } catch {}
          }

          // Source 2: Perplexity deep search for NYC office + headcount
          if (perplexityApiKey) {
            try {
              const perplexityNyc = await fetchNYCIntelPerplexity(companyName, domain, perplexityApiKey);
              if (perplexityNyc.nycAddress && perplexityNyc.nycAddress !== 'N/A' && perplexityNyc.nycAddress !== 'Unknown' && perplexityNyc.nycAddress !== '') {
                if (!nycAddress || nycAddress === 'Not found' || nycAddress === 'N/A') {
                  nycAddress = perplexityNyc.nycAddress;
                }
                nycSources.push('perplexity');
              }
              if (perplexityNyc.nycHeadcount) {
                nycHeadcount = perplexityNyc.nycHeadcount;
              }
              if (perplexityNyc.planned) {
                nycStatus = 'Planned';
              }
              if (perplexityNyc.careersUrl && !careersUrl) {
                careersUrl = perplexityNyc.careersUrl;
              }
            } catch {}
          }

          // Use company overview data as a third potential source
          if (dossier.company.nycAddress && dossier.company.nycAddress !== 'N/A' && dossier.company.nycAddress !== 'Unknown') {
            if (!nycSources.includes('perplexity')) { // Perplexity overview is the same source
              nycSources.push('company_overview');
            }
          }

          // Confirmation logic: require 2+ sources for "Yes", otherwise keep as-is
          if (nycAddress && nycAddress !== 'Not found' && nycAddress !== 'N/A') {
            if (nycSources.length >= 2) {
              nycStatus = 'Yes';
            } else if (nycStatus !== 'Planned') {
              // Only 1 source found the address — mark as unconfirmed but present the address
              nycStatus = 'Yes'; // single-source but address was found, still useful
            }
          } else if (nycStatus !== 'Planned') {
            nycStatus = 'No';
            nycAddress = 'Not found';
          }

          dossier.nycIntel = {
            address: nycAddress,
            confirmed: nycStatus,
            nyc_headcount: nycHeadcount || 'Unknown',
            sources: nycSources,
            careersUrl: careersUrl,
          };
        }

        // STEP 4: Recent News Search (domain-anchored + relevance validation)
        if (tavilyApiKey) {
          try {
            const newsData = await fetchRecentNews(companyName, domain, tavilyApiKey, dossier, perplexityApiKey);
            dossier.recentNews = newsData.articles || [];
          } catch {}
        }

        // STEP 5: Hiring Intelligence (smart deduplication with Firecrawl)
        const careersUrl = dossier.nycIntel?.careersUrl || dossier.company.careersUrl || '';
        try {
          const hiringData = await fetchHiringIntelligence(
            companyName,
            domain,
            careersUrl,
            tavilyApiKey,
            perplexityApiKey,
            firecrawlApiKey
          );
          dossier.hiring = hiringData;
        } catch {
          dossier.hiring = {
            status: dossier.company.hiringStatus || 'Unknown',
            totalJobs: dossier.company.totalJobs || 0,
            nycJobs: dossier.company.nycJobs || 0,
            keyRoles: dossier.company.keyRolesHiring || '',
          };
        }

        // STEP 6: Generate Outreach Email (must never be blank)
        if (perplexityApiKey) {
          try {
            const emailData = await generateOutreachEmail(companyName, domain, dossier, perplexityApiKey);
            dossier.outreachEmail = emailData.email || '';
            if (emailData.subject) dossier.outreachEmailSubject = emailData.subject;
            if (emailData.body) dossier.outreachEmailBody = emailData.body;
          } catch (e) {
            console.log('Outreach email generation failed:', e.message);
            dossier.outreachEmail = '';
          }
        }

        // Fallback: generate a basic email if step 6 produced nothing
        if (!dossier.outreachEmail) {
          const contactName = dossier.contacts?.[0]?.name || '';
          const greeting = contactName ? `Hi ${contactName.split(' ')[0]}` : 'Hi there';
          const hook = dossier.hiring?.status === 'Actively Hiring'
            ? `I noticed ${companyName} is actively hiring (${dossier.hiring.totalJobs || 'several'} open roles) — growing teams often need more space.`
            : dossier.recentNews?.[0]
            ? `I came across news about ${companyName} — ${dossier.recentNews[0].title.toLowerCase().slice(0, 80)}.`
            : `I've been following ${companyName}'s growth and wanted to reach out.`;

          const subject = `${companyName} + NYC office space`;
          const body = `${greeting},\n\n${hook} I help tech companies find office space in NYC and thought I might be able to help.\n\nWorth a quick chat?`;
          dossier.outreachEmail = `Subject: ${subject}\n\n${body}`;
          dossier.outreachEmailSubject = subject;
          dossier.outreachEmailBody = body;
        }

        // STEP 7: Calculate Prospect Scorecard
        {
          // Funding Score (0-4)
          const lastFundingAmt = dossier.company?.lastFundingAmount || dossier.company?.totalFunding || '';
          const fundingResult = calculateFundingScore(lastFundingAmt);

          // Investor Score (0-3)
          const investorString = dossier.company?.topInvestors || dossier.company?.leadInvestors || '';
          const investorResult = calculateInvestorScore(investorString);

          // Founder Score (0-3) — take the max across all founder profiles
          let founderScoreResult = { score: 0, reason: 'No founder data' };
          let bestFounder = null;

          // First try to use founderProfiles (detailed DD data)
          for (const fp of (dossier.founderProfiles || [])) {
            if (fp.pedigreeScore > founderScoreResult.score) {
              founderScoreResult = { score: fp.pedigreeScore, reason: fp.pedigreeReason };
              bestFounder = fp.name;
            }
          }

          // FALLBACK: If founderProfiles is empty but we have founders in contacts,
          // create basic founder info for the scorecard
          if (!bestFounder && dossier.contacts && dossier.contacts.length > 0) {
            const founders = dossier.contacts.filter(c =>
              c.title && /founder|co-founder|cofounder|ceo.*founder|founder.*ceo/i.test(c.title)
            );
            // Also check for just CEO if no explicit founders
            const ceo = !founders.length ? dossier.contacts.find(c =>
              c.title && /^ceo$|chief executive/i.test(c.title)
            ) : null;

            const founderContact = founders[0] || ceo;
            if (founderContact) {
              bestFounder = founderContact.name;
              // Give base score of 0 (first-time founder) but acknowledge we found them
              founderScoreResult = {
                score: 0,
                reason: `Founder identified: ${founderContact.name} (${founderContact.title}) - needs DD`
              };
            }
          }

          // Link founderProfiles to contacts for display continuity
          // If a founder is in contacts but not in founderProfiles, add a minimal profile
          if (dossier.contacts && (!dossier.founderProfiles || dossier.founderProfiles.length === 0)) {
            const contactFounders = dossier.contacts.filter(c =>
              c.title && /founder|co-founder|cofounder|ceo/i.test(c.title)
            );
            if (contactFounders.length > 0) {
              dossier.founderProfiles = contactFounders.map(f => ({
                name: f.name,
                title: f.title,
                linkedin: f.linkedin || '',
                email: f.email || '',
                pedigree: 'First-Time Founder',
                pedigreeReason: 'Awaiting detailed background research',
                pedigreeScore: 0,
                tldr: '',
                career: [],
                education: [],
                talkingPoints: [],
              }));
            }
          }

          const prospectScore = fundingResult.score + investorResult.score + founderScoreResult.score;

          dossier.scorecard = {
            prospectScore,
            funding: {
              score: fundingResult.score,
              maxScore: 4,
              signal: fundingResult.signal,
              amount: lastFundingAmt,
            },
            investor: {
              score: investorResult.score,
              maxScore: 3,
              signal: investorResult.signal,
              matchedInvestor: investorResult.matchedInvestor,
              tier: investorResult.tier,
            },
            founder: {
              score: founderScoreResult.score,
              maxScore: 3,
              signal: founderScoreResult.reason,
              bestFounder: bestFounder,
            },
          };
        }

        return jsonResponse(dossier);
      }

      // POST /chat — Claude AI assistant with context
      if (path === '/chat' && request.method === 'POST') {
        const body = await request.json();
        const { messages, context, anthropicApiKey } = body;

        if (!anthropicApiKey) {
          return jsonResponse({ error: 'anthropicApiKey is required' }, 400);
        }

        if (!messages || !Array.isArray(messages)) {
          return jsonResponse({ error: 'messages array is required' }, 400);
        }

        // Build system prompt with context
        const systemPrompt = buildChatSystemPrompt(context);

        // Call Claude API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: systemPrompt,
            messages: messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          return jsonResponse({ error: `Claude API error: ${response.status}` }, response.status);
        }

        const data = await response.json();
        const assistantMessage = data.content?.[0]?.text || '';

        return jsonResponse({
          message: assistantMessage,
          usage: data.usage,
        });
      }

      // Health check
      if (path === '/' || path === '/health') {
        return jsonResponse({ status: 'ok', service: 'dealflow-proxy' });
      }

      return jsonResponse({ error: 'Not found' }, 404);

    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

async function fetchPerplexity(domain, apiKey) {
  const today = new Date().toISOString().split('T')[0];
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [
        {
          role: 'system',
          content: 'You are an expert Commercial Real Estate & Corporate Intelligence Analyst. Your goal is to gather precise, verified, and up-to-date data on target companies. Return ONLY valid JSON with no additional text.'
        },
        {
          role: 'user',
          content: `Research the company at domain "${domain}". Today's date is ${today}.

EXECUTION STEPS:

1. CORPORATE PROFILE
- Find their Headquarters (city, state)
- Manhattan Presence: Check if they have a physical office in Manhattan. Provide the EXACT street address (e.g., "123 Park Ave, Floor 10, New York, NY 10001"). If remote or no NYC office, return "N/A"
- Company Description: 1-2 sentences MAXIMUM, under 50 words. Be specific about their core product/service. No fluff.

2. INDUSTRY CLASSIFICATION (Crunchbase-style)
- Describe what the company does in 2-5 words, like a Crunchbase industry tag
- GOOD examples: "AI Contract Review", "Cloud Data Warehouse", "Developer Security Tools", "B2B Payment Processing", "Real-Time Collaboration Software", "Vertical SaaS for Construction", "AI Recruiting Platform"
- BAD examples (too generic): "Information Technology & Services", "Computer Software", "Internet", "Technology"
- Think: what does this company ACTUALLY BUILD or SELL?

3. FINANCIALS & SIZE (High Precision)
- Total Funding: Search Crunchbase, Pitchbook, press releases for CUMULATIVE funding across ALL rounds. Return USD amount like "$1.83B" or "$50M" or "Undisclosed"
- Top Investors: Search Crunchbase, Pitchbook, TechCrunch for their investors. List 2-5 primary VC firms or institutional backers by name (e.g., "Sequoia Capital, Andreessen Horowitz, Tiger Global"). This is REQUIRED for any funded company. If bootstrapped, say "Bootstrapped". Only say "Unknown" as last resort.
- Employee Count: Avoid broad ranges. Find specific number from Pitchbook, LinkedIn, or 10-K filings. Format: "approximately [Number]"

4. HIRING INTELLIGENCE
- Check their careers page or ATS (Ashby, Greenhouse, Lever, Wellfound)
- Hiring Status: Active or Frozen
- Volume: Number of open roles
- Key Roles: List 2-3 specific job titles, prioritize NYC-based roles

Return ONLY this JSON:
{
  "companyName": "",
  "description": "1-2 sentences, under 50 words",
  "industry": "2-5 word Crunchbase-style description of what they build/sell",
  "founded": "",
  "headquarters": "",
  "nycAddress": "exact street address or N/A",
  "nycOfficeConfirmed": "Yes/No",
  "employeeCount": "approximately [number]",
  "totalFunding": "cumulative across all rounds",
  "topInvestors": "comma-separated investor names or Bootstrapped or Unknown",
  "lastFundingType": "",
  "lastFundingDate": "",
  "hiringStatus": "Active/Frozen",
  "totalJobs": "",
  "nycJobs": "",
  "keyRolesHiring": "",
  "linkedinUrl": "",
  "careersUrl": "",
  "keyContacts": ""
}`
        }
      ],
      max_tokens: 800,
    }),
  });

  if (!response.ok) throw new Error(`Perplexity ${response.status}`);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    // Enforce description length: cap at 50 words
    if (parsed.description) {
      const words = parsed.description.split(/\s+/);
      if (words.length > 50) {
        parsed.description = words.slice(0, 50).join(' ') + '.';
      }
    }
    return parsed;
  }
  return {};
}

// Perplexity deep search for NYC office intel including headcount
async function fetchNYCIntelPerplexity(companyName, domain, apiKey) {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [
        {
          role: 'user',
          content: `Find the EXACT New York City office address for ${companyName} (website: ${domain}).

SEARCH THESE SPECIFIC SOURCES IN ORDER:
1. Go to ${domain}/contact or ${domain}/about - look for NYC address in footer or contact info
2. Check their LinkedIn company page: search "site:linkedin.com/company ${companyName}" and look at Locations
3. Search for "${companyName} NYC office address" or "${companyName} New York headquarters"
4. Check their job postings for NYC office addresses (Greenhouse, Lever, Ashby URLs often list office locations)
5. Check Crunchbase or Pitchbook for office locations
6. Look for press releases about ${companyName} opening NYC office
7. Search WeWork, Industrious, or coworking directories for ${companyName}

I need the EXACT street address like "123 Park Avenue, Floor 10, New York, NY 10001".
Do NOT return generic "New York City" - I need the actual street address.

Also find:
- Estimated NYC headcount from LinkedIn or job listings
- Their careers page URL

Return ONLY this JSON:
{
  "nycAddress": "exact street address with zip, or empty string if truly not found",
  "nycHeadcount": "estimated NYC employees like '~50' or 'Unknown'",
  "planned": false,
  "careersUrl": "careers page URL or empty string"
}

Only set "planned" to true if they've announced plans to open NYC office but haven't yet.`,
        },
      ],
      max_tokens: 500,
    }),
  });

  if (!response.ok) throw new Error(`Perplexity ${response.status}`);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return {};
}

async function fetchTavilyAddress(companyName, domain, apiKey) {
  const results = {};

  // Multiple search strategies for NYC office address - expanded queries
  const searchQueries = [
    `"${companyName}" office address "New York" OR "NYC" OR "Manhattan" OR "Brooklyn"`,
    `${companyName} headquarters "New York City" office location address`,
    `site:${domain} contact address "New York" OR "NYC"`,
    `"${companyName}" "New York, NY" location office`,
    `site:linkedin.com "${companyName}" "New York" office location`,
  ];

  // Try each search query until we find an address
  for (const query of searchQueries) {
    if (results.nycAddress) break;

    try {
      const addressResponse = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'advanced',
          include_answer: true,
          max_results: 8
        }),
      });

      if (!addressResponse.ok) continue;
      const addressData = await addressResponse.json();

      // Multiple regex patterns for different address formats (expanded)
      const addressPatterns = [
        // Standard format: 123 Park Ave, New York, NY 10001
        /\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Broadway|Road|Rd|Place|Pl|Boulevard|Blvd|Way|Drive|Dr|Lane|Ln)[,\s]+(?:Suite|Ste|Floor|Fl|#|Unit)?\s*\d*[,\s]*(?:New York|Manhattan|NYC|Brooklyn|Queens)[,\s]+(?:NY)?\s*\d{5}/gi,
        // With floor/suite: 123 Park Ave, Floor 10, New York
        /\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Broadway|Road|Rd|Place|Pl|Boulevard|Blvd)[,\s]+(?:Suite|Ste|Floor|Fl|#|Unit)\s*\d+[,\s]*(?:New York|NYC|Manhattan|Brooklyn)/gi,
        // Short format: 123 Park Ave, NYC or New York, NY
        /\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Broadway|Road|Rd|Place|Pl|Boulevard|Blvd)[,\s]+(?:New York|NYC|Manhattan|Brooklyn)[,\s]*(?:NY)?/gi,
        // Numbered streets: 123 West 23rd Street, New York
        /\d+\s+(?:West|East|W\.?|E\.?)\s*\d+(?:st|nd|rd|th)\s+(?:Street|St|Avenue|Ave)[,\s]+(?:Suite|Ste|Floor|Fl|#)?\s*\d*[,\s]*(?:New York|NYC|Manhattan)?/gi,
        // WeWork/coworking style: 115 Broadway, New York
        /\d+\s+(?:Broadway|Park\s+Ave|Madison\s+Ave|Fifth\s+Ave|Lexington\s+Ave|Wall\s+Street|Water\s+Street|Fulton\s+Street)[,\s]+(?:Floor|Fl|Suite|Ste)?\s*\d*[,\s]*(?:New York|NYC)?/gi,
      ];

      // Check Tavily's AI answer first
      if (addressData.answer) {
        for (const pattern of addressPatterns) {
          const match = addressData.answer.match(pattern);
          if (match) {
            results.nycAddress = match[0].trim();
            break;
          }
        }
      }

      // Also check search results
      if (!results.nycAddress && addressData.results) {
        for (const result of addressData.results) {
          const content = (result.content || '') + ' ' + (result.title || '');
          for (const pattern of addressPatterns) {
            const match = content.match(pattern);
            if (match) {
              results.nycAddress = match[0].trim();
              break;
            }
          }
          if (results.nycAddress) break;
        }
      }
    } catch (e) {
      // Continue to next search query
    }
  }

  // Search for careers page
  try {
    const careersResponse = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${companyName} careers jobs page site:${domain}`,
        search_depth: 'basic',
        include_answer: false,
        max_results: 3
      }),
    });

    if (careersResponse.ok) {
      const careersData = await careersResponse.json();
      if (careersData.results && careersData.results.length > 0) {
        const careersUrl = careersData.results.find(r =>
          r.url.includes('careers') || r.url.includes('jobs') || r.url.includes('hiring')
        );
        if (careersUrl) {
          results.careersUrl = careersUrl.url;
        }
      }
    }
  } catch (e) {
    // Careers search failed, continue
  }

  return results;
}

async function fetchApollo(domain, apiKey) {
  const response = await fetch('https://api.apollo.io/v1/organizations/enrich', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({ domain }),
  });

  if (!response.ok) throw new Error(`Apollo ${response.status}`);

  const data = await response.json();
  const org = data.organization;
  if (!org) return {};

  const results = {};
  if (org.name) results.companyName = org.name;
  if (org.industry) results.industry = org.industry;
  if (org.estimated_num_employees) results.employeeCount = String(org.estimated_num_employees);
  if (org.short_description) results.description = org.short_description;
  if (org.linkedin_url) results.linkedinUrl = org.linkedin_url;
  if (org.founded_year) results.founded = String(org.founded_year);
  if (org.city) results.headquarters = `${org.city}, ${org.state || ''}`.trim();
  if (org.total_funding) results.totalFunding = `$${Math.round(org.total_funding / 1000000)}M`;
  if (org.total_funding_printed) results.totalFunding = org.total_funding_printed;
  if (org.latest_funding_round_type) results.lastFundingType = org.latest_funding_round_type;
  if (org.latest_funding_stage) results.lastFundingType = org.latest_funding_stage;
  if (org.number_of_funding_rounds) results.fundingRounds = String(org.number_of_funding_rounds);
  if (org.blog_url || org.website_url) results.careersUrl = org.blog_url || '';
  return results;
}

// Agent helper: Find decision makers — Apollo People Search (primary) + Perplexity (fallback)
async function fetchDecisionMakers(companyName, domain, perplexityApiKey, apolloApiKey) {
  let allContacts = [];

  // PRIMARY SOURCE: Apollo People Search API
  if (apolloApiKey) {
    try {
      const apolloContacts = await fetchApolloDecisionMakers(domain, apolloApiKey);
      if (apolloContacts.length > 0) {
        allContacts = apolloContacts.map(c => ({ ...c, source: 'apollo', verified: true }));
      }
    } catch (e) {
      console.log('Apollo People Search failed:', e.message);
    }
  }

  // SECONDARY SOURCE: Perplexity fills gaps for roles Apollo missed
  if (perplexityApiKey) {
    try {
      const perplexityContacts = await fetchPerplexityDecisionMakers(companyName, domain, perplexityApiKey);
      if (perplexityContacts.length > 0) {
        // Only add contacts from Perplexity if not already found by Apollo (by name match)
        const existingNames = new Set(allContacts.map(c => c.name.toLowerCase()));
        for (const pc of perplexityContacts) {
          if (!existingNames.has(pc.name.toLowerCase())) {
            allContacts.push({ ...pc, source: 'perplexity', verified: false });
          }
        }
      }
    } catch (e) {
      console.log('Perplexity decision makers failed:', e.message);
    }
  }

  return { contacts: allContacts };
}

// Apollo People Search — search by domain + expanded title list
async function fetchApolloDecisionMakers(domain, apiKey) {
  const titleKeywords = [
    'CEO', 'Chief Executive Officer',
    'Founder', 'Co-Founder', 'Cofounder',
    'CFO', 'Chief Financial Officer',
    'COO', 'Chief Operating Officer',
    'Managing Partner',
    'Head of Operations', 'VP of Operations', 'VP Operations',
    'Head of Finance', 'VP of Finance', 'VP Finance',
    'Head of People', 'VP of People', 'VP People', 'Chief People Officer',
    'Board Member', 'Board Director',
    'Workplace', 'Real Estate', 'Facilities',
  ];

  const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      q_organization_domains: domain,
      person_titles: titleKeywords,
      page: 1,
      per_page: 15,
    }),
  });

  if (!response.ok) throw new Error(`Apollo People ${response.status}`);

  const data = await response.json();
  const people = data.people || [];

  return people
    .filter(p => p.name && p.title)
    .map(p => ({
      name: p.name,
      title: p.title,
      linkedin: p.linkedin_url || '',
      email: p.email || '',
    }));
}

// Perplexity fallback for decision makers — expanded title list
async function fetchPerplexityDecisionMakers(companyName, domain, apiKey) {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at finding company executives and leadership. Always return valid JSON with contacts found. Search thoroughly using LinkedIn and company websites.'
        },
        {
          role: 'user',
          content: `Find the leadership team at ${companyName} (website: ${domain}).

REQUIRED SEARCHES:
1. Search LinkedIn for "${companyName}" company page and find executives
2. Search "${companyName} leadership team" or "${companyName} about us team"
3. Search "${companyName} founder CEO"
4. Check ${domain}/about or ${domain}/team pages

I need the following roles (find as many as possible, at least 2-3):
- CEO / Founder / Co-Founder (MUST find this person)
- COO / Chief Operating Officer
- CFO / Chief Financial Officer
- Managing Partner
- VP of Operations / Head of Operations
- Head of Finance / VP of Finance
- Head of People / VP of People / Chief People Officer
- Board Members (list any known)
- Key Investors (individuals from lead investment firms)
- Anyone with "Workplace" in their title
- Anyone with "Real Estate" in their title
- Head of Facilities / VP of Facilities

For each person found, provide:
- Full name
- Exact job title
- LinkedIn URL (search "firstname lastname ${companyName} linkedin")

IMPORTANT: You MUST find at least the CEO/Founder. Every company has one.

Return ONLY this JSON (no other text):
{
  "contacts": [
    {"name": "John Smith", "title": "CEO & Co-Founder", "linkedin": "https://linkedin.com/in/johnsmith"},
    {"name": "Jane Doe", "title": "COO", "linkedin": "https://linkedin.com/in/janedoe"}
  ]
}`,
        },
      ],
      max_tokens: 700,
    }),
  });

  if (!response.ok) throw new Error(`Perplexity ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.contacts && Array.isArray(parsed.contacts) && parsed.contacts.length > 0) {
        return parsed.contacts.filter(c =>
          c.name && c.name !== 'Full Name' && c.name !== '' &&
          c.title && c.title !== 'Job Title' && c.title !== ''
        );
      }
    } catch (e) {
      // JSON parse error
    }
  }
  return [];
}

// Agent helper: Recent news search via Tavily - focused on growth signals
// Now takes full company context for relevance validation
async function fetchRecentNews(companyName, domain, apiKey, companyContext, perplexityApiKey) {
  // Build known identifiers for cross-reference validation
  const identifiers = {
    domain: domain.toLowerCase(),
    companyName: companyName.toLowerCase(),
    ceoName: '',
    industry: '',
    description: '',
  };

  if (companyContext) {
    // Extract CEO/Founder name from contacts
    const ceo = (companyContext.contacts || []).find(c =>
      c.title && /ceo|founder|co-founder|cofounder|chief executive/i.test(c.title)
    );
    if (ceo) identifiers.ceoName = ceo.name.toLowerCase();
    identifiers.industry = (companyContext.company?.industry || '').toLowerCase();
    identifiers.description = (companyContext.company?.description || '').toLowerCase();
  }

  // Run multiple targeted search queries in parallel for better coverage
  const queries = [
    // Query 1: Domain-anchored growth signals
    `site:${domain} OR "${companyName}" "${domain}" (funding OR expansion OR "new office" OR "raised" OR "series" OR "new product")`,
    // Query 2: Company name + CEO anchor (if available)
    identifiers.ceoName
      ? `"${companyName}" "${identifiers.ceoName}" news`
      : `"${companyName}" ${domain} news ${new Date().getFullYear()}`,
    // Query 3: Industry-contextualized search
    `"${companyName}" (funding OR raised OR series OR acquisition OR partnership OR launch) ${identifiers.industry ? identifiers.industry.split(' ').slice(0, 2).join(' ') : ''}`.trim(),
  ];

  // Run all queries in parallel
  const searchPromises = queries.map(query =>
    fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        include_answer: false,
        max_results: 5,
        include_raw_content: false,
      }),
    })
    .then(r => r.ok ? r.json() : { results: [] })
    .catch(() => ({ results: [] }))
  );

  const searchResults = await Promise.all(searchPromises);

  // Merge all results and deduplicate by URL
  const seenUrls = new Set();
  const allResults = [];
  for (const data of searchResults) {
    for (const r of (data.results || [])) {
      if (r.url && !seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        allResults.push(r);
      }
    }
  }

  // Process each article: extract date, categorize, and score relevance
  const articles = allResults.map(r => {
    // Extract or estimate date from the result
    let publishedDate = r.published_date || r.publishedDate || null;

    // Fallback 1: Try to extract date from content
    if (!publishedDate && r.content) {
      const datePatterns = [
        /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
        /\d{1,2}\/\d{1,2}\/\d{4}/,
        /\d{4}-\d{2}-\d{2}/,
      ];
      for (const pattern of datePatterns) {
        const match = r.content.match(pattern);
        if (match) {
          publishedDate = match[0];
          break;
        }
      }
    }

    // Fallback 2: Try to extract date from URL
    if (!publishedDate && r.url) {
      const urlDateMatch = r.url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (urlDateMatch) {
        publishedDate = `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}`;
      } else {
        const urlDateMatch2 = r.url.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (urlDateMatch2) {
          publishedDate = urlDateMatch2[0];
        }
      }
    }

    // Categorize the news type based on content
    const textContent = (r.title + ' ' + (r.content || '')).toLowerCase();
    let newsType = 'Company News';
    if (textContent.includes('funding') || textContent.includes('raised') || textContent.includes('series') || textContent.includes('investment') || textContent.includes('round')) {
      newsType = 'Funding';
    } else if (textContent.includes('launch') || textContent.includes('new product') || textContent.includes('release') || textContent.includes('announces')) {
      newsType = 'Product Launch';
    } else if (textContent.includes('expansion') || textContent.includes('new office') || textContent.includes('opens') || textContent.includes('headquarters') || textContent.includes('relocat')) {
      newsType = 'Expansion';
    } else if (textContent.includes('ceo') || textContent.includes('hire') || textContent.includes('appoint') || textContent.includes('leadership') || textContent.includes('names')) {
      newsType = 'Leadership';
    } else if (textContent.includes('acquisition') || textContent.includes('acquire') || textContent.includes('merger') || textContent.includes('bought')) {
      newsType = 'M&A';
    } else if (textContent.includes('partnership') || textContent.includes('partner') || textContent.includes('collaborat') || textContent.includes('integrat')) {
      newsType = 'Partnership';
    }

    // Normalize date for sorting
    let sortDate = 0;
    if (publishedDate && publishedDate !== 'Unknown') {
      try {
        sortDate = new Date(publishedDate).getTime();
        if (isNaN(sortDate)) sortDate = 0;
      } catch { sortDate = 0; }
    }

    // --- RELEVANCE SCORING ---
    // Cross-reference article against known company identifiers
    const titleLower = (r.title || '').toLowerCase();
    const snippetLower = (r.content || '').toLowerCase();
    const urlLower = (r.url || '').toLowerCase();
    const fullText = titleLower + ' ' + snippetLower + ' ' + urlLower;

    let relevance_confidence = 'low';
    const matchReasons = [];

    // HIGH: domain appears in URL (from the company's own site or mentions their site)
    if (urlLower.includes(identifiers.domain)) {
      relevance_confidence = 'high';
      matchReasons.push('domain_in_url');
    }

    // HIGH: domain mentioned in article text
    if (fullText.includes(identifiers.domain)) {
      relevance_confidence = 'high';
      matchReasons.push('domain_in_text');
    }

    // HIGH: CEO/founder name appears in article
    if (identifiers.ceoName && identifiers.ceoName.length > 3 && fullText.includes(identifiers.ceoName)) {
      relevance_confidence = 'high';
      matchReasons.push('ceo_name');
    }

    // MEDIUM: exact company name appears in title
    if (titleLower.includes(identifiers.companyName)) {
      if (relevance_confidence !== 'high') relevance_confidence = 'medium';
      matchReasons.push('name_in_title');
    }

    // MEDIUM: exact company name in snippet + industry keyword match
    if (snippetLower.includes(identifiers.companyName) && identifiers.industry) {
      const industryWords = identifiers.industry.split(/\s+/).filter(w => w.length > 3);
      const hasIndustryMatch = industryWords.some(w => fullText.includes(w));
      if (hasIndustryMatch) {
        if (relevance_confidence !== 'high') relevance_confidence = 'medium';
        matchReasons.push('name_plus_industry');
      }
    }

    // If only a partial name match (first word), stay low unless other signals
    if (relevance_confidence === 'low') {
      const nameWords = identifiers.companyName.split(/\s+/);
      const hasFullNameMatch = fullText.includes(identifiers.companyName);
      if (!hasFullNameMatch && nameWords.length > 1) {
        // Only first word matched — very likely false positive for short/common names
        relevance_confidence = 'low';
      } else if (hasFullNameMatch) {
        // Full name matched but no other identifiers — borderline
        relevance_confidence = 'medium';
        matchReasons.push('name_in_text');
      }
    }

    return {
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 200) || '',
      source: new URL(r.url).hostname.replace('www.', ''),
      publishedDate: publishedDate || 'Unknown',
      newsType,
      relevance_confidence,
      _sortDate: sortDate,
      _matchReasons: matchReasons,
    };
  });

  // Sort by date descending (most recent first), unknowns at end
  articles.sort((a, b) => b._sortDate - a._sortDate);

  // Filter: only keep high and medium confidence results
  let validated = articles.filter(a => a.relevance_confidence !== 'low');

  // If we have Perplexity available and some borderline articles, do LLM validation
  // on articles that are medium confidence to upgrade or downgrade them
  if (perplexityApiKey && validated.length < 3 && articles.length > validated.length) {
    // We don't have enough results — try to validate some "low" ones via LLM
    const lowArticles = articles.filter(a => a.relevance_confidence === 'low').slice(0, 3);
    if (lowArticles.length > 0) {
      try {
        const llmValidated = await validateNewsRelevance(
          companyName, domain, identifiers, lowArticles, perplexityApiKey
        );
        // Add any that passed validation as medium
        for (const article of llmValidated) {
          article.relevance_confidence = 'medium';
          article._matchReasons.push('llm_validated');
          validated.push(article);
        }
      } catch {
        // LLM validation failed, skip
      }
    }
  }

  // Re-sort after potential additions
  validated.sort((a, b) => b._sortDate - a._sortDate);

  // Clean up internal fields and take top 5
  const finalArticles = validated
    .slice(0, 5)
    .map(({ _sortDate, _matchReasons, ...rest }) => rest);

  return { articles: finalArticles };
}

// LLM-based relevance validation for borderline news articles
async function validateNewsRelevance(companyName, domain, identifiers, articles, perplexityApiKey) {
  const articleList = articles.map((a, i) =>
    `Article ${i + 1}:\n  Title: ${a.title}\n  Snippet: ${a.snippet?.slice(0, 150)}\n  URL: ${a.url}`
  ).join('\n\n');

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${perplexityApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [
        {
          role: 'user',
          content: `Given this company:
- Name: ${companyName}
- Domain: ${domain}
- Industry: ${identifiers.industry || 'unknown'}

For each article below, answer YES if it is about THIS SPECIFIC company (not a different company with a similar name), or NO if it is about a different company or unrelated.

${articleList}

Return ONLY a JSON array of booleans in order, e.g. [true, false, true]`,
        },
      ],
      max_tokens: 100,
    }),
  });

  if (!response.ok) return [];

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const results = JSON.parse(jsonMatch[0]);
    return articles.filter((_, i) => results[i] === true);
  } catch {
    return [];
  }
}

// Firecrawl helper: Scrape a URL and get clean markdown/structured data
async function scrapeWithFirecrawl(url, apiKey) {
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'extract'],
      extract: {
        schema: {
          type: 'object',
          properties: {
            jobListings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Job title' },
                  department: { type: 'string', description: 'Department or team' },
                  location: { type: 'string', description: 'Job location' },
                },
              },
              description: 'List of job openings found on the page',
            },
            totalJobCount: { type: 'number', description: 'Total number of job listings found' },
            companyName: { type: 'string', description: 'Company name' },
          },
          required: ['jobListings'],
        },
        prompt: 'Extract all job listings from this careers page. Include title, department, and location for each job.',
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl error: ${response.status}`);
  }

  const data = await response.json();
  return {
    markdown: data.data?.markdown || '',
    extract: data.data?.extract || {},
    success: data.success,
  };
}

// Agent helper: Smart hiring intelligence - goes to careers page as source of truth
async function fetchHiringIntelligence(companyName, domain, careersUrl, tavilyApiKey, perplexityApiKey, firecrawlApiKey) {
  const hiring = {
    status: 'Unknown',
    totalJobs: 0,
    nycJobs: 0,
    keyRoles: '',
    careersUrl: careersUrl || '',
    source: '',
    jobListings: [],  // New: actual job data from Firecrawl
  };

  // Step 1: If we don't have a careers URL, find it
  if (!careersUrl && tavilyApiKey) {
    const searchResponse = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query: `${companyName} careers jobs openings site:${domain}`,
        search_depth: 'basic',
        include_answer: false,
        max_results: 5
      }),
    });

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      for (const result of (searchData.results || [])) {
        if (result.url.includes('careers') || result.url.includes('jobs') ||
            result.url.includes('greenhouse') || result.url.includes('lever') ||
            result.url.includes('ashby') || result.url.includes('workable')) {
          careersUrl = result.url;
          hiring.careersUrl = careersUrl;
          break;
        }
      }
    }
  }

  // Step 2: Use Firecrawl to scrape the careers page (PRIMARY SOURCE)
  let firecrawlSuccess = false;
  if (careersUrl && firecrawlApiKey) {
    try {
      const scrapeResult = await scrapeWithFirecrawl(careersUrl, firecrawlApiKey);

      if (scrapeResult.success) {
        const extract = scrapeResult.extract || {};
        hiring.source = 'firecrawl';

        // Get job listings from structured extraction
        if (extract.jobListings && Array.isArray(extract.jobListings) && extract.jobListings.length > 0) {
          firecrawlSuccess = true;
          hiring.jobListings = extract.jobListings;
          hiring.totalJobs = extract.totalJobCount || extract.jobListings.length;

          // Count NYC jobs
          hiring.nycJobs = extract.jobListings.filter(job => {
            const loc = (job.location || '').toLowerCase();
            return loc.includes('new york') || loc.includes('nyc') ||
                   loc.includes('manhattan') || loc.includes('brooklyn');
          }).length;

          // Extract key roles (first 5 unique titles)
          const uniqueTitles = [...new Set(extract.jobListings.map(j => j.title).filter(Boolean))];
          hiring.keyRoles = uniqueTitles.slice(0, 5).join(', ');
        }

        // FALLBACK: If structured extraction failed, parse job count from markdown
        if (!firecrawlSuccess && scrapeResult.markdown) {
          const markdown = scrapeResult.markdown.toLowerCase();

          // Look for job listing patterns in markdown
          const jobPatterns = [
            /(\d+)\s*(?:open\s*)?(?:positions?|roles?|jobs?|openings?)/gi,
            /(?:we\s*have|currently\s*have|there\s*are)\s*(\d+)\s*(?:open|available)/gi,
            /showing\s*(\d+)\s*(?:of\s*\d+)?\s*(?:jobs?|roles?|positions?)/gi,
          ];

          for (const pattern of jobPatterns) {
            const match = markdown.match(pattern);
            if (match) {
              const numMatch = match[0].match(/(\d+)/);
              if (numMatch) {
                hiring.totalJobs = parseInt(numMatch[1]);
                hiring.source = 'firecrawl_markdown';
                firecrawlSuccess = true;
                break;
              }
            }
          }

          // If no count found but page has job-related keywords, mark as hiring
          if (!firecrawlSuccess) {
            const hiringSignals = ['apply now', 'view job', 'job description', 'open positions',
                                   'join our team', 'we\'re hiring', 'careers at', 'see all jobs'];
            const hasHiringSignals = hiringSignals.some(signal => markdown.includes(signal));
            if (hasHiringSignals) {
              hiring.status = 'Hiring';  // We know they're hiring even if we can't count
              hiring.source = 'firecrawl_signals';
              firecrawlSuccess = true;  // Mark as partial success
            }
          }
        }
      }
    } catch (e) {
      // Firecrawl failed, will fall back to other methods
      console.log('Firecrawl error:', e.message);
    }
  }

  // Step 3: Fall back to Tavily if Firecrawl didn't work
  if (!firecrawlSuccess && careersUrl && tavilyApiKey) {
    const scrapeResponse = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query: `site:${careersUrl.replace(/^https?:\/\//, '').split('/')[0]} open jobs positions`,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 10
      }),
    });

    if (scrapeResponse.ok) {
      const scrapeData = await scrapeResponse.json();
      hiring.source = 'tavily_search';

      if (scrapeData.answer) {
        const countMatch = scrapeData.answer.match(/(\d+)\s*(?:open|job|position|role)/i);
        if (countMatch) {
          hiring.totalJobs = parseInt(countMatch[1]);
        }
      }
    }
  }

  // Step 4: Use Perplexity to fill in gaps (run if status is still Unknown OR we have no job count)
  if (perplexityApiKey && (hiring.status === 'Unknown' || hiring.totalJobs === 0)) {
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${perplexityApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.1-sonar-small-128k-online',
          messages: [
            {
              role: 'user',
              content: `How many open jobs does ${companyName} (${domain}) currently have?

IMPORTANT: Search their OFFICIAL careers page, not job boards.

Search these sources in order:
1. Go directly to ${careersUrl || domain + '/careers'} and COUNT the job listings
2. Check for Greenhouse URL: boards.greenhouse.io/${companyName.toLowerCase().replace(/\s+/g, '')}
3. Check for Lever URL: jobs.lever.co/${companyName.toLowerCase().replace(/\s+/g, '')}
4. Check for Ashby URL: jobs.ashbyhq.com/${companyName.toLowerCase().replace(/\s+/g, '')}
5. Search their LinkedIn company page Jobs tab

Count the ACTUAL number of job postings you see. Be specific.
If the careers page says "X open positions" or "Showing X jobs", use that number.

Return JSON only:
{
  "totalJobs": number (count of job listings you found, use 0 only if truly no jobs),
  "nycJobs": number (jobs specifically mentioning NYC/New York),
  "hiringStatus": "Actively Hiring" (10+) or "Selective" (3-10) or "Limited" (1-2) or "No Open Roles" (0),
  "keyRoles": "comma-separated list of 3-5 actual job titles you see",
  "source": "exact URL where you found the jobs"
}`
            },
          ],
          max_tokens: 400,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            // Use Perplexity data if we don't have Firecrawl data
            if (hiring.totalJobs === 0 && parsed.totalJobs > 0) {
              hiring.totalJobs = parsed.totalJobs;
              hiring.nycJobs = parsed.nycJobs || 0;
              hiring.keyRoles = parsed.keyRoles || '';
              if (parsed.source) hiring.source = parsed.source;
            }
            // Always use Perplexity status if current status is Unknown
            if (hiring.status === 'Unknown' && parsed.hiringStatus) {
              hiring.status = parsed.hiringStatus;
            }
          } catch (e) {
            // JSON parse failed
          }
        }
      }
    } catch (e) {
      console.log('Perplexity hiring search failed:', e.message);
    }
  }

  // Final status determination logic
  if (hiring.status === 'Unknown') {
    if (hiring.totalJobs > 20) {
      hiring.status = 'Actively Hiring';
    } else if (hiring.totalJobs > 5) {
      hiring.status = 'Selective';
    } else if (hiring.totalJobs > 0) {
      hiring.status = 'Limited Hiring';
    } else if (careersUrl) {
      // We have a careers URL but couldn't count jobs - likely still hiring
      hiring.status = 'Hiring (unconfirmed)';
    } else {
      hiring.status = 'No Data';
    }
  }

  return hiring;
}

// Agent helper: Generate personalized outreach email
async function generateOutreachEmail(companyName, domain, dossier, apiKey) {
  // Build rich context from all available data
  const contactName = dossier.contacts?.[0]?.name || '';
  const contactTitle = dossier.contacts?.[0]?.title || '';
  const recentNewsItems = (dossier.recentNews || []).slice(0, 2).map(n => `- ${n.title} (${n.newsType || 'News'})`).join('\n');
  const keyRoles = dossier.hiring?.keyRoles || dossier.hiring?.jobListings?.slice(0, 3).map(j => j.title).join(', ') || '';

  const context = `
COMPANY: ${companyName} (${domain})
INDUSTRY: ${dossier.company.industry || 'Tech'}
DESCRIPTION: ${dossier.company.description || 'Technology company'}
EMPLOYEES: ${dossier.company.employeeCount || 'Unknown'}
HEADQUARTERS: ${dossier.company.headquarters || 'Unknown'}
NYC OFFICE: ${dossier.nycIntel?.address || dossier.company.nycAddress || 'Looking for space'}
TOTAL FUNDING: ${dossier.company.totalFunding || 'Unknown'}
TOP INVESTORS: ${dossier.company.topInvestors || 'Unknown'}
HIRING STATUS: ${dossier.hiring?.status || 'Unknown'}
OPEN ROLES: ${dossier.hiring?.totalJobs || 0} total, ${dossier.hiring?.nycJobs || 0} in NYC
KEY ROLES HIRING: ${keyRoles}
CONTACT: ${contactName}${contactTitle ? ` (${contactTitle})` : ''}
RECENT NEWS:
${recentNewsItems || 'No recent news found'}
  `.trim();

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [
        {
          role: 'system',
          content: 'You are an expert commercial real estate broker who specializes in helping tech companies find office space in NYC. Write personalized, conversational cold emails that feel genuine - not salesy. Always reference specific details about the company to show you did your research.'
        },
        {
          role: 'user',
          content: `Write a cold outreach email for this company. Use the intel below to personalize it.

${context}

REQUIREMENTS:
1. Start with a specific hook about their company (pick ONE of these based on what's available):
   - Recent funding round or investors
   - Hiring growth / specific roles they're hiring for
   - Recent news about expansion or product launch
   - Industry-specific angle
2. Briefly mention you help tech companies find office space in NYC
3. Keep it to 3-4 sentences MAX (under 80 words)
4. End with a casual CTA like "Worth a quick chat?" or "Happy to share some options if helpful"
5. Tone: Friendly, helpful, NOT salesy

${contactName ? `Address it to ${contactName}` : 'Use a generic greeting like "Hi there"'}

Return ONLY valid JSON:
{"subject": "short catchy subject line under 8 words", "email": "the email body text"}`,
        },
      ],
      max_tokens: 400,
    }),
  });

  if (!response.ok) {
    console.log('Outreach email API error:', response.status);
    return { email: '' };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Try to parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.email && parsed.subject) {
        return {
          email: `Subject: ${parsed.subject}\n\n${parsed.email}`,
          subject: parsed.subject,
          body: parsed.email
        };
      }
    } catch (e) {
      console.log('Failed to parse outreach email JSON:', e.message);
    }
  }

  // Fallback: if we got text but not JSON, try to use it directly
  if (content && content.length > 20) {
    return { email: content };
  }

  return { email: '' };
}

// Build system prompt for Claude chat with DealFlow context
function buildChatSystemPrompt(context = {}) {
  let prompt = `You are an AI assistant for DealFlow, a commercial real estate broker's CRM and prospecting tool.
Your job is to help the broker be more productive by:
- Drafting personalized outreach emails
- Summarizing company research and dossiers
- Analyzing deals and prospects
- Providing strategic advice on the pipeline
- Answering questions about their data

Be concise, professional, and actionable. When drafting emails, be personalized and avoid generic sales language.
`;

  // Add context about current data
  if (context.deals && context.deals.length > 0) {
    prompt += `\n\nCURRENT PIPELINE: ${context.deals.length} active deals`;
    const byStage = {};
    context.deals.forEach(d => {
      byStage[d.stage] = (byStage[d.stage] || 0) + 1;
    });
    prompt += ` (${Object.entries(byStage).map(([k,v]) => `${k}: ${v}`).join(', ')})`;
  }

  if (context.staleDeals && context.staleDeals.length > 0) {
    prompt += `\n\nATTENTION NEEDED: ${context.staleDeals.length} stale deals require action`;
  }

  if (context.followUps && context.followUps.length > 0) {
    prompt += `\n\nPENDING FOLLOW-UPS: ${context.followUps.length} follow-ups scheduled`;
  }

  // Add current company context if viewing a specific company
  if (context.currentCompany) {
    const c = context.currentCompany;
    prompt += `\n\nCURRENT COMPANY CONTEXT:
Company: ${c.organizationName || 'Unknown'}
Industry: ${c.industry || 'Unknown'}
Employees: ${c.employeeCount || 'Unknown'}
HQ: ${c.headquarters || 'Unknown'}
NYC Address: ${c.nycAddress || 'Not found'}
Funding: ${c.totalFunding || 'Unknown'}
Hiring: ${c.hiringStatus || 'Unknown'}, ${c.totalJobs || '?'} open roles
Last Researched: ${c.lastResearchedAt || 'Never'}`;

    if (context.contacts && context.contacts.length > 0) {
      prompt += `\nKey Contacts: ${context.contacts.map(ct => `${ct.name} (${ct.title})`).join(', ')}`;
    }

    if (c.lastDossier) {
      if (c.lastDossier.recentNews && c.lastDossier.recentNews.length > 0) {
        prompt += `\nRecent News: ${c.lastDossier.recentNews.map(n => n.title).join('; ')}`;
      }
    }
  }

  // Add current deal context if viewing a specific deal
  if (context.currentDeal) {
    const d = context.currentDeal;
    prompt += `\n\nCURRENT DEAL CONTEXT:
Client: ${d.clientName}
Stage: ${d.stage}
Contact: ${d.contactName || 'Unknown'} (${d.contactEmail || 'no email'})
Square Footage: ${d.squareFootage || 'TBD'}
Target Budget: ${d.targetBudget || 'TBD'}
Notes: ${d.notes || 'None'}`;
  }

  // Add current prospect context
  if (context.currentProspect) {
    const p = context.currentProspect;
    prompt += `\n\nCURRENT PROSPECT CONTEXT:
Organization: ${p.organizationName}
CRM Stage: ${p.crmStage}
Contact: ${p.contactName || 'Unknown'}
Status: ${p.prospectStatus || 'Unknown'}`;
  }

  return prompt;
}

// ============ PROSPECT SCORECARD: VC TIER LISTS ============
const VC_TIERS = {
  tier1: [
    'y combinator', 'sequoia capital', 'sequoia', 'andreessen horowitz', 'a16z',
    'accel', 'first round capital', 'first round', 'benchmark', 'kleiner perkins',
    'lightspeed venture partners', 'lightspeed', 'general catalyst', 'founders fund',
    'thrive capital', 'insight partners',
  ],
  tier2: [
    'greylock partners', 'greylock', 'index ventures', 'bessemer venture partners', 'bessemer',
    'khosla ventures', 'nea', 'new enterprise associates', 'boxgroup', 'initialized capital',
    'initialized', 'ribbit capital', 'pear vc', 'floodgate', 'sv angel', 'pioneer fund',
  ],
  tier3: [
    'founder collective', 'cowboy ventures', 'forerunner ventures', 'forerunner',
    'lux capital', '8vc', 'cyberstarts', 'yl ventures', 'soma capital', 'homebrew',
    'antler', 'qed investors', 'qed', 'bonfire ventures',
  ],
};

// ============ PROSPECT SCORECARD: SCORING FUNCTIONS ============

// Dimension 1: Funding Score (0-4)
function calculateFundingScore(lastFundingAmount) {
  const amount = parseFundingToNumber(lastFundingAmount);
  if (amount >= 20000000) return { score: 4, signal: 'Mega-seed / exceptional conviction' };
  if (amount >= 10000000) return { score: 3, signal: 'Large seed, strong institutional backing' };
  if (amount >= 5000000) return { score: 2, signal: 'Solid seed round, at or above median' };
  if (amount >= 3000000) return { score: 1, signal: 'Standard seed, enough runway' };
  return { score: 0, signal: 'Small seed / pre-seed, unproven' };
}

// Dimension 2: Investor Score (0-3)
function calculateInvestorScore(investorString) {
  if (!investorString || investorString === 'Unknown' || investorString === 'Bootstrapped') {
    return { score: 0, signal: 'No top-tier investors', matchedInvestor: null, tier: null };
  }
  const investorsLower = investorString.toLowerCase();

  // Check Tier 1 first
  for (const vc of VC_TIERS.tier1) {
    if (investorsLower.includes(vc)) {
      return { score: 3, signal: `Tier 1 investor: ${vc}`, matchedInvestor: vc, tier: 1 };
    }
  }
  // Check Tier 2
  for (const vc of VC_TIERS.tier2) {
    if (investorsLower.includes(vc)) {
      return { score: 2, signal: `Tier 2 investor: ${vc}`, matchedInvestor: vc, tier: 2 };
    }
  }
  // Check Tier 3
  for (const vc of VC_TIERS.tier3) {
    if (investorsLower.includes(vc)) {
      return { score: 1, signal: `Tier 3 investor: ${vc}`, matchedInvestor: vc, tier: 3 };
    }
  }
  return { score: 0, signal: 'No top-tier investors', matchedInvestor: null, tier: null };
}

// Dimension 3: Founder Pedigree Score (0-3) — evaluated per founder, company gets max
function calculateFounderPedigreeScore(founderProfile) {
  if (!founderProfile) return { score: 0, reason: 'No founder data available' };

  const pedigree = (founderProfile.pedigree || '').toLowerCase();
  const summary = (founderProfile.tldr || '').toLowerCase();
  const career = JSON.stringify(founderProfile.career || []).toLowerCase();

  // Score 3: Serial Founder with Major Exit (>$50M or IPO)
  if (pedigree.includes('serial founder') && (pedigree.includes('exit') || pedigree.includes('ipo') || pedigree.includes('public'))) {
    return { score: 3, reason: founderProfile.pedigreeReason || 'Serial founder with major exit' };
  }
  if (pedigree.includes('major exit') || pedigree.includes('acquired for') || pedigree.includes('went public')) {
    return { score: 3, reason: founderProfile.pedigreeReason || 'Previous company had major exit' };
  }

  // Score 2: Senior FAANG/Big Tech Alumni
  const bigTechCompanies = ['google', 'meta', 'facebook', 'apple', 'amazon', 'microsoft', 'stripe', 'openai', 'netflix', 'uber', 'airbnb', 'linkedin', 'twitter', 'x corp', 'salesforce', 'palantir', 'databricks', 'snowflake'];
  const seniorTitles = ['director', 'staff engineer', 'staff software', 'senior staff', 'principal', 'vp ', 'vice president', 'head of', 'chief'];

  const hasBigTech = bigTechCompanies.some(co => career.includes(co) || summary.includes(co) || pedigree.includes(co));
  const hasSeniorRole = seniorTitles.some(t => career.includes(t) || pedigree.includes(t));

  if (hasBigTech && hasSeniorRole) {
    return { score: 2, reason: founderProfile.pedigreeReason || 'Senior Big Tech alumni' };
  }

  // Score 1: Second-Time Founder
  if (pedigree.includes('second-time') || pedigree.includes('serial') || pedigree.includes('previously founded') || pedigree.includes('former founder') || pedigree.includes('co-founded')) {
    return { score: 1, reason: founderProfile.pedigreeReason || 'Second-time founder' };
  }

  // Score 0: First-Time Founder
  return { score: 0, reason: founderProfile.pedigreeReason || 'First-time founder' };
}

// Helper: Parse funding amount strings to numbers
function parseFundingToNumber(fundingStr) {
  if (!fundingStr) return 0;
  const cleaned = String(fundingStr).replace(/[$,\s]/g, '').toUpperCase();
  let multiplier = 1;
  if (cleaned.includes('B')) multiplier = 1000000000;
  else if (cleaned.includes('M')) multiplier = 1000000;
  else if (cleaned.includes('K')) multiplier = 1000;
  const num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 0 : num * multiplier;
}

// ============ FOUNDER DUE DILIGENCE ============

// Scrape a founder's LinkedIn profile via Firecrawl
async function scrapeFounderLinkedIn(linkedinUrl, firecrawlApiKey) {
  if (!linkedinUrl || !firecrawlApiKey) return null;

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: linkedinUrl,
        formats: ['markdown'],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.data?.markdown || null;
  } catch {
    return null;
  }
}

// Enrich founder data via Apollo People Enrichment
async function enrichFounderApollo(name, companyDomain, apolloApiKey) {
  if (!apolloApiKey || !name) return null;

  try {
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apolloApiKey,
      },
      body: JSON.stringify({
        q_organization_domains: companyDomain,
        person_titles: ['Founder', 'Co-Founder', 'CEO', 'CTO'],
        q_keywords: firstName + ' ' + lastName,
        page: 1,
        per_page: 3,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const person = (data.people || []).find(p =>
      p.name?.toLowerCase().includes(firstName.toLowerCase())
    );
    if (!person) return null;

    return {
      name: person.name,
      title: person.title,
      linkedin: person.linkedin_url,
      email: person.email,
      photo: person.photo_url || null,
      city: person.city,
      state: person.state,
      departments: person.departments,
      seniority: person.seniority,
    };
  } catch {
    return null;
  }
}

// Generate founder insights via Perplexity (TL;DR, talking points, pedigree analysis)
async function generateFounderInsights(founderName, founderTitle, companyName, linkedinMarkdown, perplexityApiKey) {
  if (!perplexityApiKey) return null;

  const linkedinContext = linkedinMarkdown
    ? `\n\nLINKEDIN PROFILE DATA:\n${linkedinMarkdown.slice(0, 3000)}`
    : '';

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${perplexityApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          {
            role: 'system',
            content: 'You are an expert VC analyst performing founder due diligence. Analyze the founder\'s background and return structured JSON. Be precise about career history.',
          },
          {
            role: 'user',
            content: `Analyze this founder for due diligence:

NAME: ${founderName}
TITLE: ${founderTitle}
COMPANY: ${companyName}
${linkedinContext}

Research this person and provide:

1. TL;DR: A 1-2 sentence summary of who they are and why they're notable
2. CAREER HISTORY: List their previous roles (company, title, years if known)
3. EDUCATION: List their degrees (school, degree, field)
4. PEDIGREE CLASSIFICATION: Classify them into EXACTLY ONE of these categories:
   - "Serial Founder w/ Major Exit" — if they sold a previous company for >$50M or took one public
   - "Senior FAANG/Big Tech Alumni" — if they were Director/Staff Engineer+ at Google, Meta, Stripe, OpenAI, Apple, Amazon, Microsoft, etc.
   - "Second-Time Founder" — if they ran a previous startup (even without a major exit)
   - "First-Time Founder" — if no notable prior startup or big tech experience
5. PEDIGREE REASON: One sentence explaining why you chose that classification
6. TALKING POINTS: 3-5 conversation starters based on their background, recent posts, or interests

Return ONLY this JSON:
{
  "tldr": "1-2 sentence summary",
  "career": [{"company": "Company Name", "title": "Job Title", "years": "2019-2023"}],
  "education": [{"school": "University Name", "degree": "BS", "field": "Computer Science"}],
  "pedigree": "Serial Founder w/ Major Exit | Senior FAANG/Big Tech Alumni | Second-Time Founder | First-Time Founder",
  "pedigreeReason": "explanation",
  "talkingPoints": ["point 1", "point 2", "point 3"]
}`,
          },
        ],
        max_tokens: 800,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch {
    return null;
  }
}

// Full Founder DD pipeline: scrape + enrich + insights for one founder
async function performFounderDD(founder, companyName, domain, firecrawlApiKey, apolloApiKey, perplexityApiKey) {
  const profile = {
    name: founder.name,
    title: founder.title,
    linkedin: founder.linkedin || '',
    email: founder.email || '',
    photo: null,
    tldr: '',
    career: [],
    education: [],
    pedigree: 'First-Time Founder',
    pedigreeReason: 'No data available',
    pedigreeScore: 0,
    talkingPoints: [],
  };

  // Step 1: Scrape LinkedIn (if URL available)
  let linkedinMarkdown = null;
  if (founder.linkedin && firecrawlApiKey) {
    linkedinMarkdown = await scrapeFounderLinkedIn(founder.linkedin, firecrawlApiKey);
  }

  // Step 2: Enrich with Apollo
  if (apolloApiKey) {
    const apolloData = await enrichFounderApollo(founder.name, domain, apolloApiKey);
    if (apolloData) {
      profile.email = apolloData.email || profile.email;
      profile.photo = apolloData.photo || profile.photo;
      profile.linkedin = apolloData.linkedin || profile.linkedin;
    }
  }

  // Step 3: Generate insights via Perplexity
  if (perplexityApiKey) {
    const insights = await generateFounderInsights(
      founder.name, founder.title, companyName, linkedinMarkdown, perplexityApiKey
    );
    if (insights) {
      profile.tldr = insights.tldr || '';
      profile.career = insights.career || [];
      profile.education = insights.education || [];
      profile.pedigree = insights.pedigree || 'First-Time Founder';
      profile.pedigreeReason = insights.pedigreeReason || '';
      profile.talkingPoints = insights.talkingPoints || [];
    }
  }

  // Step 4: Calculate pedigree score
  const pedigreeResult = calculateFounderPedigreeScore(profile);
  profile.pedigreeScore = pedigreeResult.score;
  profile.pedigreeReason = pedigreeResult.reason || profile.pedigreeReason;

  return profile;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
