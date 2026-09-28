'use client';
import { useState, useEffect, useCallback } from 'react';
import { settings as settingsApi, auth as authApi, permissions as permApi, backup as backupApi, leads as leadsApi } from '@/lib/api';
import { MODULES, CONFIGURABLE_ROLES, isLocked, setPermissions } from '@/lib/permissions';
import toast from 'react-hot-toast';
import {
  Building2, FileText, Users, Database, Settings as SettingsIcon,
  Calculator, Hash, Shield, Save, RefreshCw, Download, AlertTriangle,
  CheckCircle, Eye, EyeOff, Trash2, Plus, Edit2, Key, ToggleLeft,
  ToggleRight, Server, HardDrive, Clock, Globe, Loader2, X, ChevronDown,
  Inbox, HelpCircle, Mail,
} from 'lucide-react';
import { formatCurrency, formatDate, getUser } from '@/lib/auth';
import { clearCompanyCache } from '@/lib/print';
import Link from 'next/link';

// ─── Tabs config ──────────────────────────────────────────────
const TABS = [
  { key: 'company',    label: 'Company',       icon: Building2,    roles: ['ADMIN', 'MANAGER'] },
  { key: 'emailTemplate', label: 'Email Template', icon: Mail,      roles: ['ADMIN', 'MANAGER'] },
  { key: 'fiscal',     label: 'Fiscal & Tax',  icon: FileText,     roles: ['ADMIN', 'MANAGER'] },
  { key: 'payroll',    label: 'Payroll',       icon: Calculator,   roles: ['ADMIN', 'MANAGER'] },
  { key: 'numbering',  label: 'Numbering',     icon: Hash,         roles: ['ADMIN', 'MANAGER'] },
  { key: 'users',      label: 'Users',         icon: Users,        roles: ['ADMIN'] },
  { key: 'database',   label: 'Database',      icon: Database,     roles: ['ADMIN'] },
  { key: 'system',      label: 'System',       icon: SettingsIcon, roles: ['ADMIN', 'MANAGER'] },
  { key: 'permissions', label: 'Permissions',  icon: Key,          roles: ['ADMIN'] },
  { key: 'audit',       label: 'Audit Trail',  icon: Shield,       roles: ['ADMIN', 'MANAGER'] },
  { key: 'inquiries',   label: 'Inquiries',    icon: Inbox,        roles: ['ADMIN', 'MANAGER'] },
  { key: 'help',        label: 'Help',         icon: HelpCircle,   roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER'] },
];

const USER_MANUAL_PDF = '/Finara-User-Manual.pdf';

const INQUIRY_STATUS_COLORS = { NEW: 'badge-blue', CONTACTED: 'badge-yellow', CLOSED: 'badge-green' };
const ROLES        = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER'];
const ROLE_COLORS  = { ADMIN: 'badge-red', MANAGER: 'badge-blue', ACCOUNTANT: 'badge-green', VIEWER: 'badge-gray', SUPER_ADMIN: 'badge-red' };
const PROVINCES    = ['Metro Manila', 'Cebu', 'Davao', 'Laguna', 'Cavite', 'Rizal', 'Bulacan', 'Pampanga', 'Iloilo', 'Batangas'];
const RDO_CODES    = Array.from({ length: 129 }, (_, i) => String(i + 1).padStart(3, '0'));
const MONTHS       = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── Field Components ─────────────────────────────────────────
const Field = ({ label, sub, children, required }) => (
  <div className="form-group">
    <label className="label">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      {sub && <span className="text-xs font-normal text-gray-400 ml-2">{sub}</span>}
    </label>
    {children}
  </div>
);

const Toggle = ({ label, sub, value, onChange }) => (
  <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
    <button type="button" onClick={() => onChange(!value)} className={`flex-shrink-0 transition-colors ${value ? 'text-green-500' : 'text-gray-300'}`}>
      {value ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
    </button>
    <div>
      <p className="text-sm font-medium text-gray-700">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  </div>
);

const SectionTitle = ({ children, icon: Icon, color = 'text-blue-600' }) => (
  <div className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wide ${color} mb-4 mt-2`}>
    {Icon && <Icon className="w-4 h-4" />}
    {children}
  </div>
);

// ─── User Modal ───────────────────────────────────────────────
function UserModal({ user, onClose, onSaved }) {
  const isEdit = !!user?.id;
  const [form, setForm] = useState(user || { email: '', firstName: '', lastName: '', password: '', role: 'ACCOUNTANT' });
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) {
        await settingsApi.updateUser(user.id, { firstName: form.firstName, lastName: form.lastName, role: form.role });
      } else {
        await authApi.createUser(form);
      }
      toast.success(isEdit ? 'User updated' : 'User created');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save user');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit User' : 'New User'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-3">
            <div className="form-grid">
              <Field label="First Name" required><input className="input" required value={form.firstName} onChange={set('firstName')} /></Field>
              <Field label="Last Name"  required><input className="input" required value={form.lastName}  onChange={set('lastName')}  /></Field>
            </div>
            {!isEdit && (
              <Field label="Email Address" required>
                <input type="email" className="input" required value={form.email} onChange={set('email')} placeholder="user@company.com" />
              </Field>
            )}
            <Field label="Role">
              <select className="select" value={form.role} onChange={set('role')}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            {!isEdit && (
              <Field label="Password" required>
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'} className="input pr-10" required value={form.password} onChange={set('password')} placeholder="Min. 8 characters" minLength={8} />
                  <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
            )}
            <div className={`p-3 rounded-xl text-xs ${form.role === 'ADMIN' ? 'bg-red-50 text-red-700' : form.role === 'VIEWER' ? 'bg-gray-50 text-gray-500' : 'bg-blue-50 text-blue-700'}`}>
              {form.role === 'ADMIN'      && '⚠ Admin has full access including user management and database operations.'}
              {form.role === 'MANAGER'    && 'Manager can view all data and approve transactions.'}
              {form.role === 'ACCOUNTANT' && 'Accountant can create and post journal entries, bills, invoices, and payroll.'}
              {form.role === 'VIEWER'     && 'Viewer has read-only access to all reports and records.'}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create User')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reset Password Modal ─────────────────────────────────────
function ResetPwdModal({ user, onClose }) {
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pwd.length < 8) { toast.error('Minimum 8 characters'); return; }
    setSaving(true);
    try {
      await settingsApi.resetPassword(user.id, { newPassword: pwd });
      toast.success(`Password reset for ${user.firstName}`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    } finally { setSaving(false); }
  };
  return (
    <div className="modal-overlay">
      <div className="modal max-w-sm">
        <div className="modal-header">
          <h3 className="font-semibold">Reset Password — {user.firstName} {user.lastName}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <Field label="New Password" required>
              <div className="relative">
                <input type={show ? 'text' : 'password'} className="input pr-10" required value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Min. 8 characters" minLength={8} />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Resetting...' : 'Reset Password'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── DB Reset Modal (Danger) ──────────────────────────────────
function DbResetModal({ onClose }) {
  const [phrase, setPhrase] = useState('');
  const [adminPwd, setAdminPwd] = useState('');
  const [loading, setLoading] = useState(false);
  const ready = phrase === 'RESET DATABASE' && adminPwd.length >= 8;

  const handleReset = async () => {
    if (!ready) return;
    setLoading(true);
    try {
      await settingsApi.dbReset({ confirmPhrase: phrase, adminPassword: adminPwd });
      toast.success('Database reset complete. All transactional data deleted.');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header bg-red-50 border-b-red-200">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="w-5 h-5" />
            <h3 className="font-bold">DANGER: Reset Database</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <div className="modal-body space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 space-y-1">
            <p className="font-bold">This action is IRREVERSIBLE.</p>
            <p>All transactional data will be permanently deleted:</p>
            <ul className="list-disc pl-4 space-y-0.5 text-xs">
              <li>All journal entries and lines</li>
              <li>All bills, payments, and vendors</li>
              <li>All invoices, collections, and customers</li>
              <li>All payroll periods and items</li>
              <li>All accounts (Chart of Accounts)</li>
              <li>All employees</li>
            </ul>
            <p className="text-xs text-red-500 mt-2">Users and system settings will be preserved.</p>
          </div>
          <Field label='Type "RESET DATABASE" to confirm' required>
            <input className="input font-mono text-red-600" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="RESET DATABASE" />
          </Field>
          <Field label="Your Admin Password" required>
            <input type="password" className="input" value={adminPwd} onChange={(e) => setAdminPwd(e.target.value)} placeholder="Enter your password" />
          </Field>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleReset} disabled={!ready || loading}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${ready ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-red-100 text-red-300 cursor-not-allowed'}`}>
            {loading ? 'Resetting...' : 'Reset Database'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Module Reset Modal ───────────────────────────────────────
function ModuleResetModal({ modules, moduleList, onClose, onDone }) {
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const phrase  = 'RESET';
  const ready   = confirm === phrase && modules.length > 0;

  const handleReset = async () => {
    if (!ready) return;
    setLoading(true);
    try {
      await backupApi.reset(modules, confirm);
      toast.success(`Reset complete — ${modules.length} module${modules.length !== 1 ? 's' : ''} cleared`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header bg-red-50">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="w-5 h-5" />
            <h3 className="font-bold">DANGER: Module Reset</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <div className="modal-body space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 space-y-2">
            <p className="font-bold">The following modules will be permanently cleared:</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {modules.map((k) => (
                <span key={k} className="px-2 py-0.5 bg-red-100 border border-red-300 rounded text-xs font-medium text-red-800">
                  {moduleList.find((m) => m.key === k)?.label || k}
                </span>
              ))}
            </div>
            <p className="text-xs text-red-500 mt-2">All records for the selected modules will be deleted. This cannot be undone.</p>
          </div>
          <div className="form-group">
            <label className="label">Type <span className="font-mono font-bold text-red-600">RESET</span> to confirm</label>
            <input className="input font-mono text-red-600" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESET" />
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleReset} disabled={!ready || loading}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${ready ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-red-100 text-red-300 cursor-not-allowed'}`}>
            {loading ? 'Resetting...' : 'Reset Selected Modules'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────
export default function SettingsPage() {
  const [role, setRole] = useState(null);
  useEffect(() => { setRole(getUser()?.role); }, []);
  const visibleTabs = TABS.filter((t) => !role || role === 'SUPER_ADMIN' || t.roles.includes(role));

  const [activeTab, setActiveTab] = useState('company');
  const [menuOpen, setMenuOpen] = useState(false); // mobile: tab menu open/close
  // If the active tab isn't visible to this role, fall back to the first allowed tab.
  useEffect(() => {
    if (role && !visibleTabs.some((t) => t.key === activeTab) && visibleTabs[0]) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchTab = (key) => { setActiveTab(key); setMenuOpen(false); };
  const [form,      setForm]      = useState({});
  const [original,  setOriginal]  = useState({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [users,     setUsers]     = useState([]);
  const [dbStats,   setDbStats]   = useState(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [permConfig, setPermConfig] = useState(null); // { MANAGER:[], ACCOUNTANT:[], VIEWER:[] }
  const [permSaving, setPermSaving] = useState(false);
  const [inquiries,        setInquiries]        = useState([]);
  const [inquiriesLoading, setInquiriesLoading] = useState(false);
  const [expandedInquiry,  setExpandedInquiry]  = useState(null); // lead id whose full message is shown

  // Modals
  const [userModal,   setUserModal]   = useState(null); // null | 'new' | user obj
  const [resetPwdFor, setResetPwdFor] = useState(null);
  const [showDbReset, setShowDbReset] = useState(false);

  // Module backup/restore
  const [moduleList,        setModuleList]        = useState([]);
  const [selectedMods,      setSelectedMods]       = useState([]);
  const [exportingMods,     setExportingMods]      = useState(false);
  const [restoreFile,       setRestoreFile]        = useState(null);
  const [restoreFileMeta,   setRestoreFileMeta]    = useState(null); // parsed header
  const [restoreMods,       setRestoreMods]        = useState([]);
  const [doReset,           setDoReset]            = useState(true);
  const [restoring,         setRestoring]          = useState(false);
  const [showRestoreConfirm,setShowRestoreConfirm] = useState(false);

  // Module reset (Danger Zone)
  const [resetMods,         setResetMods]          = useState([]);
  const [showModResetModal, setShowModResetModal]  = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.value ?? e }));
  const setB = (k) => (v) => setForm((f) => ({ ...f, [k]: String(v) }));
  const boolVal = (k) => form[k] === 'true' || form[k] === true;
  const isDirty = JSON.stringify(form) !== JSON.stringify(original);

  // Load settings
  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const r = await settingsApi.getAll();
      setForm(r.data);
      setOriginal(r.data);
    } catch { toast.error('Failed to load settings'); }
    finally { setLoading(false); }
  }, []);

  // Load users
  const loadUsers = useCallback(async () => {
    try {
      const r = await settingsApi.listUsers();
      setUsers(r.data);
    } catch { toast.error('Failed to load users'); }
  }, []);

  // Load DB stats
  const loadDbStats = useCallback(async () => {
    setDbLoading(true);
    try {
      const r = await settingsApi.dbStats();
      setDbStats(r.data);
    } catch { toast.error('Failed to load DB stats'); }
    finally { setDbLoading(false); }
  }, []);

  // Load module list for backup
  const loadModuleList = useCallback(async () => {
    try { const r = await backupApi.modules(); setModuleList(r.data); } catch { /* silent */ }
  }, []);

  // Export selected modules
  const handleModuleExport = async () => {
    if (!selectedMods.length) return toast.error('Select at least one module');
    setExportingMods(true);
    try {
      const r    = await backupApi.export(selectedMods);
      const url  = URL.createObjectURL(r.data);
      const a    = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `finara-backup-${selectedMods.join('-')}-${stamp}.json`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded');
    } catch { toast.error('Export failed'); }
    finally { setExportingMods(false); }
  };

  // Parse uploaded backup file header
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.version?.startsWith('finara')) { toast.error('Not a valid Finara backup file'); return; }
        setRestoreFileMeta({ modules: parsed.modules, rowCount: parsed.rowCount, exportedAt: parsed.exportedAt, businessId: parsed.businessId });
        setRestoreMods(parsed.modules); // default: restore all modules in file
      } catch { toast.error('Cannot read file — invalid JSON'); }
    };
    reader.readAsText(file);
  };

  // Perform restore
  const handleRestore = async () => {
    if (!restoreFile || !restoreMods.length) return;
    setRestoring(true);
    setShowRestoreConfirm(false);
    try {
      const fd = new FormData();
      fd.append('file', restoreFile);
      fd.append('modules', restoreMods.join(','));
      fd.append('reset', String(doReset));
      const r = await backupApi.import(fd);
      toast.success(r.data.message);
      setRestoreFile(null); setRestoreFileMeta(null); setRestoreMods([]);
    } catch (err) { toast.error(err.response?.data?.error || 'Restore failed'); }
    finally { setRestoring(false); }
  };

  // Load landing-page inquiries (leads)
  const loadInquiries = useCallback(async () => {
    setInquiriesLoading(true);
    try {
      const r = await leadsApi.list();
      setInquiries(r.data);
    } catch { toast.error('Failed to load inquiries'); }
    finally { setInquiriesLoading(false); }
  }, []);

  // Load role permissions
  const loadPermissions = useCallback(async () => {
    try {
      const r = await permApi.get();
      setPermConfig(r.data);
    } catch { toast.error('Failed to load permissions'); }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => {
    if (activeTab === 'users')       loadUsers();
    if (activeTab === 'database')    { loadDbStats(); loadModuleList(); }
    if (activeTab === 'permissions') loadPermissions();
    if (activeTab === 'inquiries')   loadInquiries();
  }, [activeTab]);

  const togglePerm = (role, moduleKey) => {
    if (isLocked(moduleKey, role).off || isLocked(moduleKey, role).on) return;
    setPermConfig((c) => {
      const has = c[role].includes(moduleKey);
      return { ...c, [role]: has ? c[role].filter((k) => k !== moduleKey) : [...c[role], moduleKey] };
    });
  };

  const handleSavePermissions = async () => {
    setPermSaving(true);
    try {
      const r = await permApi.save(permConfig);
      const { message, ...config } = r.data;
      setPermConfig(config);
      setPermissions(config);     // apply live so nav/guard update without reload
      toast.success('Permissions saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save permissions');
    } finally { setPermSaving(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.saveAll(form);
      setOriginal({ ...form });
      clearCompanyCache();          // so next print fetches fresh company details
      toast.success('Settings saved successfully');
    } catch { toast.error('Failed to save settings'); }
    finally { setSaving(false); }
  };

  const handleResetDefaults = async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    try {
      await settingsApi.resetDefaults();
      toast.success('Settings reset to defaults');
      loadSettings();
    } catch { toast.error('Failed to reset'); }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const r = await settingsApi.backup();
      const url = URL.createObjectURL(r.data);
      const a   = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      const ext   = r.data.type.includes('json') ? 'json' : 'sql';
      a.href = url; a.download = `ph-erp-backup-${stamp}.${ext}`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded');
    } catch { toast.error('Backup failed'); }
    finally { setBackingUp(false); }
  };

  const handleDeleteUser = async (user) => {
    if (!confirm(`Delete user ${user.firstName} ${user.lastName}?`)) return;
    try {
      await settingsApi.deleteUser(user.id);
      toast.success('User deleted');
      loadUsers();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to delete'); }
  };

  const handleToggleUser = async (user) => {
    try {
      await settingsApi.updateUser(user.id, { isActive: !user.isActive });
      toast.success(`User ${user.isActive ? 'deactivated' : 'activated'}`);
      loadUsers();
    } catch { toast.error('Failed to update user'); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <Loader2 className="w-6 h-6 animate-spin mr-3" />Loading settings...
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">System configuration, company profile, and database management</p>
        </div>
        <div className="flex gap-2">
          {isDirty && (
            <button onClick={() => { setForm({ ...original }); }} className="btn-secondary">
              <X className="w-4 h-4" /> Discard
            </button>
          )}
          <button onClick={handleSave} disabled={saving || !isDirty} className={`btn-primary ${!isDirty ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {isDirty && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          You have unsaved changes. Click "Save Settings" to apply them.
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 items-start">
        {/* ── Mobile: collapsible dropdown menu ── */}
        <div className="w-full lg:hidden">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-white border border-gray-200 rounded-xl shadow-sm text-sm font-medium text-gray-700"
          >
            <span className="flex items-center gap-2">
              {(() => { const t = visibleTabs.find(t => t.key === activeTab); return t ? <><t.icon className="w-4 h-4 text-blue-600" />{t.label}</> : null; })()}
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>
          {menuOpen && (
            <div className="mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-10 relative">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.key} onClick={() => switchTab(tab.key)}
                  className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium transition-colors text-left border-b border-gray-100 last:border-0 ${
                    activeTab === tab.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <tab.icon className="w-4 h-4 flex-shrink-0" />
                  {tab.label}
                </button>
              ))}
              <button onClick={() => { handleResetDefaults(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-4 py-3 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors border-t border-gray-100">
                <RefreshCw className="w-3.5 h-3.5" /> Reset Defaults
              </button>
            </div>
          )}
        </div>

        {/* ── Desktop: sidebar tabs ── */}
        <div className="hidden lg:block w-48 flex-shrink-0 space-y-0.5">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === tab.key ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <tab.icon className="w-4 h-4 flex-shrink-0" />
              {tab.label}
            </button>
          ))}
          <div className="pt-3 border-t border-gray-200 mt-2">
            <button onClick={handleResetDefaults} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Reset Defaults
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 card p-4 lg:p-6 space-y-6 w-full">

          {/* ── Company ── */}
          {activeTab === 'company' && (
            <>
              <SectionTitle icon={Building2}>Company Profile</SectionTitle>

              {/* Logo upload */}
              <Field label="Company Logo" sub="appears on printed documents — PNG/JPG, max 2 MB">
                <div className="flex items-center gap-4">
                  {form.companyLogo ? (
                    <img src={form.companyLogo} alt="Logo" className="w-16 h-16 object-contain rounded-xl border border-gray-200 bg-gray-50 p-1 flex-shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-400 flex-shrink-0">
                      <Building2 className="w-6 h-6" />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <label className="btn-secondary cursor-pointer text-sm py-1.5 px-3 inline-flex items-center gap-2">
                      <Download className="w-4 h-4" />
                      {form.companyLogo ? 'Replace Logo' : 'Upload Logo'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 2 * 1024 * 1024) { toast.error('Logo must be under 2 MB'); return; }
                          const reader = new FileReader();
                          reader.onload = (ev) => setForm((f) => ({ ...f, companyLogo: ev.target.result }));
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    {form.companyLogo && (
                      <button type="button" className="text-xs text-red-500 hover:text-red-700 text-left" onClick={() => setForm((f) => ({ ...f, companyLogo: '' }))}>
                        Remove logo
                      </button>
                    )}
                  </div>
                </div>
              </Field>

              <div className="form-grid">
                <Field label="Company / Business Name" required>
                  <input className="input" value={form.companyName || ''} onChange={set('companyName')} placeholder="My Company Inc." />
                </Field>
                <Field label="Email Address">
                  <input type="email" className="input" value={form.companyEmail || ''} onChange={set('companyEmail')} placeholder="info@company.com" />
                </Field>
              </div>
              <Field label="Business Address">
                <input className="input" value={form.companyAddress || ''} onChange={set('companyAddress')} placeholder="Street / Building No." />
              </Field>
              <div className="form-grid">
                <Field label="City / Municipality">
                  <input className="input" value={form.companyCity || ''} onChange={set('companyCity')} placeholder="Makati City" />
                </Field>
                <Field label="Province">
                  <select className="select" value={form.companyProvince || ''} onChange={set('companyProvince')}>
                    <option value="">Select province...</option>
                    {PROVINCES.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="ZIP Code">
                  <input className="input" value={form.companyZip || ''} onChange={set('companyZip')} placeholder="1200" maxLength={4} />
                </Field>
                <Field label="Phone Number">
                  <input className="input" value={form.companyPhone || ''} onChange={set('companyPhone')} placeholder="+63 2 8XXX-XXXX" />
                </Field>
              </div>
              <Field label="Website">
                <input className="input" value={form.companyWebsite || ''} onChange={set('companyWebsite')} placeholder="https://www.company.com" />
              </Field>
            </>
          )}

          {/* ── Email Template ── */}
          {activeTab === 'emailTemplate' && (
            <>
              <SectionTitle icon={Mail}>Invoice Email Template</SectionTitle>
              <p className="text-xs text-gray-400 -mt-2 mb-2">
                Placeholders: <code className="font-mono">{'{{customerName}} {{invoiceNo}} {{invoiceDate}} {{dueDate}} {{subtotal}} {{vat}} {{total}} {{amountDue}} {{companyName}} {{notes}}'}</code>
              </p>

              <Field label="Subject Line">
                <input className="input" value={form.invoiceEmailSubject || ''} onChange={set('invoiceEmailSubject')} placeholder="Invoice {{invoiceNo}} from {{companyName}}" />
              </Field>
              <Field label="Greeting" sub="shown at the top of the email, above the invoice details">
                <textarea className="input" rows={3} value={form.invoiceEmailGreeting || ''} onChange={set('invoiceEmailGreeting')} />
              </Field>
              <Field label="Payment Instructions" sub="optional — the block is hidden entirely when left blank">
                <textarea className="input" rows={3} value={form.invoiceEmailPaymentInstructions || ''} onChange={set('invoiceEmailPaymentInstructions')} placeholder="e.g. Pay via GCash 0917-000-0000 or BDO 000-000-0000" />
              </Field>
              <Field label="Terms & Conditions" sub="optional — the block is hidden entirely when left blank">
                <textarea className="input" rows={3} value={form.invoiceEmailTerms || ''} onChange={set('invoiceEmailTerms')} placeholder="e.g. Payment due within 30 days of invoice date." />
              </Field>
              <Field label="Signature" sub="optional — the block is hidden entirely when left blank">
                <textarea className="input" rows={3} value={form.invoiceEmailSignature || ''} onChange={set('invoiceEmailSignature')} placeholder={'e.g. Juan Dela Cruz\nAccounting Department'} />
              </Field>
            </>
          )}

          {/* ── Fiscal & Tax ── */}
          {activeTab === 'fiscal' && (
            <>
              <SectionTitle icon={FileText}>Fiscal Year</SectionTitle>
              <div className="form-grid">
                <Field label="Fiscal Year Start Month">
                  <select className="select" value={form.fiscalYearStart || '01'} onChange={set('fiscalYearStart')}>
                    {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2,'0')}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Accounting Method">
                  <select className="select" value={form.accountingMethod || 'ACCRUAL'} onChange={set('accountingMethod')}>
                    <option value="ACCRUAL">Accrual Basis (PFRS)</option>
                    <option value="CASH">Cash Basis</option>
                    <option value="MODIFIED_CASH">Modified Cash Basis</option>
                  </select>
                </Field>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <SectionTitle icon={Shield} color="text-yellow-600">BIR / Tax Registration</SectionTitle>
                <div className="form-grid">
                  <Field label="Company TIN" sub="format: 000-000-000-000">
                    <input className="input font-mono" value={form.companyTin || ''} onChange={set('companyTin')} placeholder="000-000-000-000" />
                  </Field>
                  <Field label="Revenue District Office (RDO)">
                    <select className="select" value={form.rdoCode || ''} onChange={set('rdoCode')}>
                      <option value="">Select RDO...</option>
                      {RDO_CODES.map((c) => <option key={c} value={c}>RDO {c}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="form-grid">
                  <Field label="VAT Registration Date">
                    <input type="date" className="input" value={form.vatRegDate || ''} onChange={set('vatRegDate')} />
                  </Field>
                  <Field label="VAT Filing Type">
                    <select className="select" value={form.birFormType || '2550M'} onChange={set('birFormType')}>
                      <option value="2550M">2550M — Monthly</option>
                      <option value="2550Q">2550Q — Quarterly</option>
                    </select>
                  </Field>
                </div>
                <div className="mt-2">
                  <Toggle
                    label="VAT Registered"
                    sub="Company is registered with BIR as a VAT taxpayer (12%)"
                    value={boolVal('vatRegistered')}
                    onChange={(v) => setB('vatRegistered')(v)}
                  />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <SectionTitle icon={Globe} color="text-green-600">Currency & Localization</SectionTitle>
                <div className="form-grid">
                  <Field label="Currency">
                    <select className="select" value={form.currency || 'PHP'} onChange={set('currency')}>
                      <option value="PHP">PHP — Philippine Peso (₱)</option>
                      <option value="USD">USD — US Dollar ($)</option>
                    </select>
                  </Field>
                  <Field label="Date Format">
                    <select className="select" value={form.dateFormat || 'MM/DD/YYYY'} onChange={set('dateFormat')}>
                      <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY (PH)</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                    </select>
                  </Field>
                </div>
              </div>
            </>
          )}

          {/* ── Payroll ── */}
          {activeTab === 'payroll' && (
            <>
              <SectionTitle icon={Calculator}>Payroll Configuration</SectionTitle>
              <div className="form-grid">
                <Field label="Payroll Cut-off Day 1" sub="first half">
                  <select className="select" value={form.payrollCutoff1 || '15'} onChange={set('payrollCutoff1')}>
                    {Array.from({length:20},(_,i)=>i+1).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Payroll Cut-off Day 2" sub="second half">
                  <select className="select" value={form.payrollCutoff2 || '30'} onChange={set('payrollCutoff2')}>
                    {[28,29,30,31].map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              </div>

              <div className="border-t border-gray-100 pt-5">
                <SectionTitle color="text-blue-600">Statutory Contribution Rates</SectionTitle>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4 text-xs text-blue-700">
                  These are the employer share rates used to compute payroll and journal entries. Employee shares are governed by the SSS 2024 table and statutory rates.
                </div>
                <div className="form-grid">
                  <Field label="SSS Employer Rate (%)" sub="default 9.5%">
                    <div className="relative">
                      <input type="number" step="0.01" min="0" max="20" className="input pr-8" value={form.sssErRate || '9.5'} onChange={set('sssErRate')} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                    </div>
                  </Field>
                  <Field label="PhilHealth Total Rate (%)" sub="default 5%, split equally">
                    <div className="relative">
                      <input type="number" step="0.01" min="0" max="20" className="input pr-8" value={form.philhealthRate || '5'} onChange={set('philhealthRate')} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                    </div>
                  </Field>
                  <Field label="Pag-IBIG Employer Rate (%)" sub="default 2%">
                    <div className="relative">
                      <input type="number" step="0.01" min="0" max="10" className="input pr-8" value={form.pagibigErRate || '2'} onChange={set('pagibigErRate')} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                    </div>
                  </Field>
                  <Field label="Default Tax Exemption Code" sub="BIR 1601-C">
                    <select className="select" value={form.taxExemptionCode || 'ME'} onChange={set('taxExemptionCode')}>
                      <option value="S">S — Single</option>
                      <option value="ME">ME — Married Employee</option>
                      <option value="S1">S1 — Single, 1 qualified dependent</option>
                      <option value="ME1">ME1 — Married, 1 dependent</option>
                      <option value="ME2">ME2 — Married, 2 dependents</option>
                      <option value="ME3">ME3 — Married, 3 dependents</option>
                      <option value="ME4">ME4 — Married, 4 dependents</option>
                    </select>
                  </Field>
                </div>
              </div>
            </>
          )}

          {/* ── Numbering ── */}
          {activeTab === 'numbering' && (
            <>
              <SectionTitle icon={Hash}>Document Numbering Series</SectionTitle>
              <p className="text-xs text-gray-400 -mt-4">Define prefix and starting number for auto-generated document codes.</p>

              {[
                { label: 'Sales Invoice', prefixKey: 'invoicePrefix', nextKey: 'invoiceNextNo', icon: '🧾', example: 'INV-1000' },
                { label: 'Bill / Purchase Invoice', prefixKey: 'billPrefix', nextKey: 'billNextNo', icon: '📄', example: 'BILL-1000' },
                { label: 'Journal Entry', prefixKey: 'jePrefix', nextKey: 'jeNextNo', icon: '📒', example: 'JE-000001' },
                { label: 'Payment / Receipt', prefixKey: 'paymentPrefix', nextKey: null, icon: '💳', example: 'PAY-001' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                  <div className="text-2xl w-10 text-center flex-shrink-0">{item.icon}</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-700 mb-2">{item.label}</p>
                    <div className="flex items-center gap-2">
                      <input
                        className="input w-24 font-mono text-sm uppercase"
                        value={form[item.prefixKey] || ''}
                        onChange={set(item.prefixKey)}
                        placeholder="INV"
                        maxLength={10}
                      />
                      <span className="text-gray-400 font-bold">-</span>
                      {item.nextKey && (
                        <input
                          type="number" min="1"
                          className="input w-28 font-mono text-sm"
                          value={form[item.nextKey] || ''}
                          onChange={set(item.nextKey)}
                          placeholder="1000"
                        />
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Example: <span className="font-mono text-gray-500">{item.example}</span></p>
                  </div>
                </div>
              ))}

              <div className="border-t border-gray-100 pt-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-xs text-yellow-700">
                  <strong>Note:</strong> Changing the prefix or next number only affects new documents created after saving. Existing documents retain their original numbers.
                </div>
              </div>
            </>
          )}

          {/* ── Users ── */}
          {activeTab === 'users' && (
            <>
              <div className="flex items-center justify-between">
                <SectionTitle icon={Users}>User Management</SectionTitle>
                <button onClick={() => setUserModal('new')} className="btn-primary btn-sm">
                  <Plus className="w-3.5 h-3.5" /> Add User
                </button>
              </div>

              {/* Role legend */}
              <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  { role: 'ADMIN',      desc: 'Full access — users, DB, settings' },
                  { role: 'MANAGER',    desc: 'View all + approve transactions'    },
                  { role: 'ACCOUNTANT', desc: 'Create & post entries, AP/AR, payroll' },
                  { role: 'VIEWER',     desc: 'Read-only access to all modules'    },
                ].map((r) => (
                  <div key={r.role} className="p-3 bg-gray-50 rounded-xl">
                    <span className={`badge ${ROLE_COLORS[r.role]} text-xs mb-1 block w-fit`}>{r.role}</span>
                    <p className="text-xs text-gray-500">{r.desc}</p>
                  </div>
                ))}
              </div>

              {/* Users table */}
              <div className="table-wrapper">
                <table className="table text-sm">
                  <thead>
                    <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th className="text-center">Actions</th></tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td><p className="font-medium">{u.firstName} {u.lastName}</p></td>
                        <td className="text-gray-500 text-xs">{u.email}</td>
                        <td><span className={`badge ${ROLE_COLORS[u.role]} text-xs`}>{u.role}</span></td>
                        <td>
                          <span className={`badge text-xs ${u.isActive ? 'badge-green' : 'badge-gray'}`}>
                            {u.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="text-xs text-gray-400">{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}</td>
                        <td>
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setUserModal(u)} title="Edit" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setResetPwdFor(u)} title="Reset Password" className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg">
                              <Key className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleToggleUser(u)} title={u.isActive ? 'Deactivate' : 'Activate'}
                              className={`p-1.5 rounded-lg transition-colors ${u.isActive ? 'text-green-500 hover:bg-green-50' : 'text-gray-300 hover:bg-gray-50'}`}>
                              {u.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => handleDeleteUser(u)} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Database ── */}
          {activeTab === 'database' && (
            <>
              <SectionTitle icon={Database}>Database Management</SectionTitle>

              {/* Stats */}
              {dbLoading ? (
                <div className="flex items-center gap-2 text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading database stats...</div>
              ) : dbStats ? (
                <>
                  <div className="grid grid-cols-3 xl:grid-cols-5 gap-3">
                    {[
                      { label: 'Users',        value: dbStats.counts.userCount      },
                      { label: 'Accounts',     value: dbStats.counts.accountCount   },
                      { label: 'Journal Entries',value: dbStats.counts.jeCount      },
                      { label: 'Bills',        value: dbStats.counts.billCount      },
                      { label: 'Invoices',     value: dbStats.counts.invoiceCount   },
                      { label: 'Vendors',      value: dbStats.counts.vendorCount    },
                      { label: 'Customers',    value: dbStats.counts.customerCount  },
                      { label: 'Employees',    value: dbStats.counts.employeeCount  },
                      { label: 'Pay Periods',  value: dbStats.counts.periodCount    },
                      ...(dbStats.dbSizeMb !== null ? [{ label: 'DB Size', value: `${dbStats.dbSizeMb} MB` }] : []),
                    ].map((s) => (
                      <div key={s.label} className="bg-gray-50 rounded-xl p-3 text-center">
                        <p className="text-lg font-bold text-gray-900">{s.value}</p>
                        <p className="text-xs text-gray-400">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">Last checked: {formatDate(dbStats.lastChecked)}</p>
                </>
              ) : null}

              {/* Backup */}
              <div className="border-t border-gray-100 pt-5">
                <SectionTitle icon={HardDrive} color="text-green-600">Backup & Restore</SectionTitle>

                {/* Full backup (legacy) */}
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between gap-4 mb-4">
                  <div>
                    <p className="text-sm font-semibold text-green-800">Full Database Backup</p>
                    <p className="text-xs text-green-600 mt-0.5">Exports everything (all modules) as a single JSON file.</p>
                  </div>
                  <button onClick={handleBackup} disabled={backingUp} className="btn-success btn-sm flex-shrink-0 flex items-center gap-2">
                    {backingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {backingUp ? 'Preparing...' : 'Full Backup'}
                  </button>
                </div>

                {/* Module-level export */}
                <div className="border border-green-200 rounded-xl p-4 space-y-3 mb-4">
                  <p className="text-sm font-semibold text-gray-800">Select Modules to Export</p>
                  <p className="text-xs text-gray-500">Choose only the modules you need — keeps the file small and targeted.</p>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {moduleList.map((m) => {
                      const checked = selectedMods.includes(m.key);
                      return (
                        <label key={m.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors ${checked ? 'bg-green-50 border-green-400 text-green-800 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                          <input type="checkbox" className="accent-green-600" checked={checked}
                            onChange={() => setSelectedMods((prev) => checked ? prev.filter((k) => k !== m.key) : [...prev, m.key])} />
                          {m.label}
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button className="text-xs text-green-700 underline" onClick={() => setSelectedMods(moduleList.map((m) => m.key))}>Select All</button>
                    <span className="text-gray-300">·</span>
                    <button className="text-xs text-gray-500 underline" onClick={() => setSelectedMods([])}>Clear</button>
                    <div className="flex-1" />
                    <button onClick={handleModuleExport} disabled={exportingMods || !selectedMods.length}
                      className={`btn-sm flex items-center gap-2 ${selectedMods.length ? 'btn-primary' : 'bg-gray-100 text-gray-400 cursor-not-allowed rounded-lg px-3 py-1.5 text-xs'}`}>
                      {exportingMods ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      {exportingMods ? 'Exporting...' : `Export ${selectedMods.length ? `(${selectedMods.length})` : ''}`}
                    </button>
                  </div>
                </div>

                {/* Module-level restore */}
                <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-amber-900">Restore from Backup File</p>
                  <p className="text-xs text-amber-700">Upload a Finara backup JSON. You can choose which modules to restore and whether to wipe existing data first.</p>

                  {/* File picker */}
                  <label className="flex items-center gap-3 border-2 border-dashed border-amber-300 rounded-lg p-4 cursor-pointer hover:border-amber-400 transition-colors">
                    <HardDrive className="w-5 h-5 text-amber-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-amber-800">{restoreFile ? restoreFile.name : 'Click to choose a .json backup file'}</p>
                      {restoreFileMeta && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          Exported {new Date(restoreFileMeta.exportedAt).toLocaleDateString()} · {restoreFileMeta.rowCount?.toLocaleString()} rows · Modules: {restoreFileMeta.modules?.join(', ')}
                        </p>
                      )}
                    </div>
                    <input type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
                  </label>

                  {/* Module selector from file */}
                  {restoreFileMeta && (
                    <>
                      <div>
                        <p className="text-xs font-medium text-amber-900 mb-2">Select modules to restore:</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {restoreFileMeta.modules.map((key) => {
                            const mod   = moduleList.find((m) => m.key === key);
                            const checked = restoreMods.includes(key);
                            return (
                              <label key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors ${checked ? 'bg-amber-100 border-amber-400 text-amber-900 font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'}`}>
                                <input type="checkbox" className="accent-amber-600" checked={checked}
                                  onChange={() => setRestoreMods((prev) => checked ? prev.filter((k) => k !== key) : [...prev, key])} />
                                {mod?.label || key}
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      {/* Reset toggle */}
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" className="accent-red-600 w-4 h-4" checked={doReset} onChange={(e) => setDoReset(e.target.checked)} />
                        <div>
                          <p className="text-xs font-semibold text-red-800">Delete existing data before restoring</p>
                          <p className="text-xs text-red-600">Removes current records for selected modules, then inserts from backup. Uncheck to merge (keeps existing, skips duplicates).</p>
                        </div>
                      </label>

                      <button onClick={() => setShowRestoreConfirm(true)} disabled={!restoreMods.length || restoring}
                        className="btn-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-4 py-2 text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50">
                        {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        {restoring ? 'Restoring...' : `Restore ${restoreMods.length} module${restoreMods.length !== 1 ? 's' : ''}`}
                      </button>
                    </>
                  )}
                </div>

                {/* Restore confirm modal */}
                {showRestoreConfirm && (
                  <div className="modal-overlay">
                    <div className="modal max-w-md">
                      <div className="modal-header">
                        <div className="flex items-center gap-2 text-amber-700">
                          <AlertTriangle className="w-5 h-5" />
                          <h3 className="font-bold">Confirm Restore</h3>
                        </div>
                        <button onClick={() => setShowRestoreConfirm(false)} className="text-gray-400 text-2xl">&times;</button>
                      </div>
                      <div className="modal-body space-y-3">
                        <p className="text-sm text-gray-700">You are about to restore the following modules:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {restoreMods.map((k) => <span key={k} className="badge-yellow">{moduleList.find((m) => m.key === k)?.label || k}</span>)}
                        </div>
                        {doReset && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                            <strong>Warning:</strong> Existing data for the selected modules will be permanently deleted before restoring. This cannot be undone.
                          </div>
                        )}
                        <p className="text-xs text-gray-500">Backup file: <strong>{restoreFile?.name}</strong></p>
                      </div>
                      <div className="modal-footer">
                        <button onClick={() => setShowRestoreConfirm(false)} className="btn-secondary">Cancel</button>
                        <button onClick={handleRestore} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                          Yes, Restore
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Danger zone */}
              <div className="border-t border-gray-100 pt-5">
                <SectionTitle icon={AlertTriangle} color="text-red-600">Danger Zone</SectionTitle>
                <div className="border-2 border-red-200 rounded-2xl p-5 space-y-4 bg-red-50">
                  <div>
                    <p className="text-sm font-bold text-red-800">Reset Selected Modules</p>
                    <p className="text-xs text-red-600 mt-0.5">
                      Permanently deletes all data for the modules you choose. Users and system settings are always preserved. <strong>This cannot be undone.</strong>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {moduleList.map((m) => {
                      const checked = resetMods.includes(m.key);
                      return (
                        <label key={m.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors ${checked ? 'bg-red-100 border-red-400 text-red-800 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:border-red-200'}`}>
                          <input type="checkbox" className="accent-red-600" checked={checked}
                            onChange={() => setResetMods((prev) => checked ? prev.filter((k) => k !== m.key) : [...prev, m.key])} />
                          {m.label}
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <button className="text-xs text-red-700 underline" onClick={() => setResetMods(moduleList.map((m) => m.key))}>Select All</button>
                    <span className="text-red-200">·</span>
                    <button className="text-xs text-gray-400 underline" onClick={() => setResetMods([])}>Clear</button>
                    <div className="flex-1" />
                    <button
                      onClick={() => setShowModResetModal(true)}
                      disabled={!resetMods.length}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${resetMods.length ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-red-100 text-red-300 cursor-not-allowed'}`}>
                      <Trash2 className="w-4 h-4" />
                      Reset {resetMods.length ? `(${resetMods.length})` : ''}
                    </button>
                  </div>

                  <div className="text-xs text-red-500 bg-red-100 rounded-lg px-3 py-2">
                    ⚠ Always download a backup before resetting. Verify the backup is complete before proceeding.
                  </div>
                </div>

                {/* Legacy full reset */}
                <div className="mt-3 flex items-center justify-between gap-4 px-4 py-3 border border-red-100 rounded-xl bg-white">
                  <div>
                    <p className="text-xs font-semibold text-red-700">Full Database Reset</p>
                    <p className="text-xs text-gray-400">Deletes ALL modules at once (original behavior).</p>
                  </div>
                  <button onClick={() => setShowDbReset(true)} className="text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" /> Full Reset
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── System ── */}
          {activeTab === 'system' && (
            <>
              <SectionTitle icon={SettingsIcon}>System Preferences</SectionTitle>
              <div className="form-grid">
                <Field label="System Timezone">
                  <select className="select" value={form.systemTimezone || 'Asia/Manila'} onChange={set('systemTimezone')}>
                    <option value="Asia/Manila">Asia/Manila (PHT +8)</option>
                    <option value="UTC">UTC+0</option>
                    <option value="Asia/Singapore">Asia/Singapore (+8)</option>
                    <option value="Asia/Tokyo">Asia/Tokyo (+9)</option>
                    <option value="America/New_York">America/New_York (ET)</option>
                  </select>
                </Field>
                <Field label="Decimal Places in Reports">
                  <select className="select" value={form.decimalPlaces || '2'} onChange={set('decimalPlaces')}>
                    <option value="0">0 — Round to whole peso</option>
                    <option value="2">2 — Centavo precision (₱1,234.56)</option>
                  </select>
                </Field>
                <Field label="Session Timeout (minutes)" sub="auto-logout">
                  <input type="number" min="15" max="1440" className="input" value={form.sessionTimeout || '480'} onChange={set('sessionTimeout')} />
                </Field>
              </div>

              <div className="border-t border-gray-100 pt-5 space-y-1">
                <SectionTitle icon={Shield} color="text-indigo-600">Security</SectionTitle>
                <Toggle
                  label="Enforce Strong Passwords"
                  sub="Require minimum 8 characters with mixed case and numbers for all users"
                  value={boolVal('enforceStrongPwd')}
                  onChange={(v) => setB('enforceStrongPwd')(v)}
                />
                <Toggle
                  label="Audit Trail"
                  sub="Log all user actions (create, edit, delete) to the application log file"
                  value={boolVal('auditTrail')}
                  onChange={(v) => setB('auditTrail')(v)}
                />
                <Toggle
                  label="Show Centavos in Reports"
                  sub="Display decimal places in all financial reports and statements"
                  value={boolVal('showCentsInReports')}
                  onChange={(v) => setB('showCentsInReports')(v)}
                />
              </div>

              {/* System info */}
              <div className="border-t border-gray-100 pt-5">
                <SectionTitle icon={Server} color="text-gray-500">System Information</SectionTitle>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Framework',   'Next.js 14 (App Router) + Express.js'],
                    ['Database',    'MySQL / MariaDB with Prisma ORM'],
                    ['Auth',        'JWT with refresh tokens (bcryptjs)'],
                    ['Tax Engine',  'Philippine TRAIN Law 2023+, SSS 2024'],
                    ['Standards',   'PFRS for SMEs, BIR RMC 2024'],
                    ['Version',     'PH-ERP v1.0.0'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                      <span className="text-gray-400 text-xs w-20 flex-shrink-0">{k}</span>
                      <span className="text-gray-700 text-xs font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeTab === 'permissions' && (
            <div className="space-y-5">
              <SectionTitle icon={Key} color="text-violet-600">Module Permissions</SectionTitle>
              <p className="text-sm text-gray-500">
                Choose which modules each role can access. <strong>Admin</strong> always has full
                access. Changes apply immediately to every user with that role.
              </p>

              {!permConfig ? (
                <div className="py-10 text-center text-gray-400 text-sm">Loading permissions…</div>
              ) : (
                <>
                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Module</th>
                          <th className="px-3 py-3 text-xs font-semibold text-gray-500 uppercase text-center">Admin</th>
                          {CONFIGURABLE_ROLES.map((r) => (
                            <th key={r} className="px-3 py-3 text-xs font-semibold text-gray-500 uppercase text-center">{r}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {MODULES.map((m) => (
                          <tr key={m.key} className="border-b border-gray-100 last:border-0">
                            <td className="px-4 py-2.5 font-medium text-gray-700">{m.label}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className="inline-block w-9 h-5 rounded-full bg-blue-600 align-middle relative">
                                <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-white rounded-full" />
                              </span>
                            </td>
                            {CONFIGURABLE_ROLES.map((role) => {
                              const lock = isLocked(m.key, role);
                              const on = lock.on || (!lock.off && permConfig[role]?.includes(m.key));
                              const disabled = !!(lock.on || lock.off);
                              return (
                                <td key={role} className="px-3 py-2.5 text-center">
                                  <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => togglePerm(role, m.key)}
                                    title={lock.on ? 'Always allowed' : lock.off ? 'Not allowed for this role' : ''}
                                    className={`inline-block w-9 h-5 rounded-full align-middle relative transition-colors ${
                                      on ? 'bg-green-500' : 'bg-gray-300'
                                    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                  >
                                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${on ? 'right-0.5' : 'left-0.5'}`} />
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400">
                      Note: Payroll is never available to Viewer (salaries are protected at the server level).
                    </p>
                    <button onClick={handleSavePermissions} disabled={permSaving} className="btn-primary">
                      {permSaving ? 'Saving…' : 'Save Permissions'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-5">
              <SectionTitle icon={Shield} color="text-indigo-500">Audit Trail</SectionTitle>
              <p className="text-sm text-gray-500">
                Every create, update, delete, posting, and login is recorded with the user,
                module, timestamp, and IP address. Use the Audit Trail to review who did what,
                investigate discrepancies, and meet compliance requirements.
              </p>
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Activity & Audit Log</p>
                    <p className="text-xs text-gray-500">Full, filterable history of all system activity</p>
                  </div>
                </div>
                <Link href="/audit" className="btn-primary">
                  Open Audit Trail
                </Link>
              </div>
            </div>
          )}

          {/* ── Inquiries ── */}
          {activeTab === 'inquiries' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <SectionTitle icon={Inbox}>Landing Page Inquiries</SectionTitle>
                <button onClick={loadInquiries} disabled={inquiriesLoading} className="btn-secondary btn-sm">
                  {inquiriesLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Refresh
                </button>
              </div>
              <p className="text-sm text-gray-500">
                Messages submitted through the Finara website contact form. Click a row to read the full message.
              </p>
              {inquiriesLoading && !inquiries.length ? (
                <div className="flex items-center justify-center py-14 text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : !inquiries.length ? (
                <div className="flex flex-col items-center justify-center py-14 text-gray-400">
                  <Inbox className="w-8 h-8 mb-2" />
                  <p className="text-sm">No inquiries yet</p>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="table text-sm">
                    <thead>
                      <tr><th>Date</th><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Message</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {inquiries.map((q) => {
                        const expanded = expandedInquiry === q.id;
                        return (
                          <tr key={q.id} onClick={() => setExpandedInquiry(expanded ? null : q.id)} className="cursor-pointer">
                            <td className="text-xs text-gray-400 whitespace-nowrap">{formatDate(q.createdAt)}</td>
                            <td><p className="font-medium">{q.name}</p></td>
                            <td className="text-gray-500 text-xs">{q.company || '—'}</td>
                            <td className="text-gray-500 text-xs">{q.email}</td>
                            <td className="text-gray-500 text-xs">{q.phone || '—'}</td>
                            <td className={`text-gray-600 text-xs ${expanded ? 'whitespace-pre-wrap' : 'max-w-[280px] truncate'}`}>{q.message}</td>
                            <td>
                              <span className={`badge text-xs ${INQUIRY_STATUS_COLORS[q.status] || 'badge-gray'}`}>{q.status}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Help ── */}
          {activeTab === 'help' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <SectionTitle icon={HelpCircle} color="text-blue-500">Finara User Manual</SectionTitle>
                <a href={USER_MANUAL_PDF} download="Finara-User-Manual.pdf" className="btn-primary">
                  <Download className="w-4 h-4" /> Download PDF
                </a>
              </div>
              <p className="text-sm text-gray-500">
                A complete, module-by-module guide to every feature in Finara — Chart of Accounts,
                General Ledger, AR/AP, Payroll, BIR Compliance, Inventory, and Reports — with
                step-by-step instructions and workflow diagrams. View it below, or download it to
                keep offline.
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50" style={{ height: '80vh' }}>
                <iframe
                  src={USER_MANUAL_PDF}
                  title="Finara User Manual"
                  className="w-full h-full"
                />
              </div>
              <p className="text-xs text-gray-400">
                If the preview above doesn't load (some mobile browsers can't display PDFs inline),
                use the <strong>Download PDF</strong> button and open it in your device's PDF reader.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom save bar (sticky) */}
      {isDirty && (
        <div className="sticky bottom-5 z-30">
          <div className="max-w-2xl mx-auto bg-gray-900 text-white rounded-2xl px-5 py-3.5 flex items-center justify-between shadow-2xl">
            <p className="text-sm">You have unsaved changes in <strong>{TABS.find((t) => t.key === activeTab)?.label}</strong></p>
            <div className="flex gap-2">
              <button onClick={() => setForm({ ...original })} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors">Discard</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-sm font-medium rounded-lg flex items-center gap-2 transition-colors">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {saving ? 'Saving...' : 'Save Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {userModal && (
        <UserModal
          user={userModal === 'new' ? null : userModal}
          onClose={() => setUserModal(null)}
          onSaved={() => { setUserModal(null); loadUsers(); }}
        />
      )}
      {resetPwdFor && (
        <ResetPwdModal user={resetPwdFor} onClose={() => setResetPwdFor(null)} />
      )}
      {showDbReset && (
        <DbResetModal onClose={() => { setShowDbReset(false); loadDbStats(); }} />
      )}
      {showModResetModal && (
        <ModuleResetModal
          modules={resetMods}
          moduleList={moduleList}
          onClose={() => setShowModResetModal(false)}
          onDone={() => { setResetMods([]); loadDbStats(); }}
        />
      )}
    </div>
  );
}
