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
          content: `Look up the company with the website domain "${domain}" and give me a factual profile about THAT specific company. Do NOT confuse it with similarly-named companies. Return ONLY valid JSON with these fields: {"companyName": "", "industry": "", "employeeCount": "", "description": "", "headquarters": "", "founded": ""}. Keep description under 150 characters. If you are not sure about a field, leave it as an empty string.`,
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
  if (org.total_funding) results.funding = String(org.total_funding);
  if (org.latest_funding_round_type) results.fundingRound = org.latest_funding_round_type;
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
