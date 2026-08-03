'use client';

import { useEffect, useState } from 'react';
import { Target, Loader2, Plus, Clock, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Funil do inbox: a DM com intenção de compra vira lead com valor.
 *
 * O funil é deliberadamente curto. Um CRM de sete etapas não é preenchido
 * por quem atende no balcão entre um pedido e outro — e funil não
 * preenchido não vale nada.
 */

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const COR: Record<string, string> = {
  novo: 'border-border',
  respondido: 'border-primary/40',
  orcamento: 'border-amber-500/50',
  fechado: 'border-status-published/50',
  perdido: 'border-border opacity-60',
};

export default function FunilPage() {
  const [dados, setDados] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [contato, setContato] = useState('');
  const [movendo, setMovendo] = useState('');
  const [erro, setErro] = useState('');

  async function carregar() {
    try {
      setDados(await api.funil());
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar');
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  async function criar() {
    if (!contato.trim()) return;
    setErro('');
    try {
      await api.criarLead({ contato: contato.trim() });
      setContato('');
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao criar');
    }
  }

  async function mover(id: string, etapa: string) {
    setErro('');
    let valorCentavos: number | undefined;

    // Fechar exige valor — sem ele o funil não produz o único número que
    // ele existe para produzir. Perguntamos na hora, não depois.
    if (etapa === 'fechado') {
      const digitado = window.prompt('Quanto foi a venda? (ex: 89,90)');
      if (digitado === null) return;
      const n = Number(digitado.replace(',', '.'));
      if (!(n > 0)) { setErro('Informe um valor válido para fechar.'); return; }
      valorCentavos = Math.round(n * 100);
    }

    setMovendo(id);
    try {
      await api.moverLead(id, etapa, valorCentavos);
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao mover');
    }
    setMovendo('');
  }

  async function remover(id: string) {
    setDados((d: any) => ({ ...d, items: d.items.filter((x: any) => x.id !== id) }));
    await api.removerLead(id).catch(() => carregar());
  }

  if (carregando) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const r = dados?.resumo;

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <Target className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Funil de vendas
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Quem chamou querendo comprar, e quanto disso virou dinheiro.
        </p>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      <div className="card p-5 mb-4 bg-gradient-to-br from-primary/10 to-transparent">
        <p className="text-[11px] text-text-secondary uppercase tracking-wide">Fechado</p>
        <p className="text-3xl font-extrabold text-primary mt-0.5">{reais(r?.receitaCentavos || 0)}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-border">
          <span className="text-[11px] text-text-secondary">{r?.abertos || 0} em aberto</span>
          <span className="text-[11px] text-text-secondary">{r?.fechados || 0} fechados · {r?.perdidos || 0} perdidos</span>
          {r?.taxaConversao != null && (
            <span className="text-[11px] text-text-secondary">{r.taxaConversao}% de conversão</span>
          )}
          {r?.ticketMedioCentavos != null && (
            <span className="text-[11px] text-text-secondary">ticket {reais(r.ticketMedioCentavos)}</span>
          )}
        </div>
      </div>

      {dados?.esquecidos > 0 && (
        <div className="card p-3 mb-4 border-amber-500/40 bg-amber-500/[0.06]">
          <p className="flex items-center gap-1.5 text-[11px] text-amber-500">
            <Clock className="w-3.5 h-3.5" strokeWidth={2.5} />
            {dados.esquecidos} lead{dados.esquecidos > 1 ? 's' : ''} sem resposta há mais de 3 dias.
          </p>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input
          value={contato}
          onChange={(e) => setContato(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') criar(); }}
          placeholder="@ ou nome de quem chamou"
          className="input-field flex-1"
        />
        <button onClick={criar} disabled={!contato.trim()} className="btn-cta px-4 text-xs disabled:opacity-40">
          <Plus className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>

      {(dados?.items || []).length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-text-secondary">Nenhum lead ainda.</p>
          <p className="text-[11px] text-text-muted mt-1">
            Adicione quem chamou no direct querendo comprar e acompanhe até fechar.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {dados.items.map((l: any) => (
            <div key={l.id} className={`card p-4 ${COR[l.etapa] || 'border-border'}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{l.contato || '(sem nome)'}</p>
                  {l.mensagem && <p className="text-[11px] text-text-secondary truncate mt-0.5">{l.mensagem}</p>}
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {l.origem.toLowerCase()}
                    {l.valorCentavos != null && ` · ${reais(l.valorCentavos)}`}
                    {' · '}
                    {new Date(l.atualizadoEm).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <button onClick={() => remover(l.id)} title="Remover"
                  className="p-1.5 rounded-lg border border-border text-text-secondary hover:text-status-failed transition-colors flex-shrink-0">
                  <Trash2 className="w-3 h-3" strokeWidth={2} />
                </button>
              </div>

              <div className="flex flex-wrap gap-1 mt-2.5">
                {(dados.etapas || []).map((e: any) => (
                  <button
                    key={e.chave}
                    onClick={() => mover(l.id, e.chave)}
                    disabled={movendo === l.id || l.etapa === e.chave}
                    className={`px-2 py-1 rounded-lg border text-[10px] font-semibold transition-colors ${
                      l.etapa === e.chave
                        ? 'border-primary bg-primary/10 text-primary cursor-default'
                        : 'border-border bg-bg-main text-text-secondary hover:border-primary/40 hover:text-primary disabled:opacity-40'
                    }`}
                  >
                    {e.rotulo}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(dados?.porPost || []).length > 0 && (
        <div className="card p-4 mt-5">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Posts que mais geraram venda
          </p>
          {dados.porPost.map((p: any) => (
            <div key={p.postId} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
              <span className="text-[11px] text-text-secondary">{p.leads} lead{p.leads > 1 ? 's' : ''}</span>
              <span className="text-[11px] font-semibold text-text-primary">{reais(p.receitaCentavos)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
