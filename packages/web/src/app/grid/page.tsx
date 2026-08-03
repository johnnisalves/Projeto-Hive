'use client';

import { useEffect, useState } from 'react';
import { LayoutGrid, Loader2, CloudRain, Snowflake, Sun, Sparkles, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';

/**
 * Preview do feed + gatilho de clima.
 *
 * O grid mistura publicado e agendado na ordem real do Instagram. Os
 * agendados vêm primeiro porque o mais novo sobe pro topo — o post de
 * amanhã empurra o de hoje pra baixo, e é isso que o social media precisa
 * enxergar antes de aprovar a semana.
 */

interface Celula {
  id: string;
  imageUrl: string | null;
  caption: string;
  publicado: boolean;
  scheduledAt?: string;
  permalink?: string;
}

const ICONE_CLIMA = { chuva: CloudRain, frio: Snowflake, calor: Sun } as const;

export default function GridPage() {
  const router = useRouter();
  const [marcas, setMarcas] = useState<Array<{ id: string; name: string }>>([]);
  const [marcaId, setMarcaId] = useState('');
  const [celulas, setCelulas] = useState<Celula[]>([]);
  const [aviso, setAviso] = useState<string | undefined>();
  const [clima, setClima] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.listBrands()
      .then((b) => { setMarcas(b.items || []); if (b.items?.[0]) setMarcaId(b.items[0].id); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setCarregando(true);
    api.gridDoFeed(marcaId || undefined)
      .then((g) => {
        setCelulas([...g.agendados, ...g.publicados] as Celula[]);
        setAviso(g.aviso);
      })
      .catch((e) => setErro(e?.message || 'Falha ao carregar o grid'))
      .finally(() => setCarregando(false));
  }, [marcaId]);

  useEffect(() => {
    if (!marcaId) return;
    api.climaDeHoje(marcaId).then(setClima).catch(() => setClima(null));
  }, [marcaId]);

  async function usarPauta() {
    if (!clima?.pauta) return;
    await api.climaUsado(marcaId, clima.condicao).catch(() => {});
    // Leva a pauta pronta pra tela de criação em vez de só copiar o texto:
    // menos passos entre "vi a oportunidade" e "o post está agendado".
    router.push(`/posts/new?prompt=${encodeURIComponent(clima.pauta)}`);
  }

  const Icone = clima?.condicao ? ICONE_CLIMA[clima.condicao as keyof typeof ICONE_CLIMA] : null;

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <LayoutGrid className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Como vai ficar o feed
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          O que já está no ar e o que vai entrar, na ordem em que aparece no perfil.
        </p>
      </div>

      {marcas.length > 1 && (
        <select value={marcaId} onChange={(e) => setMarcaId(e.target.value)} className="input-field w-full mb-4">
          {marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )}

      {/* Oportunidade do dia: o reflexo de olhar pela janela e mudar o post. */}
      {clima?.condicao && Icone && (
        <div className={`card p-4 mb-4 ${clima.liberado ? 'border-primary/50 bg-primary/[0.06]' : ''}`}>
          <div className="flex items-start gap-3">
            <Icone className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" strokeWidth={2} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">
                {clima.detalhe} em {clima.cidade}
              </p>
              {clima.liberado ? (
                <>
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    Boa hora para um post de oportunidade — é quando o cliente decide se sai de casa.
                  </p>
                  <button onClick={usarPauta} className="btn-cta mt-2.5 text-[11px] px-3 py-1.5">
                    <Sparkles className="w-3 h-3" strokeWidth={2.5} />
                    Criar esse post
                  </button>
                </>
              ) : (
                <p className="text-[11px] text-text-muted mt-0.5">{clima.motivo}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {clima && !clima.condicao && clima.motivo && (
        <p className="text-[11px] text-text-muted mb-4">{clima.motivo}</p>
      )}

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}
      {aviso && <p className="text-[11px] text-text-muted mb-3">{aviso}</p>}

      {carregando ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : celulas.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-text-secondary">Nada publicado nem agendado ainda.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-0.5 rounded-xl overflow-hidden border border-border">
            {celulas.slice(0, 30).map((c) => (
              <div key={`${c.publicado}-${c.id}`} className="relative aspect-square bg-bg-main group">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[9px] text-text-muted p-2 text-center">
                    {c.caption || 'sem imagem'}
                  </div>
                )}

                {/* O agendado precisa se distinguir à primeira vista: sem isso
                    o preview não serve pra decidir nada. */}
                {!c.publicado && (
                  <>
                    <div className="absolute inset-0 bg-primary/25 border-2 border-primary" />
                    <div className="absolute top-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary text-white text-[8px] font-bold">
                      <Clock className="w-2 h-2" strokeWidth={3} />
                      {c.scheduledAt && new Date(c.scheduledAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    </div>
                  </>
                )}

                <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center p-2">
                  <p className="text-[9px] text-white leading-tight line-clamp-4">{c.caption}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4 mt-3">
            <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
              <span className="w-3 h-3 rounded-sm border-2 border-primary bg-primary/25" /> agendado
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
              <span className="w-3 h-3 rounded-sm bg-bg-main border border-border" /> já publicado
            </span>
          </div>
        </>
      )}
    </div>
  );
}
