// DealFlow Data Store - Supabase backend
import { supabase } from '../services/supabaseClient';

// Helper to get current user ID
async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
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

const DEFAULT_SETTINGS = {
  proxyUrl: '',
  proxySecret: '',
  perplexityApiKey: '',
  apolloApiKey: '',
  exaApiKey: '',
  firecrawlApiKey: '',
  autoEnrich: false,
};

// ============ SETTINGS ============
export async function getSettings() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) return { ...DEFAULT_SETTINGS };
  const { user_id, id, created_at, updated_at, ...rest } = data;
  return { ...DEFAULT_SETTINGS, ...rest };
}

export async function saveSettings(settings) {
  const userId = await getUserId();
  const merged = { ...DEFAULT_SETTINGS, ...settings };

  const payload = {
    user_id: userId,
    ...merged,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('settings')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) throw error;
  return merged;
}

// ============ DEALS ============
export async function getDeals() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(d => ({
    ...d,
    stageHistory: d.stage_history || d.stageHistory || [],
    createdAt: d.created_at || d.createdAt,
    updatedAt: d.updated_at || d.updatedAt,
    clientName: d.client_name || d.clientName,
    dealNickname: d.deal_nickname || d.dealNickname,
    contactName: d.contact_name || d.contactName,
    contactEmail: d.contact_email || d.contactEmail,
    contactPhone: d.contact_phone || d.contactPhone,
    squareFootage: d.square_footage || d.squareFootage,
    targetBudget: d.target_budget || d.targetBudget,
    targetDate: d.target_date || d.targetDate,
  }));
}

export async function saveDeal(deal) {
  const userId = await getUserId();
  const now = new Date().toISOString();

  const dbRecord = {
    user_id: userId,
    client_name: deal.clientName || deal.client_name || '',
    deal_nickname: deal.dealNickname || deal.deal_nickname || '',
    contact_name: deal.contactName || deal.contact_name || '',
    contact_email: deal.contactEmail || deal.contact_email || '',
    contact_phone: deal.contactPhone || deal.contact_phone || '',
    square_footage: deal.squareFootage || deal.square_footage || '',
    target_budget: deal.targetBudget || deal.target_budget || '',
    target_date: deal.targetDate || deal.target_date || null,
    notes: deal.notes || '',
    stage: deal.stage || 'kickoff',
    updated_at: now,
  };

  if (deal.id) {
    // Update existing deal
    dbRecord.stage_history = deal.stageHistory || deal.stage_history || [];
    const { data, error } = await supabase
      .from('deals')
      .update(dbRecord)
      .eq('id', deal.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    // Create new deal
    dbRecord.stage_history = [{ stage: deal.stage || 'kickoff', date: now }];
    dbRecord.created_at = now;
    const { data, error } = await supabase
      .from('deals')
      .insert(dbRecord)
      .select()
      .single();
    if (error) throw error;
    await logActivity('deal_created', `New deal created: ${dbRecord.client_name}`);
    return data;
  }
}

export async function updateDealStage(dealId, newStage) {
  const userId = await getUserId();
  const now = new Date().toISOString();

  const { data: deal, error: fetchErr } = await supabase
    .from('deals')
    .select('*')
    .eq('id', dealId)
    .eq('user_id', userId)
    .single();
  if (fetchErr) throw fetchErr;

  const stageHistory = deal.stage_history || [];
  stageHistory.push({ stage: newStage, date: now });

  const { error } = await supabase
    .from('deals')
    .update({
      stage: newStage,
      stage_history: stageHistory,
      updated_at: now,
    })
    .eq('id', dealId);
  if (error) throw error;

  await logActivity('deal_moved', `${deal.client_name} moved to ${DEAL_STAGES.find(s => s.id === newStage)?.name}`);
}

export async function deleteDeal(dealId) {
  const { error } = await supabase
    .from('deals')
    .delete()
    .eq('id', dealId);
  if (error) throw error;
}

// ============ MASTER LIST ============
export async function getMasterList() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('master_list')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveMasterList(companies) {
  const userId = await getUserId();
  const { error: delErr } = await supabase
    .from('master_list')
    .delete()
    .eq('user_id', userId);
  if (delErr) throw delErr;

  if (companies.length > 0) {
    const rows = companies.map(c => {
      const row = { ...c, user_id: userId, updated_at: new Date().toISOString() };
      if (!row.created_at) row.created_at = row.updated_at;
      return row;
    });
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase.from('master_list').insert(batch);
      if (error) throw error;
    }
  }

  await logActivity('master_list_updated', `Master list updated with ${companies.length} companies`);
  return companies;
}

function normalizeUrl(url) {
  if (!url) return '';
  return url.replace(/https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').toLowerCase().trim();
}

export async function addToMasterList(companies) {
  const userId = await getUserId();
  const existing = await getMasterList();

  const existingKeys = new Set();
  for (const c of existing) {
    const website = normalizeUrl(c.website);
    const name = (c.organizationName || c.organization_name || '').toLowerCase().trim();
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
      const newCompany = {
        ...c,
        user_id: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      delete newCompany.id;
      added.push(newCompany);
      if (website) existingKeys.add(`url:${website}`);
      if (name) existingKeys.add(`name:${name}`);
    }
  }

  if (added.length > 0) {
    for (let i = 0; i < added.length; i += 500) {
      const batch = added.slice(i, i + 500);
      const { error } = await supabase.from('master_list').insert(batch);
      if (error) throw error;
    }
  }

  await logActivity('companies_imported', `${added.length} companies imported to Master List (${skipped} duplicates skipped)`);
  const updated = await getMasterList();
  return { companies: updated, added: added.length, skipped };
}

export async function updateMasterListItem(id, updates) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('master_list')
    .update({ ...updates, updated_at: now })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCompaniesFromMasterList(companyIds) {
  for (const id of companyIds) {
    await supabase.from('master_list').delete().eq('id', id);
  }
  await logActivity('companies_deleted', `${companyIds.length} companies removed from Master List`);
  return await getMasterList();
}

// ============ CONTACTS ============
export async function getContacts() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveContact(contact) {
  const userId = await getUserId();
  const now = new Date().toISOString();

  if (contact.id) {
    const { data, error } = await supabase
      .from('contacts')
      .update({ ...contact, user_id: userId, updated_at: now })
      .eq('id', contact.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const newContact = { ...contact, user_id: userId, created_at: now, updated_at: now };
    delete newContact.id;
    const { data, error } = await supabase
      .from('contacts')
      .insert(newContact)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

// ============ PROSPECTS ============
export async function getProspects() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(p => ({
    ...p,
    addedAt: p.added_at || p.addedAt,
    updatedAt: p.updated_at || p.updatedAt,
    crmStage: p.crm_stage || p.crmStage,
    organizationName: p.organization_name || p.organizationName,
    contactName: p.contact_name || p.contactName,
    contactEmail: p.contact_email || p.contactEmail,
    contactTitle: p.contact_title || p.contactTitle,
    prospectStatus: p.prospect_status || p.prospectStatus,
    masterListId: p.master_list_id || p.masterListId,
    convertedToDealId: p.converted_to_deal_id || p.convertedToDealId,
  }));
}

export async function saveProspect(prospect) {
  const userId = await getUserId();
  const now = new Date().toISOString();

  const dbRecord = {
    user_id: userId,
    organization_name: prospect.organizationName || prospect.organization_name || '',
    contact_name: prospect.contactName || prospect.contact_name || '',
    contact_email: prospect.contactEmail || prospect.contact_email || '',
    contact_title: prospect.contactTitle || prospect.contact_title || '',
    website: prospect.website || '',
    crm_stage: prospect.crmStage || prospect.crm_stage || 'top_pursuits',
    prospect_status: prospect.prospectStatus || prospect.prospect_status || '',
    master_list_id: prospect.masterListId || prospect.master_list_id || null,
    converted_to_deal_id: prospect.convertedToDealId || prospect.converted_to_deal_id || null,
    notes: prospect.notes || [],
    description: prospect.description || '',
    industries: prospect.industries || '',
    headquarters: prospect.headquarters || '',
    employee_count: prospect.employeeCount || prospect.employee_count || '',
    total_funding: prospect.totalFunding || prospect.total_funding || '',
    updated_at: now,
  };

  if (prospect.id) {
    const { data, error } = await supabase
      .from('prospects')
      .update(dbRecord)
      .eq('id', prospect.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    dbRecord.added_at = now;
    dbRecord.created_at = now;
    const { data, error } = await supabase
      .from('prospects')
      .insert(dbRecord)
      .select()
      .single();
    if (error) throw error;
    await logActivity('prospect_added', `${dbRecord.organization_name} added to CRM`);
    return data;
  }
}

export async function updateProspectStage(prospectId, newStage) {
  const now = new Date().toISOString();

  const { data: prospect } = await supabase
    .from('prospects')
    .select('organization_name')
    .eq('id', prospectId)
    .single();

  const { error } = await supabase
    .from('prospects')
    .update({ crm_stage: newStage, updated_at: now })
    .eq('id', prospectId);
  if (error) throw error;

  await logActivity('prospect_moved', `${prospect?.organization_name || ''} moved to ${PROSPECT_STAGES.find(s => s.id === newStage)?.name}`);
}

export async function addProspectNote(prospectId, note) {
  const now = new Date().toISOString();

  const { data: prospect, error: fetchErr } = await supabase
    .from('prospects')
    .select('notes')
    .eq('id', prospectId)
    .single();
  if (fetchErr) throw fetchErr;

  const notes = prospect.notes || [];
  notes.unshift({ id: crypto.randomUUID(), text: note, createdAt: now });

  const { error } = await supabase
    .from('prospects')
    .update({ notes, updated_at: now })
    .eq('id', prospectId);
  if (error) throw error;
}

export async function deleteProspect(prospectId) {
  const { error } = await supabase
    .from('prospects')
    .delete()
    .eq('id', prospectId);
  if (error) throw error;
}

// ============ COMMISSIONS ============
export async function getCommissions() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('commissions')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(c => ({
    ...c,
    clientName: c.client_name || c.clientName,
    squareFootage: c.square_footage || c.squareFootage,
    annualRent: c.annual_rent || c.annualRent,
    leaseTerm: c.lease_term || c.leaseTerm,
    commissionRate: c.commission_rate || c.commissionRate,
    calculatedAmount: c.calculated_amount || c.calculatedAmount || 0,
    landlordBuilding: c.landlord_building || c.landlordBuilding,
    expectedCloseDate: c.expected_close_date || c.expectedCloseDate,
    linkedDealId: c.linked_deal_id || c.linkedDealId || c.deal_id || c.dealId,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));
}

export async function saveCommission(commission) {
  const userId = await getUserId();
  const now = new Date().toISOString();

  const sqft = parseFloat(commission.squareFootage) || 0;
  const annualRent = parseFloat(commission.annualRent) || 0;
  const termYears = (parseFloat(commission.leaseTerm) || 0) / 12;
  const rate = (parseFloat(commission.commissionRate) || 0) / 100;
  const calculatedAmount = sqft * annualRent * termYears * rate;

  const dbRecord = {
    user_id: userId,
    client_name: commission.clientName || '',
    landlord_building: commission.landlordBuilding || '',
    square_footage: commission.squareFootage || '',
    lease_term: commission.leaseTerm || '',
    annual_rent: commission.annualRent || '',
    commission_rate: commission.commissionRate || '',
    calculated_amount: calculatedAmount,
    expected_close_date: commission.expectedCloseDate || null,
    status: commission.status || 'projected',
    notes: commission.notes || '',
    linked_deal_id: commission.linkedDealId || commission.dealId || null,
    updated_at: now,
  };

  if (commission.id) {
    const { data, error } = await supabase
      .from('commissions')
      .update(dbRecord)
      .eq('id', commission.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    dbRecord.created_at = now;
    const { data, error } = await supabase
      .from('commissions')
      .insert(dbRecord)
      .select()
      .single();
    if (error) throw error;
    await logActivity('commission_added', `Commission added for ${dbRecord.client_name}`);
    return data;
  }
}

export async function deleteCommission(commissionId) {
  const { error } = await supabase
    .from('commissions')
    .delete()
    .eq('id', commissionId);
  if (error) throw error;
}

// ============ FOLLOW-UPS ============
export async function getFollowUps() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(f => ({
    ...f,
    companyName: f.company_name || f.companyName,
    contactName: f.contact_name || f.contactName,
    dueDate: f.due_date || f.dueDate,
    entityType: f.entity_type || f.entityType,
    entityId: f.entity_id || f.entityId,
    companyId: f.company_id || f.companyId,
    completedAt: f.completed_at || f.completedAt,
    createdAt: f.created_at || f.createdAt,
  }));
}

export async function saveFollowUp(followUp) {
  const userId = await getUserId();
  const now = new Date().toISOString();

  const dbRecord = {
    user_id: userId,
    company_name: followUp.companyName || '',
    contact_name: followUp.contactName || '',
    due_date: followUp.dueDate || null,
    entity_type: followUp.entityType || null,
    entity_id: followUp.entityId || null,
    company_id: followUp.companyId || null,
    completed: false,
    notes: followUp.notes || '',
    updated_at: now,
  };

  if (followUp.id) {
    const { data, error } = await supabase
      .from('follow_ups')
      .update(dbRecord)
      .eq('id', followUp.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    dbRecord.created_at = now;
    const { data, error } = await supabase
      .from('follow_ups')
      .insert(dbRecord)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

export async function completeFollowUp(followUpId) {
  const now = new Date().toISOString();

  const { data: followUp } = await supabase
    .from('follow_ups')
    .select('company_name')
    .eq('id', followUpId)
    .single();

  const { error } = await supabase
    .from('follow_ups')
    .update({ completed: true, completed_at: now })
    .eq('id', followUpId);
  if (error) throw error;

  await logActivity('followup_completed', `Follow-up completed for ${followUp?.company_name || 'Unknown'}`);
}

export async function deleteFollowUp(followUpId) {
  const { error } = await supabase
    .from('follow_ups')
    .delete()
    .eq('id', followUpId);
  if (error) throw error;
}

// ============ ACTIVITY LOG ============
export async function getActivityLog() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []).map(a => ({
    ...a,
    timestamp: a.created_at || a.timestamp,
  }));
}

export async function logActivity(type, message) {
  try {
    const userId = await getUserId();
    await supabase
      .from('activity_log')
      .insert({
        user_id: userId,
        type,
        message,
        created_at: new Date().toISOString(),
      });
  } catch (e) {
    console.error('Failed to log activity:', e);
  }
}

// ============ PROSPECT → DEAL CONVERSION ============
export async function convertProspectToDeal(prospectId) {
  const userId = await getUserId();
  const now = new Date().toISOString();

  const { data: prospect, error: fetchErr } = await supabase
    .from('prospects')
    .select('*')
    .eq('id', prospectId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!prospect) throw new Error('Prospect not found');

  const newDeal = {
    user_id: userId,
    client_name: prospect.organization_name || '',
    contact_name: prospect.contact_name || '',
    contact_email: prospect.contact_email || '',
    stage: 'kickoff',
    stage_history: [{ stage: 'kickoff', date: now }],
    notes: `Converted from prospect on ${new Date().toLocaleDateString()}`,
    prospect_id: prospect.id,
    company_id: prospect.master_list_id || null,
    created_at: now,
    updated_at: now,
  };

  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .insert(newDeal)
    .select()
    .single();
  if (dealErr) throw dealErr;

  await supabase
    .from('prospects')
    .update({
      converted_to_deal_id: deal.id,
      crm_stage: 'clients',
      updated_at: now,
    })
    .eq('id', prospectId);

  await logActivity('prospect_converted', `${prospect.organization_name} converted to deal`);
  return { deal, prospect };
}

// ============ AUTO-CREATE COMMISSION FROM DEAL ============
export async function createCommissionFromDeal(dealId) {
  const userId = await getUserId();

  const { data: deal, error: fetchErr } = await supabase
    .from('deals')
    .select('*')
    .eq('id', dealId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!deal) throw new Error('Deal not found');

  const { data: existing } = await supabase
    .from('commissions')
    .select('*')
    .eq('linked_deal_id', dealId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) return { commission: existing, alreadyExists: true };

  const now = new Date().toISOString();
  const commissionRecord = {
    user_id: userId,
    linked_deal_id: deal.id,
    client_name: deal.client_name || '',
    square_footage: deal.square_footage || '',
    annual_rent: deal.target_budget || '',
    lease_term: '',
    commission_rate: '4',
    status: 'in_contract',
    calculated_amount: 0,
    notes: `Auto-created from deal on ${new Date().toLocaleDateString()}`,
    created_at: now,
    updated_at: now,
  };

  const { data: commission, error } = await supabase
    .from('commissions')
    .insert(commissionRecord)
    .select()
    .single();
  if (error) throw error;

  await logActivity('commission_auto_created', `Commission auto-created for ${commissionRecord.client_name}`);
  return { commission, alreadyExists: false };
}

// ============ STALE DEALS ============
const STALE_THRESHOLDS = {
  kickoff: 14, touring: 21, loi: 14, negotiation: 30, consent: 21,
};

export async function getStaleDeals() {
  const deals = await getDeals();
  const now = new Date();
  return deals.filter(deal => {
    const history = deal.stageHistory || deal.stage_history || [];
    if (deal.stage === 'closed' || deal.stage === 'lost') return false;
    if (!history.length) return false;
    const lastChange = history[history.length - 1];
    const days = Math.floor((now - new Date(lastChange.date)) / 86400000);
    const threshold = STALE_THRESHOLDS[deal.stage];
    return threshold && days > threshold;
  }).map(deal => {
    const history = deal.stageHistory || deal.stage_history || [];
    const lastChange = history[history.length - 1];
    const days = Math.floor((now - new Date(lastChange.date)) / 86400000);
    return { ...deal, daysInStage: days, threshold: STALE_THRESHOLDS[deal.stage] };
  });
}

// ============ RESEARCH AGENT ============
async function getProxyHeaders() {
  const settings = await getSettings();
  const headers = { 'Content-Type': 'application/json' };
  if (settings.proxySecret) {
    headers['Authorization'] = `Bearer ${settings.proxySecret}`;
  }
  return headers;
}

export async function enrichCompany(domain) {
  const settings = await getSettings();
  if (!settings.proxyUrl) throw new Error('Proxy URL not configured. Go to Settings.');

  const res = await fetch(`${settings.proxyUrl}/enrich`, {
    method: 'POST',
    headers: await getProxyHeaders(),
    body: JSON.stringify({
      domain,
      perplexityApiKey: settings.perplexityApiKey || '',
      apolloApiKey: settings.apolloApiKey || '',
      exaApiKey: settings.exaApiKey || '',
      firecrawlApiKey: settings.firecrawlApiKey || '',
    }),
  });

  if (!res.ok) throw new Error(`Enrich failed: ${res.status}`);
  return res.json();
}

export async function runResearchAgent(domain, onProgress = () => {}, companyData = {}) {
  const settings = await getSettings();
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

  let res;
  try {
    res = await fetch(`${settings.proxyUrl}/agent`, {
      method: 'POST',
      headers: await getProxyHeaders(),
      body: JSON.stringify({
        domain,
        csvData,
        perplexityApiKey: settings.perplexityApiKey || '',
        apolloApiKey: settings.apolloApiKey || '',
        exaApiKey: settings.exaApiKey || '',
        firecrawlApiKey: settings.firecrawlApiKey || '',
      }),
    });
  } catch (fetchErr) {
    throw new Error(`Cannot reach proxy at ${settings.proxyUrl}. Check that the worker is deployed and the URL is correct.`);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch {}
    throw new Error(`Agent failed (${res.status})${detail ? ': ' + detail : ''}`);
  }

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
        } else if (parsed.type === 'error') {
          throw new Error(parsed.message || 'Agent pipeline error');
        }
      } catch (parseErr) {
        if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
      }
    }
  }

  return finalResult;
}

// ============ CLAUSE LIBRARY ============
export const CLAUSE_CATEGORIES = [
  { id: 'rent', name: 'Rent & Economics' },
  { id: 'renewals', name: 'Renewals & Options' },
  { id: 'maintenance', name: 'Maintenance & Repairs' },
  { id: 'termination', name: 'Termination & Default' },
  { id: 'insurance', name: 'Insurance & Indemnity' },
  { id: 'use', name: 'Use & Restrictions' },
  { id: 'improvements', name: 'Tenant Improvements' },
  { id: 'subletting', name: 'Assignment & Subletting' },
  { id: 'cam', name: 'CAM & Operating Expenses' },
  { id: 'other', name: 'Other' },
];

export async function getClauses() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('clauses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(c => ({
    ...c,
    clauseText: c.clause_text || c.clauseText,
    sourceLease: c.source_lease || c.sourceLease,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));
}

export async function saveClause(clauseData) {
  const userId = await getUserId();
  const now = new Date().toISOString();

  const dbRecord = {
    user_id: userId,
    title: clauseData.title || '',
    category: clauseData.category || 'other',
    clause_text: clauseData.clauseText || '',
    notes: clauseData.notes || '',
    source_lease: clauseData.sourceLease || '',
    tags: clauseData.tags || [],
    updated_at: now,
  };

  if (clauseData.id) {
    const { data, error } = await supabase
      .from('clauses')
      .update(dbRecord)
      .eq('id', clauseData.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    dbRecord.created_at = now;
    const { data, error } = await supabase
      .from('clauses')
      .insert(dbRecord)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

export async function deleteClause(id) {
  const { error } = await supabase
    .from('clauses')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ============ CHAT ============
export function getChatContext(contextType, contextData) {
  if (contextType === 'company' && contextData) {
    return `You are helping a CRE broker research a company. Company: ${contextData.organizationName || 'Unknown'}. ${contextData.industry ? `Industry: ${contextData.industry}.` : ''} ${contextData.city ? `Location: ${contextData.city}, ${contextData.state || ''}.` : ''}`;
  }
  if (contextType === 'deal' && contextData) {
    return `You are helping a CRE broker with a deal. Client: ${contextData.clientName || 'Unknown'}. Stage: ${contextData.stage || 'Unknown'}. ${contextData.propertyType ? `Property Type: ${contextData.propertyType}.` : ''} ${contextData.squareFeet ? `Size: ${contextData.squareFeet} SF.` : ''}`;
  }
  if (contextType === 'prospect' && contextData) {
    return `You are helping a CRE broker with a prospect. Company: ${contextData.organizationName || 'Unknown'}. Status: ${contextData.prospectStatus || 'Unknown'}. ${contextData.crmStage ? `CRM Stage: ${contextData.crmStage}.` : ''}`;
  }
  return 'You are a helpful assistant for a commercial real estate broker. Help with deals, prospects, market research, and outreach.';
}

export async function sendChatMessage(messages, context) {
  const settings = await getSettings();
  if (!settings.proxyUrl) throw new Error('Proxy URL not configured. Go to Settings.');

  const fullMessages = context
    ? [{ role: 'system', content: context }, ...messages]
    : messages;

  const res = await fetch(`${settings.proxyUrl}/chat`, {
    method: 'POST',
    headers: await getProxyHeaders(),
    body: JSON.stringify({
      messages: fullMessages,
      perplexityApiKey: settings.perplexityApiKey || '',
      apolloApiKey: settings.apolloApiKey || '',
      exaApiKey: settings.exaApiKey || '',
      firecrawlApiKey: settings.firecrawlApiKey || '',
    }),
  });

  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  return res.json();
}

// ============ DASHBOARD STATS ============
export async function getDashboardStats() {
  const [deals, prospects, commissions, followUps, activityLog] = await Promise.all([
    getDeals(),
    getProspects(),
    getCommissions(),
    getFollowUps(),
    getActivityLog(),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  const weekFromNow = new Date(today);
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  const pendingFollowUps = followUps.filter(f => !f.completed);
  const overdueFollowUps = pendingFollowUps.filter(f => new Date(f.dueDate || f.due_date) < today);
  const todayFollowUps = pendingFollowUps.filter(f => (f.dueDate || f.due_date || '')?.split('T')[0] === todayStr);
  const thisWeekFollowUps = pendingFollowUps.filter(f => {
    const dueDate = new Date(f.dueDate || f.due_date);
    return dueDate >= today && dueDate <= weekFromNow;
  });

  const dealsByStage = DEAL_STAGES.reduce((acc, stage) => {
    acc[stage.id] = deals.filter(d => d.stage === stage.id).length;
    return acc;
  }, {});

  const projectedCommissions = commissions
    .filter(c => c.status === 'projected' || c.status === 'in_contract')
    .reduce((sum, c) => sum + (c.calculatedAmount || c.calculated_amount || 0), 0);

  const closedCommissions = commissions
    .filter(c => c.status === 'closed')
    .reduce((sum, c) => sum + (c.calculatedAmount || c.calculated_amount || 0), 0);

  const paidCommissions = commissions
    .filter(c => c.status === 'paid')
    .reduce((sum, c) => sum + (c.calculatedAmount || c.calculated_amount || 0), 0);

  const hotProspects = prospects.filter(p => (p.prospectStatus || p.prospect_status) === '🔥 Hot Prospect').length;

  return {
    deals: {
      total: deals.length,
      byStage: dealsByStage,
      closedThisMonth: deals.filter(d => {
        if (d.stage !== 'closed') return false;
        const history = d.stageHistory || d.stage_history || [];
        const closedDate = history.find(h => h.stage === 'closed')?.date;
        if (!closedDate) return false;
        const date = new Date(closedDate);
        return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
      }).length,
    },
    prospects: {
      total: prospects.length,
      hotProspects,
      byStage: PROSPECT_STAGES.reduce((acc, stage) => {
        acc[stage.id] = prospects.filter(p => (p.crmStage || p.crm_stage) === stage.id).length;
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
    recentActivity: activityLog.slice(0, 10),
  };
}
