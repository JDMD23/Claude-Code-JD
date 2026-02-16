import { useState, useEffect } from 'react';
import { Plus, LayoutGrid, List, X, Users, Building2, Mail, Phone, FileText, Search, ExternalLink, Trash2 } from 'lucide-react';
import { getProspects, saveProspect, deleteProspect, updateProspectStage, addProspectNote, PROSPECT_STAGES } from '../store/dataStore';
import './Pages.css';
import './DealPipeline.css';

function Prospects() {
  const [prospects, setProspects] = useState([]);
  const [viewMode, setViewMode] = useState('board');
  const [showModal, setShowModal] = useState(false);
  const [editingProspect, setEditingProspect] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    setProspects(getProspects());
  }, []);

  const handleSave = (data) => {
    const updated = saveProspect(data);
    setProspects(updated);
    setShowModal(false);
    setEditingProspect(null);
  };

  const handleDelete = (id) => {
    const updated = deleteProspect(id);
    setProspects(updated);
    setShowModal(false);
    setEditingProspect(null);
  };

  const handleStageChange = (prospectId, newStage) => {
    const updated = updateProspectStage(prospectId, newStage);
    setProspects(updated);
  };

  const handleAddNote = (prospectId, note) => {
    const updated = addProspectNote(prospectId, note);
    setProspects(updated);
  };

  const openEdit = (prospect) => {
    setEditingProspect(prospect);
    setShowModal(true);
  };

  const openNew = () => {
    setEditingProspect(null);
    setShowModal(true);
  };

  const filtered = prospects.filter(p => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return p.organizationName?.toLowerCase().includes(s) ||
           p.contactName?.toLowerCase().includes(s) ||
           p.contactEmail?.toLowerCase().includes(s);
  });

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Prospects CRM</h1>
          <p>{prospects.length > 0 ? `${prospects.length} prospects` : 'Manage your business development pipeline'}</p>
        </div>
        <div className="header-actions">
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'board' ? 'active' : ''}`}
              onClick={() => setViewMode('board')}
            >
              <LayoutGrid size={18} strokeWidth={1.5} />
            </button>
            <button
              className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              <List size={18} strokeWidth={1.5} />
            </button>
          </div>
          <button className="btn btn-primary" onClick={openNew}>
            <Plus size={18} strokeWidth={1.5} />
            Add Prospect
          </button>
        </div>
      </div>

      {prospects.length > 0 && viewMode === 'table' && (
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={18} strokeWidth={1.5} className="search-icon" />
            <input
              type="text"
              placeholder="Search prospects..."
              className="search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '2.5rem' }}
            />
          </div>
        </div>
      )}

      {viewMode === 'board' ? (
        <div className="kanban-board">
          {PROSPECT_STAGES.map((stage) => {
            const stageProspects = filtered.filter(p => p.crmStage === stage.id);
            return (
              <div key={stage.id} className="kanban-column">
                <div className="kanban-header">
                  <h4>{stage.name}</h4>
                  <span className="deal-count">{stageProspects.length}</span>
                </div>
                <div className="kanban-cards">
                  {stageProspects.length === 0 ? (
                    <div className="empty-column">
                      <p>No prospects</p>
                    </div>
                  ) : (
                    stageProspects.map(prospect => (
                      <ProspectCard
                        key={prospect.id}
                        prospect={prospect}
                        onClick={() => openEdit(prospect)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {filtered.length === 0 ? (
            <div className="empty-state large">
              <Users size={48} strokeWidth={1.5} className="empty-icon" />
              <h3>No prospects yet</h3>
              <p>Import companies from the Master List or add prospects manually</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Stage</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th style={{ width: '60px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(prospect => (
                    <tr
                      key={prospect.id}
                      onClick={() => openEdit(prospect)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="primary-cell">
                        <div>{prospect.organizationName}</div>
                        {prospect.website && (
                          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                            {prospect.website.replace(/https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '')}
                          </span>
                        )}
                      </td>
                      <td>
                        {prospect.contactName && <div>{prospect.contactName}</div>}
                        {prospect.contactEmail && (
                          <span className="text-muted" style={{ fontSize: '0.75rem' }}>{prospect.contactEmail}</span>
                        )}
                      </td>
                      <td>
                        <span className="text-secondary" style={{ fontSize: '0.8rem' }}>
                          {PROSPECT_STAGES.find(s => s.id === prospect.crmStage)?.name || prospect.crmStage}
                        </span>
                      </td>
                      <td>
                        {prospect.prospectStatus && (
                          <span className={`prospect-badge ${getProspectBadgeClass(prospect.prospectStatus)}`}>
                            {prospect.prospectStatus}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                          {prospect.notes?.length || 0}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-btn danger"
                          onClick={() => {
                            if (confirm('Delete this prospect?')) handleDelete(prospect.id);
                          }}
                        >
                          <Trash2 size={16} strokeWidth={1.5} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <ProspectModal
          prospect={editingProspect}
          onClose={() => { setShowModal(false); setEditingProspect(null); }}
          onSave={handleSave}
          onDelete={handleDelete}
          onAddNote={handleAddNote}
          onStageChange={handleStageChange}
        />
      )}
    </div>
  );
}

function getProspectBadgeClass(status) {
  if (!status) return '';
  if (status.includes('Hot')) return 'hot';
  if (status.includes('Worth') || status.includes('Look')) return 'look';
  return 'low';
}

function ProspectCard({ prospect, onClick }) {
  return (
    <div className="deal-card" onClick={onClick}>
      <h4 className="deal-client">{prospect.organizationName}</h4>
      {prospect.contactName && (
        <div className="deal-meta">
          <span className="meta-item">
            <Users size={14} strokeWidth={1.5} />
            {prospect.contactName}
          </span>
        </div>
      )}
      {prospect.prospectStatus && (
        <span className={`prospect-badge ${getProspectBadgeClass(prospect.prospectStatus)}`}>
          {prospect.prospectStatus}
        </span>
      )}
      {prospect.notes && prospect.notes.length > 0 && (
        <div className="deal-footer">
          <span className="days-badge" style={{ color: 'var(--text-muted)' }}>
            {prospect.notes.length} note{prospect.notes.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}

function ProspectModal({ prospect, onClose, onSave, onDelete, onAddNote, onStageChange }) {
  const [formData, setFormData] = useState({
    organizationName: '',
    website: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    crmStage: 'top_pursuits',
    prospectStatus: '',
    ...prospect,
  });
  const [newNote, setNewNote] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.organizationName.trim()) return;
    onSave(formData);
  };

  const handleAddNote = () => {
    if (!newNote.trim() || !prospect?.id) return;
    onAddNote(prospect.id, newNote.trim());
    setNewNote('');
    // Refresh the prospect's notes in local state
    setFormData(prev => ({
      ...prev,
      notes: [{ id: Date.now(), text: newNote.trim(), createdAt: new Date().toISOString() }, ...(prev.notes || [])],
    }));
  };

  const isEdit = !!prospect?.id;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? prospect.organizationName : 'New Prospect'}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group full-width">
              <label><Building2 size={14} strokeWidth={1.5} /> Company Name *</label>
              <input
                type="text"
                name="organizationName"
                value={formData.organizationName}
                onChange={handleChange}
                placeholder="Company name"
                required
              />
            </div>

            <div className="form-group">
              <label>Website</label>
              <input
                type="text"
                name="website"
                value={formData.website}
                onChange={handleChange}
                placeholder="company.com"
              />
            </div>

            <div className="form-group">
              <label>CRM Stage</label>
              <select name="crmStage" value={formData.crmStage} onChange={handleChange}>
                {PROSPECT_STAGES.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label><Users size={14} strokeWidth={1.5} /> Contact Name</label>
              <input
                type="text"
                name="contactName"
                value={formData.contactName}
                onChange={handleChange}
                placeholder="Primary contact"
              />
            </div>

            <div className="form-group">
              <label><Mail size={14} strokeWidth={1.5} /> Contact Email</label>
              <input
                type="email"
                name="contactEmail"
                value={formData.contactEmail}
                onChange={handleChange}
                placeholder="email@company.com"
              />
            </div>

            <div className="form-group">
              <label><Phone size={14} strokeWidth={1.5} /> Contact Phone</label>
              <input
                type="tel"
                name="contactPhone"
                value={formData.contactPhone}
                onChange={handleChange}
                placeholder="(555) 555-5555"
              />
            </div>

            <div className="form-group">
              <label>Prospect Status</label>
              <select name="prospectStatus" value={formData.prospectStatus} onChange={handleChange}>
                <option value="">None</option>
                <option value="🔥 Hot Prospect">Hot Prospect</option>
                <option value="👀 Worth a Look">Worth a Look</option>
                <option value="❄️ Low Priority">Low Priority</option>
              </select>
            </div>
          </div>

          {/* Notes section for existing prospects */}
          {isEdit && (
            <div style={{ padding: '0 1.5rem 1rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.5rem' }}>
                <FileText size={14} strokeWidth={1.5} /> Notes
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNote(); } }}
                />
                <button type="button" className="btn btn-secondary" onClick={handleAddNote} disabled={!newNote.trim()}>
                  Add
                </button>
              </div>
              {formData.notes && formData.notes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', maxHeight: '150px', overflowY: 'auto' }}>
                  {formData.notes.map((note, i) => (
                    <div key={note.id || i} style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--text-primary)' }}>{note.text}</span>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        {new Date(note.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="modal-footer">
            {isEdit && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (confirm('Delete this prospect?')) onDelete(prospect.id);
                }}
              >
                Delete
              </button>
            )}
            <div className="footer-right">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">
                {isEdit ? 'Save Changes' : 'Add Prospect'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Prospects;
