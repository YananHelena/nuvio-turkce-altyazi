const crypto = require('node:crypto');

const SECRET = process.env.TOKEN_SECRET || 'nuvio-turkce-altyazi-secret-key';

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(SECRET, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}.${encrypted}.${tag}`;
}

function decrypt(token) {
  try {
    const [ivHex, encrypted, tagHex] = token.split('.');
    if (!ivHex || !encrypted || !tagHex) throw new Error('Invalid token format');
    const key = crypto.scryptSync(SECRET, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    throw new Error('Failed to decrypt token');
  }
}

function encodeSubtitleToken(info) {
  return encrypt(JSON.stringify(info));
}

function decodeSubtitleToken(token) {
  return JSON.parse(decrypt(token));
}

function validateDownloadInfo(info) {
  if (!info || !info.altid) {
    throw new Error('Invalid download info: missing altid');
  }
  return info;
}

module.exports = {
  encodeSubtitleToken,
  decodeSubtitleToken,
  validateDownloadInfo,
};
