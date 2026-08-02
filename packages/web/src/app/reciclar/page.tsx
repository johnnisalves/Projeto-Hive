'use client';

import { useEffect, useState } from 'react';
import { Recycle, Loader2, Heart, MessageCircle, Sparkles, Check } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Reciclagem inteligente.
 *
 * O evergreen antigo republicava o post IGUAL. Aqui a IA reescreve a
 * legenda com outro angulo — mesma arte, texto novo — para nao cansar quem
 * ja viu.
 */

interface Sugestao {
  id: string;
  caption?: string;
  imageUrl?: string;
  publishedAt?: string;
  likes: number;
  comments: number;
  nota: number;
}

export default function ReciclarPage() {
  const [itens, setItens] = useState<Sugestao[]>([]);
  const [totalPublicados, setTotalPublicados] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [reciclando, setReciclando] = useState<string | null>(null);
  const [prontos, setProntos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.recycleSuggestions()
      .then((r) => { setItens(r.items); setTotalPublicados(r.totalPublicados); })
      .catch((e) => setErro(e?.message || 'Falha ao carregar'))
      .finally(() => setCarregando(false));
  }, []);

  async function reciclar(id: string) {
    setReciclando(id);
    setErro('');
    try {
      const r = await api.recyclePost(id);
      setProntos((p) => ({ ...p, [id]: r.caption || '' }));
    } catch (err: any) {
      setErro(err?.message || 'Falha ao reciclar');
    }
    setReciclando(null);
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <Recycle className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Reciclar conteúdo
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Seus posts que mais engajaram, com a legenda reescrita pela IA para não parecer repetição.
        </p>
      </div>

      {carregando ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : itens.length === 0 ? (
        <div className="card p-8 text-center">
          {/* Distinguir os dois casos: dizer "sem conteudo bom" para quem
              acabou de comecar seria injusto e confuso. */}
          <p className="text-sm text-text-secondary">
            {totalPublicados === 0
              ? 'Você ainda não tem posts publicados pelo DisparaAI.'
              : 'Nenhum post pronto para reciclar ainda — eles precisam ter pelo menos 60 dias.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {itens.map((p) => (
            <div key={p.id} className="card p-4 flex gap-3">
              {p.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 text-[11px] text-text-muted">
                  <span className="flex items-center gap-1"><Heart className="w-3 h-3" /> {p.likes}</span>
                  <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" /> {p.comments}</span>
                  {p.publishedAt && <span>{new Date(p.publishedAt).toLocaleDateString('pt-BR')}</span>}
                </div>
                <p className="text-xs text-text-secondary mt-1 line-clamp-2">{p.caption || '(sem legenda)'}</p>

                {prontos[p.id] !== undefined ? (
                  <div className="mt-2 p-2.5 rounded-lg bg-emerald-500/[0.08] border border-emerald-500/30">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                      <Check className="w-3 h-3" strokeWidth={3} /> Rascunho criado
                    </p>
                    {prontos[p.id] && <p className="text-xs text-text-secondary mt-1">{prontos[p.id]}</p>}
                  </div>
                ) : (
                  <button
                    onClick={() => reciclar(p.id)}
                    disabled={reciclando === p.id}
                    className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                  >
                    {reciclando === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" strokeWidth={2.5} />}
                    {reciclando === p.id ? 'Reescrevendo...' : 'Reciclar com legenda nova'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {erro && <p className="text-xs text-status-failed mt-3 text-center">{erro}</p>}
    </div>
  );
}
