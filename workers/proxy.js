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

      // POST /enrich — accepts { domain, perplexityApiKey, apolloApiKey }
      if (path === '/enrich' && request.method === 'POST') {
        const body = await request.json();
        const { domain, perplexityApiKey, apolloApiKey } = body;

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

        if (perplexityApiKey && (needsAddress || needsCareers)) {
          try {
            const companyName = results.companyName || domain.split('.')[0];
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
          content: `Find the NYC office address and careers page for "${companyName}" (${domain}).

SEARCH THESE SOURCES FOR ADDRESS:
1. site:${domain} "New York" address (check their website contact/about page)
2. site:${domain}/terms OR site:${domain}/privacy (legal pages often have registered addresses)
3. "${companyName}" LinkedIn company page location
4. "${companyName}" Google Maps New York
5. "${companyName}" NYC office job posting location
6. "${companyName}" WeWork OR "${companyName}" coworking NYC

SEARCH THESE FOR CAREERS PAGE:
1. site:${domain}/careers OR site:${domain}/jobs
2. "${companyName}" careers greenhouse OR ashby OR lever OR wellfound

Return ONLY this JSON:
{
  "nycAddress": "exact street address like '123 Broadway, Floor 10, New York, NY 10001' or empty string if not found",
  "nycOfficeConfirmed": "Yes or No",
  "careersUrl": "URL to their careers/jobs page"
}

IMPORTANT: I need a real street address with building number and zip code. Do NOT return just "New York" or "Manhattan".`,
        },
      ],
      max_tokens: 250,
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
