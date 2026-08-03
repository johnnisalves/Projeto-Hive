'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../lib/api';

/**
 * A empresa selecionada, valendo para o app inteiro.
 *
 * Antes cada tela tinha o próprio `<select>` de marca — quando tinha. Doze
 * telas centrais não filtravam por cliente nenhum, e as que filtravam
 * esqueciam a escolha ao navegar: você trocava para o cliente B em
 * Analytics e voltava para o A ao abrir o Inbox.
 *
 * Com uma agência de verdade isso não é incômodo, é risco: você olha um
 * número achando que é de um cliente e é de outro.
 */

interface Marca { id: string; name: string }

interface Contexto {
  marcas: Marca[];
  marcaId: string;
  marca: Marca | null;
  definir: (id: string) => void;
  carregando: boolean;
  recarregar: () => Promise<void>;
}

const BrandContext = createContext<Contexto>({
  marcas: [], marcaId: '', marca: null,
  definir: () => {}, carregando: true, recarregar: async () => {},
});

const CHAVE = 'disparaai:marca';

export function BrandProvider({ children }: { children: ReactNode }) {
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [marcaId, setMarcaId] = useState('');
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    try {
      const r = await api.listBrands();
      const lista: Marca[] = (r.items || []).map((m: any) => ({ id: m.id, name: m.name }));
      setMarcas(lista);

      // A escolha anterior só vale se a empresa ainda existir — apagar uma
      // marca deixaria o app preso num id fantasma, filtrando tudo por algo
      // que não está mais lá e mostrando telas vazias sem explicação.
      const salva = typeof window !== 'undefined' ? localStorage.getItem(CHAVE) : null;
      const valida = salva && lista.some((m) => m.id === salva) ? salva : (lista[0]?.id || '');
      setMarcaId(valida);
      if (valida !== salva && typeof window !== 'undefined') {
        if (valida) localStorage.setItem(CHAVE, valida);
        else localStorage.removeItem(CHAVE);
      }
    } catch {
      setMarcas([]);
    }
    setCarregando(false);
  }

  useEffect(() => { carregar(); }, []);

  function definir(id: string) {
    setMarcaId(id);
    if (typeof window === 'undefined') return;
    if (id) localStorage.setItem(CHAVE, id);
    else localStorage.removeItem(CHAVE);
  }

  return (
    <BrandContext.Provider
      value={{
        marcas,
        marcaId,
        marca: marcas.find((m) => m.id === marcaId) || null,
        definir,
        carregando,
        recarregar: carregar,
      }}
    >
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() { return useContext(BrandContext); }
