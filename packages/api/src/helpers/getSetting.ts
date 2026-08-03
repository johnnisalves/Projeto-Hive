import { prisma } from '../config/database';
import { env } from '../config/env';

const ENV_MAP: Record<string, () => string | undefined> = {
  NANO_BANANA_API_KEY: () => env.NANO_BANANA_API_KEY,
  NANO_BANANA_PROVIDER: () => env.NANO_BANANA_PROVIDER,
  OPENROUTER_API_KEY: () => env.OPENROUTER_API_KEY,
  OPENROUTER_IMAGE_MODEL: () => env.OPENROUTER_IMAGE_MODEL,
  OPENROUTER_TEXT_MODEL: () => env.OPENROUTER_TEXT_MODEL,
  INSTAGRAM_ACCESS_TOKEN: () => env.INSTAGRAM_ACCESS_TOKEN,
  INSTAGRAM_USER_ID: () => env.INSTAGRAM_USER_ID,
  TELEGRAM_BOT_TOKEN: () => env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_ALLOWED_CHAT_IDS: () => env.TELEGRAM_ALLOWED_CHAT_IDS,
  FACEBOOK_APP_ID: () => env.FACEBOOK_APP_ID,
  FACEBOOK_APP_SECRET: () => env.FACEBOOK_APP_SECRET,
  MCP_AUTH_TOKEN: () => env.MCP_AUTH_TOKEN,
  INTERNAL_SERVICE_TOKEN: () => env.INTERNAL_SERVICE_TOKEN,
  CLOUDINARY_CLOUD_NAME: () => env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: () => env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: () => env.CLOUDINARY_API_SECRET,
};

/**
 * Get a setting value. Checks database first (user-configured via web UI),
 * then falls back to environment variable.
 */
export async function getSetting(key: string, userId?: string): Promise<string | undefined> {
  try {
    if (userId) {
      const setting = await prisma.setting.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (setting?.value) return setting.value;
    }
    // SEM userId NAO SE LE DO BANCO.
    //
    // Havia aqui um findFirst por chave ordenado por createdAt, ou seja:
    // "a configuracao do dono mais ANTIGO do banco". Numa instalacao com
    // varias agencias isso significava que toda geracao de IA, todo upload
    // e todo token de uma agencia rodavam com a CHAVE DE OUTRA — a primeira
    // que se cadastrou pagava a conta de todas, e um token de Instagram
    // podia atravessar de uma empresa para outra.
    //
    // Sem dono identificado, a unica fonte legitima e a variavel de
    // ambiente da propria instalacao.
  } catch {
    // Banco indisponivel: cai para a variavel de ambiente.
  }

  // Fallback to environment variable
  const envGetter = ENV_MAP[key];
  return envGetter ? envGetter() : undefined;
}
