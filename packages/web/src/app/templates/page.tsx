'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { LayoutTemplate, Loader2, Download, FileEdit, Check } from 'lucide-react';

const RATIOS = [
  { id: '1:1', label: 'Feed 1:1' },
  { id: '4:5', label: 'Retrato 4:5' },
  { id: '9:16', label: 'Stories 9:16' },
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [brandId, setBrandId] = useState('');
  const [selected, setSelected] = useState('bold-gradient');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [body, setBody] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.listTemplates().then((r: any) => setTemplates(r || [])).catch(() => {});
    api.listBrands().then((r: any) => {
      const items = r?.items || r || [];
      setBrands(items);
      const def = items.find((b: any) => b.isDefault);
      if (def) setBrandId(def.id);
    }).catch(() => {});
  }, []);

  async function generate() {
    if (!title.trim()) { setError('Informe pelo menos o título.'); return; }
    setLoading(true); setError(''); setImageUrl(''); setCreated(false);
    try {
      const res: any = await api.generateTemplate({
        title, subtitle: subtitle || undefined, body: body || undefined,
        template: selected, aspectRatio: ratio,
        brandId: brandId || undefined, applyBrand: !!brandId,
      });
      setImageUrl(res.imageUrl);
    } catch (e: any) { setError(e?.message || 'Falha ao gerar imagem'); }
    finally { setLoading(false); }
  }

  async function createPost() {
    setCreating(true);
    try {
      await api.createPost({ caption: [title, subtitle].filter(Boolean).join('\n'), imageUrl, brandId: brandId || undefined, platforms: ['INSTAGRAM'] });
      setCreated(true);
    } catch (e: any) { setError(e?.message || 'Falha ao criar post'); }
    finally { setCreating(false); }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent-pink flex items-center justify-center text-white shadow-cta">
          <LayoutTemplate className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Galeria de Templates</h1>
          <p className="text-sm text-text-secondary">Escolha um template, preencha o texto e gere a arte na hora — com a identidade da sua empresa.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Coluna esquerda: escolha + form */}
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-2 uppercase tracking-wide">Template</label>
            <div className="grid grid-cols-3 gap-2">
              {templates.map((t) => (
                <button key={t.id} onClick={() => setSelected(t.id)} className={`card p-3 text-left transition-all ${selected === t.id ? 'border-2 border-primary' : 'border border-border hover:border-primary/40'}`}>
                  <div className="w-full h-14 rounded-md bg-gradient-to-br from-primary/20 to-accent-pink/20 flex items-center justify-center text-primary font-bold text-lg mb-1">{t.preview || '?'}</div>
                  <div className="text-xs font-semibold text-text-primary leading-tight">{t.name}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Título</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-field text-sm" placeholder="Texto principal" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Subtítulo (opcional)</label>
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="input-field text-sm" placeholder="Texto de apoio" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Corpo (opcional)</label>
              <input value={body} onChange={(e) => setBody(e.target.value)} className="input-field text-sm" placeholder="Detalhe/CTA" />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Formato</label>
                <select value={ratio} onChange={(e) => setRatio(e.target.value)} className="input-field text-sm">
                  {RATIOS.map((r) => (<option key={r.id} value={r.id}>{r.label}</option>))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wide">Empresa</label>
                <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input-field text-sm">
                  <option value="">Sem marca</option>
                  {brands.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
                </select>
              </div>
            </div>
            <button onClick={generate} disabled={loading} className="btn-cta text-sm w-full justify-center">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando arte...</> : <><LayoutTemplate className="w-4 h-4" /> Gerar arte</>}
            </button>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        </div>

        {/* Coluna direita: preview */}
        <div className="card p-5 flex flex-col items-center justify-center min-h-[360px]">
          {imageUrl ? (
            <>
              <img src={imageUrl} alt="arte" className="max-w-full max-h-[420px] rounded-lg shadow-lg mb-4" />
              <div className="flex gap-2">
                <a href={imageUrl} target="_blank" rel="noreferrer" download className="btn-ghost text-xs"><Download className="w-3.5 h-3.5" /> Baixar</a>
                {created ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-500"><Check className="w-3.5 h-3.5" /> Post criado</span>
                ) : (
                  <button onClick={createPost} disabled={creating} className="btn-cta text-xs">
                    {creating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Criando...</> : <><FileEdit className="w-3.5 h-3.5" /> Criar post</>}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="text-text-muted text-sm text-center">A arte gerada aparece aqui.</div>
          )}
        </div>
      </div>
    </div>
  );
}
