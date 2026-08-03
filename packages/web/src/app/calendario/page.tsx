'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Loader2, Download, Table2, LayoutGrid, Share2, Sparkles, X, Check } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Calendário de conteúdo do mês.
 *
 * O briefing vira uma grade com DATAS REAIS — o cronograma sai do servidor,
 * nunca da IA. Ela só preenche o conteúdo de cada data.
 *
 * A diferença para uma ferramenta que só planeja: aqui a grade pode virar
 * posts de verdade, porque o DisparaAI publica.
 */

const PLATAFORMAS = ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TIKTOK', 'THREADS', 'X'];
const ROTULO_PLAT: Record<string, string> = {
  INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', LINKEDIN: 'LinkedIn',
  TIKTOK: 'TikTok', THREADS: 'Threads', X: 'X',
};
const OBJETIVOS = ['Crescer audiência', 'Vender', 'Engajar', 'Autoridade', 'Lançamento'];
const TONS = ['Próximo e amigável', 'Direto e profissional', 'Inspirador', 'Divertido', 'Educativo', 'Sofisticado'];
const FREQUENCIAS = [
  { v: '3x', r: '3x / semana' }, { v: '5x', r: '5x / semana' },
  { v: 'diario', r: 'Diário' }, { v: 'personalizado', r: 'Personalizar' },
] as const;
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const CORES = ['#6C5CE7', '#E84393', '#00B894', '#FDCB6E', '#0984E3', '#E17055'];
const BASE = process.env.NEXT_PUBLIC_API_URL || '';

type Post = {
  data: string; plataforma: string; formato: string; pilar: string;
  titulo: string; gancho: string; descricao: string; cta: string;
  hashtags: string[]; horario: string;
};

export default function CalendarioPage() {
  const router = useRouter();
  const hoje = new Date();

  const [marcas, setMarcas] = useState<Array<{ id: string; name: string }>>([]);
  const [brandId, setBrandId] = useState('');
  const [nicho, setNicho] = useState('');
  const [publico, setPublico] = useState('');
  const [plataformas, setPlataformas] = useState<string[]>(['INSTAGRAM']);
  const [objetivo, setObjetivo] = useState('Vender');
  const [tom, setTom] = useState(TONS[0]);
  const [frequencia, setFrequencia] = useState<'3x' | '5x' | 'diario' | 'personalizado'>('3x');
  const [dias, setDias] = useState<number[]>([1, 3, 5]);
  const [pilares, setPilares] = useState('');
  const [quando, setQuando] = useState(`${hoje.getFullYear()}-${hoje.getMonth() + 1}`);

  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [aba, setAba] = useState<'grade' | 'tabela' | 'exportar'>('grade');
  const [detalhe, setDetalhe] = useState<Post | null>(null);
  const [agendando, setAgendando] = useState(false);
  const [agendado, setAgendado] = useState<number | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.listBrands()
      .then((b) => {
        setMarcas(b.items || []);
        if (b.items?.[0]) setBrandId(b.items[0].id);
      })
      .catch(() => {});
  }, []);

  const meses = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
    return {
      v: `${d.getFullYear()}-${d.getMonth() + 1}`,
      r: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    };
  });

  function alternar<T>(lista: T[], set: (v: T[]) => void, item: T) {
    set(lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]);
  }

  async function gerar() {
    setErro('');
    if (nicho.trim().length < 5) { setErro('Descreva o negócio para eu montar o calendário.'); return; }
    if (!plataformas.length) { setErro('Escolha ao menos uma plataforma.'); return; }
    if (frequencia === 'personalizado' && !dias.length) { setErro('Escolha ao menos um dia da semana.'); return; }

    setGerando(true);
    setResultado(null);
    setAgendado(null);
    try {
      const [ano, mes] = quando.split('-').map(Number);
      const r = await api.gerarCalendario({
        nicho: nicho.trim(),
        publico: publico.trim() || undefined,
        plataformas, objetivo, tom, frequencia,
        diasDaSemana: frequencia === 'personalizado' ? dias : undefined,
        ano, mes,
        pilares: pilares.split(',').map((p) => p.trim()).filter(Boolean).slice(0, 8),
        brandId: brandId || undefined,
      });
      setResultado(r);
      setAba('grade');
    } catch (e: any) {
      setErro(e?.message || 'Falha ao gerar');
    }
    setGerando(false);
  }

  /**
   * Baixa CSV ou ICS.
   *
   * Vai por POST porque o calendário inteiro viaja no corpo — numa query
   * string ele estouraria o limite de URL já com uns 15 posts.
   */
  async function baixar(tipo: 'csv' | 'ics') {
    const [ano, mes] = quando.split('-').map(Number);
    const r = await fetch(`${BASE}/api/calendario/${tipo}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
      },
      body: JSON.stringify({ posts: resultado.posts, nicho, mes, ano }),
    });
    if (!r.ok) { setErro('Falha ao baixar o arquivo.'); return; }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `calendario.${tipo}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function agendar() {
    setAgendando(true);
    setErro('');
    try {
      const r = await api.agendarCalendario(resultado.posts, brandId || undefined);
      setAgendado(r.criados);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao agendar');
    }
    setAgendando(false);
  }

  const corDoPilar = (pilar: string) => {
    const i = (resultado?.pilares || []).findIndex((p: any) => p.nome === pilar);
    return CORES[(i < 0 ? 0 : i) % CORES.length];
  };

  // A grade começa no domingo da semana do dia 1, para as colunas baterem
  // com os dias da semana como num calendário de parede.
  function celulasDaGrade(): Array<{ dia: number | null; posts: Post[] }> {
    if (!resultado) return [];
    const primeiro = new Date(resultado.ano, resultado.mes - 1, 1);
    const ultimo = new Date(resultado.ano, resultado.mes, 0).getDate();
    const celulas: Array<{ dia: number | null; posts: Post[] }> = [];
    for (let i = 0; i < primeiro.getDay(); i++) celulas.push({ dia: null, posts: [] });
    for (let d = 1; d <= ultimo; d++) {
      celulas.push({
        dia: d,
        posts: (resultado.posts as Post[]).filter((p) => new Date(p.data).getDate() === d),
      });
    }
    return celulas;
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-page-title text-text-primary">
          <CalendarDays className="w-6 h-6 text-primary" strokeWidth={1.5} />
          Calendário do mês
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Conte sobre o negócio e a IA monta o mês inteiro, com datas reais.
        </p>
      </div>

      {erro && <div className="card p-3 mb-4 border-status-failed/40"><p className="text-[11px] text-status-failed">{erro}</p></div>}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        {/* ---------------- Briefing ---------------- */}
        <div className="card p-5 h-fit">
          <h2 className="text-sm font-bold text-text-primary mb-3">Planeje seu mês</h2>

          {marcas.length > 0 && (
            <>
              <label className="block text-[11px] font-semibold text-text-secondary mb-1 uppercase tracking-wider">Empresa</label>
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input-field w-full mb-3">
                <option value="">Nenhuma</option>
                {marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </>
          )}

          <label className="block text-[11px] font-semibold text-text-secondary mb-1 uppercase tracking-wider">Negócio / tema</label>
          <textarea
            value={nicho} onChange={(e) => setNicho(e.target.value)} rows={3}
            placeholder="Ex.: pizzaria em Petrolina, delivery à noite e eventos no fim de semana"
            className="input-field w-full resize-y mb-3"
          />

          <label className="block text-[11px] font-semibold text-text-secondary mb-1 uppercase tracking-wider">
            Público-alvo <span className="text-text-muted normal-case font-normal">(opcional)</span>
          </label>
          <input
            value={publico} onChange={(e) => setPublico(e.target.value)}
            placeholder="Ex.: famílias 25-50 da cidade"
            className="input-field w-full mb-3"
          />

          <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Plataformas</label>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PLATAFORMAS.map((p) => (
              <button key={p} onClick={() => alternar(plataformas, setPlataformas, p)}
                className={`px-3 py-1.5 rounded-full border text-[11px] font-semibold transition-colors ${
                  plataformas.includes(p) ? 'border-primary bg-primary text-white' : 'border-border bg-bg-main text-text-secondary'
                }`}>
                {ROTULO_PLAT[p]}
              </button>
            ))}
          </div>

          <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Objetivo</label>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {OBJETIVOS.map((o) => (
              <button key={o} onClick={() => setObjetivo(o)}
                className={`px-3 py-1.5 rounded-full border text-[11px] font-semibold transition-colors ${
                  objetivo === o ? 'border-primary bg-primary text-white' : 'border-border bg-bg-main text-text-secondary'
                }`}>
                {o}
              </button>
            ))}
          </div>

          <label className="block text-[11px] font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Frequência</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {FREQUENCIAS.map((f) => (
              <button key={f.v} onClick={() => setFrequencia(f.v)}
                className={`px-3 py-1.5 rounded-full border text-[11px] font-semibold transition-colors ${
                  frequencia === f.v ? 'border-primary bg-primary text-white' : 'border-border bg-bg-main text-text-secondary'
                }`}>
                {f.r}
              </button>
            ))}
          </div>

          {frequencia === 'personalizado' && (
            <div className="flex gap-1 mb-3">
              {SEMANA.map((d, i) => (
                <button key={d} onClick={() => alternar(dias, setDias, i)}
                  className={`flex-1 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors ${
                    dias.includes(i) ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-bg-main text-text-secondary'
                  }`}>
                  {d}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary mb-1 uppercase tracking-wider">Mês</label>
              <select value={quando} onChange={(e) => setQuando(e.target.value)} className="input-field w-full">
                {meses.map((m) => <option key={m.v} value={m.v}>{m.r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary mb-1 uppercase tracking-wider">Tom</label>
              <select value={tom} onChange={(e) => setTom(e.target.value)} className="input-field w-full">
                {TONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <label className="block text-[11px] font-semibold text-text-secondary mb-1 uppercase tracking-wider">
            Pilares <span className="text-text-muted normal-case font-normal">(vazio = a IA sugere)</span>
          </label>
          <input
            value={pilares} onChange={(e) => setPilares(e.target.value)}
            placeholder="bastidores, ofertas, depoimentos"
            className="input-field w-full mb-4"
          />

          <button onClick={gerar} disabled={gerando} className="btn-cta w-full text-xs disabled:opacity-40">
            {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" strokeWidth={2.5} />}
            {gerando ? 'Montando o mês...' : 'Gerar calendário'}
          </button>
        </div>

        {/* ---------------- Resultado ---------------- */}
        <div className="card p-5">
          {!resultado ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CalendarDays className="w-10 h-10 text-text-muted mb-3" strokeWidth={1.5} />
              <p className="text-sm font-semibold text-text-primary">Seu mês de conteúdo, planejado</p>
              <p className="text-[11px] text-text-muted mt-1 max-w-sm">
                Descreva o negócio, escolha as plataformas e o ritmo. As datas são calculadas de verdade — sem
                dia 31 em mês de 30.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-bold text-text-primary capitalize">{resultado.periodo}</p>
                  <p className="text-[11px] text-text-muted">
                    {resultado.posts.length} posts · {plataformas.map((p) => ROTULO_PLAT[p]).join(', ')}
                    {resultado.posts.length < resultado.datasPrevistas &&
                      ` · a IA devolveu menos que as ${resultado.datasPrevistas} datas previstas`}
                  </p>
                </div>
                <div className="flex gap-1">
                  {([['grade', LayoutGrid], ['tabela', Table2], ['exportar', Share2]] as const).map(([k, Icone]) => (
                    <button key={k} onClick={() => setAba(k)}
                      className={`p-2 rounded-lg border transition-colors ${
                        aba === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary'
                      }`}>
                      <Icone className="w-4 h-4" strokeWidth={2} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {resultado.pilares.map((p: any) => (
                  <span key={p.nome} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-main border border-border text-[10px] text-text-secondary">
                    <span className="w-2 h-2 rounded-full" style={{ background: corDoPilar(p.nome) }} />
                    {p.nome}
                  </span>
                ))}
              </div>

              {aba === 'grade' && (
                <div>
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {SEMANA.map((d) => (
                      <div key={d} className="text-center text-[10px] font-bold text-text-muted uppercase py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {celulasDaGrade().map((c, i) => (
                      <div key={i} className={`min-h-[76px] rounded-lg border p-1 ${
                        c.dia ? 'border-border bg-bg-main' : 'border-transparent'
                      }`}>
                        {c.dia && <p className="text-[10px] text-text-muted mb-0.5">{c.dia}</p>}
                        {c.posts.map((p, j) => (
                          <button key={j} onClick={() => setDetalhe(p)}
                            className="w-full text-left p-1 rounded mb-0.5 hover:opacity-80 transition-opacity"
                            style={{ background: `${corDoPilar(p.pilar)}22`, borderLeft: `2px solid ${corDoPilar(p.pilar)}` }}>
                            <p className="text-[9px] font-semibold text-text-primary leading-tight line-clamp-2">{p.titulo}</p>
                            <p className="text-[8px] text-text-muted">{p.horario} · {ROTULO_PLAT[p.plataforma] || p.plataforma}</p>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {aba === 'tabela' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-text-muted uppercase text-[9px]">
                        <th className="p-1.5">Data</th><th className="p-1.5">Rede</th><th className="p-1.5">Formato</th>
                        <th className="p-1.5">Pilar</th><th className="p-1.5">Título</th><th className="p-1.5">Gancho</th>
                        <th className="p-1.5">CTA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resultado.posts as Post[]).map((p, i) => (
                        <tr key={i} onClick={() => setDetalhe(p)}
                          className="border-t border-border cursor-pointer hover:bg-bg-main transition-colors">
                          <td className="p-1.5 whitespace-nowrap text-text-secondary">
                            {new Date(p.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} {p.horario}
                          </td>
                          <td className="p-1.5 text-text-secondary">{ROTULO_PLAT[p.plataforma] || p.plataforma}</td>
                          <td className="p-1.5 text-text-secondary">{p.formato}</td>
                          <td className="p-1.5">
                            <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: `${corDoPilar(p.pilar)}22`, color: corDoPilar(p.pilar) }}>
                              {p.pilar}
                            </span>
                          </td>
                          <td className="p-1.5 text-text-primary font-medium">{p.titulo}</td>
                          <td className="p-1.5 text-text-secondary max-w-[180px] truncate">{p.gancho}</td>
                          <td className="p-1.5 text-text-secondary max-w-[120px] truncate">{p.cta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {aba === 'exportar' && (
                <div className="space-y-3">
                  {agendado !== null ? (
                    <div className="p-5 rounded-xl border border-status-published/50 bg-status-published/[0.06] text-center">
                      <Check className="w-8 h-8 text-status-published mx-auto mb-2" strokeWidth={3} />
                      <p className="text-sm font-bold text-text-primary">{agendado} posts criados</p>
                      <p className="text-[11px] text-text-secondary mt-1">
                        Entraram como rascunho, na data e hora sugeridas. Falta a arte de cada um.
                      </p>
                      <button onClick={() => router.push('/posts')} className="btn-cta mt-3 text-xs">Ver os posts</button>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl border border-primary/40 bg-primary/[0.06]">
                      <p className="text-sm font-bold text-text-primary">Virar posts no DisparaAI</p>
                      <p className="text-[11px] text-text-secondary mt-1 mb-3">
                        Cada linha vira um rascunho na data e hora sugeridas, com legenda e hashtags prontas.
                        Entram como rascunho porque ainda falta a arte — agendar sem imagem enfileiraria falhas.
                      </p>
                      <button onClick={agendar} disabled={agendando} className="btn-cta text-xs disabled:opacity-40">
                        {agendando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" strokeWidth={2.5} />}
                        Criar {resultado.posts.length} rascunhos
                      </button>
                    </div>
                  )}

                  <div className="p-4 rounded-xl border border-border bg-bg-main">
                    <p className="text-sm font-bold text-text-primary">Planilha (.csv)</p>
                    <p className="text-[11px] text-text-secondary mt-1 mb-2">
                      Abre no Excel, Google Sheets ou Notion. Uma linha por post.
                    </p>
                    <button onClick={() => baixar('csv')} className="btn-ghost text-xs">
                      <Download className="w-3.5 h-3.5" strokeWidth={2} /> Baixar .csv
                    </button>
                  </div>

                  <div className="p-4 rounded-xl border border-border bg-bg-main">
                    <p className="text-sm font-bold text-text-primary">Agenda (.ics)</p>
                    <p className="text-[11px] text-text-secondary mt-1 mb-2">
                      Importe no Google Agenda, Apple Calendar ou Outlook. Cada post vira um evento com lembrete
                      uma hora antes.
                    </p>
                    <button onClick={() => baixar('ics')} className="btn-ghost text-xs">
                      <Download className="w-3.5 h-3.5" strokeWidth={2} /> Baixar .ics
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---------------- Detalhe do post ---------------- */}
      {detalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setDetalhe(null)}>
          <div className="card p-5 max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] text-text-muted">
                  {new Date(detalhe.data).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} · {detalhe.horario}
                </p>
                <p className="text-base font-bold text-text-primary mt-0.5">{detalhe.titulo}</p>
              </div>
              <button onClick={() => setDetalhe(null)} className="p-1.5 rounded-lg border border-border text-text-secondary">
                <X className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-4">
              <span className="px-2 py-1 rounded-lg bg-bg-main border border-border text-[10px] text-text-secondary">
                {ROTULO_PLAT[detalhe.plataforma] || detalhe.plataforma}
              </span>
              <span className="px-2 py-1 rounded-lg bg-bg-main border border-border text-[10px] text-text-secondary">{detalhe.formato}</span>
              <span className="px-2 py-1 rounded-lg text-[10px]" style={{ background: `${corDoPilar(detalhe.pilar)}22`, color: corDoPilar(detalhe.pilar) }}>
                {detalhe.pilar}
              </span>
            </div>

            {([['Gancho', detalhe.gancho], ['Ideia', detalhe.descricao], ['Chamada para ação', detalhe.cta]] as const)
              .filter(([, v]) => v)
              .map(([rotulo, valor]) => (
                <div key={rotulo} className="mb-3">
                  <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">{rotulo}</p>
                  <p className="text-xs text-text-secondary">{valor}</p>
                </div>
              ))}

            {detalhe.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {detalhe.hashtags.map((h) => (
                  <span key={h} className="px-2 py-0.5 rounded-badge bg-primary/10 text-primary text-[10px] font-medium">#{h}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
