import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classificarPilar, analisarEquilibrio, TOLERANCIA } from './pillars.service';

/**
 * A analise diz ao usuario se ele esta vendendo demais ou de menos.
 * Classificar errado inverte o conselho — e ele muda a estrategia do mes
 * inteiro baseado num numero errado.
 */

describe('classificarPilar', () => {
  const casos: Array<[string, string]> = [
    ['vender', 'Aproveite: 20% de desconto até domingo'],
    ['vender', 'Link na bio para garantir o seu'],
    ['vender', 'Últimas unidades disponíveis'],
    ['vender', 'Faça seu pedido pelo direct'],
    ['educar', 'Dica: como escolher a farinha certa'],
    ['educar', 'Você sabia que a massa precisa descansar?'],
    ['educar', 'O erro mais comum na hora de assar'],
    ['educar', 'Entenda a diferença entre os dois tipos'],
    ['engajar', 'Bastidores de mais um dia por aqui'],
    ['engajar', 'Time reunido hoje 💜'],
  ];

  for (const [esperado, texto] of casos) {
    test(`"${texto.slice(0, 40)}..." -> ${esperado}`, () => {
      assert.equal(classificarPilar(texto), esperado);
    });
  }

  // Post que ensina E chama para comprar e, na pratica, venda. Classificar
  // como "educar" faria a analise dizer que a conta vende pouco.
  test('venda vence quando a legenda faz as duas coisas', () => {
    assert.equal(classificarPilar('Dica de preparo! E aproveite o desconto de hoje'), 'vender');
    assert.equal(classificarPilar('Aprenda a usar — link na bio'), 'vender');
  });

  test('legenda vazia ou nula não quebra', () => {
    assert.equal(classificarPilar(''), 'engajar');
    assert.equal(classificarPilar(null), 'engajar');
    assert.equal(classificarPilar(undefined), 'engajar');
  });

  test('caixa alta não atrapalha', () => {
    assert.equal(classificarPilar('PROMOÇÃO IMPERDÍVEL'), 'vender');
  });
});

describe('analisarEquilibrio', () => {
  const mix = { vender: 3, educar: 4, engajar: 3 };

  test('o pilar salvo no post vence a inferência', () => {
    const r = analisarEquilibrio(
      [{ pilar: 'educar', caption: 'Compre agora com desconto!' }],
      mix,
    );
    assert.equal(r.atual.educar, 1);
    assert.equal(r.atual.vender, 0);
  });

  // Pesos viram percentual: 3/4/3 e 30/40/30 tem que dar o mesmo alvo.
  test('pesos relativos e percentuais dão o mesmo alvo', () => {
    const a = analisarEquilibrio([], { vender: 3, educar: 4, engajar: 3 });
    const b = analisarEquilibrio([], { vender: 30, educar: 40, engajar: 30 });
    assert.deepEqual(a.alvo, b.alvo);
    assert.equal(a.alvo.educar, 40);
  });

  test('calcula o desvio em pontos percentuais', () => {
    // 10 posts, todos de venda: 100% contra alvo de 30%
    const r = analisarEquilibrio(
      Array(10).fill({ pilar: 'vender' }),
      mix,
    );
    assert.equal(r.percentual.vender, 100);
    assert.equal(r.desvio.vender, 70);
    assert.equal(r.desvio.educar, -40);
  });

  test('avisa quando vende demais', () => {
    const r = analisarEquilibrio(Array(10).fill({ pilar: 'vender' }), mix);
    assert.ok(r.alertas.some((a) => a.includes('venda')));
  });

  test('avisa quando falta conteúdo educativo', () => {
    const r = analisarEquilibrio(Array(10).fill({ pilar: 'engajar' }), mix);
    assert.ok(r.alertas.some((a) => a.includes('educativo')));
  });

  // Alertar com 2 posts seria ruido, e ruido treina o usuario a ignorar.
  test('poucos posts não geram alerta', () => {
    const r = analisarEquilibrio(Array(3).fill({ pilar: 'vender' }), mix);
    assert.equal(r.alertas.length, 0);
  });

  test('mix equilibrado não gera alerta', () => {
    const posts = [
      ...Array(3).fill({ pilar: 'vender' }),
      ...Array(4).fill({ pilar: 'educar' }),
      ...Array(3).fill({ pilar: 'engajar' }),
    ];
    const r = analisarEquilibrio(posts, mix);
    assert.equal(r.alertas.length, 0);
    for (const p of ['vender', 'educar', 'engajar'] as const) {
      assert.ok(Math.abs(r.desvio[p]) <= TOLERANCIA);
    }
  });

  test('lista vazia devolve zeros sem quebrar', () => {
    const r = analisarEquilibrio([], mix);
    assert.equal(r.total, 0);
    assert.equal(r.percentual.vender, 0);
    assert.equal(r.alertas.length, 0);
  });

  test('mix zerado não divide por zero', () => {
    const r = analisarEquilibrio([{ pilar: 'vender' }], { vender: 0, educar: 0, engajar: 0 });
    assert.ok(Number.isFinite(r.alvo.vender));
  });
});
