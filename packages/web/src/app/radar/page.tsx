'use client';

import { useEffect, useState } from 'react';
import { Radar, Plus, RefreshCw, Trash2, Loader2, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Radar de concorrentes.
 *
 * Mostra os numeros publicos de ate 5 perfis e a variacao desde o ultimo
 * check. O valor nao esta no numero absoluto, e na comparacao: "ela postou
 * 12 vezes esse mes, voce 3".
 */

interface Concorrente {
  id: string;
  username: string;
  displayName?: string;
  followers?: number;
  mediaCount?: number;
  postsLast30?: number;
  avgLikes?: number;
  deltaFollowers: number | null;
  deltaMedia: number | null;
  lastCheckedAt?: string;
  lastError?: string;
}

function numero(n?: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function RadarPage() {
  const [itens, setItens] = useState<Concorrente[]>([]);
  const [max, setMax] = useState(5);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const [atualizando, setAtualizando] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  async function carregar() {
    try {
      const r = await api.listCompetitors();
      setItens(r.items);
      setMax(r.max);
    } catch (err: any) {
      setErro(err?.message || 'Falha ao carregar');
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  async function adicionar() {
    if (!novo.trim()) return;
    setAdicionando(true);
    setErro('');
    try {
      await api.addCompetitor(novo.trim());
      setNovo('');
      await carregar();
    } catch (err: any) {
      setErro(err?.message || 'Falha ao adicionar');
    }
    setAdicionando(false);
  }

  async function atualizar(id: string) {
    setAtualizando(id);
    try {
      await api.refreshCompetitor(id);
      await carregar();
    } catch (err: any) {
      setErro(err?.message || 'Falha ao atualizar');
    }
    setAtualizando(null);
  }

  async function remover(id: string) {
    if (!confirm('Tirar este perfil do radar?')) return;
    try {
      await api.removeCompetitor(id);
      await carregar();
    } catch (err: any) {
      setErro(err?.message || 'Falha ao remover');
    }
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <Radar className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Radar de concorrentes
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Acompanhe até {max} perfis e veja como você está em relação a eles.
        </p>
      </div>

      <div className="card p-5 mb-4">
        <div className="flex gap-2">
          <input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') adicionar(); }}
            placeholder="@perfil_do_concorrente"
            disabled={itens.length >= max}
            className="input-field flex-1 disabled:opacity-50"
          />
          <button onClick={adicionar} disabled={adicionando || !novo.trim() || itens.length >= max}
            className="btn-cta px-4 text-xs disabled:opacity-40">
            {adicionando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2} />}
            Adicionar
          </button>
        </div>
        <p className="text-[10px] text-text-muted mt-2">
          O Instagram só expõe contas <strong>Business ou Creator públicas</strong>. Perfil pessoal ou privado não aparece —
          não é limitação do DisparaAI.
        </p>
        {erro && <p className="text-[11px] text-status-failed mt-2">{erro}</p>}
      </div>

      {carregando ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : itens.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-text-secondary">Nenhum perfil no radar ainda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {itens.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text-primary">@{c.username}</p>
                  {c.displayName && <p className="text-xs text-text-muted">{c.displayName}</p>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => atualizar(c.id)} disabled={atualizando === c.id}
                    className="p-1.5 rounded hover:bg-bg-main text-text-muted hover:text-primary disabled:opacity-50">
                    {atualizando === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => remover(c.id)} className="p-1.5 rounded hover:bg-bg-main text-text-muted hover:text-status-failed">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {c.lastError ? (
                <div className="flex items-start gap-1.5 mt-3 text-[11px] text-amber-500">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" strokeWidth={2} />
                  <span>{c.lastError}</span>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <Metrica rotulo="Seguidores" valor={numero(c.followers)} delta={c.deltaFollowers} />
                  <Metrica rotulo="Publicações" valor={numero(c.mediaCount)} delta={c.deltaMedia} />
                  <Metrica rotulo="Posts/30d" valor={numero(c.postsLast30)} />
                  <Metrica rotulo="Média curtidas" valor={numero(c.avgLikes)} />
                </div>
              )}

              {c.lastCheckedAt && (
                <p className="text-[10px] text-text-muted mt-2">
                  Atualizado em {new Date(c.lastCheckedAt).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metrica({ rotulo, valor, delta }: { rotulo: string; valor: string; delta?: number | null }) {
  return (
    <div className="bg-bg-main rounded-lg p-2.5">
      <p className="text-sm font-bold text-text-primary">{valor}</p>
      <p className="text-[10px] text-text-muted">{rotulo}</p>
      {/* Sem check anterior, nao ha variacao — mostrar "+0" seria mentira. */}
      {delta != null && delta !== 0 && (
        <p className={`flex items-center gap-0.5 text-[10px] font-semibold mt-0.5 ${
          delta > 0 ? 'text-emerald-500' : 'text-red-400'
        }`}>
          {delta > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
          {delta > 0 ? '+' : ''}{delta}
        </p>
      )}
    </div>
  );
}
