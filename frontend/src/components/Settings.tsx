import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE = '/api';

function Settings() {
  const [settings, setSettings] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await axios.get(`${API_BASE}/settings`);
      setSettings(response.data);
      setLoading(false);
      setError(null);
    } catch (error: any) {
      console.error('Failed to fetch settings:', error);
      setError(error.response?.data?.message || 'Failed to fetch settings');
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.put(`${API_BASE}/settings`, settings);
      setSuccess('Settings updated successfully! All components will refresh automatically. Changes take effect on the next strategy evaluation.');
      setEditing(false);
      // Refresh to get updated values
      await fetchSettings();
      
      // Note: Real-time updates will trigger Dashboard refresh via SSE
      // No need to reload the page anymore
    } catch (error: any) {
      console.error('Failed to update settings:', error);
      setError(error.response?.data?.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    fetchSettings(); // Reset to original values
    setEditing(false);
    setError(null);
    setSuccess(null);
  };

  const handleChange = (key: string, value: string | number) => {
    setSettings((prev: any) => ({
      ...prev,
      [key]: typeof value === 'string' && key !== 'universe' ? parseFloat(value) || 0 : value,
    }));
  };

  if (loading) {
    return <div className="card">Loading settings...</div>;
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Strategy Settings</h2>
        {!editing ? (
          <button className="button" onClick={() => setEditing(true)}>
            Edit Settings
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="button secondary" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
            <button className="button success" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ 
          background: 'rgba(239, 68, 68, 0.2)', 
          border: '1px solid rgba(239, 68, 68, 0.5)', 
          color: '#fca5a5', 
          padding: '0.75rem', 
          borderRadius: '8px', 
          marginBottom: '1rem' 
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ 
          background: 'rgba(74, 222, 128, 0.2)', 
          border: '1px solid rgba(74, 222, 128, 0.5)', 
          color: '#86efac', 
          padding: '0.75rem', 
          borderRadius: '8px', 
          marginBottom: '1rem' 
        }}>
          {success}
        </div>
      )}

      <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Universe (comma-separated symbols):
          </label>
          {editing ? (
            <input
              type="text"
              value={settings?.universe || ''}
              onChange={(e) => handleChange('universe', e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.universe}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Cadence Hours:
          </label>
          {editing ? (
            <input
              type="number"
              min="1"
              max="24"
              value={settings?.cadenceHours || 6}
              onChange={(e) => handleChange('cadenceHours', parseInt(e.target.value, 10) || 6)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.cadenceHours}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Max Positions:
          </label>
          {editing ? (
            <input
              type="number"
              min="1"
              max="20"
              value={settings?.maxPositions || 3}
              onChange={(e) => handleChange('maxPositions', parseInt(e.target.value, 10) || 3)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.maxPositions || 3}</div>
          )}
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
            Maximum number of positions to hold simultaneously
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Max Allocation Fraction (0-1):
          </label>
          {editing ? (
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={settings?.maxAllocFraction || 0.2}
              onChange={(e) => handleChange('maxAllocFraction', parseFloat(e.target.value) || 0.2)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.maxAllocFraction}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Min Order USD:
          </label>
          {editing ? (
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings?.minOrderUsd || 5}
              onChange={(e) => handleChange('minOrderUsd', parseFloat(e.target.value) || 5)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>${settings?.minOrderUsd}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Min Balance USD:
          </label>
          {editing ? (
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings?.minBalanceUsd || 20}
              onChange={(e) => handleChange('minBalanceUsd', parseFloat(e.target.value) || 20)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>${settings?.minBalanceUsd}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Volatility Pause %:
          </label>
          {editing ? (
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={settings?.volatilityPausePct || 18}
              onChange={(e) => handleChange('volatilityPausePct', parseFloat(e.target.value) || 18)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.volatilityPausePct}%</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            RSI Low:
          </label>
          {editing ? (
            <input
              type="number"
              min="0"
              max="100"
              value={settings?.rsiLow || 40}
              onChange={(e) => handleChange('rsiLow', parseFloat(e.target.value) || 40)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.rsiLow}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            RSI High:
          </label>
          {editing ? (
            <input
              type="number"
              min="0"
              max="100"
              value={settings?.rsiHigh || 70}
              onChange={(e) => handleChange('rsiHigh', parseFloat(e.target.value) || 70)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.rsiHigh}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            EMA Short:
          </label>
          {editing ? (
            <input
              type="number"
              min="1"
              value={settings?.emaShort || 12}
              onChange={(e) => handleChange('emaShort', parseInt(e.target.value, 10) || 12)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.emaShort}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            EMA Long:
          </label>
          {editing ? (
            <input
              type="number"
              min="1"
              value={settings?.emaLong || 26}
              onChange={(e) => handleChange('emaLong', parseInt(e.target.value, 10) || 26)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.emaLong}</div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Cooldown Cycles:
          </label>
          {editing ? (
            <input
              type="number"
              min="1"
              value={settings?.cooldownCycles || 2}
              onChange={(e) => handleChange('cooldownCycles', parseInt(e.target.value, 10) || 2)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #374151', background: '#1f2937', color: '#fff' }}
            />
          ) : (
            <div>{settings?.cooldownCycles || 2}</div>
          )}
        </div>
      </div>

      {!editing && (
        <p style={{ marginTop: '1rem', color: '#9ca3af', fontSize: '0.875rem' }}>
          Settings are stored in the database and take effect immediately. Click "Edit Settings" to modify.
        </p>
      )}
    </div>
  );
}

export default Settings;

