import { useState, useEffect, useRef } from 'react';
import { Upload, Search, Filter, X, Users, Building2, DollarSign, Briefcase, ExternalLink, Check, ChevronDown, LayoutGrid, List, MapPin, TrendingUp, Plus, Globe, Loader, Trash2, Bot, Mail, Newspaper, UserCheck, Copy, CheckCircle, CalendarPlus, Clock, AlertCircle, ChevronRight, Activity, Star, Award, GraduationCap, MessageSquare, Shield } from 'lucide-react';
import { getMasterList, addToMasterList, saveMasterList, saveProspect, getProspects, PROSPECT_STAGES, COMPANY_STATUSES, PROSPECT_TIERS, runResearchAgent, AGENT_STEPS, saveDossierToCompany, createFollowUpFromContact, getContactsByCompany, updateCompanyStatus, deleteCompaniesFromMasterList, getCompanyActivities, logActivity } from '../store/dataStore';
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

// Parse industries string into an array of tags
function parseIndustries(industryStr) {
  if (!industryStr) return [];
  // Split by comma, semicolon, or pipe and clean up
  return industryStr
    .split(/[,;|]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// Map CSV columns to our data structure (supports Crunchbase export format)
function mapCompanyData(rawData) {
  return rawData.map(row => {
    // Get industries from various possible column names
    const industryRaw = row['Industries'] || row['Industry'] || row['industries'] || row['industry'] || '';
    const industriesTags = parseIndustries(industryRaw);

    return {
      // Core identifiers
      organizationName: row['Tenant name'] || row['Organization Name'] || row['Company Name'] || row['Name'] || '',
      website: row['website'] || row['Website'] || row['URL'] || '',
      linkedin: row['LinkedIn'] || row['LinkedIn URL'] || '',
      crunchbaseUrl: row['CrunchBase URL'] || row['Crunchbase URL'] || '',
      // Company info
      headquarters: row['HQ'] || row['Headquarters'] || row['headquarters'] || '',
      foundedDate: row['founded year'] || row['Founded Date'] || row['Founded'] || '',
      description: row['description'] || row['Description'] || '',
      employeeCount: row['number of employees'] || row['Employee Count'] || row['Employees'] || row['Size'] || '',
      industry: industriesTags.length > 0 ? industriesTags[0] : '', // Primary industry for backward compat
      industries: industriesTags, // Array of all industry tags
      // Funding
      totalFunding: row['total funding'] || row['Total Funding Amount (in USD)'] || row['Total Funding'] || '',
      lastFundingDate: row['last funding date'] || row['Last Funding Date'] || '',
      lastFundingType: row['last funding type'] || row['Last Funding Type'] || '',
      lastFundingAmount: row['last funding amount in USD'] || row['Last Funding Amount (in USD)'] || row['Last Funding Amount'] || '',
      fundingRounds: row['number of funding rounds'] || row['Number of Funding Rounds'] || row['Funding Rounds'] || '',
      topInvestors: row['top 5 investors'] || row['Top 5 Investors'] || row['Investors'] || '',
      leadInvestors: row['lead investors'] || row['Lead Investors'] || '',
      // People
      founders: row['founders'] || row['Founders'] || '',
      keyContacts: row['Key Contacts'] || '',
      // Hiring
      careersUrl: row['Careers URL'] || row['careers URL'] || row['Careers Page'] || '',
      totalJobs: row['Total Jobs'] || row['total jobs'] || row['Open Jobs'] || '',
      nycJobs: row['NYC Jobs'] || row['nyc jobs'] || '',
      remoteJobs: row['Remote Jobs'] || row['remote jobs'] || '',
      hybridJobs: row['Hybrid Jobs'] || row['hybrid jobs'] || '',
      inOfficeJobs: row['In-Office Jobs'] || row['in-office jobs'] || '',
      departmentsHiring: row['Departments Hiring'] || row['departments hiring'] || '',
      workPolicyQuote: row['Work Policy Quote'] || '',
      // NYC Intel
      nycOfficeConfirmed: row['NYC Office Confirmed'] || row['nyc office confirmed'] || '',
      nycAddress: row['NYC Address'] || row['nyc address'] || '',
      // Legacy/scoring fields
      fundingInRange: row['Funding in Range'] || '',
      fundingStageOK: row['Funding Stage OK'] || '',
      headcountFilter: row['Headcount Filter'] || '',
      excludeRemoteOnly: row['Exclude Remote Only'] || '',
      prospectScore: row['Prospect Score'] || '',
      prospectStatus: row['Prospect Status'] || '',
      // Default status for new imports
      status: 'new',
    };
  });
}

function getProspectBadgeClass(status) {
  if (!status) return '';
  if (status.includes('Hot')) return 'hot';
  if (status.includes('Worth') || status.includes('Look')) return 'look';
  return 'low';
}

// Smart funding formatter - handles both raw numbers and strings with M/K/B suffixes
function formatFunding(amount) {
  if (!amount) return null;

  // Convert to string for processing
  const str = String(amount).trim();
  if (!str) return null;

  // Remove $ and commas, uppercase for suffix detection
  const cleaned = str.replace(/[$,]/g, '').toUpperCase();

  // Check if it already has M/B/K suffix - if so, normalize and return
  if (cleaned.includes('B') || cleaned.includes('M') || cleaned.includes('K')) {
    const numPart = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    if (isNaN(numPart)) return null;

    // Determine suffix and normalize
    if (cleaned.includes('B')) {
      return `$${numPart}B`;
    } else if (cleaned.includes('M')) {
      return `$${numPart}M`;
    } else if (cleaned.includes('K')) {
      return `$${numPart}K`;
    }
  }

  // Parse as raw number and format appropriately
  const num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
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
function DossierCard({ company, isSelected, isFocused, onSelect, onClick }) {
  const stale = isDataStale(company.lastResearchedAt);
  const status = COMPANY_STATUSES.find(s => s.id === company.status) || COMPANY_STATUSES[0];

  return (
    <div
      className={`dossier-card ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`}
      onClick={() => onClick(company)}
    >
      <div className="dossier-select" onClick={(e) => { e.stopPropagation(); onSelect(company.id); }}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
        />
      </div>

      {/* Status badge and staleness indicator */}
      <div className="dossier-top-badges">
        <span className="status-badge" style={{ backgroundColor: status.color + '20', color: status.color }}>
          {status.name}
        </span>
        {stale && (
          <span className="stale-badge" title="Data is over 30 days old">
            <Clock size={12} strokeWidth={1.5} />
          </span>
        )}
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
        {(company.totalFunding || company.lastFundingAmount) && (
          <div className="dossier-stat">
            <TrendingUp size={13} strokeWidth={1.5} />
            <span>{formatFunding(company.totalFunding || company.lastFundingAmount)}</span>
            {company.lastFundingType && <span className="dossier-stat-sub">{company.lastFundingType}</span>}
          </div>
        )}
      </div>

      <div className="dossier-footer">
        {company.prospectScore != null && company.prospectScore !== '' && (
          <span className={`prospect-score-pill ${company.prospectScore >= 8 ? 'score-high' : company.prospectScore >= 5 ? 'score-mid' : 'score-low'}`}>
            <Star size={11} strokeWidth={2} />
            {company.prospectScore}/10
          </span>
        )}
        {company.prospectStatus && !company.prospectScore && (
          <span className={`prospect-badge ${getProspectBadgeClass(company.prospectStatus)}`}>
            {company.prospectStatus}
          </span>
        )}
        <span className="dossier-nyc-badge">
          {company.nycOfficeConfirmed === 'Yes' ? (
            <span className="nyc-confirmed"><MapPin size={12} strokeWidth={1.5} /> NYC</span>
          ) : company.nycOfficeConfirmed === 'Planned' ? (
            <span className="nyc-planned"><MapPin size={12} strokeWidth={1.5} /> NYC Planned</span>
          ) : company.nycOfficeConfirmed === 'No' ? (
            <span className="nyc-unconfirmed">No NYC</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

// Helper: Check if data is stale (>30 days old)
function isDataStale(lastResearchedAt) {
  if (!lastResearchedAt) return false;
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  return new Date(lastResearchedAt).getTime() < thirtyDaysAgo;
}

// Calculate Open Jobs tier based on seed-stage norms
function getJobsTier(totalJobs) {
  const jobs = parseInt(totalJobs) || 0;
  if (jobs >= 20) return { tier: 1, label: 'Tier 1 - High Growth', color: '#22c55e' };
  if (jobs >= 10) return { tier: 2, label: 'Tier 2 - Growing', color: '#3b82f6' };
  if (jobs >= 1) return { tier: 3, label: 'Tier 3 - Early Stage', color: '#f59e0b' };
  return { tier: 0, label: 'No Open Jobs', color: '#6b7280' };
}

// Derive founder score from founderProfiles if scorecard shows no data
function getFounderData(scorecard, founderProfiles) {
  const baseFounder = scorecard?.founder || { score: 0, maxScore: 3, signal: 'No data on founder' };

  // If we have founder profiles but scorecard says no data, calculate from profiles
  if (founderProfiles?.length > 0 && (!baseFounder.signal || baseFounder.signal.toLowerCase().includes('no data'))) {
    const avgPedigree = founderProfiles.reduce((sum, f) => sum + (f.pedigreeScore || 0), 0) / founderProfiles.length;
    const topPedigree = Math.max(...founderProfiles.map(f => f.pedigreeScore || 0));

    let signal = founderProfiles.length === 1
      ? `${founderProfiles[0].name} - ${founderProfiles[0].pedigree || 'Background researched'}`
      : `${founderProfiles.length} founders profiled`;

    return {
      score: Math.round(avgPedigree),
      maxScore: 3,
      signal: signal,
    };
  }

  return baseFounder;
}

// Prospect Scorecard Component
function ProspectScorecard({ scorecard, founderProfiles, totalJobs, topInvestors }) {
  if (!scorecard) return null;

  const { prospectScore, funding, investor } = scorecard;
  const founder = getFounderData(scorecard, founderProfiles);
  const jobsTier = getJobsTier(totalJobs);

  // Color for the overall score
  const getScoreColor = (score) => {
    if (score >= 8) return '#22c55e';
    if (score >= 5) return '#f59e0b';
    if (score >= 3) return '#f97316';
    return '#ef4444';
  };

  const scoreColor = getScoreColor(prospectScore);
  const scorePercent = (prospectScore / 10) * 100;

  return (
    <div className="scorecard">
      <div className="scorecard-header">
        <div className="scorecard-total">
          <div className="scorecard-ring" style={{ '--score-percent': `${scorePercent}%`, '--score-color': scoreColor }}>
            <span className="scorecard-number" style={{ color: scoreColor }}>{prospectScore}</span>
            <span className="scorecard-max">/10</span>
          </div>
          <div className="scorecard-label">Prospect Score</div>
        </div>
      </div>
      <div className="scorecard-dimensions">
        <ScoreDimension
          icon={<DollarSign size={14} strokeWidth={1.5} />}
          label="Funding"
          score={funding.score}
          maxScore={funding.maxScore}
          signal={funding.signal}
          color="#22c55e"
        />
        <ScoreDimension
          icon={<Shield size={14} strokeWidth={1.5} />}
          label="Investor"
          score={investor.score}
          maxScore={investor.maxScore}
          signal={investor.signal}
          color="#3b82f6"
        />
        <ScoreDimension
          icon={<Award size={14} strokeWidth={1.5} />}
          label="Founder"
          score={founder.score}
          maxScore={founder.maxScore}
          signal={founder.signal}
          color="#a855f7"
        />
        {/* Open Jobs Dimension */}
        <div className="score-dimension">
          <div className="score-dimension-header">
            <span className="score-dimension-icon" style={{ color: jobsTier.color }}>
              <Briefcase size={14} strokeWidth={1.5} />
            </span>
            <span className="score-dimension-label">Open Jobs</span>
            <span className="jobs-tier" style={{ backgroundColor: jobsTier.color + '20', color: jobsTier.color }}>
              {jobsTier.tier > 0 ? `Tier ${jobsTier.tier}` : 'N/A'}
            </span>
          </div>
          <div className="score-dimension-bar">
            <div
              className="score-dimension-fill"
              style={{ width: `${(jobsTier.tier > 0 ? (4 - jobsTier.tier) / 3 : 0) * 100}%`, backgroundColor: jobsTier.color }}
            />
          </div>
          <span className="score-dimension-signal">
            {totalJobs ? `${totalJobs} open positions` : 'No job data'} - {jobsTier.label}
          </span>
        </div>
      </div>
    </div>
  );
}

// Score Dimension Row
function ScoreDimension({ icon, label, score, maxScore, signal, color }) {
  const fillPercent = (score / maxScore) * 100;
  return (
    <div className="score-dimension">
      <div className="score-dimension-header">
        <span className="score-dimension-icon" style={{ color }}>{icon}</span>
        <span className="score-dimension-label">{label}</span>
        <span className="score-dimension-value" style={{ color }}>
          {score}/{maxScore}
        </span>
      </div>
      <div className="score-dimension-bar">
        <div
          className="score-dimension-fill"
          style={{ width: `${fillPercent}%`, backgroundColor: color }}
        />
      </div>
      <span className="score-dimension-signal">{signal}</span>
    </div>
  );
}

// Known Tier 1 investors (top VCs)
const TIER_1_INVESTORS = [
  'a]z', 'sequoia', 'andreessen', 'a16z', 'benchmark', 'accel', 'greylock',
  'kleiner', 'kpcb', 'lightspeed', 'bessemer', 'index ventures', 'general catalyst',
  'founders fund', 'first round', 'union square', 'usv', 'spark capital', 'ribbit',
  'coatue', 'tiger global', 'insight partners', 'y combinator', 'yc', 'nea',
  'khosla', 'ivp', 'redpoint', 'ggv', 'battery ventures', 'menlo ventures',
  'emergence', 'felicis', 'thrive capital', 'softbank', 'dst global'
];

// Tier 2 investors (strong VCs)
const TIER_2_INVESTORS = [
  'maverick', 'boldstart', 'lerer hippeau', 'rre', 'greycroft', 'fj labs',
  'compound', 'contrary', 'initialized', 'craft ventures', 'openview',
  'wing', 'matrix partners', 'social capital', 'box group', 'susa ventures',
  'greenoaks', 'forerunner', 'slow ventures', 'cowboy ventures', 'resolute'
];

// Get investor tier
function getInvestorTier(name) {
  const lower = name.toLowerCase();
  if (TIER_1_INVESTORS.some(t1 => lower.includes(t1))) return 1;
  if (TIER_2_INVESTORS.some(t2 => lower.includes(t2))) return 2;
  return 3;
}

// Investor Scorecard Component - shows top 5 investors with their tiers
function InvestorScorecard({ investors }) {
  if (!investors) return null;

  // Parse investors string into array
  const investorList = investors
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .slice(0, 5); // Top 5 only

  if (investorList.length === 0) return null;

  return (
    <div className="investor-scorecard">
      {investorList.map((investor, idx) => {
        const tier = getInvestorTier(investor);
        const tierClass = `tier-${tier}`;
        const tierLabel = tier === 1 ? 'Tier 1' : tier === 2 ? 'Tier 2' : 'Tier 3';
        return (
          <div key={idx} className="investor-item">
            <span className="investor-name">{investor}</span>
            <span className={`investor-tier ${tierClass}`}>
              <Shield size={10} strokeWidth={2} />
              {tierLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Founder Profile Card Component
function FounderProfileCard({ profile }) {
  if (!profile) return null;

  const getPedigreeColor = (score) => {
    if (score >= 3) return '#22c55e';
    if (score >= 2) return '#3b82f6';
    if (score >= 1) return '#f59e0b';
    return '#6b7280';
  };

  const pedigreeColor = getPedigreeColor(profile.pedigreeScore);

  return (
    <div className="founder-card">
      <div className="founder-card-header">
        <div className="founder-avatar">
          {profile.photo ? (
            <img src={profile.photo} alt={profile.name} className="founder-photo" />
          ) : (
            <span className="founder-initial">{profile.name?.charAt(0)?.toUpperCase() || '?'}</span>
          )}
        </div>
        <div className="founder-identity">
          <span className="founder-name">{profile.name}</span>
          <span className="founder-title-text">{profile.title}</span>
          <div className="founder-links">
            {profile.linkedin && (
              <a href={profile.linkedin} target="_blank" rel="noopener noreferrer" className="founder-link">
                LinkedIn <ExternalLink size={10} />
              </a>
            )}
            {profile.email && (
              <a href={`mailto:${profile.email}`} className="founder-link">
                <Mail size={10} /> Email
              </a>
            )}
          </div>
        </div>
        <div className="founder-pedigree-badge" style={{ borderColor: pedigreeColor, color: pedigreeColor }}>
          <Star size={12} strokeWidth={2} />
          <span>{profile.pedigreeScore}/3</span>
        </div>
      </div>

      {profile.tldr && (
        <div className="founder-tldr">
          <span className="founder-section-label">TL;DR</span>
          <p>{profile.tldr}</p>
        </div>
      )}

      {profile.career && profile.career.length > 0 && (
        <div className="founder-career">
          <span className="founder-section-label"><Briefcase size={12} strokeWidth={1.5} /> Career History</span>
          <div className="founder-career-list">
            {profile.career.map((role, idx) => (
              <div key={idx} className="founder-career-item">
                <span className="career-title">{role.title}</span>
                <span className="career-company">{role.company}</span>
                {role.years && <span className="career-years">{role.years}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {profile.education && profile.education.length > 0 && (
        <div className="founder-education">
          <span className="founder-section-label"><GraduationCap size={12} strokeWidth={1.5} /> Education</span>
          <div className="founder-education-list">
            {profile.education.map((edu, idx) => (
              <div key={idx} className="founder-education-item">
                <span className="edu-school">{edu.school}</span>
                {(edu.degree || edu.field) && (
                  <span className="edu-degree">{[edu.degree, edu.field].filter(Boolean).join(', ')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="founder-pedigree-detail">
        <span className="founder-section-label"><Award size={12} strokeWidth={1.5} /> Pedigree</span>
        <div className="pedigree-tag" style={{ backgroundColor: pedigreeColor + '18', color: pedigreeColor, borderColor: pedigreeColor + '40' }}>
          {profile.pedigree}
        </div>
        {profile.pedigreeReason && (
          <span className="pedigree-reason">{profile.pedigreeReason}</span>
        )}
      </div>

      {profile.talkingPoints && profile.talkingPoints.length > 0 && (
        <div className="founder-talking-points">
          <span className="founder-section-label"><MessageSquare size={12} strokeWidth={1.5} /> Talking Points</span>
          <ul className="talking-points-list">
            {profile.talkingPoints.map((point, idx) => (
              <li key={idx}>{point}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Company Detail Modal
function CompanyModal({ company, onClose, onDelete, onRunAgent, onViewDossier, onStatusChange, onSaveCompany }) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [showActivityTimeline, setShowActivityTimeline] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState({});
  const contacts = getContactsByCompany(company?.id);
  const activities = company?.id ? getCompanyActivities(company.id) : [];

  if (!company) return null;

  const dossier = company.lastDossier;
  const domain = getDomain(company.website);
  const stale = isDataStale(company.lastResearchedAt);
  const currentStatus = COMPANY_STATUSES.find(s => s.id === company.status) || COMPANY_STATUSES[0];

  const handleRunAgent = () => {
    if (domain && onRunAgent) {
      onRunAgent(domain, company.id);
      onClose();
    }
  };

  const handleStatusChange = (newStatus) => {
    if (onStatusChange) {
      onStatusChange(company.id, newStatus);
    }
  };

  const handleStartEdit = () => {
    setEditedData({ ...company });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditedData({});
    setIsEditing(false);
  };

  const handleSaveEdit = () => {
    if (onSaveCompany) {
      onSaveCompany(company.id, editedData);
    }
    setIsEditing(false);
    setEditedData({});
  };

  const handleFieldChange = (field, value) => {
    setEditedData(prev => ({ ...prev, [field]: value }));
  };

  // Editable InfoRow component
  const EditableInfoRow = ({ label, field, value, isLink, isTextarea }) => {
    const displayValue = isEditing ? (editedData[field] ?? value) : value;

    if (!isEditing && !value) return null;

    return (
      <div className="info-row">
        <span className="info-label">{label}</span>
        {isEditing ? (
          isTextarea ? (
            <textarea
              className="edit-input"
              value={editedData[field] ?? value ?? ''}
              onChange={(e) => handleFieldChange(field, e.target.value)}
              rows={3}
            />
          ) : (
            <input
              type="text"
              className="edit-input"
              value={editedData[field] ?? value ?? ''}
              onChange={(e) => handleFieldChange(field, e.target.value)}
            />
          )
        ) : isLink && displayValue ? (
          <a href={displayValue.startsWith('http') ? displayValue : `https://${displayValue}`} target="_blank" rel="noopener noreferrer" className="info-value link">
            {displayValue} <ExternalLink size={12} />
          </a>
        ) : (
          <span className="info-value">{displayValue || '-'}</span>
        )}
      </div>
    );
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                {/* Status dropdown */}
                <select
                  className="status-select"
                  value={company.status || 'new'}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  style={{ borderColor: currentStatus.color }}
                >
                  {COMPANY_STATUSES.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>

                {/* Staleness indicator */}
                {stale && (
                  <span className="stale-indicator" title="Data is over 30 days old">
                    <AlertCircle size={14} strokeWidth={1.5} />
                    Stale
                  </span>
                )}

                {domain && (
                  <button
                    className="btn btn-primary btn-sm agent-btn"
                    onClick={handleRunAgent}
                    title="Run full research agent"
                  >
                    <Bot size={14} strokeWidth={1.5} />
                    Run Agent
                  </button>
                )}

                {/* Edit button */}
                {!isEditing ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleStartEdit}
                    title="Edit company profile"
                  >
                    <Briefcase size={14} strokeWidth={1.5} />
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleSaveEdit}
                      title="Save changes"
                    >
                      <Check size={14} strokeWidth={1.5} />
                      Save
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleCancelEdit}
                      title="Cancel editing"
                    >
                      <X size={14} strokeWidth={1.5} />
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {/* Quick Status Bar */}
          <div className="company-status-bar">
            <div className="status-item">
              <span className="status-label">NYC Office</span>
              <span className={`status-value ${company.nycOfficeConfirmed === 'Yes' ? 'positive' : company.nycOfficeConfirmed === 'Planned' ? 'warning' : ''}`}>
                {company.nycOfficeConfirmed || 'Unknown'}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">HQ</span>
              <span className="status-value">{company.headquarters || '-'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Employees</span>
              <span className="status-value">{company.employeeCount || '-'}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Agent</span>
              <span className={`status-value ${company.lastResearchedAt ? 'positive' : ''}`}>
                {company.lastResearchedAt ? 'Run' : 'Not Run'}
              </span>
            </div>
          </div>

          <div className="info-section">
            <h4><Building2 size={16} strokeWidth={1.5} /> Company Info</h4>
            <EditableInfoRow label="Website" field="website" value={company.website} isLink />
            <EditableInfoRow label="LinkedIn" field="linkedin" value={company.linkedin} isLink />
            <EditableInfoRow label="Crunchbase" field="crunchbaseUrl" value={company.crunchbaseUrl} isLink />
            {/* Industry Tags */}
            {isEditing ? (
              <div className="info-row">
                <span className="info-label">Industries</span>
                <input
                  type="text"
                  className="edit-input"
                  value={editedData.industry ?? company.industry ?? ''}
                  onChange={(e) => handleFieldChange('industry', e.target.value)}
                  placeholder="Comma-separated industries"
                />
              </div>
            ) : (company.industries?.length > 0 || company.industry) && (
              <div className="info-row">
                <span className="info-label">Industries</span>
                <div className="industry-tags">
                  {company.industries?.length > 0 ? (
                    company.industries.map((ind, idx) => (
                      <span key={idx} className="industry-tag">{ind}</span>
                    ))
                  ) : company.industry ? (
                    <span className="industry-tag">{company.industry}</span>
                  ) : null}
                </div>
              </div>
            )}
            <EditableInfoRow label="Founded" field="foundedDate" value={company.foundedDate} />
            <EditableInfoRow label="Headquarters" field="headquarters" value={company.headquarters} />
            <EditableInfoRow label="Description" field="description" value={company.description} isTextarea />
            <EditableInfoRow label="NYC Address" field="nycAddress" value={company.nycAddress} />
            {isEditing ? (
              <div className="info-row">
                <span className="info-label">NYC Office Confirmed</span>
                <select
                  className="edit-input"
                  value={editedData.nycOfficeConfirmed ?? company.nycOfficeConfirmed ?? ''}
                  onChange={(e) => handleFieldChange('nycOfficeConfirmed', e.target.value)}
                >
                  <option value="">Unknown</option>
                  <option value="Yes">Yes</option>
                  <option value="Planned">Planned</option>
                  <option value="No">No</option>
                </select>
              </div>
            ) : (
              <InfoRow label="NYC Office Confirmed" value={company.nycOfficeConfirmed} />
            )}
          </div>

          <div className="info-section">
            <h4><Users size={16} strokeWidth={1.5} /> Team & Hiring</h4>
            <EditableInfoRow label="Employee Count" field="employeeCount" value={company.employeeCount} />
            <EditableInfoRow label="Founders" field="founders" value={company.founders} />
            <EditableInfoRow label="Hiring Status" field="hiringStatus" value={company.hiringStatus} />
            <EditableInfoRow label="Total Jobs" field="totalJobs" value={company.totalJobs} />
            <EditableInfoRow label="NYC Jobs" field="nycJobs" value={company.nycJobs} />
            <EditableInfoRow label="Key Roles Hiring" field="departmentsHiring" value={company.departmentsHiring} />
            <EditableInfoRow label="Careers Page" field="careersUrl" value={company.careersUrl} isLink />
          </div>

          <div className="info-section">
            <h4><DollarSign size={16} strokeWidth={1.5} /> Funding</h4>
            <EditableInfoRow label="Total Funding" field="totalFunding" value={company.totalFunding} />
            <EditableInfoRow label="Last Funding Amount" field="lastFundingAmount" value={company.lastFundingAmount} />
            <EditableInfoRow label="Last Funding Type" field="lastFundingType" value={company.lastFundingType} />
            <EditableInfoRow label="Last Funding Date" field="lastFundingDate" value={company.lastFundingDate} />
            <EditableInfoRow label="Funding Rounds" field="fundingRounds" value={company.fundingRounds} />
            <EditableInfoRow label="Top Investors" field="topInvestors" value={company.topInvestors} />
            <EditableInfoRow label="Lead Investors" field="leadInvestors" value={company.leadInvestors} />
            <InfoRow label="Funding in Range" value={company.fundingInRange} />
            <InfoRow label="Funding Stage OK" value={company.fundingStageOK} />
          </div>

          {/* Prospect Scorecard */}
          {(company.scorecard || dossier?.scorecard) && (
            <div className="info-section">
              <h4><Star size={16} strokeWidth={1.5} /> Prospect Scorecard</h4>
              <ProspectScorecard
                scorecard={company.scorecard || dossier?.scorecard}
                founderProfiles={company.founderProfiles || dossier?.founderProfiles}
                totalJobs={company.totalJobs}
                topInvestors={company.topInvestors}
              />
            </div>
          )}

          {/* Top Investors Scorecard */}
          {company.topInvestors && (
            <div className="info-section">
              <h4><Shield size={16} strokeWidth={1.5} /> Top Investors</h4>
              <InvestorScorecard investors={company.topInvestors} />
            </div>
          )}

          {/* Founder Profiles */}
          {(company.founderProfiles || dossier?.founderProfiles)?.length > 0 && (
            <div className="info-section">
              <h4><Award size={16} strokeWidth={1.5} /> Founder Due Diligence</h4>
              <div className="founder-profiles-list">
                {(company.founderProfiles || dossier?.founderProfiles).map((profile, idx) => (
                  <FounderProfileCard key={idx} profile={profile} />
                ))}
              </div>
            </div>
          )}

          <div className="info-section">
            <h4><Briefcase size={16} strokeWidth={1.5} /> Scoring & Contacts</h4>
            <InfoRow label="Prospect Score" value={company.prospectScore != null ? `${company.prospectScore}/10` : ''} />
            <InfoRow label="Prospect Status" value={company.prospectStatus} />
            <InfoRow label="Key Contacts" value={company.keyContacts} />
          </div>

          {/* Decision Makers from saved contacts */}
          {contacts.length > 0 && (
            <div className="info-section">
              <h4><UserCheck size={16} strokeWidth={1.5} /> Decision Makers</h4>
              <div className="contacts-list">
                {contacts.map((contact, idx) => (
                  <div key={contact.id || idx} className="contact-item">
                    <div className="contact-info">
                      <span className="contact-name">{contact.name}</span>
                      {contact.title && <span className="contact-title">{contact.title}</span>}
                    </div>
                    <div className="contact-links">
                      {contact.email && (
                        <a href={`mailto:${contact.email}`} className="contact-link" title={contact.email}>
                          <Mail size={14} strokeWidth={1.5} />
                        </a>
                      )}
                      {contact.linkedin && (
                        <a href={contact.linkedin} target="_blank" rel="noopener noreferrer" className="contact-link" title="LinkedIn">
                          <ExternalLink size={14} strokeWidth={1.5} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent News from dossier */}
          {dossier?.recentNews?.length > 0 && (
            <div className="info-section">
              <h4><Newspaper size={16} strokeWidth={1.5} /> Recent News</h4>
              <div className="news-list">
                {dossier.recentNews.slice(0, 5).map((news, idx) => (
                  <div key={idx} className="news-item">
                    <a href={news.url} target="_blank" rel="noopener noreferrer" className="news-title">
                      {news.title}
                    </a>
                    {news.snippet && <p className="news-snippet">{news.snippet}</p>}
                    <div className="news-meta">
                      {news.newsType && news.newsType !== 'Company News' && (
                        <span className={`news-type-badge ${news.newsType.toLowerCase().replace(/[\s/&]+/g, '-')}`}>
                          {news.newsType}
                        </span>
                      )}
                      {news.source && <span className="news-source">{news.source}</span>}
                      {news.publishedDate && news.publishedDate !== 'Unknown' && (
                        <span className="news-date">{news.publishedDate}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Saved Outreach Email from dossier */}
          {dossier?.outreachEmail && (
            <div className="info-section">
              <h4><Mail size={16} strokeWidth={1.5} /> Generated Outreach Email</h4>
              <div className="outreach-email-box">
                <pre className="outreach-email-text">{dossier.outreachEmail}</pre>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(dossier.outreachEmail);
                    setCopiedEmail(true);
                    setTimeout(() => setCopiedEmail(false), 2000);
                  }}
                >
                  {copiedEmail ? <><CheckCircle size={14} /> Copied!</> : <><Copy size={14} /> Copy Email</>}
                </button>
              </div>
            </div>
          )}

          {/* Research metadata */}
          {company.lastResearchedAt && (
            <div className="info-section research-meta">
              <span className="text-muted">
                Last researched: {new Date(company.lastResearchedAt).toLocaleDateString()} at {new Date(company.lastResearchedAt).toLocaleTimeString()}
                {stale && <span className="stale-text"> (data may be outdated)</span>}
              </span>
              {dossier && (
                <button className="btn btn-secondary btn-sm" onClick={() => onViewDossier && onViewDossier(dossier, company.id)}>
                  <Bot size={14} strokeWidth={1.5} /> View Full Dossier
                </button>
              )}
            </div>
          )}

          {/* Activity Timeline */}
          <div className="info-section">
            <h4 onClick={() => setShowActivityTimeline(!showActivityTimeline)} style={{ cursor: 'pointer' }}>
              <Activity size={16} strokeWidth={1.5} /> Activity Timeline
              <ChevronRight size={14} style={{ marginLeft: 'auto', transform: showActivityTimeline ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
            </h4>
            {showActivityTimeline && (
              <div className="activity-timeline">
                {activities.length > 0 ? (
                  activities.slice(0, 10).map((activity) => (
                    <div key={activity.id} className="activity-item">
                      <span className="activity-dot"></span>
                      <div className="activity-content">
                        <span className="activity-message">{activity.message}</span>
                        <span className="activity-time">{new Date(activity.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted" style={{ fontSize: '0.8rem' }}>No activity recorded yet</p>
                )}
              </div>
            )}
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

// Delete Confirmation Modal
function DeleteConfirmModal({ count, onClose, onConfirm }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-small" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Delete Companies</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <div className="delete-warning">
            <AlertCircle size={48} strokeWidth={1.5} />
            <p>Are you sure you want to delete <strong>{count}</strong> {count === 1 ? 'company' : 'companies'}?</p>
            <p className="text-muted">This action cannot be undone.</p>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>
            <Trash2 size={18} strokeWidth={1.5} />
            Delete {count} {count === 1 ? 'Company' : 'Companies'}
          </button>
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
function DossierModal({ dossier, companyId, onClose, onSaveToCompany, alreadySaved = false }) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(alreadySaved);
  const [followUpCreated, setFollowUpCreated] = useState({});

  if (!dossier) return null;

  const copyEmail = () => {
    if (dossier.outreachEmail) {
      navigator.clipboard.writeText(dossier.outreachEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  const handleSaveToCompany = async () => {
    if (!companyId || saving) return;
    setSaving(true);
    try {
      await onSaveToCompany(companyId, dossier);
      setSaved(true);
    } catch (err) {
      alert('Error saving: ' + (err.message || 'Unknown error'));
    }
    setSaving(false);
  };

  const handleCreateFollowUp = (contact, idx) => {
    // Get company name from dossier
    const companyName = dossier.company?.companyName || dossier.domain;

    // Create contact object for follow-up
    const contactData = {
      id: `dossier-${idx}`,
      companyId: companyId,
      companyName: companyName,
      name: contact.name,
      title: contact.title,
      email: contact.email || '',
      linkedin: contact.linkedin || '',
    };

    createFollowUpFromContact(contactData, `Reach out to ${contact.name} (${contact.title}) at ${companyName}`);
    setFollowUpCreated(prev => ({ ...prev, [idx]: true }));
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
          <div className="dossier-actions">
            {companyId && !saved && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveToCompany}
                disabled={saving}
              >
                {saving ? 'Saving...' : <><CheckCircle size={14} strokeWidth={1.5} /> Save to Company</>}
              </button>
            )}
            {saved && (
              <span className="saved-badge">
                <CheckCircle size={14} strokeWidth={2} /> Saved!
              </span>
            )}
            <button className="modal-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
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

          {/* Prospect Scorecard */}
          {dossier.scorecard && (
            <div className="dossier-section">
              <h4><Star size={16} strokeWidth={1.5} /> Prospect Scorecard</h4>
              <ProspectScorecard scorecard={dossier.scorecard} />
            </div>
          )}

          {/* Founder Due Diligence */}
          {dossier.founderProfiles && dossier.founderProfiles.length > 0 && (
            <div className="dossier-section">
              <h4><Award size={16} strokeWidth={1.5} /> Founder Due Diligence</h4>
              <div className="founder-profiles-list">
                {dossier.founderProfiles.map((profile, idx) => (
                  <FounderProfileCard key={idx} profile={profile} />
                ))}
              </div>
            </div>
          )}

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
                <span className={`value ${dossier.nycIntel?.confirmed === 'Yes' ? 'highlight' : dossier.nycIntel?.confirmed === 'Planned' ? 'text-warning' : ''}`}>
                  {dossier.nycIntel?.confirmed || dossier.company?.nycOfficeConfirmed || '-'}
                  {dossier.nycIntel?.confirmed === 'Planned' && ' (planning NYC office)'}
                </span>
              </div>
              <div className="dossier-item">
                <span className="label">NYC Headcount</span>
                <span className="value">{dossier.nycIntel?.nyc_headcount || '-'}</span>
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
                    <div className="contact-info">
                      <div className="contact-name">{contact.name}</div>
                      <div className="contact-title">{contact.title}</div>
                      {contact.linkedin && (
                        <a href={contact.linkedin} target="_blank" rel="noopener noreferrer" className="contact-linkedin">
                          LinkedIn <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                    <div className="contact-actions">
                      {followUpCreated[idx] ? (
                        <span className="followup-created">
                          <CheckCircle size={14} strokeWidth={2} /> Follow-up created
                        </span>
                      ) : (
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => handleCreateFollowUp(contact, idx)}
                          title="Create follow-up reminder"
                        >
                          <CalendarPlus size={14} strokeWidth={1.5} />
                          Follow-up
                        </button>
                      )}
                    </div>
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
            <h4><Newspaper size={16} strokeWidth={1.5} /> Recent News & Growth Signals</h4>
            {dossier.recentNews && dossier.recentNews.length > 0 ? (
              <div className="news-list">
                {dossier.recentNews.map((article, idx) => (
                  <div key={idx} className={`news-item ${article.relevance_confidence === 'high' ? 'news-high-confidence' : ''}`}>
                    <div className="news-header">
                      <a href={article.url} target="_blank" rel="noopener noreferrer" className="news-title">
                        {article.title} <ExternalLink size={12} />
                      </a>
                    </div>
                    <p className="news-snippet">{article.snippet}</p>
                    <div className="news-meta">
                      {article.newsType && article.newsType !== 'Company News' && (
                        <span className={`news-type-badge ${article.newsType.toLowerCase().replace(/[\s/&]+/g, '-')}`}>
                          {article.newsType}
                        </span>
                      )}
                      {article.relevance_confidence && (
                        <span className={`news-confidence-badge confidence-${article.relevance_confidence}`}>
                          {article.relevance_confidence === 'high' ? 'Verified' : 'Likely match'}
                        </span>
                      )}
                      <span className="news-source">{article.source}</span>
                      {article.publishedDate && article.publishedDate !== 'Unknown' && (
                        <span className="news-date">{article.publishedDate}</span>
                      )}
                    </div>
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [activeTab, setActiveTab] = useState('all'); // Prospect tier tab
  const [filters, setFilters] = useState({
    prospectStatus: '',
    nycOffice: '',
    fundingStage: '',
    companyStatus: '',
    agentStatus: '',
    employeeRange: '',
    fundingRange: '',
    fundingAmountMin: '',
    fundingAmountMax: '',
  });
  const [agentProgress, setAgentProgress] = useState(null);
  const [agentDossier, setAgentDossier] = useState(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentCompanyId, setAgentCompanyId] = useState(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const fileInputRef = useRef(null);
  const listRef = useRef(null);

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
      // Context-aware tagging: assign prospect_tier based on active tab
      const tierMapping = {
        tier_1_nyc_seed: 'tier_1_nyc_seed',
        tier_2_nyc_growth: 'tier_2_nyc_growth',
        tier_3_sf_expansion: 'tier_3_sf_expansion',
        tier_4_europe_expansion: 'tier_4_europe_expansion',
        all: null, // "All Companies" tab doesn't auto-assign a tier
      };
      const prospectTier = tierMapping[activeTab];
      const taggedData = mappedData.map(company => ({
        ...company,
        prospect_tier: prospectTier || company.prospect_tier || null,
      }));

      const updated = addToMasterList(taggedData);
      setCompanies(updated);

      const tierName = PROSPECT_TIERS.find(t => t.id === activeTab)?.name || 'All Companies';
      alert(`Successfully imported ${mappedData.length} companies${prospectTier ? ` into ${tierName}` : ''}!`);
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

  const handleRunAgent = async (domain, companyId) => {
    setAgentRunning(true);
    setAgentProgress({ step: 1, total: 8, message: 'Starting research agent...' });
    setAgentDossier(null);
    setAgentCompanyId(companyId);

    // Simulate progress updates (actual progress comes from API completion)
    const progressInterval = setInterval(() => {
      setAgentProgress(prev => {
        if (!prev || prev.step >= 7) return prev;
        const nextStep = prev.step + 1;
        const stepInfo = AGENT_STEPS.find(s => s.step === nextStep);
        return {
          step: nextStep,
          total: 8,
          message: stepInfo?.description || 'Processing...'
        };
      });
    }, 2500);

    try {
      const dossier = await runResearchAgent(domain, (progress) => {
        setAgentProgress(progress);
      });
      clearInterval(progressInterval);
      setAgentProgress({ step: 8, total: 8, message: 'Research complete!' });

      // Auto-save dossier to company immediately
      const updated = saveDossierToCompany(companyId, dossier);
      setCompanies(updated);

      // Also refresh selectedCompany if it's the one we just enriched
      const refreshed = updated.find(c => c.id === companyId);
      if (refreshed) setSelectedCompany(refreshed);

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

  // Helper to parse employee count to number
  const parseEmployeeCount = (str) => {
    if (!str) return 0;
    const num = parseInt(str.replace(/[^0-9]/g, ''));
    return isNaN(num) ? 0 : num;
  };

  // Helper to parse funding amount to number
  const parseFundingAmount = (str) => {
    if (!str) return 0;
    const cleaned = str.replace(/[$,]/g, '').toUpperCase();
    let multiplier = 1;
    if (cleaned.includes('B')) multiplier = 1000000000;
    else if (cleaned.includes('M')) multiplier = 1000000;
    else if (cleaned.includes('K')) multiplier = 1000;
    const num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? 0 : num * multiplier;
  };

  const filteredCompanies = companies.filter(company => {
    // First: Filter by prospect_tier based on active tab
    // "all" tab shows all companies, other tabs filter by tier
    if (activeTab !== 'all') {
      if (company.prospect_tier !== activeTab) return false;
    }

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const matchesSearch =
        company.organizationName?.toLowerCase().includes(search) ||
        company.description?.toLowerCase().includes(search) ||
        company.nycAddress?.toLowerCase().includes(search) ||
        company.industry?.toLowerCase().includes(search);
      if (!matchesSearch) return false;
    }

    if (filters.prospectStatus && company.prospectStatus !== filters.prospectStatus) {
      return false;
    }

    if (filters.nycOffice) {
      if (filters.nycOffice === 'yes' && company.nycOfficeConfirmed !== 'Yes') return false;
      if (filters.nycOffice === 'planned' && company.nycOfficeConfirmed !== 'Planned') return false;
      if (filters.nycOffice === 'no' && company.nycOfficeConfirmed === 'Yes') return false;
    }

    if (filters.fundingStage) {
      if (filters.fundingStage === 'ok' && company.fundingStageOK !== '✅ Yes') return false;
      if (filters.fundingStage === 'not_ok' && company.fundingStageOK === '✅ Yes') return false;
    }

    // Company status filter
    if (filters.companyStatus && company.status !== filters.companyStatus) {
      return false;
    }

    // Agent status filter
    if (filters.agentStatus) {
      if (filters.agentStatus === 'run' && !company.lastResearchedAt) return false;
      if (filters.agentStatus === 'not_run' && company.lastResearchedAt) return false;
      if (filters.agentStatus === 'stale' && (!company.lastResearchedAt || !isDataStale(company.lastResearchedAt))) return false;
    }

    // Employee count range filter
    if (filters.employeeRange) {
      const count = parseEmployeeCount(company.employeeCount);
      if (filters.employeeRange === '1-50' && (count < 1 || count > 50)) return false;
      if (filters.employeeRange === '51-200' && (count < 51 || count > 200)) return false;
      if (filters.employeeRange === '201-1000' && (count < 201 || count > 1000)) return false;
      if (filters.employeeRange === '1000+' && count < 1000) return false;
    }

    // Funding range filter
    if (filters.fundingRange) {
      const funding = parseFundingAmount(company.totalFunding);
      if (filters.fundingRange === '<10M' && funding >= 10000000) return false;
      if (filters.fundingRange === '10M-50M' && (funding < 10000000 || funding > 50000000)) return false;
      if (filters.fundingRange === '50M+' && funding < 50000000) return false;
    }

    // Funding amount (lastFundingAmount) min/max filter
    if (filters.fundingAmountMin || filters.fundingAmountMax) {
      const amount = parseFundingAmount(company.lastFundingAmount);
      if (filters.fundingAmountMin) {
        const min = parseFloat(filters.fundingAmountMin) * 1000000;
        if (amount < min) return false;
      }
      if (filters.fundingAmountMax) {
        const max = parseFloat(filters.fundingAmountMax) * 1000000;
        if (amount > max) return false;
      }
    }

    return true;
  });

  const selectedCompanies = filteredCompanies.filter(c => selectedIds.has(c.id));

  // Handle bulk delete
  const handleBulkDelete = () => {
    const updated = deleteCompaniesFromMasterList([...selectedIds]);
    setCompanies(updated);
    setSelectedIds(new Set());
    setShowDeleteModal(false);
  };

  // Handle company status change
  const handleStatusChange = (companyId, newStatus) => {
    const updated = updateCompanyStatus(companyId, newStatus);
    setCompanies(updated);
    // Refresh selected company if it's the one we changed
    const refreshed = updated.find(c => c.id === companyId);
    if (refreshed && selectedCompany?.id === companyId) {
      setSelectedCompany(refreshed);
    }
  };

  // Handle company profile save
  const handleSaveCompany = (companyId, editedData) => {
    const updatedCompanies = companies.map(c => {
      if (c.id === companyId) {
        // Parse industries if edited
        const newData = { ...c, ...editedData };
        if (editedData.industry && typeof editedData.industry === 'string') {
          newData.industries = parseIndustries(editedData.industry);
        }
        return newData;
      }
      return c;
    });
    saveMasterList(updatedCompanies);
    setCompanies(updatedCompanies);
    // Refresh selected company
    const refreshed = updatedCompanies.find(c => c.id === companyId);
    if (refreshed) setSelectedCompany(refreshed);
    logActivity('company_updated', `Company profile updated: ${refreshed?.organizationName}`, companyId);
  };

  // Bulk Run Agent on selected companies
  const handleBulkRunAgent = async () => {
    const selectedCompanyList = companies.filter(c => selectedIds.has(c.id));
    if (selectedCompanyList.length === 0) return;

    // Run agent on first company, queue the rest
    for (const company of selectedCompanyList) {
      const domain = getDomain(company.website);
      if (domain) {
        await handleRunAgent(domain, company.id);
      }
    }
    setSelectedIds(new Set());
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      // Don't trigger if a modal is open
      if (selectedCompany || showCRMModal || showDeleteModal || agentRunning || agentDossier) return;

      const visibleCompanies = filteredCompanies.slice(0, 100);

      switch (e.key) {
        case 'j': // Move down
          e.preventDefault();
          setFocusedIndex(prev => Math.min(prev + 1, visibleCompanies.length - 1));
          break;
        case 'k': // Move up
          e.preventDefault();
          setFocusedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'x': // Toggle selection
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < visibleCompanies.length) {
            toggleSelect(visibleCompanies[focusedIndex].id);
          }
          break;
        case 'r': // Run agent
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < visibleCompanies.length) {
            const company = visibleCompanies[focusedIndex];
            const domain = getDomain(company.website);
            if (domain) handleRunAgent(domain, company.id);
          }
          break;
        case 'd': // Delete (with Shift for safety)
          if (e.shiftKey && selectedIds.size > 0) {
            e.preventDefault();
            setShowDeleteModal(true);
          }
          break;
        case 'Enter': // Open company modal
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < visibleCompanies.length) {
            setSelectedCompany(visibleCompanies[focusedIndex]);
          }
          break;
        case 'Escape':
          setFocusedIndex(-1);
          setSelectedIds(new Set());
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, filteredCompanies, selectedCompany, showCRMModal, showDeleteModal, agentRunning, agentDossier, selectedIds]);

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Master List</h1>
          <p>
            {companies.length > 0
              ? `${filteredCompanies.length} companies${activeTab !== 'all' ? ` in ${PROSPECT_TIERS.find(t => t.id === activeTab)?.name}` : ''}`
              : 'Your complete company database from Crunchbase exports'}
          </p>
        </div>
        <div className="header-actions">
          {selectedIds.size > 0 && (
            <>
              <button className="btn btn-primary" onClick={() => setShowCRMModal(true)}>
                <Users size={18} strokeWidth={1.5} />
                Add {selectedIds.size} to CRM
              </button>
              <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)}>
                <Trash2 size={18} strokeWidth={1.5} />
                Delete {selectedIds.size}
              </button>
            </>
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

      {/* Prospect Tier Tabs */}
      <div className="tier-tabs">
        {PROSPECT_TIERS.map(tier => {
          const count = tier.id === 'all'
            ? companies.length
            : companies.filter(c => c.prospect_tier === tier.id).length;
          return (
            <button
              key={tier.id}
              className={`tier-tab ${activeTab === tier.id ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tier.id);
                setSelectedIds(new Set()); // Clear selection when switching tabs
                setFocusedIndex(-1);
              }}
              style={{ '--tier-color': tier.color }}
            >
              <span className="tier-tab-name">{tier.name}</span>
              <span className="tier-tab-count">{count}</span>
            </button>
          );
        })}
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
              {/* Company Status */}
              <select
                value={filters.companyStatus}
                onChange={(e) => setFilters(f => ({ ...f, companyStatus: e.target.value }))}
              >
                <option value="">Status - All</option>
                {COMPANY_STATUSES.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              {/* NYC Office */}
              <select
                value={filters.nycOffice}
                onChange={(e) => setFilters(f => ({ ...f, nycOffice: e.target.value }))}
              >
                <option value="">NYC Office - All</option>
                <option value="yes">Confirmed</option>
                <option value="planned">Planned</option>
                <option value="no">Not Confirmed</option>
              </select>

              {/* Employee Range */}
              <select
                value={filters.employeeRange}
                onChange={(e) => setFilters(f => ({ ...f, employeeRange: e.target.value }))}
              >
                <option value="">Employees - All</option>
                <option value="1-50">1-50</option>
                <option value="51-200">51-200</option>
                <option value="201-1000">201-1,000</option>
                <option value="1000+">1,000+</option>
              </select>

              {/* Total Funding */}
              <select
                value={filters.fundingRange}
                onChange={(e) => setFilters(f => ({ ...f, fundingRange: e.target.value }))}
              >
                <option value="">Funding - All</option>
                <option value="<10M">&lt; $10M</option>
                <option value="10M-50M">$10M - $50M</option>
                <option value="50M+">$50M+</option>
              </select>

              {/* Funding Amount Min/Max */}
              <div className="funding-amount-filter">
                <span className="funding-amount-label">Last Funding ($M)</span>
                <div className="funding-amount-inputs">
                  <input
                    type="number"
                    className="funding-amount-input"
                    placeholder="Min"
                    value={filters.fundingAmountMin}
                    onChange={(e) => setFilters(f => ({ ...f, fundingAmountMin: e.target.value }))}
                    min="0"
                    step="0.5"
                  />
                  <span className="funding-amount-separator">&ndash;</span>
                  <input
                    type="number"
                    className="funding-amount-input"
                    placeholder="Max"
                    value={filters.fundingAmountMax}
                    onChange={(e) => setFilters(f => ({ ...f, fundingAmountMax: e.target.value }))}
                    min="0"
                    step="0.5"
                  />
                </div>
              </div>

              {/* Agent Status */}
              <select
                value={filters.agentStatus}
                onChange={(e) => setFilters(f => ({ ...f, agentStatus: e.target.value }))}
              >
                <option value="">Agent - All</option>
                <option value="run">Agent Run</option>
                <option value="not_run">Not Run</option>
                <option value="stale">Stale (&gt;30 days)</option>
              </select>

              {/* Prospect Status (legacy) */}
              <select
                value={filters.prospectStatus}
                onChange={(e) => setFilters(f => ({ ...f, prospectStatus: e.target.value }))}
              >
                <option value="">Prospect - All</option>
                <option value="🔥 Hot Prospect">Hot Prospect</option>
                <option value="👀 Worth a Look">Worth a Look</option>
                <option value="❄️ Low Priority">Low Priority</option>
              </select>

              <button
                className="btn btn-secondary"
                onClick={() => setFilters({
                  prospectStatus: '', nycOffice: '', fundingStage: '',
                  companyStatus: '', agentStatus: '', employeeRange: '', fundingRange: '',
                  fundingAmountMin: '', fundingAmountMax: '',
                })}
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
                {/* Bulk action buttons */}
                {selectedIds.size > 0 && (
                  <div className="bulk-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleBulkRunAgent}
                      title="Run research agent on selected companies"
                    >
                      <Bot size={14} strokeWidth={1.5} />
                      Run Agent ({selectedIds.size})
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowCRMModal(true)}
                    >
                      <Plus size={14} strokeWidth={1.5} />
                      Add to CRM
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setShowDeleteModal(true)}
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
              <div className="dossier-grid" ref={listRef}>
                {filteredCompanies.slice(0, 100).map((company, index) => (
                  <DossierCard
                    key={company.id}
                    company={company}
                    isSelected={selectedIds.has(company.id)}
                    isFocused={focusedIndex === index}
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
                      <th>Score</th>
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
                          {company.prospectScore != null && company.prospectScore !== '' ? (
                            <span className={`prospect-score-pill ${company.prospectScore >= 8 ? 'score-high' : company.prospectScore >= 5 ? 'score-mid' : 'score-low'}`}>
                              <Star size={11} strokeWidth={2} />
                              {company.prospectScore}/10
                            </span>
                          ) : company.prospectStatus ? (
                            <span className={`prospect-badge ${getProspectBadgeClass(company.prospectStatus)}`}>
                              {company.prospectStatus}
                            </span>
                          ) : '-'}
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
                           company.nycOfficeConfirmed === 'Planned' ? '📋' :
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
          onDelete={handleDeleteCompany}
          onRunAgent={handleRunAgent}
          onStatusChange={handleStatusChange}
          onSaveCompany={handleSaveCompany}
          onViewDossier={(dossier, companyId) => {
            setAgentDossier(dossier);
            setAgentCompanyId(companyId);
          }}
        />
      )}

      {showDeleteModal && (
        <DeleteConfirmModal
          count={selectedIds.size}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleBulkDelete}
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
          companyId={agentCompanyId}
          alreadySaved={true}
          onClose={() => {
            setAgentDossier(null);
            setAgentCompanyId(null);
          }}
          onSaveToCompany={(companyId, dossier) => {
            const updated = saveDossierToCompany(companyId, dossier);
            setCompanies(updated);
          }}
        />
      )}
    </div>
  );
}

export default MasterList;
