'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import {
  BarChart3, Users, Heart, MessageCircle, TrendingUp, Eye, AlertTriangle,
  Loader2, ExternalLink, Instagram, RefreshCw, FileText,
} from 'lucide-react';

type Period = '7d' | '30d' | '90d';

const PERIOD_LABEL: Record<Period, string> = { '7d': '7 dias', '30d': '30 dias', '90d': '90 dias' };

function StatCard({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-text-secondary text-xs font-medium mb-2">
        <Icon className="w-4 h-4" strokeWidth={1.75} />
        {label}
      </div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      {hint && <div className="text-[11px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('30d');

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await api.getAnalytics(p);
      setData(res);
    } catch (err: any) {
      setData({ error: err?.message || 'Falha ao carregar' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const t = data?.totals;
  const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-page-title flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" /> Analytics
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Métricas reais do Instagram{data?.username ? ` · @${data.username}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-badge bg-bg-card border border-border overflow-hidden">
            {(['7d', '30d', '90d'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${period === p ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-card-hover'}`}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          <button onClick={() => load(period)} className="p-2 rounded-badge bg-bg-card border border-border text-text-secondary hover:bg-bg-card-hover" title="Atualizar">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="card p-16 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      )}

      {!loading && data?.error && (
        <div className="card p-6 text-sm text-status-failed">{data.error}</div>
      )}

      {!loading && data && !data.error && !data.connected && (
        <div className="card p-10 text-center">
          <Instagram className="w-12 h-12 text-text-muted mx-auto mb-3" strokeWidth={1} />
          <p className="text-text-primary font-semibold">Nenhuma conta do Instagram conectada</p>
          <p className="text-text-muted text-sm mt-1">Conecte sua conta em Configurações para ver métricas reais.</p>
          <a href="/settings" className="text-xs text-primary hover:underline mt-3 inline-block font-medium">Ir para Configurações</a>
        </div>
      )}

      {!loading && data && !data.error && data.connected && (
        <>
          {/* Avisos (ex: falta permissao de alcance) */}
          {data.warnings?.length > 0 && (
            <div className="card p-4 border-l-4 border-amber-400 bg-amber-500/5">
              {data.warnings.map((w: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Cards principais */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Users} label="Seguidores" value={fmt(t?.followers)} hint={`${fmt(t?.mediaCount)} publicações no total`} />
            <StatCard icon={FileText} label={`Posts (${PERIOD_LABEL[period]})`} value={fmt(t?.postsInPeriod)} />
            <StatCard icon={TrendingUp} label="Engajamento médio" value={fmt(t?.avgEngagementPerPost)} hint="curtidas + comentários por post" />
            <StatCard icon={Heart} label="Taxa de engajamento" value={t?.engagementRate != null ? `${t.engagementRate}%` : '—'} hint="média por post ÷ seguidores" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Heart} label="Curtidas (período)" value={fmt(t?.totalLikes)} />
            <StatCard icon={MessageCircle} label="Comentários (período)" value={fmt(t?.totalComments)} />
            <StatCard icon={Eye} label="Alcance rastreado" value={t?.reachTracked ? 'Ativo' : 'Indisponível'} hint={t?.reachTracked ? 'insights conectados' : 'requer permissão de insights'} />
            <StatCard icon={FileText} label="No sistema" value={fmt(data?.db?.published)} hint={`${fmt(data?.db?.scheduled)} agendados`} />
          </div>

          {/* Top posts */}
          <div className="card p-5">
            <h2 className="font-bold text-text-primary mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" /> Top posts por engajamento
            </h2>
            {(!data.topPosts || data.topPosts.length === 0) && (
              <p className="text-sm text-text-muted">Nenhum post no período selecionado.</p>
            )}
            <div className="space-y-3">
              {data.topPosts?.map((p: any, idx: number) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-card-hover transition-colors">
                  <span className="w-6 text-center text-sm font-bold text-text-muted">{idx + 1}</span>
                  {p.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumb} alt="" className="w-12 h-12 rounded-lg object-cover bg-bg-main" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-bg-main flex items-center justify-center"><Instagram className="w-5 h-5 text-text-muted" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate">{p.caption || <span className="text-text-muted italic">sem legenda</span>}</p>
                    <div className="flex items-center gap-3 text-xs text-text-secondary mt-1">
                      <span className="flex items-center gap-1"><Heart className="w-3 h-3" /> {fmt(p.likes)}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" /> {fmt(p.comments)}</span>
                      {p.reach != null && <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {fmt(p.reach)}</span>}
                    </div>
                  </div>
                  {p.permalink && (
                    <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="p-2 text-text-muted hover:text-primary" title="Abrir no Instagram">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
