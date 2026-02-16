// DealFlow Cloudflare Worker Proxy
// Routes: /enrich, /agent, /chat
// APIs: Perplexity, Apollo, Exa, Firecrawl

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function corsResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function sseResponse(readable) {
  return new Response(readable, {
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

function sendSSE(writer, encoder, data) {
  writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

// ============ AUTH ============
function checkAuth(request, env) {
  const secret = env.PROXY_SECRET;
  if (!secret) return true; // No secret configured = open access

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  return token === secret;
}

// ============ API HELPERS ============

async function fetchPerplexity(apiKey, companyName, domain, csvData = {}) {
  // Skip investor section if CSV already has investors (Prompt 5C)
  const hasInvestors = csvData.topInvestors || csvData.leadInvestors;

  const investorSection = hasInvestors ? '' : `
3. INVESTORS & FUNDING
- Who are the key investors? Tier breakdown (Tier 1: top 20 VC, Tier 2: known VC, Tier 3: other)
- Recent funding rounds and amounts`;

  const prompt = `Research this company for a NYC commercial real estate broker (tenant representation):

Company: ${companyName}
Domain: ${domain}
${csvData.description ? `Description: ${csvData.description}` : ''}
${csvData.headquarters ? `HQ: ${csvData.headquarters}` : ''}

Provide a JSON response with these sections:

1. COMPANY OVERVIEW
- What does the company do? (1-2 sentences)
- Headquarters location
- Employee count estimate
- Industry/sector
- Founded year

2. NYC PRESENCE
- Do they have a NYC office? If so, where?
- Any expansion plans?
- Remote/hybrid policy
${investorSection}

Return valid JSON:
{
  "description": "...",
  "headquarters": "...",
  "employeeCount": "...",
  "industry": "...",
  "foundedYear": "...",
  "nycOffice": true/false,
  "nycAddress": "...",
  "expansionPlans": "...",
  "workPolicy": "..."${hasInvestors ? '' : `,
  "investors": "...",
  "investorTier": "..."`}
}`;

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`Perplexity API error: ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    return { raw: content };
  }
}

async function fetchApollo(apiKey, domain) {
  // Organization enrichment
  const orgRes = await fetch('https://api.apollo.io/api/v1/organizations/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ domain }),
  });

  let orgData = {};
  if (orgRes.ok) {
    const org = (await orgRes.json()).organization || {};
    orgData = {
      name: org.name,
      description: org.short_description || org.description,
      employeeCount: org.estimated_num_employees,
      industry: org.industry,
      headquarters: org.city && org.state ? `${org.city}, ${org.state}` : '',
      linkedin: org.linkedin_url,
      // Prompt 5F: Removed blog_url -> careersUrl mapping
    };
  }

  // People search — decision makers
  const peopleRes = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({
      organization_domains: [domain],
      person_titles: ['CEO', 'CTO', 'COO', 'CFO', 'VP Real Estate', 'VP Operations', 'Head of Real Estate', 'Facilities', 'Workplace'],
      per_page: 10,
    }),
  });

  let contacts = [];
  if (peopleRes.ok) {
    const people = (await peopleRes.json()).people || [];
    contacts = people.map(p => ({
      name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      title: p.title,
      email: p.email,
      linkedin: p.linkedin_url,
    }));
  }

  return { organization: orgData, contacts };
}

async function fetchExaAddress(apiKey, companyName, domain) {
  // Prompt 5A: Reduced from 5 queries to 2
  const queries = [
    `"${companyName}" office address "New York" OR "NYC" OR "Manhattan"`,
    `"${companyName}" headquarters location New York`,
  ];

  const allResults = [];

  for (const query of queries) {
    try {
      const res = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          query,
          type: 'auto',
          numResults: 5,
          contents: { text: { maxCharacters: 2000 } },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Map Exa fields to match expected format
        const mapped = (data.results || []).map(r => ({
          title: r.title,
          url: r.url,
          content: r.text || '',
          score: r.score,
          published_date: r.publishedDate || '',
        }));
        allResults.push(...mapped);
      }
    } catch {
      // continue on error
    }
  }

  return allResults;
}

async function fetchExaNews(apiKey, companyName, domain) {
  // Prompt 5D: Start with 1 focused query, only run 2nd if <2 results
  const query1 = `"${companyName}" "${domain}" (funding OR expansion OR raised)`;

  // 6 months ago for news recency
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  let results = [];
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: query1,
        type: 'auto',
        numResults: 10,
        category: 'news',
        startPublishedDate: sixMonthsAgo,
        contents: { text: { maxCharacters: 2000 } },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      results = (data.results || []).map(r => ({
        title: r.title,
        url: r.url,
        content: r.text || '',
        score: r.score,
        published_date: r.publishedDate || '',
      }));
    }
  } catch {
    // continue
  }

  // Only run 2nd query if <2 high-confidence results
  if (results.filter(r => r.score > 0.7).length < 2) {
    try {
      const res2 = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          query: `"${companyName}" office lease NYC OR "New York"`,
          type: 'auto',
          numResults: 5,
          category: 'news',
          startPublishedDate: sixMonthsAgo,
          contents: { text: { maxCharacters: 2000 } },
        }),
      });

      if (res2.ok) {
        const data2 = await res2.json();
        const mapped = (data2.results || []).map(r => ({
          title: r.title,
          url: r.url,
          content: r.text || '',
          score: r.score,
          published_date: r.publishedDate || '',
        }));
        results.push(...mapped);
      }
    } catch {
      // continue
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  }).slice(0, 10);
}

async function scrapeWithFirecrawl(apiKey, url) {
  // Prompt 5E: Skip LinkedIn URLs (they block Firecrawl)
  if (url.includes('linkedin.com')) return null;

  try {
    const res = await fetch('https://api.firecrawl.dev/v0/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, pageOptions: { onlyMainContent: true } }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.markdown || data.data?.content || null;
  } catch {
    return null;
  }
}

async function scrapeCareersPage(apiKey, domain) {
  const commonPaths = ['/careers', '/jobs', '/join-us', '/work-with-us'];
  for (const path of commonPaths) {
    const content = await scrapeWithFirecrawl(apiKey, `https://${domain}${path}`);
    if (content && content.length > 100) {
      return { url: `https://${domain}${path}`, content };
    }
  }
  return null;
}

// Prompt 5E: Use Perplexity instead of Firecrawl for LinkedIn research
async function generateFounderInsights(perplexityKey, founder) {
  const prompt = `Research this person for a commercial real estate broker. Search for ${founder.name} on LinkedIn and analyze their career history.

Name: ${founder.name}
${founder.title ? `Title: ${founder.title}` : ''}
${founder.linkedin ? `LinkedIn: ${founder.linkedin}` : ''}

Return JSON:
{
  "background": "2-3 sentence summary of career and expertise",
  "previousCompanies": ["company1", "company2"],
  "relevantInsights": "any real estate, expansion, or office-related insights"
}`;

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${perplexityKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!res.ok) return {};
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    return {};
  }
}

// ============ SCORING ============

// Tier 1 investor list (subset of top VCs)
const TIER1_INVESTORS = [
  'andreessen horowitz', 'a16z', 'sequoia', 'benchmark', 'greylock',
  'accel', 'lightspeed', 'general catalyst', 'index ventures', 'kleiner perkins',
  'bessemer', 'founders fund', 'ggv', 'insight partners', 'tiger global',
  'coatue', 'softbank', 'y combinator', 'yc', 'nea',
];

const TIER2_INVESTORS = [
  'battery ventures', 'canaan', 'first round', 'union square ventures', 'usv',
  'ribbit', 'craft ventures', 'ivp', 'meritech', 'maverick',
  'thrive', 'spark capital', 'redpoint', 'felicis', 'emergence',
];

function calculateInvestorScore(investorString) {
  if (!investorString) return 0;
  const lower = investorString.toLowerCase();

  const hasTier1 = TIER1_INVESTORS.some(inv => lower.includes(inv));
  const hasTier2 = TIER2_INVESTORS.some(inv => lower.includes(inv));

  if (hasTier1) return 3;
  if (hasTier2) return 2;
  if (investorString.trim().length > 0) return 1;
  return 0;
}

function parseFundingAmount(amountStr) {
  if (!amountStr) return 0;
  const str = amountStr.toString().replace(/[$,]/g, '').trim().toUpperCase();
  const match = str.match(/([\d.]+)\s*([BMK])?/);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const suffix = match[2];
  if (suffix === 'B') return num * 1_000_000_000;
  if (suffix === 'M') return num * 1_000_000;
  if (suffix === 'K') return num * 1_000;
  return num;
}

function calculateFundingScore(fundingStr) {
  const amount = parseFundingAmount(fundingStr);
  if (amount >= 50_000_000) return 3; // $50M+ = large, likely needs space
  if (amount >= 10_000_000) return 2; // $10M-$50M = growing
  if (amount > 0) return 1;           // Under $10M = early stage
  return 0;
}

function generateOutreachEmail(companyName, dossier) {
  const hooks = [];
  if (dossier.nycAddress) hooks.push(`I noticed your team at ${dossier.nycAddress}`);
  if (dossier.recentNews) hooks.push(`Congrats on the recent ${dossier.recentNews}`);
  if (dossier.employeeCount) hooks.push(`With your team of ${dossier.employeeCount}`);

  const hook = hooks[0] || `I've been following ${companyName}'s growth`;

  return `Subject: ${companyName} - Office Space Strategy

Hi,

${hook}, I wanted to reach out. I'm a tenant rep broker in NYC specializing in helping VC-backed tech companies find the right space.

I help companies like yours:
- Navigate NYC's complex commercial lease market
- Negotiate favorable terms (we typically save clients 15-25% vs. going direct)
- Find spaces that match your growth trajectory and culture

Would you be open to a quick 15-minute call to discuss your current space situation and any upcoming needs?

Best regards`;
}

// ============ ROUTE HANDLERS ============

async function handleEnrich(request, env) {
  const { domain } = await request.json();
  if (!domain) return corsResponse({ error: 'domain required' }, 400);

  const settings = {
    perplexityKey: env.PERPLEXITY_API_KEY,
    apolloKey: env.APOLLO_API_KEY,
  };

  const results = {};

  if (settings.perplexityKey) {
    results.perplexity = await fetchPerplexity(settings.perplexityKey, domain, domain);
  }

  if (settings.apolloKey) {
    results.apollo = await fetchApollo(settings.apolloKey, domain);
  }

  return corsResponse(results);
}

async function handleAgent(request, env) {
  const { domain, csvData = {} } = await request.json();
  if (!domain) return corsResponse({ error: 'domain required' }, 400);

  const keys = {
    perplexity: env.PERPLEXITY_API_KEY,
    apollo: env.APOLLO_API_KEY,
    exa: env.EXA_API_KEY,
    firecrawl: env.FIRECRAWL_API_KEY,
  };

  const companyName = csvData.organizationName || domain;

  // Set up SSE streaming
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const progress = (step, message) => {
    sendSSE(writer, encoder, { type: 'progress', step, message });
  };

  // Run agent pipeline asynchronously
  (async () => {
    try {
      // Initialize dossier with CSV ground truth (Prompt 2C.2)
      const dossier = {
        company: {
          name: companyName,
          domain,
          description: csvData.description || '',
          headquarters: csvData.headquarters || '',
          foundedYear: csvData.foundedYear || '',
          industries: csvData.industries || '',
          employeeCount: csvData.employeeCount || '',
          linkedin: csvData.linkedin || '',
          crunchbaseUrl: csvData.crunchbaseUrl || '',
          cbRank: csvData.cbRank || '',
        },
        funding: {
          totalFunding: csvData.totalFunding || '',
          lastFundingAmount: csvData.lastFundingAmount || '',
          lastFundingType: csvData.lastFundingType || '',
          lastFundingDate: csvData.lastFundingDate || '',
          fundingRounds: csvData.fundingRounds || '',
          topInvestors: csvData.topInvestors || '',
          leadInvestors: csvData.leadInvestors || '',
        },
        founders: [],
        decisionMakers: [],
        nycAddress: '',
        nycIntel: '',
        news: [],
        hiringIntel: '',
        careersUrl: '',
        outreachEmail: '',
        investorScore: 0,
        fundingScore: 0,
      };

      // STEP 1: Perplexity company overview + Apollo contacts
      progress(1, 'Researching company overview and contacts...');

      const [perplexityData, apolloData] = await Promise.all([
        keys.perplexity ? fetchPerplexity(keys.perplexity, companyName, domain, csvData) : {},
        keys.apollo ? fetchApollo(keys.apollo, domain) : { organization: {}, contacts: [] },
      ]);

      // Merge Perplexity results (but don't overwrite CSV ground truth)
      if (perplexityData.description && !dossier.company.description) {
        dossier.company.description = perplexityData.description;
      }
      if (perplexityData.headquarters && !dossier.company.headquarters) {
        dossier.company.headquarters = perplexityData.headquarters;
      }
      if (perplexityData.employeeCount && !dossier.company.employeeCount) {
        dossier.company.employeeCount = perplexityData.employeeCount;
      }
      if (perplexityData.nycAddress) {
        dossier.nycAddress = perplexityData.nycAddress;
      }
      if (perplexityData.workPolicy) {
        dossier.company.workPolicy = perplexityData.workPolicy;
      }
      if (perplexityData.expansionPlans) {
        dossier.nycIntel = perplexityData.expansionPlans;
      }

      // Merge Apollo org data (don't overwrite CSV)
      const org = apolloData.organization || {};
      if (org.employeeCount && !dossier.company.employeeCount) {
        dossier.company.employeeCount = org.employeeCount;
      }
      if (org.headquarters && !dossier.company.headquarters) {
        dossier.company.headquarters = org.headquarters;
      }
      if (org.linkedin && !dossier.company.linkedin) {
        dossier.company.linkedin = org.linkedin;
      }

      // Re-apply CSV ground truth (Prompt 2C.3)
      if (csvData.topInvestors) dossier.funding.topInvestors = csvData.topInvestors;
      if (csvData.leadInvestors) dossier.funding.leadInvestors = csvData.leadInvestors;
      if (csvData.totalFunding) dossier.funding.totalFunding = csvData.totalFunding;
      if (csvData.lastFundingAmount) dossier.funding.lastFundingAmount = csvData.lastFundingAmount;
      if (csvData.lastFundingType) dossier.funding.lastFundingType = csvData.lastFundingType;
      if (csvData.lastFundingDate) dossier.funding.lastFundingDate = csvData.lastFundingDate;
      if (csvData.foundedYear) dossier.company.foundedYear = csvData.foundedYear;
      if (csvData.headquarters) dossier.company.headquarters = csvData.headquarters;

      dossier.decisionMakers = apolloData.contacts || [];

      // STEP 2: Founder due diligence (Prompt 2C.4)
      progress(2, 'Researching founders...');

      // Parse CSV founders first
      if (csvData.founders) {
        const founderNames = csvData.founders.split(',').map(n => n.trim()).filter(Boolean);
        dossier.founders = founderNames.map(name => {
          // Match against Apollo contacts
          const match = dossier.decisionMakers.find(c =>
            c.name.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(c.name.split(' ')[0]?.toLowerCase())
          );
          return {
            name,
            title: match?.title || 'Co-Founder',
            email: match?.email || '',
            linkedin: match?.linkedin || '',
          };
        });
      } else {
        // Fall back to contact-based founder discovery
        const founderContacts = dossier.decisionMakers.filter(c =>
          c.title && /founder|ceo|co-founder/i.test(c.title)
        );
        dossier.founders = founderContacts.map(c => ({
          name: c.name,
          title: c.title,
          email: c.email,
          linkedin: c.linkedin,
        }));
      }

      // Get founder insights via Perplexity (Prompt 5E: not Firecrawl for LinkedIn)
      if (keys.perplexity && dossier.founders.length > 0) {
        const founderInsights = await Promise.all(
          dossier.founders.slice(0, 3).map(f => generateFounderInsights(keys.perplexity, f))
        );
        dossier.founders = dossier.founders.map((f, i) => ({
          ...f,
          background: founderInsights[i]?.background || '',
          previousCompanies: founderInsights[i]?.previousCompanies || [],
        }));
      }

      // STEP 3: NYC address research
      progress(3, 'Searching for NYC office address...');

      if (keys.exa && !dossier.nycAddress) {
        const addressResults = await fetchExaAddress(keys.exa, companyName, domain);
        // Extract address from results
        for (const result of addressResults) {
          const content = (result.content || '').toLowerCase();
          // Look for NYC address patterns
          const nycMatch = content.match(/\d+\s+[\w\s]+(?:street|st|avenue|ave|broadway|park|way|place|pl)\s*,?\s*(?:new york|nyc|manhattan|brooklyn)/i);
          if (nycMatch) {
            dossier.nycAddress = nycMatch[0].trim();
            break;
          }
        }

        // Use Perplexity as fallback only if Exa found nothing
        if (!dossier.nycAddress && keys.perplexity && perplexityData.nycAddress) {
          dossier.nycAddress = perplexityData.nycAddress;
        }
      }

      // STEP 4: News search
      progress(4, 'Searching for recent news...');

      if (keys.exa) {
        const newsResults = await fetchExaNews(keys.exa, companyName, domain);
        dossier.news = newsResults.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.content?.slice(0, 200),
          date: r.published_date || '',
          score: r.score,
          type: classifyNewsType(r.title + ' ' + (r.content || '')),
        }));

        // Find most recent notable news for outreach
        const fundingNews = dossier.news.find(n => n.type === 'Funding');
        if (fundingNews) dossier.recentNews = fundingNews.title;
      }

      // STEP 5: Hiring intelligence (Firecrawl careers page)
      progress(5, 'Analyzing hiring activity...');

      if (keys.firecrawl) {
        const careers = await scrapeCareersPage(keys.firecrawl, domain);
        if (careers) {
          dossier.careersUrl = careers.url;
          // Parse job listings from careers page
          const content = careers.content;
          const nycJobs = (content.match(/new york|nyc|manhattan/gi) || []).length;
          const totalJobs = (content.match(/\bjob\b|\bposition\b|\brole\b|\bopening\b/gi) || []).length;
          dossier.hiringIntel = `Found careers page with ~${totalJobs} mentions of open roles, ${nycJobs} NYC-related.`;
        }
      }

      // STEP 6: Generate outreach email
      progress(6, 'Generating outreach email...');
      dossier.outreachEmail = generateOutreachEmail(companyName, dossier);

      // STEP 7: Scorecard (Prompt 2C.5)
      progress(7, 'Calculating scores...');

      // Use CSV investors first for scoring
      const investorSource = csvData.topInvestors || csvData.leadInvestors ||
                             dossier.funding.topInvestors || dossier.funding.leadInvestors || '';
      dossier.investorScore = calculateInvestorScore(investorSource);

      // Use CSV funding first for scoring
      const fundingSource = csvData.lastFundingAmount || csvData.totalFunding ||
                            dossier.funding.lastFundingAmount || dossier.funding.totalFunding || '';
      dossier.fundingScore = calculateFundingScore(fundingSource);

      // Send final result
      sendSSE(writer, encoder, { type: 'result', data: dossier });
      sendSSE(writer, encoder, '[DONE]');
    } catch (err) {
      sendSSE(writer, encoder, { type: 'error', message: err.message });
    } finally {
      writer.close();
    }
  })();

  return sseResponse(readable);
}

function classifyNewsType(text) {
  const lower = text.toLowerCase();
  if (/funding|raised|series [a-z]|round|investment|capital/i.test(lower)) return 'Funding';
  if (/expan|office|lease|headquarter|relocat|move/i.test(lower)) return 'Expansion';
  if (/hire|hiring|recruit|team|headcount|grew/i.test(lower)) return 'Hiring';
  if (/launch|product|feature|release/i.test(lower)) return 'Product';
  if (/partnership|partner|integrat|collaborat/i.test(lower)) return 'Partnership';
  return 'News';
}

async function handleChat(request, env) {
  const { messages } = await request.json();

  if (!env.PERPLEXITY_API_KEY) {
    return corsResponse({ error: 'Perplexity API key not configured' }, 500);
  }

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        {
          role: 'system',
          content: 'You are a research assistant for a NYC commercial real estate broker specializing in tenant representation for VC-backed tech startups. Provide concise, actionable insights.',
        },
        ...messages,
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    return corsResponse({ error: `Perplexity error: ${res.status}` }, res.status);
  }

  const data = await res.json();
  return corsResponse({
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  });
}

// ============ MAIN HANDLER ============

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Auth check (Prompt 4B)
    if (!checkAuth(request, env)) {
      return corsResponse({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/enrich' && request.method === 'POST') {
        return await handleEnrich(request, env);
      }

      if (path === '/agent' && request.method === 'POST') {
        return await handleAgent(request, env);
      }

      if (path === '/chat' && request.method === 'POST') {
        return await handleChat(request, env);
      }

      // Health check
      if (path === '/' || path === '/health') {
        return corsResponse({ status: 'ok', routes: ['/enrich', '/agent', '/chat'] });
      }

      return corsResponse({ error: 'Not found' }, 404);
    } catch (err) {
      return corsResponse({ error: err.message }, 500);
    }
  },
};
