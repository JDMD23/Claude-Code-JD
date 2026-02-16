import { useState, useRef } from 'react';
import { Save, Download, Upload, Key, Shield, Zap } from 'lucide-react';
import { getSettings, saveSettings } from '../store/dataStore';
import './Pages.css';

const EXPORT_KEYS = [
  'dealflow_deals',
  'dealflow_prospects',
  'dealflow_master_list',
  'dealflow_commissions',
  'dealflow_contacts',
  'dealflow_followups',
  'dealflow_activity',
];

function Settings() {
  const [settings, setSettings] = useState(() => getSettings());
  const [saved, setSaved] = useState(false);
  const importRef = useRef(null);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setSaved(false);
  };

  const handleSave = () => {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = () => {
    const data = { version: 1, exportedAt: new Date().toISOString() };
    for (const key of EXPORT_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        data[key] = raw ? JSON.parse(raw) : [];
      } catch {
        data[key] = [];
      }
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dealflow-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.version) {
        alert('Invalid backup file: missing version field.');
        return;
      }

      if (!confirm('This will replace ALL current data (except your API settings). Are you sure?')) {
        return;
      }

      for (const key of EXPORT_KEYS) {
        if (data[key] !== undefined) {
          localStorage.setItem(key, JSON.stringify(data[key]));
        }
      }

      alert('Data imported successfully. Reloading...');
      window.location.reload();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }

    // Reset file input
    if (importRef.current) importRef.current.value = '';
  };

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Configure API keys and proxy connection</p>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>
          <Save size={18} />
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>

      <div className="settings-grid">
        <div className="card settings-section">
          <h3><Shield size={18} /> Proxy Configuration</h3>
          <div className="form-group">
            <label>Proxy URL</label>
            <input
              type="text"
              name="proxyUrl"
              value={settings.proxyUrl}
              onChange={handleChange}
              placeholder="https://your-worker.your-subdomain.workers.dev"
            />
          </div>
          <div className="form-group">
            <label>Proxy Secret</label>
            <input
              type="password"
              name="proxySecret"
              value={settings.proxySecret}
              onChange={handleChange}
              placeholder="Bearer token for proxy auth"
            />
          </div>
        </div>

        <div className="card settings-section">
          <h3><Key size={18} /> API Keys</h3>
          <div className="form-group">
            <label>Perplexity API Key</label>
            <input
              type="password"
              name="perplexityApiKey"
              value={settings.perplexityApiKey}
              onChange={handleChange}
              placeholder="pplx-..."
            />
          </div>
          <div className="form-group">
            <label>Apollo API Key</label>
            <input
              type="password"
              name="apolloApiKey"
              value={settings.apolloApiKey}
              onChange={handleChange}
              placeholder="Apollo.io API key"
            />
          </div>
          <div className="form-group">
            <label>Tavily API Key</label>
            <input
              type="password"
              name="tavilyApiKey"
              value={settings.tavilyApiKey}
              onChange={handleChange}
              placeholder="tvly-..."
            />
          </div>
          <div className="form-group">
            <label>Firecrawl API Key</label>
            <input
              type="password"
              name="firecrawlApiKey"
              value={settings.firecrawlApiKey}
              onChange={handleChange}
              placeholder="fc-..."
            />
          </div>
        </div>

        <div className="card settings-section">
          <h3><Zap size={18} /> Automation</h3>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                name="autoEnrich"
                checked={settings.autoEnrich}
                onChange={handleChange}
              />
              Auto-enrich new companies (Quick Add)
            </label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Automatically run the research agent when adding a company via Quick Add
            </p>
          </div>
        </div>

        <div className="card settings-section">
          <h3><Download size={18} /> Data Management</h3>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleExport}>
              <Download size={18} />
              Export All Data
            </button>
            <button className="btn btn-secondary" onClick={() => importRef.current?.click()}>
              <Upload size={18} />
              Import Data
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            Export creates a JSON backup of all your data. Import replaces existing data (except API settings).
          </p>
        </div>
      </div>
    </div>
  );
}

export default Settings;
