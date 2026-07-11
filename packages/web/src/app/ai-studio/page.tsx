'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Wand2, Loader2, Copy, Check, Repeat, FlaskConical } from 'lucide-react';

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'x', label: 'X / Twitter' },
  { id: 'whatsapp', label: 'WhatsApp' },
];

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}
      className="btn-ghost text-xs"
    >
      {ok ? <><Check className="w-3.5 h-3.5" /> Copiado</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
    </button>
  );
}

export default function AiStudioPage() {
  const [tab, setTab] = useState<'repurpose' | 'variations'>('repurpose');
  const [brands, setBrands] = useState<any[]>([]);
  const [brandId, setBrandId] = useState('');

  // Repurpose
  const [caption, setCaption] = useState('');
  const [rPlatforms, setRPlatforms] = useState<string[]>(['instagram', 'linkedin', 'x']);
  const [rLoading, setRLoading] = useState(false);
  const [rResults, setRResults] = useState<Record<string, string>>({});

  // Variations
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(3);
  const [vPlatform, setVPlatform] = useState('instagram');
  const [vLoading, setVLoading] = useState(false);
  const [variations, setVariations] = useState<string[]>([]);

  const [error, setError] = useState('');

  useEffect(() => {
    api.listBrands().then((r: any) => {
      const items = r?.items || r || [];
      setBrands(items);
      const def = items.find((b: any) => b.isDefault);
      if (def) setBrandId(def.id);
    }).catch(() => {});
  }, []);

  function togglePlatform(id: string) {
    setRPlatforms((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function doRepurpose() {
    if (!caption.trim() || !rPlatforms.length) return;
    setRLoading(true); setError(''); setRResults({});
    try {
      const res: any = await api.repurposeContent({ caption, platforms: rPlatforms, brandId: brandId || undefined });
      setRResults(res.results || {});
    } catch (e: any) { setError(e?.message || 'Falha ao adaptar'); }
    finally { setRLoading(false); }
  }

  async function doVariations() {
    if (!topic.trim()) return;
    setVLoading(true); setError(''); setVariations([]);
    try {
      const res: any = await api.captionVariations({ topic, count, platform: vPlatform, brandId: brandId || undefined });
      setVariations(res.variations || []);
    } catch (e: any) { setError(e?.message || 'Falha ao gerar variacoes'); }
    finally { setVLoading(false); }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent-pink flex items-center justify-center text-white shadow-cta">
          <Wand2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Estúdio IA</h1>
          <p className="text-sm text-text-secondary">Adapte 1 post pra cada rede e gere variações A/B de legenda.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('repurpose')} className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 ${tab === 'repurpose' ? 'bg-primary text-white' : 'bg-bg-card text-text-secondary'}`}><Repeat className="w-4 h-4" /> Adaptar pra cada rede</button>
        <button onClick={() => setTab('variations')} className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 ${tab === 'variations' ? 'bg-primary text-white' : 'bg-bg-card text-text-secondary'}`}><FlaskConical className="w-4 h-4" /> Variações A/B</button>
      </div>

      <div className="mb-4">
        <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Empresa (opcional)</label>
        <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input-field text-sm max-w-xs">
          <option value="">Genérica</option>
          {brands.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
        </select>
      </div>

      {error && <div className="mb-4 text-xs text-red-500">{error}</div>}

      {tab === 'repurpose' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Post original</label>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} className="input-field text-sm" placeholder="Cole aqui a legenda/post que você quer adaptar pras outras redes..." />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-2 uppercase tracking-wide">Adaptar para</label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button key={p.id} type="button" onClick={() => togglePlatform(p.id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${rPlatforms.includes(p.id) ? 'bg-primary/15 border-primary text-primary' : 'border-border text-text-muted hover:text-text-secondary'}`}>{p.label}</button>
                ))}
              </div>
            </div>
            <button onClick={doRepurpose} disabled={rLoading} className="btn-cta text-sm">
              {rLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Adaptando...</> : <><Wand2 className="w-4 h-4" /> Adaptar com IA</>}
            </button>
          </div>

          {Object.entries(rResults).map(([platform, text]) => (
            <div key={platform} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-primary uppercase tracking-wide">{PLATFORMS.find((p) => p.id === platform)?.label || platform}</span>
                <CopyBtn text={text} />
              </div>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{text}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'variations' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Tema do post</label>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} className="input-field text-sm" placeholder="Ex: promoção de fim de semana da pizzaria" />
            </div>
            <div className="flex gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Variações</label>
                <input type="number" min={2} max={5} value={count} onChange={(e) => setCount(Number(e.target.value))} className="input-field text-sm w-24" />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Plataforma</label>
                <select value={vPlatform} onChange={(e) => setVPlatform(e.target.value)} className="input-field text-sm">
                  {PLATFORMS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
                </select>
              </div>
            </div>
            <button onClick={doVariations} disabled={vLoading} className="btn-cta text-sm">
              {vLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</> : <><FlaskConical className="w-4 h-4" /> Gerar variações</>}
            </button>
          </div>

          {variations.map((v, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-primary">Variação {String.fromCharCode(65 + i)}</span>
                <CopyBtn text={v} />
              </div>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{v}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
