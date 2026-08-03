'use client';

import { useEffect, useState } from 'react';
import { BookMarked, Loader2, Plus, Trash2, Check, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Playbooks de nicho: a configuração de uma marca vira modelo.
 *
 * Onboarding de cliente novo cai de uma semana para uma hora — e onboarding
 * é onde a agência perde margem.
 *
 * A tela diz com todas as letras o que NÃO é copiado. Sem isso o usuário
 * ficaria (com razão) com medo de aplicar um playbook e vazar a chave PIX
 * de um cliente no cadastro de outro.
 */

interface Playbook { chave: string; nome: string; nicho?: string; aplica: string[]; temVisual: boolean }

export default function PlaybooksPage() {
  const [items, setItems] = useState<Playbook[]>([]);
  const [marcas, setMarcas] = useState<Array<{ id: string; name: string }>>([]);
  const [carregando, setCarregando] = useState(true);

  const [origemId, setOrigemId] = useState('');
  const [nome, setNome] = useState('');
  const [incluirVisual, setIncluirVisual] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [destinoId, setDestinoId] = useState('');
  const [aplicando, setAplicando] = useState('');
  const [aplicado, setAplicado] = useState<string[] | null>(null);
  const [erro, setErro] = useState('');

  async function carregar() {
    try {
      const [p, b] = await Promise.all([api.listarPlaybooks(), api.listBrands()]);
      setItems(p.items);
      setMarcas(b.items || []);
      if (b.items?.[0]) { setOrigemId(b.items[0].id); setDestinoId(b.items[0].id); }
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar');
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  async function salvar() {
    setSalvando(true);
    setErro('');
    try {
      await api.salvarPlaybook({ brandId: origemId, nome, incluirVisual });
      setNome('');
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar');
    }
    setSalvando(false);
  }

  async function aplicarEm(chave: string, comVisual: boolean) {
    setAplicando(chave);
    setErro('');
    setAplicado(null);
    try {
      const r = await api.aplicarPlaybook({ brandId: destinoId, chave, aplicarVisual: comVisual });
      setAplicado(r.aplicado);
      setTimeout(() => setAplicado(null), 4000);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao aplicar');
    }
    setAplicando('');
  }

  async function remover(chave: string) {
    setItems((p) => p.filter((x) => x.chave !== chave));
    await api.removerPlaybook(chave).catch(() => carregar());
  }

  if (carregando) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <BookMarked className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Playbooks de nicho
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Salve a configuração de uma marca e aplique em clientes novos do mesmo ramo.
        </p>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      {/* O usuário precisa saber disso ANTES de apertar qualquer botão. */}
      <div className="card p-3.5 mb-4 border-status-published/30 bg-status-published/[0.04]">
        <p className="flex items-start gap-2 text-[11px] text-text-secondary">
          <ShieldCheck className="w-4 h-4 text-status-published flex-shrink-0 mt-0.5" strokeWidth={2} />
          <span>
            O playbook leva só tom de voz, hashtags, direção de arte e mix de conteúdo.
            <strong className="text-text-primary"> Chave PIX, WhatsApp, valor do contrato e link de aprovação nunca são copiados</strong> —
            esses são de cada cliente.
          </span>
        </p>
      </div>

      <div className="card p-5 mb-5">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Criar a partir de uma marca</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select value={origemId} onChange={(e) => setOrigemId(e.target.value)} className="input-field">
            {marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do playbook — ex: Pizzaria"
            className="input-field"
          />
        </div>

        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input type="checkbox" checked={incluirVisual} onChange={(e) => setIncluirVisual(e.target.checked)} className="w-4 h-4 rounded text-primary" />
          <span className="text-[11px] text-text-secondary">Levar também cores e fontes</span>
        </label>

        <button onClick={salvar} disabled={salvando || nome.trim().length < 2} className="btn-cta w-full mt-3 text-xs disabled:opacity-40">
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2.5} />}
          Salvar playbook
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-text-secondary">Nenhum playbook salvo ainda.</p>
          <p className="text-[11px] text-text-muted mt-1">
            Configure bem uma marca e salve como modelo — o próximo cliente do mesmo ramo sai pronto.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex-shrink-0">Aplicar em</span>
            <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className="input-field flex-1">
              {marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          {aplicado && (
            <div className="card p-3 mb-3 border-status-published/50 bg-status-published/[0.06]">
              <p className="flex items-center gap-1.5 text-[11px] text-status-published">
                <Check className="w-3.5 h-3.5" strokeWidth={3} />
                Aplicado: {aplicado.join(', ')}.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {items.map((p) => (
              <div key={p.chave} className="card p-4">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-text-primary">{p.nome}</p>
                    <p className="text-[11px] text-text-secondary mt-0.5">Leva: {p.aplica.join(', ')}</p>
                  </div>
                  <button onClick={() => remover(p.chave)} title="Remover"
                    className="p-2 rounded-lg border border-border text-text-secondary hover:text-status-failed transition-colors flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => aplicarEm(p.chave, false)}
                    disabled={!!aplicando}
                    className="btn-cta text-[11px] px-3 py-1.5 disabled:opacity-40"
                  >
                    {aplicando === p.chave ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    Aplicar
                  </button>
                  {p.temVisual && (
                    <button
                      onClick={() => aplicarEm(p.chave, true)}
                      disabled={!!aplicando}
                      className="btn-ghost text-[11px] px-3 py-1.5 disabled:opacity-40"
                    >
                      Aplicar com cores
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
