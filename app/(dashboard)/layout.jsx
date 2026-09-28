'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import PageTransition from '@/components/layout/PageTransition';
import { isAuthenticated, getUser } from '@/lib/auth';
import { canAccess, canWrite, setPermissions, setDisabledModules } from '@/lib/permissions';
import { permissions as permApi } from '@/lib/api';
import { BusinessProvider } from '@/lib/businessContext';
import SessionTimeoutGuard from '@/components/layout/SessionTimeoutGuard';

export default function DashboardLayout({ children }) {
  const router   = useRouter();
  const pathname = usePathname();

  const [authed,    setAuthed]    = useState(null);
  const [collapsed, setCollapsed] = useState(false);   // desktop: expanded by default
  const [mobileOpen, setMobileOpen] = useState(false); // mobile nav: closed by default
  const [readonly,  setReadonly]  = useState(false);
  const [permReady, setPermReady] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) { setAuthed(true); }
    else { setAuthed(false); router.push('/login'); }
  }, [router]);

  useEffect(() => {
    const stored = localStorage.getItem('sidebarCollapsed');
    if (stored !== null) {
      // User has a saved preference — always honour it
      setCollapsed(stored === '1');
    } else {
      // No preference yet: collapse only on mobile screens
      setCollapsed(window.innerWidth < 1024);
    }
  }, []);
  useEffect(() => { if (authed) setReadonly(!canWrite(getUser()?.role)); }, [authed]);

  useEffect(() => {
    if (!authed) return;
    permApi.get()
      .then(({ data }) => setPermissions(data))
      .catch(() => setPermissions(null))
      .finally(() => setPermReady(true));
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    permApi.getDisabled()
      .then(({ data }) => setDisabledModules(data.disabled, data.adminExempt))
      .catch(() => setDisabledModules([]));
  }, [authed]);

  useEffect(() => {
    if (!authed || !permReady) return;
    const role = getUser()?.role;
    if (!canAccess(pathname, role)) {
      toast.error('You do not have access to that page');
      router.replace('/dashboard');
    }
  }, [authed, permReady, pathname, router]);

  // Close mobile sidebar on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const toggleSidebar = () =>
    setCollapsed((c) => { const n = !c; localStorage.setItem('sidebarCollapsed', n ? '1' : '0'); return n; });

  if (!authed) return null;

  return (
    <>
      <SessionTimeoutGuard />
      <BusinessProvider>
        <div className="flex h-screen bg-gray-50 dark:bg-gray-950" data-readonly={readonly}>
          <Sidebar
            collapsed={collapsed}
            onToggle={toggleSidebar}
            mobileOpen={mobileOpen}
            onMobileClose={() => setMobileOpen(false)}
          />

          {/* Mobile overlay backdrop */}
          {mobileOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}

          <div className={`flex-1 flex flex-col min-h-screen overflow-hidden transition-all duration-200 ${collapsed ? 'lg:ml-16' : 'lg:ml-64'}`}>
            <Header onMobileMenu={() => setMobileOpen(true)} />
            <main className="flex-1 overflow-y-auto p-4 lg:p-6">
              <PageTransition>
                {children}
              </PageTransition>
            </main>
          </div>
        </div>
      </BusinessProvider>
    </>
  );
}
