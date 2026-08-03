'use client';

import { useEffect, useState } from 'react';
import { Quote, Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';

/**
 * Fábrica de prova social.
 *
 * O elogio espontâneo é o conteúdo que mais converte para negócio local, e
 * o que mais morre esquecido nos comentários. Aqui ele vira post.
 *
 * O texto do depoimento NUNCA é reescrito — só limpo de @ e hashtag. Um
 * depoimento com palavra trocada é depoimento falso, e o autor pode ver o
 * post.
 */

export default function DepoimentosPage() {
  const router = useRouter();
  const [items, setItems] = useState<Array<{ id: string; texto: string; original: string }>>([]);
  const [analisados, setAnalisados] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  async function carregar() {
    setCarregando(true);
    setErro('');
    try {
      const r = await api.depoimentos();
      setItems(r.items);
      setAnalisados(r.analisados);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao buscar');
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  function virarPost(texto: string) {
    const prompt = `Arte de depoimento de cliente. O texto do depoimento, palavra por palavra, é: "${texto}". `
      + 'Não reescreva nem corrija o depoimento — ele precisa sair exatamente assim.';
    router.push(`/posts/new?prompt=${encodeURIComponent(prompt)}`);
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="flex items-center gap-2 text-page-title text-text-primary">
            <Quote className="w-6 h-6 text-primary" strokeWidth={1.5} />
            Elogios que viram post
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            O que seus clientes falaram de bom nos comentários, pronto para virar arte.
          </p>
        </div>
        <button onClick={carregar} disabled={carregando} className="btn-ghost text-xs flex-shrink-0">
          <RefreshCw className={`w-3.5 h-3.5 ${carregando ? 'animate-spin' : ''}`} strokeWidth={2} />
        </button>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      {carregando ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-text-secondary">Nenhum elogio pronto para virar depoimento.</p>
          <p className="text-[11px] text-text-muted mt-1">
            {analisados > 0
              ? `Olhei ${analisados} comentários. Um "top" solto não vira arte — preciso de uma frase.`
              : 'Conecte uma conta do Instagram para eu olhar os comentários.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <div key={d.id} className="card p-5">
              <Quote className="w-5 h-5 text-primary/40 mb-2" strokeWidth={2} />
              <p className="text-sm text-text-primary italic leading-relaxed">{d.texto}</p>
              {d.texto !== d.original && (
                <p className="text-[10px] text-text-muted mt-2">
                  Original: &ldquo;{d.original}&rdquo;
                </p>
              )}
              <button onClick={() => virarPost(d.texto)} className="btn-cta mt-3 text-[11px] px-3 py-1.5">
                <Sparkles className="w-3 h-3" strokeWidth={2.5} />
                Transformar em post
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-text-muted mt-5">
        O texto sai exatamente como o cliente escreveu — só tiro @ e hashtag. Um depoimento com palavra trocada
        é depoimento falso, e quem escreveu pode ver o post.
      </p>
    </div>
  );
}
