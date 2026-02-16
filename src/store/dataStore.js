// DealFlow Data Store - Persists to localStorage
import { v4 as uuidv4 } from 'uuid';

// Research Agent step descriptions for progress UI
export const AGENT_STEPS = [
  { step: 1, label: 'Company Overview', description: 'Gathering company info from Perplexity + Apollo' },
  { step: 2, label: 'Decision Makers', description: 'Finding key contacts for office space decisions' },
  { step: 3, label: 'Founder Due Diligence', description: 'Researching founder backgrounds & pedigree scoring' },
  { step: 4, label: 'NYC Address Search', description: 'Deep search for exact NYC office address' },
  { step: 5, label: 'Recent News', description: 'Searching for recent office/lease news' },
  { step: 6, label: 'Hiring Intelligence', description: 'Scraping careers page with Firecrawl for job listings' },
  { step: 7, label: 'Outreach Email', description: 'Generating personalized cold email' },
  { step: 8, label: 'Prospect Scorecard', description: 'Calculating funding, investor & founder scores' },
];

const STORAGE_KEYS = {
  DEALS: 'dealflow_deals',
  PROSPECTS: 'dealflow_prospects',
  MASTER_LIST: 'dealflow_master_list',
  COMMISSIONS: 'dealflow_commissions',
  FOLLOWUPS: 'dealflow_followups',
  CONTACTS: 'dealflow_contacts',
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
  { id: 'on_hold', name: 'On Hold' },
  { id: 'lost', name: 'Lost' },
];

// Prospect CRM Stages
export const PROSPECT_STAGES = [
  { id: 'clients', name: 'Clients' },
  { id: 'meetings', name: 'Meetings to Schedule' },
  { id: 'top_prospects', name: 'Top Prospects (contact established)' },
  { id: 'top_pursuits', name: 'Top Pursuits (no contact)' },
  { id: 'secondary', name: 'Secondary Prospects' },
];

// Company Research Status (for Master List workflow)
export const COMPANY_STATUSES = [
  { id: 'new', name: 'New', color: '#6b7280' },
  { id: 'researching', name: 'Researching', color: '#3b82f6' },
  { id: 'contacting', name: 'Contacting', color: '#f59e0b' },
  { id: 'meeting', name: 'Meeting Scheduled', color: '#8b5cf6' },
  { id: 'not_a_fit', name: 'Not a Fit', color: '#ef4444' },
];

// Prospect Tiers for Master List segmentation
export const PROSPECT_TIERS = [
  { id: 'tier_1_nyc_seed', name: 'NYC Seed ($4M+)', color: '#22c55e' },
  { id: 'tier_2_nyc_growth', name: 'NYC Growth (A/B)', color: '#3b82f6' },
  { id: 'tier_3_sf_expansion', name: 'SF Expansion (B/C)', color: '#f59e0b' },
  { id: 'tier_4_europe_expansion', name: 'Europe Expansion (C+)', color: '#8b5cf6' },
  { id: 'all', name: 'All Companies', color: '#6b7280' },
];

// Commission Statuses
export const COMMISSION_STATUSES = [
  { id: 'projected', name: 'Projected' },
  { id: 'in_contract', name: 'In Contract' },
  { id: 'closed', name: 'Closed' },
  { id: 'invoice_sent', name: 'Invoice Sent' },
  { id: 'overdue', name: 'Overdue' },
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
    // Create new deal with proper FK relationships
    const newDeal = {
      ...deal,
      id: uuidv4(),
      prospectId: deal.prospectId || null,    // FK to Prospect
      companyId: deal.companyId || null,      // FK to MasterList company
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

// Convert a Prospect to a Deal (one-click conversion)
export function convertProspectToDeal(prospectId) {
  const prospects = getProspects();
  const prospect = prospects.find(p => p.id === prospectId);

  if (!prospect) {
    throw new Error('Prospect not found');
  }

  const now = new Date().toISOString();
  const deals = getDeals();

  // Create deal from prospect data
  const newDeal = {
    id: uuidv4(),
    prospectId: prospect.id,                    // Link back to prospect
    companyId: prospect.masterListId || null,   // Link to MasterList company
    clientName: prospect.organizationName,
    dealNickname: '',
    contactName: prospect.contactName || '',
    contactEmail: prospect.contactEmail || '',
    contactPhone: prospect.contactPhone || '',
    website: prospect.website || '',
    squareFootage: '',
    targetBudget: '',
    targetDate: '',
    notes: `Converted from Prospect on ${new Date().toLocaleDateString()}`,
    stage: 'kickoff',
    stageHistory: [{ stage: 'kickoff', date: now }],
    createdAt: now,
    updatedAt: now,
  };

  deals.push(newDeal);
  saveData(STORAGE_KEYS.DEALS, deals);

  // Update prospect to mark as converted
  const prospectIndex = prospects.findIndex(p => p.id === prospectId);
  if (prospectIndex !== -1) {
    prospects[prospectIndex].convertedToDealId = newDeal.id;
    prospects[prospectIndex].convertedAt = now;
    prospects[prospectIndex].crmStage = 'clients';  // Move to "Clients" stage
    saveData(STORAGE_KEYS.PROSPECTS, prospects);
  }

  logActivity('prospect_converted', `${prospect.organizationName} converted to Deal`);

  return { deal: newDeal, deals, prospects };
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
  const now = new Date().toISOString();
  const newCompanies = companies.map(c => {
    const id = c.id || uuidv4();
    return {
      ...c,
      id,
      status: c.status || 'new',
      addedAt: now,
    };
  });
  const updated = [...existing, ...newCompanies];
  saveData(STORAGE_KEYS.MASTER_LIST, updated);

  // Log activity for each imported company
  newCompanies.forEach(c => {
    logActivity('company_imported', `${c.organizationName || 'Company'} added to Master List`, c.id);
  });

  return updated;
}

// Persist Research Agent dossier to Company record
export function saveDossierToCompany(companyId, dossier) {
  const companies = getMasterList();
  const index = companies.findIndex(c => c.id === companyId);

  if (index === -1) {
    throw new Error('Company not found');
  }

  const now = new Date().toISOString();
  const companyName = dossier.company?.companyName || companies[index].organizationName;

  // Merge dossier data into company record
  // IMPORTANT: Preserve CSV description if it exists (don't overwrite with agent-generated)
  const existingDescription = companies[index].description;
  const hasExistingDescription = existingDescription && existingDescription.trim().length > 0;

  companies[index] = {
    ...companies[index],
    // Company overview
    organizationName: companyName,
    // Keep CSV description if present; only use dossier description if CSV was empty
    description: hasExistingDescription ? existingDescription : (dossier.company?.description || ''),
    industry: dossier.company?.industry || companies[index].industry,
    foundedDate: dossier.company?.founded || companies[index].foundedDate,
    headquarters: dossier.company?.headquarters || companies[index].headquarters,
    employeeCount: dossier.company?.employeeCount || companies[index].employeeCount,
    // Funding
    totalFunding: dossier.company?.totalFunding || companies[index].totalFunding,
    topInvestors: dossier.company?.topInvestors || companies[index].topInvestors,
    lastFundingType: dossier.company?.lastFundingType || companies[index].lastFundingType,
    lastFundingDate: dossier.company?.lastFundingDate || companies[index].lastFundingDate,
    // NYC Intel
    nycAddress: dossier.nycIntel?.address || dossier.company?.nycAddress || companies[index].nycAddress,
    nycOfficeConfirmed: dossier.nycIntel?.confirmed || dossier.company?.nycOfficeConfirmed || companies[index].nycOfficeConfirmed,
    nycHeadcount: dossier.nycIntel?.nyc_headcount || companies[index].nycHeadcount,
    // Hiring
    hiringStatus: dossier.hiring?.status || companies[index].hiringStatus,
    totalJobs: dossier.hiring?.totalJobs || companies[index].totalJobs,
    nycJobs: dossier.hiring?.nycJobs || companies[index].nycJobs,
    departmentsHiring: dossier.hiring?.keyRoles || companies[index].departmentsHiring,
    careersUrl: dossier.hiring?.careersUrl || dossier.nycIntel?.careersUrl || companies[index].careersUrl,
    // Contacts from dossier
    keyContacts: dossier.contacts?.length > 0
      ? dossier.contacts.map(c => `${c.name} (${c.title})`).join(', ')
      : companies[index].keyContacts,
    // Links
    linkedinUrl: dossier.company?.linkedinUrl || companies[index].linkedin,
    // Prospect Scorecard
    prospectScore: dossier.scorecard?.prospectScore ?? companies[index].prospectScore,
    fundingScore: dossier.scorecard?.funding?.score ?? companies[index].fundingScore,
    investorScore: dossier.scorecard?.investor?.score ?? companies[index].investorScore,
    founderScore: dossier.scorecard?.founder?.score ?? companies[index].founderScore,
    scorecard: dossier.scorecard || companies[index].scorecard,
    // Founder Profiles
    founderProfiles: dossier.founderProfiles || companies[index].founderProfiles,
    // Research metadata
    lastResearchedAt: now,
    lastDossier: dossier,  // Store full dossier for reference
    updatedAt: now,
  };

  // Create Contact records from dossier contacts
  if (dossier.contacts?.length > 0) {
    const existingContacts = getContacts();

    dossier.contacts.forEach(contact => {
      // Check if contact already exists (by email or name+company)
      const exists = existingContacts.some(c =>
        (contact.email && c.email === contact.email) ||
        (c.companyId === companyId && c.name === contact.name)
      );

      if (!exists) {
        saveContact({
          companyId: companyId,
          companyName: companyName,
          name: contact.name,
          title: contact.title || '',
          email: contact.email || '',
          phone: contact.phone || '',
          linkedin: contact.linkedin || '',
          source: 'research_agent',
          notes: '',
        });
      }
    });
  }

  saveData(STORAGE_KEYS.MASTER_LIST, companies);
  logActivity('agent_completed', `Research agent completed for ${companyName}`, companyId);

  return companies;
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
      dealId: commission.dealId || null,       // FK to Deal
      companyId: commission.companyId || null, // FK to MasterList company
      calculatedAmount,
      createdAt: now,
      updatedAt: now,
    });
    logActivity('commission_added', `Commission added for ${commission.clientName}`);
  }

  saveData(STORAGE_KEYS.COMMISSIONS, commissions);
  return commissions;
}

// Auto-create Commission when Deal closes
export function createCommissionFromDeal(dealId) {
  const deals = getDeals();
  const deal = deals.find(d => d.id === dealId);

  if (!deal) {
    throw new Error('Deal not found');
  }

  // Check if commission already exists for this deal
  const existingCommissions = getCommissions();
  const existing = existingCommissions.find(c => c.dealId === dealId);
  if (existing) {
    return { commission: existing, commissions: existingCommissions, alreadyExists: true };
  }

  const now = new Date().toISOString();

  const newCommission = {
    id: uuidv4(),
    dealId: deal.id,                           // Link to Deal
    companyId: deal.companyId || null,         // Link to MasterList company
    prospectId: deal.prospectId || null,       // Link to Prospect
    clientName: deal.clientName,
    squareFootage: deal.squareFootage || '',
    annualRent: deal.targetBudget || '',       // Use target budget as starting point
    leaseTerm: '',                             // User needs to fill in
    commissionRate: '4',                       // Default 4%
    status: 'in_contract',                     // Auto-set to "In Contract"
    calculatedAmount: 0,
    notes: `Auto-created from Deal on ${new Date().toLocaleDateString()}`,
    createdAt: now,
    updatedAt: now,
  };

  existingCommissions.push(newCommission);
  saveData(STORAGE_KEYS.COMMISSIONS, existingCommissions);

  logActivity('commission_auto_created', `Commission auto-created for ${deal.clientName}`);

  return { commission: newCommission, commissions: existingCommissions, alreadyExists: false };
}

export function deleteCommission(commissionId) {
  const commissions = getCommissions().filter(c => c.id !== commissionId);
  saveData(STORAGE_KEYS.COMMISSIONS, commissions);
  return commissions;
}

// ============ CONTACTS ============
export function getContacts() {
  return loadData(STORAGE_KEYS.CONTACTS, []);
}

export function saveContact(contact) {
  const contacts = getContacts();
  const now = new Date().toISOString();

  if (contact.id) {
    const index = contacts.findIndex(c => c.id === contact.id);
    if (index !== -1) {
      contacts[index] = { ...contacts[index], ...contact, updatedAt: now };
    }
  } else {
    contacts.push({
      ...contact,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    });
  }

  saveData(STORAGE_KEYS.CONTACTS, contacts);
  return contacts;
}

export function getContactsByCompany(companyId) {
  return getContacts().filter(c => c.companyId === companyId);
}

export function deleteContact(contactId) {
  const contacts = getContacts().filter(c => c.id !== contactId);
  saveData(STORAGE_KEYS.CONTACTS, contacts);
  return contacts;
}

// Create follow-up from contact
export function createFollowUpFromContact(contact, note, dueDate) {
  const followUp = {
    contactId: contact.id,
    companyId: contact.companyId,
    companyName: contact.companyName,
    contactName: contact.name,
    contactEmail: contact.email,
    contactTitle: contact.title,
    note: note || `Follow up with ${contact.name}`,
    dueDate: dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Default 1 week
  };

  return saveFollowUp(followUp);
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

export function logActivity(type, message, companyId = null) {
  const activities = getActivityLog();
  activities.unshift({
    id: uuidv4(),
    type,
    message,
    companyId,  // Optional: link activity to specific company
    timestamp: new Date().toISOString(),
  });
  // Keep only last 100 activities
  const trimmed = activities.slice(0, 100);
  saveData(STORAGE_KEYS.ACTIVITY_LOG, trimmed);
  return trimmed;
}

// Get activity timeline for a specific company
export function getCompanyActivities(companyId) {
  const activities = getActivityLog();
  return activities.filter(a => a.companyId === companyId);
}

// Update company status and log the change
export function updateCompanyStatus(companyId, newStatus) {
  const companies = getMasterList();
  const index = companies.findIndex(c => c.id === companyId);
  if (index === -1) return companies;

  const company = companies[index];
  const oldStatus = company.status || 'new';
  const now = new Date().toISOString();

  companies[index] = {
    ...company,
    status: newStatus,
    statusUpdatedAt: now,
    updatedAt: now,
  };

  saveData(STORAGE_KEYS.MASTER_LIST, companies);
  logActivity('status_changed', `Status changed from ${oldStatus} to ${newStatus}`, companyId);
  return companies;
}

// Bulk delete companies from Master List
export function deleteCompaniesFromMasterList(companyIds) {
  const companies = getMasterList();
  const toDelete = new Set(companyIds);
  const remaining = companies.filter(c => !toDelete.has(c.id));
  saveData(STORAGE_KEYS.MASTER_LIST, remaining);
  logActivity('companies_deleted', `${companyIds.length} companies removed from Master List`);
  return remaining;
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
  firecrawlApiKey: '',
  anthropicApiKey: '',
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
      firecrawlApiKey: settings.firecrawlApiKey || '',
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
  if (onProgress) onProgress({ step: 1, total: 8, message: 'Starting research agent...' });

  const response = await fetch(`${proxyUrl}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain,
      perplexityApiKey: settings.perplexityApiKey || '',
      apolloApiKey: settings.apolloApiKey || '',
      tavilyApiKey: settings.tavilyApiKey || '',
      firecrawlApiKey: settings.firecrawlApiKey || '',
    }),
  });

  if (!response.ok) {
    throw new Error(`Agent returned ${response.status}`);
  }

  const dossier = await response.json();
  if (dossier?.error) {
    throw new Error(dossier.error);
  }

  if (onProgress) onProgress({ step: 8, total: 8, message: 'Research complete!' });

  return dossier;
}

// ============ CLAUDE CHAT ============
export async function sendChatMessage(messages, context = {}) {
  const settings = getSettings();

  if (!settings.proxyUrl || !settings.anthropicApiKey) {
    throw new Error('Configure Proxy URL and Anthropic API key in Settings.');
  }

  const proxyUrl = settings.proxyUrl.replace(/\/$/, '');

  const response = await fetch(`${proxyUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      context,
      anthropicApiKey: settings.anthropicApiKey,
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat returned ${response.status}`);
  }

  const data = await response.json();
  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

// Get context for chat based on current view
export function getChatContext(type, data) {
  const baseContext = {
    deals: getDeals(),
    prospects: getProspects(),
    followUps: getFollowUps().filter(f => !f.completed),
    staleDeals: getStaleDeals(),
  };

  if (type === 'company' && data) {
    return {
      ...baseContext,
      currentCompany: data,
      contacts: getContactsByCompany(data.id),
    };
  }

  if (type === 'deal' && data) {
    return {
      ...baseContext,
      currentDeal: data,
    };
  }

  if (type === 'prospect' && data) {
    return {
      ...baseContext,
      currentProspect: data,
    };
  }

  return baseContext;
}

// ============ STALE DEALS DETECTION ============
// Deals sitting too long in a stage need attention
const STALE_THRESHOLDS = {
  kickoff: 14,      // 2 weeks in kickoff is stale
  touring: 21,      // 3 weeks touring is stale
  loi: 14,          // 2 weeks in LOI is stale
  negotiation: 30,  // 1 month negotiating is stale
  consent: 21,      // 3 weeks in consent is stale
  on_hold: 30,      // 1 month on hold - reminder
};

export function getStaleDeals() {
  const deals = getDeals();
  const now = new Date();
  const staleDeals = [];

  deals.forEach(deal => {
    // Skip closed, lost deals
    if (deal.stage === 'closed' || deal.stage === 'lost') return;

    // Get days in current stage
    if (!deal.stageHistory || deal.stageHistory.length === 0) return;
    const lastStageChange = deal.stageHistory[deal.stageHistory.length - 1];
    const stageDate = new Date(lastStageChange.date);
    const daysInStage = Math.floor((now - stageDate) / (1000 * 60 * 60 * 24));

    // Check against threshold
    const threshold = STALE_THRESHOLDS[deal.stage];
    if (threshold && daysInStage > threshold) {
      staleDeals.push({
        ...deal,
        daysInStage,
        threshold,
        overBy: daysInStage - threshold,
        stageName: DEAL_STAGES.find(s => s.id === deal.stage)?.name || deal.stage,
      });
    }
  });

  // Sort by most overdue first
  return staleDeals.sort((a, b) => b.overBy - a.overBy);
}

// Get deals needing attention (approaching stale threshold)
export function getDealsNeedingAttention() {
  const deals = getDeals();
  const now = new Date();
  const attentionDeals = [];

  deals.forEach(deal => {
    // Skip closed, lost deals
    if (deal.stage === 'closed' || deal.stage === 'lost') return;

    if (!deal.stageHistory || deal.stageHistory.length === 0) return;
    const lastStageChange = deal.stageHistory[deal.stageHistory.length - 1];
    const stageDate = new Date(lastStageChange.date);
    const daysInStage = Math.floor((now - stageDate) / (1000 * 60 * 60 * 24));

    const threshold = STALE_THRESHOLDS[deal.stage];
    if (!threshold) return;

    // Flag if within 5 days of threshold (warning zone)
    const daysUntilStale = threshold - daysInStage;
    if (daysUntilStale > 0 && daysUntilStale <= 5) {
      attentionDeals.push({
        ...deal,
        daysInStage,
        daysUntilStale,
        stageName: DEAL_STAGES.find(s => s.id === deal.stage)?.name || deal.stage,
      });
    }
  });

  return attentionDeals.sort((a, b) => a.daysUntilStale - b.daysUntilStale);
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
    // Proactive alerts
    staleDeals: getStaleDeals(),
    attentionDeals: getDealsNeedingAttention(),
  };
}
