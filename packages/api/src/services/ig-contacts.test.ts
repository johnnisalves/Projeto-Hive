import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, usernamesFromPost } from './ig-contacts.service';

/**
 * O que esta sendo protegido: se a normalizacao vazar caixa alta ou o "@",
 * a agenda cria duplicatas (@Jus, @jus, jus) e o autocomplete fica sujo —
 * a chave unica e (userId, username).
 */

describe('normalizeUsername', () => {
  test('remove o @ do inicio', () => {
    assert.equal(normalizeUsername('@jusciaracassia'), 'jusciaracassia');
  });

  test('remove @ repetido', () => {
    assert.equal(normalizeUsername('@@jus'), 'jus');
  });

  test('baixa a caixa (o Instagram nao diferencia)', () => {
    assert.equal(normalizeUsername('@JusciaraCassia'), 'jusciaracassia');
  });

  test('tira espacos nas pontas', () => {
    assert.equal(normalizeUsername('  @jus  '), 'jus');
  });

  test('string vazia continua vazia', () => {
    assert.equal(normalizeUsername('   '), '');
    assert.equal(normalizeUsername('@'), '');
  });

  test('nao mexe em ponto e underscore, que sao validos no @', () => {
    assert.equal(normalizeUsername('@jus.ciara_cassia'), 'jus.ciara_cassia');
  });
});

describe('usernamesFromPost', () => {
  test('junta marcacoes e colaboradores', () => {
    const r = usernamesFromPost({
      userTags: [{ username: 'ana' }, { username: '@bruno' }],
      collaborators: ['carla'],
    });
    assert.deepEqual(r, ['ana', '@bruno', 'carla']);
  });

  test('post sem @ nenhum devolve lista vazia', () => {
    assert.deepEqual(usernamesFromPost({}), []);
  });

  test('ignora formato invalido em vez de quebrar', () => {
    const r = usernamesFromPost({
      userTags: 'nao e array' as unknown,
      collaborators: [42, null, 'ok'] as unknown,
    });
    assert.deepEqual(r, ['ok']);
  });

  test('marcacao sem username e descartada', () => {
    const r = usernamesFromPost({ userTags: [{ x: 1 } as never, { username: 'ok' }] });
    assert.deepEqual(r, ['ok']);
  });
});
