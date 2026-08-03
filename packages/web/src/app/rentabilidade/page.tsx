'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingDown, Loader2, Settings2, Check } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Rentabilidade por marca: qual cliente dá lucro e qual dá prejuízo.
 *
 * Nenhuma ferramenta de social media responde isso — é o que muda o
 * DisparaAI de "ferramenta de postagem" para "sistema de gestão da agência".
 *
 * A tela grita ESTIMATIVA o tempo todo. Esse número pode fazer a agência
 * demitir um cliente; vendê-lo como exato seria irresponsável.
 */

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ESTILO = {
  prejuizo: { cor: 'text-status-failed', borda: 'border-status-failed/50', bg: 'bg-status-failed/[0.06]', rotulo: 'dá prejuízo' },
  apertado: { cor: 'text-amber-500', borda: 'border-amber-500/50', bg: 'bg-amber-500/[0.06]', rotulo: 'margem apertada' },
  saudavel: { cor: 'text-status-published', borda: 'border-border', bg: '', rotulo: 'saudável' },
} as const;

export default function RentabilidadePage() {
  const [dados, setDados] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [custoHora, setCustoHora] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    try {
      const r = await api.rentabilidade(30);
      setDados(r);
      if (r.custoHoraCentavos) setCustoHora(String(r.custoHoraCentavos / 100));
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar');
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  async function salvarCusto() {
    setSalvando(true);
    setErro('');
    try {
      const n = Number(custoHora.replace(',', '.'));
      await api.salvarCustoHora(Math.round(n * 100));
      setSalvo(true);
      setTimeout(() => setSalvo(false), 1500);
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar');
    }
    setSalvando(false);
  }

  if (carregando) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const comConta = (dados?.linhas || []).filter((l: any) => l.temConta);
  const semConta = (dados?.linhas || []).filter((l: any) => !l.temConta);

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <TrendingDown className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Rentabilidade
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Quanto cada cliente custa de trabalho, comparado com o que ele paga. Últimos 30 dias.
        </p>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      <div className="card p-4 mb-4">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary mb-2">
          <Settings2 className="w-3.5 h-3.5" strokeWidth={2} />
          Quanto custa uma hora da sua equipe?
        </label>
        <div className="flex gap-2">
          <input
            value={custoHora}
            onChange={(e) => setCustoHora(e.target.value)}
            inputMode="decimal"
            placeholder="60,00"
            className="input-field flex-1"
          />
          <button onClick={salvarCusto} disabled={salvando || !custoHora.trim()} className="btn-cta px-4 text-xs disabled:opacity-40">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : salvo ? <Check className="w-4 h-4" strokeWidth={3} /> : 'Salvar'}
          </button>
        </div>
        <p className="text-[10px] text-text-muted mt-2">
          Some salário, encargos e estrutura, e divida pelas horas trabalhadas. Sem isso não dá para calcular margem.
        </p>
      </div>

      {dados?.precisaConfigurar ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-text-secondary">Informe o custo/hora acima para eu fazer as contas.</p>
        </div>
      ) : (
        <>
          {comConta.map((l: any) => {
            const e = ESTILO[l.situacao as keyof typeof ESTILO];
            return (
              <div key={l.id} className={`card p-4 mb-2 ${e.borda} ${e.bg}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-text-primary truncate">{l.nome}</p>
                  <span className={`text-sm font-extrabold flex-shrink-0 ${e.cor}`}>{l.margemPct}%</span>
                </div>
                <p className={`text-[11px] ${e.cor}`}>{e.rotulo}</p>

                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pt-2 border-t border-border">
                  <span className="text-[11px] text-text-secondary">recebe {reais(l.feeCentavos)}</span>
                  <span className="text-[11px] text-text-secondary">custa ~{reais(l.custoCentavos)}</span>
                  <span className="text-[11px] text-text-muted">
                    {Math.round(l.minutos / 60)}h · {l.esforco.posts} posts · {l.esforco.respostas} respostas
                  </span>
                </div>

                {/* O número acionável: "precisa passar para X" resolve;
                    "margem de 12%" só informa. */}
                {l.situacao !== 'saudavel' && l.feeSugeridoCentavos > 0 && (
                  <p className="text-[11px] text-text-primary mt-2">
                    Para ficar saudável, esse contrato precisaria ser de <strong>{reais(l.feeSugeridoCentavos)}</strong>.
                  </p>
                )}
              </div>
            );
          })}

          {semConta.length > 0 && (
            <div className="card p-4 mt-4">
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Sem valor de contrato cadastrado</p>
              <p className="text-[11px] text-text-muted mb-2">
                Não dá para calcular margem sem saber quanto a marca paga.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {semConta.map((l: any) => (
                  <Link key={l.id} href="/brands" className="px-2.5 py-1 rounded-lg border border-border text-[11px] text-text-secondary hover:border-primary/40 hover:text-primary transition-colors">
                    {l.nome}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-text-muted mt-4">
            <strong>É estimativa.</strong> Calculo o tempo por atividade (20 min por post, 15 por arte, 3 por resposta)
            com base no que passou pelo DisparaAI. Trabalho feito fora daqui não entra na conta.
          </p>
        </>
      )}
    </div>
  );
}
