'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, BookOpen, FileText, CreditCard,
  Users, ClipboardList, Building2, ChevronDown, LogOut, Settings,
  Package, Landmark, Wallet,
  ShoppingCart, Banknote, BarChart3, Repeat,
  PanelLeftClose, PanelLeftOpen, HandCoins, Scale,
  GraduationCap, Blocks, Tags, ClipboardCheck,
} from 'lucide-react';
import PesoReceipt from '@/components/icons/PesoReceipt';
import { clearSession, getUser } from '@/lib/auth';
import { canAccess, isNavVisible } from '@/lib/permissions';
import { useRouter } from 'next/navigation';
import { auth as authApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';

// Navigation grouped into categories. `section: null` renders with no header.
const NAV = [
  {
    section: null,
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    section: 'Accounting',
    items: [
      { label: 'Chart of Accounts', href: '/accounts', icon: BookOpen },
      { label: 'General Ledger',    href: '/journal',  icon: FileText },
      { label: 'Recurring Entries', href: '/recurring', icon: Repeat },
    ],
  },
  {
    section: 'Sales',
    items: [
      {
        label: 'Accounts Receivable', icon: PesoReceipt,
        children: [
          { label: 'Invoices',   href: '/receivable' },
          { label: 'Quotations', href: '/receivable/quotations' },
          { label: 'Customers',  href: '/receivable/customers' },
          { label: 'AR Aging',   href: '/receivable/aging' },
        ],
      },
      { label: 'Cash Sales', icon: Banknote, href: '/receivable/cash-sales' },
    ],
  },
  {
    section: 'School',
    items: [
      {
        label: 'School Billing', icon: GraduationCap,
        children: [
          { label: 'Cashier',      href: '/school/collections' },
          { label: 'Students',     href: '/school/students' },
          { label: 'Enrollment',   href: '/school/enrollment' },
          { label: 'Assessments',  href: '/school/assessments' },
          { label: 'Billing Run',  href: '/school/billing' },
          { label: 'Revenue Recognition', href: '/school/amortization' },
          { label: 'Subsidies',    href: '/school/subsidies' },
          { label: 'Reports',      href: '/school/reports' },
          { label: 'Setup',        href: '/school/setup' },
        ],
      },
    ],
  },
  {
    section: 'Purchases',
    items: [
      {
        label: 'Accounts Payable', icon: CreditCard,
        children: [
          { label: 'Bills',    href: '/payable' },
          { label: 'Vendors',  href: '/payable/vendors' },
          { label: 'AP Aging', href: '/payable/aging' },
          { label: 'Cheques',  href: '/payable/cheques' },
        ],
      },
      { label: 'Purchase Orders',  icon: ShoppingCart, href: '/purchase-orders' },
      { label: 'Expense Vouchers', icon: Wallet,       href: '/expenses' },
      { label: 'Cash Requests',    icon: HandCoins,    href: '/cash-requests' },
    ],
  },
  {
    section: 'Payroll',
    items: [
      {
        label: 'Payroll', icon: Users,
        children: [
          { label: 'Employees',   href: '/payroll/employees' },
          { label: 'Pay Periods', href: '/payroll/periods' },
          { label: 'Calculator',  href: '/payroll/calculator' },
        ],
      },
    ],
  },
  {
    section: 'Inventory & Assets',
    items: [
      {
        label: 'Inventory', icon: Package,
        children: [
          { label: 'Stock on Hand', href: '/inventory' },
          { label: 'Items',         href: '/inventory/items' },
          { label: 'Transactions',  href: '/inventory/transactions' },
          { label: 'Reports',       href: '/inventory/reports' },
        ],
      },
      { label: 'Fixed Assets', icon: Building2, href: '/assets' },
    ],
  },
  {
    section: 'Banking & Compliance',
    items: [
      { label: 'Bank Reconciliation', icon: Banknote, href: '/bank' },
      {
        label: 'BIR Compliance', icon: ClipboardList,
        children: [
          { label: 'VAT Summary (2550)',    href: '/bir/vat' },
          { label: 'Withholding (1601-C)',  href: '/bir/withholding' },
          { label: 'EWT Summary (1601-EQ)', href: '/bir/ewt' },
          { label: 'Alphalist',             href: '/bir/alphalist' },
          { label: 'RELIEF Export',         href: '/bir/relief' },
        ],
      },
      {
        label: 'Remittances', icon: Landmark,
        children: [
          { label: 'Dashboard',      href: '/remittance' },
          { label: 'Gov\'t Records', href: '/remittance/records' },
          { label: 'Daily Report',   href: '/remittance/daily' },
        ],
      },
    ],
  },
  {
    section: 'Planning & Reports',
    items: [
      { label: 'Budgeting', icon: BarChart3, href: '/budget' },
      {
        label: 'Reports', icon: FileText,
        children: [
          { label: 'Sales Report',     href: '/reports/sales' },
          { label: 'Trial Balance',    href: '/reports/trial-balance' },
          { label: 'Income Statement', href: '/reports/income-statement' },
          { label: 'Balance Sheet',    href: '/reports/balance-sheet' },
          { label: 'Cash Position',    href: '/reports/cash-position' },
          { label: 'Custom Reports',   href: '/reports/custom' },
        ],
      },
    ],
  },
  // Audit Trail lives under Settings → Audit Trail (intentionally not in the main nav)
];

function NavItem({ item, collapsed, onClose }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Collapsed: icon-only. Parent items link to their first child.
  if (collapsed) {
    const href = item.href || item.children?.[0]?.href || '#';
    const isActive = item.href
      ? pathname === item.href
      : item.children?.some((c) => pathname.startsWith(c.href));
    return (
      <Link
        href={href} title={item.label} onClick={onClose}
        className={`flex items-center justify-center h-10 rounded-lg transition-colors ${
          isActive ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        <item.icon className="w-5 h-5" />
      </Link>
    );
  }

  if (item.children) {
    const isActive = item.children.some((c) => pathname.startsWith(c.href));
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={`sidebar-link w-full ${isActive ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <item.icon className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open || isActive ? 'rotate-180' : ''}`} />
        </button>
        {(open || isActive) && (
          <div className="ml-7 mt-0.5 space-y-0.5">
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                onClick={onClose}
                className={`block px-3 py-1.5 rounded-md text-sm transition-colors ${
                  pathname === child.href
                    ? 'text-blue-600 font-medium bg-blue-50'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {child.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = pathname === item.href;
  return (
    <Link href={item.href} onClick={onClose} className={isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'}>
      <item.icon className="w-4 h-4 flex-shrink-0" />
      {item.label}
    </Link>
  );
}

export default function Sidebar({ collapsed = false, onToggle, mobileOpen = false, onMobileClose }) {
  const router = useRouter();
  // Read user from localStorage only after mount so the first client render
  // matches the server (which has no localStorage) — avoids hydration mismatch.
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [, bumpModules] = useState(0);
  // Re-render when the Modules page (or the layout's initial load) changes the list.
  useEffect(() => {
    const h = () => bumpModules((n) => n + 1);
    window.addEventListener('finara:modules-changed', h);
    return () => window.removeEventListener('finara:modules-changed', h);
  }, []);
  useEffect(() => { setUser(getUser()); }, []);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    clearSession();
    toast.success('Logged out');
    router.push('/login');
  };

  return (
    <aside className={`
      flex flex-col bg-white border-r border-gray-200 h-screen fixed left-0 top-0 z-50 transition-all duration-300
      dark:bg-gray-900 dark:border-gray-800
      ${collapsed ? 'w-16' : 'w-64'}
      lg:translate-x-0
      ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
    `}>
      {/* Logo + collapse toggle */}
      <div className={`h-16 border-b border-gray-200 flex items-center dark:border-gray-800 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
        {!collapsed && (
          <>
            <img src="/finara-logo.svg" alt="Finara" className="h-14 w-auto block dark:hidden" />
            <img src="/finara-logo-white.svg" alt="Finara" className="h-14 w-auto hidden dark:block" />
          </>
        )}
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors dark:hover:text-gray-100 dark:hover:bg-gray-800"
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 overflow-y-auto">
        {NAV.map((group, gi) => {
          const items = group.items.filter((item) =>
            !user || isNavVisible(item.href || item.children?.[0]?.href, user.role));
          if (items.length === 0) return null;
          return (
            <div key={group.section || `g${gi}`} className="mb-1">
              {group.section && (
                collapsed
                  ? <div className="my-2 border-t border-gray-100 dark:border-gray-800" />
                  : <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{group.section}</p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavItem key={item.label} item={item} collapsed={collapsed} onClose={onMobileClose} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User / footer */}
      <div className="border-t border-gray-200 p-3 space-y-1 dark:border-gray-800">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Link href="/my-businesses" title="My Businesses" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Building2 className="w-5 h-5" /></Link>
            {(!user || canAccess('/settings', user.role)) && (
              <>
                <Link href="/settings" title="Settings" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Settings className="w-5 h-5" /></Link>
                <Link href="/settings/businesses" title="Businesses" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Building2 className="w-5 h-5" /></Link>
                <Link href="/settings/opening-balances" title="Opening Balances" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Scale className="w-5 h-5" /></Link>
                {user?.role === 'SUPER_ADMIN' && (
                  <>
                    <Link href="/modules" title="Modules" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Blocks className="w-5 h-5" /></Link>
                    <Link href="/admin/plans" title="Plans & Payment" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Tags className="w-5 h-5" /></Link>
                    <Link href="/admin/orders" title="Business Orders" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ClipboardCheck className="w-5 h-5" /></Link>
                  </>
                )}
              </>
            )}
            <button onClick={handleLogout} title={`Logout (${user?.email || ''})`} className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800"><LogOut className="w-5 h-5" /></button>
          </div>
        ) : (
          <>
            <Link href="/my-businesses" className={pathname === '/my-businesses' ? 'sidebar-link-active' : 'sidebar-link-inactive'}>
              <Building2 className="w-4 h-4" />
              My Businesses
            </Link>
            {(!user || canAccess('/settings', user.role)) && (
              <>
                <Link href="/settings" className="sidebar-link-inactive">
                  <Settings className="w-4 h-4" />
                  Settings
                </Link>
                <Link href="/settings/businesses" className="sidebar-link-inactive">
                  <Building2 className="w-4 h-4" />
                  Businesses
                </Link>
                <Link href="/settings/opening-balances" className="sidebar-link-inactive">
                  <Scale className="w-4 h-4" />
                  Opening Balances
                </Link>
                {user?.role === 'SUPER_ADMIN' && (
                  <>
                    <Link href="/modules" className={pathname === '/modules' ? 'sidebar-link-active' : 'sidebar-link-inactive'}>
                      <Blocks className="w-4 h-4" />
                      Modules
                    </Link>
                    <Link href="/admin/plans" className={pathname === '/admin/plans' ? 'sidebar-link-active' : 'sidebar-link-inactive'}>
                      <Tags className="w-4 h-4" />
                      Plans &amp; Payment
                    </Link>
                    <Link href="/admin/orders" className={pathname === '/admin/orders' ? 'sidebar-link-active' : 'sidebar-link-inactive'}>
                      <ClipboardCheck className="w-4 h-4" />
                      Business Orders
                    </Link>
                  </>
                )}
              </>
            )}
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-bold flex-shrink-0">
                {user?.firstName?.[0]}{user?.lastName?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{user?.name || user?.email}</div>
                <div className="text-xs text-gray-400 truncate">{user?.role}</div>
              </div>
              <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition-colors" title="Logout">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
