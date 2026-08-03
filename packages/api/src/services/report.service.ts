import { prisma } from '../config/database';
import { consolidarReceita, calcularRoi, formatarReais } from './attribution.service';

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
    // As metricas de engajamento vem do Instagram e nem sempre estao
    // disponiveis; zero aqui significa "sem dado", nao "sem engajamento".
    curtidas: 0,
    comentarios: 0,
    variacaoPosts: variacao(publicados.length, publicadosAnterior),
    melhores: publicados.slice(0, 5).map((p) => ({
      caption: (p.caption || '(sem legenda)').slice(0, 120),
      curtidas: 0,
      comentarios: 0,
      data: p.publishedAt ? new Date(p.publishedAt).toLocaleDateString('pt-BR') : '',
    })),
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

  const melhores = d.melhores.length
    ? d.melhores.map((m) => `
        <tr>
          <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:11px;color:#666">${esc(m.data)}</td>
          <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:11px">${esc(m.caption)}</td>
        </tr>`).join('')
    : '<tr><td colspan="2" style="padding:12px;color:#888;font-size:11px">Nenhuma publicação no período</td></tr>';

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
  </div>

  <h2 style="font-size:14px;font-weight:700;margin:0 0 8px">Por canal</h2>
  <ul style="font-size:12px;color:#333;margin:0 0 22px;padding-left:18px;line-height:1.7">${plataformas}</ul>

  <h2 style="font-size:14px;font-weight:700;margin:0 0 8px">Publicações do período</h2>
  <table style="width:100%;border-collapse:collapse">
    <thead>
      <tr style="text-align:left">
        <th style="padding:6px;font-size:10px;color:#888;text-transform:uppercase;width:80px">Data</th>
        <th style="padding:6px;font-size:10px;color:#888;text-transform:uppercase">Publicação</th>
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
