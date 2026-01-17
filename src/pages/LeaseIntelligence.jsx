import { FileText, Upload, Search } from 'lucide-react';
import { useState } from 'react';
import './Pages.css';

function LeaseIntelligence() {
  const [activeTab, setActiveTab] = useState('library');

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Lease Intelligence</h1>
          <p>Learn from negotiated leases and get AI-powered clause suggestions</p>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => setActiveTab('library')}
        >
          <FileText size={18} />
          Lease Library
        </button>
        <button
          className={`tab ${activeTab === 'analyzer' ? 'active' : ''}`}
          onClick={() => setActiveTab('analyzer')}
        >
          <Search size={18} />
          Clause Analyzer
        </button>
      </div>

      {activeTab === 'library' ? (
        <div className="card">
          <div className="empty-state large">
            <Upload size={48} className="empty-icon" />
            <h3>No leases uploaded yet</h3>
            <p>Upload negotiated leases to build your intelligence database</p>
            <button className="btn btn-primary" style={{ marginTop: '1rem' }}>
              <Upload size={18} />
              Upload Lease
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="analyzer-input">
            <label htmlFor="clause-input">Paste a clause from your draft lease:</label>
            <textarea
              id="clause-input"
              placeholder="Paste lease clause here for analysis..."
              rows={6}
            />
            <button className="btn btn-primary" style={{ marginTop: '1rem' }}>
              <Search size={18} />
              Analyze Clause
            </button>
          </div>

          <div className="analysis-placeholder">
            <p className="text-muted">
              Analysis results will appear here after you submit a clause.
              This feature requires uploading leases to your library first.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default LeaseIntelligence;
