import { PaginaLegal } from '../../components/PaginaLegal';

export const metadata = { title: 'Política de Privacidade | DisparaAI' };

export default function PrivacidadePage() {
  return (
    <PaginaLegal titulo="Política de Privacidade" atualizado="1º de novembro de 2026">
      <p>
        Esta política explica quais dados o DisparaAI (&ldquo;Dispara AI Content&rdquo;), operado pela DigitalCRM, coleta, para que usa e como
        você pode controlá-los. Seguimos a Lei Geral de Proteção de Dados (LGPD).
      </p>

      <h2>1. Dados que coletamos</h2>
      <ul>
        <li><strong>Conta no DisparaAI:</strong> nome, e-mail e senha (guardada de forma criptografada).</li>
        <li><strong>Redes sociais conectadas:</strong> nome de usuário, foto e identificador do perfil, e os tokens de acesso que a rede fornece quando você autoriza a conexão.</li>
        <li><strong>Conteúdo:</strong> vídeos, imagens, legendas e horários de publicação que você envia ou agenda.</li>
      </ul>

      <h2>2. Dados do TikTok</h2>
      <p>
        Quando você conecta o TikTok, pedimos apenas as permissões necessárias: ler seu perfil básico (<em>user.info.basic</em>) e enviar ou
        publicar vídeos na sua conta (<em>video.upload</em> e <em>video.publish</em>). Usamos essas permissões somente para publicar o que você
        escolheu. Não lemos suas mensagens, não seguimos nem curtimos em seu nome e não coletamos dados de outros usuários.
      </p>

      <h2>3. Para que usamos</h2>
      <ul>
        <li>Publicar e agendar o conteúdo nas contas que você conectou.</li>
        <li>Mostrar o andamento e o resultado das publicações.</li>
        <li>Manter a segurança e o funcionamento do serviço.</li>
      </ul>
      <p>Não vendemos seus dados e não os compartilhamos com terceiros para publicidade.</p>

      <h2>4. Com quem compartilhamos</h2>
      <p>
        Os dados são enviados apenas às redes sociais que você conectou (por exemplo, o TikTok recebe o vídeo e a legenda que você mandou
        publicar) e a provedores de hospedagem que armazenam o conteúdo para a publicação.
      </p>

      <h2>5. Por quanto tempo guardamos</h2>
      <p>
        Mantemos os dados enquanto sua conta estiver ativa. Os tokens das redes sociais são apagados quando você desconecta a conta.
      </p>

      <h2>6. Seus direitos</h2>
      <ul>
        <li>Acessar, corrigir ou pedir a exclusão dos seus dados.</li>
        <li>Desconectar o TikTok e outras redes nas Configurações do DisparaAI, ou revogar o acesso em TikTok &gt; Configurações e privacidade &gt; Segurança e permissões &gt; Apps e serviços.</li>
        <li>Pedir a exclusão da conta e de todo o conteúdo armazenado.</li>
      </ul>

      <h2>7. Segurança</h2>
      <p>
        Usamos conexão criptografada (HTTPS), controle de acesso por usuário e armazenamento protegido para os tokens e o conteúdo.
      </p>

      <h2>8. Contato</h2>
      <p>
        Para exercer seus direitos ou tirar dúvidas, fale conosco em digitalcrm.com.br. Esta política pode ser atualizada; a data no topo
        indica a versão mais recente.
      </p>
    </PaginaLegal>
  );
}
