'use client';

import { useState } from 'react';
import { Upload, Loader2, Check, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Importar planilha: N posts agendados de uma vez.
 *
 * Conferir e importar são passos separados de propósito. O usuário vê
 * TODOS os erros e corrige a planilha numa passada só, em vez de descobrir
 * um problema por vez com meia campanha já no ar.
 */

interface Linha {
  linha: number; data: string | null; legenda: string;
  imagem: string | null; hashtags: string[]; erro?: string;
}

const EXEMPLO = `data,legenda,imagem,hashtags
03/08/2026 10:00,Chegou a pizza nova de calabresa,https://site.com/foto1.jpg,#pizza #petrolina
04/08/2026 19:00,"Promoção de quinta, pizza grande por 39,90",https://site.com/foto2.jpg,#promo`;

export default function ImportarPage() {
  const [texto, setTexto] = useState('');
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [validas, setValidas] = useState(0);
  const [invalidas, setInvalidas] = useState(0);
  const [erroGeral, setErroGeral] = useState('');
  const [conferindo, setConferindo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [pronto, setPronto] = useState<{ criados: number } | null>(null);
  const [erro, setErro] = useState('');

  async function conferir(conteudo = texto) {
    setConferindo(true);
    setErro(''); setErroGeral(''); setPronto(null);
    try {
      const r = await api.conferirPlanilha(conteudo);
      setLinhas(r.linhas); setValidas(r.validas); setInvalidas(r.invalidas);
      if (r.erroGeral) setErroGeral(r.erroGeral);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao conferir');
    }
    setConferindo(false);
  }

  async function importar() {
    setImportando(true);
    setErro('');
    try {
      setPronto(await api.importarPlanilha(texto));
      setLinhas(null);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao importar');
    }
    setImportando(false);
  }

  function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      const conteudo = String(leitor.result || '');
      setTexto(conteudo);
      conferir(conteudo);
    };
    // O Excel brasileiro costuma salvar em windows-1252, não em UTF-8. Ler
    // como UTF-8 transformaria "promoção" em "promoÃ§Ã£o" na legenda.
    leitor.readAsText(f, 'windows-1252');
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <FileSpreadsheet className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Importar planilha
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Traga os posts que você já tem prontos no Excel ou no Google Sheets.
        </p>
      </div>

      {pronto ? (
        <div className="card p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-status-published/15 flex items-center justify-center mx-auto mb-4">
            <Check className="w-7 h-7 text-status-published" strokeWidth={3} />
          </div>
          <p className="text-lg font-bold text-text-primary">{pronto.criados} posts agendados</p>
          <p className="text-xs text-text-secondary mt-1">Confira tudo no Calendário ou no Preview do Feed.</p>
          <button onClick={() => { setPronto(null); setTexto(''); }} className="btn-ghost text-xs mt-4">
            Importar outra planilha
          </button>
        </div>
      ) : (
        <>
          <div className="card p-5 mb-4">
            <label className="flex items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors">
              <Upload className="w-5 h-5 text-primary" strokeWidth={2} />
              <span className="text-sm text-text-secondary">Escolher arquivo .csv</span>
              <input type="file" accept=".csv,.txt" onChange={aoEscolherArquivo} className="hidden" />
            </label>

            <p className="text-[11px] text-text-muted text-center my-3">ou cole o conteúdo aqui</p>

            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={6}
              placeholder={EXEMPLO}
              className="input-field w-full resize-y font-mono text-[11px]"
            />

            <div className="flex gap-2 mt-3">
              <button onClick={() => conferir()} disabled={conferindo || !texto.trim()} className="btn-cta flex-1 text-xs disabled:opacity-40">
                {conferindo ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Conferir antes de importar
              </button>
              <button onClick={() => { setTexto(EXEMPLO); conferir(EXEMPLO); }} className="btn-ghost text-xs">
                Ver exemplo
              </button>
            </div>

            <p className="text-[10px] text-text-muted mt-3">
              Colunas obrigatórias: <strong>data</strong> e <strong>legenda</strong>. Opcionais: imagem, hashtags.
              Data no formato brasileiro — <code className="text-primary">03/08/2026 14:30</code>.
            </p>
          </div>

          {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

          {erroGeral && (
            <div className="card p-4 mb-4 border-amber-500/40">
              <p className="flex items-start gap-2 text-xs text-amber-500">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={2} />
                {erroGeral}
              </p>
            </div>
          )}

          {linhas && linhas.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-text-primary">
                  {validas} pronta{validas === 1 ? '' : 's'} para importar
                  {invalidas > 0 && <span className="text-status-failed font-normal"> · {invalidas} com problema</span>}
                </p>
              </div>

              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {linhas.map((l) => (
                  <div key={l.linha} className={`p-2.5 rounded-lg border text-xs ${
                    l.erro ? 'border-status-failed/40 bg-status-failed/[0.06]' : 'border-border bg-bg-main'
                  }`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] text-text-muted font-mono flex-shrink-0">L{l.linha}</span>
                      <span className="flex-1 min-w-0 truncate text-text-primary">{l.legenda || '(sem legenda)'}</span>
                      {l.data && !l.erro && (
                        <span className="text-[10px] text-text-secondary flex-shrink-0">
                          {new Date(l.data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    {l.erro && <p className="text-[10px] text-status-failed mt-1 ml-7">{l.erro}</p>}
                  </div>
                ))}
              </div>

              <button
                onClick={importar}
                disabled={importando || validas === 0}
                className="btn-cta w-full mt-4 text-xs disabled:opacity-40"
              >
                {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Agendar {validas} post{validas === 1 ? '' : 's'}
                {invalidas > 0 && ` (as ${invalidas} com problema ficam de fora)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
