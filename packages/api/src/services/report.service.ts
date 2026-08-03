import { prisma } from '../config/database';
import { consolidarReceita, calcularRoi, formatarReais } from './attribution.service';
import { contaDaMarca, enderecoDaConta } from './account-resolver.service';

/**
 * Relatorio mensal por marca, em PDF.
 *
 * Agencia vive de PROVAR valor. Sem relatorio, o cliente lembra do que nao
 * saiu e esquece do que saiu — e o contrato cai na renovacao.
 *
 * O HTML e montado aqui e vira PDF no renderer, que ja tem Chromium.
 */

const RENDERER_URL = process.env.RENDERER_URL || 'http://renderer:3003';

export interface DadosRelatorio {
  marca: string;
  cor: string;
  periodo: string;
  publicados: number;
  agendados: number;
  curtidas: number;
  comentarios: number;
  /** Variacao percentual contra o mes anterior; null quando nao ha base. */
  variacaoPosts: number | null;
  melhores: Array<{ caption: string; curtidas: number; comentarios: number; data: string }>;
  porPlataforma: Record<string, number>;
  /**
   * Receita atribuida e ROI. Sao os numeros que renovam contrato — o resto
   * do relatorio conta o que foi FEITO, esta secao conta o que RENDEU.
   * Nulo quando nao ha nada atribuido no periodo: melhor omitir a secao do
   * que estampar "R$ 0,00" e parecer que o trabalho nao deu resultado.
   */
  receita: {
    totalCentavos: number;
    cupomCentavos: number;
    balcaoCentavos: number;
    vendasBalcao: number;
    cliques: number;
    /** Nulo quando a marca nao tem fee cadastrado. */
    roi: number | null;
    feeCentavos: number | null;
  } | null;
}

/** Primeiro e ultimo instante de um mes. */
export function intervaloDoMes(ano: number, mes: number): { inicio: Date; fim: Date } {
  return {
    inicio: new Date(ano, mes - 1, 1, 0, 0, 0, 0),
    // Dia 0 do mes seguinte = ultimo dia deste, com hora final.
    fim: new Date(ano, mes, 0, 23, 59, 59, 999),
  };
}

/**
 * Variacao percentual entre dois periodos.
 *
 * Quando o mes anterior teve zero posts nao existe percentual — dividir
 * por zero daria Infinity e a tela mostraria "∞% de crescimento". Nesse
 * caso devolvemos null e o relatorio escreve "primeiro mês".
 */
export function variacao(atual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

/**
 * Curtidas e comentarios reais do periodo, buscados no Instagram.
 *
 * Sem isso o relatorio saia com "0 curtidas" — pior que omitir, porque
 * parecia que o trabalho do mes nao engajou ninguem.
 *
 * Casamos pela LEGENDA e nao pelo id: o post publicado pelo DisparaAI
 * guarda o instagramId, mas os publicados por fora (ou antes da conexao)
 * nao teriam par nenhum, e o total do mes ficaria menor que a realidade.
 */
async function metricasDoPeriodo(
  userId: string,
  brandId: string,
  inicio: Date,
  fim: Date,
): Promise<{ curtidas: number; comentarios: number; porLegenda: Map<string, { curtidas: number; comentarios: number }> }> {
  const vazio = { curtidas: 0, comentarios: 0, porLegenda: new Map() };

  // A conta E DESTA MARCA. Antes isto pegava a conta padrao do dono, entao
  // o relatorio do cliente B saia com as curtidas do cliente A — o erro que
  // a agencia so descobre na reuniao com o cliente.
  const { conta, mensagem } = await contaDaMarca(userId, brandId);
  if (!conta) {
    if (mensagem) console.warn(`[Relatorio] Sem metricas para a marca ${brandId}: ${mensagem}`);
    return vazio;
  }

  const { base, uid } = enderecoDaConta(conta);

  try {
    const r = await fetch(
      `${base}/${uid}/media?fields=id,caption,timestamp,like_count,comments_count&limit=100&access_token=${conta.accessToken}`,
    );
    const j = (await r.json()) as any;
    if (j?.error) {
      console.warn('[Relatorio] Sem metricas do Instagram:', j.error.message);
      return vazio;
    }

    let curtidas = 0;
    let comentarios = 0;
    const porLegenda = new Map<string, { curtidas: number; comentarios: number }>();

    for (const m of j.data || []) {
      const quando = m.timestamp ? new Date(m.timestamp) : null;
      if (!quando || quando < inicio || quando > fim) continue;

      const l = Number(m.like_count || 0);
      const c = Number(m.comments_count || 0);
      curtidas += l;
      comentarios += c;
      if (m.caption) porLegenda.set(String(m.caption).slice(0, 60), { curtidas: l, comentarios: c });
    }

    return { curtidas, comentarios, porLegenda };
  } catch (e: any) {
    // Metrica indisponivel nao pode derrubar o relatorio inteiro: o resto
    // (o que foi publicado, a receita) continua valendo.
    console.warn('[Relatorio] Falha ao buscar metricas:', e?.message);
    return vazio;
  }
}

export async function coletarDados(userId: string, brandId: string, ano: number, mes: number): Promise<DadosRelatorio> {
  const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
  if (!brand) throw new Error('Marca nao encontrada');

  const { inicio, fim } = intervaloDoMes(ano, mes);
  const anteriorMes = mes === 1 ? 12 : mes - 1;
  const anteriorAno = mes === 1 ? ano - 1 : ano;
  const anterior = intervaloDoMes(anteriorAno, anteriorMes);

  const [publicados, agendados, publicadosAnterior, cupons, balcao, links] = await Promise.all([
    prisma.post.findMany({
      where: { userId, brandId, status: 'PUBLISHED', publishedAt: { gte: inicio, lte: fim } },
      orderBy: { publishedAt: 'desc' },
    }),
    prisma.post.count({
      where: { userId, brandId, status: 'SCHEDULED', scheduledAt: { gte: inicio, lte: fim } },
    }),
    prisma.post.count({
      where: { userId, brandId, status: 'PUBLISHED', publishedAt: { gte: anterior.inicio, lte: anterior.fim } },
    }),
    prisma.couponRedemption.findMany({
      where: { createdAt: { gte: inicio, lte: fim }, coupon: { userId, brandId } },
      select: { valorCentavos: true },
    }).catch(() => []),
    prisma.saleOrigin.findMany({
      where: { userId, brandId, createdAt: { gte: inicio, lte: fim } },
      select: { valorCentavos: true, origem: true },
    }).catch(() => []),
    prisma.shortLink.findMany({ where: { userId, brandId }, select: { clicks: true } }).catch(() => []),
  ]);

  const metricas = await metricasDoPeriodo(userId, brandId, inicio, fim);

  const porPlataforma: Record<string, number> = {};
  for (const p of publicados) {
    for (const plat of p.platforms) porPlataforma[plat] = (porPlataforma[plat] || 0) + 1;
  }

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const consolidado = consolidarReceita({ cupons, balcao });
  const cliques = links.reduce((s, l) => s + l.clicks, 0);
  // Sem nada atribuido, a secao inteira sai fora. Estampar "R$ 0,00" faria
  // o trabalho do mes parecer sem resultado, quando na verdade e so ausencia
  // de medicao.
  const temAtribuicao = consolidado.totalCentavos > 0 || cliques > 0;

  return {
    marca: brand.name,
    cor: brand.primaryColor || '#7c3aed',
    periodo: `${MESES[mes - 1]} de ${ano}`,
    publicados: publicados.length,
    agendados,
    // Vem do Instagram. Zero aqui significa "sem dado" (conta nao conectada
    // ou permissao faltando), nao "sem engajamento" — e o HTML escreve isso
    // com todas as letras em vez de estampar um zero seco.
    curtidas: metricas.curtidas,
    comentarios: metricas.comentarios,
    variacaoPosts: variacao(publicados.length, publicadosAnterior),
    melhores: publicados
      .map((p) => {
        const m = metricas.porLegenda.get((p.caption || '').slice(0, 60));
        return {
          caption: (p.caption || '(sem legenda)').slice(0, 120),
          curtidas: m?.curtidas ?? 0,
          comentarios: m?.comentarios ?? 0,
          data: p.publishedAt ? new Date(p.publishedAt).toLocaleDateString('pt-BR') : '',
        };
      })
      // Os MELHORES do mes, nao os mais recentes: e a secao que a agencia
      // usa para mostrar o que funcionou.
      .sort((a, b) => b.curtidas + b.comentarios * 3 - (a.curtidas + a.comentarios * 3))
      .slice(0, 5),
    porPlataforma,
    receita: temAtribuicao
      ? {
        ...consolidado,
        cliques,
        roi: calcularRoi(consolidado.totalCentavos, brand.feeCentavos),
        feeCentavos: brand.feeCentavos ?? null,
      }
      : null,
  };
}

/** Escapa texto do usuario antes de injetar no HTML do relatorio. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function montarHtml(d: DadosRelatorio): string {
  const cor = /^#[0-9a-f]{6}$/i.test(d.cor) ? d.cor : '#7c3aed';

  const variacaoTexto = d.variacaoPosts === null
    ? '<span style="color:#888">primeiro mês com publicações</span>'
    : d.variacaoPosts >= 0
      ? `<span style="color:#16a34a">▲ ${d.variacaoPosts}% vs. mês anterior</span>`
      : `<span style="color:#dc2626">▼ ${Math.abs(d.variacaoPosts)}% vs. mês anterior</span>`;

  const plataformas = Object.entries(d.porPlataforma)
    .map(([nome, qtd]) => `<li><strong>${esc(nome)}</strong>: ${qtd} publicações</li>`)
    .join('') || '<li style="color:#888">Nenhuma publicação no período</li>';

  // Zero engajamento com posts publicados quase sempre significa metrica
  // indisponivel, nao post ruim. Estampar "0 curtidas" faria o cliente achar
  // que o mes foi um fracasso.
  const semMetrica = d.publicados > 0 && d.curtidas === 0 && d.comentarios === 0;

  const melhores = d.melhores.length
    ? d.melhores.map((m) => `
        <tr>
          <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:11px;color:#666">${esc(m.data)}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:11px">${esc(m.caption)}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:11px;text-align:right;white-space:nowrap">${
  semMetrica ? '<span style="color:#bbb">—</span>' : `${m.curtidas} ❤ · ${m.comentarios} 💬`
}</td>
        </tr>`).join('')
    : '<tr><td colspan="3" style="padding:12px;color:#888;font-size:11px">Nenhuma publicação no período</td></tr>';

  const blocoEngajamento = semMetrica
    ? `<div style="flex:1;background:#f7f7f8;border-radius:10px;padding:14px">
         <div style="font-size:13px;font-weight:600;color:#999;margin-top:6px">sem dados</div>
         <div style="font-size:10px;color:#999;margin-top:4px">Conecte o Instagram para ver curtidas e comentários</div>
       </div>`
    : `<div style="flex:1;background:#f7f7f8;border-radius:10px;padding:14px">
         <div style="font-size:30px;font-weight:800;color:${cor}">${d.curtidas + d.comentarios}</div>
         <div style="font-size:11px;color:#666;margin-top:2px">interações no mês</div>
         <div style="font-size:10px;color:#888;margin-top:6px">${d.curtidas} curtidas · ${d.comentarios} comentários</div>
       </div>`;

  // A secao de dinheiro vem ANTES das metricas de atividade: e o que o dono
  // do negocio procura primeiro, e o que a agencia usa para renovar contrato.
  const r = d.receita;
  const secaoReceita = !r ? '' : `
  <div style="background:${cor};border-radius:12px;padding:18px;margin-bottom:24px;color:#fff">
    <div style="font-size:11px;opacity:.85;text-transform:uppercase;letter-spacing:.5px">Receita atribuída no mês</div>
    <div style="font-size:34px;font-weight:800;margin-top:4px">${esc(formatarReais(r.totalCentavos))}</div>
    ${r.roi !== null
      ? `<div style="font-size:12px;margin-top:8px;opacity:.95">
           Você investiu ${esc(formatarReais(r.feeCentavos || 0))} e o social devolveu
           <strong>${esc(String(r.roi))}x</strong> esse valor.
         </div>`
      : `<div style="font-size:11px;margin-top:8px;opacity:.8">
           Cadastre o valor do contrato na marca para ver o retorno sobre o investimento.
         </div>`}
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tbody>
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:11px;color:#666">Cupons resgatados no balcão</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:12px;font-weight:700;text-align:right">${esc(formatarReais(r.cupomCentavos))}</td>
      </tr>
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:11px;color:#666">Vendas marcadas como vindas do social (${r.vendasBalcao})</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:12px;font-weight:700;text-align:right">${esc(formatarReais(r.balcaoCentavos))}</td>
      </tr>
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:11px;color:#666">Cliques nos botões de pedido</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:12px;font-weight:700;text-align:right">${r.cliques}</td>
      </tr>
    </tbody>
  </table>`;

  return `
<div style="font-family:Inter,system-ui,sans-serif;color:#111">
  <div style="border-top:6px solid ${cor};padding-top:18px;margin-bottom:22px">
    <h1 style="font-size:26px;font-weight:800;margin:0">${esc(d.marca)}</h1>
    <p style="font-size:13px;color:#666;margin-top:4px">Relatório de ${esc(d.periodo)}</p>
  </div>
${secaoReceita}
  <div style="display:flex;gap:12px;margin-bottom:24px">
    <div style="flex:1;background:#f7f7f8;border-radius:10px;padding:14px">
      <div style="font-size:30px;font-weight:800;color:${cor}">${d.publicados}</div>
      <div style="font-size:11px;color:#666;margin-top:2px">publicações no mês</div>
      <div style="font-size:10px;margin-top:6px">${variacaoTexto}</div>
    </div>
    <div style="flex:1;background:#f7f7f8;border-radius:10px;padding:14px">
      <div style="font-size:30px;font-weight:800;color:${cor}">${d.agendados}</div>
      <div style="font-size:11px;color:#666;margin-top:2px">agendadas para o período</div>
    </div>
    ${blocoEngajamento}
  </div>

  <h2 style="font-size:14px;font-weight:700;margin:0 0 8px">Por canal</h2>
  <ul style="font-size:12px;color:#333;margin:0 0 22px;padding-left:18px;line-height:1.7">${plataformas}</ul>

  <h2 style="font-size:14px;font-weight:700;margin:0 0 8px">Destaques do período</h2>
  <table style="width:100%;border-collapse:collapse">
    <thead>
      <tr style="text-align:left">
        <th style="padding:6px;font-size:10px;color:#888;text-transform:uppercase;width:80px">Data</th>
        <th style="padding:6px;font-size:10px;color:#888;text-transform:uppercase">Publicação</th>
        <th style="padding:6px;font-size:10px;color:#888;text-transform:uppercase;text-align:right">Engajamento</th>
      </tr>
    </thead>
    <tbody>${melhores}</tbody>
  </table>

  <p style="margin-top:28px;font-size:9px;color:#aaa;border-top:1px solid #eee;padding-top:10px">
    Gerado pelo DisparaAI · ${new Date().toLocaleDateString('pt-BR')}
  </p>
</div>`;
}

/** Manda o HTML para o renderer e devolve o PDF. */
export async function gerarPdf(html: string): Promise<Buffer> {
  const res = await fetch(`${RENDERER_URL}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, format: 'A4' }),
    signal: AbortSignal.timeout(30000),
  });
  const data = (await res.json()) as any;
  if (!res.ok || !data?.pdf) throw new Error(data?.error || 'Renderer nao devolveu o PDF');
  return Buffer.from(data.pdf, 'base64');
}
