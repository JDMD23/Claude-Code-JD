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

        // If no NYC address found, do a follow-up search specifically for NYC address
        if (perplexityApiKey && (!results.nycAddress || results.nycAddress === '' || results.nycAddress === 'Unknown')) {
          try {
            const companyName = results.companyName || domain.split('.')[0];
            const addressData = await fetchNYCAddress(companyName, domain, perplexityApiKey);
            if (addressData.nycAddress && addressData.nycAddress !== 'Unknown') {
              results.nycAddress = addressData.nycAddress;
              if (addressData.nycOfficeConfirmed) results.nycOfficeConfirmed = addressData.nycOfficeConfirmed;
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
          content: `I'm a commercial real estate broker researching the company at domain "${domain}" for a potential NYC office space deal. Look up this EXACT company (not similarly named ones) and return ONLY valid JSON with these fields:

{
  "companyName": "",
  "description": "one sentence about what the company does",
  "industry": "",
  "founded": "",
  "headquarters": "HQ street address or city, state if exact address unknown",
  "employeeCount": "number or estimate",
  "nycAddress": "exact NYC street address like '123 Broadway, New York, NY 10001' or empty if unknown",
  "nycOfficeConfirmed": "Yes or No or Unknown",
  "workPolicyQuote": "remote, hybrid, or in-office based on job listings or press",
  "totalJobs": "approximate open positions",
  "nycJobs": "approximate NYC-based open positions",
  "departmentsHiring": "e.g. Engineering, Sales, Operations",
  "totalFunding": "total funding raised in USD",
  "lastFundingAmount": "most recent round amount",
  "lastFundingType": "e.g. Series A, Series B, Seed",
  "lastFundingDate": "approximate date of last round",
  "topInvestors": "key investors",
  "linkedinUrl": "company linkedin URL",
  "careersUrl": "careers page URL",
  "keyContacts": "CEO/founder names"
}

If unsure about a field leave it as empty string. Return ONLY the JSON object, no other text.`,
        },
      ],
      max_tokens: 600,
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
          content: `Search the web for: "${companyName}" NYC office address OR "${companyName}" New York office location OR "${companyName}" Manhattan office

I need the EXACT street address of their New York City office. Look for:
- Their website contact/location page
- LinkedIn company page
- Job postings mentioning NYC office
- News articles about their NYC location
- WeWork/coworking listings

Return ONLY valid JSON:
{"nycAddress": "exact street address like '123 Main St, Floor 5, New York, NY 10001' or empty if not found", "nycOfficeConfirmed": "Yes or No"}

I need a real street address with building number. Do not return just "New York" or "Manhattan" - I need the full address.`,
        },
      ],
      max_tokens: 200,
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
