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

        // STEP 2: Find Decision Makers
        if (perplexityApiKey) {
          try {
            const contactsData = await fetchDecisionMakers(companyName, domain, perplexityApiKey);
            if (contactsData.contacts) {
              dossier.contacts = contactsData.contacts;
            }
          } catch {}
        }

        // STEP 3: NYC Address Deep Search
        if (tavilyApiKey) {
          try {
            const nycData = await fetchTavilyAddress(companyName, domain, tavilyApiKey);
            dossier.nycIntel = {
              address: nycData.nycAddress || dossier.company.nycAddress || 'Not found',
              confirmed: nycData.nycAddress ? 'Yes' : 'No',
              careersUrl: nycData.careersUrl || dossier.company.careersUrl || '',
            };
          } catch {}
        }

        // STEP 4: Recent News Search
        if (tavilyApiKey) {
          try {
            const newsData = await fetchRecentNews(companyName, tavilyApiKey);
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

        // STEP 6: Generate Outreach Email
        if (perplexityApiKey) {
          try {
            const emailData = await generateOutreachEmail(companyName, domain, dossier, perplexityApiKey);
            dossier.outreachEmail = emailData.email || '';
          } catch {}
        }

        return jsonResponse(dossier);
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
- Company Description: 1-2 sentence summary of their business

2. FINANCIALS & SIZE (High Precision)
- Total Funding: Search Crunchbase, Pitchbook, press releases. Return USD amount like "$50M" or "Undisclosed"
- Lead Investors: List primary VC firms or institutional backers
- Employee Count: Avoid broad ranges. Find specific number from Pitchbook, LinkedIn, or 10-K filings. Format: "approximately [Number]"

3. REAL ESTATE NEWS (Time Sensitive)
- Search: "${domain.split('.')[0]} office lease", "${domain.split('.')[0]} new office NYC", "${domain.split('.')[0]} relocation"
- Only report news from last 6 months relative to ${today}
- If no recent news, state: "No significant office lease news in the last 6 months"

4. HIRING INTELLIGENCE
- Check their careers page or ATS (Ashby, Greenhouse, Lever, Wellfound)
- Hiring Status: Active or Frozen
- Volume: Number of open roles
- Key Roles: List 2-3 specific job titles, prioritize NYC-based roles

Return ONLY this JSON:
{
  "companyName": "",
  "description": "",
  "industry": "",
  "founded": "",
  "headquarters": "",
  "nycAddress": "exact street address or N/A",
  "nycOfficeConfirmed": "Yes/No",
  "employeeCount": "approximately [number]",
  "totalFunding": "",
  "topInvestors": "",
  "lastFundingType": "",
  "lastFundingDate": "",
  "recentLeaseNews": "",
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
    return JSON.parse(jsonMatch[0]);
  }
  return {};
}

async function fetchNYCAddress(companyName, domain, apiKey) {
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
          content: `What is the New York City office address for ${companyName}? Their website is ${domain}.

Search for:
- Their office location on their website's contact page, about page, or footer
- Their address listed on their terms of service or privacy policy page
- Their LinkedIn company page which shows office locations
- Job postings from ${companyName} that mention a NYC office address
- News articles about ${companyName} opening or having a NYC office

Also find their careers page URL.

Respond with JSON only:
{"nycAddress": "full street address with zip code, or empty if not found", "nycOfficeConfirmed": "Yes or No", "careersUrl": "careers page URL"}`,
        },
      ],
      max_tokens: 300,
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
  // Search for NYC office address
  const addressResponse = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${companyName} NYC office address New York location`,
      search_depth: 'advanced',
      include_answer: true,
      max_results: 5
    }),
  });

  if (!addressResponse.ok) throw new Error(`Tavily ${addressResponse.status}`);
  const addressData = await addressResponse.json();

  const results = {};

  // Extract address from Tavily's AI answer
  if (addressData.answer) {
    const addressMatch = addressData.answer.match(/\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Broadway|Road|Rd|Place|Pl|Boulevard|Blvd)[,\s]+(?:Suite|Ste|Floor|Fl|#)?\s*\d*[,\s]*New York[,\s]+NY\s+\d{5}/i);
    if (addressMatch) {
      results.nycAddress = addressMatch[0];
    }
  }

  // Also check search results for addresses
  if (!results.nycAddress && addressData.results) {
    for (const result of addressData.results) {
      const content = result.content || '';
      const addressMatch = content.match(/\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Broadway|Road|Rd|Place|Pl|Boulevard|Blvd)[,\s]+(?:Suite|Ste|Floor|Fl|#)?\s*\d*[,\s]*New York[,\s]+NY\s+\d{5}/i);
      if (addressMatch) {
        results.nycAddress = addressMatch[0];
        break;
      }
    }
  }

  // Search for careers page
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

// Agent helper: Find decision makers
async function fetchDecisionMakers(companyName, domain, apiKey) {
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
          content: `Find the key decision makers at ${companyName} (${domain}) who would be involved in office space decisions.

Look for:
- CEO / Founder
- COO / Chief Operating Officer
- Head of Real Estate / Workplace
- Office Manager / Facilities Manager
- Head of People / HR (they often handle office decisions)

Search LinkedIn, the company website's team/about page, and recent press releases.

Return JSON only:
{
  "contacts": [
    {"name": "Full Name", "title": "Job Title", "linkedin": "linkedin URL if found"},
    {"name": "Full Name", "title": "Job Title", "linkedin": "linkedin URL if found"}
  ]
}

Return up to 3 most relevant contacts. If you can't find anyone, return empty array.`,
        },
      ],
      max_tokens: 400,
    }),
  });

  if (!response.ok) throw new Error(`Perplexity ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return { contacts: [] };
}

// Agent helper: Recent news search via Tavily
async function fetchRecentNews(companyName, apiKey) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${companyName} office lease OR ${companyName} new office OR ${companyName} expansion OR ${companyName} headquarters move`,
      search_depth: 'advanced',
      include_answer: false,
      max_results: 5
    }),
  });

  if (!response.ok) throw new Error(`Tavily ${response.status}`);
  const data = await response.json();

  const articles = (data.results || []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content?.slice(0, 200) || '',
    source: new URL(r.url).hostname,
  }));

  return { articles };
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

      if (scrapeResult.success && scrapeResult.extract) {
        const extract = scrapeResult.extract;
        hiring.source = 'firecrawl';
        firecrawlSuccess = true;

        // Get job listings from structured extraction
        if (extract.jobListings && Array.isArray(extract.jobListings)) {
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

  // Step 4: Use Perplexity to fill in gaps (only if we don't have good data from Firecrawl)
  if (perplexityApiKey && (!firecrawlSuccess || hiring.totalJobs === 0)) {
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
            content: `Find the EXACT number of open jobs at ${companyName} (${domain}).

IMPORTANT: The same job often appears on multiple sites (LinkedIn, Indeed, Glassdoor, company careers page).
I need the DEDUPLICATED count - unique positions only.

Steps:
1. Go to their official careers page: ${careersUrl || domain + '/careers'}
2. Count unique job titles (not duplicate postings)
3. Check their ATS (Greenhouse, Lever, Ashby, Workable) if applicable
4. Identify how many are specifically in New York City / NYC

Return JSON only:
{
  "totalJobs": number (unique positions, not duplicates across job boards),
  "nycJobs": number (positions specifically in NYC/New York),
  "hiringStatus": "Actively Hiring" or "Selective" or "Hiring Freeze" or "Unknown",
  "keyRoles": "comma-separated list of 3-5 notable open positions",
  "source": "where you found this info (careers page URL or ATS name)"
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
        const parsed = JSON.parse(jsonMatch[0]);
        // Only use Perplexity data if we don't have better data from Firecrawl
        if (!firecrawlSuccess) {
          hiring.totalJobs = parsed.totalJobs || hiring.totalJobs;
          hiring.nycJobs = parsed.nycJobs || 0;
          hiring.keyRoles = parsed.keyRoles || '';
          if (parsed.source) hiring.source = parsed.source;
        }
        hiring.status = parsed.hiringStatus || hiring.status;
      }
    }
  }

  // Determine hiring status if still unknown
  if (hiring.status === 'Unknown' && hiring.totalJobs > 0) {
    if (hiring.totalJobs > 20) {
      hiring.status = 'Actively Hiring';
    } else if (hiring.totalJobs > 5) {
      hiring.status = 'Selective';
    } else {
      hiring.status = 'Limited Hiring';
    }
  }

  return hiring;
}

// Agent helper: Generate personalized outreach email
async function generateOutreachEmail(companyName, domain, dossier, apiKey) {
  const context = `
Company: ${companyName}
Industry: ${dossier.company.industry || 'Unknown'}
Employees: ${dossier.company.employeeCount || 'Unknown'}
HQ: ${dossier.company.headquarters || 'Unknown'}
NYC Address: ${dossier.nycIntel?.address || 'Unknown'}
Funding: ${dossier.company.totalFunding || 'Unknown'}
Hiring: ${dossier.hiring?.status || 'Unknown'}, ${dossier.hiring?.totalJobs || '?'} open roles
Recent News: ${dossier.recentNews?.[0]?.title || 'None found'}
Key Contact: ${dossier.contacts?.[0]?.name || 'Unknown'}, ${dossier.contacts?.[0]?.title || ''}
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
          content: 'You are a commercial real estate broker writing cold outreach emails. Be concise, professional, and personalized based on the company intel provided.'
        },
        {
          role: 'user',
          content: `Write a short cold email (3-4 sentences max) to reach out about NYC office space opportunities.

COMPANY INTEL:
${context}

Requirements:
- Reference something specific about their company (funding, growth, hiring, etc.)
- Mention you specialize in NYC office space for tech/startup companies
- Keep it under 100 words
- Don't be salesy, be helpful
- End with a soft CTA (coffee chat, quick call)

Return JSON only:
{"email": "the email text", "subject": "email subject line"}`,
        },
      ],
      max_tokens: 300,
    }),
  });

  if (!response.ok) throw new Error(`Perplexity ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    return { email: `Subject: ${parsed.subject}\n\n${parsed.email}` };
  }
  return { email: '' };
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
