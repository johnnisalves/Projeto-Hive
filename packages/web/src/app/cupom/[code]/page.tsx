'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Check, X } from 'lucide-react';

/**
 * Tela de resgate de cupom, usada NO BALCÃO.
 *
 * Quem abre isso é o caixa no meio do atendimento, com o cliente esperando.
 * Por isso: sem login, sem menu, botão gigante, e o valor da venda é
 * opcional — se for obrigatório, o caixa pula a etapa e a atribuição morre.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || '';

export default function ResgatePage() {
  const params = useParams();
  const code = String(params?.code || '').toUpperCase();

  const [cupom, setCupom] = useState<{ code: string; descricao: string | null; usos: number; maxUsos: number | null; recusa: string | null } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [valor, setValor] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    fetch(`${BASE}/api/vendas/cupom/${code}`)
      .then((r) => r.json())
      .then((j) => { if (j.success) setCupom(j.data); else setErro(j.error || 'Cupom não encontrado'); })
      .catch(() => setErro('Não consegui conferir o cupom'))
      .finally(() => setCarregando(false));
  }, [code]);

  async function resgatar() {
    setSalvando(true);
    setErro('');
    try {
      // O caixa digita "49,90". Sem trocar a vírgula, viraria NaN e a venda
      // entraria valendo zero.
      const n = Number(valor.replace(',', '.'));
      const r = await fetch(`${BASE}/api/vendas/cupom/${code}/resgatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valorCentavos: n > 0 ? Math.round(n * 100) : 0 }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Não consegui resgatar');
      setPronto(true);
    } catch (e: any) {
      setErro(e?.message || 'Não consegui resgatar');
    }
    setSalvando(false);
  }

  if (carregando) {
    return <div className="min-h-screen flex items-center justify-center bg-neutral-950"><Loader2 className="w-7 h-7 animate-spin text-violet-400" /></div>;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-5">
      <div className="w-full max-w-sm">
        {pronto ? (
          <div className="text-center py-10">
            <div className="w-20 h-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500 flex items-center justify-center mx-auto mb-5">
              <Check className="w-10 h-10 text-emerald-400" strokeWidth={3} />
            </div>
            <p className="text-2xl font-bold">Resgatado!</p>
            <p className="text-sm text-neutral-400 mt-2">A venda já está ligada ao post que trouxe esse cliente.</p>
          </div>
        ) : !cupom ? (
          <div className="text-center py-10">
            <div className="w-20 h-20 rounded-full bg-red-500/15 border-2 border-red-500 flex items-center justify-center mx-auto mb-5">
              <X className="w-10 h-10 text-red-400" strokeWidth={3} />
            </div>
            <p className="text-xl font-bold">Cupom não encontrado</p>
            <p className="text-sm text-neutral-400 mt-2">Confira o código com o cliente.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-neutral-500 uppercase tracking-wide text-center">Cupom</p>
            <p className="text-3xl font-mono font-extrabold text-violet-400 text-center mt-1">{cupom.code}</p>
            {cupom.descricao && <p className="text-center text-sm text-neutral-300 mt-2">{cupom.descricao}</p>}
            <p className="text-center text-xs text-neutral-500 mt-1">
              {cupom.usos} resgate{cupom.usos === 1 ? '' : 's'}{cupom.maxUsos != null && ` de ${cupom.maxUsos}`}
            </p>

            {cupom.recusa ? (
              <div className="mt-8 p-4 rounded-xl bg-red-500/10 border border-red-500/40 text-center">
                <p className="text-sm font-semibold text-red-300">{cupom.recusa}</p>
              </div>
            ) : (
              <>
                <input
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  inputMode="decimal"
                  placeholder="Valor da venda (opcional)"
                  className="w-full mt-8 px-4 py-4 rounded-xl bg-neutral-900 border border-neutral-800 text-center text-lg focus:outline-none focus:border-violet-500"
                />
                <button
                  onClick={resgatar}
                  disabled={salvando}
                  className="w-full mt-3 py-5 rounded-xl bg-violet-600 hover:bg-violet-500 font-bold text-lg disabled:opacity-50 transition-colors"
                >
                  {salvando ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Confirmar resgate'}
                </button>
                <p className="text-center text-[11px] text-neutral-600 mt-3">
                  Pode confirmar sem o valor — o resgate é registrado do mesmo jeito.
                </p>
              </>
            )}
            {erro && <p className="text-center text-xs text-red-400 mt-4">{erro}</p>}
          </>
        )}
      </div>
    </div>
  );
}
