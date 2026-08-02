import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { intervaloDoMes, variacao, montarHtml, DadosRelatorio } from './report.service';

/**
 * O relatorio vai para o CLIENTE da agencia. Um numero errado aqui nao e
 * bug interno — e credibilidade perdida na reuniao de renovacao.
 */

describe('intervaloDoMes', () => {
  test('pega o mês inteiro, do primeiro instante ao último', () => {
    const { inicio, fim } = intervaloDoMes(2026, 3);
    assert.equal(inicio.getDate(), 1);
    assert.equal(inicio.getHours(), 0);
    assert.equal(fim.getDate(), 31);
    assert.equal(fim.getHours(), 23);
    assert.equal(fim.getMinutes(), 59);
  });

  // Fevereiro e o mes que quebra implementacao ingenua.
  test('fevereiro comum termina no dia 28', () => {
    assert.equal(intervaloDoMes(2026, 2).fim.getDate(), 28);
  });

  test('fevereiro bissexto termina no dia 29', () => {
    assert.equal(intervaloDoMes(2024, 2).fim.getDate(), 29);
  });

  test('todo mês do ano tem 28 a 31 dias', () => {
    for (let mes = 1; mes <= 12; mes++) {
      const d = intervaloDoMes(2026, mes).fim.getDate();
      assert.ok(d >= 28 && d <= 31, `mes ${mes} terminou no dia ${d}`);
    }
  });

  test('dezembro não escorrega para janeiro', () => {
    const { fim } = intervaloDoMes(2026, 12);
    assert.equal(fim.getMonth(), 11);
    assert.equal(fim.getDate(), 31);
    assert.equal(fim.getFullYear(), 2026);
  });
});

describe('variacao', () => {
  test('calcula crescimento e queda', () => {
    assert.equal(variacao(15, 10), 50);
    assert.equal(variacao(5, 10), -50);
    assert.equal(variacao(10, 10), 0);
  });

  // Sem isto o relatorio mostraria "∞% de crescimento" no primeiro mes.
  test('mês anterior zerado devolve null, não infinito', () => {
    assert.equal(variacao(10, 0), null);
    assert.equal(variacao(0, 0), null);
  });

  test('arredonda para inteiro', () => {
    assert.equal(variacao(7, 3), 133);
    assert.ok(Number.isInteger(variacao(7, 3)!));
  });
});

describe('montarHtml', () => {
  const base: DadosRelatorio = {
    marca: 'Pizzaria Essenza',
    cor: '#e11d48',
    periodo: 'março de 2026',
    publicados: 12,
    agendados: 4,
    curtidas: 0,
    comentarios: 0,
    variacaoPosts: 20,
    melhores: [{ caption: 'Promoção de terça', curtidas: 0, comentarios: 0, data: '10/03/2026' }],
    porPlataforma: { INSTAGRAM: 10, FACEBOOK: 2 },
  };

  test('traz os números principais', () => {
    const h = montarHtml(base);
    assert.ok(h.includes('Pizzaria Essenza'));
    assert.ok(h.includes('>12<'));
    assert.ok(h.includes('março de 2026'));
    assert.ok(h.includes('INSTAGRAM'));
  });

  test('mostra crescimento e queda com sinais diferentes', () => {
    assert.ok(montarHtml({ ...base, variacaoPosts: 20 }).includes('▲ 20%'));
    assert.ok(montarHtml({ ...base, variacaoPosts: -30 }).includes('▼ 30%'));
  });

  test('primeiro mês não mostra percentual', () => {
    const h = montarHtml({ ...base, variacaoPosts: null });
    assert.ok(h.includes('primeiro mês'));
    assert.ok(!h.includes('▲'));
    assert.ok(!h.includes('Infinity'));
  });

  // O nome da marca e a legenda vem do usuario e vao direto para o HTML.
  test('escapa HTML vindo do usuário', () => {
    const h = montarHtml({ ...base, marca: '<script>alert(1)</script>' });
    assert.ok(!h.includes('<script>alert(1)</script>'));
    assert.ok(h.includes('&lt;script&gt;'));
  });

  test('escapa também na legenda dos posts', () => {
    const h = montarHtml({
      ...base,
      melhores: [{ caption: '<img src=x onerror=alert(1)>', curtidas: 0, comentarios: 0, data: '01/03' }],
    });
    assert.ok(!h.includes('<img src=x'));
  });

  // Cor vem do cadastro e entra num atributo de estilo.
  test('cor inválida cai no padrão em vez de quebrar o CSS', () => {
    const h = montarHtml({ ...base, cor: 'red;}body{display:none' });
    assert.ok(!h.includes('display:none'));
    assert.ok(h.includes('#7c3aed'));
  });

  test('mês vazio não quebra o relatório', () => {
    const h = montarHtml({ ...base, publicados: 0, agendados: 0, melhores: [], porPlataforma: {} });
    assert.ok(h.includes('Nenhuma publicação no período'));
  });
});
