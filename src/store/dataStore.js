// DealFlow Data Store - Persists to localStorage
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEYS = {
  DEALS: 'dealflow_deals',
  PROSPECTS: 'dealflow_prospects',
  MASTER_LIST: 'dealflow_master_list',
  COMMISSIONS: 'dealflow_commissions',
  CONTACTS: 'dealflow_contacts',
  FOLLOWUPS: 'dealflow_followups',
  ACTIVITY_LOG: 'dealflow_activity',
  SETTINGS: 'dealflow_settings',
};

const DEFAULT_SETTINGS = {
  proxyUrl: '',
  proxySecret: '',
  perplexityApiKey: '',
  apolloApiKey: '',
  exaApiKey: '',
  firecrawlApiKey: '',
  autoEnrich: false,
};

// Helper to load from localStorage
function loadData(key, defaultValue = []) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (e) {
    console.error(`Error loading ${key}:`, e);
    return defaultValue;
  }
}

// Helper to save to localStorage
function saveData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Error saving ${key}:`, e);
  }
}

// Deal Pipeline Stages
export const DEAL_STAGES = [
  { id: 'kickoff', name: 'Kick-off / Market Analysis' },
  { id: 'touring', name: 'Space Touring' },
  { id: 'loi', name: 'LOI' },
  { id: 'negotiation', name: 'Lease Negotiation' },
  { id: 'consent', name: 'Consent' },
  { id: 'closed', name: 'Closed' },
];

// Prospect CRM Stages
export const PROSPECT_STAGES = [
  { id: 'clients', name: 'Clients' },
  { id: 'meetings', name: 'Meetings to Schedule' },
  { id: 'top_prospects', name: 'Top Prospects (contact established)' },
  { id: 'top_pursuits', name: 'Top Pursuits (no contact)' },
  { id: 'secondary', name: 'Secondary Prospects' },
];

// Commission Statuses
export const COMMISSION_STATUSES = [
  { id: 'projected', name: 'Projected' },
  { id: 'in_contract', name: 'In Contract' },
  { id: 'closed', name: 'Closed' },
  { id: 'paid', name: 'Paid' },
];

// ============ SETTINGS ============
export function getSettings() {
  const stored = loadData(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  // Merge with defaults so new keys (e.g. exaApiKey) are always present
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  // Migrate: remove dead tavilyApiKey if leftover
  delete merged.tavilyApiKey;
  return merged;
}

export function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  saveData(STORAGE_KEYS.SETTINGS, merged);
  return merged;
}

// ============ DEALS ============
export function getDeals() {
  return loadData(STORAGE_KEYS.DEALS, []);
}

export function saveDeal(deal) {
  const deals = getDeals();
  const now = new Date().toISOString();

  if (deal.id) {
    // Update existing deal
    const index = deals.findIndex(d => d.id === deal.id);
    if (index !== -1) {
      deals[index] = { ...deals[index], ...deal, updatedAt: now };
    }
  } else {
    // Create new deal
    const newDeal = {
      ...deal,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      stageHistory: [{ stage: deal.stage || 'kickoff', date: now }],
    };
    deals.push(newDeal);
    logActivity('deal_created', `New deal created: ${deal.clientName}`);
  }

  saveData(STORAGE_KEYS.DEALS, deals);
  return deals;
}

export function updateDealStage(dealId, newStage) {
  const deals = getDeals();
  const deal = deals.find(d => d.id === dealId);
  if (deal) {
    const now = new Date().toISOString();
    deal.stage = newStage;
    deal.stageHistory = deal.stageHistory || [];
    deal.stageHistory.push({ stage: newStage, date: now });
    deal.updatedAt = now;
    saveData(STORAGE_KEYS.DEALS, deals);
    logActivity('deal_moved', `${deal.clientName} moved to ${DEAL_STAGES.find(s => s.id === newStage)?.name}`);
  }
  return deals;
}

export function deleteDeal(dealId) {
  const deals = getDeals().filter(d => d.id !== dealId);
  saveData(STORAGE_KEYS.DEALS, deals);
  return deals;
}

// ============ MASTER LIST ============
export function getMasterList() {
  return loadData(STORAGE_KEYS.MASTER_LIST, []);
}

export function saveMasterList(companies) {
  saveData(STORAGE_KEYS.MASTER_LIST, companies);
  logActivity('master_list_updated', `Master list updated with ${companies.length} companies`);
  return companies;
}

// Normalize a URL for dedup: strip protocol, www, trailing slash
function normalizeUrl(url) {
  if (!url) return '';
  return url.replace(/https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').toLowerCase().trim();
}

export function addToMasterList(companies) {
  const existing = getMasterList();

  // Build a set of existing keys for dedup
  const existingKeys = new Set();
  for (const c of existing) {
    const website = normalizeUrl(c.website);
    const name = (c.organizationName || '').toLowerCase().trim();
    if (website) existingKeys.add(`url:${website}`);
    if (name) existingKeys.add(`name:${name}`);
  }

  const added = [];
  let skipped = 0;

  for (const c of companies) {
    const website = normalizeUrl(c.website);
    const name = (c.organizationName || '').toLowerCase().trim();
    const isDupe = (website && existingKeys.has(`url:${website}`)) ||
                   (name && existingKeys.has(`name:${name}`));

    if (isDupe) {
      skipped++;
    } else {
      const newCompany = { ...c, id: c.id || uuidv4(), addedAt: new Date().toISOString() };
      added.push(newCompany);
      if (website) existingKeys.add(`url:${website}`);
      if (name) existingKeys.add(`name:${name}`);
    }
  }

  const updated = [...existing, ...added];
  saveData(STORAGE_KEYS.MASTER_LIST, updated);
  logActivity('companies_imported', `${added.length} companies imported to Master List (${skipped} duplicates skipped)`);
  return { companies: updated, added: added.length, skipped };
}

export function deleteCompaniesFromMasterList(companyIds) {
  const idSet = new Set(companyIds);
  const companies = getMasterList().filter(c => !idSet.has(c.id));
  saveData(STORAGE_KEYS.MASTER_LIST, companies);

  // Cascading delete: contacts and follow-ups tied to these companies
  const contacts = getContacts().filter(c => !idSet.has(c.companyId));
  saveData(STORAGE_KEYS.CONTACTS, contacts);
  const followUps = getFollowUps().filter(f => !idSet.has(f.companyId));
  saveData(STORAGE_KEYS.FOLLOWUPS, followUps);

  logActivity('companies_deleted', `${companyIds.length} companies removed from Master List`);
  return companies;
}

// ============ CONTACTS ============
export function getContacts() {
  return loadData(STORAGE_KEYS.CONTACTS, []);
}

export function saveContact(contact) {
  const contacts = getContacts();
  const now = new Date().toISOString();

  if (contact.id && contacts.find(c => c.id === contact.id)) {
    const index = contacts.findIndex(c => c.id === contact.id);
    contacts[index] = { ...contacts[index], ...contact, updatedAt: now };
  } else {
    contacts.push({ ...contact, id: contact.id || uuidv4(), addedAt: now, updatedAt: now });
  }

  saveData(STORAGE_KEYS.CONTACTS, contacts);
  return contacts;
}

// ============ PROSPECTS ============
export function getProspects() {
  return loadData(STORAGE_KEYS.PROSPECTS, []);
}

export function saveProspect(prospect) {
  const prospects = getProspects();
  const now = new Date().toISOString();

  if (prospect.id && prospects.find(p => p.id === prospect.id)) {
    // Update existing
    const index = prospects.findIndex(p => p.id === prospect.id);
    prospects[index] = { ...prospects[index], ...prospect, updatedAt: now };
  } else {
    // Add new
    const newProspect = {
      ...prospect,
      id: prospect.id || uuidv4(),
      addedAt: now,
      updatedAt: now,
      notes: prospect.notes || [],
      followUps: prospect.followUps || [],
    };
    prospects.push(newProspect);
    logActivity('prospect_added', `${prospect.organizationName} added to CRM`);
  }

  saveData(STORAGE_KEYS.PROSPECTS, prospects);
  return prospects;
}

export function updateProspectStage(prospectId, newStage) {
  const prospects = getProspects();
  const prospect = prospects.find(p => p.id === prospectId);
  if (prospect) {
    prospect.crmStage = newStage;
    prospect.updatedAt = new Date().toISOString();
    saveData(STORAGE_KEYS.PROSPECTS, prospects);
    logActivity('prospect_moved', `${prospect.organizationName} moved to ${PROSPECT_STAGES.find(s => s.id === newStage)?.name}`);
  }
  return prospects;
}

export function addProspectNote(prospectId, note) {
  const prospects = getProspects();
  const prospect = prospects.find(p => p.id === prospectId);
  if (prospect) {
    prospect.notes = prospect.notes || [];
    prospect.notes.unshift({
      id: uuidv4(),
      text: note,
      createdAt: new Date().toISOString(),
    });
    prospect.updatedAt = new Date().toISOString();
    saveData(STORAGE_KEYS.PROSPECTS, prospects);
  }
  return prospects;
}

export function deleteProspect(prospectId) {
  const prospects = getProspects().filter(p => p.id !== prospectId);
  saveData(STORAGE_KEYS.PROSPECTS, prospects);
  return prospects;
}

// ============ COMMISSIONS ============
export function getCommissions() {
  return loadData(STORAGE_KEYS.COMMISSIONS, []);
}

export function saveCommission(commission) {
  const commissions = getCommissions();
  const now = new Date().toISOString();

  // Calculate commission amount
  const sqft = parseFloat(commission.squareFootage) || 0;
  const annualRent = parseFloat(commission.annualRent) || 0;
  const termYears = (parseFloat(commission.leaseTerm) || 0) / 12;
  const rate = (parseFloat(commission.commissionRate) || 0) / 100;
  const calculatedAmount = sqft * annualRent * termYears * rate;

  if (commission.id) {
    const index = commissions.findIndex(c => c.id === commission.id);
    if (index !== -1) {
      commissions[index] = {
        ...commissions[index],
        ...commission,
        calculatedAmount,
        updatedAt: now
      };
    }
  } else {
    commissions.push({
      ...commission,
      id: uuidv4(),
      calculatedAmount,
      createdAt: now,
      updatedAt: now,
    });
    logActivity('commission_added', `Commission added for ${commission.clientName}`);
  }

  saveData(STORAGE_KEYS.COMMISSIONS, commissions);
  return commissions;
}

export function deleteCommission(commissionId) {
  const commissions = getCommissions().filter(c => c.id !== commissionId);
  saveData(STORAGE_KEYS.COMMISSIONS, commissions);
  return commissions;
}

// ============ FOLLOW-UPS ============
export function getFollowUps() {
  return loadData(STORAGE_KEYS.FOLLOWUPS, []);
}

export function saveFollowUp(followUp) {
  const followUps = getFollowUps();
  const now = new Date().toISOString();

  if (followUp.id) {
    const index = followUps.findIndex(f => f.id === followUp.id);
    if (index !== -1) {
      followUps[index] = { ...followUps[index], ...followUp, updatedAt: now };
    }
  } else {
    followUps.push({
      ...followUp,
      id: uuidv4(),
      createdAt: now,
      completed: false,
    });
  }

  saveData(STORAGE_KEYS.FOLLOWUPS, followUps);
  return followUps;
}

export function completeFollowUp(followUpId) {
  const followUps = getFollowUps();
  const followUp = followUps.find(f => f.id === followUpId);
  if (followUp) {
    followUp.completed = true;
    followUp.completedAt = new Date().toISOString();
    saveData(STORAGE_KEYS.FOLLOWUPS, followUps);
    logActivity('followup_completed', `Follow-up completed for ${followUp.companyName}`);
  }
  return followUps;
}

export function deleteFollowUp(followUpId) {
  const followUps = getFollowUps().filter(f => f.id !== followUpId);
  saveData(STORAGE_KEYS.FOLLOWUPS, followUps);
  return followUps;
}

// ============ ACTIVITY LOG ============
export function getActivityLog() {
  return loadData(STORAGE_KEYS.ACTIVITY_LOG, []);
}

export function logActivity(type, message) {
  const activities = getActivityLog();
  activities.unshift({
    id: uuidv4(),
    type,
    message,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 100 activities
  const trimmed = activities.slice(0, 100);
  saveData(STORAGE_KEYS.ACTIVITY_LOG, trimmed);
  return trimmed;
}

// ============ RESEARCH AGENT ============
function getProxyHeaders() {
  const settings = getSettings();
  const headers = { 'Content-Type': 'application/json' };
  if (settings.proxySecret) {
    headers['Authorization'] = `Bearer ${settings.proxySecret}`;
  }
  return headers;
}

export async function enrichCompany(domain) {
  const settings = getSettings();
  if (!settings.proxyUrl) throw new Error('Proxy URL not configured. Go to Settings.');

  const res = await fetch(`${settings.proxyUrl}/enrich`, {
    method: 'POST',
    headers: getProxyHeaders(),
    body: JSON.stringify({ domain }),
  });

  if (!res.ok) throw new Error(`Enrich failed: ${res.status}`);
  return res.json();
}

export async function runResearchAgent(domain, onProgress = () => {}, companyData = {}) {
  const settings = getSettings();
  if (!settings.proxyUrl) throw new Error('Proxy URL not configured. Go to Settings.');

  const csvData = {
    organizationName: companyData.organizationName,
    description: companyData.description,
    founders: companyData.founders,
    topInvestors: companyData.topInvestors,
    leadInvestors: companyData.leadInvestors,
    totalFunding: companyData.totalFunding,
    lastFundingAmount: companyData.lastFundingAmount,
    lastFundingType: companyData.lastFundingType,
    lastFundingDate: companyData.lastFundingDate,
    foundedYear: companyData.foundedYear,
    headquarters: companyData.headquarters,
    industries: companyData.industries,
    linkedin: companyData.linkedin,
    crunchbaseUrl: companyData.crunchbaseUrl,
    employeeCount: companyData.employeeCount,
    cbRank: companyData.cbRank,
    fundingRounds: companyData.fundingRounds,
  };

  const res = await fetch(`${settings.proxyUrl}/agent`, {
    method: 'POST',
    headers: getProxyHeaders(),
    body: JSON.stringify({ domain, csvData }),
  });

  if (!res.ok) throw new Error(`Agent failed: ${res.status}`);

  // Handle streaming progress
  const reader = res.body?.getReader();
  if (!reader) return res.json();

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'progress') {
          onProgress(parsed);
        } else if (parsed.type === 'result') {
          finalResult = parsed.data;
        }
      } catch {
        // skip unparseable lines
      }
    }
  }

  return finalResult;
}

export async function sendChatMessage(messages) {
  const settings = getSettings();
  if (!settings.proxyUrl) throw new Error('Proxy URL not configured. Go to Settings.');

  const res = await fetch(`${settings.proxyUrl}/chat`, {
    method: 'POST',
    headers: getProxyHeaders(),
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  return res.json();
}

// ============ DASHBOARD STATS ============
export function getDashboardStats() {
  const deals = getDeals();
  const prospects = getProspects();
  const commissions = getCommissions();
  const followUps = getFollowUps();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const weekFromNow = new Date(today);
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  // Follow-up stats
  const pendingFollowUps = followUps.filter(f => !f.completed);
  const overdueFollowUps = pendingFollowUps.filter(f => new Date(f.dueDate) < today);
  const todayFollowUps = pendingFollowUps.filter(f => f.dueDate?.split('T')[0] === todayStr);
  const thisWeekFollowUps = pendingFollowUps.filter(f => {
    const dueDate = new Date(f.dueDate);
    return dueDate >= today && dueDate <= weekFromNow;
  });

  // Deal stats by stage
  const dealsByStage = DEAL_STAGES.reduce((acc, stage) => {
    acc[stage.id] = deals.filter(d => d.stage === stage.id).length;
    return acc;
  }, {});

  // Commission stats
  const projectedCommissions = commissions
    .filter(c => c.status === 'projected' || c.status === 'in_contract')
    .reduce((sum, c) => sum + (c.calculatedAmount || 0), 0);

  const closedCommissions = commissions
    .filter(c => c.status === 'closed')
    .reduce((sum, c) => sum + (c.calculatedAmount || 0), 0);

  const paidCommissions = commissions
    .filter(c => c.status === 'paid')
    .reduce((sum, c) => sum + (c.calculatedAmount || 0), 0);

  // Prospect stats
  const hotProspects = prospects.filter(p => p.prospectStatus === '🔥 Hot Prospect').length;

  return {
    deals: {
      total: deals.length,
      byStage: dealsByStage,
      closedThisMonth: deals.filter(d => {
        if (d.stage !== 'closed') return false;
        const closedDate = d.stageHistory?.find(h => h.stage === 'closed')?.date;
        if (!closedDate) return false;
        const date = new Date(closedDate);
        return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
      }).length,
    },
    prospects: {
      total: prospects.length,
      hotProspects,
      byStage: PROSPECT_STAGES.reduce((acc, stage) => {
        acc[stage.id] = prospects.filter(p => p.crmStage === stage.id).length;
        return acc;
      }, {}),
    },
    commissions: {
      projected: projectedCommissions,
      closed: closedCommissions,
      paid: paidCommissions,
      pipeline: projectedCommissions + closedCommissions,
    },
    followUps: {
      overdue: overdueFollowUps.length,
      today: todayFollowUps.length,
      thisWeek: thisWeekFollowUps.length,
      overdueList: overdueFollowUps.slice(0, 5),
      todayList: todayFollowUps.slice(0, 5),
      thisWeekList: thisWeekFollowUps.slice(0, 10),
    },
    recentActivity: getActivityLog().slice(0, 10),
  };
}
