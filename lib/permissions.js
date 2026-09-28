// ─── Configurable role-based access control ──────────────────────────────────
//
// Roles: ADMIN (always full) · MANAGER · ACCOUNTANT · VIEWER
//
// Module access per role is configurable by an ADMIN in Settings → Permissions
// and stored per-business. This file holds the module registry, the built-in
// defaults, and a runtime config that the app loads from the server on login.
// Both the Sidebar (hide modules) and the layout (redirect on direct-URL) use
// canAccess() below.

// Each module maps to the route prefixes it owns.
// `noDisable: true` marks modules that can never be globally switched off via
// the SUPER_ADMIN-only Modules toggle (see setDisabledModules below) — distinct
// from `always`/`lockOff`, which only control per-role defaults.
export const MODULES = [
  { key: 'dashboard',  label: 'Dashboard',           routes: ['/dashboard'],                      always: true, noDisable: true },
  { key: 'accounts',   label: 'Chart of Accounts',   routes: ['/accounts'] },
  { key: 'journal',    label: 'General Ledger',       routes: ['/journal'] },
  { key: 'recurring',  label: 'Recurring Entries',    routes: ['/recurring'] },
  { key: 'receivable', label: 'Sales (Receivables)',  routes: ['/receivable'] },
  { key: 'school',     label: 'School Billing',       routes: ['/school'] },
  { key: 'payable',    label: 'Purchases (Payables)', routes: ['/payable', '/purchase-orders', '/expenses', '/cash-requests'] },
  { key: 'payroll',    label: 'Payroll',              routes: ['/payroll'], lockOff: ['VIEWER'] }, // salaries: never VIEWER
  { key: 'inventory',  label: 'Inventory',            routes: ['/inventory'] },
  { key: 'assets',     label: 'Fixed Assets',         routes: ['/assets'] },
  { key: 'bank',       label: 'Bank Reconciliation',  routes: ['/bank'] },
  { key: 'bir',        label: 'BIR Compliance',       routes: ['/bir'] },
  { key: 'remittance', label: 'Remittances',          routes: ['/remittance'] },
  { key: 'budget',     label: 'Budgeting',            routes: ['/budget'] },
  { key: 'reports',    label: 'Reports',              routes: ['/reports'] },
  { key: 'audit',      label: 'Audit Trail',          routes: ['/audit'] },
  { key: 'settings',   label: 'Settings',             routes: ['/settings'],                      noDisable: true },
];

export const CONFIGURABLE_ROLES = ['MANAGER', 'ACCOUNTANT', 'VIEWER'];
const ALL_KEYS = MODULES.map((m) => m.key);

// Built-in defaults (used until an admin customises them). ADMIN = everything.
export const DEFAULT_PERMISSIONS = {
  MANAGER:    [...ALL_KEYS],
  ACCOUNTANT: ALL_KEYS.filter((k) => !['settings', 'audit'].includes(k)),
  VIEWER:     ALL_KEYS.filter((k) => !['payroll', 'settings', 'audit'].includes(k)),
};

// ── Runtime config (loaded from the server; falls back to defaults) ───────────
let _perm = null;
export function setPermissions(p) {
  if (!p) { _perm = null; return; }
  // Keep only known keys, and enforce lockOff (e.g. VIEWER can never get payroll)
  const clean = {};
  for (const role of CONFIGURABLE_ROLES) {
    const list = Array.isArray(p[role]) ? p[role] : (DEFAULT_PERMISSIONS[role] || []);
    clean[role] = ALL_KEYS.filter((k) => list.includes(k) && !isLocked(k, role).off);
  }
  _perm = clean;
}
export function getPermissions() { return _perm || DEFAULT_PERMISSIONS; }

// Global module disable — set by SUPER_ADMIN, applies to every role except
// SUPER_ADMIN regardless of the per-role permission config above.
//
// adminExempt additionally exempts ADMIN from this same list. It is a
// per-business SUPER_ADMIN-only opt-in (default off), so existing businesses
// keep today's behaviour unless a SUPER_ADMIN turns it on for that business.
let _disabled = [];
let _adminExempt = false;
export function setDisabledModules(list, adminExempt) {
  _disabled = Array.isArray(list) ? list : [];
  _adminExempt = !!adminExempt;
  // Let mounted UI (the Sidebar) re-render — this is module state, not React state.
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('finara:modules-changed'));
}
export function getDisabledModules() { return _disabled; }
export function getAdminExempt() { return _adminExempt; }

/** Is a module/role cell forced on/off (not freely configurable)? */
export function isLocked(moduleKey, role) {
  const m = MODULES.find((x) => x.key === moduleKey);
  if (!m) return {};
  if (m.always) return { on: true };                 // everyone always has it
  if (m.lockOff?.includes(role)) return { off: true }; // role can never have it
  return {};
}

// Map a pathname to its module key (longest matching route wins).
function moduleForPath(pathname) {
  if (!pathname) return null;
  let best = null;
  for (const m of MODULES) {
    for (const r of m.routes) {
      const hit = r === '/' ? pathname === '/' : (pathname === r || pathname.startsWith(r + '/'));
      if (hit && (!best || r.length > best.len)) best = { key: m.key, len: r.length };
    }
  }
  return best?.key || null;
}

/** Can a role access a path? SUPER_ADMIN always; ADMIN always unless globally
 * disabled; unmapped routes open to all. */
export function canAccess(pathname, role) {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  if (role === 'ADMIN' && getAdminExempt()) return true;
  const mod = moduleForPath(pathname);
  const m = mod ? MODULES.find((x) => x.key === mod) : null;
  if (m && !m.noDisable && getDisabledModules().includes(mod)) return false;
  if (role === 'ADMIN') return true;
  if (!mod) return true;
  if (m?.always) return true;
  return (getPermissions()[role] || []).includes(mod);
}

/**
 * Should this route appear in the navigation? A module switched off on the
 * Modules page disappears from the nav for everyone, SUPER_ADMIN included —
 * otherwise the person who turned it off would never see it happen. This is
 * about visibility only: canAccess() still lets SUPER_ADMIN open the URL
 * directly (support, and a way back to /modules).
 */
export function isNavVisible(pathname, role) {
  if (role === 'SUPER_ADMIN') {
    const mod = moduleForPath(pathname);
    const m = mod ? MODULES.find((x) => x.key === mod) : null;
    return !(m && !m.noDisable && getDisabledModules().includes(mod));
  }
  return canAccess(pathname, role);
}

/** Can a role access a module by key (used by the Sidebar/Settings). */
export function canAccessModule(moduleKey, role) {
  if (role === 'SUPER_ADMIN') return true;
  if (role === 'ADMIN' && getAdminExempt()) return true;
  const m = MODULES.find((x) => x.key === moduleKey);
  if (m && !m.noDisable && getDisabledModules().includes(moduleKey)) return false;
  if (role === 'ADMIN') return true;
  if (m?.always) return true;
  return (getPermissions()[role] || []).includes(moduleKey);
}

/** VIEWER is read-only everywhere; all other roles may write. */
export function canWrite(role) {
  return !!role && role !== 'VIEWER';
}
