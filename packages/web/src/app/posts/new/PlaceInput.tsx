'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, X } from 'lucide-react';
import { api } from '../../../lib/api';

/**
 * Busca de local pelo NOME.
 *
 * O parametro location_id do Meta exige o ID de uma Pagina com local
 * verificado — digitar "Petrolina" nunca funcionaria. Aqui a pessoa
 * escreve o nome, escolhe na lista, e guardamos o ID por baixo.
 */

interface Place { id: string; name: string; where: string }

interface Props {
  /** ID ja escolhido (o que vai para a API do Instagram). */
  value: string;
  onChange: (locationId: string) => void;
}

export default function PlaceInput({ value, onChange }: Props) {
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<Place | null>(null);
  const [items, setItems] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chosen || term.trim().length < 2) { setItems([]); setOpen(false); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchPlaces(term.trim());
        if (cancelled) return;
        setItems(res.items || []);
        setReason(res.reason || '');
        setOpen(true);
      } catch (err: unknown) {
        if (!cancelled) {
          setItems([]);
          setReason(err instanceof Error ? err.message : 'Falha ao buscar locais');
          setOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350); // busca de local e mais cara que a de contato: espera mais
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, chosen]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pick(p: Place) {
    setChosen(p);
    onChange(p.id);
    setOpen(false);
  }

  function clear() {
    setChosen(null);
    setTerm('');
    onChange('');
  }

  if (chosen || (value && !term)) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-bg-main border border-border">
        <MapPin className="w-4 h-4 text-primary flex-shrink-0" strokeWidth={1.5} />
        <span className="text-xs text-text-secondary truncate flex-1">
          {chosen ? chosen.name : `Local ${value}`}
          {chosen?.where && <span className="text-text-muted"> · {chosen.where}</span>}
        </span>
        <button type="button" onClick={clear} className="p-1 rounded hover:bg-bg-card">
          <X className="w-3.5 h-3.5 text-text-muted" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Digite o nome do lugar (ex: Mercado do Produtor)"
        className="input-field"
        name="ig-place"
        autoComplete="off"
        data-lpignore="true"
        data-form-type="other"
      />
      {loading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-text-muted" />}

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-bg-card shadow-lg">
          {items.length > 0 ? (
            items.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p)}
                className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-bg-main"
              >
                <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" strokeWidth={2} />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-text-primary truncate">{p.name}</span>
                  {p.where && <span className="block text-[10px] text-text-muted truncate">{p.where}</span>}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2.5 text-[10px] text-text-muted">
              {reason || 'Nenhum lugar encontrado com esse nome.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
