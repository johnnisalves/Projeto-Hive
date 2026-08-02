'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, X, MessageCircle, Loader2, CalendarDays } from 'lucide-react';

/**
 * Portal de aprovacao — a tela que o CLIENTE da agencia abre.
 *
 * Sem login e sem menu: quem chega aqui veio por um link e precisa fazer
 * uma coisa so, que e aprovar ou pedir ajuste. Por isso a pagina nao usa o
 * layout do app nem depende de token de sessao.
 */

type Estado = 'none' | 'pending' | 'approved' | 'rejected';

interface Feedback { message: string; author?: string; fromOwner: boolean; createdAt: string }

interface Post {
  id: string;
  caption?: string;
  hashtags: string[];
  imageUrl?: string;
  images: { imageUrl: string; order: number }[];
  videoUrl?: string;
  mediaType: string;
  scheduledAt?: string;
  approvalState: Estado;
  feedbacks: Feedback[];
}

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

export default function PortalAprovacao() {
  const params = useParams();
  const token = String(params?.token || '');

  const [brand, setBrand] = useState<{ name: string; primaryColor?: string; logoUrl?: string } | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [autor, setAutor] = useState('');
  const [comentario, setComentario] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string>('');

  async function carregar() {
    try {
      const r = await fetch(`${BASE}/api/approval/${token}`);
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j?.error || 'Link inválido ou revogado');
      setBrand(j.data.brand);
      setPosts(j.data.posts);
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao abrir o portal');
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  async function decidir(postId: string, state?: Estado, message?: string) {
    setEnviando(postId);
    try {
      const r = await fetch(`${BASE}/api/approval/${token}/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, message, author: autor || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j?.error || 'Falha ao enviar');
      setComentario((c) => ({ ...c, [postId]: '' }));
      await carregar();
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao enviar');
    }
    setEnviando('');
  }

  if (carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-main">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (erro && !brand) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-main px-6">
        <div className="text-center">
          <h1 className="text-lg font-bold text-text-primary">Não consegui abrir</h1>
          <p className="text-sm text-text-secondary mt-2">{erro}</p>
          <p className="text-xs text-text-muted mt-4">Peça um link novo a quem cuida das suas redes.</p>
        </div>
      </div>
    );
  }

  const pendentes = posts.filter((p) => p.approvalState !== 'approved').length;

  return (
    <div className="min-h-screen bg-bg-main">
      <header className="border-b border-border px-5 py-4" style={{ borderTopColor: brand?.primaryColor, borderTopWidth: 3 }}>
        <div className="max-w-2xl mx-auto">
          <h1 className="text-lg font-bold text-text-primary">{brand?.name}</h1>
          <p className="text-xs text-text-secondary mt-0.5">
            {posts.length === 0
              ? 'Nenhum post aguardando revisão.'
              : `${posts.length} posts para revisar · ${pendentes} aguardando você`}
          </p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-5">
        {posts.length > 0 && (
          <input
            value={autor}
            onChange={(e) => setAutor(e.target.value)}
            placeholder="Seu nome (aparece nos comentários)"
            className="input-field text-sm"
          />
        )}

        {posts.map((post) => {
          const capa = post.imageUrl || post.images[0]?.imageUrl;
          const aprovado = post.approvalState === 'approved';
          const rejeitado = post.approvalState === 'rejected';

          return (
            <article key={post.id} className={`card overflow-hidden ${
              aprovado ? 'border-emerald-500/40' : rejeitado ? 'border-amber-500/40' : ''
            }`}>
              {capa && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={capa} alt="" className="w-full max-h-[26rem] object-cover" />
              )}

              <div className="p-4">
                {post.scheduledAt && (
                  <p className="flex items-center gap-1.5 text-[11px] text-text-muted mb-2">
                    <CalendarDays className="w-3 h-3" strokeWidth={2} />
                    {new Date(post.scheduledAt).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                )}

                {post.caption && <p className="text-sm text-text-primary whitespace-pre-wrap">{post.caption}</p>}
                {post.hashtags.length > 0 && (
                  <p className="text-xs text-primary mt-2">{post.hashtags.map((h) => `#${h}`).join(' ')}</p>
                )}

                {post.feedbacks.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {post.feedbacks.map((f, i) => (
                      <div key={i} className="text-xs p-2 rounded-lg bg-bg-main border border-border">
                        <span className="font-semibold text-text-primary">
                          {f.fromOwner ? 'Equipe' : (f.author || 'Cliente')}
                        </span>
                        <span className="text-text-secondary"> · {f.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    onClick={() => decidir(post.id, 'approved')}
                    disabled={enviando === post.id}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-btn text-xs font-bold transition-all ${
                      aprovado ? 'bg-emerald-500 text-white' : 'border border-border text-text-secondary hover:border-emerald-500'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                    {aprovado ? 'Aprovado' : 'Aprovar'}
                  </button>

                  <button
                    onClick={() => decidir(post.id, 'rejected')}
                    disabled={enviando === post.id}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-btn text-xs font-bold transition-all ${
                      rejeitado ? 'bg-amber-500 text-white' : 'border border-border text-text-secondary hover:border-amber-500'
                    }`}
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                    {rejeitado ? 'Ajuste pedido' : 'Pedir ajuste'}
                  </button>
                </div>

                <div className="flex gap-2 mt-2.5">
                  <input
                    value={comentario[post.id] || ''}
                    onChange={(e) => setComentario((c) => ({ ...c, [post.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && comentario[post.id]?.trim()) {
                        decidir(post.id, undefined, comentario[post.id]);
                      }
                    }}
                    placeholder="Escrever um comentário..."
                    className="input-field text-xs flex-1"
                  />
                  <button
                    onClick={() => decidir(post.id, undefined, comentario[post.id])}
                    disabled={enviando === post.id || !comentario[post.id]?.trim()}
                    className="btn-ghost px-3 text-xs disabled:opacity-40"
                  >
                    {enviando === post.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </article>
          );
        })}

        {erro && <p className="text-xs text-status-failed text-center">{erro}</p>}
      </main>
    </div>
  );
}
