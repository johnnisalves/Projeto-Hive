'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Loader2, Check, AlertTriangle, Send } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Publicação em massa multimarca.
 *
 * O Dia da Pizza sai para 15 clientes em minutos, cada um com o próprio
 * nome, telefone e cidade.
 *
 * A conferência é OBRIGATÓRIA e vem antes do botão de publicar. Um
 * "{{nome}}" não substituído indo ao ar no perfil do cliente é vexame
 * público e irreversível — pior que a campanha não sair.
 */

const MARCACOES = ['nome', 'cidade', 'telefone', 'site', 'instagram'];

export default function MultimarcaPage() {
  const [marcas, setMarcas] = useState<Array<{ id: string; name: string }>>([]);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [template, setTemplate] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [conferencia, setConferencia] = useState<any>(null);
  const [conferindo, setConferindo] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [pronto, setPronto] = useState<any>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.listBrands()
      .then((b) => {
        setMarcas(b.items || []);
        setSelecionadas((b.items || []).map((m: any) => m.id));
      })
      .catch(() => {});
  }, []);

  // Reconfere sozinho a cada mudança: obrigar a clicar num botão de
  // conferir faria muita gente pular a etapa e publicar com buraco.
  useEffect(() => {
    if (!template.trim() || selecionadas.length === 0) { setConferencia(null); return; }
    const t = setTimeout(() => {
      setConferindo(true);
      api.conferirMultimarca(template, selecionadas)
        .then(setConferencia)
        .catch(() => setConferencia(null))
        .finally(() => setConferindo(false));
    }, 600);
    return () => clearTimeout(t);
  }, [template, selecionadas]);

  function alternar(id: string) {
    setSelecionadas((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function publicar() {
    setPublicando(true);
    setErro('');
    try {
      setPronto(await api.publicarMultimarca({
        template,
        brandIds: selecionadas,
        imageUrl: imageUrl.trim() || undefined,
      }));
    } catch (e: any) {
      setErro(e?.message || 'Falha ao publicar');
    }
    setPublicando(false);
  }

  if (pronto) {
    return (
      <div className="max-w-2xl mx-auto animate-fade-in">
        <div className="card p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-status-published/15 flex items-center justify-center mx-auto mb-4">
            <Check className="w-7 h-7 text-status-published" strokeWidth={3} />
          </div>
          <p className="text-lg font-bold text-text-primary">{pronto.criados.length} campanhas agendadas</p>
          <p className="text-xs text-text-secondary mt-1">
            Os horários foram espalhados de 7 em 7 minutos para não parecer disparo automático.
          </p>

          {pronto.pendencias.length > 0 && (
            <div className="mt-4 p-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] text-left">
              <p className="text-[11px] text-amber-500">
                Ficaram de fora por falta de cadastro: {pronto.pendencias.map((p: any) => p.marcaNome).join(', ')}.
              </p>
            </div>
          )}

          <div className="flex gap-2 justify-center mt-5">
            <Link href="/posts" className="btn-ghost text-xs">Ver os posts</Link>
            <button onClick={() => { setPronto(null); setTemplate(''); }} className="btn-cta text-xs">Nova campanha</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <Copy className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Campanha para várias marcas
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Escreva uma vez, publique em todos os clientes — cada um com os próprios dados.
        </p>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      <div className="card p-5 mb-4">
        <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Legenda base</label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={4}
          placeholder="Hoje é Dia da Pizza! Vem pra {{nome}}, aqui em {{cidade}}. Pede no {{telefone}} 🍕"
          className="input-field w-full resize-y"
        />

        <div className="flex flex-wrap gap-1.5 mt-2">
          {MARCACOES.map((m) => (
            <button
              key={m}
              onClick={() => setTemplate((t) => `${t}{{${m}}}`)}
              className="px-2 py-1 rounded-lg border border-border bg-bg-main text-[11px] font-mono text-text-secondary hover:border-primary/40 hover:text-primary transition-colors"
            >
              {`{{${m}}}`}
            </button>
          ))}
        </div>

        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Endereço da arte (opcional)"
          className="input-field w-full mt-3"
        />
      </div>

      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Empresas ({selecionadas.length} de {marcas.length})
          </span>
          <button
            onClick={() => setSelecionadas(selecionadas.length === marcas.length ? [] : marcas.map((m) => m.id))}
            className="text-[11px] text-primary hover:underline"
          >
            {selecionadas.length === marcas.length ? 'Nenhuma' : 'Todas'}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {marcas.map((m) => (
            <button
              key={m.id}
              onClick={() => alternar(m.id)}
              className={`px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors ${
                selecionadas.includes(m.id)
                  ? 'border-primary bg-primary/10 text-primary font-semibold'
                  : 'border-border bg-bg-main text-text-secondary'
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {conferindo && (
        <p className="flex items-center gap-1.5 text-[11px] text-text-muted mb-3">
          <Loader2 className="w-3 h-3 animate-spin" /> conferindo os cadastros...
        </p>
      )}

      {conferencia && (
        <>
          {conferencia.invalidas.length > 0 && (
            <div className="card p-4 mb-3 border-status-failed/40">
              <p className="flex items-start gap-2 text-[11px] text-status-failed">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                <span>
                  Essas marcações não existem: <strong>{conferencia.invalidas.map((m: string) => `{{${m}}}`).join(', ')}</strong>.
                  Elas sairiam escritas assim no post.
                </span>
              </p>
            </div>
          )}

          {conferencia.pendencias.length > 0 && (
            <div className="card p-4 mb-3 border-amber-500/40 bg-amber-500/[0.06]">
              <p className="text-[11px] font-semibold text-amber-500 mb-2">
                {conferencia.pendencias.length} empresa{conferencia.pendencias.length > 1 ? 's ficam' : ' fica'} de fora
              </p>
              <div className="space-y-1">
                {conferencia.pendencias.map((p: any) => (
                  <p key={p.marcaId} className="text-[11px] text-text-secondary">
                    <strong className="text-text-primary">{p.marcaNome}</strong> — falta {p.faltando.join(', ')}
                  </p>
                ))}
              </div>
              <Link href="/brands" className="text-[11px] text-primary hover:underline mt-2 inline-block">
                Completar cadastro
              </Link>
            </div>
          )}

          <button
            onClick={publicar}
            disabled={publicando || conferencia.prontas.length === 0 || conferencia.invalidas.length > 0}
            className="btn-cta w-full text-xs disabled:opacity-40"
          >
            {publicando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" strokeWidth={2.5} />}
            Agendar em {conferencia.prontas.length} empresa{conferencia.prontas.length === 1 ? '' : 's'}
          </button>
        </>
      )}
    </div>
  );
}
