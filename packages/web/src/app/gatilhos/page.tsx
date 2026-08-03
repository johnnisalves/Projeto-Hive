'use client';

import { useEffect, useState } from 'react';
import { Zap, Loader2, Plus, Trash2, Power, MessageSquare } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Gatilhos de comentário: "comente EU QUERO que eu te chamo".
 *
 * É a mecânica de venda nº 1 do Instagram brasileiro. Usa Private Replies,
 * endpoint oficial da Meta — cada comentário aceita UMA resposta privada e
 * só por 7 dias, então o sistema nunca tenta duas vezes no mesmo.
 */

interface Gatilho {
  id: string; palavra: string; resposta: string; ativo: boolean; disparos: number; postId: string | null;
}

const EXEMPLOS = [
  { palavra: 'EU QUERO', resposta: 'Oi {nome}! Que bom que se interessou 😊 Manda um oi aqui que eu te passo os valores.' },
  { palavra: 'CARDAPIO', resposta: 'Oi {nome}! Nosso cardápio completo tá aqui: [seu link]' },
  { palavra: 'PRECO', resposta: 'Oi {nome}! Te mando os valores agora mesmo.' },
];

export default function GatilhosPage() {
  const [items, setItems] = useState<Gatilho[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [palavra, setPalavra] = useState('');
  const [resposta, setResposta] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    try {
      setItems((await api.listarGatilhos()).items);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar');
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  async function criar() {
    setSalvando(true);
    setErro('');
    try {
      await api.criarGatilho({ palavra, resposta });
      setPalavra(''); setResposta('');
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao criar');
    }
    setSalvando(false);
  }

  async function alternar(g: Gatilho) {
    setItems((prev) => prev.map((x) => (x.id === g.id ? { ...x, ativo: !x.ativo } : x)));
    await api.alternarGatilho(g.id, !g.ativo).catch(() => carregar());
  }

  async function remover(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id));
    await api.removerGatilho(id).catch(() => carregar());
  }

  if (carregando) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <Zap className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Comentou, respondeu
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Quem comentar a palavra que você escolher recebe uma mensagem no direct, na hora.
        </p>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      <div className="card p-5 mb-4">
        <input
          value={palavra}
          onChange={(e) => setPalavra(e.target.value)}
          placeholder="Palavra que o seguidor vai comentar — ex: EU QUERO"
          className="input-field w-full mb-2"
        />
        <textarea
          value={resposta}
          onChange={(e) => setResposta(e.target.value)}
          rows={3}
          placeholder="Mensagem que ele recebe no direct"
          className="input-field w-full resize-none"
        />
        <p className="text-[10px] text-text-muted mt-1.5">
          Escreva <code className="text-primary">{'{nome}'}</code> onde quiser o @ de quem comentou.
        </p>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXEMPLOS.map((e) => (
            <button
              key={e.palavra}
              onClick={() => { setPalavra(e.palavra); setResposta(e.resposta); }}
              className="px-2.5 py-1 rounded-lg border border-border bg-bg-main text-[11px] text-text-secondary hover:border-primary/40 hover:text-primary transition-colors"
            >
              {e.palavra}
            </button>
          ))}
        </div>

        <button
          onClick={criar}
          disabled={salvando || palavra.trim().length < 2 || resposta.trim().length < 2}
          className="btn-cta w-full mt-4 text-xs disabled:opacity-40"
        >
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" strokeWidth={2.5} />}
          Criar gatilho
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center">
          <MessageSquare className="w-8 h-8 text-text-muted mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-text-secondary">Nenhum gatilho ainda.</p>
          <p className="text-[11px] text-text-muted mt-1">
            Toque num exemplo acima para começar — leva 10 segundos.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((g) => (
            <div key={g.id} className="card p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold ${g.ativo ? 'text-primary' : 'text-text-muted line-through'}`}>
                  {g.palavra.toUpperCase()}
                </p>
                <p className="text-xs text-text-secondary mt-1">{g.resposta}</p>
                <p className="text-[10px] text-text-muted mt-1.5">
                  {g.disparos} resposta{g.disparos === 1 ? '' : 's'} enviada{g.disparos === 1 ? '' : 's'}
                  {!g.postId && ' · vale para todos os posts'}
                </p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => alternar(g)} title={g.ativo ? 'Desativar' : 'Ativar'}
                  className={`p-2 rounded-lg border transition-colors ${g.ativo ? 'border-border text-text-secondary hover:text-status-failed' : 'border-primary/40 text-primary'}`}>
                  <Power className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
                <button onClick={() => remover(g.id)} title="Remover"
                  className="p-2 rounded-lg border border-border text-text-secondary hover:text-status-failed transition-colors">
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card p-4 mt-4 border-border">
        <p className="text-[11px] text-text-secondary">
          <strong className="text-text-primary">Como funciona:</strong> a Meta avisa o DisparaAI assim que alguém
          comenta, e a resposta sai no direct em segundos. Cada comentário recebe uma resposta só — e a conta
          precisa estar conectada via Login do Facebook.
        </p>
      </div>
    </div>
  );
}
