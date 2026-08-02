import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCota, separarPorCota, normalizarTag, COTA_SEMANAL } from './trends.service';

/**
 * Estourar a cota de hashtags NAO devolve erro amigavel: o Meta bloqueia a
 * consulta de hashtag da conta inteira ate a janela de 7 dias girar. Errar
 * a conta aqui tira uma funcionalidade do ar por uma semana.
 */

const hoje = new Date(2026, 5, 15, 12, 0, 0);
const diasAtras = (n: number) => new Date(hoje.getTime() - n * 86_400_000);

describe('normalizarTag', () => {
  test('tira o # e baixa a caixa', () => {
    assert.equal(normalizarTag('#Pizzaria'), 'pizzaria');
    assert.equal(normalizarTag('  #PIZZA  '), 'pizza');
  });

  test('remove acento e pontuação que o Instagram não aceita', () => {
    assert.equal(normalizarTag('#promoção!'), 'promoo');
    assert.equal(normalizarTag('marketing-digital'), 'marketingdigital');
  });

  test('mantém underscore, que é válido', () => {
    assert.equal(normalizarTag('#pizza_boa'), 'pizza_boa');
  });
});

describe('calcularCota', () => {
  // Consultar #pizza cinco vezes gasta UMA posicao, nao cinco.
  test('conta hashtags distintas, não consultas', () => {
    const c = calcularCota([
      { tag: 'pizza', queriedAt: diasAtras(1) },
      { tag: 'pizza', queriedAt: diasAtras(2) },
      { tag: 'pizza', queriedAt: diasAtras(3) },
      { tag: 'forno', queriedAt: diasAtras(1) },
    ], hoje);
    assert.equal(c.usadas, 2);
    assert.equal(c.restantes, COTA_SEMANAL - 2);
  });

  test('ignora consultas fora da janela de 7 dias', () => {
    const c = calcularCota([
      { tag: 'antiga', queriedAt: diasAtras(8) },
      { tag: 'recente', queriedAt: diasAtras(6) },
    ], hoje);
    assert.equal(c.usadas, 1);
    assert.deepEqual(c.jaConsultadas, ['recente']);
  });

  test('exatamente 7 dias ainda está dentro', () => {
    const c = calcularCota([{ tag: 'limite', queriedAt: diasAtras(7) }], hoje);
    assert.equal(c.usadas, 1);
  });

  test('sem consultas, cota cheia', () => {
    const c = calcularCota([], hoje);
    assert.equal(c.usadas, 0);
    assert.equal(c.restantes, COTA_SEMANAL);
  });

  // Nunca devolver negativo: um "restantes: -3" viraria comportamento
  // estranho em qualquer conta que dependa desse numero.
  test('cota estourada não fica negativa', () => {
    const muitas = Array.from({ length: 40 }, (_, i) => ({ tag: `t${i}`, queriedAt: diasAtras(1) }));
    const c = calcularCota(muitas, hoje);
    assert.equal(c.restantes, 0);
    assert.ok(c.usadas > COTA_SEMANAL);
  });
});

describe('separarPorCota', () => {
  test('tag já consultada passa mesmo com cota zerada', () => {
    const cota = { usadas: 30, restantes: 0, jaConsultadas: ['pizza'] };
    const r = separarPorCota(['pizza', 'nova'], cota);
    assert.deepEqual(r.liberadas, ['pizza']);
    assert.deepEqual(r.bloqueadas, ['nova']);
  });

  test('libera novas até o limite e bloqueia o resto', () => {
    const cota = { usadas: 28, restantes: 2, jaConsultadas: [] };
    const r = separarPorCota(['a', 'b', 'c', 'd'], cota);
    assert.deepEqual(r.liberadas, ['a', 'b']);
    assert.deepEqual(r.bloqueadas, ['c', 'd']);
  });

  test('nada é silenciosamente descartado', () => {
    const cota = { usadas: 29, restantes: 1, jaConsultadas: ['x'] };
    const pedidas = ['x', 'a', 'b', 'c'];
    const r = separarPorCota(pedidas, cota);
    assert.equal(r.liberadas.length + r.bloqueadas.length, pedidas.length);
  });

  test('cota cheia libera tudo', () => {
    const cota = { usadas: 0, restantes: COTA_SEMANAL, jaConsultadas: [] };
    const r = separarPorCota(['a', 'b', 'c'], cota);
    assert.equal(r.bloqueadas.length, 0);
  });

  test('lista vazia não quebra', () => {
    const r = separarPorCota([], { usadas: 0, restantes: 30, jaConsultadas: [] });
    assert.deepEqual(r.liberadas, []);
    assert.deepEqual(r.bloqueadas, []);
  });
});
