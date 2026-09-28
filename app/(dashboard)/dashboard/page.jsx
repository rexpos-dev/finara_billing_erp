'use client';
import { useEffect, useState } from 'react';
import { dashboard as dashApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  TrendingUp, TrendingDown, AlertCircle, Users, Building2,
  ShoppingCart, FileText, CheckCircle, Clock, Circle, CheckCircle2,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const StatCard = ({ label, value, sub, icon: Icon, color, trend }) => (
  <div className="stat-card">
    <div className={`stat-icon ${color}`}>
      <Icon className="w-6 h-6" />
    </div>
    <div className="flex-1">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
    {trend !== undefined && (
      <div className={`text-xs font-medium ${trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
        {trend >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
      </div>
    )}
  </div>
);

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashApi.get()
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load dashboard data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Loading dashboard...</p>
      </div>
    </div>
  );

  const d = data || {};
  const netIncome = d.gl?.netIncome || 0;
  const chartData = [
    { name: 'Revenue', amount: d.gl?.monthRevenue || 0, fill: '#22c55e' },
    { name: 'Expenses', amount: d.gl?.monthExpense || 0, fill: '#ef4444' },
    { name: 'Net Income', amount: Math.max(0, netIncome), fill: '#3b82f6' },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Welcome to Finara Accounting System ERP</h2>
            <p className="text-blue-200 text-sm mt-1">BIR • SSS • PhilHealth • Pag-IBIG Compliant System</p>
          </div>
          <div className="hidden md:flex gap-1 h-6">
            <div className="w-3 bg-blue-400 rounded" />
            <div className="w-3 bg-white rounded" />
            <div className="w-3 bg-red-400 rounded" />
          </div>
        </div>
      </div>

      {/* Getting started — hidden once every step is done */}
      {d.setup && d.setup.completed < d.setup.total && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Getting Started</h3>
            <span className="badge-blue">{d.setup.completed} of {d.setup.total} done</span>
          </div>
          <div className="px-5 pt-4">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${(d.setup.completed / d.setup.total) * 100}%` }} />
            </div>
          </div>
          <div className="divide-y divide-gray-100 mt-2">
            {d.setup.steps.map((s) => (
              <Link key={s.key} href={s.href} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                {s.done
                  ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />}
                <span className={`text-sm ${s.done ? 'text-gray-400 line-through' : 'text-gray-900 font-medium'}`}>{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Sales"
          value={formatCurrency(d.gl?.monthRevenue)}
          sub="This month"
          icon={TrendingUp} color="bg-blue-100 text-blue-600"
        />
        <StatCard
          label="Accounts Receivable"
          value={formatCurrency(d.receivables?.openAmount)}
          sub={`${d.receivables?.openCount || 0} invoices outstanding`}
          icon={PesoSign} color="bg-green-100 text-green-600"
        />
        <StatCard
          label="Accounts Payable"
          value={formatCurrency(d.payables?.openAmount)}
          sub={`${d.payables?.openCount || 0} bills outstanding`}
          icon={ShoppingCart} color="bg-orange-100 text-orange-600"
        />
        <StatCard
          label="Total Expenses"
          value={formatCurrency(d.gl?.monthExpense)}
          sub="This month"
          icon={TrendingDown} color="bg-red-100 text-red-600"
        />
        <StatCard
          label="Net Income (MTD)"
          value={formatCurrency(netIncome)}
          icon={netIncome >= 0 ? TrendingUp : TrendingDown}
          color={netIncome >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="card xl:col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Month-to-Date P&L</h3>
            <span className="badge-blue">Current Month</span>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barSize={48}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Alerts */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Alerts</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {d.receivables?.overdue > 0 && (
              <div className="flex items-start gap-3 p-4">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Overdue Receivables</p>
                  <p className="text-xs text-red-500">{formatCurrency(d.receivables.overdue)} past due</p>
                </div>
              </div>
            )}
            {d.payables?.overdue > 0 && (
              <div className="flex items-start gap-3 p-4">
                <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Overdue Payables</p>
                  <p className="text-xs text-orange-500">{formatCurrency(d.payables.overdue)} past due</p>
                </div>
              </div>
            )}
            {d.gl?.draftEntries > 0 && (
              <div className="flex items-start gap-3 p-4">
                <Clock className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Draft Journal Entries</p>
                  <p className="text-xs text-yellow-600">{d.gl.draftEntries} entries pending review</p>
                </div>
              </div>
            )}
            {(!d.receivables?.overdue && !d.payables?.overdue && !d.gl?.draftEntries) && (
              <div className="flex items-center gap-3 p-4">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <p className="text-sm text-gray-600">All clear! No pending alerts.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick counts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Active Customers', value: d.counts?.customers || 0, icon: Users, color: 'text-blue-600' },
          { label: 'Active Vendors',   value: d.counts?.vendors   || 0, icon: Building2, color: 'text-purple-600' },
          { label: 'Active Employees', value: d.counts?.employees || 0, icon: Users, color: 'text-green-600' },
        ].map((s) => (
          <div key={s.label} className="card p-5 text-center">
            <s.icon className={`w-7 h-7 mx-auto mb-2 ${s.color}`} />
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
