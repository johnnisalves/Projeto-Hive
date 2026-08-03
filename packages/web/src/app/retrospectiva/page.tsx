'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Loader2, Download, Copy, Check } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Retrospectiva mensal: o mês vira um post que a marca QUER publicar.
 *
 * Diferente do relatório em PDF, que é a agência provando serviço — isto é
 * conteúdo, feito pro feed do cliente.
 *
 * Quando o mês foi fraco, a tela DIZ ISSO e não gera nada. Publicar
 * "3 posts neste mês" chamaria atenção justamente para o que faltou.
 */

export default function RetrospectivaPage() {
  const [marcas, setMarcas] = useState<Array<{ id: string; name: string }>>([]);
  const [marcaId, setMarcaId] = useState('');
  const [dados, setDados] = useState<any>(null);
  const [imagem, setImagem] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.listBrands()
      .then((b) => { setMarcas(b.items || []); if (b.items?.[0]) setMarcaId(b.items[0].id); })
      .catch(() => {})
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    if (!marcaId) return;
    setImagem('');
    setErro('');
    api.retrospectiva(marcaId).then(setDados).catch((e) => setErro(e?.message || 'Falha ao carregar'));
  }, [marcaId]);

  async function gerarArte() {
    setGerando(true);
    setErro('');
    try {
      const r = await api.arteDaRetrospectiva(marcaId, dados);
      setImagem(`data:image/png;base64,${r.image}`);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao gerar a arte');
    }
    setGerando(false);
  }

  function copiarLegenda() {
    navigator.clipboard.writeText(dados?.legendaSugerida || '');
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  if (carregando) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <Sparkles className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Retrospectiva do mês
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Os números do mês viram uma arte pronta pra postar.
        </p>
      </div>

      {marcas.length > 1 && (
        <select value={marcaId} onChange={(e) => setMarcaId(e.target.value)} className="input-field w-full mb-4">
          {marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )}

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      {dados && !dados.pode ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-text-secondary">{dados.motivo}</p>
          <p className="text-[11px] text-text-muted mt-2">
            A retrospectiva funciona quando tem o que comemorar. Volte no fim de um mês mais forte.
          </p>
        </div>
      ) : dados?.pode && (
        <>
          <div className="card p-6 mb-4">
            <p className="text-[11px] text-text-muted">{dados.subtitulo}</p>
            <h2 className="text-2xl font-extrabold text-text-primary mt-0.5">{dados.titulo}</h2>

            <div className="mt-5">
              <p className="text-5xl font-black text-primary leading-none">{dados.cartoes[0].numero}</p>
              <p className="text-sm text-text-secondary mt-1">{dados.cartoes[0].rotulo}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-5">
              {dados.cartoes.slice(1).map((c: any, i: number) => (
                <div key={i} className="p-3 rounded-xl bg-bg-main border border-border">
                  <p className="text-xl font-extrabold text-text-primary leading-none">{c.numero}</p>
                  <p className="text-[10px] text-text-secondary mt-1 leading-tight">{c.rotulo}</p>
                </div>
              ))}
            </div>
          </div>

          {imagem ? (
            <div className="card p-4 mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagem} alt="Retrospectiva do mês" className="w-full rounded-lg" />
              <a href={imagem} download="retrospectiva.png" className="btn-cta w-full mt-3 text-xs">
                <Download className="w-4 h-4" strokeWidth={2.5} />
                Baixar a arte
              </a>
            </div>
          ) : (
            <button onClick={gerarArte} disabled={gerando} className="btn-cta w-full text-xs mb-4 disabled:opacity-40">
              {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" strokeWidth={2.5} />}
              Gerar a arte
            </button>
          )}

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Legenda pronta</span>
              <button onClick={copiarLegenda} className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                {copiado ? <Check className="w-3 h-3" strokeWidth={3} /> : <Copy className="w-3 h-3" strokeWidth={2.5} />}
                {copiado ? 'copiada' : 'copiar'}
              </button>
            </div>
            <p className="text-xs text-text-secondary whitespace-pre-wrap">{dados.legendaSugerida}</p>
          </div>
        </>
      )}
    </div>
  );
}
