import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extrairMarcacoes,
  marcacoesInvalidas,
  preencher,
  formatarTelefone,
  conferir,
  escalonar,
  INTERVALO_MINUTOS,
} from './multibrand.service';

/**
 * O ERRO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR: um "{{nome}}" nao
 * substituido indo ao ar no perfil do cliente. E vexame publico e
 * irreversivel — pior que a campanha nao sair.
 */

const marca = (over: Partial<any> = {}) => ({
  id: 'm1',
  name: 'Pizzaria Essenza',
  whatsappPhone: '87999998888',
  websiteUrl: 'https://essenza.com.br',
  cidade: 'Petrolina',
  primaryColor: '#E84393',
  logoUrl: 'https://x.com/logo.png',
  instagramUrl: null,
  ...over,
});

describe('extrairMarcacoes', () => {
  test('acha as marcacoes do template', () => {
    assert.deepEqual(extrairMarcacoes('Venha para a {{nome}} em {{cidade}}'), ['nome', 'cidade']);
  });

  // E como a pessoa digita quando copia de outro lugar. Nao reconhecer
  // deixaria "{{ nome }}" literal no post publicado.
  test('aceita espaco dentro das chaves', () => {
    assert.deepEqual(extrairMarcacoes('Oi {{ nome }}'), ['nome']);
  });

  test('nao repete a mesma marcacao', () => {
    assert.deepEqual(extrairMarcacoes('{{nome}} e {{nome}} de novo'), ['nome']);
  });

  test('caixa alta e a mesma marcacao', () => {
    assert.deepEqual(extrairMarcacoes('{{NOME}}'), ['nome']);
  });

  test('texto sem marcacao devolve lista vazia', () => {
    assert.deepEqual(extrairMarcacoes('Post normal sem nada'), []);
    assert.deepEqual(extrairMarcacoes(''), []);
  });

  // Qualquer coisa entre chaves duplas VAI SAIR LITERAL no post se nao for
  // substituida. Um regex que so casasse [a-z_] deixaria estas passarem
  // sem serem substituidas nem reportadas — e elas apareceriam com as
  // chaves no feed do cliente.
  test('pega marcacao com digito, acento e espaco no meio', () => {
    assert.deepEqual(extrairMarcacoes('{{nome2}}'), ['nome2']);
    assert.deepEqual(extrairMarcacoes('{{endereço}}'), ['endereço']);
    assert.deepEqual(extrairMarcacoes('{{nome completo}}'), ['nome completo']);
  });

  test('chaves vazias nao viram marcacao', () => {
    assert.deepEqual(extrairMarcacoes('{{}} e {{   }}'), []);
  });
});

describe('marcacoesInvalidas', () => {
  test('aponta erro de digitacao do usuario', () => {
    assert.deepEqual(marcacoesInvalidas('{{nome}} e {{telefonee}}'), ['telefonee']);
  });

  test('template certo nao tem invalidas', () => {
    assert.deepEqual(marcacoesInvalidas('{{nome}} em {{cidade}}'), []);
  });

  test('marcacao com digito ou acento e apontada, nao ignorada', () => {
    assert.deepEqual(marcacoesInvalidas('{{nome2}}'), ['nome2']);
    assert.deepEqual(marcacoesInvalidas('{{endereço}}'), ['endereço']);
    assert.deepEqual(marcacoesInvalidas('{{nome completo}}'), ['nome completo']);
  });
});

describe('preencher', () => {
  test('troca pelos dados da marca', () => {
    assert.equal(
      preencher('Venha para a {{nome}} em {{cidade}}', marca()),
      'Venha para a Pizzaria Essenza em Petrolina',
    );
  });

  test('telefone sai formatado para leitura', () => {
    assert.equal(preencher('Chama no {{telefone}}', marca()), 'Chama no (87) 99999-8888');
  });

  // Deixar a marcacao visivel e proposital: e o sinal que a conferencia
  // usa. Trocar por vazio produziria "Chama no " no post publicado, que
  // parece bug mas passa despercebido na revisao.
  test('campo vazio mantem a marcacao a mostra', () => {
    assert.equal(preencher('Siga {{instagram}}', marca()), 'Siga {{instagram}}');
    assert.equal(preencher('Chama no {{telefone}}', marca({ whatsappPhone: '' })), 'Chama no {{telefone}}');
  });

  test('marcacao inexistente fica intacta', () => {
    assert.equal(preencher('{{inventada}}', marca()), '{{inventada}}');
  });

  test('a mesma marcacao e trocada em todas as ocorrencias', () => {
    assert.equal(preencher('{{nome}} - {{nome}}', marca()), 'Pizzaria Essenza - Pizzaria Essenza');
  });

  test('texto sem marcacao passa inteiro', () => {
    assert.equal(preencher('Post normal', marca()), 'Post normal');
  });
});

describe('formatarTelefone', () => {
  test('formata celular e fixo', () => {
    assert.equal(formatarTelefone('87999998888'), '(87) 99999-8888');
    assert.equal(formatarTelefone('8738612222'), '(87) 3861-2222');
  });

  test('tira o codigo do pais antes de formatar', () => {
    assert.equal(formatarTelefone('5587999998888'), '(87) 99999-8888');
  });

  test('numero fora do padrao sai como veio, sem inventar formato', () => {
    assert.equal(formatarTelefone('123'), '123');
  });
});

describe('conferir', () => {
  test('separa quem esta pronta de quem falta dado', () => {
    const r = conferir('{{nome}} em {{cidade}}, chama no {{telefone}}', [
      marca({ id: 'ok', name: 'Completa' }),
      marca({ id: 'sem-fone', name: 'Sem telefone', whatsappPhone: null }),
      marca({ id: 'sem-cidade', name: 'Sem cidade', cidade: '' }),
    ]);

    assert.deepEqual(r.prontas.map((m) => m.id), ['ok']);
    assert.equal(r.pendencias.length, 2);
    assert.deepEqual(r.pendencias[0].faltando, ['telefone']);
    assert.deepEqual(r.pendencias[1].faltando, ['cidade']);
  });

  test('lista todos os campos que faltam na mesma marca', () => {
    const r = conferir('{{nome}} {{cidade}} {{telefone}}', [
      marca({ id: 'x', name: 'Vazia', cidade: null, whatsappPhone: null }),
    ]);
    assert.deepEqual(r.pendencias[0].faltando, ['cidade', 'telefone']);
  });

  test('template sem marcacao deixa todas prontas', () => {
    const r = conferir('Feliz Dia da Pizza!', [marca({ id: 'a' }), marca({ id: 'b', whatsappPhone: null })]);
    assert.equal(r.prontas.length, 2);
    assert.equal(r.pendencias.length, 0);
  });

  test('marcacao com erro de digitacao e reportada separada', () => {
    const r = conferir('{{nome}} {{telefonee}}', [marca()]);
    assert.deepEqual(r.invalidas, ['telefonee']);
    // Nao vira pendencia da marca: o erro e do template, nao do cadastro.
    assert.equal(r.pendencias.length, 0);
  });

  test('sem marcas nao quebra', () => {
    const r = conferir('{{nome}}', []);
    assert.deepEqual(r.prontas, []);
    assert.deepEqual(r.pendencias, []);
  });

  // Toda marca tem que aparecer em exatamente um dos dois lados; sumir
  // silenciosamente significaria campanha faltando para um cliente.
  test('nenhuma marca some entre pronta e pendente', () => {
    const marcas = Array.from({ length: 12 }, (_, i) =>
      marca({ id: String(i), name: `M${i}`, cidade: i % 3 === 0 ? null : 'Petrolina' }));
    const r = conferir('{{nome}} {{cidade}}', marcas);
    assert.equal(r.prontas.length + r.pendencias.length, 12);
  });
});

describe('escalonar', () => {
  const inicio = new Date(2026, 7, 3, 10, 0, 0);

  // Publicar 15 marcas no mesmo minuto e o padrao mais suspeito que existe
  // para o Instagram, e ainda denunciaria a arte-mae entre perfis da mesma
  // cidade.
  test('espalha os horarios em vez de empilhar', () => {
    const d = escalonar(3, inicio);
    assert.equal(d[0].getTime(), inicio.getTime());
    assert.equal(d[1].getTime() - d[0].getTime(), INTERVALO_MINUTOS * 60_000);
    assert.equal(d[2].getTime() - d[1].getTime(), INTERVALO_MINUTOS * 60_000);
  });

  test('nenhum horario se repete', () => {
    const d = escalonar(20, inicio);
    assert.equal(new Set(d.map((x) => x.getTime())).size, 20);
  });

  test('aceita intervalo proprio', () => {
    const d = escalonar(2, inicio, 30);
    assert.equal(d[1].getTime() - d[0].getTime(), 30 * 60_000);
  });

  test('zero ou negativo devolve lista vazia', () => {
    assert.deepEqual(escalonar(0, inicio), []);
    assert.deepEqual(escalonar(-3, inicio), []);
  });
});
