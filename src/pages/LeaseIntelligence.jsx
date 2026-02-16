import { useState, useEffect } from 'react';
import { FileText, Search, Plus, X, Tag, Trash2, Copy, Edit3, BookOpen, GitCompare, ChevronDown, ChevronUp } from 'lucide-react';
import { getClauses, saveClause, deleteClause, CLAUSE_CATEGORIES } from '../store/dataStore';
import './Pages.css';
import './LeaseIntelligence.css';

function LeaseIntelligence() {
  const [activeTab, setActiveTab] = useState('library');
  const [clauses, setClauses] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingClause, setEditingClause] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  // Redline state
  const [redlineOriginal, setRedlineOriginal] = useState('');
  const [redlineRevised, setRedlineRevised] = useState('');
  const [redlineDiff, setRedlineDiff] = useState(null);

  useEffect(() => {
    setClauses(getClauses());
  }, []);

  const handleSave = (data) => {
    const updated = saveClause(data);
    setClauses(updated);
    setShowModal(false);
    setEditingClause(null);
  };

  const handleDelete = (id) => {
    const updated = deleteClause(id);
    setClauses(updated);
    setShowModal(false);
    setEditingClause(null);
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
  };

  const filtered = clauses.filter(c => {
    if (filterCategory !== 'all' && c.category !== filterCategory) return false;
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return c.title?.toLowerCase().includes(s) ||
           c.clauseText?.toLowerCase().includes(s) ||
           c.tags?.some(t => t.toLowerCase().includes(s));
  });

  // Simple diff algorithm for redline comparison
  const computeDiff = () => {
    if (!redlineOriginal.trim() || !redlineRevised.trim()) return;

    const origWords = redlineOriginal.split(/(\s+)/);
    const revWords = redlineRevised.split(/(\s+)/);

    // Simple word-level diff
    const result = [];
    let oi = 0, ri = 0;

    while (oi < origWords.length || ri < revWords.length) {
      if (oi >= origWords.length) {
        result.push({ type: 'added', text: revWords[ri] });
        ri++;
      } else if (ri >= revWords.length) {
        result.push({ type: 'removed', text: origWords[oi] });
        oi++;
      } else if (origWords[oi] === revWords[ri]) {
        result.push({ type: 'same', text: origWords[oi] });
        oi++;
        ri++;
      } else {
        // Look ahead for matches
        let foundInRev = revWords.indexOf(origWords[oi], ri);
        let foundInOrig = origWords.indexOf(revWords[ri], oi);

        if (foundInRev !== -1 && (foundInOrig === -1 || foundInRev - ri <= foundInOrig - oi)) {
          // Words were added before original word
          while (ri < foundInRev) {
            result.push({ type: 'added', text: revWords[ri] });
            ri++;
          }
        } else if (foundInOrig !== -1) {
          // Words were removed from original
          while (oi < foundInOrig) {
            result.push({ type: 'removed', text: origWords[oi] });
            oi++;
          }
        } else {
          result.push({ type: 'removed', text: origWords[oi] });
          result.push({ type: 'added', text: revWords[ri] });
          oi++;
          ri++;
        }
      }
    }

    const added = result.filter(r => r.type === 'added' && r.text.trim()).length;
    const removed = result.filter(r => r.type === 'removed' && r.text.trim()).length;
    setRedlineDiff({ segments: result, added, removed });
  };

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Lease Intelligence</h1>
          <p>Build your clause library and compare lease redlines</p>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => setActiveTab('library')}
        >
          <BookOpen size={18} strokeWidth={1.5} />
          Clause Library
        </button>
        <button
          className={`tab ${activeTab === 'redline' ? 'active' : ''}`}
          onClick={() => setActiveTab('redline')}
        >
          <GitCompare size={18} strokeWidth={1.5} />
          Redline Auditor
        </button>
      </div>

      {activeTab === 'library' ? (
        <>
          <div className="clause-toolbar">
            <div className="search-box">
              <Search size={18} strokeWidth={1.5} className="search-icon" />
              <input
                type="text"
                placeholder="Search clauses..."
                className="search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingLeft: '2.5rem' }}
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="clause-filter-select"
            >
              <option value="all">All Categories</option>
              {CLAUSE_CATEGORIES.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={() => { setEditingClause(null); setShowModal(true); }}>
              <Plus size={18} strokeWidth={1.5} />
              Add Clause
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="card">
              <div className="empty-state large">
                <FileText size={48} strokeWidth={1.5} className="empty-icon" />
                <h3>{clauses.length === 0 ? 'No clauses yet' : 'No matching clauses'}</h3>
                <p>{clauses.length === 0
                  ? 'Build your clause library by saving negotiated lease language'
                  : 'Try adjusting your search or filter'
                }</p>
              </div>
            </div>
          ) : (
            <div className="clause-list">
              {filtered.map(clause => (
                <div key={clause.id} className="card clause-card">
                  <div className="clause-card-header" onClick={() => setExpandedId(expandedId === clause.id ? null : clause.id)}>
                    <div className="clause-card-title">
                      <h4>{clause.title}</h4>
                      <span className="clause-category-badge">
                        {CLAUSE_CATEGORIES.find(c => c.id === clause.category)?.name || clause.category}
                      </span>
                    </div>
                    <div className="clause-card-actions">
                      {expandedId === clause.id ? <ChevronUp size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}
                    </div>
                  </div>

                  {clause.tags && clause.tags.length > 0 && (
                    <div className="clause-tags">
                      {clause.tags.map((tag, i) => (
                        <span key={i} className="clause-tag"><Tag size={10} strokeWidth={1.5} />{tag}</span>
                      ))}
                    </div>
                  )}

                  {expandedId === clause.id && (
                    <div className="clause-expanded">
                      <div className="clause-text-block">
                        <pre className="clause-text">{clause.clauseText}</pre>
                      </div>
                      {clause.notes && (
                        <div className="clause-notes">
                          <span className="clause-notes-label">Notes:</span> {clause.notes}
                        </div>
                      )}
                      {clause.sourceLease && (
                        <div className="clause-source">
                          Source: {clause.sourceLease}
                        </div>
                      )}
                      <div className="clause-expanded-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => handleCopy(clause.clauseText)}>
                          <Copy size={14} strokeWidth={1.5} /> Copy
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditingClause(clause); setShowModal(true); }}>
                          <Edit3 size={14} strokeWidth={1.5} /> Edit
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => { if (confirm('Delete this clause?')) handleDelete(clause.id); }}>
                          <Trash2 size={14} strokeWidth={1.5} /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="redline-section">
          <div className="redline-inputs">
            <div className="redline-panel">
              <label>Original Clause</label>
              <textarea
                value={redlineOriginal}
                onChange={(e) => setRedlineOriginal(e.target.value)}
                placeholder="Paste the original lease clause..."
                rows={8}
              />
            </div>
            <div className="redline-panel">
              <label>Revised Clause</label>
              <textarea
                value={redlineRevised}
                onChange={(e) => setRedlineRevised(e.target.value)}
                placeholder="Paste the revised/negotiated clause..."
                rows={8}
              />
            </div>
          </div>

          <div className="redline-actions">
            <button
              className="btn btn-primary"
              onClick={computeDiff}
              disabled={!redlineOriginal.trim() || !redlineRevised.trim()}
            >
              <GitCompare size={18} strokeWidth={1.5} />
              Compare
            </button>
            {redlineDiff && (
              <button className="btn btn-secondary" onClick={() => { setRedlineDiff(null); setRedlineOriginal(''); setRedlineRevised(''); }}>
                Clear
              </button>
            )}
          </div>

          {redlineDiff && (
            <div className="card redline-result">
              <div className="redline-summary">
                <span className="redline-stat added">+{redlineDiff.added} added</span>
                <span className="redline-stat removed">-{redlineDiff.removed} removed</span>
              </div>
              <div className="redline-diff">
                {redlineDiff.segments.map((seg, i) => (
                  <span key={i} className={`diff-${seg.type}`}>{seg.text}</span>
                ))}
              </div>
            </div>
          )}

          {!redlineDiff && (
            <div className="card">
              <div className="empty-state">
                <GitCompare size={36} strokeWidth={1.5} className="empty-icon" />
                <h3>Compare lease clauses</h3>
                <p>Paste original and revised clauses to see a word-level diff highlighting additions and removals</p>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <ClauseModal
          clause={editingClause}
          onClose={() => { setShowModal(false); setEditingClause(null); }}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

function ClauseModal({ clause, onClose, onSave, onDelete }) {
  const [formData, setFormData] = useState({
    title: '',
    category: 'rent',
    clauseText: '',
    notes: '',
    sourceLease: '',
    tags: [],
    ...clause,
  });
  const [tagInput, setTagInput] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.clauseText.trim()) return;
    onSave(formData);
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !formData.tags.includes(tag)) {
      setFormData(prev => ({ ...prev, tags: [...prev.tags, tag] }));
    }
    setTagInput('');
  };

  const removeTag = (tag) => {
    setFormData(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  const isEdit = !!clause?.id;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Clause' : 'Add Clause'}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Title *</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="e.g. Favorable rent escalation cap"
                required
              />
            </div>

            <div className="form-group">
              <label>Category</label>
              <select name="category" value={formData.category} onChange={handleChange}>
                {CLAUSE_CATEGORIES.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Source Lease</label>
              <input
                type="text"
                name="sourceLease"
                value={formData.sourceLease}
                onChange={handleChange}
                placeholder="e.g. WeWork 2024 Lease"
              />
            </div>

            <div className="form-group full-width">
              <label>Clause Text *</label>
              <textarea
                name="clauseText"
                value={formData.clauseText}
                onChange={handleChange}
                placeholder="Paste the clause language..."
                rows={6}
                required
              />
            </div>

            <div className="form-group full-width">
              <label>Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Context, negotiation tips, when to use..."
                rows={2}
              />
            </div>

            <div className="form-group full-width">
              <label>Tags</label>
              <div className="tag-input-wrap">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="Add tags..."
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={addTag} disabled={!tagInput.trim()}>Add</button>
              </div>
              {formData.tags.length > 0 && (
                <div className="clause-tags" style={{ marginTop: '0.5rem' }}>
                  {formData.tags.map((tag, i) => (
                    <span key={i} className="clause-tag">
                      {tag}
                      <button type="button" className="tag-remove" onClick={() => removeTag(tag)}><X size={10} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            {isEdit && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => { if (confirm('Delete this clause?')) onDelete(clause.id); }}
              >
                Delete
              </button>
            )}
            <div className="footer-right">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">
                {isEdit ? 'Save Changes' : 'Add Clause'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LeaseIntelligence;
