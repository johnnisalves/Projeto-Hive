import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  escolherConta, escolherContaSocial, enderecoDaConta, ContaCandidata, ContaSocial,
} from './account-resolver.service';

/**
 * A REGRA CENTRAL: quando ha ambiguidade, RECUSAR e melhor que adivinhar.
 *
 * Uma tela vazia dizendo "vincule o Instagram desta empresa" e honesta. Uma
 * tela cheia com os numeros de OUTRO cliente e uma mentira silenciosa que a
 * agencia so descobre na reuniao com o cliente.
 */

const conta = (id: string, over: Partial<ContaCandidata> = {}): ContaCandidata => ({
  id,
  accessToken: `EAA${id}`,
  instagramUserId: `ig-${id}`,
  username: id,
  pageId: null,
  isDefault: false,
  brandId: null,
  ...over,
});

describe('escolherConta', () => {
  test('sem nenhuma conta, explica em vez de estourar', () => {
    const r = escolherConta([], 'marca-1');
    assert.equal(r.conta, null);
    assert.equal(r.motivo, 'nenhuma_conta');
    assert.match(r.mensagem!, /Conecte/);
  });

  test('conta vinculada a marca sempre ganha', () => {
    const r = escolherConta(
      [conta('padrao', { isDefault: true }), conta('da-marca', { brandId: 'marca-1' })],
      'marca-1',
    );
    assert.equal(r.conta!.id, 'da-marca');
  });

  // ESTE E O BUG QUE O RESOLVEDOR EXISTE PARA MATAR: com varias contas e a
  // marca sem vinculo, o codigo antigo devolvia a conta padrao — e o
  // relatorio do cliente B saia com os numeros do cliente A.
  test('varias contas e marca sem vinculo: RECUSA em vez de pegar a padrao', () => {
    const r = escolherConta(
      [conta('a', { isDefault: true }), conta('b'), conta('c')],
      'marca-sem-vinculo',
    );
    assert.equal(r.conta, null);
    assert.equal(r.motivo, 'ambiguo');
    assert.match(r.mensagem!, /misturar/);
  });

  // Sem isso, quem tem um cliente so precisaria configurar vinculo para o
  // sistema voltar a funcionar — uma regressao gratuita.
  test('conta unica e usada mesmo sem vinculo: nao ha como errar', () => {
    const r = escolherConta([conta('unica')], 'qualquer-marca');
    assert.equal(r.conta!.id, 'unica');
    assert.equal(r.motivo, undefined);
  });

  test('a ponte antiga por pageId continua valendo', () => {
    const r = escolherConta(
      [conta('a', { isDefault: true }), conta('b', { pageId: 'page-99' })],
      'marca-1',
      'page-99',
    );
    assert.equal(r.conta!.id, 'b');
  });

  test('vinculo direto ganha da ponte por pageId', () => {
    const r = escolherConta(
      [conta('por-page', { pageId: 'page-99' }), conta('vinculada', { brandId: 'marca-1' })],
      'marca-1',
      'page-99',
    );
    assert.equal(r.conta!.id, 'vinculada');
  });

  test('pageId que nao casa com nada nao salva do ambiguo', () => {
    const r = escolherConta([conta('a', { isDefault: true }), conta('b')], 'marca-1', 'page-inexistente');
    assert.equal(r.conta, null);
    assert.equal(r.motivo, 'ambiguo');
  });

  // Telas que nao sao de uma marca especifica (Configuracoes, por exemplo)
  // nao tem o que confundir.
  test('sem marca informada, usa a padrao', () => {
    const r = escolherConta([conta('a'), conta('padrao', { isDefault: true })]);
    assert.equal(r.conta!.id, 'padrao');
  });

  test('sem marca e sem nenhuma marcada como padrao, usa a primeira', () => {
    assert.equal(escolherConta([conta('primeira'), conta('outra')]).conta!.id, 'primeira');
  });

  test('marca nula e marca vazia se comportam como "sem marca"', () => {
    assert.equal(escolherConta([conta('a'), conta('b', { isDefault: true })], null).conta!.id, 'b');
    assert.equal(escolherConta([conta('a'), conta('b', { isDefault: true })], '').conta!.id, 'b');
  });

  test('duas marcas diferentes recebem contas diferentes', () => {
    const contas = [conta('a', { brandId: 'm1' }), conta('b', { brandId: 'm2' })];
    assert.equal(escolherConta(contas, 'm1').conta!.id, 'a');
    assert.equal(escolherConta(contas, 'm2').conta!.id, 'b');
  });
});

describe('escolherContaSocial', () => {
  const social = (id: string, over: Partial<ContaSocial> = {}): ContaSocial => ({
    id,
    accessToken: `tok-${id}`,
    platformUserId: `p-${id}`,
    username: id,
    pageId: null,
    isDefault: false,
    brandId: null,
    ...over,
  });

  // Quatro das cinco plataformas (X, TikTok, Threads, LinkedIn) nem sabiam
  // o que era marca: iam direto para isDefault e depois para "qualquer
  // conta". O post de um cliente saia no LinkedIn de outro, sem erro.
  test('varias contas e marca sem vinculo: RECUSA', () => {
    const r = escolherContaSocial([social('a', { isDefault: true }), social('b')], 'marca-1');
    assert.equal(r.conta, null);
    assert.equal(r.motivo, 'ambiguo');
  });

  test('conta vinculada a marca ganha da padrao', () => {
    const r = escolherContaSocial(
      [social('padrao', { isDefault: true }), social('da-marca', { brandId: 'm1' })],
      'm1',
    );
    assert.equal(r.conta!.id, 'da-marca');
  });

  test('conta unica passa mesmo sem vinculo', () => {
    assert.equal(escolherContaSocial([social('unica')], 'qualquer').conta!.id, 'unica');
  });

  test('sem marca informada, usa a padrao', () => {
    assert.equal(escolherContaSocial([social('a'), social('p', { isDefault: true })]).conta!.id, 'p');
  });

  test('sem conta nenhuma, explica', () => {
    const r = escolherContaSocial([], 'm1');
    assert.equal(r.conta, null);
    assert.equal(r.motivo, 'nenhuma_conta');
  });

  test('cada marca recebe a sua conta', () => {
    const contas = [social('a', { brandId: 'm1' }), social('b', { brandId: 'm2' })];
    assert.equal(escolherContaSocial(contas, 'm1').conta!.id, 'a');
    assert.equal(escolherContaSocial(contas, 'm2').conta!.id, 'b');
  });
});

describe('enderecoDaConta', () => {
  // No Login do Instagram o id proprio NAO funciona como caminho; "me" e o
  // unico alias aceito. Errar isso faz toda chamada devolver erro.
  test('token do Facebook usa graph.facebook e o id da conta', () => {
    const e = enderecoDaConta(conta('x', { accessToken: 'EAAabc', instagramUserId: '178414' }));
    assert.match(e.base, /graph\.facebook\.com/);
    assert.equal(e.uid, '178414');
  });

  test('token do Instagram usa graph.instagram e o alias me', () => {
    const e = enderecoDaConta(conta('x', { accessToken: 'IGAAabc', instagramUserId: '178414' }));
    assert.match(e.base, /graph\.instagram\.com/);
    assert.equal(e.uid, 'me');
  });
});
