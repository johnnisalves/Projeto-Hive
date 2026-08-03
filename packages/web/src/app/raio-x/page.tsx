'use client';

import { useState } from 'react';
import { Search, Loader2, TrendingUp, AlertCircle, ArrowRight } from 'lucide-react';

/**
 * Raio-X de perfil — página PÚBLICA, sem login.
 *
 * Serve a duas coisas ao mesmo tempo: é um diagnóstico útil (a pessoa
 * analisa o próprio perfil E o do concorrente) e é isca de leads — o
 * resultado convida ao cadastro no fim.
 *
 * Nada de menu nem layout do app: quem chega aqui veio de um link e quer
 * digitar um @ e ver o resultado.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface Resultado {
  username: string; followers: number; posts: number;
  nota: number; taxa: number | null; frequencia: number | null;
  resumo: string; sinais: Array<{ texto: string; bom: boolean }>;
}

export default function RaioXPage() {
  const [entrada, setEntrada] = useState('');
  const [r, setR] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');

  async function analisar() {
    if (!entrada.trim()) return;
    setBuscando(true);
    setErro('');
    setR(null);
    try {
      const resp = await fetch(`${BASE}/api/raio-x?u=${encodeURIComponent(entrada)}`);
      const j = await resp.json();
      if (!j.success) throw new Error(j.error || 'Não consegui analisar');
      setR(j.data);
    } catch (e: any) {
      setErro(e?.message || 'Não consegui analisar');
    }
    setBuscando(false);
  }

  const cor = (n: number) => (n >= 75 ? 'text-emerald-400' : n >= 50 ? 'text-amber-400' : 'text-red-400');
  const anel = (n: number) => (n >= 75 ? '#34d399' : n >= 50 ? '#fbbf24' : '#f87171');

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="max-w-lg mx-auto px-5 py-12">
        <h1 className="text-3xl font-extrabold text-center">Raio-X do Instagram</h1>
        <p className="text-sm text-neutral-400 text-center mt-2">
          Descubra em 10 segundos como está o seu perfil — ou o do seu concorrente.
        </p>

        <div className="flex gap-2 mt-7">
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') analisar(); }}
            placeholder="@seu_perfil"
            className="flex-1 px-4 py-3.5 rounded-xl bg-neutral-900 border border-neutral-800 focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={analisar}
            disabled={buscando || !entrada.trim()}
            className="px-5 rounded-xl bg-violet-600 hover:bg-violet-500 font-semibold disabled:opacity-40 transition-colors"
          >
            {buscando ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" strokeWidth={2.5} />}
          </button>
        </div>

        <p className="text-[11px] text-neutral-600 text-center mt-3">
          Funciona com contas Profissionais públicas. Nada é salvo.
        </p>

        {erro && (
          <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/40">
            <p className="flex items-start gap-2 text-sm text-red-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={2} />
              {erro}
            </p>
          </div>
        )}

        {r && (
          <div className="mt-8">
            <div className="text-center">
              {/* O anel é o que a pessoa fotografa e manda no grupo. */}
              <div className="relative w-32 h-32 mx-auto">
                <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="#262626" strokeWidth="12" />
                  <circle
                    cx="60" cy="60" r="52" fill="none" stroke={anel(r.nota)} strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${(r.nota / 100) * 327} 327`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-4xl font-black ${cor(r.nota)}`}>{r.nota}</span>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wide">de 100</span>
                </div>
              </div>

              <p className="text-lg font-bold mt-4">@{r.username}</p>
              <p className="text-sm text-neutral-400">{r.resumo}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-6">
              <div className="p-3 rounded-xl bg-neutral-900 text-center">
                <p className="text-lg font-extrabold">{r.followers.toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-neutral-500">seguidores</p>
              </div>
              <div className="p-3 rounded-xl bg-neutral-900 text-center">
                <p className="text-lg font-extrabold">{r.taxa != null ? `${r.taxa}%` : '—'}</p>
                <p className="text-[10px] text-neutral-500">engajamento</p>
              </div>
              <div className="p-3 rounded-xl bg-neutral-900 text-center">
                <p className="text-lg font-extrabold">{r.frequencia != null ? r.frequencia : '—'}</p>
                <p className="text-[10px] text-neutral-500">posts/semana</p>
              </div>
            </div>

            <div className="space-y-2 mt-6">
              {r.sinais.map((s, i) => (
                <div key={i} className={`p-3.5 rounded-xl border ${
                  s.bom ? 'bg-emerald-500/[0.07] border-emerald-500/30' : 'bg-amber-500/[0.07] border-amber-500/30'
                }`}>
                  <p className="flex items-start gap-2 text-[13px]">
                    {s.bom
                      ? <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                      : <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />}
                    <span className="text-neutral-200">{s.texto}</span>
                  </p>
                </div>
              ))}
            </div>

            {/* O convite vem DEPOIS do valor entregue. Pedir cadastro antes
                do resultado derrubaria a conversão e o compartilhamento. */}
            <div className="mt-8 p-5 rounded-2xl bg-gradient-to-br from-violet-600/25 to-transparent border border-violet-500/40 text-center">
              <p className="font-bold">Quer que isso melhore sozinho?</p>
              <p className="text-[13px] text-neutral-300 mt-1">
                O DisparaAI escreve, agenda e publica pra você — e avisa quando um post está prestes a bombar.
              </p>
              <a href="/invite" className="inline-flex items-center gap-1.5 mt-4 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 font-semibold text-sm transition-colors">
                Testar de graça
                <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
