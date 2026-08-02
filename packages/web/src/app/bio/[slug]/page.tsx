'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * Pagina publica de link-in-bio.
 *
 * O Instagram so deixa um link na bio; aqui ele vira varios. Quem chega
 * veio de um post e quer clicar em algo — nada de menu, login ou layout do
 * app.
 */

interface Link { id: string; label: string; url: string }

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

export default function BioPage() {
  const params = useParams();
  const slug = String(params?.slug || '');

  const [dados, setDados] = useState<{
    name: string; description?: string; primaryColor?: string; logoUrl?: string; links: Link[];
  } | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/bio/${slug}`)
      .then((r) => r.json())
      .then((j) => { if (j.success) setDados(j.data); })
      .catch(() => {})
      .finally(() => setCarregando(false));
  }, [slug]);

  /**
   * Conta o clique e leva ao destino.
   *
   * A navegacao acontece mesmo se a contagem falhar: perder uma estatistica
   * e aceitavel, perder o clique do cliente nao.
   */
  async function abrir(link: Link) {
    try {
      await fetch(`${BASE}/api/bio/${slug}/click/${link.id}`, { method: 'POST' });
    } catch { /* segue para o destino do mesmo jeito */ }
    window.location.href = link.url;
  }

  if (carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-main">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!dados) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-main px-6 text-center">
        <p className="text-sm text-text-secondary">Página não encontrada.</p>
      </div>
    );
  }

  const cor = dados.primaryColor || '#7c3aed';

  return (
    <div className="min-h-screen bg-bg-main px-5 py-12">
      <div className="max-w-sm mx-auto text-center">
        {dados.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dados.logoUrl}
            alt={dados.name}
            className="w-20 h-20 rounded-full object-cover mx-auto mb-4 border-2"
            style={{ borderColor: cor }}
          />
        )}

        <h1 className="text-lg font-bold text-text-primary">{dados.name}</h1>
        {dados.description && (
          <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{dados.description}</p>
        )}

        <div className="mt-7 space-y-2.5">
          {dados.links.length === 0 ? (
            <p className="text-xs text-text-muted">Nenhum link publicado ainda.</p>
          ) : (
            dados.links.map((l) => (
              <button
                key={l.id}
                onClick={() => abrir(l)}
                className="w-full py-3.5 px-4 rounded-xl text-sm font-semibold text-white transition-transform active:scale-[0.98]"
                style={{ background: cor }}
              >
                {l.label}
              </button>
            ))
          )}
        </div>

        <p className="mt-10 text-[10px] text-text-muted">feito com DisparaAI</p>
      </div>
    </div>
  );
}
