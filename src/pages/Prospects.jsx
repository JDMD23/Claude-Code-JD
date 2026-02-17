import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, LayoutGrid, List, GripVertical, ExternalLink, ArrowRightCircle, Trash2 } from 'lucide-react';
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, useDroppable, rectIntersection } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getProspects, saveProspect, updateProspectStage, deleteProspect,
  PROSPECT_STAGES, saveDeal, getDeals,
} from '../store/dataStore';
import './Pages.css';

// ============ Prospect Card (draggable) ============
function ProspectCard({ prospect, onClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: prospect.id,
    data: { type: 'card', stage: prospect.crmStage },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const statusClass = prospect.prospectStatus === 'Hot Prospect' ? 'hot'
    : prospect.prospectStatus === 'Looking' ? 'look' : 'low';

  const domain = prospect.website
    ? prospect.website.replace(/https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
    : '';

  return (
    <div ref={setNodeRef} style={style} className="deal-card" onClick={() => onClick(prospect)}>
      <div className="deal-card-header">
        <div className="drag-handle" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </div>
        {prospect.prospectStatus && (
          <span className={`prospect-badge ${statusClass}`}>{prospect.prospectStatus}</span>
        )}
      </div>
      <h4 className="deal-client">{prospect.organizationName || 'Unnamed'}</h4>
      {prospect.contactName && <p className="deal-nickname">{prospect.contactName}</p>}
      {domain && (
        <div className="deal-meta">
          <span className="meta-item" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{domain}</span>
        </div>
      )}
    </div>
  );
}

// ============ Droppable Column ============
function DroppableColumn({ id, children }) {
  const { isOver, setNodeRef } = useDroppable({ id, data: { type: 'column' } });
  return (
    <div ref={setNodeRef} className={`kanban-column ${isOver ? 'column-drag-over' : ''}`}>
      {children}
    </div>
  );
}

// ============ Kanban Column ============
function KanbanColumn({ stage, prospects, onCardClick }) {
  const stageProspects = prospects.filter(p => p.crmStage === stage.id);

  return (
    <DroppableColumn id={stage.id}>
      <div className="kanban-header">
        <h4>{stage.name}</h4>
        <span className="deal-count">{stageProspects.length}</span>
      </div>
      <SortableContext items={stageProspects.map(p => p.id)} strategy={verticalListSortingStrategy}>
        <div className="kanban-cards">
          {stageProspects.length === 0 ? (
            <div className="empty-column"><p>No prospects</p></div>
          ) : (
            stageProspects.map(p => (
              <ProspectCard key={p.id} prospect={p} onClick={onCardClick} />
            ))
          )}
        </div>
      </SortableContext>
    </DroppableColumn>
  );
}

// ============ Prospect Detail Modal ============
function ProspectDetailModal({ prospect, onClose, onSave, onDelete, onConvert }) {
  if (!prospect) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{prospect.organizationName || 'Prospect Detail'}</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          <div className="info-section">
            <h4>Company Info</h4>
            <div className="info-row"><span className="info-label">Company</span><span className="info-value">{prospect.organizationName || '—'}</span></div>
            <div className="info-row"><span className="info-label">Website</span><span className="info-value">{prospect.website ? <a href={prospect.website.startsWith('http') ? prospect.website : `https://${prospect.website}`} target="_blank" rel="noreferrer" className="info-value link">{prospect.website} <ExternalLink size={12} /></a> : '—'}</span></div>
            <div className="info-row"><span className="info-label">Industry</span><span className="info-value">{prospect.industries || '—'}</span></div>
            <div className="info-row"><span className="info-label">Headquarters</span><span className="info-value">{prospect.headquarters || '—'}</span></div>
            <div className="info-row"><span className="info-label">Employees</span><span className="info-value">{prospect.employeeCount || '—'}</span></div>
            <div className="info-row"><span className="info-label">Description</span><span className="info-value">{prospect.description || '—'}</span></div>
          </div>

          <div className="info-section">
            <h4>Contact</h4>
            <div className="info-row"><span className="info-label">Name</span><span className="info-value">{prospect.contactName || '—'}</span></div>
            <div className="info-row"><span className="info-label">Email</span><span className="info-value">{prospect.contactEmail || '—'}</span></div>
            <div className="info-row"><span className="info-label">Title</span><span className="info-value">{prospect.contactTitle || '—'}</span></div>
          </div>

          <div className="info-section">
            <h4>CRM</h4>
            <div className="info-row"><span className="info-label">Stage</span><span className="info-value">{PROSPECT_STAGES.find(s => s.id === prospect.crmStage)?.name || prospect.crmStage || '—'}</span></div>
            <div className="info-row"><span className="info-label">Status</span><span className="info-value">{prospect.prospectStatus || '—'}</span></div>
            <div className="info-row"><span className="info-label">Added</span><span className="info-value">{prospect.addedAt ? new Date(prospect.addedAt).toLocaleDateString() : '—'}</span></div>
          </div>

          {prospect.notes && prospect.notes.length > 0 && (
            <div className="info-section">
              <h4>Notes</h4>
              {prospect.notes.map(n => (
                <div key={n.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-primary)' }}>{n.text}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>{new Date(n.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-danger" onClick={() => {
            if (confirm('Delete this prospect?')) onDelete(prospect.id);
          }}>
            <Trash2 size={16} /> Delete
          </button>
          <div className="footer-right">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
            <button type="button" className="btn btn-primary" onClick={() => onConvert(prospect)}>
              <ArrowRightCircle size={16} /> Convert to Deal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Add Prospect Modal ============
function AddProspectModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    organizationName: '',
    contactName: '',
    contactEmail: '',
    website: '',
    crmStage: 'top_pursuits',
    prospectStatus: '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.organizationName.trim()) return;
    onSave(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Prospect</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Company Name *</label>
              <input type="text" name="organizationName" value={form.organizationName} onChange={handleChange} placeholder="Enter company name" required />
            </div>
            <div className="form-group">
              <label>Contact Name</label>
              <input type="text" name="contactName" value={form.contactName} onChange={handleChange} placeholder="Primary contact" />
            </div>
            <div className="form-group">
              <label>Contact Email</label>
              <input type="email" name="contactEmail" value={form.contactEmail} onChange={handleChange} placeholder="email@company.com" />
            </div>
            <div className="form-group">
              <label>Website</label>
              <input type="text" name="website" value={form.website} onChange={handleChange} placeholder="company.com" />
            </div>
            <div className="form-group">
              <label>Stage</label>
              <select name="crmStage" value={form.crmStage} onChange={handleChange}>
                {PROSPECT_STAGES.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0 1.5rem', marginTop: '0.5rem' }}>
            Tip: Import companies in bulk from the Master List for faster setup.
          </p>
          <div className="modal-footer">
            <div className="footer-right">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Prospect</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============ Main Prospects Component ============
function Prospects() {
  const navigate = useNavigate();
  const [prospects, setProspects] = useState([]);
  const [viewMode, setViewMode] = useState('board');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedProspect, setSelectedProspect] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(null), 6000);
  };

  useEffect(() => {
    async function loadData() {
      try {
        const data = await getProspects();
        setProspects(data);
      } catch (err) {
        console.error('Failed to load prospects:', err);
        showError(`Failed to load prospects: ${err.message || err}`);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // DnD handlers
  const handleDragStart = (event) => setActiveId(event.active.id);

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    let newStage = null;
    const stageMatch = PROSPECT_STAGES.find(s => s.id === over.id);
    if (stageMatch) {
      newStage = stageMatch.id;
    } else {
      const overProspect = prospects.find(p => p.id === over.id);
      if (overProspect) newStage = overProspect.crmStage;
    }

    if (newStage) {
      const activeProspect = prospects.find(p => p.id === active.id);
      if (activeProspect && activeProspect.crmStage !== newStage) {
        try {
          await updateProspectStage(active.id, newStage);
          const updated = await getProspects();
          setProspects(updated);
        } catch (err) {
          console.error('Failed to update prospect stage:', err);
          showError(`Failed to move prospect: ${err.message || err}`);
        }
      }
    }
  };

  // CRUD
  const handleAddProspect = async (formData) => {
    try {
      await saveProspect(formData);
      const updated = await getProspects();
      setProspects(updated);
      setShowAddModal(false);
    } catch (err) {
      console.error('Failed to add prospect:', err);
      showError(`Failed to add prospect: ${err.message || err}`);
    }
  };

  const handleDeleteProspect = async (id) => {
    try {
      await deleteProspect(id);
      const updated = await getProspects();
      setProspects(updated);
      setSelectedProspect(null);
    } catch (err) {
      console.error('Failed to delete prospect:', err);
      showError(`Failed to delete prospect: ${err.message || err}`);
    }
  };

  const handleConvertToDeal = async (prospect) => {
    try {
      await saveDeal({
        clientName: prospect.organizationName,
        contactName: prospect.contactName || '',
        contactEmail: prospect.contactEmail || '',
        stage: 'kickoff',
      });
      await updateProspectStage(prospect.id, 'clients');
      setSelectedProspect(null);
      navigate('/pipeline');
    } catch (err) {
      console.error('Failed to convert prospect to deal:', err);
      showError(`Failed to convert prospect: ${err.message || err}`);
    }
  };

  const handleCardClick = (prospect) => setSelectedProspect(prospect);

  const activeProspect = prospects.find(p => p.id === activeId);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>Loading...</div>;

  return (
    <div className="page fade-in">
      {error && (
        <div style={{
          background: '#dc2626',
          color: '#fff',
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          marginBottom: '1rem',
          fontSize: '0.85rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.1rem' }}>&times;</button>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1>Prospects CRM</h1>
          <p>Manage your business development pipeline</p>
        </div>
        <div className="header-actions">
          <div className="view-toggle">
            <button className={`toggle-btn ${viewMode === 'board' ? 'active' : ''}`} onClick={() => setViewMode('board')}>
              <LayoutGrid size={18} />
            </button>
            <button className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>
              <List size={18} />
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={18} /> Add Prospect
          </button>
        </div>
      </div>

      {viewMode === 'board' ? (
        <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="kanban-board">
            {PROSPECT_STAGES.map(stage => (
              <KanbanColumn key={stage.id} stage={stage} prospects={prospects} onCardClick={handleCardClick} />
            ))}
          </div>
          <DragOverlay>
            {activeProspect ? (
              <div className="deal-card dragging">
                <h4 className="deal-client">{activeProspect.organizationName}</h4>
                {activeProspect.contactName && <p className="deal-nickname">{activeProspect.contactName}</p>}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="card">
          {prospects.length === 0 ? (
            <div className="empty-state">
              <p>No prospects in your CRM yet</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Import companies from the Master List to get started</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Stage</th>
                  <th>Contact</th>
                  <th>Website</th>
                  <th>Status</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {prospects.map(p => (
                  <tr key={p.id} onClick={() => handleCardClick(p)} style={{ cursor: 'pointer' }}>
                    <td className="primary-cell">{p.organizationName || '—'}</td>
                    <td>{PROSPECT_STAGES.find(s => s.id === p.crmStage)?.name || p.crmStage || '—'}</td>
                    <td>{p.contactName || '—'}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {p.website ? p.website.replace(/https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '') : '—'}
                    </td>
                    <td>
                      {p.prospectStatus ? (
                        <span className={`prospect-badge ${p.prospectStatus === 'Hot Prospect' ? 'hot' : p.prospectStatus === 'Looking' ? 'look' : 'low'}`}>
                          {p.prospectStatus}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>{p.addedAt ? new Date(p.addedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selectedProspect && (
        <ProspectDetailModal
          prospect={selectedProspect}
          onClose={() => setSelectedProspect(null)}
          onSave={async (data) => {
            try {
              await saveProspect({ ...selectedProspect, ...data });
              const updated = await getProspects();
              setProspects(updated);
              setSelectedProspect(null);
            } catch (err) {
              console.error('Failed to save prospect:', err);
              showError(`Failed to save prospect: ${err.message || err}`);
            }
          }}
          onDelete={handleDeleteProspect}
          onConvert={handleConvertToDeal}
        />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <AddProspectModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddProspect}
        />
      )}
    </div>
  );
}

export default Prospects;
