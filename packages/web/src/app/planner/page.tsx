'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CalendarRange, Sparkles, Loader2, FileEdit, Check } from 'lucide-react';

type PlanItem = {
  day: number;
  weekday?: string;
  theme: string;
  format: string;
  hook: string;
  captionIdea: string;
  hashtags: string[];
  objective?: string;
};

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'x', label: 'X / Twitter' },
];

const OBJ_BADGE: Record<string, string> = {
  engajar: 'badge-in-progress',
  vender: 'badge-urgent',
  educar: 'badge-completed',
};

export default function PlannerPage() {
  const [brands, setBrands] = useState<any[]>([]);
  const [brandId, setBrandId] = useState('');
  const [month, setMonth] = useState('');
  const [postsCount, setPostsCount] = useState(12);
  const [platforms, setPlatforms] = useState<string[]>(['instagram']);
  const [goals, setGoals] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [planMonth, setPlanMonth] = useState('');
  const [created, setCreated] = useState<Record<number, boolean>>({});
  const [creatingIdx, setCreatingIdx] = useState<number | null>(null);

  useEffect(() => {
    api.listBrands().then((r: any) => {
      const items = r?.items || r || [];
      setBrands(items);
      const def = items.find((b: any) => b.isDefault);
      if (def) setBrandId(def.id);
    }).catch(() => {});
    // default: mês atual em pt-BR
    try {
      const now = new Date();
      setMonth(now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
    } catch { /* ignore */ }
  }, []);

  function togglePlatform(id: string) {
    setPlatforms((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function generate() {
    setLoading(true);
    setError('');
    setPlan([]);
    setCreated({});
    try {
      const res: any = await api.generateContentPlan({
        brandId: brandId || undefined,
        month: month || undefined,
        postsCount,
        platforms,
        goals: goals || undefined,
      });
      setPlan(res.items || []);
      setPlanMonth(res.month || month);
    } catch (e: any) {
      setError(e?.message || 'Falha ao gerar o plano');
    } finally {
      setLoading(false);
    }
  }

  async function createDraft(item: PlanItem, idx: number) {
    setCreatingIdx(idx);
    try {
      const caption = [item.hook, item.captionIdea].filter(Boolean).join('\n\n');
      await api.createPost({
        caption,
        hashtags: item.hashtags || [],
        platforms: platforms.map((p) => p.toUpperCase()),
        status: 'DRAFT',
        brandId: brandId || undefined,
      });
      setCreated((c) => ({ ...c, [idx]: true }));
    } catch (e: any) {
      setError(e?.message || 'Falha ao criar rascunho');
    } finally {
      setCreatingIdx(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent-pink flex items-center justify-center text-white shadow-cta">
          <CalendarRange className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Planejador de Conteúdo</h1>
          <p className="text-sm text-text-secondary">A IA monta seu calendário do mês inteiro — temas, formatos e ganchos.</p>
        </div>
      </div>

      {/* Form */}
      <div className="card p-5 mb-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Empresa</label>
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input-field text-sm">
              <option value="">Genérica</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Mês / período</label>
            <input value={month} onChange={(e) => setMonth(e.target.value)} className="input-field text-sm" placeholder="Ex: julho de 2026" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Qtd. de posts</label>
            <input type="number" min={1} max={31} value={postsCount} onChange={(e) => setPostsCount(Number(e.target.value))} className="input-field text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-text-muted mb-2 uppercase tracking-wide">Plataformas</label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePlatform(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${platforms.includes(p.id) ? 'bg-primary/15 border-primary text-primary' : 'border-border text-text-muted hover:text-text-secondary'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Objetivos do mês (opcional)</label>
          <textarea value={goals} onChange={(e) => setGoals(e.target.value)} rows={2} className="input-field text-sm" placeholder="Ex: lançar produto novo, aumentar seguidores, gerar leads..." />
        </div>

        <div className="flex items-center gap-3">
          <button onClick={generate} disabled={loading} className="btn-cta text-sm">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando plano...</> : <><Sparkles className="w-4 h-4" /> Gerar plano com IA</>}
          </button>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </div>

      {/* Resultado */}
      {plan.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-text-primary">Plano para {planMonth} · {plan.length} posts</h2>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plan.map((item, idx) => (
          <div key={idx} className="card p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary font-bold flex items-center justify-center text-sm">{item.day}</span>
                <div className="leading-tight">
                  <div className="text-[11px] text-text-muted">{item.weekday || ''}</div>
                  <div className="text-xs font-semibold text-text-secondary">{item.format}</div>
                </div>
              </div>
              {item.objective && (
                <span className={`badge ${OBJ_BADGE[item.objective] || 'badge-pending'} text-[10px] capitalize`}>{item.objective}</span>
              )}
            </div>

            <div className="font-bold text-text-primary text-sm">{item.theme}</div>
            {item.hook && <div className="text-sm text-text-primary/90">“{item.hook}”</div>}
            {item.captionIdea && <div className="text-xs text-text-secondary">{item.captionIdea}</div>}

            {item.hashtags?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.hashtags.map((h, i) => (
                  <span key={i} className="text-[10px] text-primary/80">#{h}</span>
                ))}
              </div>
            )}

            <div className="mt-1">
              {created[idx] ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-500"><Check className="w-3.5 h-3.5" /> Rascunho criado</span>
              ) : (
                <button onClick={() => createDraft(item, idx)} disabled={creatingIdx === idx} className="btn-ghost text-xs">
                  {creatingIdx === idx ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Criando...</> : <><FileEdit className="w-3.5 h-3.5" /> Criar rascunho</>}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {!loading && plan.length === 0 && !error && (
        <div className="card p-10 text-center text-text-muted text-sm">
          Preencha os campos e clique em <b>“Gerar plano com IA”</b> pra a DisparaAI montar seu calendário de conteúdo.
        </div>
      )}
    </div>
  );
}
