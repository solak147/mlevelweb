const { createHash, randomBytes } = require('node:crypto');

// 綠界全方位金流（AIO）測試環境結帳頁
const DEFAULT_API_URL = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
// 綠界官方公開測試特店資料
const DEFAULT_MERCHANT_ID = '2000132';
const DEFAULT_HASH_KEY = '5294y06JbISpM5x9';
const DEFAULT_HASH_IV = 'v77hoKGq4kWxNNIS';

function optionalEnv(...names) {
  for (const name of names) {
    const value = (process.env[name] || '').trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

// 綠界文件上公開的測試特店金鑰。任何人都查得到，所以拿它們簽的 CheckMacValue
// 等於沒有簽 —— 只能出現在測試環境。
const PUBLIC_TEST_HASH_KEYS = new Set([DEFAULT_HASH_KEY, 'pwFHCqoQZGmho4w6']);
const STAGE_HOST = 'payment-stage.ecpay.com.tw';

/**
 * 讀取綠界設定。
 *
 * HashKey/HashIV 是驗證付款回呼（CheckMacValue）的唯一憑據，所以「沿用綠界公開的
 * 測試特店」必須是明確的選擇，不能是忘記設定的結果 —— 否則部署時少帶 functions/.env
 * （這個檔案不進版控），線上服務就會靜默退回公開金鑰，任何人都能偽造 /notify
 * 自己發一組授權金鑰出來，而且結帳頁還指向測試站、根本不收錢。
 *
 * 因此三個欄位一律必填；要用公開測試特店得設 ECPAY_ALLOW_PUBLIC_TEST_CREDENTIALS=true，
 * 而且只有結帳網址指向 payment-stage 時才允許。
 */
function getEcpayConfig() {
  const apiUrl = optionalEnv('ECPAY_API_URL') || DEFAULT_API_URL;
  const merchantId = optionalEnv('ECPAY_MERCHANT_ID');
  const hashKey = optionalEnv('ECPAY_HASH_KEY');
  const hashIV = optionalEnv('ECPAY_HASH_IV');
  const isStage = apiUrl.includes(STAGE_HOST);
  const allowPublicTest =
    String(process.env.ECPAY_ALLOW_PUBLIC_TEST_CREDENTIALS || '').trim().toLowerCase() === 'true';

  // 自有金鑰絕不能跑在正式結帳網址以外，也不能是綠界公開的那幾組
  if (!isStage && PUBLIC_TEST_HASH_KEYS.has(hashKey)) {
    throw new Error(
      'Refusing to use ECPay public test credentials against the production checkout URL.',
    );
  }

  if (!merchantId || !hashKey || !hashIV) {
    if (!allowPublicTest) {
      throw new Error(
        'ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV are required. ' +
          'Set ECPAY_ALLOW_PUBLIC_TEST_CREDENTIALS=true to intentionally fall back to ECPay public test credentials (stage only).',
      );
    }
    if (!isStage) {
      throw new Error(
        `Refusing to fall back to ECPay public test credentials: ECPAY_API_URL is not the stage checkout URL (${apiUrl}).`,
      );
    }

    // 退回公開測試特店時三個值必須成套，不能把自有 MerchantID 配上公開 HashKey ——
    // 那種組合簽出來的 CheckMacValue 兩邊都對不上，只會是難查的怪錯誤。
    return {
      apiUrl,
      merchantId: DEFAULT_MERCHANT_ID,
      hashKey: DEFAULT_HASH_KEY,
      hashIV: DEFAULT_HASH_IV,
      callbackBaseUrl: optionalEnv('ECPAY_CALLBACK_BASE_URL'),
    };
  }

  return {
    apiUrl,
    merchantId,
    hashKey,
    hashIV,
    callbackBaseUrl: optionalEnv('ECPAY_CALLBACK_BASE_URL'),
  };
}

function buildEcpayCallbackBaseUrl(config, fallbackBaseUrl) {
  const baseUrl = config.callbackBaseUrl || fallbackBaseUrl;
  if (!baseUrl) {
    throw new Error('ECPay callback base URL is required.');
  }

  return baseUrl.replace(/\/$/, '');
}

/**
 * 產生符合綠界規範的特店交易編號（MerchantTradeNo）：
 * 僅能是英數字、長度上限 20 碼。這裡用 ML + 12 碼時間 + 6 碼亂數 = 20 碼。
 */
function generateMerchantTradeNo() {
  const now = new Date();
  const pad = (value) => value.toString().padStart(2, '0');
  const stamp =
    now.getUTCFullYear().toString().slice(2) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds());
  const suffix = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  return `ML${stamp}${suffix}`;
}

/**
 * 依綠界規範以台北時區輸出交易時間：yyyy/MM/dd HH:mm:ss
 */
function formatMerchantTradeDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const lookup = (type) => (parts.find((part) => part.type === type) || {}).value || '';
  const hour = lookup('hour') === '24' ? '00' : lookup('hour');
  return `${lookup('year')}/${lookup('month')}/${lookup('day')} ${hour}:${lookup('minute')}:${lookup('second')}`;
}

/**
 * 計算綠界 CheckMacValue（EncryptType=1 使用 SHA256）。
 * 演算法：參數依 key 英文字母排序 → 前後加上 HashKey/HashIV →
 * 全字串 URL encode（.NET 風格：空白轉 +、' ~ 轉 %27/%7e）→ 轉小寫 → SHA256 → 轉大寫。
 */
function generateCheckMacValue(params, hashKey, hashIV) {
  const sortedKeys = Object.keys(params).sort((a, b) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));
  const query = sortedKeys.map((key) => `${key}=${params[key]}`).join('&');
  const raw = `HashKey=${hashKey}&${query}&HashIV=${hashIV}`;

  const encoded = encodeURIComponent(raw)
    .toLowerCase()
    .replace(/'/g, '%27')
    .replace(/~/g, '%7e')
    .replace(/%20/g, '+');

  return createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

/**
 * 建立信用卡一次付清（ChoosePayment=Credit，不帶任何分期／定期定額參數）的 AIO 訂單。
 * 回傳綠界結帳頁的 action 與需要 POST 的所有欄位（含 CheckMacValue）。
 */
function buildEcpayOrder(input) {
  const config = getEcpayConfig();

  const params = {
    MerchantID: config.merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    MerchantTradeDate: formatMerchantTradeDate(),
    PaymentType: 'aio',
    TotalAmount: String(Math.round(input.amount)),
    TradeDesc: input.tradeDesc || 'MLevel 自動化輔助程式授權',
    ItemName: input.productName,
    ReturnURL: input.returnUrl,
    OrderResultURL: input.orderResultUrl,
    ChoosePayment: 'Credit',
    EncryptType: '1',
  };

  if (input.clientBackUrl) {
    params.ClientBackURL = input.clientBackUrl;
  }

  params.CheckMacValue = generateCheckMacValue(params, config.hashKey, config.hashIV);

  return {
    action: config.apiUrl,
    params,
  };
}

/**
 * 驗證綠界回傳的 CheckMacValue 是否正確（防止竄改）。
 */
function verifyEcpayCallback(payload) {
  const config = getEcpayConfig();
  const received = typeof payload.CheckMacValue === 'string' ? payload.CheckMacValue : '';
  if (!received) {
    return false;
  }

  const params = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'CheckMacValue' || value === undefined || value === null) {
      continue;
    }
    params[key] = String(value);
  }

  const expected = generateCheckMacValue(params, config.hashKey, config.hashIV);
  return expected === received.toUpperCase();
}

module.exports = {
  buildEcpayCallbackBaseUrl,
  buildEcpayOrder,
  generateCheckMacValue,
  generateMerchantTradeNo,
  getEcpayConfig,
  verifyEcpayCallback,
};
