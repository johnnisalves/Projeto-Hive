import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildMixFilter, mixLocalFiles } from './audio-mixer.service';

/**
 * Testes da mixagem de trilha sonora, com midia de verdade gerada pelo
 * proprio ffmpeg. Nao ha rede nem MinIO aqui — so a etapa que manipula video.
 *
 * O que esta sendo protegido: o post sair mudo (faixa de audio ausente) ou
 * com a duracao errada (a trilha esticando o video). Os dois ja aconteceram
 * em pipelines parecidos e sao invisiveis ate alguem assistir ao post.
 */

const workDir = path.join(os.tmpdir(), 'disparaai-mixer-test');

/** Duracao em segundos, lida pelo ffprobe. */
function duration(file: string): number {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]).toString();
  return parseFloat(out.trim());
}

/** Ha faixa de audio no arquivo? */
function hasAudio(file: string): boolean {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file,
  ]).toString();
  return out.trim().length > 0;
}

const mutePath = path.join(workDir, 'video-mudo.mp4');
const soundPath = path.join(workDir, 'video-com-som.mp4');
const trackPath = path.join(workDir, 'trilha.m4a');

before(() => {
  fs.mkdirSync(workDir, { recursive: true });

  // Video de 4s SEM audio
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mutePath], { stdio: 'ignore' });

  // Video de 4s COM audio (tom de 440Hz)
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', soundPath], { stdio: 'ignore' });

  // Trilha de 12s — bem mais longa que os videos, de proposito
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=12',
    '-c:a', 'aac', trackPath], { stdio: 'ignore' });
});

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('buildMixFilter', () => {
  test('video sem audio: so aplica ganho na trilha', () => {
    assert.equal(buildMixFilter(false, 80), '[1:a]volume=0.80[aout]');
  });

  test('video com audio: mistura os dois preservando o original', () => {
    const f = buildMixFilter(true, 50);
    assert.match(f, /\[1:a\]volume=0\.50\[music\]/);
    assert.match(f, /\[0:a\]\[music\]amix=inputs=2/);
    // duration=first prende a saida a duracao do audio do VIDEO
    assert.match(f, /duration=first/);
  });

  test('volume fora da faixa e preso entre 0 e 100', () => {
    assert.equal(buildMixFilter(false, 999), '[1:a]volume=1.00[aout]');
    assert.equal(buildMixFilter(false, -50), '[1:a]volume=0.00[aout]');
  });
});

describe('mixLocalFiles (ffmpeg de verdade)', () => {
  test('video mudo ganha a trilha', async () => {
    const out = path.join(workDir, 'saida-mudo.mp4');
    assert.equal(hasAudio(mutePath), false, 'o video de origem deveria estar mudo');

    await mixLocalFiles(mutePath, trackPath, out, 80);

    assert.equal(hasAudio(out), true, 'o video mixado precisa ter faixa de audio');
  });

  test('trilha longa NAO estica o video (o -shortest corta)', async () => {
    const out = path.join(workDir, 'saida-corte.mp4');
    await mixLocalFiles(mutePath, trackPath, out, 80);

    // Trilha de 12s num video de 4s: a saida tem que ficar em ~4s.
    assert.ok(
      Math.abs(duration(out) - 4) < 1,
      `esperava ~4s, veio ${duration(out)}s — a trilha esticou o video`,
    );
  });

  test('video com som mantem a faixa e recebe a trilha por cima', async () => {
    const out = path.join(workDir, 'saida-com-som.mp4');
    await mixLocalFiles(soundPath, trackPath, out, 40);

    assert.equal(hasAudio(out), true);
    assert.ok(Math.abs(duration(out) - 4) < 1, `esperava ~4s, veio ${duration(out)}s`);
  });

  test('volume zero ainda produz arquivo valido com audio', async () => {
    const out = path.join(workDir, 'saida-mudo-zero.mp4');
    await mixLocalFiles(mutePath, trackPath, out, 0);

    assert.equal(hasAudio(out), true);
    assert.ok(fs.statSync(out).size > 0);
  });

  test('audio inexistente falha com erro claro, sem travar', async () => {
    const out = path.join(workDir, 'saida-erro.mp4');
    await assert.rejects(
      () => mixLocalFiles(mutePath, path.join(workDir, 'nao-existe.mp3'), out, 80),
      /ffmpeg/,
    );
  });
});
