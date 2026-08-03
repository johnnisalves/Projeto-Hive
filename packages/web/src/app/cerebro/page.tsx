'use client';

import { useEffect, useState } from 'react';
import { Brain, Loader2, Plus, Power, ScrollText } from 'lucide-react';
import { api } from '../../lib/api';
import { useBrand } from '../../components/BrandProvider';

/**
 * O que a IA aprendeu, e o que ela fez sozinha.
 *
 * As duas metades andam juntas de propósito: autonomia sem prestação de
 * contas gera desconfiança. Mostrar as regras aprendidas E o diário das
 * decisões é o que torna aceitável a IA agir sem perguntar.
 */

interface Regra { id: string; regra: string; peso: number; ativa: boolean; origem: string }
interface Entrada { id: string; ator: string; acao: string; justificativa: string | null; createdAt: string }

const ATOR: Record<string, string> = {
  piloto: 'Piloto automático',
  inbox: 'Resposta de inbox',
  gatilho: 'Gatilho de comentário',
  reciclagem: 'Reciclagem',
  clima: 'Gatilho de clima',
  sentinela: 'Sentinela',
  atribuicao: 'Atribuição',
};

export default function CerebroPage() {
  // Do seletor global: as regras aprendidas são de UMA marca, e mostrar as
  // de outra faria o usuário achar que a IA aprendeu errado.
  const { marcaId } = useBrand();
  const [regras, setRegras] = useState<Regra[]>([]);
  const [prompt, setPrompt] = useState('');
  const [diario, setDiario] = useState<Entrada[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [nova, setNova] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.diarioDeBordo()
      .then((d) => setDiario(d.items || []))
      .catch((e) => setErro(e?.message || 'Falha ao carregar'))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    if (!marcaId) return;
    api.regrasDaMarca(marcaId)
      .then((r) => { setRegras(r.items); setPrompt(r.prompt); })
      .catch(() => { setRegras([]); setPrompt(''); });
  }, [marcaId]);

  async function ensinar() {
    if (nova.trim().length < 4) return;
    setSalvando(true);
    try {
      await api.ensinarRegra(marcaId, nova.trim());
      setNova('');
      const r = await api.regrasDaMarca(marcaId);
      setRegras(r.items); setPrompt(r.prompt);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao salvar');
    }
    setSalvando(false);
  }

  async function alternar(r: Regra) {
    setRegras((prev) => prev.map((x) => (x.id === r.id ? { ...x, ativa: !x.ativa } : x)));
    await api.alternarRegra(r.id, !r.ativa).catch(() => {});
    const atualizado = await api.regrasDaMarca(marcaId).catch(() => null);
    if (atualizado) setPrompt(atualizado.prompt);
  }

  if (carregando) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <Brain className="w-6 h-6 text-primary" strokeWidth={1.5} />
          O que eu aprendi
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Toda vez que você corrige uma legenda, eu anoto o padrão e passo a escrever assim.
        </p>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      <div className="card p-5 mb-4">
        <div className="flex gap-2 mb-4">
          <input
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ensinar(); }}
            placeholder="Ensine uma regra — ex: nunca falar mal de concorrente"
            className="input-field flex-1"
          />
          <button onClick={ensinar} disabled={salvando || !marcaId} className="btn-cta px-4 text-xs disabled:opacity-40">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2.5} />}
          </button>
        </div>

        {regras.length === 0 ? (
          <p className="text-xs text-text-secondary py-4 text-center">
            Ainda não aprendi nada. Edite algumas legendas geradas e eu começo a pegar o jeito da marca.
          </p>
        ) : (
          <div className="space-y-1.5">
            {regras.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-bg-main border border-border">
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${r.ativa ? 'text-text-primary' : 'text-text-muted line-through'}`}>{r.regra}</p>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {r.origem === 'manual' ? 'você ensinou' : `observei ${r.peso}x nas suas correções`}
                  </p>
                </div>
                <button onClick={() => alternar(r)} title={r.ativa ? 'Desligar' : 'Ligar'}
                  className={`p-1.5 rounded-lg border transition-colors ${r.ativa ? 'border-border text-text-secondary' : 'border-primary/40 text-primary'}`}>
                  <Power className="w-3 h-3" strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* O prompt real, não uma versão resumida: sem isso a IA fica uma
            caixa-preta e o cliente não tem como auditar o que ela recebe. */}
        {prompt && (
          <details className="mt-4">
            <summary className="text-[11px] text-text-secondary cursor-pointer hover:text-primary">
              Ver exatamente o que a IA recebe
            </summary>
            <pre className="mt-2 p-3 rounded-lg bg-bg-main border border-border text-[10px] text-text-secondary whitespace-pre-wrap">{prompt}</pre>
          </details>
        )}
      </div>

      <h2 className="flex items-center gap-2 text-sm font-bold text-text-primary mb-2 mt-6">
        <ScrollText className="w-4 h-4 text-primary" strokeWidth={2} />
        Diário de bordo
      </h2>
      <p className="text-[11px] text-text-muted mb-3">Tudo que eu fiz sozinho, e por quê.</p>

      {diario.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-xs text-text-secondary">Nada automático aconteceu ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {diario.map((e) => (
            <div key={e.id} className="card p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">{ATOR[e.ator] || e.ator}</span>
                <span className="text-[10px] text-text-muted">
                  {new Date(e.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-xs text-text-primary mt-1">{e.acao}</p>
              {e.justificativa && <p className="text-[11px] text-text-secondary mt-0.5">{e.justificativa}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
