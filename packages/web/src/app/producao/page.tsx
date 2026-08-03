'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Factory, Loader2, Sparkles, Clock, Image as ImageIcon, Type } from 'lucide-react';
import { api } from '../../lib/api';
import { useBrand } from '../../components/BrandProvider';

/**
 * Produção: transforma rascunho vazio em post pronto.
 *
 * O piloto automático entrega 30 rascunhos com tema e data — sem legenda,
 * sem arte, sem hashtag. Esta tela fecha esse buraco: a fila escreve e
 * desenha, e o usuário revisa em vez de criar do zero 30 vezes.
 *
 * A ordem é por urgência: o que publica antes fica pronto antes. Se só
 * metade terminar a tempo, é a metade que você precisava.
 */

const ROTULO_FALTA: Record<string, { texto: string; Icone: typeof Type }> = {
  ambos: { texto: 'legenda e arte', Icone: Sparkles },
  legenda: { texto: 'legenda', Icone: Type },
  arte: { texto: 'arte', Icone: ImageIcon },
};

export default function ProducaoPage() {
  // A empresa vem do seletor global da barra lateral: trocar de cliente ali
  // troca em todas as telas de uma vez, e a escolha sobrevive à navegação.
  const { marcaId: brandId, carregando: carregandoMarcas } = useBrand();
  const [dados, setDados] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function carregar(brand = brandId) {
    try {
      setDados(await api.producao(brand || undefined));
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar');
    }
    setCarregando(false);
  }

  // Recarrega quando a empresa muda no seletor global.
  useEffect(() => {
    if (carregandoMarcas) return;
    setCarregando(true);
    carregar(brandId);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [brandId, carregandoMarcas]);

  /**
   * Enquanto há trabalho na fila, atualiza sozinho.
   *
   * Sem isso o usuário ficaria apertando F5 para saber se terminou — e a
   * fila leva minutos, porque gera uma imagem de cada vez.
   */
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (dados?.naFila > 0) {
      timer.current = setInterval(() => carregar(), 6000);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [dados?.naFila, brandId]);

  async function produzir() {
    setEnviando(true);
    setErro('');
    setAviso('');
    try {
      const r = await api.produzir(brandId || undefined);
      if (r.motivo) setAviso(r.motivo);
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao enfileirar');
    }
    setEnviando(false);
  }

  if (carregando) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const pct = dados?.porcentagem ?? 100;
  const temTrabalho = (dados?.produziveis ?? 0) > 0;

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <Factory className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Produção
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Seus rascunhos vazios viram posts prontos — com legenda, hashtags e arte.
        </p>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}
      {aviso && <div className="card p-3 mb-4 border-amber-500/40"><p className="text-[11px] text-amber-500">{aviso}</p></div>}

      <div className="card p-5 mb-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <p className="text-sm font-bold text-text-primary">
            {dados.prontos} de {dados.total} prontos
          </p>
          <span className="text-2xl font-extrabold text-primary">{pct}%</span>
        </div>

        <div className="h-2 rounded-full bg-bg-main overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>

        {dados.naFila > 0 ? (
          <p className="flex items-center gap-1.5 text-[11px] text-primary mt-3">
            <Loader2 className="w-3 h-3 animate-spin" />
            {dados.naFila} na fila. Gero um de cada vez para não estourar o limite da IA — pode fechar a página,
            continua rodando.
          </p>
        ) : temTrabalho ? (
          <p className="text-[11px] text-text-secondary mt-3">
            {dados.produziveis} rascunho{dados.produziveis > 1 ? 's' : ''} esperando. Os que publicam antes ficam
            prontos antes.
          </p>
        ) : (
          <p className="text-[11px] text-text-secondary mt-3">
            {dados.total > 0 ? 'Tudo pronto por aqui.' : 'Nenhum rascunho pendente.'}
          </p>
        )}

        {temTrabalho && (
          <button onClick={produzir} disabled={enviando} className="btn-cta w-full mt-4 text-xs disabled:opacity-40">
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" strokeWidth={2.5} />}
            Produzir {Math.min(dados.produziveis, dados.teto)} post{dados.produziveis > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {dados.items?.length > 0 && (
        <>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Próximos da fila</p>
          <div className="space-y-1.5">
            {dados.items.map((it: any) => {
              const r = ROTULO_FALTA[it.falta] || ROTULO_FALTA.ambos;
              return (
                <div key={it.id} className="card p-3 flex items-center gap-2.5">
                  <r.Icone className="w-3.5 h-3.5 text-text-muted flex-shrink-0" strokeWidth={2} />
                  <span className="flex-1 text-[11px] text-text-secondary">falta {r.texto}</span>
                  {it.scheduledAt && (
                    <span className="flex items-center gap-1 text-[10px] text-text-muted flex-shrink-0">
                      <Clock className="w-3 h-3" />
                      {new Date(it.scheduledAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {dados.total === 0 && (
        <div className="card p-6 text-center">
          <p className="text-sm text-text-secondary">Nada para produzir ainda.</p>
          <p className="text-[11px] text-text-muted mt-1 mb-3">
            Gere um mês de conteúdo e volte aqui — a fila escreve e desenha tudo.
          </p>
          <Link href="/calendario" className="btn-cta text-xs inline-flex">Montar o calendário do mês</Link>
        </div>
      )}
    </div>
  );
}
