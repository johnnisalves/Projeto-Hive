'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Copy, Check, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import { useConfirm } from '@/components/ConfirmModal';

interface TokenApi {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function quando(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca';
}

/**
 * Tokens de API pessoais: para scripts publicarem como o usuario, sem
 * navegador aberto. O token so aparece uma vez, logo depois de gerado.
 */
export default function TokensDeApi() {
  const confirm = useConfirm();
  const [tokens, setTokens] = useState<TokenApi[]>([]);
  const [nome, setNome] = useState('');
  const [gerando, setGerando] = useState(false);
  const [novo, setNovo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    try {
      const r = await api.listApiTokens();
      setTokens(r.items || []);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao listar tokens');
    }
  }

  useEffect(() => { carregar(); }, []);

  async function gerar() {
    if (!nome.trim()) return;
    setGerando(true);
    setErro('');
    try {
      const r = await api.createApiToken(nome.trim());
      setNovo(r.token);
      setCopiado(false);
      setNome('');
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao gerar token');
    }
    setGerando(false);
  }

  async function revogar(t: TokenApi) {
    if (!await confirm({ message: `Revogar o token "${t.name}"? Scripts que usam ele param na hora.` })) return;
    try {
      await api.revokeApiToken(t.id);
      await carregar();
    } catch (e: any) {
      setErro(e?.message || 'Falha ao revogar');
    }
  }

  async function copiar() {
    if (!novo) return;
    await navigator.clipboard.writeText(novo);
    setCopiado(true);
  }

  const ativos = tokens.filter((t) => !t.revokedAt);

  return (
    <div className="mb-6">
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">Tokens de API</p>
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-6 h-6 text-emerald-600" strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-text-primary">Token de API pessoal</h3>
              <p className="text-xs text-text-secondary">
                Para scripts e automações publicarem como você, sem navegador aberto. Use no cabeçalho
                <code className="mx-1 px-1 rounded bg-bg-main">Authorization: Bearer &lt;token&gt;</code>.
                Quem tiver o token age como você: guarde num arquivo só seu e revogue se vazar.
              </p>
            </div>

            {novo && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 space-y-2">
                <p className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  Copie agora: este token não aparece de novo.
                </p>
                <div className="flex gap-2">
                  <code className="flex-1 min-w-0 truncate text-xs px-2 py-1.5 rounded bg-bg-main font-mono">{novo}</code>
                  <button onClick={copiar} className="btn-ghost text-xs">
                    {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiado ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <button onClick={() => setNovo(null)} className="text-[11px] text-text-muted hover:text-text-primary">
                  Já guardei, esconder
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome (ex: script de postagem no PC)"
                maxLength={60}
                className="input-field text-xs flex-1"
              />
              <button onClick={gerar} disabled={gerando || !nome.trim()} className="btn-cta text-xs">
                {gerando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Gerar token
              </button>
            </div>

            {erro && <p className="text-xs text-status-failed">{erro}</p>}

            {ativos.length > 0 && (
              <div className="space-y-1.5">
                {ativos.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-main text-xs">
                    <span className="font-semibold text-text-primary truncate">{t.name}</span>
                    <code className="text-text-muted">{t.prefix}…</code>
                    <span className="text-text-muted ml-auto whitespace-nowrap">criado {quando(t.createdAt)} · último uso {quando(t.lastUsedAt)}</span>
                    <button
                      onClick={() => revogar(t)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-text-muted hover:text-status-failed"
                      title="Revogar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
