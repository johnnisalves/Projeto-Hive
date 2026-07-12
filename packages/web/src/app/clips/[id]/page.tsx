'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import {
  ArrowLeft, Loader2, Film, Clock, Download, Play, Check,
  Sparkles, AlertCircle, FileText, Subtitles,
} from 'lucide-react';

const STATUS_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING: { bg: 'bg-bg-card-hover', text: 'text-gray-600', label: 'Pendente' },
  ANALYZING: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Analisando...' },
  ANALYZED: { bg: 'bg-blue-100', text: 'text-blue-600', label: 'Analisado' },
  CLIPPING: { bg: 'bg-orange-100', text: 'text-orange-600', label: 'Cortando...' },
  READY: { bg: 'bg-green-100', text: 'text-green-600', label: 'Pronto' },
  FAILED: { bg: 'bg-red-100', text: 'text-red-600', label: 'Falhou' },
};

export default function ClipDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [clip, setClip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMoments, setSelectedMoments] = useState<Set<number>>(new Set());
  const [format, setFormat] = useState('vertical');
  const [burnSubs, setBurnSubs] = useState(true);
  const [cutting, setCutting] = useState(false);
  const [postingClip, setPostingClip] = useState<number | null>(null);

  async function createReels(gc: any, idx: number) {
    if (!gc.url) return;
    setPostingClip(idx);
    try {
      await api.createPost({
        caption: gc.title || clip?.title || '',
        videoUrl: gc.url,
        mediaType: 'VIDEO',
        publishMode: 'REELS',
        source: 'WEB',
      });
      router.push('/posts');
    } catch (err: any) {
      alert(err?.message || 'Erro ao criar Reels');
      setPostingClip(null);
    }
  }

  const loadClip = useCallback(async () => {
    try {
      const res: any = await api.getVideoClip(id);
      const data = res.data || res;
      setClip(data);
    } catch {
      router.push('/clips');
    }
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    loadClip();
  }, [loadClip]);

  // Polling for processing states
  useEffect(() => {
    if (!clip) return;
    const needsPoll = ['PENDING', 'ANALYZING', 'CLIPPING'].includes(clip.status);
    if (!needsPoll) return;

    const interval = setInterval(loadClip, 3000);
    return () => clearInterval(interval);
  }, [clip?.status, loadClip]);

  function toggleMoment(index: number) {
    setSelectedMoments((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAll() {
    const moments = clip?.moments || [];
    if (selectedMoments.size === moments.length) {
      setSelectedMoments(new Set());
    } else {
      setSelectedMoments(new Set(moments.map((_: any, i: number) => i)));
    }
  }

  async function handleCut() {
    if (selectedMoments.size === 0) return;
    setCutting(true);

    const moments = clip.moments || [];
    const clips = Array.from(selectedMoments).map((i) => ({
      start: moments[i].start,
      end: moments[i].end,
      title: moments[i].hook?.slice(0, 50) || `moment-${i + 1}`,
    }));

    try {
      await api.cutVideoClips(id, { clips, format, burnSubs });
      setClip((c: any) => ({ ...c, status: 'CLIPPING' }));
    } catch {}
    setCutting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!clip) return null;

  const status = STATUS_BADGES[clip.status] || STATUS_BADGES.PENDING;
  const moments = clip.moments || [];
  const generatedClips = clip.clips || [];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/clips" className="p-2 rounded-lg hover:bg-bg-card-hover transition-colors">
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-page-title">{clip.title || 'Video Clip'}</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${status.bg} ${status.text}`}>
              {status.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-text-secondary">
            {clip.duration && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {Math.floor(clip.duration / 60)}:{(clip.duration % 60).toString().padStart(2, '0')}
              </span>
            )}
            {clip.language && <span>Idioma: {clip.language.toUpperCase()}</span>}
          </div>
        </div>
      </div>

      {/* Processing States */}
      {(clip.status === 'PENDING' || clip.status === 'ANALYZING') && (
        <div className="card p-8 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
          <h3 className="font-semibold text-text-primary mb-1">Analisando video...</h3>
          <p className="text-sm text-text-muted">
            Baixando video, transcrevendo e identificando os melhores momentos.
            Isso pode levar alguns minutos.
          </p>
        </div>
      )}

      {clip.status === 'CLIPPING' && (
        <div className="card p-8 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-orange-500 mx-auto mb-3" />
          <h3 className="font-semibold text-text-primary mb-1">Gerando clips...</h3>
          <p className="text-sm text-text-muted">
            Cortando video, detectando rosto, criando layout vertical e gerando legendas.
          </p>
        </div>
      )}

      {clip.status === 'FAILED' && (
        <div className="card p-6 border-red-200 bg-red-500/10">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-status-failed flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-status-failed mb-1">Erro no processamento</h3>
              <p className="text-sm text-text-secondary">{clip.error || 'Erro desconhecido'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Moments List (ANALYZED state) */}
      {clip.status === 'ANALYZED' && moments.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-text-primary">
              {moments.length} momento(s) encontrado(s)
            </h2>
            <button onClick={selectAll} className="text-sm text-primary hover:text-primary-dark font-medium">
              {selectedMoments.size === moments.length ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
          </div>

          <div className="grid gap-2">
            {moments.map((moment: any, idx: number) => {
              const selected = selectedMoments.has(idx);
              return (
                <button
                  key={idx}
                  onClick={() => toggleMoment(idx)}
                  className={`card p-4 text-left w-full transition-all ${
                    selected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'hover:border-primary/20'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors mt-0.5 ${
                      selected ? 'bg-primary border-primary text-white' : 'border-gray-300'
                    }`}>
                      {selected && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-primary">#{moment.rank || idx + 1}</span>
                        <span className="text-xs text-text-muted">
                          {moment.start_formatted} - {moment.end_formatted}
                        </span>
                        <span className="text-xs font-semibold text-text-primary">
                          {moment.duration}s
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-[10px] font-bold text-primary">
                          Score: {moment.score}
                        </span>
                      </div>
                      <p className="text-sm text-text-primary line-clamp-2">{moment.hook}</p>
                      {moment.hook_reasons?.length > 0 && (
                        <div className="flex gap-1 mt-1.5">
                          {moment.hook_reasons.map((r: string) => (
                            <span key={r} className="px-1.5 py-0.5 rounded bg-bg-card-hover text-[10px] text-text-muted">
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Cut Options */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-sm text-text-primary">Opcoes de Corte</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">Formato</label>
                <select value={format} onChange={(e) => setFormat(e.target.value)} className="input-field text-sm">
                  <option value="vertical">Vertical (9:16) - Shorts/Reels</option>
                  <option value="square">Quadrado (1:1) - Feed</option>
                  <option value="horizontal">Horizontal (16:9) - YouTube</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Legendas</label>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={burnSubs}
                    onChange={(e) => setBurnSubs(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-text-primary">Queimar legendas no video</span>
                </label>
              </div>
            </div>
            <button
              onClick={handleCut}
              disabled={selectedMoments.size === 0 || cutting}
              className="btn-cta w-full flex items-center justify-center gap-2"
            >
              {cutting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Gerar {selectedMoments.size} Clip(s)
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Generated Clips (READY state) */}
      {clip.status === 'READY' && generatedClips.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-bold text-text-primary flex items-center gap-2">
            <Check className="w-5 h-5 text-green-500" />
            {generatedClips.length} clip(s) gerado(s)
          </h2>

          <div className="grid gap-4">
            {generatedClips.map((gc: any, idx: number) => (
              <div key={idx} className="card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-sm text-text-primary">
                      Clip {gc.index || idx + 1}: {gc.title}
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      {gc.duration}s
                    </p>
                  </div>
                </div>

                {/* Video Player */}
                {gc.url && (
                  <video
                    controls
                    className="w-full max-h-[400px] rounded-lg bg-black"
                    preload="metadata"
                  >
                    <source src={gc.url} type="video/mp4" />
                  </video>
                )}

                {/* Download Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {gc.url && (
                    <button
                      onClick={() => createReels(gc, idx)}
                      disabled={postingClip === idx}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fuchsia-500/10 text-fuchsia-600 text-xs font-semibold hover:bg-fuchsia-500/20 transition-colors disabled:opacity-50"
                    >
                      {postingClip === idx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
                      Criar Reels
                    </button>
                  )}
                  {gc.url && (
                    <a
                      href={gc.url}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      MP4
                    </a>
                  )}
                  {gc.srtUrl && (
                    <a
                      href={gc.srtUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-card-hover text-text-secondary text-xs font-semibold hover:bg-gray-200 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      SRT
                    </a>
                  )}
                  {gc.assUrl && (
                    <a
                      href={gc.assUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-card-hover text-text-secondary text-xs font-semibold hover:bg-gray-200 transition-colors"
                    >
                      <Subtitles className="w-3.5 h-3.5" />
                      ASS
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Also show moments for reference */}
          {moments.length > 0 && (
            <details className="card p-4">
              <summary className="font-semibold text-sm text-text-primary cursor-pointer">
                Ver momentos analisados ({moments.length})
              </summary>
              <div className="mt-3 space-y-2">
                {moments.map((m: any, i: number) => (
                  <div key={i} className="text-xs text-text-muted flex items-center gap-2">
                    <span className="font-bold text-primary">#{m.rank || i + 1}</span>
                    <span>{m.start_formatted} - {m.end_formatted}</span>
                    <span className="text-text-primary">{m.hook?.slice(0, 80)}</span>
                    <span className="ml-auto font-semibold">Score: {m.score}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
