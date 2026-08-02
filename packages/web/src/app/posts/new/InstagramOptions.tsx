'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { AtSign, Users, MapPin, Accessibility, Music, Sparkles, Handshake, X, Upload, Loader2, ChevronDown, Hash } from 'lucide-react';
import { api } from '../../../lib/api';
import MentionInput from './MentionInput';
import PlaceInput from './PlaceInput';

/**
 * Recursos extras de publicacao do Instagram.
 *
 * Tudo aqui vira parametro do container de midia da API do Meta. O que o
 * Instagram tem no app mas a API NAO expoe — musica do catalogo, filtros,
 * efeitos e stickers de Stories — nao aparece nesta tela de proposito: nao
 * existe endpoint para isso. A trilha sonora daqui e outra coisa: e um audio
 * seu, mixado no video pelo servidor antes do upload.
 */

// A logica pura (tipos, padrao e montagem do payload) vive em ig-options.ts
// para poder ser testada sem React. Reexportamos para nao quebrar os imports.
import { IgOptions, UserTag, defaultIgOptions, igOptionsToPayload } from './ig-options';
export type { IgOptions, UserTag };
export { defaultIgOptions, igOptionsToPayload };

interface Props {
  value: IgOptions;
  onChange: (next: IgOptions) => void;
  images: { url: string }[];
  activeImageIndex: number;
  /** Reels/video liberam capa, nome do audio e a opcao de aparecer no Feed. */
  isVideo?: boolean;
  isStories?: boolean;
}

/** Campo de lista com chips (colaboradores, patrocinadores). */
function ChipInput({
  items, onAdd, onRemove, placeholder, max, prefix = '@', mention = true,
}: {
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
  placeholder: string;
  max: number;
  prefix?: string;
  /** Liga o autocomplete da agenda. Desligado para campos que nao sao @. */
  mention?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const full = items.length >= max;

  function commit() {
    const v = draft.trim().replace(/^@/, '');
    if (!v || full || items.includes(v)) { setDraft(''); return; }
    onAdd(v);
    setDraft('');
  }

  /** Vindo do autocomplete: o @ ja chega limpo. */
  function commitPicked(username: string) {
    const v = username.trim().replace(/^@/, '');
    if (!v || full || items.includes(v)) { setDraft(''); return; }
    onAdd(v);
    setDraft('');
  }

  return (
    <>
      <div className="flex gap-2">
        {mention ? (
          <MentionInput
            value={draft}
            onChange={setDraft}
            onSubmit={commitPicked}
            disabled={full}
            placeholder={full ? `Limite de ${max} atingido` : placeholder}
            className="flex-1"
          />
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
            disabled={full}
            placeholder={full ? `Limite de ${max} atingido` : placeholder}
            className="input-field flex-1 disabled:opacity-50"
          />
        )}
        <button type="button" onClick={commit} disabled={full || !draft.trim()} className="btn-ghost px-3 text-xs disabled:opacity-40">
          Adicionar
        </button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {items.map((item, i) => (
            <span key={item} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-badge bg-primary/10 text-primary font-medium">
              {prefix}{item}
              <button type="button" onClick={() => onRemove(i)} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export default function InstagramOptions({ value, onChange, images, activeImageIndex, isVideo, isStories }: Props) {
  // Aberto por padrao: fechado, o painel virava uma linha fina que ninguem acha.
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [altLoading, setAltLoading] = useState(false);

  /** Descreve a arte para leitor de tela usando a IA que ja ve a imagem. */
  async function gerarAltText() {
    const url = images[activeImageIndex]?.url;
    if (!url) return;
    setAltLoading(true);
    try {
      const r = await api.generateAltText(url);
      set({ altText: r.altText });
    } catch {
      // Silencioso de proposito: o campo continua editavel a mao, e um
      // alerta aqui interromperia o preenchimento do post por um extra.
    }
    setAltLoading(false);
  }
  const audioInputRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<IgOptions>) => onChange({ ...value, ...patch });

  const activeImage = images[activeImageIndex];
  const tagsHere = value.userTags.filter((t) => t.imageIndex === activeImageIndex);
  const activeCount = [
    value.userTags.length,
    value.collaborators.length,
    value.locationId.trim() ? 1 : 0,
    value.altText.trim() ? 1 : 0,
    value.audioUrl ? 1 : 0,
    value.isAiGenerated ? 1 : 0,
    value.isPaidPartnership || value.sponsorIds.length ? 1 : 0,
    !value.shareToFeed ? 1 : 0,
  ].reduce((a: number, b: number) => a + b, 0);

  /** Converte o clique na imagem em coordenada relativa (0.0–1.0) para a API. */
  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPending({ x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) });
    setPendingName('');
  }

  /** `picked` vem do autocomplete; sem ele, usa o que foi digitado. */
  function confirmTag(picked?: string) {
    const username = (picked ?? pendingName).trim().replace(/^@/, '');
    if (!username || !pending) return;
    set({ userTags: [...value.userTags, { username, x: pending.x, y: pending.y, imageIndex: activeImageIndex }] });
    setPending(null);
    setPendingName('');
  }

  function removeTag(tag: UserTag) {
    set({ userTags: value.userTags.filter((t) => t !== tag) });
  }

  async function handleAudioPick(file: File) {
    setAudioUploading(true);
    setAudioError('');
    try {
      const r = await api.uploadAudio(file);
      set({ audioUrl: r.audioUrl, audioFileName: r.fileName });
    } catch (err: unknown) {
      setAudioError(err instanceof Error ? err.message : 'Falha ao enviar o audio');
    }
    setAudioUploading(false);
  }

  return (
    <div className="card p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between"
      >
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          Marcar pessoas, colaboradores, música e mais
          {activeCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-badge bg-primary/10 text-primary text-[10px] normal-case tracking-normal">
              {activeCount} ativo{activeCount > 1 ? 's' : ''}
            </span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          {/* ---------- Marcar pessoas ---------- */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
              <AtSign className="w-3.5 h-3.5" strokeWidth={2} /> Marcar pessoas
            </label>
            {activeImage ? (
              <>
                <p className="text-[10px] text-text-muted mb-2">
                  Clique na foto onde a marcação deve aparecer, depois digite o @.
                  {images.length > 1 && ' As marcações são por foto do carrossel.'}
                </p>
                <div className="relative inline-block max-w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeImage.url}
                    alt="Clique para marcar uma pessoa"
                    onClick={handleImageClick}
                    className="max-h-64 rounded-lg border border-border cursor-crosshair"
                  />
                  {tagsHere.map((t, i) => (
                    <button
                      key={`${t.username}-${i}`}
                      type="button"
                      onClick={() => removeTag(t)}
                      title={`Remover @${t.username}`}
                      style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/75 text-white text-[10px] font-medium hover:bg-red-500"
                    >
                      @{t.username}
                      <X className="w-2.5 h-2.5" />
                    </button>
                  ))}
                  {pending && (
                    <div
                      style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}
                      className="absolute -translate-x-1/2 translate-y-1 z-10 flex gap-1 bg-bg-card border border-border rounded-lg p-1 shadow-lg"
                    >
                      <MentionInput
                        compact
                        autoFocus
                        value={pendingName}
                        onChange={setPendingName}
                        onSubmit={(u) => confirmTag(u)}
                        placeholder="usuario"
                      />
                      <button type="button" onClick={() => confirmTag()} className="px-1.5 text-[11px] font-semibold text-primary">OK</button>
                      <button type="button" onClick={() => setPending(null)} className="px-1 text-text-muted"><X className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Sem imagem para clicar (video, por exemplo): marca por lista.
                 A API exige x/y mesmo assim, entao centralizamos o selo. */
              <>
                <p className="text-[10px] text-text-muted mb-2">
                  {isVideo ? 'No vídeo a marcação não tem posição — entra pela lista.' : 'Suba uma arte para marcar clicando na foto.'}
                </p>
                <ChipInput
                  items={value.userTags.map((t) => t.username)}
                  onAdd={(v) => set({ userTags: [...value.userTags, { username: v, x: 0.5, y: 0.5, imageIndex: 0 }] })}
                  onRemove={(i) => set({ userTags: value.userTags.filter((_, x) => x !== i) })}
                  placeholder="usuario_para_marcar"
                  max={20}
                />
              </>
            )}
          </div>

          {/* ---------- Colaboradores ---------- */}
          {!isStories && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                <Users className="w-3.5 h-3.5" strokeWidth={2} /> Colaboradores
              </label>
              <p className="text-[10px] text-text-muted mb-2">
                O post aparece no perfil de todos. Até 3 — cada um recebe um convite para aceitar.
              </p>
              <ChipInput
                items={value.collaborators}
                onAdd={(v) => set({ collaborators: [...value.collaborators, v] })}
                onRemove={(i) => set({ collaborators: value.collaborators.filter((_, x) => x !== i) })}
                placeholder="usuario_do_parceiro"
                max={3}
              />
            </div>
          )}

          {/* ---------- Localizacao ---------- */}
          {!isStories && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                <MapPin className="w-3.5 h-3.5" strokeWidth={2} /> Localização
              </label>
              <PlaceInput value={value.locationId} onChange={(id) => set({ locationId: id })} />
              <p className="text-[10px] text-text-muted mt-1.5">
                Digite o nome e escolha na lista. O Meta exige o ID interno do local — a busca traduz para você.
              </p>
            </div>
          )}

          {/* ---------- Texto alternativo ---------- */}
          {!isVideo && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
                <Accessibility className="w-3.5 h-3.5" strokeWidth={2} /> Texto alternativo
              </label>
              <textarea
                value={value.altText}
                onChange={(e) => set({ altText: e.target.value.slice(0, 1000) })}
                rows={2}
                maxLength={1000}
                placeholder="Descreva a imagem para quem usa leitor de tela..."
                className="input-field resize-none"
              />
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[10px] text-text-muted">
                  {value.altText.length}/1000 · imagem única ou 1ª foto do carrossel.
                </p>
                {/* A IA ja enxerga a arte: acessibilidade praticamente de
                    graca, e o Instagram usa o alt_text para entender o
                    conteudo, o que ajuda o alcance. */}
                {images[activeImageIndex]?.url && (
                  <button
                    type="button"
                    onClick={gerarAltText}
                    disabled={altLoading}
                    className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                  >
                    {altLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" strokeWidth={2.5} />}
                    {altLoading ? 'Descrevendo...' : 'Descrever com IA'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ---------- Opcoes de Reels ---------- */}
          {isVideo && !isStories && (
            <div className="space-y-3">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Reels</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.shareToFeed}
                  onChange={(e) => set({ shareToFeed: e.target.checked })}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-xs text-text-secondary">Mostrar também no Feed (desmarcado: só na aba Reels)</span>
              </label>
              <div>
                <input
                  value={value.audioName}
                  onChange={(e) => set({ audioName: e.target.value.slice(0, 100) })}
                  placeholder="Nome do áudio original (ex: Trilha da campanha)"
                  className="input-field"
                />
                <p className="text-[10px] text-text-muted mt-1.5">O Instagram só deixa nomear o áudio uma vez — depois não dá para trocar.</p>
              </div>
              <input
                value={value.coverUrl}
                onChange={(e) => set({ coverUrl: e.target.value })}
                placeholder="URL da capa do Reels (opcional)"
                className="input-field"
              />
            </div>
          )}

          {/* ---------- Trilha sonora ---------- */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
              <Music className="w-3.5 h-3.5" strokeWidth={2} /> Trilha sonora
            </label>
            {!isVideo && !isStories && (
              /* Foto com trilha: o Instagram nao aceita audio em post de
                 imagem, entao a foto vira video e sai como Reels. Precisa
                 estar escrito — o post muda de formato. */
              <p className="text-[10px] text-text-muted mb-2 p-2 rounded bg-primary/[0.06] border border-primary/20">
                Foto não carrega áudio no Instagram. Com trilha escolhida, a imagem vira um
                <strong> vídeo de até 60s</strong> e o post sai como <strong>Reels</strong>.
              </p>
            )}
            {isStories ? (
              <div className="p-3 rounded-lg bg-bg-main border border-dashed border-border">
                <p className="text-xs text-text-secondary">
                  Stories não aceita trilha por aqui. Use <Link href="/posts/videos" className="text-primary hover:underline font-semibold">Reels / Vídeos</Link> para publicar vídeo com som.
                </p>
              </div>
            ) : (
            <>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,audio/aac,audio/mp4,audio/x-m4a,audio/ogg"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleAudioPick(e.target.files[0]); e.target.value = ''; }}
              />
              {value.audioUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-bg-main border border-border">
                    <Music className="w-4 h-4 text-primary flex-shrink-0" strokeWidth={1.5} />
                    <span className="text-xs text-text-secondary truncate flex-1">{value.audioFileName || 'Áudio'}</span>
                    <button type="button" onClick={() => set({ audioUrl: '', audioFileName: '' })} className="p-1 rounded hover:bg-bg-card">
                      <X className="w-3.5 h-3.5 text-text-muted" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-text-muted w-14">Volume</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={value.audioVolume}
                      onChange={(e) => set({ audioVolume: Number(e.target.value) })}
                      className="flex-1 accent-primary"
                    />
                    <span className="text-[10px] text-text-muted tabular-nums w-8">{value.audioVolume}%</span>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  disabled={audioUploading}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-xs font-medium text-text-secondary hover:border-primary hover:text-primary transition-colors"
                >
                  {audioUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" strokeWidth={2} />}
                  {audioUploading ? 'Enviando...' : 'Escolher áudio (MP3, WAV, M4A)'}
                </button>
              )}
              {audioError && <p className="text-[10px] text-status-failed mt-1.5">{audioError}</p>}
              <p className="text-[10px] text-text-muted mt-2">
                O áudio é mixado no vídeo antes de publicar — é o único jeito de sair com som,
                já que a API não dá acesso ao catálogo de músicas do Instagram.
                <strong className="block mt-1">Use áudio livre ou licenciado por você: música comercial pode ser silenciada pelo Instagram.</strong>
              </p>
            </>
            )}
          </div>

          {/* ---------- Hashtags no 1o comentario ---------- */}
          {!isStories && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={value.hashtagsFirstComment}
                onChange={(e) => set({ hashtagsFirstComment: e.target.checked })}
                className="w-4 h-4 mt-0.5 accent-primary"
              />
              <span className="text-xs text-text-secondary">
                <span className="flex items-center gap-1.5 font-semibold text-text-primary">
                  <Hash className="w-3.5 h-3.5" strokeWidth={2} /> Hashtags no 1º comentário
                </span>
                Deixa a legenda limpa no feed sem perder o alcance das tags.
              </span>
            </label>
          )}

          {/* ---------- Conteudo gerado por IA ---------- */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value.isAiGenerated}
              onChange={(e) => set({ isAiGenerated: e.target.checked })}
              className="w-4 h-4 mt-0.5 accent-primary"
            />
            <span className="text-xs text-text-secondary">
              <span className="flex items-center gap-1.5 font-semibold text-text-primary">
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2} /> Conteúdo gerado por IA
              </span>
              Marque quando a arte vier do gerador de imagem. É exigência de política do Meta.
            </span>
          </label>

          {/* ---------- Parceria paga ---------- */}
          {!isStories && (
            <div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.isPaidPartnership}
                  onChange={(e) => set({ isPaidPartnership: e.target.checked })}
                  className="w-4 h-4 mt-0.5 accent-primary"
                />
                <span className="text-xs text-text-secondary">
                  <span className="flex items-center gap-1.5 font-semibold text-text-primary">
                    <Handshake className="w-3.5 h-3.5" strokeWidth={2} /> Parceria paga
                  </span>
                  Exibe o selo &quot;Parceria paga com...&quot; acima do post.
                </span>
              </label>
              {value.isPaidPartnership && (
                <div className="mt-2.5">
                  <ChipInput
                    items={value.sponsorIds}
                    onAdd={(v) => set({ sponsorIds: [...value.sponsorIds, v] })}
                    onRemove={(i) => set({ sponsorIds: value.sponsorIds.filter((_, x) => x !== i) })}
                    placeholder="ID do perfil patrocinador"
                    max={2}
                    prefix=""
                    mention={false}
                  />
                  <p className="text-[10px] text-text-muted mt-1.5">
                    Precisa da permissão <code>instagram_branded_content_creator</code> aprovada no App Review
                    e de conta conectada via Login do Facebook. Sem isso o Meta ignora o selo.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
