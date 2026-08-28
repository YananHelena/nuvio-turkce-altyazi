const path = require('node:path');
const { TextDecoder } = require('node:util');
const unzipper = require('unzipper');

const SUPPORTED_EXTENSIONS = new Set(['.vtt', '.srt', '.ass', '.ssa']);
const EXTENSION_PRIORITY = new Map([['.vtt', 0], ['.srt', 1], ['.ass', 2], ['.ssa', 3]]);

function decodeSubtitle(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1254').decode(buffer);
  }
}

function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, '\n').trim();
}

function srtToVtt(value) {
  const normalized = normalizeNewlines(value);
  const cues = normalized.replace(/(\d{1,2}:\d{2}:\d{2})[,.](\d{3})(\s+-->\s+\d{1,2}:\d{2}:\d{2})[,.](\d{3})/g, '$1.$2$3.$4');
  return `WEBVTT\n\n${cues}\n`;
}

function convertToVtt(filename, buffer) {
  const extension = path.extname(filename).toLowerCase();
  const decoded = decodeSubtitle(buffer);
  if (extension === '.vtt' || extension === '.srt') return srtToVtt(decoded);
  throw new Error(`Unsupported format: ${extension}`);
}

function matchesEpisode(filename, season, episode) {
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return false;
  const value = filename.toLowerCase();
  const seasonValue = String(season).padStart(2, '0');
  const episodeValue = String(episode).padStart(2, '0');
  const patterns = [
    new RegExp(`(?:^|[^a-z0-9])s0?${season}[^a-z0-9]*e0?${episode}(?:[^0-9]|$)`, 'i'),
    new RegExp(`(?:^|[^0-9])0?${season}x0?${episode}(?:[^0-9]|$)`, 'i'),
    new RegExp(`s${seasonValue}e${episodeValue}`, 'i'),
  ];
  return patterns.some((pattern) => pattern.test(value));
}

async function extractSubtitleFromArchive(archive, { season = null, episode = null, requireEpisodeMatch = false } = {}) {
  const directory = await unzipper.Open.buffer(archive);
  const entries = directory.files.filter((entry) => entry.type === 'File' && SUPPORTED_EXTENSIONS.has(path.extname(entry.path).toLowerCase()));

  const ranked = entries
    .map((entry) => ({
      entry,
      episodeMatch: matchesEpisode(entry.path, season, episode),
      extensionPriority: EXTENSION_PRIORITY.get(path.extname(entry.path).toLowerCase()) ?? 99,
    }))
    .filter((candidate) => !requireEpisodeMatch || candidate.episodeMatch)
    .sort((a, b) => Number(b.episodeMatch) - Number(a.episodeMatch) || a.extensionPriority - b.extensionPriority);

  if (ranked.length === 0 && entries.length > 0) {
    ranked.push({ entry: entries[0], episodeMatch: false, extensionPriority: 1 });
  }

  if (ranked.length === 0) throw new Error('Archive contains no supported subtitle files');

  const target = ranked[0];
  const body = Buffer.from(convertToVtt(target.entry.path, await target.entry.buffer()), 'utf8');
  return { body, sourceName: path.basename(target.entry.path) };
}

module.exports = { convertToVtt, extractSubtitleFromArchive, matchesEpisode };
