import { PaginaLegal } from '../../components/PaginaLegal';

export const metadata = { title: 'Termos de Serviço | DisparaAI' };

export default function TermosPage() {
  return (
    <PaginaLegal titulo="Termos de Serviço" atualizado="1º de novembro de 2026">
      <p>
        O DisparaAI (&ldquo;Dispara AI Content&rdquo;) é uma plataforma de criação, agendamento e publicação de conteúdo para redes sociais,
        operada pela DigitalCRM. Ao usar o DisparaAI, você concorda com estes termos.
      </p>

      <h2>1. O que o serviço faz</h2>
      <p>
        O DisparaAI permite que você prepare posts, vídeos e imagens e os publique ou agende nas contas que você mesmo conectar, como Instagram,
        Facebook, WhatsApp (Status) e TikTok. A publicação só acontece nas contas autorizadas por você e com o conteúdo que você escolher.
      </p>

      <h2>2. Sua conta e as contas conectadas</h2>
      <ul>
        <li>Você é responsável por manter seu acesso seguro e por tudo o que for publicado a partir da sua conta.</li>
        <li>Ao conectar uma rede social, você autoriza o DisparaAI a publicar em seu nome apenas o que você enviar ou agendar.</li>
        <li>Você pode desconectar qualquer rede social a qualquer momento, nas Configurações do DisparaAI ou nas configurações da própria rede.</li>
      </ul>

      <h2>3. Conteúdo</h2>
      <ul>
        <li>O conteúdo publicado é de sua responsabilidade. Você declara ter os direitos sobre textos, imagens, vídeos e músicas que enviar.</li>
        <li>Você não pode usar o serviço para conteúdo ilegal, enganoso, ofensivo ou que viole as regras das redes sociais conectadas.</li>
        <li>Você continua dono do seu conteúdo. O DisparaAI o armazena apenas para executar as publicações que você pediu.</li>
      </ul>

      <h2>4. Regras das redes sociais</h2>
      <p>
        O uso de cada rede social segue também os termos dela, inclusive os Termos de Serviço do TikTok e as Diretrizes da Comunidade.
        Cada publicação no TikTok é iniciada ou agendada pelo usuário, que escolhe o vídeo, a legenda e a visibilidade.
      </p>

      <h2>5. Disponibilidade</h2>
      <p>
        Fazemos o possível para manter o serviço no ar, mas ele é oferecido no estado em que se encontra. Falhas, limites impostos pelas redes
        sociais ou mudanças nas APIs delas podem atrasar ou impedir uma publicação.
      </p>

      <h2>6. Encerramento</h2>
      <p>
        Você pode parar de usar o serviço e pedir a exclusão dos seus dados a qualquer momento. Podemos suspender contas que violem estes termos.
      </p>

      <h2>7. Alterações e contato</h2>
      <p>
        Podemos atualizar estes termos; a data no topo mostra a última versão. Dúvidas: digitalcrm.com.br.
      </p>
    </PaginaLegal>
  );
}
