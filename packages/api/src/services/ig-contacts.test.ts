import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, usernamesFromPost, extractMentions } from './ig-contacts.service';

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

/**
 * A agenda nasce das legendas antigas. Se a extracao pegar lixo (e-mail,
 * pontuacao final), o autocomplete sugere @ que nao existem.
 */
describe('extractMentions', () => {
  test('pega os @ de uma legenda', () => {
    assert.deepEqual(
      extractMentions('Parceria com @jusciaracassia e @loja.oficial hoje!'),
      ['jusciaracassia', 'loja.oficial'],
    );
  });

  test('@ no comeco da legenda tambem conta', () => {
    assert.deepEqual(extractMentions('@jus mandou bem'), ['jus']);
  });

  test('ignora e-mail', () => {
    assert.deepEqual(extractMentions('fale com contato@empresa.com'), []);
  });

  test('nao leva a pontuacao junto', () => {
    assert.deepEqual(extractMentions('valeu @jus!'), ['jus']);
    assert.deepEqual(extractMentions('foi o @jus, sim'), ['jus']);
  });

  // Frase terminada em mencao e comum. Antes o @ inteiro era descartado.
  test('tira o ponto final sem perder o @', () => {
    assert.deepEqual(extractMentions('obrigado @jus.'), ['jus']);
    assert.deepEqual(extractMentions('parceria @loja.oficial.'), ['loja.oficial']);
  });

  test('ignora @ de uma letra so', () => {
    assert.deepEqual(extractMentions('nota @a apenas'), []);
  });

  test('legenda vazia ou nula nao quebra', () => {
    assert.deepEqual(extractMentions(''), []);
    assert.deepEqual(extractMentions(null), []);
    assert.deepEqual(extractMentions(undefined), []);
  });

  test('normaliza a caixa', () => {
    assert.deepEqual(extractMentions('com @JusciaraCassia'), ['jusciaracassia']);
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
