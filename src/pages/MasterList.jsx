import { useState, useEffect, useRef } from 'react';
import { Upload, Search, Filter, X, Users, Building2, DollarSign, Briefcase, ExternalLink, Check, ChevronDown, LayoutGrid, List, MapPin, TrendingUp, Plus, Globe, Zap, Loader, Trash2, Bot, Mail, Newspaper, UserCheck, Copy, CheckCircle } from 'lucide-react';
import { getMasterList, addToMasterList, saveMasterList, saveProspect, getProspects, PROSPECT_STAGES, enrichCompany, runResearchAgent, AGENT_STEPS } from '../store/dataStore';
import './Pages.css';
import './DealPipeline.css';
import './MasterList.css';

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

// Map CSV columns to our data structure
function mapCompanyData(rawData) {
  return rawData.map(row => ({
    organizationName: row['Organization Name'] || row['Company Name'] || row['Name'] || '',
    website: row['Website'] || row['URL'] || '',
    linkedin: row['LinkedIn'] || row['LinkedIn URL'] || '',
    foundedDate: row['Founded Date'] || row['Founded'] || '',
    description: row['Description'] || '',
    topInvestors: row['Top 5 Investors'] || row['Investors'] || '',
    fundingRounds: row['Number of Funding Rounds'] || row['Funding Rounds'] || '',
    lastFundingDate: row['Last Funding Date'] || '',
    lastFundingType: row['Last Funding Type'] || '',
    lastFundingAmount: row['Last Funding Amount (in USD)'] || row['Last Funding Amount'] || '',
    totalFunding: row['Total Funding Amount (in USD)'] || row['Total Funding'] || '',
    fundingInRange: row['Funding in Range'] || '',
    fundingStageOK: row['Funding Stage OK'] || '',
    employeeCount: row['Employee Count'] || row['Employees'] || row['Size'] || '',
    headcountFilter: row['Headcount Filter'] || '',
    careersUrl: row['Careers URL'] || '',
    totalJobs: row['Total Jobs'] || '',
    nycJobs: row['NYC Jobs'] || '',
    remoteJobs: row['Remote Jobs'] || '',
    hybridJobs: row['Hybrid Jobs'] || '',
    inOfficeJobs: row['In-Office Jobs'] || '',
    departmentsHiring: row['Departments Hiring'] || '',
    workPolicyQuote: row['Work Policy Quote'] || '',
    nycOfficeConfirmed: row['NYC Office Confirmed'] || '',
    nycAddress: row['NYC Address'] || '',
    excludeRemoteOnly: row['Exclude Remote Only'] || '',
    prospectScore: row['Prospect Score'] || '',
    prospectStatus: row['Prospect Status'] || '',
    keyContacts: row['Key Contacts'] || '',
  }));
}

function getProspectBadgeClass(status) {
  if (!status) return '';
  if (status.includes('Hot')) return 'hot';
  if (status.includes('Worth') || status.includes('Look')) return 'look';
  return 'low';
}

function formatFunding(amount) {
  if (!amount) return null;
  const num = parseInt(amount);
  if (isNaN(num)) return null;
  if (num >= 1000000000) return `$${(num / 1000000000).toFixed(1)}B`;
  if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
}

// Derive company name from domain
function nameFromDomain(domain) {
  const clean = domain.replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const name = clean.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Quick-Add Domain Input
function QuickAddDomain({ onAdd }) {
  const [value, setValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;

    // Clean the input — accept "stripe.com", "www.stripe.com", "https://stripe.com"
    let domain = raw.replace(/https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!domain.includes('.')) {
      domain = domain + '.com';
    }

    const companyName = nameFromDomain(domain);
    const website = `https://${domain}`;

    onAdd([{
      organizationName: companyName,
      website,
      description: '',
      employeeCount: '',
      nycJobs: '',
      lastFundingAmount: '',
      lastFundingType: '',
      totalFunding: '',
      prospectStatus: '',
      nycOfficeConfirmed: '',
      nycAddress: '',
    }]);

    setValue('');
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button className="btn btn-secondary quick-add-trigger" onClick={() => { setIsOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}>
        <Plus size={18} strokeWidth={1.5} />
        Quick Add
      </button>
    );
  }

  return (
    <form className="quick-add-form" onSubmit={handleSubmit}>
      <Globe size={16} strokeWidth={1.5} className="quick-add-icon" />
      <input
        ref={inputRef}
        type="text"
        className="quick-add-input"
        placeholder="stripe.com"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { if (!value.trim()) setIsOpen(false); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setValue(''); setIsOpen(false); } }}
      />
      <button type="submit" className="btn btn-primary quick-add-submit" disabled={!value.trim()}>
        Add
      </button>
    </form>
  );
}

// Dossier Card Component
function DossierCard({ company, isSelected, onSelect, onClick }) {
  return (
    <div
      className={`dossier-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onClick(company)}
    >
      <div className="dossier-select" onClick={(e) => { e.stopPropagation(); onSelect(company.id); }}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
        />
      </div>

      <div className="dossier-header">
        <CompanyLogo website={company.website} name={company.organizationName} size={40} />
        <div className="dossier-identity">
          <h4 className="dossier-name">{company.organizationName}</h4>
          {company.website && (
            <span className="dossier-domain">
              {company.website.replace(/https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '')}
            </span>
          )}
        </div>
      </div>

      {company.description && (
        <p className="dossier-desc">{company.description.length > 100 ? company.description.slice(0, 100) + '...' : company.description}</p>
      )}

      <div className="dossier-stats">
        {company.employeeCount && (
          <div className="dossier-stat">
            <Users size={13} strokeWidth={1.5} />
            <span>{company.employeeCount}</span>
          </div>
        )}
        {company.nycJobs && (
          <div className="dossier-stat">
            <MapPin size={13} strokeWidth={1.5} />
            <span>{company.nycJobs} NYC</span>
          </div>
        )}
        {company.lastFundingAmount && (
          <div className="dossier-stat">
            <TrendingUp size={13} strokeWidth={1.5} />
            <span>{formatFunding(company.lastFundingAmount)}</span>
            {company.lastFundingType && <span className="dossier-stat-sub">{company.lastFundingType}</span>}
          </div>
        )}
      </div>

      <div className="dossier-footer">
        {company.prospectStatus && (
          <span className={`prospect-badge ${getProspectBadgeClass(company.prospectStatus)}`}>
            {company.prospectStatus}
          </span>
        )}
        <span className="dossier-nyc-badge">
          {company.nycOfficeConfirmed === 'Yes' ? (
            <span className="nyc-confirmed"><MapPin size={12} strokeWidth={1.5} /> NYC</span>
          ) : company.nycOfficeConfirmed === 'No' ? (
            <span className="nyc-unconfirmed">No NYC</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

// Company Detail Modal
function CompanyModal({ company, onClose, onEnrich, onDelete, onRunAgent }) {
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState(null);

  if (!company) return null;

  const domain = getDomain(company.website);

  const handleEnrich = async () => {
    if (!domain) return;
    setEnriching(true);
    setEnrichResult(null);
    try {
      const result = await enrichCompany(domain);
      const hasData = Object.keys(result).length > 0;
      if (hasData) {
        onEnrich(company.id, result);
        setEnrichResult({ success: true, message: 'Company data updated!' });
      } else {
        setEnrichResult({ success: false, message: 'No data found for this domain.' });
      }
    } catch (err) {
      setEnrichResult({ success: false, message: err.message || 'Enrichment failed.' });
    }
    setEnriching(false);
  };

  const handleRunAgent = () => {
    if (domain && onRunAgent) {
      onRunAgent(domain);
      onClose(); // Close this modal, agent modal will open
    }
  };

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <CompanyLogo website={company.website} name={company.organizationName} size={48} />
            <div>
              <h2>{company.organizationName}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                {company.prospectStatus && (
                  <span className={`prospect-badge ${getProspectBadgeClass(company.prospectStatus)}`}>
                    {company.prospectStatus}
                  </span>
                )}
                {domain && (
                  <>
                    <button
                      className={`btn btn-secondary btn-sm enrich-btn ${enriching ? 'enriching' : ''}`}
                      onClick={handleEnrich}
                      disabled={enriching}
                      title={`Enrich ${domain}`}
                    >
                      {enriching ? <Loader size={14} strokeWidth={1.5} className="spin" /> : <Zap size={14} strokeWidth={1.5} />}
                      {enriching ? 'Enriching...' : 'Enrich'}
                    </button>
                    <button
                      className="btn btn-primary btn-sm agent-btn"
                      onClick={handleRunAgent}
                      title="Run full research agent"
                    >
                      <Bot size={14} strokeWidth={1.5} />
                      Run Agent
                    </button>
                  </>
                )}
              </div>
              {enrichResult && (
                <span className={`enrich-result ${enrichResult.success ? 'success' : 'error'}`}>
                  {enrichResult.message}
                </span>
              )}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div className="info-section">
            <h4><Building2 size={16} strokeWidth={1.5} /> Company Info</h4>
            <InfoRow label="Website" value={company.website} isLink />
            <InfoRow label="LinkedIn" value={company.linkedin} isLink />
            <InfoRow label="Founded" value={company.foundedDate} />
            <InfoRow label="Headquarters" value={company.headquarters} />
            <InfoRow label="Description" value={company.description} />
            <InfoRow label="NYC Address" value={company.nycAddress} />
            <InfoRow label="NYC Office Confirmed" value={company.nycOfficeConfirmed} />
          </div>

          <div className="info-section">
            <h4><Users size={16} strokeWidth={1.5} /> Team & Hiring</h4>
            <InfoRow label="Employee Count" value={company.employeeCount} />
            <InfoRow label="Hiring Status" value={company.hiringStatus} />
            <InfoRow label="Total Jobs" value={company.totalJobs} />
            <InfoRow label="NYC Jobs" value={company.nycJobs} />
            <InfoRow label="Key Roles Hiring" value={company.departmentsHiring} />
            <InfoRow label="Careers Page" value={company.careersUrl} isLink />
          </div>

          <div className="info-section">
            <h4><MapPin size={16} strokeWidth={1.5} /> Real Estate Intel</h4>
            <InfoRow label="Recent Lease News" value={company.recentLeaseNews} />
          </div>

          <div className="info-section">
            <h4><DollarSign size={16} strokeWidth={1.5} /> Funding</h4>
            <InfoRow label="Total Funding" value={company.totalFunding ? formatFunding(company.totalFunding) : ''} />
            <InfoRow label="Last Funding Amount" value={company.lastFundingAmount ? formatFunding(company.lastFundingAmount) : ''} />
            <InfoRow label="Last Funding Type" value={company.lastFundingType} />
            <InfoRow label="Last Funding Date" value={company.lastFundingDate} />
            <InfoRow label="Funding Rounds" value={company.fundingRounds} />
            <InfoRow label="Top Investors" value={company.topInvestors} />
            <InfoRow label="Funding in Range" value={company.fundingInRange} />
            <InfoRow label="Funding Stage OK" value={company.fundingStageOK} />
          </div>

          <div className="info-section">
            <h4><Briefcase size={16} strokeWidth={1.5} /> Scoring & Contacts</h4>
            <InfoRow label="Prospect Score" value={company.prospectScore} />
            <InfoRow label="Prospect Status" value={company.prospectStatus} />
            <InfoRow label="Key Contacts" value={company.keyContacts} />
          </div>

          <div className="modal-danger-zone">
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (confirm(`Remove "${company.organizationName}" from Master List?`)) {
                  onDelete(company.id);
                  onClose();
                }
              }}
            >
              <Trash2 size={14} strokeWidth={1.5} /> Remove from Master List
            </button>
          </div>
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

// Research Agent Dossier Modal
function DossierModal({ dossier, onClose }) {
  const [copiedEmail, setCopiedEmail] = useState(false);

  if (!dossier) return null;

  const copyEmail = () => {
    if (dossier.outreachEmail) {
      navigator.clipboard.writeText(dossier.outreachEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Bot size={24} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
            <div>
              <h2>Research Dossier: {dossier.company?.companyName || dossier.domain}</h2>
              <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                Generated {new Date(dossier.generatedAt).toLocaleString()}
              </span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body dossier-body">
          {/* Company Overview */}
          <div className="dossier-section">
            <h4><Building2 size={16} strokeWidth={1.5} /> Company Overview</h4>
            <div className="dossier-grid-info">
              <div className="dossier-item">
                <span className="label">Company</span>
                <span className="value">{dossier.company?.companyName || '-'}</span>
              </div>
              <div className="dossier-item">
                <span className="label">Industry</span>
                <span className="value">{dossier.company?.industry || '-'}</span>
              </div>
              <div className="dossier-item">
                <span className="label">Founded</span>
                <span className="value">{dossier.company?.founded || '-'}</span>
              </div>
              <div className="dossier-item">
                <span className="label">Employees</span>
                <span className="value">{dossier.company?.employeeCount || '-'}</span>
              </div>
              <div className="dossier-item">
                <span className="label">Headquarters</span>
                <span className="value">{dossier.company?.headquarters || '-'}</span>
              </div>
              <div className="dossier-item">
                <span className="label">Total Funding</span>
                <span className="value">{dossier.company?.totalFunding || '-'}</span>
              </div>
              <div className="dossier-item">
                <span className="label">Top Investors</span>
                <span className="value">{dossier.company?.topInvestors || '-'}</span>
              </div>
              <div className="dossier-item full-width">
                <span className="label">Description</span>
                <span className="value">{dossier.company?.description || '-'}</span>
              </div>
            </div>
          </div>

          {/* NYC Intel */}
          <div className="dossier-section">
            <h4><MapPin size={16} strokeWidth={1.5} /> NYC Office Intel</h4>
            <div className="dossier-grid-info">
              <div className="dossier-item">
                <span className="label">NYC Address</span>
                <span className="value highlight">{dossier.nycIntel?.address || dossier.company?.nycAddress || 'Not found'}</span>
              </div>
              <div className="dossier-item">
                <span className="label">Confirmed</span>
                <span className="value">{dossier.nycIntel?.confirmed || dossier.company?.nycOfficeConfirmed || '-'}</span>
              </div>
              {dossier.nycIntel?.careersUrl && (
                <div className="dossier-item">
                  <span className="label">Careers Page</span>
                  <a href={dossier.nycIntel.careersUrl} target="_blank" rel="noopener noreferrer" className="value link">
                    {dossier.nycIntel.careersUrl} <ExternalLink size={12} />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Decision Makers */}
          <div className="dossier-section">
            <h4><UserCheck size={16} strokeWidth={1.5} /> Decision Makers</h4>
            {dossier.contacts && dossier.contacts.length > 0 ? (
              <div className="contacts-list">
                {dossier.contacts.map((contact, idx) => (
                  <div key={idx} className="contact-card">
                    <div className="contact-name">{contact.name}</div>
                    <div className="contact-title">{contact.title}</div>
                    {contact.linkedin && (
                      <a href={contact.linkedin} target="_blank" rel="noopener noreferrer" className="contact-linkedin">
                        LinkedIn <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted">No decision makers found</p>
            )}
          </div>

          {/* Hiring Intel */}
          <div className="dossier-section">
            <h4><Briefcase size={16} strokeWidth={1.5} /> Hiring Intelligence</h4>
            <div className="dossier-grid-info">
              <div className="dossier-item">
                <span className="label">Hiring Status</span>
                <span className={`value ${dossier.hiring?.status === 'Actively Hiring' ? 'highlight' : ''}`}>
                  {dossier.hiring?.status || '-'}
                </span>
              </div>
              <div className="dossier-item">
                <span className="label">Total Open Roles</span>
                <span className="value highlight">{dossier.hiring?.totalJobs || 0}</span>
              </div>
              <div className="dossier-item">
                <span className="label">NYC-Based Roles</span>
                <span className="value highlight">{dossier.hiring?.nycJobs || 0}</span>
              </div>
              <div className="dossier-item">
                <span className="label">Data Source</span>
                <span className="value text-muted" style={{ fontSize: '0.75rem' }}>
                  {dossier.hiring?.source || 'AI analysis'}
                </span>
              </div>
              <div className="dossier-item full-width">
                <span className="label">Key Roles Hiring</span>
                <span className="value">{dossier.hiring?.keyRoles || '-'}</span>
              </div>
              {dossier.hiring?.careersUrl && (
                <div className="dossier-item full-width">
                  <span className="label">Careers Page</span>
                  <a href={dossier.hiring.careersUrl} target="_blank" rel="noopener noreferrer" className="value link">
                    {dossier.hiring.careersUrl} <ExternalLink size={12} />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Recent News */}
          <div className="dossier-section">
            <h4><Newspaper size={16} strokeWidth={1.5} /> Recent News</h4>
            {dossier.recentNews && dossier.recentNews.length > 0 ? (
              <div className="news-list">
                {dossier.recentNews.map((article, idx) => (
                  <div key={idx} className="news-item">
                    <a href={article.url} target="_blank" rel="noopener noreferrer" className="news-title">
                      {article.title} <ExternalLink size={12} />
                    </a>
                    <p className="news-snippet">{article.snippet}</p>
                    <span className="news-source">{article.source}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted">No recent news found</p>
            )}
          </div>

          {/* Outreach Email */}
          <div className="dossier-section">
            <h4><Mail size={16} strokeWidth={1.5} /> Generated Outreach Email</h4>
            {dossier.outreachEmail ? (
              <div className="email-preview">
                <pre className="email-content">{dossier.outreachEmail}</pre>
                <button className="btn btn-secondary btn-sm" onClick={copyEmail}>
                  {copiedEmail ? <><CheckCircle size={14} /> Copied!</> : <><Copy size={14} /> Copy Email</>}
                </button>
              </div>
            ) : (
              <p className="text-muted">No email generated</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Agent Progress Modal
function AgentProgressModal({ progress, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal modal-small agent-progress-modal">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Bot size={20} strokeWidth={1.5} className="spin-slow" style={{ color: 'var(--accent)' }} />
            <h2>Research Agent Running</h2>
          </div>
        </div>
        <div className="modal-body">
          <div className="agent-progress">
            {AGENT_STEPS.map((step) => (
              <div
                key={step.step}
                className={`progress-step ${progress?.step >= step.step ? 'active' : ''} ${progress?.step > step.step ? 'completed' : ''}`}
              >
                <div className="step-indicator">
                  {progress?.step > step.step ? (
                    <CheckCircle size={16} strokeWidth={2} />
                  ) : progress?.step === step.step ? (
                    <Loader size={16} strokeWidth={2} className="spin" />
                  ) : (
                    <span className="step-number">{step.step}</span>
                  )}
                </div>
                <div className="step-info">
                  <span className="step-label">{step.label}</span>
                  <span className="step-desc">{step.description}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="agent-status">{progress?.message || 'Initializing...'}</p>
        </div>
      </div>
    </div>
  );
}

function MasterList() {
  const [companies, setCompanies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showCRMModal, setShowCRMModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [filters, setFilters] = useState({
    prospectStatus: '',
    nycOffice: '',
    fundingStage: '',
  });
  const [agentProgress, setAgentProgress] = useState(null);
  const [agentDossier, setAgentDossier] = useState(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setCompanies(getMasterList());
  }, []);

  const handleFileUpload = async (file) => {
    if (!file || !file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    const text = await file.text();
    const rawData = parseCSV(text);
    const mappedData = mapCompanyData(rawData);

    if (mappedData.length > 0) {
      const updated = addToMasterList(mappedData);
      setCompanies(updated);
      alert(`Successfully imported ${mappedData.length} companies!`);
    } else {
      alert('No data found in CSV file');
    }
  };

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

  const handleEnrichCompany = (companyId, enrichData) => {
    const updated = companies.map(c => {
      if (c.id !== companyId) return c;
      return {
        ...c,
        organizationName: enrichData.companyName || c.organizationName,
        description: enrichData.description || c.description,
        employeeCount: enrichData.employeeCount || c.employeeCount,
        industry: enrichData.industry || c.industry,
        linkedin: enrichData.linkedinUrl || c.linkedin,
        foundedDate: enrichData.founded || c.foundedDate,
        nycAddress: enrichData.nycAddress || c.nycAddress,
        headquarters: enrichData.headquarters || c.headquarters,
        nycOfficeConfirmed: enrichData.nycOfficeConfirmed || c.nycOfficeConfirmed,
        workPolicyQuote: enrichData.workPolicyQuote || c.workPolicyQuote,
        totalJobs: enrichData.totalJobs || c.totalJobs,
        nycJobs: enrichData.nycJobs || c.nycJobs,
        departmentsHiring: enrichData.departmentsHiring || enrichData.keyRolesHiring || c.departmentsHiring,
        hiringStatus: enrichData.hiringStatus || c.hiringStatus,
        recentLeaseNews: enrichData.recentLeaseNews || c.recentLeaseNews,
        careersUrl: enrichData.careersUrl || c.careersUrl,
        totalFunding: enrichData.totalFunding || c.totalFunding,
        lastFundingAmount: enrichData.lastFundingAmount || c.lastFundingAmount,
        lastFundingType: enrichData.lastFundingType || c.lastFundingType,
        lastFundingDate: enrichData.lastFundingDate || c.lastFundingDate,
        fundingRounds: enrichData.fundingRounds || c.fundingRounds,
        topInvestors: enrichData.topInvestors || c.topInvestors,
        keyContacts: enrichData.keyContacts || c.keyContacts,
      };
    });
    saveMasterList(updated);
    setCompanies(updated);
    // Refresh the selected company view
    const refreshed = updated.find(c => c.id === companyId);
    if (refreshed) setSelectedCompany(refreshed);
  };

  const handleDeleteCompany = (companyId) => {
    const updated = companies.filter(c => c.id !== companyId);
    saveMasterList(updated);
    setCompanies(updated);
    setSelectedCompany(null);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(companyId);
      return next;
    });
  };

  const handleRunAgent = async (domain) => {
    setAgentRunning(true);
    setAgentProgress({ step: 1, total: 6, message: 'Starting research agent...' });
    setAgentDossier(null);

    // Simulate progress updates (actual progress comes from API completion)
    const progressInterval = setInterval(() => {
      setAgentProgress(prev => {
        if (!prev || prev.step >= 5) return prev;
        const nextStep = prev.step + 1;
        const stepInfo = AGENT_STEPS.find(s => s.step === nextStep);
        return {
          step: nextStep,
          total: 6,
          message: stepInfo?.description || 'Processing...'
        };
      });
    }, 2500);

    try {
      const dossier = await runResearchAgent(domain, (progress) => {
        setAgentProgress(progress);
      });
      clearInterval(progressInterval);
      setAgentProgress({ step: 6, total: 6, message: 'Research complete!' });
      setAgentDossier(dossier);
      setAgentRunning(false);
    } catch (err) {
      clearInterval(progressInterval);
      setAgentRunning(false);
      setAgentProgress(null);
      alert('Agent error: ' + (err.message || 'Unknown error'));
    }
  };

  const handleAddToCRM = (companiesToAdd, stage) => {
    const prospects = getProspects();
    const existingIds = new Set(prospects.map(p => p.masterListId));

    companiesToAdd.forEach(company => {
      if (!existingIds.has(company.id)) {
        saveProspect({
          ...company,
          masterListId: company.id,
          crmStage: stage,
        });
      }
    });

    setSelectedIds(new Set());
    setShowCRMModal(false);
    alert(`Added ${companiesToAdd.length} companies to CRM!`);
  };

  const filteredCompanies = companies.filter(company => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const matchesSearch =
        company.organizationName?.toLowerCase().includes(search) ||
        company.description?.toLowerCase().includes(search) ||
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
      if (filters.fundingStage === 'ok' && company.fundingStageOK !== '✅ Yes') return false;
      if (filters.fundingStage === 'not_ok' && company.fundingStageOK === '✅ Yes') return false;
    }

    return true;
  });

  const selectedCompanies = filteredCompanies.filter(c => selectedIds.has(c.id));

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Master List</h1>
          <p>{companies.length > 0 ? `${companies.length} companies` : 'Your complete company database from Clay exports'}</p>
        </div>
        <div className="header-actions">
          {selectedIds.size > 0 && (
            <button className="btn btn-primary" onClick={() => setShowCRMModal(true)}>
              <Users size={18} strokeWidth={1.5} />
              Add {selectedIds.size} to CRM
            </button>
          )}
          <QuickAddDomain onAdd={(newCompanies) => {
            const updated = addToMasterList(newCompanies);
            setCompanies(updated);
          }} />
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} strokeWidth={1.5} />
            Import CSV
          </button>
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
          <Upload size={48} strokeWidth={1.5} className="upload-icon" />
          <h4>Drop your CSV file here</h4>
          <p>or click to browse</p>
          <p className="text-muted" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
            Supports Clay export format with company info, funding data, and prospect scoring
          </p>
        </div>
      ) : (
        <>
          <div className="table-toolbar">
            <div className="search-box">
              <Search size={18} strokeWidth={1.5} className="search-icon" />
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
              <div className="view-toggle">
                <button
                  className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                >
                  <LayoutGrid size={18} strokeWidth={1.5} />
                </button>
                <button
                  className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                  onClick={() => setViewMode('table')}
                  title="Table view"
                >
                  <List size={18} strokeWidth={1.5} />
                </button>
              </div>
              <button
                className={`btn btn-secondary ${showFilters ? 'active' : ''}`}
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter size={18} strokeWidth={1.5} />
                Filters
                <ChevronDown size={16} strokeWidth={1.5} />
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

          {viewMode === 'grid' ? (
            <>
              <div className="dossier-toolbar">
                <label className="dossier-select-all" onClick={(e) => { e.preventDefault(); selectAll(); }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredCompanies.length && filteredCompanies.length > 0}
                    onChange={() => {}}
                  />
                  <span>{selectedIds.size > 0 ? `${selectedIds.size} selected` : `${filteredCompanies.length} companies`}</span>
                </label>
              </div>
              <div className="dossier-grid">
                {filteredCompanies.slice(0, 100).map(company => (
                  <DossierCard
                    key={company.id}
                    company={company}
                    isSelected={selectedIds.has(company.id)}
                    onSelect={toggleSelect}
                    onClick={setSelectedCompany}
                  />
                ))}
              </div>
              {filteredCompanies.length > 100 && (
                <div className="dossier-overflow">
                  Showing first 100 of {filteredCompanies.length} companies. Use filters or search to narrow down.
                </div>
              )}
            </>
          ) : (
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
                      <th>Status</th>
                      <th>Employees</th>
                      <th>NYC Jobs</th>
                      <th>Last Funding</th>
                      <th>NYC Office</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompanies.slice(0, 100).map(company => (
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
                              <div>{company.organizationName}</div>
                              {company.website && (
                                <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                                  {company.website.replace(/https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '')}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          {company.prospectStatus && (
                            <span className={`prospect-badge ${getProspectBadgeClass(company.prospectStatus)}`}>
                              {company.prospectStatus}
                            </span>
                          )}
                        </td>
                        <td>{company.employeeCount || '-'}</td>
                        <td>{company.nycJobs || '-'}</td>
                        <td>
                          {company.lastFundingAmount ? (
                            <>
                              {formatFunding(company.lastFundingAmount)}
                              {company.lastFundingType && <span className="text-muted"> ({company.lastFundingType})</span>}
                            </>
                          ) : '-'}
                        </td>
                        <td>
                          {company.nycOfficeConfirmed === 'Yes' ? '✅' :
                           company.nycOfficeConfirmed === 'No' ? '❌' : '❓'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredCompanies.length > 100 && (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Showing first 100 of {filteredCompanies.length} companies. Use filters or search to narrow down.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {selectedCompany && (
        <CompanyModal
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
          onEnrich={handleEnrichCompany}
          onDelete={handleDeleteCompany}
          onRunAgent={handleRunAgent}
        />
      )}

      {showCRMModal && (
        <AddToCRMModal
          selectedCompanies={selectedCompanies}
          onClose={() => setShowCRMModal(false)}
          onAdd={handleAddToCRM}
        />
      )}

      {agentRunning && (
        <AgentProgressModal
          progress={agentProgress}
          onClose={() => {}}
        />
      )}

      {agentDossier && !agentRunning && (
        <DossierModal
          dossier={agentDossier}
          onClose={() => setAgentDossier(null)}
        />
      )}
    </div>
  );
}

export default MasterList;
