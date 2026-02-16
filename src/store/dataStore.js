// DealFlow Data Store - Persists to localStorage
import { v4 as uuidv4 } from 'uuid';

// Research Agent step descriptions for progress UI
export const AGENT_STEPS = [
  { step: 1, label: 'Company Overview', description: 'Gathering company info from Perplexity + Apollo' },
  { step: 2, label: 'Decision Makers', description: 'Finding key contacts for office space decisions' },
  { step: 3, label: 'NYC Address Search', description: 'Deep search for exact NYC office address' },
  { step: 4, label: 'Recent News', description: 'Searching for recent office/lease news' },
  { step: 5, label: 'Hiring Intelligence', description: 'Analyzing hiring activity and roles' },
  { step: 6, label: 'Outreach Email', description: 'Generating personalized cold email' },
];

const STORAGE_KEYS = {
  DEALS: 'dealflow_deals',
  PROSPECTS: 'dealflow_prospects',
  MASTER_LIST: 'dealflow_master_list',
  COMMISSIONS: 'dealflow_commissions',
  FOLLOWUPS: 'dealflow_followups',
  ACTIVITY_LOG: 'dealflow_activity',
  LEASES: 'dealflow_leases',
  SETTINGS: 'dealflow_settings',
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

export function addToMasterList(companies) {
  const existing = getMasterList();
  const newCompanies = companies.map(c => ({
    ...c,
    id: c.id || uuidv4(),
    addedAt: new Date().toISOString(),
  }));
  const updated = [...existing, ...newCompanies];
  saveData(STORAGE_KEYS.MASTER_LIST, updated);
  logActivity('companies_imported', `${companies.length} companies imported to Master List`);
  return updated;
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

// ============ LEASES ============
export function getLeases() {
  return loadData(STORAGE_KEYS.LEASES, []);
}

export function saveLease(lease) {
  const leases = getLeases();
  const now = new Date().toISOString();

  if (lease.id) {
    const index = leases.findIndex(l => l.id === lease.id);
    if (index !== -1) {
      leases[index] = { ...leases[index], ...lease, updatedAt: now };
    }
  } else {
    leases.push({
      ...lease,
      id: uuidv4(),
      uploadedAt: now,
      status: 'ready',
    });
    logActivity('lease_uploaded', `Lease document uploaded: ${lease.name}`);
  }

  saveData(STORAGE_KEYS.LEASES, leases);
  return leases;
}

export function deleteLease(leaseId) {
  const leases = getLeases().filter(l => l.id !== leaseId);
  saveData(STORAGE_KEYS.LEASES, leases);
  return leases;
}

// ============ CLAUSE REPOSITORY ============
const STORAGE_CLAUSE_KEY = 'dealflow_clauses';

export const CLAUSE_CATEGORIES = [
  { id: 'rent', name: 'Rent & Escalations' },
  { id: 'term', name: 'Term & Renewal' },
  { id: 'improvements', name: 'Tenant Improvements' },
  { id: 'sublease', name: 'Sublease & Assignment' },
  { id: 'maintenance', name: 'Maintenance & Repairs' },
  { id: 'insurance', name: 'Insurance & Indemnity' },
  { id: 'default', name: 'Default & Remedies' },
  { id: 'other', name: 'Other' },
];

export function getClauses() {
  return loadData(STORAGE_CLAUSE_KEY, []);
}

export function saveClause(clause) {
  const clauses = getClauses();
  const now = new Date().toISOString();

  if (clause.id) {
    const index = clauses.findIndex(c => c.id === clause.id);
    if (index !== -1) {
      clauses[index] = { ...clauses[index], ...clause, updatedAt: now };
    }
  } else {
    clauses.push({
      ...clause,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    });
  }

  saveData(STORAGE_CLAUSE_KEY, clauses);
  return clauses;
}

export function deleteClause(clauseId) {
  const clauses = getClauses().filter(c => c.id !== clauseId);
  saveData(STORAGE_CLAUSE_KEY, clauses);
  return clauses;
}

// ============ PIPELINE VELOCITY ============
export function getPipelineVelocity() {
  const deals = getDeals();
  if (deals.length === 0) return null;

  // Calculate avg days per stage
  const stageTimings = {};
  DEAL_STAGES.forEach(s => { stageTimings[s.id] = []; });

  deals.forEach(deal => {
    if (!deal.stageHistory || deal.stageHistory.length < 2) return;
    for (let i = 1; i < deal.stageHistory.length; i++) {
      const prev = deal.stageHistory[i - 1];
      const curr = deal.stageHistory[i];
      const days = Math.floor((new Date(curr.date) - new Date(prev.date)) / 86400000);
      if (stageTimings[prev.stage]) {
        stageTimings[prev.stage].push(days);
      }
    }
  });

  const avgDaysPerStage = {};
  DEAL_STAGES.forEach(s => {
    const times = stageTimings[s.id];
    avgDaysPerStage[s.id] = times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : null;
  });

  // Total avg cycle time (deals that reached closed)
  const closedDeals = deals.filter(d => d.stage === 'closed' && d.stageHistory?.length >= 2);
  let avgCycleTime = null;
  if (closedDeals.length > 0) {
    const cycleTimes = closedDeals.map(d => {
      const first = new Date(d.stageHistory[0].date);
      const last = new Date(d.stageHistory[d.stageHistory.length - 1].date);
      return Math.floor((last - first) / 86400000);
    });
    avgCycleTime = Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length);
  }

  // Conversion: deals that moved past each stage
  const conversionByStage = {};
  DEAL_STAGES.forEach((stage, idx) => {
    if (idx === DEAL_STAGES.length - 1) return;
    const enteredStage = deals.filter(d =>
      d.stageHistory?.some(h => h.stage === stage.id)
    ).length;
    const passedStage = deals.filter(d =>
      d.stageHistory?.some(h => h.stage === DEAL_STAGES[idx + 1]?.id)
    ).length;
    conversionByStage[stage.id] = enteredStage > 0
      ? Math.round((passedStage / enteredStage) * 100)
      : null;
  });

  return {
    avgDaysPerStage,
    avgCycleTime,
    conversionByStage,
    totalDeals: deals.length,
    closedDeals: closedDeals.length,
    winRate: deals.length > 0 ? Math.round((closedDeals.length / deals.length) * 100) : 0,
  };
}

// ============ SETTINGS ============
const DEFAULT_SETTINGS = {
  proxyUrl: '',
  apolloApiKey: '',
  perplexityApiKey: '',
  tavilyApiKey: '',
  autoEnrich: false,
  enrichFields: ['industry', 'employeeCount', 'description', 'linkedinUrl'],
};

export function getSettings() {
  return loadData(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
}

export function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  saveData(STORAGE_KEYS.SETTINGS, merged);
  return merged;
}

// ============ COMPANY ENRICHMENT ============
export async function enrichCompany(domain) {
  const settings = getSettings();

  if (!settings.proxyUrl || (!settings.perplexityApiKey && !settings.apolloApiKey)) {
    throw new Error('Configure Proxy URL and at least one API key in Settings.');
  }

  const proxyUrl = settings.proxyUrl.replace(/\/$/, '');
  const response = await fetch(`${proxyUrl}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain,
      perplexityApiKey: settings.perplexityApiKey || '',
      apolloApiKey: settings.apolloApiKey || '',
      tavilyApiKey: settings.tavilyApiKey || '',
    }),
  });

  if (!response.ok) {
    throw new Error(`Proxy returned ${response.status}`);
  }

  const data = await response.json();
  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

// ============ RESEARCH AGENT ============
export async function runResearchAgent(domain, onProgress) {
  const settings = getSettings();

  if (!settings.proxyUrl || (!settings.perplexityApiKey && !settings.apolloApiKey)) {
    throw new Error('Configure Proxy URL and at least one API key in Settings.');
  }

  const proxyUrl = settings.proxyUrl.replace(/\/$/, '');

  // Notify progress
  if (onProgress) onProgress({ step: 1, total: 6, message: 'Starting research agent...' });

  const response = await fetch(`${proxyUrl}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain,
      perplexityApiKey: settings.perplexityApiKey || '',
      apolloApiKey: settings.apolloApiKey || '',
      tavilyApiKey: settings.tavilyApiKey || '',
    }),
  });

  if (!response.ok) {
    throw new Error(`Agent returned ${response.status}`);
  }

  const dossier = await response.json();
  if (dossier?.error) {
    throw new Error(dossier.error);
  }

  if (onProgress) onProgress({ step: 6, total: 6, message: 'Research complete!' });

  return dossier;
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
