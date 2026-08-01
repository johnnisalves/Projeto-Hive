import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { minioClient } from '../config/minio';
import { env } from '../config/env';

/**
 * Mixagem de trilha sonora no video, antes de publicar.
 *
 * POR QUE ISTO EXISTE: a API do Instagram nao permite escolher musica do
 * catalogo do app — nao ha parametro para isso em nenhum endpoint. O unico
 * caminho para um post sair com musica e o audio ja estar dentro do arquivo
 * de video no momento do upload. Entao mixamos aqui com ffmpeg (ja instalado
 * no Dockerfile.api) e publicamos o resultado.
 *
 * ATENCAO (licenciamento): o audio precisa ser de biblioteca livre ou
 * licenciado pelo usuario. A licenca que o Instagram tem com as gravadoras
 * cobre a musica escolhida DENTRO do app; um MP3 comercial subido por fora
 * nao esta coberto e o post pode ser silenciado ou removido.
 */

const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

function run(cmd: string, args: string[], timeoutMs = FFMPEG_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${cmd} excedeu ${timeoutMs / 1000}s e foi interrompido`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      // O ffmpeg escreve tudo em stderr; so as ultimas linhas interessam no erro.
      else reject(new Error(`${cmd} saiu com codigo ${code}: ${stderr.trim().split('\n').slice(-4).join(' | ')}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Falha ao executar ${cmd}: ${err.message}. O binario esta instalado no container?`));
    });
  });
}

async function download(url: string, destPath: string, label: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar ${label} (HTTP ${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error(`${label} veio vazio: ${url}`);
  fs.writeFileSync(destPath, buffer);
}

/** O video tem faixa de audio propria? Muda o filtro do ffmpeg. */
async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const out = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      filePath,
    ], 30_000);
    return out.trim().length > 0;
  } catch {
    // Se o ffprobe falhar, seguimos como se nao houvesse audio — o filtro
    // simples funciona nos dois casos, so nao preserva o som original.
    return false;
  }
}

async function uploadMixedVideo(filePath: string): Promise<string> {
  const key = `videos/mixed/${randomUUID()}.mp4`;
  const buffer = fs.readFileSync(filePath);
  await minioClient.putObject(env.MINIO_BUCKET, key, buffer, buffer.length, {
    'Content-Type': 'video/mp4',
  });
  return `${env.MINIO_PUBLIC_URL}/${env.MINIO_BUCKET}/${key}`;
}

/**
 * Monta o filtro do ffmpeg. Separado para poder ser testado sem rede.
 *
 * duration=first prende a saida a duracao do audio do video; quando o video
 * nao tem som, so aplicamos o ganho na trilha.
 */
export function buildMixFilter(videoHasAudio: boolean, volume: number): string {
  const gain = (Math.min(Math.max(volume, 0), 100) / 100).toFixed(2);
  return videoHasAudio
    ? `[1:a]volume=${gain}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[aout]`
    : `[1:a]volume=${gain}[aout]`;
}

/**
 * Mixa dois arquivos LOCAIS. E a etapa que realmente mexe em midia — fica
 * exportada para ser testavel com arquivos de verdade, sem MinIO nem rede.
 */
export async function mixLocalFiles(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  volume = 80,
): Promise<void> {
  const videoHasAudio = await hasAudioStream(videoPath);
  console.log(`[AudioMixer] Video ${videoHasAudio ? 'tem' : 'nao tem'} audio original`);

  await run('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-filter_complex', buildMixFilter(videoHasAudio, volume),
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',       // nao reencoda o video: rapido e sem perda
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ]);

  const stats = fs.statSync(outputPath);
  if (stats.size === 0) throw new Error('ffmpeg gerou um arquivo vazio');
  console.log(`[AudioMixer] Mixado: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
}

/**
 * Baixa video e audio, mixa e devolve a URL publica do resultado.
 *
 * @param volume 0–100, volume da trilha adicionada (padrao 80). Quando o video
 *   ja tem som, o audio original e preservado e a trilha entra por cima.
 */
export async function mixAudioIntoVideo(
  videoUrl: string,
  audioUrl: string,
  volume = 80,
): Promise<string> {
  const workDir = path.join(os.tmpdir(), 'disparaai-audio-mix', randomUUID());
  fs.mkdirSync(workDir, { recursive: true });

  const videoPath = path.join(workDir, 'input-video.mp4');
  const audioPath = path.join(workDir, 'input-audio');
  const outputPath = path.join(workDir, 'output.mp4');

  try {
    console.log(`[AudioMixer] Baixando video e trilha (volume=${volume}%)...`);
    await Promise.all([
      download(videoUrl, videoPath, 'video'),
      download(audioUrl, audioPath, 'audio'),
    ]);

    await mixLocalFiles(videoPath, audioPath, outputPath, volume);

    const url = await uploadMixedVideo(outputPath);
    console.log(`[AudioMixer] Publicado no MinIO: ${url}`);
    return url;
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
}
