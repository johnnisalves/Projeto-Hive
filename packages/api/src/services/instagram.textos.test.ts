import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { montarTextos } from './instagram.service';

/**
 * Errar aqui tem duas formas ruins: publicar SEM as hashtags (perde
 * alcance) ou com elas DUPLICADAS na legenda e no comentario (parece
 * amador). Nenhuma das duas aparece antes do post estar no ar.
 */

describe('montarTextos', () => {
  const tags = ['pizza', 'petrolina'];

  test('modo normal junta legenda e hashtags', () => {
    const r = montarTextos('Nossa pizza de hoje', tags, false);
    assert.equal(r.legenda, 'Nossa pizza de hoje\n\n#pizza #petrolina');
    assert.equal(r.primeiroComentario, null);
  });

  test('primeiro comentário deixa a legenda limpa', () => {
    const r = montarTextos('Nossa pizza de hoje', tags, true);
    assert.equal(r.legenda, 'Nossa pizza de hoje');
    assert.equal(r.primeiroComentario, '#pizza #petrolina');
  });

  // O erro mais caro: hashtag nos dois lugares.
  test('nunca duplica as hashtags', () => {
    const r = montarTextos('Texto', tags, true);
    assert.ok(!r.legenda.includes('#pizza'));
    assert.ok(r.primeiroComentario!.includes('#pizza'));
  });

  test('aceita hashtag já com # sem duplicar o símbolo', () => {
    const r = montarTextos('Texto', ['#pizza', 'forno'], false);
    assert.ok(r.legenda.includes('#pizza'));
    assert.ok(!r.legenda.includes('##'));
    assert.ok(r.legenda.includes('#forno'));
  });

  // Comentario vazio seria pior que nao comentar.
  test('sem hashtags não gera comentário', () => {
    assert.equal(montarTextos('Só o texto', [], true).primeiroComentario, null);
    assert.equal(montarTextos('Só o texto', [], false).legenda, 'Só o texto');
  });

  test('post sem legenda e só com hashtags funciona nos dois modos', () => {
    assert.equal(montarTextos(null, tags, false).legenda, '#pizza #petrolina');
    const r = montarTextos(null, tags, true);
    assert.equal(r.legenda, '');
    assert.equal(r.primeiroComentario, '#pizza #petrolina');
  });

  test('post vazio não quebra', () => {
    const r = montarTextos(null, [], true);
    assert.equal(r.legenda, '');
    assert.equal(r.primeiroComentario, null);
  });

  test('descarta hashtag vazia vinda de vírgula solta', () => {
    const r = montarTextos('Texto', ['pizza', '', 'forno'], false);
    assert.ok(!r.legenda.includes('# '));
    assert.ok(!r.legenda.includes('##'));
  });

  test('espaços em volta da legenda são removidos', () => {
    assert.equal(montarTextos('  Texto  ', [], false).legenda, 'Texto');
  });
});
