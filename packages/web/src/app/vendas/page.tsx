'use client';

import { useEffect, useState } from 'react';
import { Wallet, Loader2, Plus, Ticket, MousePointerClick, Check, Power } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Vendas: a tela que responde "isso me dá cliente?".
 *
 * O modo balcão fica NO TOPO de propósito. É o degrau zero da atribuição:
 * funciona em qualquer comércio no dia seguinte, sem cupom, sem pixel e sem
 * treinar ninguém — e é o que produz o primeiro número de receita.
 */

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ROTULO: Record<string, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  WHATSAPP: 'WhatsApp',
  PASSOU_NA_FRENTE: 'Passou na frente',
  INDICACAO: 'Indicação',
  OUTRO: 'Outro',
};

interface Resumo {
  totalCentavos: number; cupomCentavos: number; balcaoCentavos: number;
  vendasBalcao: number; cliques: number; roi: number | null; feeCentavos: number | null;
}

interface Cupom {
  id: string; code: string; descricao: string | null; usos: number;
  maxUsos: number | null; ativo: boolean; receitaCentavos: number;
}

export default function VendasPage() {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [cupons, setCupons] = useState<Cupom[]>([]);
  const [origens, setOrigens] = useState<{ opcoes: string[]; contamNoRoi: string[] } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [valorVenda, setValorVenda] = useState('');
  const [marcando, setMarcando] = useState('');
  const [marcado, setMarcado] = useState('');
  const [criando, setCriando] = useState(false);
  const [descricaoCupom, setDescricaoCupom] = useState('');

  async function carregar() {
    try {
      const [r, c, o] = await Promise.all([api.resumoVendas(30), api.listarCupons(), api.origensDeVenda()]);
      setResumo(r); setCupons(c); setOrigens(o);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar');
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  async function marcarVenda(origem: string) {
    setMarcando(origem);
    setErro('');
    try {
      // Vírgula é como o brasileiro digita valor. Sem essa troca, "49,90"
      // viraria NaN e a venda entraria sem dinheiro nenhum.
      const n = Number(valorVenda.replace(',', '.'));
      await api.registrarVenda(origem, n > 0 ? Math.round(n * 100) : undefined);
      setValorVenda('');
      setMarcado(origem);
      setTimeout(() => setMarcado(''), 1500);
      const r = await api.resumoVendas(30);
      setResumo(r);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao registrar');
    }
    setMarcando('');
  }

  async function criarCupom() {
    setCriando(true);
    setErro('');
    try {
      await api.criarCupom({ descricao: descricaoCupom || undefined, diasValidade: 30 });
      setDescricaoCupom('');
      setCupons(await api.listarCupons());
    } catch (e: any) {
      setErro(e?.message || 'Falha ao criar cupom');
    }
    setCriando(false);
  }

  async function alternar(c: Cupom) {
    setCupons((prev) => prev.map((x) => (x.id === c.id ? { ...x, ativo: !x.ativo } : x)));
    await api.alternarCupom(c.id, !c.ativo).catch(() => setCupons(cupons));
  }

  if (carregando) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <Wallet className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Vendas
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Quanto o Instagram está trazendo de dinheiro, e não só de curtida.
        </p>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      {/* O número grande primeiro: é o que o dono do negócio procura. */}
      <div className="card p-5 mb-4 bg-gradient-to-br from-primary/10 to-transparent">
        <p className="text-[11px] text-text-secondary uppercase tracking-wide">Receita atribuída · últimos 30 dias</p>
        <p className="text-4xl font-extrabold text-primary mt-1">{reais(resumo?.totalCentavos || 0)}</p>
        {resumo?.roi != null ? (
          <p className="text-xs text-text-secondary mt-2">
            Você investe {reais(resumo.feeCentavos || 0)} e o social devolveu <strong className="text-text-primary">{resumo.roi}x</strong>.
          </p>
        ) : (
          <p className="text-[11px] text-text-muted mt-2">
            Cadastre o valor do contrato em Empresas para ver o retorno sobre o investimento.
          </p>
        )}
        <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-border">
          <span className="text-[11px] text-text-secondary"><Ticket className="w-3 h-3 inline mb-0.5" /> cupons {reais(resumo?.cupomCentavos || 0)}</span>
          <span className="text-[11px] text-text-secondary">balcão {reais(resumo?.balcaoCentavos || 0)} ({resumo?.vendasBalcao || 0} vendas)</span>
          <span className="text-[11px] text-text-secondary"><MousePointerClick className="w-3 h-3 inline mb-0.5" /> {resumo?.cliques || 0} cliques em pedido</span>
        </div>
      </div>

      {/* Modo balcão: dois toques por venda. */}
      <div className="card p-5 mb-4">
        <h2 className="text-sm font-bold text-text-primary">De onde veio essa venda?</h2>
        <p className="text-[11px] text-text-muted mt-0.5 mb-3">
          Toque no botão quando um cliente comprar. O valor é opcional.
        </p>

        <input
          value={valorVenda}
          onChange={(e) => setValorVenda(e.target.value)}
          inputMode="decimal"
          placeholder="Valor da venda (opcional) — ex: 49,90"
          className="input-field w-full mb-3"
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {(origens?.opcoes || []).map((o) => {
            const contaNoRoi = origens?.contamNoRoi.includes(o);
            return (
              <button
                key={o}
                onClick={() => marcarVenda(o)}
                disabled={!!marcando}
                className={`p-4 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 ${
                  marcado === o
                    ? 'border-status-published bg-status-published/10 text-status-published'
                    : contaNoRoi
                      ? 'border-primary/40 bg-primary/[0.06] text-text-primary hover:bg-primary/10'
                      : 'border-border bg-bg-main text-text-secondary hover:bg-bg-card'
                }`}
              >
                {marcando === o ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  : marcado === o ? <Check className="w-4 h-4 mx-auto" strokeWidth={3} />
                  : ROTULO[o] || o}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-text-muted mt-2">
          Só as origens destacadas entram no cálculo de retorno — somar &ldquo;passou na frente&rdquo; inflaria o resultado do Instagram.
        </p>
      </div>

      {/* Cupons: atribuição para o comércio 100% físico. */}
      <div className="card p-5">
        <h2 className="text-sm font-bold text-text-primary">Cupons por post</h2>
        <p className="text-[11px] text-text-muted mt-0.5 mb-3">
          Coloque o código na arte. Quando o cliente usar no balcão, a venda fica ligada ao post.
        </p>

        <div className="flex gap-2 mb-4">
          <input
            value={descricaoCupom}
            onChange={(e) => setDescricaoCupom(e.target.value)}
            placeholder="Ex: 10% na pizza grande"
            className="input-field flex-1"
          />
          <button onClick={criarCupom} disabled={criando} className="btn-cta px-4 text-xs disabled:opacity-40">
            {criando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2.5} />}
            Criar
          </button>
        </div>

        {cupons.length === 0 ? (
          <p className="text-xs text-text-secondary py-4 text-center">Nenhum cupom criado ainda.</p>
        ) : (
          <div className="space-y-2">
            {cupons.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg bg-bg-main border border-border">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-mono font-bold ${c.ativo ? 'text-primary' : 'text-text-muted line-through'}`}>{c.code}</p>
                  {c.descricao && <p className="text-[11px] text-text-secondary truncate">{c.descricao}</p>}
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {c.usos} resgate{c.usos === 1 ? '' : 's'}
                    {c.maxUsos != null && ` de ${c.maxUsos}`}
                    {c.receitaCentavos > 0 && ` · ${reais(c.receitaCentavos)}`}
                  </p>
                </div>
                <button
                  onClick={() => alternar(c)}
                  title={c.ativo ? 'Desativar' : 'Ativar'}
                  className={`p-2 rounded-lg border transition-colors ${
                    c.ativo ? 'border-border text-text-secondary hover:text-status-failed' : 'border-primary/40 text-primary'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
