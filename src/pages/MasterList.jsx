import { Upload, Search, Filter } from 'lucide-react';
import './Pages.css';

function MasterList() {
  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Master List</h1>
          <p>Your complete company database from Clay exports</p>
        </div>
        <button className="btn btn-primary">
          <Upload size={18} />
          Import CSV
        </button>
      </div>

      <div className="card">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search companies..."
              className="search-input"
            />
          </div>
          <div className="filter-group">
            <button className="btn btn-secondary">
              <Filter size={18} />
              Filters
            </button>
          </div>
        </div>

        <div className="empty-state large">
          <Upload size={48} className="empty-icon" />
          <h3>No companies imported yet</h3>
          <p>Upload a CSV file from Clay to populate your master list</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }}>
            <Upload size={18} />
            Import CSV
          </button>
        </div>
      </div>
    </div>
  );
}

export default MasterList;
