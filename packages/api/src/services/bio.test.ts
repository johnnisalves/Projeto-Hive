import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gerarSlug, slugValido, normalizarUrl } from './bio.service';

/**
 * A pagina de bio e PUBLICA e os botoes viram href. Uma URL mal tratada
 * aqui executa script no visitante — que e cliente do cliente.
 */

describe('gerarSlug', () => {
  // Sem remover acento antes de filtrar, "Açaí" viraria "aa".
  test('preserva a letra ao remover o acento', () => {
    assert.equal(gerarSlug('Pizzaria Essenza Açaí'), 'pizzaria-essenza-acai');
    assert.equal(gerarSlug('São João Alimentos'), 'sao-joao-alimentos');
    assert.equal(gerarSlug('Ótica Visão'), 'otica-visao');
  });

  test('troca espaço e pontuação por hífen', () => {
    assert.equal(gerarSlug('Loja & Cia. Ltda'), 'loja-cia-ltda');
  });

  test('não deixa hífen sobrando nas pontas', () => {
    assert.equal(gerarSlug('  !!Loja!!  '), 'loja');
    assert.ok(!gerarSlug('...teste...').startsWith('-'));
    assert.ok(!gerarSlug('...teste...').endsWith('-'));
  });

  test('corta nomes muito longos', () => {
    assert.ok(gerarSlug('a'.repeat(100)).length <= 40);
  });

  test('nome vazio devolve string vazia', () => {
    assert.equal(gerarSlug(''), '');
  });
});

describe('slugValido', () => {
  test('aceita slug normal', () => {
    assert.equal(slugValido('pizzaria-essenza'), true);
    assert.equal(slugValido('loja123'), true);
  });

  // Colidir com rota do app derrubaria a navegacao do sistema.
  test('recusa nomes reservados do sistema', () => {
    for (const s of ['api', 'posts', 'settings', 'login', 'radar']) {
      assert.equal(slugValido(s), false, `${s} deveria ser recusado`);
    }
  });

  test('recusa curto demais e longo demais', () => {
    assert.equal(slugValido('ab'), false);
    assert.equal(slugValido('a'.repeat(41)), false);
  });

  test('recusa caractere inválido e hífen nas pontas', () => {
    assert.equal(slugValido('loja_oficial'), false);
    assert.equal(slugValido('Loja'), false);       // maiuscula
    assert.equal(slugValido('-loja'), false);
    assert.equal(slugValido('loja-'), false);
    assert.equal(slugValido('lo ja'), false);
  });
});

describe('normalizarUrl', () => {
  test('completa o https quando falta', () => {
    assert.equal(normalizarUrl('exemplo.com.br'), 'https://exemplo.com.br/');
    assert.equal(normalizarUrl('www.loja.com/promo'), 'https://www.loja.com/promo');
  });

  test('mantém http e https válidos', () => {
    assert.equal(normalizarUrl('https://loja.com/x'), 'https://loja.com/x');
    assert.ok(normalizarUrl('http://loja.com')!.startsWith('http://'));
  });

  // O caso que importa: href com javascript: executa no visitante.
  test('recusa javascript: e outros esquemas perigosos', () => {
    assert.equal(normalizarUrl('javascript:alert(1)'), null);
    assert.equal(normalizarUrl('JavaScript:alert(1)'), null);
    assert.equal(normalizarUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(normalizarUrl('file:///etc/passwd'), null);
    assert.equal(normalizarUrl('vbscript:msgbox(1)'), null);
  });

  test('recusa texto que não é URL', () => {
    assert.equal(normalizarUrl(''), null);
    assert.equal(normalizarUrl('   '), null);
  });

  test('aceita link do WhatsApp e do Instagram', () => {
    assert.ok(normalizarUrl('wa.me/5574991373103')!.includes('wa.me'));
    assert.ok(normalizarUrl('instagram.com/johnnisalves')!.includes('instagram.com'));
  });
});
