'use client';

import { useEffect, useState } from 'react';
import { Gauge, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '../../../lib/api';

/**
 * Nota prevista de engajamento, antes de publicar.
 *
 * A nota sozinha não ensina nada: o que muda o comportamento é o MOTIVO.
 * Por isso os sinais aparecem sempre, ordenados pelo que mais pesa.
 *
 * Quando não há histórico suficiente, mostramos o porquê em vez de um
 * número inventado — uma nota em cima de ruído destrói a confiança na
 * ferramenta inteira.
 */

interface Props {
  caption: string;
  hashtags: string[];
  publishMode?: string;
  mediaType?: string;
  scheduledAt?: string;
}

export default function NotaPrevista({ caption, hashtags, publishMode, mediaType, scheduledAt }: Props) {
  const [dados, setDados] = useState<{ nota: number | null; motivos: Array<{ texto: string; impacto: number }>; base: string } | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (caption.trim().length < 10) { setDados(null); return; }

    // Espera a digitação parar: sem isso a rota seria chamada a cada tecla,
    // e cada chamada lê 60 posts do banco.
    const t = setTimeout(() => {
      setCarregando(true);
      api.notaDoPost({ caption, hashtags, publishMode, mediaType, scheduledAt })
        .then(setDados)
        .catch(() => setDados(null))
        .finally(() => setCarregando(false));
    }, 900);

    return () => clearTimeout(t);
  }, [caption, hashtags, publishMode, mediaType, scheduledAt]);

  if (!dados && !carregando) return null;

  const cor = (n: number) => (n >= 70 ? 'text-status-published' : n >= 45 ? 'text-amber-500' : 'text-status-failed');
  const fundo = (n: number) => (n >= 70 ? 'bg-status-published' : n >= 45 ? 'bg-amber-500' : 'bg-status-failed');

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Gauge className="w-4 h-4 text-primary" strokeWidth={2} />
        <span className="text-xs font-bold text-text-primary">Como esse post tende a performar</span>
        {carregando && <Loader2 className="w-3 h-3 animate-spin text-text-muted" />}
      </div>

      {dados?.nota == null ? (
        <p className="text-[11px] text-text-secondary">{dados?.base}</p>
      ) : dados && (
        <>
          <div className="flex items-center gap-3">
            <span className={`text-3xl font-extrabold ${cor(dados.nota)}`}>{dados.nota}</span>
            <div className="flex-1">
              <div className="h-1.5 rounded-full bg-bg-main overflow-hidden">
                <div className={`h-full rounded-full transition-all ${fundo(dados.nota)}`} style={{ width: `${dados.nota}%` }} />
              </div>
              <p className="text-[10px] text-text-muted mt-1">{dados.base}</p>
            </div>
          </div>

          <div className="space-y-1 mt-3">
            {dados.motivos.map((m, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] text-text-secondary">
                {m.impacto > 0
                  ? <TrendingUp className="w-3 h-3 text-status-published flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                  : <TrendingDown className="w-3 h-3 text-status-failed flex-shrink-0 mt-0.5" strokeWidth={2.5} />}
                {m.texto}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
