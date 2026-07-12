'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import {
  MessageCircle, Loader2, AlertTriangle, Instagram, Send, ExternalLink, RefreshCw, Heart,
} from 'lucide-react';

function timeAgo(ts?: string) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function InboxPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getInbox();
      setData(res);
    } catch (err: any) {
      setData({ error: err?.message || 'Falha ao carregar' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sendReply(commentId: string) {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await api.replyToComment(commentId, replyText.trim());
      setDoneIds((prev) => new Set(prev).add(commentId));
      setReplyOpen(null);
      setReplyText('');
    } catch (err: any) {
      alert(err?.message || 'Erro ao responder');
    }
    setSending(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-page-title flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-primary" /> Inbox
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Comentários das suas publicações{data?.username ? ` · @${data.username}` : ''}
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-badge bg-bg-card border border-border text-text-secondary hover:bg-bg-card-hover" title="Atualizar">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && (
        <div className="card p-16 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      )}

      {!loading && data?.error && <div className="card p-6 text-sm text-status-failed">{data.error}</div>}

      {!loading && data && !data.error && !data.connected && (
        <div className="card p-10 text-center">
          <Instagram className="w-12 h-12 text-text-muted mx-auto mb-3" strokeWidth={1} />
          <p className="text-text-primary font-semibold">Nenhuma conta do Instagram conectada</p>
          <a href="/settings" className="text-xs text-primary hover:underline mt-3 inline-block font-medium">Ir para Configurações</a>
        </div>
      )}

      {!loading && data && !data.error && data.connected && (
        <>
          {data.warnings?.length > 0 && (
            <div className="card p-4 border-l-4 border-amber-400 bg-amber-500/5">
              {data.warnings.map((w: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {(!data.items || data.items.length === 0) && (!data.warnings || data.warnings.length === 0) && (
            <div className="card p-10 text-center">
              <MessageCircle className="w-12 h-12 text-text-muted mx-auto mb-3" strokeWidth={1} />
              <p className="text-text-muted text-sm">Nenhum comentário nas publicações recentes.</p>
            </div>
          )}

          <div className="space-y-3">
            {data.items?.map((c: any) => (
              <div key={c.id} className="card p-4">
                <div className="flex items-start gap-3">
                  {c.media?.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.media.thumb} alt="" className="w-12 h-12 rounded-lg object-cover bg-bg-main shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-bg-main flex items-center justify-center shrink-0"><Instagram className="w-5 h-5 text-text-muted" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-text-primary">@{c.username || 'usuario'}</span>
                      <span className="text-xs text-text-muted">{timeAgo(c.timestamp)}</span>
                      {c.likeCount > 0 && <span className="text-xs text-text-muted flex items-center gap-1"><Heart className="w-3 h-3" /> {c.likeCount}</span>}
                      {c.repliesCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-badge bg-bg-main text-text-secondary">{c.repliesCount} resposta(s)</span>}
                    </div>
                    <p className="text-sm text-text-primary mt-0.5">{c.text}</p>

                    <div className="flex items-center gap-3 mt-2">
                      {doneIds.has(c.id) ? (
                        <span className="text-xs text-status-published font-medium">✓ Respondido</span>
                      ) : (
                        <button onClick={() => { setReplyOpen(replyOpen === c.id ? null : c.id); setReplyText(''); }} className="text-xs text-primary font-semibold hover:underline">
                          Responder
                        </button>
                      )}
                      {c.media?.permalink && (
                        <a href={c.media.permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-text-muted hover:text-primary flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> ver post
                        </a>
                      )}
                    </div>

                    {replyOpen === c.id && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') sendReply(c.id); }}
                          placeholder="Escreva uma resposta..."
                          className="input-field flex-1 text-sm"
                          autoFocus
                        />
                        <button onClick={() => sendReply(c.id)} disabled={sending || !replyText.trim()} className="px-3 py-2 rounded-badge bg-primary text-white text-xs font-semibold hover:bg-primary-dark disabled:opacity-50 flex items-center gap-1">
                          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Enviar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
