'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import {
  CreditCard, Loader2, CheckCircle, Plus, Trash2, ExternalLink, RefreshCw, Wallet,
} from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente', RECEIVED: 'Recebido', CONFIRMED: 'Confirmado', OVERDUE: 'Vencido',
  REFUNDED: 'Estornado', RECEIVED_IN_CASH: 'Recebido', CHARGEBACK_REQUESTED: 'Chargeback',
};
const STATUS_CLASS: Record<string, string> = {
  PENDING: 'bg-amber-500/10 text-amber-600', RECEIVED: 'bg-emerald-500/10 text-status-published',
  CONFIRMED: 'bg-emerald-500/10 text-status-published', OVERDUE: 'bg-red-500/10 text-status-failed',
};

export default function BillingPage() {
  const [config, setConfig] = useState<any>(null);
  const [charges, setCharges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [apiKey, setApiKey] = useState('');
  const [env, setEnv] = useState<'sandbox' | 'production'>('sandbox');
  const [savingCfg, setSavingCfg] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');

  const [form, setForm] = useState({ customerName: '', cpfCnpj: '', value: '', billingType: 'PIX', dueDate: '', description: '' });
  const [creating, setCreating] = useState(false);

  const [plans, setPlans] = useState<any[]>([]);
  const [savingPlans, setSavingPlans] = useState(false);
  const [plansSaved, setPlansSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.getBillingConfig();
      setConfig(cfg);
      setEnv(cfg?.env || 'sandbox');
      try { setPlans(await api.getPlans()); } catch { /* ignore */ }
      if (cfg?.configured) {
        try { setCharges(await api.listCharges()); } catch { setCharges([]); }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  function updatePlan(idx: number, field: string, val: any) {
    setPlans((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p)));
  }
  function addPlan() { setPlans((prev) => [...prev, { name: '', price: 0, description: '' }]); }
  function removePlan(idx: number) { setPlans((prev) => prev.filter((_, i) => i !== idx)); }
  async function savePlans() {
    setSavingPlans(true); setPlansSaved(false);
    try {
      const clean = plans.map((p) => ({ id: p.id, name: p.name, price: Number(String(p.price).replace(',', '.')) || 0, description: p.description }));
      const saved = await api.setPlans(clean.filter((p) => p.name));
      setPlans(saved); setPlansSaved(true); setTimeout(() => setPlansSaved(false), 2000);
    } catch (err: any) { alert(err?.message || 'Erro ao salvar planos'); }
    setSavingPlans(false);
  }
  function applyPlan(planId: string) {
    const p = plans.find((x) => x.id === planId);
    if (p) setForm((f) => ({ ...f, value: String(p.price).replace('.', ','), description: p.name }));
  }

  useEffect(() => { load(); }, [load]);

  async function saveConfig() {
    setSavingCfg(true);
    setTestMsg('');
    try {
      await api.setBillingConfig({ apiKey: apiKey || undefined, env });
      setApiKey('');
      await load();
    } catch (err: any) { alert(err?.message || 'Erro'); }
    setSavingCfg(false);
  }

  async function testConn() {
    setTesting(true);
    setTestMsg('');
    try {
      const r = await api.testBilling();
      setTestMsg(`✓ Conectado${r?.account?.name ? ` — ${r.account.name}` : ''}`);
    } catch (err: any) { setTestMsg(`✗ ${err?.message || 'Falha'}`); }
    setTesting(false);
  }

  async function createCharge() {
    if (!form.customerName || !form.cpfCnpj || !form.value || !form.dueDate) { alert('Preencha nome, CPF/CNPJ, valor e vencimento.'); return; }
    setCreating(true);
    try {
      await api.createCharge({
        customerName: form.customerName,
        cpfCnpj: form.cpfCnpj,
        value: parseFloat(form.value.replace(',', '.')),
        billingType: form.billingType,
        dueDate: form.dueDate,
        description: form.description || undefined,
      });
      setForm({ customerName: '', cpfCnpj: '', value: '', billingType: 'PIX', dueDate: '', description: '' });
      setCharges(await api.listCharges());
    } catch (err: any) { alert(err?.message || 'Erro ao criar cobranca'); }
    setCreating(false);
  }

  const fmtBRL = (v: number) => v?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-page-title flex items-center gap-2"><Wallet className="w-6 h-6 text-primary" /> Cobrança</h1>
          <p className="text-sm text-text-secondary mt-0.5">Gere cobranças PIX/boleto para seus clientes via Asaas</p>
        </div>
        <button onClick={load} className="p-2 rounded-badge bg-bg-card border border-border text-text-secondary hover:bg-bg-card-hover" title="Atualizar">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Config */}
      <div className="card p-5">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">Configuração Asaas</p>
        {config?.configured ? (
          <div className="flex items-center gap-2 text-sm text-status-published mb-3">
            <CheckCircle className="w-4 h-4" /> Chave configurada ({config.env === 'production' ? 'Produção' : 'Sandbox'})
          </div>
        ) : (
          <p className="text-xs text-text-secondary mb-3">Cole a chave de API da sua conta Asaas. Use <b>Sandbox</b> para testar (dinheiro fictício) e <b>Produção</b> para cobrar de verdade.</p>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Ambiente</label>
            <select value={env} onChange={(e) => setEnv(e.target.value as any)} className="input-field text-sm">
              <option value="sandbox">Sandbox (teste)</option>
              <option value="production">Produção</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Chave de API {config?.configured && <span className="text-text-muted font-normal">(deixe vazio p/ manter)</span>}</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="$aact_..." className="input-field text-sm" />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button onClick={saveConfig} disabled={savingCfg} className="btn-cta px-4 py-2 text-sm disabled:opacity-50">{savingCfg ? 'Salvando...' : 'Salvar'}</button>
          <button onClick={testConn} disabled={testing} className="px-4 py-2 rounded-badge bg-bg-card border border-border text-text-secondary text-sm hover:bg-bg-card-hover disabled:opacity-50">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Testar conexão'}
          </button>
          {testMsg && <span className={`text-xs font-medium ${testMsg.startsWith('✓') ? 'text-status-published' : 'text-status-failed'}`}>{testMsg}</span>}
        </div>
      </div>

      {/* Planos */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Planos de assinatura</p>
          <button onClick={addPlan} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
        </div>
        <div className="space-y-2">
          {plans.map((p, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
              <input value={p.name} onChange={(e) => updatePlan(idx, 'name', e.target.value)} placeholder="Nome" className="input-field text-sm col-span-3" />
              <div className="col-span-2 flex items-center gap-1">
                <span className="text-xs text-text-muted">R$</span>
                <input value={p.price} onChange={(e) => updatePlan(idx, 'price', e.target.value)} placeholder="0,00" className="input-field text-sm" />
              </div>
              <input value={p.description} onChange={(e) => updatePlan(idx, 'description', e.target.value)} placeholder="Descrição / benefícios" className="input-field text-sm col-span-6" />
              <button onClick={() => removePlan(idx)} className="col-span-1 p-2 text-text-muted hover:text-status-failed flex justify-center" title="Remover"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button onClick={savePlans} disabled={savingPlans} className="btn-cta px-4 py-2 text-sm disabled:opacity-50">{savingPlans ? 'Salvando...' : 'Salvar planos'}</button>
          {plansSaved && <span className="text-xs text-status-published font-medium">✓ Salvo</span>}
          <span className="text-xs text-text-muted">Use no formulário abaixo para cobrar um cliente.</span>
        </div>
      </div>

      {/* Nova cobranca */}
      {config?.configured && (
        <div className="card p-5">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">Nova cobrança</p>
          {plans.length > 0 && (
            <div className="mb-3">
              <label className="block text-xs font-semibold text-text-secondary mb-1">Plano (preenche valor e descrição)</label>
              <select onChange={(e) => e.target.value && applyPlan(e.target.value)} defaultValue="" className="input-field text-sm">
                <option value="">— escolher plano —</option>
                {plans.map((p, i) => (
                  <option key={i} value={p.id}>{p.name} · R$ {String(p.price).replace('.', ',')}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nome do cliente" className="input-field text-sm" />
            <input value={form.cpfCnpj} onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })} placeholder="CPF ou CNPJ" className="input-field text-sm" />
            <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Valor (ex: 99,90)" className="input-field text-sm" />
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="input-field text-sm" />
            <select value={form.billingType} onChange={(e) => setForm({ ...form, billingType: e.target.value })} className="input-field text-sm">
              <option value="PIX">PIX</option>
              <option value="BOLETO">Boleto</option>
              <option value="CREDIT_CARD">Cartão</option>
              <option value="UNDEFINED">Cliente escolhe</option>
            </select>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descrição (opcional)" className="input-field text-sm" />
          </div>
          <button onClick={createCharge} disabled={creating} className="btn-cta px-4 py-2 text-sm mt-3 disabled:opacity-50 flex items-center gap-1">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Gerar cobrança
          </button>
        </div>
      )}

      {/* Lista */}
      {config?.configured && (
        <div className="card p-5">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">Cobranças recentes</p>
          {charges.length === 0 && <p className="text-sm text-text-muted">Nenhuma cobrança ainda.</p>}
          <div className="space-y-2">
            {charges.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-card-hover transition-colors">
                <CreditCard className="w-4 h-4 text-text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary font-medium">{fmtBRL(c.value)} · {c.billingType}</p>
                  <p className="text-xs text-text-muted">venc. {c.dueDate}{c.description ? ` · ${c.description}` : ''}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-badge text-[10px] font-semibold ${STATUS_CLASS[c.status] || 'bg-bg-main text-text-secondary'}`}>{STATUS_LABEL[c.status] || c.status}</span>
                {c.invoiceUrl && <a href={c.invoiceUrl} target="_blank" rel="noopener noreferrer" className="p-2 text-text-muted hover:text-primary" title="Abrir cobrança"><ExternalLink className="w-4 h-4" /></a>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
