'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, Sparkles, Loader2, Check, PartyPopper } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Piloto automatico: o mes inteiro planejado de uma vez.
 *
 * Fluxo em dois passos de proposito. Primeiro mostramos as pautas (data,
 * tema, pilar) para o usuario revisar; so depois criamos os rascunhos.
 * Criar 30 posts direto seria assustador e caro de desfazer.
 */

type Pilar = 'vender' | 'educar' | 'engajar';

interface Pauta {
  data: string;
  tema: string;
  pilar: Pilar;
  dataComemorativa?: string;
  prioridade: number;
}

const PILAR_ESTILO: Record<Pilar, { rotulo: string; classe: string }> = {
  vender: { rotulo: 'Vender', classe: 'bg-emerald-500/15 text-emerald-400' },
  educar: { rotulo: 'Educar', classe: 'bg-sky-500/15 text-sky-400' },
  engajar: { rotulo: 'Engajar', classe: 'bg-purple-500/15 text-purple-400' },
};

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export default function AutopilotPage() {
  const router = useRouter();
  const agora = new Date();
  // Comeca no proximo mes: planejar o mes corrente so aproveita os dias que
  // sobraram, e quase sempre a intencao e o mes que vem.
  const proximo = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);

  const [ano, setAno] = useState(proximo.getFullYear());
  const [mes, setMes] = useState(proximo.getMonth() + 1);
  const [porSemana, setPorSemana] = useState(3);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandId, setBrandId] = useState('');

  const [pautas, setPautas] = useState<Pauta[] | null>(null);
  const [resumo, setResumo] = useState<{ total: number; comemorativas: number; porPilar: Record<Pilar, number> } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [pronto, setPronto] = useState(0);

  useEffect(() => {
    api.listBrands().then((r: any) => {
      const items = (r.items || []) as any[];
      setBrands(items.map((b) => ({ id: b.id, name: b.name })));
      const padrao = items.find((b: any) => b.isDefault);
      if (padrao) setBrandId(padrao.id);
    }).catch(() => {});
  }, []);

  async function planejar() {
    setCarregando(true);
    setErro('');
    try {
      const r = await api.autopilotPlan({ ano, mes, postsPorSemana: porSemana, brandId: brandId || undefined });
      setPautas(r.pautas);
      setResumo(r.resumo);
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao planejar o mês');
    }
    setCarregando(false);
  }

  async function criar() {
    if (!pautas) return;
    setSalvando(true);
    setErro('');
    try {
      const r = await api.autopilotCreate({
        pautas: pautas.map((p) => ({
          data: p.data, tema: p.tema, pilar: p.pilar, dataComemorativa: p.dataComemorativa,
        })),
        brandId: brandId || undefined,
      });
      setPronto(r.criados);
      setTimeout(() => router.push('/posts'), 2200);
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar os rascunhos');
    }
    setSalvando(false);
  }

  if (pronto > 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center animate-fade-in">
        <PartyPopper className="w-10 h-10 text-primary mx-auto mb-3" strokeWidth={1.5} />
        <h1 className="text-page-title text-text-primary">{pronto} rascunhos criados</h1>
        <p className="text-sm text-text-secondary mt-2">
          Seu mês está montado. Abra cada post para gerar a arte e a legenda — o tema já está lá.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <CalendarRange className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Piloto automático
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Monta o mês inteiro a partir das datas comemorativas e do perfil da sua marca.
        </p>
      </div>

      {/* ---------- Passo 1: parametros ---------- */}
      <div className="card p-5 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Mês</label>
            <select value={mes} onChange={(e) => { setMes(Number(e.target.value)); setPautas(null); }} className="input-field">
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Ano</label>
            <input type="number" value={ano} min={agora.getFullYear()} max={agora.getFullYear() + 2}
              onChange={(e) => { setAno(Number(e.target.value)); setPautas(null); }} className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Posts/semana</label>
            <input type="number" value={porSemana} min={1} max={14}
              onChange={(e) => { setPorSemana(Number(e.target.value)); setPautas(null); }} className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Marca</label>
            <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setPautas(null); }} className="input-field">
              <option value="">Nenhuma</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        <button onClick={planejar} disabled={carregando} className="btn-cta w-full justify-center mt-4 text-xs py-2.5">
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" strokeWidth={2} />}
          {carregando ? 'Montando...' : 'Montar o mês'}
        </button>
        {erro && <p className="text-[11px] text-status-failed mt-2">{erro}</p>}
      </div>

      {/* ---------- Passo 2: revisar ---------- */}
      {pautas && resumo && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-sm font-bold text-text-primary">{resumo.total} posts</span>
            {resumo.comemorativas > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-badge bg-primary/10 text-primary font-semibold">
                {resumo.comemorativas} em datas comemorativas
              </span>
            )}
            {(Object.keys(PILAR_ESTILO) as Pilar[]).map((p) => (
              <span key={p} className={`text-[11px] px-2 py-0.5 rounded-badge font-semibold ${PILAR_ESTILO[p].classe}`}>
                {resumo.porPilar[p]} {PILAR_ESTILO[p].rotulo.toLowerCase()}
              </span>
            ))}
          </div>

          <div className="space-y-2 max-h-[26rem] overflow-auto pr-1">
            {pautas.map((p, i) => {
              const d = new Date(p.data);
              return (
                <div key={i} className="flex gap-3 p-2.5 rounded-lg bg-bg-main border border-border">
                  <div className="text-center flex-shrink-0 w-11">
                    <span className="block text-base font-bold text-text-primary leading-none">{d.getDate()}</span>
                    <span className="block text-[9px] text-text-muted uppercase mt-0.5">
                      {d.toLocaleDateString('pt-BR', { weekday: 'short' })}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-badge font-semibold ${PILAR_ESTILO[p.pilar].classe}`}>
                        {PILAR_ESTILO[p.pilar].rotulo}
                      </span>
                      {p.dataComemorativa && (
                        <span className="text-[10px] text-primary font-semibold">🎉 {p.dataComemorativa}</span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary mt-1">{p.tema}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <button onClick={criar} disabled={salvando} className="btn-cta w-full justify-center mt-4 text-xs py-2.5">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" strokeWidth={2} />}
            {salvando ? 'Criando...' : `Criar ${pautas.length} rascunhos`}
          </button>
          <p className="text-[10px] text-text-muted mt-2">
            Os rascunhos entram no calendário com o tema pronto. A arte e a legenda você gera depois, post a post.
          </p>
        </div>
      )}
    </div>
  );
}
