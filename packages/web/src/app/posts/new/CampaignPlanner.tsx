'use client';

import { useEffect, useState } from 'react';
import { Layers, CalendarRange, Sparkles, Loader2, Send, X, Lightbulb } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Cadence, cadenceLabel, buildCampaignSchedule, campaignSpanDays, formatSlot, toDatetimeLocal,
  slotsFor, recommendCadence, MAX_CADENCE,
} from './campaign';

/**
 * Plano de divulgacao: varias imagens viram varios posts agendados.
 *
 * Aparece quando ha 2+ imagens. O usuario escolhe entre publicar tudo
 * junto (carrossel, 1 post) ou espalhar no tempo (campanha, N posts).
 *
 * A geracao de legenda roda AQUI, no navegador, uma imagem por vez: a IA
 * enxerga cada arte e o usuario acompanha o progresso. Fazer isso no
 * servidor deixaria uma requisicao pendurada por minutos.
 */

interface Item {
  imageUrl: string;
  caption: string;
  hashtags: string;
  scheduledAt: string; // datetime-local
}

interface Props {
  images: { url: string }[];
  brandId?: string;
  platforms: string[];
  aspectRatio: string;
  /** Fecha o planejador e volta para o modo carrossel. */
  onCancel: () => void;
  onDone: (created: number) => void;
}

export default function CampaignPlanner({ images, brandId, platforms, aspectRatio, onCancel, onDone }: Props) {
  // Comeca no ritmo recomendado para a quantidade de imagens, em vez de um
  // numero fixo: assim quem nao quer pensar so aperta o botao.
  const recomendado = recommendCadence(images.length);
  const [cadence, setCadence] = useState<Cadence>(recomendado.perDay);
  const [items, setItems] = useState<Item[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const previewDates = buildCampaignSchedule(images.length, cadence, undefined, horasPublico);
  const spanDays = campaignSpanDays(previewDates);

  // Teto de publicacao do Instagram: 50 posts por 24h. Sem este aviso, uma
  // campanha grande falharia no meio sem o usuario entender por que.
  const [limite, setLimite] = useState<{ restantes: number; total: number; disponivel: boolean } | null>(null);
  // Horarios reais dos seguidores online. Sem eles, cai na curadoria padrao.
  const [horasPublico, setHorasPublico] = useState<number[] | undefined>(undefined);

  useEffect(() => {
    api.getPublishingLimit()
      .then((l) => setLimite(l.disponivel ? l : null))
      .catch(() => setLimite(null));
    api.getBestHours()
      .then((h) => setHorasPublico(h.disponivel && h.horas.length ? h.horas : undefined))
      .catch(() => setHorasPublico(undefined));
  }, []);

  // So alerta quando a campanha estoura hoje E o ritmo concentra posts no
  // primeiro dia — espalhada por dias, ela cabe naturalmente.
  const noPrimeiroDia = previewDates.filter(
    (d) => d.toDateString() === previewDates[0]?.toDateString(),
  ).length;
  const estoura = limite !== null && noPrimeiroDia > limite.restantes;

  /** Gera legenda para cada imagem e monta a grade de revisao. */
  async function planCampaign() {
    setGenerating(true);
    setError('');
    const dates = buildCampaignSchedule(images.length, cadence, undefined, horasPublico);
    const next: Item[] = [];

    for (let i = 0; i < images.length; i++) {
      setProgress(`Escrevendo a legenda ${i + 1} de ${images.length}...`);
      let caption = '';
      let hashtags = '';
      try {
        const cap = await api.generateCaption('', undefined, brandId, 'engajar', platforms[0], images[i].url);
        caption = cap.caption || '';
        hashtags = (cap.hashtags || []).join(', ');
      } catch {
        // Uma legenda que falha nao pode derrubar o plano inteiro: o campo
        // fica vazio e o usuario escreve na grade.
      }
      next.push({
        imageUrl: images[i].url,
        caption,
        hashtags,
        scheduledAt: toDatetimeLocal(dates[i]),
      });
    }

    setItems(next);
    setGenerating(false);
    setProgress('');
  }

  function patch(i: number, data: Partial<Item>) {
    setItems((prev) => prev && prev.map((it, idx) => (idx === i ? { ...it, ...data } : it)));
  }

  async function confirm() {
    if (!items) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.createCampaign({
        items: items.map((it) => ({
          imageUrl: it.imageUrl,
          caption: it.caption || undefined,
          hashtags: it.hashtags.split(',').map((h) => h.trim()).filter(Boolean),
          scheduledAt: new Date(it.scheduledAt).toISOString(),
        })),
        brandId,
        platforms,
        aspectRatio,
      });
      onDone(res.created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao agendar a campanha');
    }
    setSaving(false);
  }

  // ---------- Passo 1: escolher o ritmo ----------
  if (!items) {
    return (
      <div className="card p-5 border-primary/40">
        <div className="flex items-center justify-between mb-1">
          <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
            <CalendarRange className="w-4 h-4 text-primary" strokeWidth={2} />
            Plano de divulgação
          </h3>
          <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-bg-main">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        <p className="text-xs text-text-secondary mb-4">
          {images.length} imagens viram {images.length} publicações separadas, agendadas ao longo dos dias.
        </p>

        <div className="flex items-baseline justify-between mb-2">
          <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Ritmo</label>
          <span className="text-sm font-bold text-primary">{cadenceLabel(cadence)}</span>
        </div>

        <input
          type="range"
          min={1}
          max={MAX_CADENCE}
          step={1}
          value={cadence}
          onChange={(e) => setCadence(Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Publicações por dia"
        />
        <div className="flex justify-between text-[10px] text-text-muted px-0.5">
          {Array.from({ length: MAX_CADENCE }, (_, i) => i + 1).map((n) => (
            <span key={n} className={n === cadence ? 'text-primary font-bold' : ''}>{n}</span>
          ))}
        </div>

        {/* Recomendacao: quem nao quer decidir aperta e segue. */}
        <div className={`mt-3 p-3 rounded-lg border ${
          cadence === recomendado.perDay ? 'border-primary/40 bg-primary/[0.06]' : 'border-border bg-bg-main'
        }`}>
          <div className="flex items-start gap-2">
            <Lightbulb className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" strokeWidth={2} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-text-primary font-semibold">
                Recomendado: {cadenceLabel(recomendado.perDay)}
                {cadence === recomendado.perDay && <span className="ml-1.5 text-primary font-normal">· em uso</span>}
              </p>
              <p className="text-[10px] text-text-muted mt-0.5">{recomendado.why}</p>
            </div>
            {cadence !== recomendado.perDay && (
              <button
                type="button"
                onClick={() => setCadence(recomendado.perDay)}
                className="text-[11px] font-semibold text-primary hover:underline flex-shrink-0"
              >
                Usar
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-bg-main border border-border">
          <p className="text-[11px] text-text-secondary">
            <strong>{images.length} posts</strong> em <strong>{spanDays} dia{spanDays > 1 ? 's' : ''}</strong>
            {previewDates.length > 0 && (
              <> · do dia {formatSlot(previewDates[0])} até {formatSlot(previewDates[previewDates.length - 1])}</>
            )}
          </p>
          <p className="text-[10px] text-text-muted mt-1">
            Horários: {slotsFor(cadence, horasPublico).map((h) => `${h}h`).join(' · ')}
            {horasPublico
              ? ' — calculados pelos seus seguidores online.'
              : ' — janelas de maior movimento.'}
            {' '}Você pode mudar qualquer um antes de confirmar.
          </p>
        </div>

        {limite && (
          <div className={`mt-3 p-3 rounded-lg border ${
            estoura ? 'border-amber-500/50 bg-amber-500/[0.08]' : 'border-border bg-bg-main'
          }`}>
            <p className="text-[11px] text-text-secondary">
              {estoura ? (
                <>
                  <strong className="text-text-primary">Cabem só {limite.restantes} posts hoje.</strong>{' '}
                  Você quer {noPrimeiroDia} no primeiro dia. O Instagram corta em {limite.total} por 24h —
                  baixe o ritmo ou os últimos vão falhar.
                </>
              ) : (
                <>Restam <strong className="text-text-primary">{limite.restantes} de {limite.total}</strong> publicações no Instagram nas próximas 24h.</>
              )}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={planCampaign}
          disabled={generating}
          className="btn-cta w-full justify-center mt-4 text-xs py-2.5"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" strokeWidth={2} />}
          {generating ? progress : 'Gerar legendas e montar o calendário'}
        </button>
        {error && <p className="text-[11px] text-status-failed mt-2">{error}</p>}
      </div>
    );
  }

  // ---------- Passo 2: revisar a grade ----------
  return (
    <div className="card p-5 border-primary/40">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
          <CalendarRange className="w-4 h-4 text-primary" strokeWidth={2} />
          Revisar campanha · {items.length} posts
        </h3>
        <button type="button" onClick={() => setItems(null)} className="text-[11px] text-text-muted hover:text-primary">
          Mudar ritmo
        </button>
      </div>

      <div className="space-y-3 max-h-[28rem] overflow-auto pr-1">
        {items.map((it, i) => (
          <div key={i} className="flex gap-3 p-2.5 rounded-lg bg-bg-main border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.imageUrl} alt={`Post ${i + 1}`} className="w-16 h-16 rounded object-cover flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <textarea
                value={it.caption}
                onChange={(e) => patch(i, { caption: e.target.value })}
                rows={2}
                maxLength={2200}
                placeholder={`Legenda do post ${i + 1}`}
                className="input-field text-xs resize-none py-1.5"
              />
              <div className="flex gap-1.5">
                <input
                  value={it.hashtags}
                  onChange={(e) => patch(i, { hashtags: e.target.value })}
                  placeholder="hashtags"
                  className="input-field text-[11px] py-1 flex-1"
                />
                <input
                  type="datetime-local"
                  value={it.scheduledAt}
                  onChange={(e) => patch(i, { scheduledAt: e.target.value })}
                  className="input-field text-[11px] py-1 w-44"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-[11px] text-status-failed mt-2">{error}</p>}

      <button
        type="button"
        onClick={confirm}
        disabled={saving}
        className="btn-cta w-full justify-center mt-4 text-xs py-2.5"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" strokeWidth={2} />}
        {saving ? 'Agendando...' : `Agendar ${items.length} posts`}
      </button>
    </div>
  );
}

/** Pergunta que aparece assim que ha 2+ imagens. */
export function CarouselOrCampaign({ count, onPick }: { count: number; onPick: (mode: 'carousel' | 'campaign') => void }) {
  return (
    <div className="card p-5 border-primary/40">
      <h3 className="text-sm font-bold text-text-primary mb-1">Você subiu {count} imagens</h3>
      <p className="text-xs text-text-secondary mb-4">O que quer fazer com elas?</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onPick('carousel')}
          className="p-4 rounded-btn border border-border bg-bg-card hover:border-primary/60 text-left transition-all"
        >
          <Layers className="w-5 h-5 text-primary mb-2" strokeWidth={2} />
          <span className="block text-xs font-bold text-text-primary">Carrossel</span>
          <span className="block text-[10px] text-text-muted mt-1">
            Um post só, com as {count} imagens para deslizar.
          </span>
        </button>
        <button
          type="button"
          onClick={() => onPick('campaign')}
          className="p-4 rounded-btn border border-border bg-bg-card hover:border-primary/60 text-left transition-all"
        >
          <CalendarRange className="w-5 h-5 text-primary mb-2" strokeWidth={2} />
          <span className="block text-xs font-bold text-text-primary">Plano de divulgação</span>
          <span className="block text-[10px] text-text-muted mt-1">
            {count} posts separados, com legenda própria, agendados ao longo dos dias.
          </span>
        </button>
      </div>
    </div>
  );
}
