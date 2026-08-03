'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gauge, Loader2, AlertOctagon, AlertTriangle, CheckCircle2, RefreshCw, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Cockpit: a carteira inteira numa tela, pior primeiro.
 *
 * A ORDEM É O PRODUTO. Uma lista alfabética de 40 marcas não ajuda ninguém;
 * o que ajuda é "estas três precisam de você hoje".
 *
 * A nota de saúde NÃO aparece como número: ela existe para ordenar. Mostrar
 * "72/100" convidaria o usuário a discutir o número em vez de resolver o
 * problema que está escrito logo abaixo.
 */

interface Linha {
  id: string; nome: string; nota: number; gravidade: 'critico' | 'atencao' | 'ok';
  agendados7d: number; ultimaPublicacao: string | null;
  sinais: Array<{ tipo: string; gravidade: 'critico' | 'atencao' | 'ok'; texto: string }>;
}

const ESTILO = {
  critico: { borda: 'border-status-failed/50', bg: 'bg-status-failed/[0.06]', texto: 'text-status-failed', Icone: AlertOctagon },
  atencao: { borda: 'border-amber-500/50', bg: 'bg-amber-500/[0.06]', texto: 'text-amber-500', Icone: AlertTriangle },
  ok: { borda: 'border-border', bg: '', texto: 'text-status-published', Icone: CheckCircle2 },
} as const;

/** Para onde o usuário vai para resolver cada tipo de problema. */
const ACAO: Record<string, { texto: string; href: string }> = {
  grade_vazia: { texto: 'Planejar a semana', href: '/autopilot' },
  grade_magra: { texto: 'Planejar a semana', href: '/autopilot' },
  sem_conta: { texto: 'Conectar Instagram', href: '/settings' },
  token_vencido: { texto: 'Reconectar Instagram', href: '/settings' },
  token_expirando: { texto: 'Reconectar Instagram', href: '/settings' },
  aprovacao_parada: { texto: 'Ver aprovações', href: '/posts' },
  falha_publicacao: { texto: 'Ver o que falhou', href: '/posts' },
  silencio: { texto: 'Criar um post', href: '/posts/new' },
};

export default function CockpitPage() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [resumo, setResumo] = useState<{ total: number; criticas: number; atencao: number; ok: number } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  async function carregar() {
    setCarregando(true);
    setErro('');
    try {
      const r = await api.cockpit();
      setLinhas(r.linhas as Linha[]);
      setResumo(r.resumo);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar');
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  if (carregando) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="flex items-center gap-2 text-page-title text-text-primary">
            <Gauge className="w-6 h-6 text-primary" strokeWidth={1.5} />
            Cockpit
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Suas marcas em ordem de urgência. As de cima precisam de você hoje.
          </p>
        </div>
        <button onClick={carregar} className="btn-ghost text-xs flex-shrink-0">
          <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      {resumo && resumo.total > 0 && (
        <div className="flex gap-2 mb-4">
          <div className="card flex-1 p-3 text-center">
            <p className="text-2xl font-extrabold text-status-failed">{resumo.criticas}</p>
            <p className="text-[10px] text-text-muted uppercase tracking-wide">precisam agora</p>
          </div>
          <div className="card flex-1 p-3 text-center">
            <p className="text-2xl font-extrabold text-amber-500">{resumo.atencao}</p>
            <p className="text-[10px] text-text-muted uppercase tracking-wide">de olho</p>
          </div>
          <div className="card flex-1 p-3 text-center">
            <p className="text-2xl font-extrabold text-status-published">{resumo.ok}</p>
            <p className="text-[10px] text-text-muted uppercase tracking-wide">tranquilas</p>
          </div>
        </div>
      )}

      {linhas.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-text-secondary">Nenhuma empresa cadastrada ainda.</p>
          <Link href="/brands" className="btn-cta mt-4 text-xs inline-flex">Cadastrar empresa</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {linhas.map((l) => {
            const e = ESTILO[l.gravidade];
            return (
              <div key={l.id} className={`card p-4 ${e.borda} ${e.bg}`}>
                <div className="flex items-center gap-2.5">
                  <e.Icone className={`w-4 h-4 flex-shrink-0 ${e.texto}`} strokeWidth={2.5} />
                  <p className="flex-1 min-w-0 text-sm font-bold text-text-primary truncate">{l.nome}</p>
                  {l.gravidade === 'ok' && (
                    <span className="text-[10px] text-text-muted flex-shrink-0">
                      {l.agendados7d} agendados
                    </span>
                  )}
                </div>

                {l.sinais.length === 0 ? (
                  <p className="text-[11px] text-text-secondary mt-1.5 ml-6.5">
                    Tudo em dia. Grade cheia e nada esperando você.
                  </p>
                ) : (
                  <div className="mt-2 ml-6.5 space-y-1.5">
                    {l.sinais.map((s, i) => {
                      const acao = ACAO[s.tipo];
                      return (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <p className={`text-[11px] ${s.gravidade === 'critico' ? 'text-status-failed' : 'text-amber-500'}`}>
                            {s.texto}
                          </p>
                          {/* Cada problema leva direto à ação que resolve.
                              Sem isso o cockpit vira só uma lista de queixas. */}
                          {acao && (
                            <Link href={acao.href} className="flex items-center gap-0.5 text-[10px] font-semibold text-primary hover:underline flex-shrink-0">
                              {acao.texto}
                              <ArrowRight className="w-2.5 h-2.5" strokeWidth={3} />
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
