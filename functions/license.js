const { randomBytes, randomInt } = require('node:crypto');

// 去掉容易看錯的字元（0/O、1/I/L），使用者要用手抄／複製都不易出錯
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KEY_GROUPS = 4;
const KEY_GROUP_SIZE = 4;

const KEY_LENGTH = KEY_GROUPS * KEY_GROUP_SIZE;
const KEY_PATTERN = /^MLV-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/;

/**
 * 產生授權金鑰，格式為 MLV-XXXX-XXXX-XXXX-XXXX。
 * 用 randomInt（CSPRNG、無模數偏差）逐字挑選字元。
 */
function generateLicenseKey() {
  const groups = [];
  for (let g = 0; g < KEY_GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < KEY_GROUP_SIZE; i += 1) {
      group += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
    }
    groups.push(group);
  }
  return `MLV-${groups.join('-')}`;
}

/**
 * 把使用者手動輸入的金鑰整理成標準格式：去掉空白與連字號、轉大寫，
 * 缺少的 MLV- 前綴與分組補回去。整理不出合法格式時回傳空字串。
 */
function normalizeLicenseKey(value) {
  let body = (typeof value === 'string' ? value : '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // 只有在長度剛好是「前綴 + 金鑰本體」時才把 MLV 當前綴拿掉，
  // 避免把本體第一組真的以 MLV 開頭的金鑰誤切。
  if (body.length === KEY_LENGTH + 3 && body.startsWith('MLV')) {
    body = body.slice(3);
  }
  if (body.length !== KEY_LENGTH) {
    return '';
  }

  const groups = [];
  for (let i = 0; i < KEY_LENGTH; i += KEY_GROUP_SIZE) {
    groups.push(body.slice(i, i + KEY_GROUP_SIZE));
  }

  const key = `MLV-${groups.join('-')}`;
  return KEY_PATTERN.test(key) ? key : '';
}

/**
 * 訂單查詢用的存取權杖。付款回跳網址會帶上它，
 * 讓 /order 端點不會只憑（相對好猜的）訂單編號就吐出授權金鑰。
 */
function generateAccessToken() {
  return randomBytes(24).toString('base64url');
}

/**
 * 授權有效期限：自付款起算 30 天。
 */
function calcExpiresAt(paidAtMs, days = 30) {
  return new Date(paidAtMs + days * 24 * 60 * 60 * 1000);
}

/**
 * 顯示用的 email 遮罩：kevin@example.com → ke***@example.com
 */
function maskEmail(email) {
  const value = typeof email === 'string' ? email.trim() : '';
  const at = value.indexOf('@');
  if (at <= 0) {
    return '';
  }
  const name = value.slice(0, at);
  const domain = value.slice(at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}***${domain}`;
}

module.exports = {
  calcExpiresAt,
  generateAccessToken,
  generateLicenseKey,
  maskEmail,
  normalizeLicenseKey,
};
