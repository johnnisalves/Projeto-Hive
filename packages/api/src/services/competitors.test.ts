import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analisarMidias, delta } from './competitors.service';

/**
 * O radar existe para comparar VOCE com o concorrente. Numero errado aqui
 * leva a decisao errada de estrategia — postar mais, postar menos, mudar
 * horario — e o erro so aparece meses depois.
 */

const agora = new Date(2026, 2, 31, 12, 0, 0);
const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000).toISOString();

describe('analisarMidias', () => {
  test('conta só os posts dos últimos 30 dias', () => {
    const r = analisarMidias([
      { timestamp: diasAtras(1), like_count: 10 },
      { timestamp: diasAtras(15), like_count: 20 },
      { timestamp: diasAtras(29), like_count: 30 },
      { timestamp: diasAtras(45), like_count: 40 },  // fora da janela
      { timestamp: diasAtras(200), like_count: 50 }, // fora da janela
    ], agora);
    assert.equal(r.postsLast30, 3);
  });

  // A media de curtidas usa TODAS as midias retornadas, nao so as recentes:
  // e uma medida de desempenho tipico, nao de atividade.
  test('a média de curtidas considera todas as mídias', () => {
    const r = analisarMidias([
      { timestamp: diasAtras(1), like_count: 100 },
      { timestamp: diasAtras(60), like_count: 200 },
    ], agora);
    assert.equal(r.avgLikes, 150);
  });

  // Contar post sem dado como zero derrubaria a media e faria o
  // concorrente parecer mais fraco do que e.
  test('post sem curtida disponível não entra na média', () => {
    const r = analisarMidias([
      { timestamp: diasAtras(1), like_count: 100 },
      { timestamp: diasAtras(2) },                    // sem like_count
      { timestamp: diasAtras(3), like_count: 200 },
    ], agora);
    assert.equal(r.avgLikes, 150);
  });

  test('conta parada há meses aparece com zero posts recentes', () => {
    const r = analisarMidias([
      { timestamp: diasAtras(120), like_count: 500 },
      { timestamp: diasAtras(200), like_count: 400 },
    ], agora);
    assert.equal(r.postsLast30, 0);
    assert.equal(r.avgLikes, 450); // mas a media historica continua alta
  });

  test('lista vazia não quebra', () => {
    const r = analisarMidias([], agora);
    assert.equal(r.postsLast30, 0);
    assert.equal(r.avgLikes, 0);
  });

  test('mídia sem timestamp é ignorada na contagem', () => {
    const r = analisarMidias([{ like_count: 10 }, { timestamp: diasAtras(1), like_count: 20 }], agora);
    assert.equal(r.postsLast30, 1);
  });

  test('a média sai arredondada', () => {
    const r = analisarMidias([
      { timestamp: diasAtras(1), like_count: 10 },
      { timestamp: diasAtras(2), like_count: 11 },
      { timestamp: diasAtras(3), like_count: 11 },
    ], agora);
    assert.ok(Number.isInteger(r.avgLikes));
  });

  test('exatamente 30 dias ainda conta', () => {
    const r = analisarMidias([{ timestamp: diasAtras(30), like_count: 5 }], agora);
    assert.equal(r.postsLast30, 1);
  });
});

describe('delta', () => {
  test('calcula ganho e perda de seguidores', () => {
    assert.equal(delta(1200, 1000), 200);
    assert.equal(delta(900, 1000), -100);
    assert.equal(delta(1000, 1000), 0);
  });

  // Primeiro check nao tem base de comparacao. Mostrar "+1200 seguidores"
  // no primeiro dia seria mentira.
  test('sem check anterior devolve null', () => {
    assert.equal(delta(1200, null), null);
    assert.equal(delta(1200, undefined), null);
    assert.equal(delta(null, 1000), null);
  });
});
