import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gerarTokenPessoal, hashTokenPessoal, pareceTokenPessoal, prefixoVisivel, PREFIXO_TOKEN } from './api-token.service';

describe('token de API pessoal', () => {
  test('gera tokens no formato reconhecido e diferentes a cada vez', () => {
    const a = gerarTokenPessoal();
    const b = gerarTokenPessoal();
    assert.ok(a.startsWith(PREFIXO_TOKEN));
    assert.ok(pareceTokenPessoal(a));
    assert.notEqual(a, b);
  });

  test('JWT de login e lixo nao passam por token pessoal', () => {
    assert.equal(pareceTokenPessoal('eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.abc'), false);
    assert.equal(pareceTokenPessoal('dpa_curto'), false);
    assert.equal(pareceTokenPessoal('dpa_' + 'z'.repeat(48)), false);
  });

  test('o hash e estavel e nao contem o token', () => {
    const t = gerarTokenPessoal();
    assert.equal(hashTokenPessoal(t), hashTokenPessoal(t));
    assert.ok(!hashTokenPessoal(t).includes(t.slice(PREFIXO_TOKEN.length)));
  });

  test('o prefixo visivel mostra so o comeco', () => {
    const t = gerarTokenPessoal();
    assert.equal(prefixoVisivel(t), t.slice(0, 10));
    assert.ok(prefixoVisivel(t).length < t.length);
  });
});
