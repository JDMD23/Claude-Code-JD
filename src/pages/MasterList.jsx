import { useState, useEffect, useRef } from 'react';
import { Upload, Search, Filter, X, Users, Building2, DollarSign, Briefcase, ExternalLink, Check, ChevronDown, ChevronLeft, ChevronRight, Play, Loader, Plus, Globe, Newspaper, Mail, Copy, UserCheck, MapPin, Award, Trash2 } from 'lucide-react';
import { getMasterList, addToMasterList, saveMasterList, saveProspect, getProspects, PROSPECT_STAGES, runResearchAgent, getSettings } from '../store/dataStore';
import './Pages.css';
import './DealPipeline.css';

const PAGE_SIZE = 50;

const TIERS = [
  { id: 'tier_1_nyc_seed', label: 'NYC Seed ($4M+)', color: '#22c55e' },
  { id: 'tier_2_nyc_growth', label: 'NYC Growth (A/B)', color: '#3b82f6' },
  { id: 'tier_3_sf_expansion', label: 'SF Expansion (B/C)', color: '#f59e0b' },
  { id: 'tier_4_europe_expansion', label: 'Europe Expansion (C+)', color: '#8b5cf6' },
  { id: 'all', label: 'All Companies', color: '#6b7280' },
];

// Get domain from website URL for Clearbit logo
function getDomain(website) {
  if (!website) return null;
  try {
    let domain = website.replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    return domain;
  } catch {
    return null;
  }
}

// Company Logo component with fallback
function CompanyLogo({ website, name, size = 32 }) {
  const [hasError, setHasError] = useState(false);
  const domain = getDomain(website);

  if (!domain || hasError) {
    return (
      <div
        className="company-logo-fallback"
        style={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: '6px',
          backgroundColor: 'var(--bg-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.45,
          fontWeight: 600,
          color: 'var(--text-secondary)'
        }}
      >
        {name?.charAt(0)?.toUpperCase() || '?'}
      </div>
    );
  }

  return (
    <img
      src={`https://logo.clearbit.com/${domain}`}
      alt={`${name} logo`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '6px',
        objectFit: 'contain',
        backgroundColor: 'white'
      }}
      onError={() => setHasError(true)}
    />
  );
}

// Parse CSV text into array of objects
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  const parseRow = (row) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    data.push(row);
  }

  return data;
}

// Case-insensitive field lookup with fallback
function get(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  const rowKeysLower = Object.keys(row).reduce((acc, k) => { acc[k.toLowerCase().trim()] = row[k]; return acc; }, {});
  for (const key of keys) {
    const val = rowKeysLower[key.toLowerCase().trim()];
    if (val !== undefined && val !== '') return val;
  }
  return '';
}

// Map CSV columns to our data structure
function mapCompanyData(rawData) {
  return rawData.map(row => ({
    // Company Info
    organizationName: get(row, 'Organization Name', 'Company Name', 'Name'),
    website: get(row, 'Website', 'Homepage URL', 'Website URL', 'URL'),
    crunchbaseUrl: get(row, 'Organization Name URL', 'CrunchBase URL', 'CB URL'),
    linkedin: get(row, 'LinkedIn', 'LinkedIn URL'),
    foundedYear: get(row, 'Founded Year', 'Founded Date', 'Founded'),
    description: get(row, 'Description', 'Short Description', 'Full Description'),
    headquarters: get(row, 'Headquarters Location', 'Headquarters', 'HQ'),
    industries: get(row, 'Industries'),
    founders: get(row, 'Founders'),

    // Funding Info
    topInvestors: get(row, 'Top 5 Investors', 'Investors'),
    leadInvestors: get(row, 'Lead Investors'),
    fundingRounds: get(row, 'Number of Funding Rounds', 'Funding Rounds'),
    lastFundingDate: get(row, 'Last Funding Date'),
    lastFundingType: get(row, 'Last Funding Type'),
    lastFundingAmount: get(row, 'Last Funding (USD Short)', 'Last Funding Amount (in USD)', 'Last Equity Funding Amount (in USD)', 'Last Funding Amount'),
    totalFunding: get(row, 'Total Funding (USD Short)', 'Total Funding Amount (in USD)', 'Total Equity Funding Amount (in USD)', 'Total Funding'),
    cbRank: get(row, 'CB Rank (Company)', 'CB Rank (Organization)', 'CB Rank'),

    // Enrichment Data
    employeeCount: get(row, 'Employee Count', 'Number of Employees', 'Employees', 'Size'),
    headcountFilter: get(row, 'Headcount Filter'),
    careersUrl: get(row, 'Careers URL'),
    totalJobs: get(row, 'Total Jobs'),
    nycJobs: get(row, 'NYC Jobs'),
    remoteJobs: get(row, 'Remote Jobs'),
    hybridJobs: get(row, 'Hybrid Jobs'),
    inOfficeJobs: get(row, 'In-Office Jobs'),
    departmentsHiring: get(row, 'Departments Hiring'),
    workPolicyQuote: get(row, 'Work Policy Quote'),
    nycOfficeConfirmed: get(row, 'NYC Office Confirmed'),
    nycAddress: get(row, 'NYC Address'),
    excludeRemoteOnly: get(row, 'Exclude Remote Only'),

    // Scoring
    prospectScore: get(row, 'Prospect Score'),
    prospectStatus: get(row, 'Prospect Status'),

    // Contacts
    keyContacts: get(row, 'Key Contacts'),
  }));
}

// Parse funding string to number
function parseFundingToNumber(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/[$,\s]/g, '').toUpperCase();
  const num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return 0;
  if (cleaned.includes('B')) return num * 1000000000;
  if (cleaned.includes('M')) return num * 1000000;
  if (cleaned.includes('K')) return num * 1000;
  return num;
}

// Auto-assign tier based on HQ location and funding stage
function autoAssignTier(company) {
  const hq = (company.headquarters || '').toLowerCase();
  const fundingType = (company.lastFundingType || '').toLowerCase();
  const fundingAmount = parseFundingToNumber(company.totalFunding || company.lastFundingAmount || '');

  const isNYC = hq.includes('new york') || hq.includes('nyc') || hq.includes('manhattan') || hq.includes('brooklyn');
  const isSF = hq.includes('san francisco') || hq.includes('sf') || hq.includes('bay area');
  const isEurope = ['london', 'berlin', 'paris', 'amsterdam', 'dublin', 'stockholm', 'united kingdom', 'germany', 'france', 'netherlands', 'ireland', 'sweden', 'switzerland', 'spain', 'italy'].some(loc => hq.includes(loc));

  const isSeed = fundingType.includes('seed') || fundingType.includes('pre-seed');
  const isSeriesA = fundingType.includes('series a');
  const isSeriesB = fundingType.includes('series b');
  const isSeriesC = fundingType.includes('series c');
  const isSeriesDPlus = fundingType.includes('series d') || fundingType.includes('series e') || fundingType.includes('series f');

  if (isNYC && isSeed && fundingAmount >= 4000000) return 'tier_1_nyc_seed';
  if (isNYC && (isSeriesA || isSeriesB)) return 'tier_2_nyc_growth';
  if (isSF && (isSeriesB || isSeriesC)) return 'tier_3_sf_expansion';
  if (isEurope && (isSeriesC || isSeriesDPlus)) return 'tier_4_europe_expansion';

  return null;
}

// Unified Company Profile Modal with tabs
function CompanyModal({ company, onClose, onRunAgent, agentStatus, onTierChange }) {
  const [activeTab, setActiveTab] = useState('overview');

  if (!company) return null;

  const dossier = company.dossier || {};

  const InfoRow = ({ label, value, isLink }) => {
    if (!value) return null;
    return (
      <div className="info-row">
        <span className="info-label">{label}</span>
        {isLink ? (
          <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" className="info-value link">
            {value} <ExternalLink size={12} />
          </a>
        ) : (
          <span className="info-value">{value}</span>
        )}
      </div>
    );
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'funding', label: 'Funding & Investors', icon: DollarSign },
    { id: 'team', label: 'Team', icon: Users },
    { id: 'nyc', label: 'NYC Intel', icon: MapPin },
    { id: 'hiring', label: 'Hiring', icon: Briefcase },
    { id: 'news', label: 'News', icon: Newspaper },
    { id: 'outreach', label: 'Outreach', icon: Mail },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <CompanyLogo website={company.website} name={company.organizationName} size={48} />
            <div>
              <h2>{company.organizationName}</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
                {company.prospectStatus && (
                  <span className={`prospect-badge ${getProspectBadgeClass(company.prospectStatus)}`}>
                    {company.prospectStatus}
                  </span>
                )}
                {company.cbRank && (
                  <span className="prospect-badge low">CB Rank: {company.cbRank}</span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {onRunAgent && (
              <button
                className="btn btn-secondary"
                onClick={(e) => { e.stopPropagation(); onRunAgent(company); }}
                disabled={agentStatus === 'running'}
                style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
              >
                {agentStatus === 'running' ? <Loader size={14} className="spinning" /> : <Play size={14} />}
                {agentStatus === 'running' ? 'Researching...' : 'Run Agent'}
              </button>
            )}
            <button className="modal-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="profile-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`profile-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={14} style={{ marginRight: '0.25rem' }} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {activeTab === 'overview' && (
            <div>
              <InfoRow label="Website" value={company.website} isLink />
              <InfoRow label="LinkedIn" value={company.linkedin} isLink />
              <InfoRow label="Crunchbase" value={company.crunchbaseUrl} isLink />
              <InfoRow label="Description" value={company.description || dossier.description} />
              <InfoRow label="Industries" value={company.industries} />
              <InfoRow label="Headquarters" value={company.headquarters || dossier.headquarters} />
              <InfoRow label="Founded" value={company.foundedYear} />
              <InfoRow label="Employees" value={company.employeeCount || dossier.employeeCount} />
              <InfoRow label="CB Rank" value={company.cbRank} />
              <div className="info-row">
                <span className="info-label">Prospect Tier</span>
                <select
                  value={company.tier || ''}
                  onChange={(e) => onTierChange && onTierChange(company.id, e.target.value || null)}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                >
                  <option value="">Unassigned</option>
                  {TIERS.filter(t => t.id !== 'all').map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {activeTab === 'funding' && (
            <div>
              <div className="info-section">
                <h4><DollarSign size={16} /> Funding Details</h4>
                <InfoRow label="Total Funding" value={company.totalFunding} />
                <InfoRow label="Last Amount" value={company.lastFundingAmount} />
                <InfoRow label="Last Type" value={company.lastFundingType} />
                <InfoRow label="Last Date" value={company.lastFundingDate} />
                <InfoRow label="Rounds" value={company.fundingRounds} />
              </div>
              <div className="info-section">
                <h4><Award size={16} /> Investors</h4>
                <InfoRow label="Top 5" value={company.topInvestors} />
                <InfoRow label="Lead" value={company.leadInvestors} />
                {dossier.investorScore !== undefined && (
                  <InfoRow label="Investor Score" value={`${dossier.investorScore}/3`} />
                )}
              </div>
            </div>
          )}

          {activeTab === 'team' && (
            <div>
              <div className="info-section">
                <h4><UserCheck size={16} /> Founders</h4>
                {company.founders ? (
                  <InfoRow label="Founders" value={company.founders} />
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No founder data. Run the research agent to discover founders.</p>
                )}
                {dossier.founders && dossier.founders.length > 0 && (
                  dossier.founders.map((f, i) => (
                    <div key={i} style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ fontWeight: 600 }}>{f.name}</div>
                      {f.title && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{f.title}</div>}
                      {f.linkedin && <InfoRow label="LinkedIn" value={f.linkedin} isLink />}
                      {f.background && <div style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>{f.background}</div>}
                    </div>
                  ))
                )}
              </div>
              <div className="info-section">
                <h4><Users size={16} /> Decision Makers</h4>
                {dossier.decisionMakers && dossier.decisionMakers.length > 0 ? (
                  dossier.decisionMakers.map((dm, i) => (
                    <div key={i} style={{ marginBottom: '0.5rem' }}>
                      <InfoRow label={dm.title || 'Contact'} value={`${dm.name}${dm.email ? ` - ${dm.email}` : ''}`} />
                    </div>
                  ))
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No contacts yet. Run the research agent.</p>
                )}
                <InfoRow label="Key Contacts" value={company.keyContacts} />
              </div>
            </div>
          )}

          {activeTab === 'nyc' && (
            <div>
              <InfoRow label="NYC Office" value={company.nycOfficeConfirmed === 'Yes' ? 'Confirmed' : company.nycOfficeConfirmed === 'No' ? 'Not confirmed' : 'Unknown'} />
              <InfoRow label="NYC Address" value={company.nycAddress || dossier.nycAddress} />
              <InfoRow label="Headquarters" value={company.headquarters} />
              {dossier.nycIntel && <InfoRow label="Intel" value={dossier.nycIntel} />}
            </div>
          )}

          {activeTab === 'hiring' && (
            <div>
              <InfoRow label="Headcount Filter" value={company.headcountFilter} />
              <InfoRow label="Total Jobs" value={company.totalJobs} />
              <InfoRow label="NYC Jobs" value={company.nycJobs} />
              <InfoRow label="Remote Jobs" value={company.remoteJobs} />
              <InfoRow label="Hybrid Jobs" value={company.hybridJobs} />
              <InfoRow label="In-Office Jobs" value={company.inOfficeJobs} />
              <InfoRow label="Departments Hiring" value={company.departmentsHiring} />
              <InfoRow label="Work Policy" value={company.workPolicyQuote} />
              <InfoRow label="Careers Page" value={company.careersUrl || dossier.careersUrl} isLink={!!(company.careersUrl || dossier.careersUrl)} />
              {dossier.hiringIntel && <InfoRow label="Hiring Intel" value={dossier.hiringIntel} />}
            </div>
          )}

          {activeTab === 'news' && (
            <div>
              {dossier.news && dossier.news.length > 0 ? (
                dossier.news.map((article, i) => (
                  <div key={i} style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                    <a href={article.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                      {article.title} <ExternalLink size={12} />
                    </a>
                    {article.type && <span className="prospect-badge low" style={{ marginLeft: '0.5rem' }}>{article.type}</span>}
                    {article.date && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{article.date}</div>}
                    {article.snippet && <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{article.snippet}</p>}
                  </div>
                ))
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No news articles. Run the research agent to find recent coverage.</p>
              )}
            </div>
          )}

          {activeTab === 'outreach' && (
            <div>
              {dossier.outreachEmail ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0 }}>Generated Email</h4>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                      onClick={() => navigator.clipboard.writeText(dossier.outreachEmail)}
                    >
                      <Copy size={14} /> Copy
                    </button>
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', background: 'var(--bg-tertiary)', padding: '1rem', borderRadius: 'var(--radius-md)', lineHeight: 1.5, fontFamily: 'inherit' }}>
                    {dossier.outreachEmail}
                  </pre>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No outreach email generated. Run the research agent to create one.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Add to CRM Modal
function AddToCRMModal({ selectedCompanies, onClose, onAdd }) {
  const [stage, setStage] = useState('top_pursuits');

  const handleSubmit = () => {
    onAdd(selectedCompanies, stage);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-small" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add to CRM</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ marginBottom: '1rem' }}>
            Adding <strong>{selectedCompanies.length}</strong> {selectedCompanies.length === 1 ? 'company' : 'companies'} to CRM
          </p>

          <div className="form-group">
            <label>Select CRM Stage</label>
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              {PROSPECT_STAGES.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            <Check size={18} />
            Add to CRM
          </button>
        </div>
      </div>
    </div>
  );
}

function getProspectBadgeClass(status) {
  if (!status) return '';
  if (status.includes('Hot')) return 'hot';
  if (status.includes('Worth') || status.includes('Look')) return 'look';
  return 'low';
}

function MasterList() {
  const [companies, setCompanies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showCRMModal, setShowCRMModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const [agentStatus, setAgentStatus] = useState(null); // null | 'running' | 'done' | 'error'
  const [quickAddDomain, setQuickAddDomain] = useState('');
  const [activeTier, setActiveTier] = useState('all');
  const [filters, setFilters] = useState({
    prospectStatus: '',
    nycOffice: '',
    fundingStage: '',
  });
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        let data = await getMasterList();
        // Backfill tiers for companies that don't have one
        let needsSave = false;
        data = data.map(c => {
          if (!c.tier) {
            const tier = autoAssignTier(c);
            if (tier) {
              needsSave = true;
              return { ...c, tier };
            }
          }
          return c;
        });
        if (needsSave) await saveMasterList(data);
        setCompanies(data);
      } catch (err) {
        console.error('Failed to load master list:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Handle file upload
  const handleFileUpload = async (file) => {
    if (!file || !file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    const text = await file.text();
    const rawData = parseCSV(text);
    let mappedData = mapCompanyData(rawData);

    // If user is on a specific tier tab, assign that tier to all imported companies
    if (activeTier !== 'all') {
      mappedData = mappedData.map(c => ({ ...c, tier: activeTier }));
    } else {
      mappedData = mappedData.map(c => ({ ...c, tier: c.tier || autoAssignTier(c) }));
    }

    if (mappedData.length > 0) {
      try {
        const { companies: updated, added, skipped } = await addToMasterList(mappedData);
        setCompanies(updated);
        alert(`Imported ${added} new${skipped > 0 ? `, ${skipped} duplicates skipped` : ''}.`);
      } catch (err) {
        console.error('Failed to import companies:', err);
        alert('Failed to import companies: ' + err.message);
      }
    } else {
      alert('No data found in CSV file');
    }
  };

  // Quick Add by domain
  const handleQuickAdd = async () => {
    const domain = quickAddDomain.trim().replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!domain) return;

    const companyData = {
      organizationName: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
      website: `https://${domain}`,
    };

    try {
      const { companies: updated, added } = await addToMasterList([companyData]);
      setCompanies(updated);
      setQuickAddDomain('');

      if (added === 0) {
        alert('Company already exists in master list.');
        return;
      }

      // Auto-enrich if enabled
      const settings = await getSettings();
      if (settings.autoEnrich && settings.proxyUrl) {
        const newCompany = updated.find(c => getDomain(c.website) === domain);
        if (newCompany) {
          handleRunAgent(newCompany);
        }
      }
    } catch (err) {
      console.error('Failed to quick add:', err);
      alert('Failed to add company: ' + err.message);
    }
  };

  // Run research agent on a company
  const handleRunAgent = async (company) => {
    const domain = getDomain(company.website);
    if (!domain) {
      alert('No website domain available for this company.');
      return;
    }

    setAgentStatus('running');

    try {
      const result = await runResearchAgent(domain, (progress) => {
        // Could show step-by-step progress in the UI
        console.log('Agent progress:', progress);
      }, company);

      if (!result) {
        throw new Error('Agent returned no results. The worker may have timed out — check that your API keys (Perplexity, Apollo, etc.) are configured in Settings.');
      }

      // Merge dossier into the company record + promote key fields to top level
      const currentList = await getMasterList();
      const updatedCompanies = currentList.map(c => {
        if (c.id === company.id) {
          return {
            ...c,
            dossier: result,
            lastResearchedAt: new Date().toISOString(),
            // Merge dossier fields to top level (don't overwrite CSV data)
            description: c.description || result.company?.description || '',
            employeeCount: c.employeeCount || result.company?.employeeCount || '',
            headquarters: c.headquarters || result.company?.headquarters || '',
            nycAddress: c.nycAddress || result.nycAddress || '',
            nycOfficeConfirmed: result.nycAddress ? 'Yes' : c.nycOfficeConfirmed || '',
            hiringStatus: result.hiringIntel ? 'Active' : c.hiringStatus || '',
            careersUrl: c.careersUrl || result.careersUrl || '',
            // Scoring
            investorScore: result.investorScore,
            fundingScore: result.fundingScore,
            prospectScore: (result.investorScore || 0) + (result.fundingScore || 0),
          };
        }
        return c;
      });
      await saveMasterList(updatedCompanies);
      setCompanies(updatedCompanies);

      // Refresh the selected company view
      const refreshed = updatedCompanies.find(c => c.id === company.id);
      if (refreshed) setSelectedCompany(refreshed);

      setAgentStatus('done');
      setTimeout(() => setAgentStatus(null), 2000);
    } catch (err) {
      console.error('Agent error:', err);
      alert(`Research agent error: ${err.message}`);
      setAgentStatus('error');
      setTimeout(() => setAgentStatus(null), 2000);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleFileUpload(file);
  };

  // Selection handlers
  const toggleSelect = (id) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (selectedIds.size === filteredCompanies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCompanies.map(c => c.id)));
    }
  };

  // Add to CRM
  const handleAddToCRM = async (companiesToAdd, stage) => {
    try {
      const prospects = await getProspects();
      const existingIds = new Set(prospects.map(p => p.masterListId));

      for (const company of companiesToAdd) {
        if (!existingIds.has(company.id)) {
          await saveProspect({
            ...company,
            masterListId: company.id,
            crmStage: stage,
          });
        }
      }

      setSelectedIds(new Set());
      setShowCRMModal(false);
      alert(`Added ${companiesToAdd.length} companies to CRM!`);
    } catch (err) {
      console.error('Failed to add to CRM:', err);
      alert('Failed to add companies to CRM: ' + err.message);
    }
  };

  // Filter companies
  const filteredCompanies = companies.filter(company => {
    // Tier filter (applied first)
    if (activeTier !== 'all') {
      if (company.tier !== activeTier) return false;
    }

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const matchesSearch =
        company.organizationName?.toLowerCase().includes(search) ||
        company.description?.toLowerCase().includes(search) ||
        company.headquarters?.toLowerCase().includes(search) ||
        company.topInvestors?.toLowerCase().includes(search) ||
        company.founders?.toLowerCase().includes(search) ||
        company.nycAddress?.toLowerCase().includes(search);
      if (!matchesSearch) return false;
    }

    if (filters.prospectStatus && company.prospectStatus !== filters.prospectStatus) {
      return false;
    }

    if (filters.nycOffice) {
      if (filters.nycOffice === 'yes' && company.nycOfficeConfirmed !== 'Yes') return false;
      if (filters.nycOffice === 'no' && company.nycOfficeConfirmed === 'Yes') return false;
    }

    if (filters.fundingStage) {
      if (filters.fundingStage === 'ok' && company.fundingStageOK !== 'Yes') return false;
      if (filters.fundingStage === 'not_ok' && company.fundingStageOK === 'Yes') return false;
    }

    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filteredCompanies.length / PAGE_SIZE);
  const pagedCompanies = filteredCompanies.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [searchTerm, filters, activeTier]);

  // Tier change handler (used by CompanyModal and bulk actions)
  const handleTierChange = async (companyId, newTier) => {
    const updated = companies.map(c =>
      c.id === companyId ? { ...c, tier: newTier } : c
    );
    try {
      await saveMasterList(updated);
      setCompanies(updated);
      if (selectedCompany && selectedCompany.id === companyId) {
        setSelectedCompany({ ...selectedCompany, tier: newTier });
      }
    } catch (err) {
      console.error('Failed to update tier:', err);
    }
  };

  const selectedCompanies = filteredCompanies.filter(c => selectedIds.has(c.id));

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>Loading...</div>;

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Master List</h1>
          <p>{companies.length > 0 ? `${companies.length} companies` : 'Your complete company database from Crunchbase exports'}</p>
        </div>
        <div className="header-actions">
          {selectedIds.size > 0 && (
            <>
              <select
                onChange={async (e) => {
                  if (!e.target.value) return;
                  const newTier = e.target.value;
                  const updated = companies.map(c =>
                    selectedIds.has(c.id) ? { ...c, tier: newTier } : c
                  );
                  try {
                    await saveMasterList(updated);
                    setCompanies(updated);
                    setSelectedIds(new Set());
                  } catch (err) {
                    console.error('Failed to set tiers:', err);
                  }
                  e.target.value = '';
                }}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
              >
                <option value="">Set Tier...</option>
                {TIERS.filter(t => t.id !== 'all').map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={() => setShowCRMModal(true)}>
                <Users size={18} />
                Add {selectedIds.size} to CRM
              </button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} />
            Import CSV
          </button>
          {companies.length > 0 && (
            <button
              className="btn"
              style={{ color: '#ef4444', borderColor: '#ef4444' }}
              onClick={async () => {
                if (window.confirm(`Delete all ${companies.length} companies from the master list? This cannot be undone.`)) {
                  try {
                    await saveMasterList([]);
                    setCompanies([]);
                    setSelectedIds(new Set());
                  } catch (err) {
                    console.error('Failed to delete all:', err);
                  }
                }
              }}
            >
              <Trash2 size={18} />
              Delete All
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={(e) => handleFileUpload(e.target.files[0])}
          />
        </div>
      </div>

      {companies.length === 0 ? (
        <div
          className={`upload-area ${isDragging ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={48} className="upload-icon" />
          <h4>Drop your CSV file here</h4>
          <p>or click to browse</p>
          <p className="text-muted" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
            Supports Crunchbase export format with company info, funding data, and investor details
          </p>
        </div>
      ) : (
        <>
          {/* Quick Add */}
          <div className="quick-add-bar">
            <input
              type="text"
              placeholder="Quick add by domain (e.g. company.com)"
              value={quickAddDomain}
              onChange={(e) => setQuickAddDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQuickAdd()}
            />
            <button className="btn btn-primary" onClick={handleQuickAdd}>
              <Plus size={18} />
              Add
            </button>
          </div>

          {/* Tier Tabs */}
          <div className="tier-tabs">
            {TIERS.map(tier => {
              const count = tier.id === 'all'
                ? companies.length
                : companies.filter(c => c.tier === tier.id).length;
              return (
                <button
                  key={tier.id}
                  className={`tier-tab ${activeTier === tier.id ? 'active' : ''}`}
                  onClick={() => { setActiveTier(tier.id); setPage(0); }}
                  style={activeTier === tier.id ? { borderBottomColor: tier.color, color: tier.color } : {}}
                >
                  {tier.label}
                  <span className="tier-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="table-toolbar">
            <div className="search-box">
              <Search size={18} className="search-icon" />
              <input
                type="text"
                placeholder="Search companies..."
                className="search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingLeft: '2.5rem' }}
              />
            </div>
            <div className="filter-group">
              <button
                className={`btn btn-secondary ${showFilters ? 'active' : ''}`}
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter size={18} />
                Filters
                <ChevronDown size={16} />
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="filter-panel">
              <select
                value={filters.prospectStatus}
                onChange={(e) => setFilters(f => ({ ...f, prospectStatus: e.target.value }))}
              >
                <option value="">All Prospect Statuses</option>
                <option value="🔥 Hot Prospect">Hot Prospect</option>
                <option value="👀 Worth a Look">Worth a Look</option>
                <option value="❄️ Low Priority">Low Priority</option>
                <option value="❌ Remote Only">Remote Only</option>
                <option value="❌ No NYC Presence">No NYC Presence</option>
              </select>

              <select
                value={filters.nycOffice}
                onChange={(e) => setFilters(f => ({ ...f, nycOffice: e.target.value }))}
              >
                <option value="">NYC Office - All</option>
                <option value="yes">NYC Office Confirmed</option>
                <option value="no">NYC Office Not Confirmed</option>
              </select>

              <select
                value={filters.fundingStage}
                onChange={(e) => setFilters(f => ({ ...f, fundingStage: e.target.value }))}
              >
                <option value="">Funding Stage - All</option>
                <option value="ok">Funding Stage OK</option>
                <option value="not_ok">Funding Stage Not OK</option>
              </select>

              <button
                className="btn btn-secondary"
                onClick={() => setFilters({ prospectStatus: '', nycOffice: '', fundingStage: '' })}
              >
                Clear Filters
              </button>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.size === filteredCompanies.length && filteredCompanies.length > 0}
                        onChange={selectAll}
                      />
                    </th>
                    <th>Company</th>
                    <th>HQ</th>
                    <th>Funding</th>
                    <th>Last Round</th>
                    <th>Employees</th>
                    <th>NYC Office</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCompanies.map(company => (
                    <tr
                      key={company.id}
                      onClick={() => setSelectedCompany(company)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(company.id)}
                          onChange={() => toggleSelect(company.id)}
                        />
                      </td>
                      <td className="primary-cell">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <CompanyLogo website={company.website} name={company.organizationName} size={32} />
                          <div>
                            <div>
                              {company.organizationName}
                              {company.tier && (
                                <span
                                  className="tier-dot"
                                  style={{ backgroundColor: TIERS.find(t => t.id === company.tier)?.color || '#6b7280' }}
                                  title={TIERS.find(t => t.id === company.tier)?.label}
                                />
                              )}
                            </div>
                            {company.website && (
                              <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                                {company.website.replace(/https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '')}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{company.headquarters || '-'}</td>
                      <td>{company.totalFunding || '-'}</td>
                      <td>
                        {company.lastFundingAmount ? (
                          <>
                            {company.lastFundingAmount}
                            {company.lastFundingType && <span className="text-muted"> ({company.lastFundingType})</span>}
                          </>
                        ) : '-'}
                      </td>
                      <td>{company.employeeCount || '-'}</td>
                      <td>
                        {company.nycOfficeConfirmed === 'Yes' ? 'Yes' :
                         company.nycOfficeConfirmed === 'No' ? 'No' : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="pagination">
                <button
                  className="btn btn-secondary"
                  onClick={() => setPage(p => p - 1)}
                  disabled={page === 0}
                  style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
                >
                  <ChevronLeft size={16} /> Previous
                </button>
                <span>Page {page + 1} of {totalPages} ({filteredCompanies.length} companies)</span>
                <button
                  className="btn btn-secondary"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages - 1}
                  style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {selectedCompany && (
        <CompanyModal
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
          onRunAgent={handleRunAgent}
          agentStatus={agentStatus}
          onTierChange={handleTierChange}
        />
      )}

      {showCRMModal && (
        <AddToCRMModal
          selectedCompanies={selectedCompanies}
          onClose={() => setShowCRMModal(false)}
          onAdd={handleAddToCRM}
        />
      )}
    </div>
  );
}

export default MasterList;
