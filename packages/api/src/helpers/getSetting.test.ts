import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { podeLerSemDono } from './getSetting';

/**
 * O HISTORICO desta regra, em duas correcoes:
 *
 * 1. O codigo original lia "a configuracao do dono mais ANTIGO" quando nao
 *    sabia de quem era a acao. Numa instalacao com varias agencias, a chave
 *    de IA da primeira que se cadastrou atendia todas — ela pagava a conta
 *    de todo mundo.
 *
 * 2. Eu bloqueei toda leitura sem dono. Fechou o vazamento e quebrou o caso
 *    comum: a chave que o proprio usuario salva pela tela ficou invisivel
 *    para geracao de imagem e upload.
 *
 * A regra atual e a mesma do resolvedor de contas: sem ambiguidade, usar e
 * seguro.
 */

describe('podeLerSemDono', () => {
  // Uma instalacao com um dono so nao tem de quem vazar: a configuracao
  // encontrada e necessariamente dele.
  test('um dono so: pode ler', () => {
    assert.equal(podeLerSemDono(1), true);
  });

  // A partir do segundo, "a primeira que aparecer" e uma loteria que uma
  // agencia perde pagando a conta da outra.
  test('dois ou mais donos: nao pode', () => {
    assert.equal(podeLerSemDono(2), false);
    assert.equal(podeLerSemDono(40), false);
  });

  // Instalacao vazia: nao ha configuracao de ninguem para ler, e devolver
  // true so gastaria uma consulta que nao acha nada.
  test('nenhum dono: nao pode', () => {
    assert.equal(podeLerSemDono(0), false);
  });

  test('contagem negativa (dado corrompido) nao libera', () => {
    assert.equal(podeLerSemDono(-1), false);
  });
});
