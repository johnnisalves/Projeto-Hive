import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  gerarCodigoCurto,
  gerarCodigoCupom,
  normalizarTelefone,
  montarLinkWhatsapp,
  extrairCodigo,
  motivoRecusa,
  consolidarReceita,
  calcularRoi,
  valorEquivalenteEmMidia,
  CPM_PADRAO_CENTAVOS,
} from './attribution.service';

describe('gerarCodigoCurto', () => {
  test('nao usa caractere que se confunde ao ler em voz alta', () => {
    // 0/O e 1/I/L viram venda nao atribuida quando o cliente dita o codigo
    // no balcao — que e justamente o que esta feature existe para evitar.
    for (let i = 0; i < 200; i++) {
      assert.doesNotMatch(gerarCodigoCurto(8), /[0O1IL]/);
    }
  });

  test('respeita o tamanho pedido', () => {
    assert.equal(gerarCodigoCurto(6).length, 6);
    assert.equal(gerarCodigoCurto(3).length, 3);
  });
});

describe('gerarCodigoCupom', () => {
  test('usa o nome da marca como prefixo legivel', () => {
    assert.match(gerarCodigoCupom('Essenza'), /^ESSENZA-[A-Z2-9]{3}$/);
  });

  test('tira acento e espaco do nome', () => {
    assert.match(gerarCodigoCupom('Pizzaria Essência'), /^PIZZARIA-/);
  });

  test('nome vazio ou so simbolo ainda gera cupom usavel', () => {
    assert.match(gerarCodigoCupom(''), /^PROMO-/);
    assert.match(gerarCodigoCupom('!!!'), /^PROMO-/);
  });
});

describe('normalizarTelefone', () => {
  test('aceita o jeito que a pessoa realmente digita', () => {
    assert.equal(normalizarTelefone('(87) 99999-8888'), '5587999998888');
    assert.equal(normalizarTelefone('87 9 9999-8888'), '5587999998888');
    assert.equal(normalizarTelefone('+55 87 99999-8888'), '5587999998888');
  });

  test('fixo de 8 digitos tambem passa', () => {
    assert.equal(normalizarTelefone('(87) 3861-2222'), '558738612222');
  });

  test('nao duplica o 55 de quem ja colou com codigo do pais', () => {
    assert.equal(normalizarTelefone('5587999998888'), '5587999998888');
  });

  // O DDD 55 e de Santa Maria/RS. Decidir pelo prefixo em vez do tamanho
  // faria numeros de uma regiao inteira virarem lixo.
  test('DDD 55 nao e confundido com codigo do pais', () => {
    assert.equal(normalizarTelefone('55999998888'), '5555999998888');
    assert.equal(normalizarTelefone('5533334444'), '555533334444');
  });

  test('tira o zero de operadora que a pessoa digita por habito', () => {
    assert.equal(normalizarTelefone('087999998888'), '5587999998888');
  });

  test('numero sem DDD e recusado em vez de virar link quebrado', () => {
    assert.equal(normalizarTelefone('999998888'), null);
    assert.equal(normalizarTelefone('38612222'), null);
    assert.equal(normalizarTelefone(''), null);
    assert.equal(normalizarTelefone('abc'), null);
  });
});

describe('montarLinkWhatsapp', () => {
  test('embute o codigo do post na mensagem', () => {
    const l = montarLinkWhatsapp('(87) 99999-8888', 'Vi no Instagram, quero pedir', 'K4TR9M')!;
    assert.ok(l.startsWith('https://wa.me/5587999998888?text='));
    assert.ok(decodeURIComponent(l).includes('[K4TR9M]'));
  });

  test('sem codigo, manda so a mensagem', () => {
    const l = montarLinkWhatsapp('87999998888', 'Ola')!;
    assert.ok(!decodeURIComponent(l).includes('['));
  });

  test('acento e quebra de linha nao quebram a URL', () => {
    const l = montarLinkWhatsapp('87999998888', 'Promoção de terça\nquero pedir', 'ABC123')!;
    assert.ok(!/[\s]/.test(l));
    assert.ok(decodeURIComponent(l).includes('Promoção'));
  });

  test('telefone invalido devolve null em vez de link torto', () => {
    assert.equal(montarLinkWhatsapp('123', 'oi'), null);
  });
});

describe('extrairCodigo', () => {
  test('acha o codigo na primeira mensagem do cliente', () => {
    assert.equal(extrairCodigo('Oi! Vi a promo de quinta [K4TR9M]'), 'K4TR9M');
    assert.equal(extrairCodigo('quero pedir #ABC123'), 'ABC123');
  });

  // O cliente reescreve a mensagem em minusculas o tempo todo; perder a
  // atribuicao por causa disso derrubaria o numero que a feature existe
  // para produzir.
  test('funciona com o cliente digitando em minusculas', () => {
    assert.equal(extrairCodigo('vi a promo [k4tr9m]'), 'K4TR9M');
  });

  test('mensagem sem codigo devolve null', () => {
    assert.equal(extrairCodigo('Oi, boa noite'), null);
    assert.equal(extrairCodigo(''), null);
  });

  test('nao confunde numero solto com codigo', () => {
    assert.equal(extrairCodigo('quero 2 pizzas'), null);
  });
});

describe('motivoRecusa', () => {
  const agora = new Date(2026, 5, 15, 12, 0, 0);
  const ok = { expiresAt: null, maxUsos: null, usos: 0, ativo: true };

  test('cupom novo passa', () => {
    assert.equal(motivoRecusa(ok, agora), null);
  });

  test('vencido e desativado sao recusados com motivo', () => {
    assert.match(motivoRecusa({ ...ok, expiresAt: new Date(2026, 5, 14) }, agora)!, /venceu/);
    assert.match(motivoRecusa({ ...ok, ativo: false }, agora)!, /desativado/);
  });

  test('limite de usos barra o resgate', () => {
    assert.equal(motivoRecusa({ ...ok, maxUsos: 10, usos: 9 }, agora), null);
    assert.match(motivoRecusa({ ...ok, maxUsos: 10, usos: 10 }, agora)!, /limite/);
  });

  // maxUsos null = ilimitado; 0 = esgotado. Um checador por truthiness
  // trataria os dois como "sem limite" e o cupom nunca esgotaria.
  test('limite zero nao e confundido com ilimitado', () => {
    assert.match(motivoRecusa({ ...ok, maxUsos: 0, usos: 0 }, agora)!, /limite/);
    assert.equal(motivoRecusa({ ...ok, maxUsos: null, usos: 9999 }, agora), null);
  });

  test('vence exatamente na hora marcada ainda vale', () => {
    assert.equal(motivoRecusa({ ...ok, expiresAt: agora }, agora), null);
  });
});

describe('consolidarReceita', () => {
  test('soma cupom e balcao', () => {
    const r = consolidarReceita({
      cupons: [{ valorCentavos: 4990 }, { valorCentavos: 8000 }],
      balcao: [{ valorCentavos: 5000, origem: 'INSTAGRAM' }],
    });
    assert.equal(r.cupomCentavos, 12990);
    assert.equal(r.balcaoCentavos, 5000);
    assert.equal(r.totalCentavos, 17990);
  });

  // Somar "passou na frente" no ROI do Instagram seria inflar o proprio
  // resultado — o numero que a agencia leva para o cliente ficaria falso.
  test('venda que nao veio de social fica de fora', () => {
    const r = consolidarReceita({
      cupons: [],
      balcao: [
        { valorCentavos: 5000, origem: 'INSTAGRAM' },
        { valorCentavos: 9000, origem: 'PASSOU_NA_FRENTE' },
        { valorCentavos: 7000, origem: 'INDICACAO' },
      ],
    });
    assert.equal(r.balcaoCentavos, 5000);
    assert.equal(r.vendasBalcao, 1);
  });

  test('venda marcada sem valor conta como venda, mas nao soma dinheiro', () => {
    const r = consolidarReceita({
      cupons: [],
      balcao: [{ valorCentavos: null, origem: 'WHATSAPP' }],
    });
    assert.equal(r.vendasBalcao, 1);
    assert.equal(r.balcaoCentavos, 0);
  });

  test('nada registrado da zero, nao NaN', () => {
    const r = consolidarReceita({ cupons: [], balcao: [] });
    assert.equal(r.totalCentavos, 0);
  });

  // Centavos o tempo todo: em reais com ponto flutuante o total do
  // relatorio nao fecharia com a soma das linhas.
  test('soma de muitos valores fecha exata', () => {
    const cupons = Array.from({ length: 300 }, () => ({ valorCentavos: 10 }));
    assert.equal(consolidarReceita({ cupons, balcao: [] }).totalCentavos, 3000);
  });
});

describe('calcularRoi', () => {
  test('divide receita pelo fee', () => {
    assert.equal(calcularRoi(940000, 150000), 6.3);
  });

  // Sem fee cadastrado, mostrar "0x" mentiria e dividir por zero daria
  // Infinity na tela do cliente.
  test('sem fee devolve null em vez de numero inventado', () => {
    assert.equal(calcularRoi(940000, 0), null);
    assert.equal(calcularRoi(940000, null), null);
    assert.equal(calcularRoi(940000, undefined), null);
  });

  test('receita zero da ROI zero, nao null', () => {
    assert.equal(calcularRoi(0, 150000), 0);
  });
});

describe('valorEquivalenteEmMidia', () => {
  // CPM e por MIL impressoes: esquecer o /1000 multiplicaria o numero do
  // relatorio por mil e destruiria a credibilidade da agencia.
  test('converte alcance em reais pelo CPM', () => {
    assert.equal(valorEquivalenteEmMidia(1000, 2000), 2000);
    assert.equal(valorEquivalenteEmMidia(17000, 2000), 34000);
  });

  test('usa o CPM padrao quando nao informado', () => {
    assert.equal(valorEquivalenteEmMidia(1000), CPM_PADRAO_CENTAVOS);
  });

  test('alcance zero ou negativo nao vira valor', () => {
    assert.equal(valorEquivalenteEmMidia(0), 0);
    assert.equal(valorEquivalenteEmMidia(-5), 0);
  });
});
