'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';

/**
 * Campo de @ com sugestao em tempo real.
 *
 * DE ONDE VEM A SUGESTAO: da agenda do proprio usuario, nao do Instagram.
 * A API do Meta nao tem busca de usuario por prefixo — o unico endpoint de
 * consulta e o business_discovery, que exige o @ exato e completo e so
 * responde para conta Business/Creator publica. Entao a agenda guarda todo @
 * ja usado e devolve como sugestao a partir da segunda vez.
 */

interface Suggestion {
  username: string;
  displayName?: string | null;
  followers?: number | null;
  verifiedAt?: string | null;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Chamado ao escolher uma sugestao ou confirmar com Enter. */
  onSubmit: (username: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** Compacto para o balao de marcacao sobre a foto. */
  compact?: boolean;
}

function formatFollowers(n?: number | null): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function MentionInput({
  value, onChange, onSubmit, placeholder, disabled, autoFocus, className, compact,
}: Props) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [error, setError] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * Importa contatos da conta do Instagram (legendas e comentarios dos
   * posts). E o mais perto de "achar meus amigos" que a API permite —
   * nao existe endpoint de busca de perfil nem de lista de seguidores.
   */
  async function runSync() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const r = await api.syncIgContacts();
      if (r.total > 0) {
        setSyncMsg(`${r.total} contatos importados${r.sources.length ? ` (${r.sources.join(', ')})` : ''}.`);
        const res = await api.searchIgContacts(value.replace(/^@+/, ''));
        setItems(res.items || []);
      } else {
        setSyncMsg(r.reason || 'Nenhum contato encontrado nas suas legendas, comentários ou marcações.');
      }
    } catch (err: unknown) {
      setSyncMsg(err instanceof Error ? err.message : 'Falha ao buscar contatos');
    }
    setSyncing(false);
  }

  // Busca com atraso curto: digitar rapido nao dispara uma chamada por tecla.
  useEffect(() => {
    const term = value.replace(/^@+/, '');
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchIgContacts(term);
        if (cancelled) return;
        setItems(res.items || []);
        // O servidor responde 200 com `warning` quando a busca falha, para
        // nao devolver 500 a cada tecla. O motivo tem que chegar na tela.
        setError(res.warning || '');
        // `reason` explica agenda vazia (conta desconectada, nada achado).
        if (res.reason) setSyncMsg(res.reason);
        setHighlight(0);
        // Abre tambem sem resultado, para mostrar a dica de "aperte Enter".
        // Sem isso o campo parecia quebrado quando a agenda ainda nao tem
        // o @ digitado.
        setOpen((res.items || []).length > 0 || term.length >= 2);
      } catch (err: unknown) {
        // Antes isso fechava a lista em silencio, e uma falha da API ficava
        // indistinguivel de "nao achei ninguem". O erro agora aparece.
        if (!cancelled) {
          setItems([]);
          setError(err instanceof Error ? err.message : 'Falha ao buscar contatos');
          setOpen(term.length >= 2);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value]);

  // Fecha ao clicar fora
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function choose(username: string) {
    onSubmit(username);
    onChange('');
    setOpen(false);
    setItems([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % items.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + items.length) % items.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(items[highlight].username);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Sem sugestao escolhida: aceita o que foi digitado. O @ pode ser de
      // alguem que nunca foi usado antes — a agenda comeca vazia.
      const typed = value.trim().replace(/^@+/, '');
      if (typed) choose(typed);
      return;
    }
    if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={boxRef} className={`relative ${className || ''}`}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => items.length > 0 && setOpen(true)}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        // O Chrome tratava este campo como nome/endereco e abria o autofill
        // dele por cima da nossa lista. autoComplete="off" sozinho nao basta:
        // o Chrome ignora quando acha que reconheceu o campo. Um `name` que
        // nao lembra nada conhecido, mais os data-* dos gerenciadores de
        // senha, resolvem.
        name="ig-mention"
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        data-form-type="other"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        className={compact
          ? 'w-36 px-1.5 py-0.5 text-[11px] rounded border border-border bg-bg-main'
          : 'input-field w-full disabled:opacity-50'}
      />
      {loading && (
        <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-text-muted" />
      )}

      {open && items.length === 0 && !loading && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-border bg-bg-card shadow-lg p-3">
          <p className="text-xs text-text-primary font-semibold">
            Aperte Enter para usar @{value.replace(/^@+/, '')}
          </p>
          {error ? (
            <p className="text-[10px] text-status-failed mt-1">Erro ao buscar: {error}</p>
          ) : (
            <p className="text-[10px] text-text-muted mt-1">Não achei esse @ na sua agenda.</p>
          )}
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); runSync(); }}
            disabled={syncing}
            className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" strokeWidth={2.5} />}
            {syncing ? 'Buscando...' : 'Buscar meus contatos do Instagram'}
          </button>
          {syncMsg && <p className="text-[10px] text-text-muted mt-1.5">{syncMsg}</p>}
        </div>
      )}

      {open && items.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-bg-card shadow-lg">
          {items.map((s, i) => (
            <li key={s.username}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(s.username)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                  i === highlight ? 'bg-primary/10' : 'hover:bg-bg-main'
                }`}
              >
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-accent-pink flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                  {s.username.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-xs font-semibold text-text-primary truncate">
                    @{s.username}
                    {s.verifiedAt && <Check className="w-3 h-3 text-primary flex-shrink-0" strokeWidth={3} />}
                  </span>
                  {(s.displayName || s.followers) && (
                    <span className="block text-[10px] text-text-muted truncate">
                      {s.displayName}
                      {s.displayName && s.followers ? ' · ' : ''}
                      {s.followers ? `${formatFollowers(s.followers)} seguidores` : ''}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
