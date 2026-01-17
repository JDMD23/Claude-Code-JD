import { useState, useEffect, useRef } from 'react';
import { Upload, Search, Filter, X, Users, Building2, DollarSign, Briefcase, ExternalLink, Check, ChevronDown } from 'lucide-react';
import { getMasterList, addToMasterList, saveMasterList, saveProspect, getProspects, PROSPECT_STAGES } from '../store/dataStore';
import './Pages.css';
import './DealPipeline.css';

// Parse CSV text into array of objects
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  // Parse header - handle quoted fields
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
    // Company Info
    organizationName: row['Organization Name'] || row['Company Name'] || row['Name'] || '',
    website: row['Website'] || row['URL'] || '',
    linkedin: row['LinkedIn'] || row['LinkedIn URL'] || '',
    foundedDate: row['Founded Date'] || row['Founded'] || '',
    description: row['Description'] || '',

    // Funding Info
    topInvestors: row['Top 5 Investors'] || row['Investors'] || '',
    fundingRounds: row['Number of Funding Rounds'] || row['Funding Rounds'] || '',
    lastFundingDate: row['Last Funding Date'] || '',
    lastFundingType: row['Last Funding Type'] || '',
    lastFundingAmount: row['Last Funding Amount (in USD)'] || row['Last Funding Amount'] || '',
    totalFunding: row['Total Funding Amount (in USD)'] || row['Total Funding'] || '',
    fundingInRange: row['Funding in Range'] || '',
    fundingStageOK: row['Funding Stage OK'] || '',

    // Enrichment Data
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

    // Scoring
    prospectScore: row['Prospect Score'] || '',
    prospectStatus: row['Prospect Status'] || '',

    // Contacts
    keyContacts: row['Key Contacts'] || '',
  }));
}

// Company Detail Modal
function CompanyModal({ company, onClose }) {
  if (!company) return null;

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
          <div>
            <h2>{company.organizationName}</h2>
            {company.prospectStatus && (
              <span className={`prospect-badge ${getProspectBadgeClass(company.prospectStatus)}`}>
                {company.prospectStatus}
              </span>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div className="info-section">
            <h4><Building2 size={16} /> Company Info</h4>
            <InfoRow label="Website" value={company.website} isLink />
            <InfoRow label="LinkedIn" value={company.linkedin} isLink />
            <InfoRow label="Founded" value={company.foundedDate} />
            <InfoRow label="Description" value={company.description} />
            <InfoRow label="NYC Address" value={company.nycAddress} />
            <InfoRow label="NYC Office Confirmed" value={company.nycOfficeConfirmed} />
          </div>

          <div className="info-section">
            <h4><Users size={16} /> Team & Hiring</h4>
            <InfoRow label="Employee Count" value={company.employeeCount} />
            <InfoRow label="Headcount Filter" value={company.headcountFilter} />
            <InfoRow label="Total Jobs" value={company.totalJobs} />
            <InfoRow label="NYC Jobs" value={company.nycJobs} />
            <InfoRow label="Remote Jobs" value={company.remoteJobs} />
            <InfoRow label="Hybrid Jobs" value={company.hybridJobs} />
            <InfoRow label="In-Office Jobs" value={company.inOfficeJobs} />
            <InfoRow label="Departments Hiring" value={company.departmentsHiring} />
            <InfoRow label="Work Policy" value={company.workPolicyQuote} />
            <InfoRow label="Careers Page" value={company.careersUrl} isLink />
          </div>

          <div className="info-section">
            <h4><DollarSign size={16} /> Funding</h4>
            <InfoRow label="Total Funding" value={company.totalFunding ? `$${parseInt(company.totalFunding).toLocaleString()}` : ''} />
            <InfoRow label="Last Funding Amount" value={company.lastFundingAmount ? `$${parseInt(company.lastFundingAmount).toLocaleString()}` : ''} />
            <InfoRow label="Last Funding Type" value={company.lastFundingType} />
            <InfoRow label="Last Funding Date" value={company.lastFundingDate} />
            <InfoRow label="Funding Rounds" value={company.fundingRounds} />
            <InfoRow label="Top Investors" value={company.topInvestors} />
            <InfoRow label="Funding in Range" value={company.fundingInRange} />
            <InfoRow label="Funding Stage OK" value={company.fundingStageOK} />
          </div>

          <div className="info-section">
            <h4><Briefcase size={16} /> Scoring & Contacts</h4>
            <InfoRow label="Prospect Score" value={company.prospectScore} />
            <InfoRow label="Prospect Status" value={company.prospectStatus} />
            <InfoRow label="Key Contacts" value={company.keyContacts} />
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
  const [filters, setFilters] = useState({
    prospectStatus: '',
    nycOffice: '',
    fundingStage: '',
  });
  const fileInputRef = useRef(null);

  useEffect(() => {
    setCompanies(getMasterList());
  }, []);

  // Handle file upload
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

  // Filter companies
  const filteredCompanies = companies.filter(company => {
    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const matchesSearch =
        company.organizationName?.toLowerCase().includes(search) ||
        company.description?.toLowerCase().includes(search) ||
        company.nycAddress?.toLowerCase().includes(search);
      if (!matchesSearch) return false;
    }

    // Status filter
    if (filters.prospectStatus && company.prospectStatus !== filters.prospectStatus) {
      return false;
    }

    // NYC Office filter
    if (filters.nycOffice) {
      if (filters.nycOffice === 'yes' && company.nycOfficeConfirmed !== 'Yes') return false;
      if (filters.nycOffice === 'no' && company.nycOfficeConfirmed === 'Yes') return false;
    }

    // Funding stage filter
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
              <Users size={18} />
              Add {selectedIds.size} to CRM
            </button>
          )}
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} />
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
          <Upload size={48} className="upload-icon" />
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
                <option value="🔥 Hot Prospect">🔥 Hot Prospect</option>
                <option value="👀 Worth a Look">👀 Worth a Look</option>
                <option value="❄️ Low Priority">❄️ Low Priority</option>
                <option value="❌ Remote Only">❌ Remote Only</option>
                <option value="❌ No NYC Presence">❌ No NYC Presence</option>
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
                        {company.organizationName}
                        {company.website && (
                          <span className="text-muted" style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                            {company.website.replace(/https?:\/\//, '').replace(/\/$/, '')}
                          </span>
                        )}
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
                            ${(parseInt(company.lastFundingAmount) / 1000000).toFixed(1)}M
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
        </>
      )}

      {selectedCompany && (
        <CompanyModal
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
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
