'use client';

import { useState } from 'react';
import { TrendingUp, Search, Loader2, Heart, ExternalLink, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Radar de tendencias por hashtag.
 *
 * A cota do Meta (30 hashtags distintas por 7 dias) fica visivel o tempo
 * todo. Sem isso, o usuario esbarraria no limite sem entender por que a
 * busca parou de funcionar — e ficaria uma semana sem a funcionalidade.
 */

interface Resultado {
  tag: string;
  posts: number;
  mediaCurtidas: number;
  topPost?: { permalink?: string; caption?: string; likes?: number };
  erro?: string;
}

export default function TendenciasPage() {
  const [entrada, setEntrada] = useState('');
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [bloqueadas, setBloqueadas] = useState<string[]>([]);
  const [cota, setCota] = useState<{ usadas: number; restantes: number } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');

  async function buscar() {
    const tags = entrada.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean).slice(0, 10);
    if (tags.length === 0) return;

    setBuscando(true);
    setErro('');
    try {
      const r = await api.searchTrends(tags);
      setResultados(r.resultados);
      setBloqueadas(r.bloqueadas);
      setCota(r.cota);
    } catch (err: any) {
      setErro(err?.message || 'Falha ao buscar');
    }
    setBuscando(false);
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <TrendingUp className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Tendências
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Veja o que está em alta nas hashtags do seu nicho, para achar ideia de conteúdo.
        </p>
      </div>

      <div className="card p-5 mb-4">
        <div className="flex gap-2">
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') buscar(); }}
            placeholder="pizzaria, petrolina, delivery"
            className="input-field flex-1"
          />
          <button onClick={buscar} disabled={buscando || !entrada.trim()} className="btn-cta px-4 text-xs disabled:opacity-40">
            {buscando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" strokeWidth={2} />}
            Buscar
          </button>
        </div>

        {/* A cota precisa estar sempre visivel: e um limite semanal que, se
            estourado, tira a funcionalidade do ar por dias. */}
        {cota && (
          <div className={`mt-3 p-2.5 rounded-lg border text-[11px] ${
            cota.restantes <= 5 ? 'border-amber-500/50 bg-amber-500/[0.08] text-amber-500' : 'border-border bg-bg-main text-text-secondary'
          }`}>
            <strong>{cota.restantes} de 30</strong> hashtags novas disponíveis nesta semana.
            {cota.restantes <= 5 && ' Repetir uma tag já consultada não consome cota.'}
          </div>
        )}
        <p className="text-[10px] text-text-muted mt-2">
          O Instagram limita a <strong>30 hashtags diferentes a cada 7 dias</strong>. Consultar a mesma de novo é gratuito.
        </p>
        {erro && <p className="text-[11px] text-status-failed mt-2">{erro}</p>}
      </div>

      {bloqueadas.length > 0 && (
        <div className="card p-3 mb-3 border-amber-500/40">
          <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" strokeWidth={2} />
            <span>
              Não consultei <strong>{bloqueadas.map((t) => `#${t}`).join(', ')}</strong> para não estourar a cota da
              semana. Elas ficam para depois.
            </span>
          </p>
        </div>
      )}

      {resultados && (
        <div className="space-y-3">
          {resultados.length === 0 && (
            <div className="card p-8 text-center"><p className="text-sm text-text-secondary">Nada encontrado.</p></div>
          )}
          {resultados.map((r) => (
            <div key={r.tag} className="card p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-primary">#{r.tag}</p>
                {!r.erro && (
                  <span className="flex items-center gap-1 text-[11px] text-text-muted">
                    <Heart className="w-3 h-3" /> {r.mediaCurtidas} em média · {r.posts} posts
                  </span>
                )}
              </div>

              {r.erro ? (
                <p className="text-[11px] text-text-muted mt-1.5">{r.erro}</p>
              ) : r.topPost && (
                <div className="mt-2 p-2.5 rounded-lg bg-bg-main border border-border">
                  <p className="text-[10px] text-text-muted mb-1">Post em destaque · {r.topPost.likes} curtidas</p>
                  {r.topPost.caption && <p className="text-xs text-text-secondary">{r.topPost.caption}</p>}
                  {r.topPost.permalink && (
                    <a href={r.topPost.permalink} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1.5">
                      <ExternalLink className="w-3 h-3" /> ver no Instagram
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
