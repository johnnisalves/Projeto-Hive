import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  crc16,
  campo,
  sanitizarTexto,
  formatarValor,
  sanitizarTxid,
  gerarPixCopiaECola,
  pixValido,
} from './pix.service';

/**
 * Um erro aqui nao quebra uma tela: gera um codigo que o app do banco recusa
 * na frente do comprador, ou pior, um pagamento que nao bate com o pedido.
 * Por isso cada regra do padrao tem teste proprio.
 */

describe('crc16', () => {
  // Vetor classico do CRC-16/CCITT-FALSE. Se este passar, a variante esta
  // certa; as outras variantes de CRC16 dariam um valor diferente e o codigo
  // teria aparencia valida mas seria recusado na leitura.
  test('bate com o vetor de referencia', () => {
    assert.equal(crc16('123456789'), '29B1');
  });

  test('sempre devolve 4 digitos hex maiusculos', () => {
    for (const s of ['a', 'pix', 'BR', '00020126']) {
      assert.match(crc16(s), /^[0-9A-F]{4}$/);
    }
  });
});

describe('campo', () => {
  test('preenche o tamanho com dois digitos', () => {
    assert.equal(campo('00', '01'), '000201');
    assert.equal(campo('53', '986'), '5303986');
  });

  // Valor com 10+ caracteres e onde um padStart errado quebraria tudo.
  test('conta certo acima de 9 caracteres', () => {
    assert.equal(campo('01', '0123456789'), '01100123456789');
    assert.equal(campo('59', 'PIZZARIA ESSENZA'), '5916PIZZARIA ESSENZA');
  });
});

describe('sanitizarTexto', () => {
  test('tira acento mantendo a letra', () => {
    assert.equal(sanitizarTexto('Pizzaria Essência', 25), 'PIZZARIA ESSENCIA');
    assert.equal(sanitizarTexto('São Paulo', 15), 'SAO PAULO');
  });

  test('troca simbolo por espaco em vez de colar as palavras', () => {
    assert.equal(sanitizarTexto('Petrolina-PE', 15), 'PETROLINA PE');
    assert.equal(sanitizarTexto('Bar & Cia', 25), 'BAR CIA');
  });

  test('corta no limite do campo', () => {
    assert.equal(sanitizarTexto('A'.repeat(40), 25).length, 25);
    assert.equal(sanitizarTexto('B'.repeat(40), 15).length, 15);
  });

  // Depois de sanitizar, caractere == byte. E disso que depende a contagem
  // de tamanho do EMV: um acento sobrevivente viraria 2 bytes em UTF-8 e
  // desalinharia todos os campos seguintes.
  test('resultado e sempre ASCII puro', () => {
    const r = sanitizarTexto('Açaí Ñoño Çedilha', 25);
    assert.equal(Buffer.byteLength(r, 'utf8'), r.length);
  });

  test('texto vazio nao quebra', () => {
    assert.equal(sanitizarTexto('', 25), '');
    assert.equal(sanitizarTexto('!!!', 25), '');
  });
});

describe('formatarValor', () => {
  test('sempre duas casas', () => {
    assert.equal(formatarValor(39.9), '39.90');
    assert.equal(formatarValor(50), '50.00');
  });

  // Separador de milhar faz o app do banco recusar o codigo.
  test('nao usa separador de milhar', () => {
    assert.equal(formatarValor(1234.5), '1234.50');
    assert.ok(!formatarValor(1234.5).includes(','));
  });
});

describe('sanitizarTxid', () => {
  test('so deixa letra e numero', () => {
    assert.equal(sanitizarTxid('POST-42/abc'), 'POST42abc');
  });

  test('corta em 25', () => {
    assert.equal(sanitizarTxid('x'.repeat(40)).length, 25);
  });

  // O padrao exige "***" quando nao ha identificador. Campo vazio faz o
  // app recusar.
  test('sem identificador vira ***', () => {
    assert.equal(sanitizarTxid(''), '***');
    assert.equal(sanitizarTxid(null), '***');
    assert.equal(sanitizarTxid('///'), '***');
  });
});

describe('gerarPixCopiaECola', () => {
  const base = { chave: 'teste@essenza.com.br', nome: 'Pizzaria Essenza', cidade: 'Petrolina' };

  test('o codigo gerado passa na propria conferencia de CRC', () => {
    assert.ok(pixValido(gerarPixCopiaECola(base)));
    assert.ok(pixValido(gerarPixCopiaECola({ ...base, valor: 49.9 })));
    assert.ok(pixValido(gerarPixCopiaECola({ ...base, valor: 1234.5, txid: 'POST42' })));
  });

  test('comeca com o indicador de formato e termina com o CRC', () => {
    const p = gerarPixCopiaECola(base);
    assert.ok(p.startsWith('000201'));
    assert.match(p.slice(-8), /^6304[0-9A-F]{4}$/);
  });

  test('leva a chave crua, sem sanitizar', () => {
    // Sanitizar a chave destruiria e-mail e chave aleatoria — o dinheiro
    // cairia em lugar nenhum.
    assert.ok(gerarPixCopiaECola(base).includes('teste@essenza.com.br'));
    const aleatoria = '123e4567-e12b-12d1-a456-426655440000';
    assert.ok(gerarPixCopiaECola({ ...base, chave: aleatoria }).includes(aleatoria));
  });

  test('sem valor, o campo 54 nao aparece', () => {
    const semValor = gerarPixCopiaECola(base);
    const comValor = gerarPixCopiaECola({ ...base, valor: 49.9 });
    assert.ok(!semValor.includes('5405'));
    assert.ok(comValor.includes('540549.90'));
  });

  test('valor zero conta como sem valor', () => {
    assert.ok(!gerarPixCopiaECola({ ...base, valor: 0 }).includes('5405'));
  });

  test('o identificador do post entra no codigo', () => {
    assert.ok(gerarPixCopiaECola({ ...base, txid: 'POST42' }).includes('POST42'));
  });

  test('sem chave, recusa em vez de gerar codigo quebrado', () => {
    assert.throws(() => gerarPixCopiaECola({ ...base, chave: '' }));
    assert.throws(() => gerarPixCopiaECola({ ...base, chave: '   ' }));
  });

  // Nome e cidade longos sao o caso onde o EMV estoura silenciosamente:
  // sem o corte, o campo passaria de 99 e o tamanho de 2 digitos mentiria.
  test('nome e cidade longos nao invalidam o codigo', () => {
    const p = gerarPixCopiaECola({
      ...base,
      nome: 'Pizzaria Essenza Delivery e Restaurante Petrolina',
      cidade: 'Sao Bernardo do Campo Grande',
    });
    assert.ok(pixValido(p));
  });

  test('nome so de acento nao gera campo vazio', () => {
    // Campo 59 vazio faz o app recusar; o padrao pede um nome sempre.
    const p = gerarPixCopiaECola({ ...base, nome: '!!!', cidade: '???' });
    assert.ok(p.includes('RECEBEDOR'));
    assert.ok(p.includes('BRASIL'));
    assert.ok(pixValido(p));
  });

  test('a mesma entrada gera sempre o mesmo codigo', () => {
    assert.equal(gerarPixCopiaECola(base), gerarPixCopiaECola(base));
  });
});

describe('pixValido', () => {
  test('detecta codigo adulterado', () => {
    const p = gerarPixCopiaECola({ chave: 'a@b.com', nome: 'Loja', cidade: 'Recife', valor: 10 });
    assert.ok(pixValido(p));
    // Troca um digito do valor: o CRC nao bate mais.
    assert.ok(!pixValido(p.replace('540510.00', '540599.00')));
  });

  test('lixo nao passa', () => {
    assert.ok(!pixValido(''));
    assert.ok(!pixValido('abc'));
    assert.ok(!pixValido('00020101021226'));
  });
});
