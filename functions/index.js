const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

const {
  buildEcpayCallbackBaseUrl,
  buildEcpayOrder,
  generateMerchantTradeNo,
  getEcpayConfig,
  verifyEcpayCallback,
} = require('./ecpay');
const {
  calcExpiresAt,
  generateAccessToken,
  generateLicenseKey,
  generateSessionId,
  hashDeviceId,
  hashLicenseKey,
  maskEmail,
  normalizeLicenseKey,
} = require('./license');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({
  region: 'asia-east1',
  maxInstances: 10,
});

const ORDERS = 'mlevel_orders';
const SESSIONS = 'mlevel_sessions';

// ── 一把金鑰同時只能有一個人在用 ────────────────────────────────────────────
//
// 做法是「租約 + 心跳」而不是綁死裝置：桌面程式啟動時 /session/acquire 取得一張
// 席位租約（sessionId），之後每 SESSION_HEARTBEAT_SECONDS 秒送一次 /session/heartbeat
// 續租。超過 SESSION_LEASE_MS 沒有心跳就視為離線，席位自動釋放給下一個人。
//
// 這樣使用者可以自由換電腦（不必解綁），但同一時間只會有一個工作階段成立。
//
// 兩個數字是在「被佔用時要等多久」和「自己當機後要等多久才能重開」之間取捨：
// 心跳 3 分鐘一次、10 分鐘沒消息才放掉 —— 正常的網路抖動不會被踢掉，
// 真的當機最多等 10 分鐘。Firestore 寫入量約每人每天 480 筆，成本可忽略。
const SESSION_HEARTBEAT_SECONDS = 180;
const SESSION_LEASE_MS = 10 * 60 * 1000;
// 心跳比這個間隔還密就不寫入（仍回 ok）。省成本，也順手擋掉狂打心跳的客戶端。
const SESSION_HEARTBEAT_MIN_WRITE_MS = 30 * 1000;
// 剛被強制接手的席位有一段冷卻時間，免得兩個人互踢來互踢去、變成勉強可用的共用。
const SESSION_TAKEOVER_COOLDOWN_MS = 2 * 60 * 1000;

// /verify 是舊版桌面程式的啟動檢查，它不佔席位。設成 true 之後 /verify 會要求使用者
// 更新程式，這樣舊版就不能繞過「一次一人」的限制。等新版鋪開後再打開。
const REQUIRE_SESSION = String(process.env.MLEVEL_REQUIRE_SESSION || '').trim().toLowerCase() === 'true';

// 商品的權威售價（TWD）。/create 一律以此表計價，不採用前端傳入的 amount，
// 避免有人自組 request 用 1 元換授權金鑰。調價時前端顯示的價格也要一起改
// （HeroSection.vue 與 CheckoutModal.vue）。
const PRODUCT = {
  type: 'mlevel_monthly',
  name: 'MLevel 月訂閱授權（30 天）',
  amount: 399,
  licenseDays: 30,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_CHARS = 254;

// 綠界的 MerchantTradeNo 規格是「僅英數字、上限 20 碼」，我們自己產的也是這個格式。
// 回呼帶進來的值會被當成 Firestore 的 document id，先擋掉不合格式的，
// 免得把奇怪字元（例如 `/`）餵進 Firestore 或反射進 HTML。
const ORDER_ID_PATTERN = /^[A-Za-z0-9]{1,20}$/;

// 綠界回呼要寫進 Firestore 的欄位白名單。
//
// 信用卡回呼會帶 card6no（卡號前六碼，也就是發卡行 BIN）與 card4no（後四碼）。
// 後四碼對客服核對交易有用、留著；前六碼沒有用途，卻是敏感的卡片資訊，不留。
// CheckMacValue 也不存 —— 驗過就沒有用了，留著只是多一份簽章在資料庫裡。
// 白名單以外的欄位一律丟掉，之後綠界新增欄位也不會自動被存下來。
const CALLBACK_FIELDS = new Set([
  // 交易本體
  'MerchantID', 'MerchantTradeNo', 'StoreID', 'TradeNo', 'TradeAmt', 'TradeDate',
  'RtnCode', 'RtnMsg', 'PaymentType', 'PaymentTypeChargeFee', 'PaymentDate', 'SimulatePaid',
  'CustomField1', 'CustomField2', 'CustomField3', 'CustomField4',
  // 信用卡授權資訊（對帳／退刷時要用）
  'gwsr', 'process_date', 'auth_code', 'amount', 'eci', 'card4no',
  'stage', 'stast', 'staed',
]);

/**
 * 過濾綠界回呼，只留白名單欄位。
 * 被丟掉的欄位「只記名稱、不記內容」—— 否則 card6no 又會原封不動進 Cloud Logging。
 */
function pickCallbackFields(payload) {
  const kept = {};
  const dropped = [];

  for (const [key, value] of Object.entries(payload)) {
    if (CALLBACK_FIELDS.has(key)) {
      kept[key] = typeof value === 'string' ? value : String(value);
    } else {
      dropped.push(key);
    }
  }

  if (dropped.length) {
    logger.info('Dropped ECPay callback fields', { dropped });
  }

  return kept;
}

// 程式壓縮檔在 Cloud Storage 的位置。/download 每次都即時讀這個物件，
// 所以要發布新版只要覆蓋它，不必改環境變數也不必重新部署 Functions。
const STORAGE_BUCKET = (process.env.MLEVEL_STORAGE_BUCKET || '').trim();
const DOWNLOAD_OBJECT = (process.env.MLEVEL_STORAGE_OBJECT || 'mlevel.zip').trim().replace(/^\/+/, '');
const DOWNLOAD_FILENAME = DOWNLOAD_OBJECT.split('/').pop() || 'mlevel.zip';
// 簽章網址的有效期。夠久讓使用者按下下載、又短到轉貼出去很快就失效。
const DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000;

// /lookup 與 /verify 的粗略防爆破：同一 IP 一分鐘的次數上限。
// 計數只存在單一實例的記憶體裡，擋不住分散式嘗試，但足以讓亂試腳本沒效率。
const LOOKUP_WINDOW_MS = 60 * 1000;
const LOOKUP_MAX_ATTEMPTS = 10;
// 程式每次啟動都會打一次 /verify，而網咖／宿舍會共用出口 IP，所以這裡放寬一些。
const VERIFY_MAX_ATTEMPTS = 30;
const LOOKUP_TRACKED_IPS = 500;
const lookupAttempts = new Map();
const verifyAttempts = new Map();

/**
 * X-Forwarded-For 是「用戶端可自由填寫」的 header：Google Front End 只會把真正的
 * 來源 IP「附加」上去，不會清掉前面的內容。所以取第一段等於讓對方自己決定要被
 * 算在哪個 IP 頭上，換一個假值限流就歸零。
 *
 * GFE 的格式是 `<用戶端填的...>, <真正的來源 IP>, <GFE 的 IP>`，
 * 真正可信的是倒數第二段；長度不足時只能退回 request.ip。
 */
function getClientIp(request) {
  const chain = String(request.get('x-forwarded-for') || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (chain.length >= 2) {
    return chain[chain.length - 2];
  }

  return request.ip || chain[0] || '';
}

function tooManyAttempts(attempts, ip, max) {
  if (!ip) {
    return false;
  }

  const now = Date.now();
  const hits = (attempts.get(ip) || []).filter((at) => now - at < LOOKUP_WINDOW_MS);
  hits.push(now);

  // 單純避免記憶體無上限成長，超過就整批丟掉重新計數
  if (attempts.size > LOOKUP_TRACKED_IPS) {
    attempts.clear();
  }
  attempts.set(ip, hits);

  return hits.length > max;
}

function tooManyLookups(ip) {
  return tooManyAttempts(lookupAttempts, ip, LOOKUP_MAX_ATTEMPTS);
}

function tooManyVerifies(ip) {
  return tooManyAttempts(verifyAttempts, ip, VERIFY_MAX_ATTEMPTS);
}

// App Check：驗「這個請求是不是從自家網站發出來的」。只驗瀏覽器會打的三支端點，
// /notify 與 /result 是綠界的伺服器與轉址、/verify 是桌面程式、/download 是使用者直接
// 點連結開新頁，這些都帶不了 App Check token，驗了只會把正常流程擋死。
const APPCHECK_PATHS = new Set(['/create', '/order', '/lookup']);
// 預設「只記錄不阻擋」（monitor 模式），確認 Console 的 App Check 報表幾乎全是已驗證流量後，
// 再把 functions/.env 的 MLEVEL_APPCHECK_ENFORCE 設成 true 開始真的擋。
const APPCHECK_ENFORCE = String(process.env.MLEVEL_APPCHECK_ENFORCE || '').trim().toLowerCase() === 'true';

/**
 * 通過就回 true；沒通過且處於強制模式時，會直接把 401 回出去並回 false，
 * 呼叫端只要 `if (!(await verifyAppCheck(...))) return;` 就好。
 */
async function verifyAppCheck(request, response) {
  const token = request.get('X-Firebase-AppCheck') || '';
  const path = request.path;

  if (token) {
    try {
      await admin.appCheck().verifyToken(token);
      return true;
    } catch (error) {
      logger.warn('App Check token rejected', {
        path,
        enforce: APPCHECK_ENFORCE,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    logger.warn('App Check token missing', { path, enforce: APPCHECK_ENFORCE });
  }

  if (!APPCHECK_ENFORCE) {
    return true;
  }

  response.status(401).json({ ok: false, error: '來源驗證失敗，請重新整理頁面後再試。' });
  return false;
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-AppCheck');
}

function getEcpayCallbackBaseUrl(request) {
  const host = request.get('host');
  if (!host) {
    return undefined;
  }

  return `${request.protocol || 'https'}://${host}/ecpayApi`;
}

/**
 * 這支 Function 自己對外的 base URL，用來組 /download 連結。
 * ECPAY_CALLBACK_BASE_URL 指的就是同一個 base，沒設定時從 request host 推導。
 */
function getApiBaseUrl(request) {
  const configured = String(process.env.ECPAY_CALLBACK_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

  return configured || getEcpayCallbackBaseUrl(request) || '';
}

/**
 * 只允許導回自家網域，避免 /result 變成開放轉址（open redirect）。
 * 額外允許的網域用 MLEVEL_ALLOWED_REDIRECT_HOSTS 以逗號分隔設定。
 */
function sanitizeRedirectBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return '';
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return '';
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
  const allowed = new Set(
    [
      'localhost',
      '127.0.0.1',
      projectId ? `${projectId}.web.app` : '',
      projectId ? `${projectId}.firebaseapp.com` : '',
      ...String(process.env.MLEVEL_ALLOWED_REDIRECT_HOSTS || '')
        .split(',')
        .map((host) => host.trim().toLowerCase()),
    ].filter(Boolean),
  );

  if (!allowed.has(url.hostname.toLowerCase())) {
    logger.warn('Rejected redirectBaseUrl with disallowed host', { host: url.hostname });
    return '';
  }

  // 只留下 origin + path，丟掉來路不明的 query / hash
  return `${url.origin}${url.pathname}`.replace(/\/$/, '') || url.origin;
}

/**
 * 付款成功時發出授權金鑰。用交易確保重複回呼（/notify 與 /result 都會打）
 * 只會發一組金鑰、只寫一次 paidAt。
 */
async function markOrderPaid(merchantTradeNo, payload) {
  // 縱深防禦：就算 CheckMacValue 過了（例如 HashKey 外流），也要確認這筆回呼
  // 真的是打給我們這個特店的
  const { merchantId } = getEcpayConfig();
  if (payload.MerchantID !== undefined && String(payload.MerchantID) !== merchantId) {
    logger.error('Paid callback MerchantID mismatch', {
      merchantTradeNo,
      received: String(payload.MerchantID),
    });
    return null;
  }

  const ref = db.collection(ORDERS).doc(merchantTradeNo);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      logger.error('Paid callback for unknown order', { merchantTradeNo });
      return null;
    }

    const data = snapshot.data();
    if (data.status === 'paid' && data.licenseKey) {
      return data;
    }

    // 實收金額必須等於這筆訂單的金額，否則不發金鑰。
    // 綠界的 ReturnURL / OrderResultURL 一定會帶 TradeAmt，缺了就是不該信的回呼。
    const paidAmount = Number(payload.TradeAmt);
    if (!Number.isFinite(paidAmount) || Math.round(paidAmount) !== Math.round(Number(data.amount))) {
      logger.error('Paid callback TradeAmt mismatch', {
        merchantTradeNo,
        received: payload.TradeAmt,
        expected: data.amount,
      });
      return null;
    }

    const paidAt = new Date();
    const licenseKey = data.licenseKey || generateLicenseKey();
    const update = {
      status: 'paid',
      licenseKey,
      licenseExpiresAt: admin.firestore.Timestamp.fromDate(
        calcExpiresAt(paidAt.getTime(), PRODUCT.licenseDays),
      ),
      transactionId: typeof payload.TradeNo === 'string' ? payload.TradeNo : '',
      paidAt: admin.firestore.Timestamp.fromDate(paidAt),
      ecpayRawResult: pickCallbackFields(payload),
    };

    tx.set(ref, update, { merge: true });
    return { ...data, ...update };
  });
}

/**
 * 下載一律走本服務的 /download，才能在每次下載時重新驗證授權，
 * 也讓 Storage 上換檔時不必更新任何設定或前端。
 * 推導不出 base URL 時才退回舊的固定連結。
 */
function buildDownloadUrl(apiBaseUrl, data) {
  if (!apiBaseUrl) {
    return (process.env.MLEVEL_DOWNLOAD_URL || '').trim();
  }

  const query = new URLSearchParams({
    orderId: data.orderId || '',
    token: data.accessToken || '',
  });

  return `${apiBaseUrl}/download?${query.toString()}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

/**
 * /download 是使用者在瀏覽器點連結進來的，出錯時回 JSON 只會看到一串看不懂的文字。
 * 這裡回一個最小的說明頁，附上代碼方便回報客服。
 */
function sendDownloadError(response, status, code, message) {
  response
    .status(status)
    .type('html')
    .send(`<!doctype html>
<html lang="zh-Hant">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>無法下載 MLevel</title></head>
  <body style="margin:0;padding:48px 24px;background:#0b0e14;color:#e6ebf5;font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;line-height:1.7;">
    <div style="max-width:520px;margin:0 auto;">
      <h1 style="font-size:22px;margin:0 0 12px;">無法下載 MLevel</h1>
      <p style="color:#98a3bb;font-size:15px;margin:0 0 20px;">${escapeHtml(message)}</p>
      <p style="color:#6b7590;font-size:13px;margin:0;">代碼：<code>${escapeHtml(code)}</code></p>
    </div>
  </body>
</html>`);
}

/**
 * 產生真正指向檔案的下載網址，讓瀏覽器直接去 Storage 拿。
 *
 * 不自己把檔案串出去，是因為 Cloud Run 對固定長度的回應有 32 MiB 上限，
 * 幾十 MB 的壓縮檔會在送出第一個 byte 之前就被擋掉（回 500、body 是空的），
 * 而且串檔還要付 Function 的執行時間與流量、也不支援續傳。
 *
 * 優先用 V4 簽章網址（短效，轉貼出去很快失效）；簽章需要服務帳號有
 * iam.serviceAccounts.signBlob 權限，沒有的話退回 Storage 物件自己的
 * download token —— 那個 token 每次都即時從 metadata 讀，所以覆蓋檔案
 * 換版之後依然指向新檔。
 */
async function resolveStorageDownloadUrl(file, metadata) {
  try {
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + DOWNLOAD_URL_TTL_MS,
      responseDisposition: `attachment; filename="${DOWNLOAD_FILENAME}"`,
    });

    return { url: signedUrl, kind: 'signed' };
  } catch (error) {
    logger.warn('Signed URL unavailable, falling back to download token', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const token = String(metadata?.metadata?.firebaseStorageDownloadTokens || '')
    .split(',')[0]
    .trim();
  if (!token) {
    return { url: '', kind: 'none' };
  }

  return {
    url: `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`,
    kind: 'token',
  };
}

/**
 * 用授權金鑰找出對應的「已付款」訂單。/verify 與 /session/acquire 共用。
 * licenseKey 是單欄位索引（Firestore 自動建），不需要複合索引。
 */
async function findPaidOrder(licenseKey) {
  const matches = await db.collection(ORDERS).where('licenseKey', '==', licenseKey).limit(5).get();
  return matches.docs.find((doc) => doc.data().status === 'paid') || null;
}

function daysLeftFrom(expiresAt) {
  return expiresAt
    ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;
}

/**
 * 告訴被擋下的人「正在哪台裝置使用中」時，只給前兩個字。
 * 足以讓本人認出是自己的另一台電腦，又不會把完整電腦名稱交給拿到金鑰的其他人。
 */
function maskDeviceLabel(label) {
  const value = typeof label === 'string' ? label.trim() : '';
  if (!value) {
    return '';
  }
  return value.length <= 2 ? `${value}***` : `${value.slice(0, 2)}***`;
}

function toDateOrNull(value) {
  return value && typeof value.toDate === 'function' ? value.toDate() : null;
}

function readExpiresAt(data) {
  return data.licenseExpiresAt && typeof data.licenseExpiresAt.toDate === 'function'
    ? data.licenseExpiresAt.toDate()
    : null;
}

function orderPublicView(data, apiBaseUrl = '') {
  const paidAt = data.paidAt && typeof data.paidAt.toDate === 'function' ? data.paidAt.toDate() : null;
  const expiresAt = readExpiresAt(data);
  const paid = data.status === 'paid';
  const expired = paid && expiresAt ? expiresAt.getTime() <= Date.now() : false;

  return {
    orderId: data.orderId,
    status: data.status,
    productName: data.productName,
    amount: data.amount,
    email: maskEmail(data.email),
    // 只有付款完成才吐出授權金鑰與下載連結
    licenseKey: paid ? data.licenseKey || '' : '',
    licenseExpiresAt: paid && expiresAt ? expiresAt.toISOString() : '',
    licenseExpired: expired,
    downloadUrl: paid && !expired ? buildDownloadUrl(apiBaseUrl, data) : '',
    paidAt: paidAt ? paidAt.toISOString() : '',
  };
}

// 綠界（ECPay）信用卡一次付清 AIO 金流
exports.ecpayApi = onRequest(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }

  const path = request.path.replace(/\/+$/, '') || '/';

  if (APPCHECK_PATHS.has(path) && !(await verifyAppCheck(request, response))) {
    return;
  }

  try {
    if (request.method === 'GET' && path === '/') {
      response.status(200).json({
        ok: true,
        name: 'ecpayApi',
        routes: [
          'POST /create',
          'POST /notify',
          'GET|POST /result',
          'GET /order',
          'POST /lookup',
          'POST /verify',
          'POST /session/acquire',
          'POST /session/heartbeat',
          'POST /session/release',
          'GET /download',
        ],
      });
      return;
    }

    // 1. 前端呼叫：建立訂單並回傳綠界結帳表單參數
    if (request.method === 'POST' && path === '/create') {
      const body = request.body || {};

      const email = typeof body.email === 'string' ? body.email.trim().slice(0, MAX_EMAIL_CHARS) : '';
      if (!EMAIL_PATTERN.test(email)) {
        response.status(400).json({ ok: false, error: '請填寫正確的 Email。' });
        return;
      }

      // 金額一律由後端決定；前端傳來的 amount 僅用於偵測不一致（例如改價後前端還沒更新）
      const requestedAmount = Number(body.amount);
      if (Number.isFinite(requestedAmount) && Math.round(requestedAmount) !== PRODUCT.amount) {
        logger.warn('ECPay create amount mismatch, using server-side price', {
          requestedAmount,
          serverAmount: PRODUCT.amount,
        });
      }

      const redirectBaseUrl = sanitizeRedirectBaseUrl(body.redirectBaseUrl);
      const config = getEcpayConfig();
      const callbackBaseUrl = buildEcpayCallbackBaseUrl(config, getEcpayCallbackBaseUrl(request));
      const merchantTradeNo = generateMerchantTradeNo();
      const accessToken = generateAccessToken();

      await db.collection(ORDERS).doc(merchantTradeNo).set({
        orderId: merchantTradeNo,
        email,
        amount: PRODUCT.amount,
        currency: 'TWD',
        productName: PRODUCT.name,
        productType: PRODUCT.type,
        provider: 'ecpay',
        paymentMethod: 'credit_onetime',
        status: 'pending',
        accessToken,
        redirectBaseUrl,
        licenseKey: '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const order = buildEcpayOrder({
        merchantTradeNo,
        amount: PRODUCT.amount,
        productName: PRODUCT.name,
        returnUrl: `${callbackBaseUrl}/notify`,
        orderResultUrl: `${callbackBaseUrl}/result`,
        clientBackUrl: redirectBaseUrl || undefined,
      });

      response.status(200).json({
        ok: true,
        merchantTradeNo,
        accessToken,
        action: order.action,
        params: order.params,
      });
      return;
    }

    // 2. 綠界伺服器背景通知（ReturnURL）：驗章、發金鑰，必須回覆純文字 1|OK
    if (request.method === 'POST' && path === '/notify') {
      const payload = request.body || {};

      if (!verifyEcpayCallback(payload)) {
        logger.error('ECPay notify CheckMacValue verification failed', { payload });
        response.status(400).send('0|CheckMacValue Error');
        return;
      }

      const rawTradeNo = typeof payload.MerchantTradeNo === 'string' ? payload.MerchantTradeNo : '';
      const merchantTradeNo = ORDER_ID_PATTERN.test(rawTradeNo) ? rawTradeNo : '';
      const rtnCode = Number(payload.RtnCode);

      if (merchantTradeNo && rtnCode === 1) {
        await markOrderPaid(merchantTradeNo, payload);
      }

      response.status(200).send('1|OK');
      return;
    }

    // 3. 綠界付款完成後導回使用者瀏覽器（OrderResultURL）：驗章、確保入帳、導回前端
    if ((request.method === 'POST' || request.method === 'GET') && path === '/result') {
      const payload = (request.method === 'GET' ? request.query : request.body) || {};

      const rawTradeNo = typeof payload.MerchantTradeNo === 'string' ? payload.MerchantTradeNo : '';
      const merchantTradeNo = ORDER_ID_PATTERN.test(rawTradeNo) ? rawTradeNo : '';
      const rtnCode = Number(payload.RtnCode);
      const verified = verifyEcpayCallback(payload);
      const status = verified && rtnCode === 1 ? 'success' : 'cancel';

      let redirectBaseUrl = '';
      let accessToken = '';

      if (merchantTradeNo) {
        // 冪等：若背景通知還沒進來，這裡也把成功訂單標記為已付款並發金鑰
        if (status === 'success') {
          await markOrderPaid(merchantTradeNo, payload);
        }

        const order = (await db.collection(ORDERS).doc(merchantTradeNo).get()).data();
        if (order) {
          redirectBaseUrl = typeof order.redirectBaseUrl === 'string' ? order.redirectBaseUrl : '';
          accessToken = typeof order.accessToken === 'string' ? order.accessToken : '';
        }
      }

      if (redirectBaseUrl) {
        const query = new URLSearchParams({
          orderId: merchantTradeNo,
          status,
        });
        // accessToken 等於這筆訂單的鑰匙（能打 /order 與 /download）。
        // 只有 CheckMacValue 驗過的回呼才是真的來自綠界，才可以把它交出去；
        // 否則任何人只要猜到訂單編號就能拿到別人的授權與下載連結。
        if (verified && accessToken) {
          query.set('token', accessToken);
        }
        response.redirect(`${redirectBaseUrl}/?${query.toString()}`);
        return;
      }

      // 沒有可導回的前端網址時（例如直接測 API），至少給一個純文字結果頁。
      // 這頁的內容全部來自回呼參數，一律轉義，不然就是反射型 XSS。
      response.status(200).type('html').send(`<!doctype html>
        <html lang="zh-Hant">
          <head><meta charset="utf-8" /><title>綠界付款結果</title></head>
          <body style="font-family: sans-serif; padding: 24px;">
            <h1>${status === 'success' ? '付款完成' : '付款未完成'}</h1>
            <p>訂單編號：${escapeHtml(rawTradeNo || '-')}</p>
            <p>綠界訊息：${escapeHtml(typeof payload.RtnMsg === 'string' ? payload.RtnMsg : '-')}</p>
          </body>
        </html>
      `);
      return;
    }

    // 4. 前端付款回跳後查詢訂單狀態與授權金鑰
    if (request.method === 'GET' && path === '/order') {
      const orderId = typeof request.query.orderId === 'string' ? request.query.orderId.trim() : '';
      const token = typeof request.query.token === 'string' ? request.query.token.trim() : '';

      if (!ORDER_ID_PATTERN.test(orderId) || !token) {
        response.status(400).json({ ok: false, error: 'orderId and token are required.' });
        return;
      }

      const snapshot = await db.collection(ORDERS).doc(orderId).get();
      const data = snapshot.data();
      if (!data || data.accessToken !== token) {
        response.status(404).json({ ok: false, error: 'Order not found.' });
        return;
      }

      response.status(200).json({ ok: true, order: orderPublicView(data, getApiBaseUrl(request)) });
      return;
    }

    // 5. 用 Email + 授權金鑰找回訂單。付款回跳的網址一關掉就再也回不去，
    //    這是使用者自己拿回下載連結與金鑰的唯一入口。
    if (request.method === 'POST' && path === '/lookup') {
      const body = request.body || {};
      const email = typeof body.email === 'string' ? body.email.trim().slice(0, MAX_EMAIL_CHARS) : '';
      const licenseKey = normalizeLicenseKey(body.licenseKey);

      if (!EMAIL_PATTERN.test(email) || !licenseKey) {
        response.status(400).json({ ok: false, error: '請填寫正確的 Email 與授權金鑰。' });
        return;
      }

      const clientIp = getClientIp(request);
      if (tooManyLookups(clientIp)) {
        logger.warn('Lookup rate limited', { ip: clientIp });
        response.status(429).json({ ok: false, error: '嘗試次數過多，請一分鐘後再試。' });
        return;
      }

      // 只用 licenseKey 查（單欄位索引 Firestore 會自動建），email 留在程式裡比對，
      // 就不必為了這支查詢多建一個複合索引。
      const matches = await db.collection(ORDERS).where('licenseKey', '==', licenseKey).limit(5).get();
      const hit = matches.docs
        .map((doc) => doc.data())
        .find(
          (data) =>
            data.status === 'paid' && String(data.email || '').toLowerCase() === email.toLowerCase(),
        );

      if (!hit) {
        // 不區分「金鑰錯」與「email 對不上」，避免變成金鑰有效性的探測工具
        response.status(404).json({ ok: false, error: '找不到符合的授權，請確認 Email 與金鑰是否正確。' });
        return;
      }

      response.status(200).json({
        ok: true,
        orderId: hit.orderId,
        accessToken: hit.accessToken || '',
        order: orderPublicView(hit, getApiBaseUrl(request)),
      });
      return;
    }

    // 6. 程式啟動時的授權驗證。只收金鑰、只回「有效嗎、到什麼時候」，
    //    不吐 email、訂單編號或存取權杖 —— 這支端點沒有任何身分驗證，
    //    任何人拿一組金鑰都能打，回什麼就等於對外公開什麼。
    if (request.method === 'POST' && path === '/verify') {
      const licenseKey = normalizeLicenseKey((request.body || {}).licenseKey);

      if (!licenseKey) {
        response.status(400).json({
          ok: false,
          valid: false,
          reason: 'INVALID_FORMAT',
          error: '金鑰格式不正確，應為 MLV-XXXX-XXXX-XXXX-XXXX。',
        });
        return;
      }

      const clientIp = getClientIp(request);
      if (tooManyVerifies(clientIp)) {
        logger.warn('Verify rate limited', { ip: clientIp });
        response.status(429).json({
          ok: false,
          valid: false,
          reason: 'RATE_LIMITED',
          error: '驗證次數過多，請一分鐘後再試。',
        });
        return;
      }

      // /verify 不佔席位，所以舊版程式可以拿同一把金鑰同時開好幾份。新版鋪開後
      // 把 MLEVEL_REQUIRE_SESSION 設成 true，舊版就會被要求更新。
      if (REQUIRE_SESSION) {
        response.status(426).json({
          ok: false,
          valid: false,
          reason: 'UPGRADE_REQUIRED',
          error: '這個版本已停用，請下載最新版 MLevel 後再啟動。',
        });
        return;
      }

      const hit = await findPaidOrder(licenseKey);

      if (!hit) {
        response.status(404).json({
          ok: false,
          valid: false,
          reason: 'NOT_FOUND',
          error: '查不到這組授權金鑰。',
        });
        return;
      }

      const expiresAt = readExpiresAt(hit.data());
      const expired = expiresAt ? expiresAt.getTime() <= Date.now() : false;

      if (expired) {
        response.status(403).json({
          ok: true,
          valid: false,
          reason: 'EXPIRED',
          expiresAt: expiresAt.toISOString(),
          error: '授權已到期，重新購買後即可繼續使用。',
        });
        return;
      }

      // 啟用紀錄純粹是營運資訊（有沒有人在用、多久開一次），寫失敗不該擋住啟動
      hit.ref
        .set(
          {
            verifyCount: admin.firestore.FieldValue.increment(1),
            lastVerifyAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch((error) => logger.warn('Failed to record verify', error));

      response.status(200).json({
        ok: true,
        valid: true,
        reason: 'OK',
        licenseKey,
        expiresAt: expiresAt ? expiresAt.toISOString() : '',
        daysLeft: daysLeftFrom(expiresAt),
      });
      return;
    }

    // 6-1. 取得席位租約。一把金鑰同時只有一張租約成立，所以「同一把金鑰一次只能一個人用」。
    //      桌面程式啟動時打這支，拿到 sessionId 後要定期送 /session/heartbeat 續租。
    if (request.method === 'POST' && path === '/session/acquire') {
      const body = request.body || {};
      const licenseKey = normalizeLicenseKey(body.licenseKey);
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim().slice(0, 200) : '';
      const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel.trim().slice(0, 60) : '';
      // 使用者在「正在其他裝置使用中」的畫面按下「在這台裝置使用」時才帶 true
      const force = body.force === true;

      if (!licenseKey) {
        response.status(400).json({
          ok: false, valid: false, reason: 'INVALID_FORMAT',
          error: '金鑰格式不正確，應為 MLV-XXXX-XXXX-XXXX-XXXX。',
        });
        return;
      }
      if (!deviceId) {
        response.status(400).json({
          ok: false, valid: false, reason: 'MISSING_DEVICE_ID',
          error: '缺少裝置識別碼。',
        });
        return;
      }

      const clientIp = getClientIp(request);
      if (tooManyVerifies(clientIp)) {
        logger.warn('Session acquire rate limited', { ip: clientIp });
        response.status(429).json({
          ok: false, valid: false, reason: 'RATE_LIMITED',
          error: '嘗試次數過多，請一分鐘後再試。',
        });
        return;
      }

      const orderDoc = await findPaidOrder(licenseKey);
      if (!orderDoc) {
        response.status(404).json({
          ok: false, valid: false, reason: 'NOT_FOUND',
          error: '查不到這組授權金鑰。',
        });
        return;
      }

      const order = orderDoc.data();
      const expiresAt = readExpiresAt(order);
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        response.status(403).json({
          ok: true, valid: false, reason: 'EXPIRED',
          expiresAt: expiresAt.toISOString(),
          error: '授權已到期，重新購買後即可繼續使用。',
        });
        return;
      }

      const deviceHash = hashDeviceId(deviceId);
      const sessionRef = db.collection(SESSIONS).doc(hashLicenseKey(licenseKey));

      // 用交易搶席位：兩台電腦同時啟動時，只有一邊會成功
      const outcome = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(sessionRef);
        const current = snapshot.exists ? snapshot.data() : null;
        const now = Date.now();

        const lastSeen = toDateOrNull(current && current.lastSeenAt);
        // 沒有心跳紀錄的席位（例如寫入到一半失敗）不該永久卡住，一律視為過期
        const alive = Boolean(current && lastSeen && now - lastSeen.getTime() < SESSION_LEASE_MS);
        const sameDevice = Boolean(current && current.deviceHash === deviceHash);

        if (alive && !sameDevice) {
          const takenOverAt = toDateOrNull(current.takenOverAt);
          const coolingUntil = takenOverAt ? takenOverAt.getTime() + SESSION_TAKEOVER_COOLDOWN_MS : 0;
          const cooling = coolingUntil > now;

          if (!force || cooling) {
            return {
              granted: false,
              cooling,
              deviceLabel: maskDeviceLabel(current.deviceLabel),
              retryAfterSeconds: Math.ceil(
                ((cooling ? coolingUntil : lastSeen.getTime() + SESSION_LEASE_MS) - now) / 1000,
              ),
            };
          }
        }

        // 同一台裝置重開也會拿到新的 sessionId —— 舊的那張租約就此失效，
        // 所以當機後重開不必等租約到期。
        const sessionId = generateSessionId();
        const tookOver = alive && !sameDevice;

        tx.set(sessionRef, {
          orderId: order.orderId || orderDoc.id,
          sessionId,
          deviceHash,
          deviceLabel,
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          // 心跳只需要這份非正規化的到期時間，不用再回頭查訂單
          licenseExpiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : null,
          takenOverAt: tookOver ? admin.firestore.FieldValue.serverTimestamp() : null,
        });

        return { granted: true, sessionId, tookOver };
      });

      if (!outcome.granted) {
        logger.info('Session acquire refused', { orderId: order.orderId, cooling: outcome.cooling });
        response.status(409).json({
          ok: false,
          valid: false,
          reason: outcome.cooling ? 'TAKEOVER_COOLDOWN' : 'IN_USE',
          retryAfterSeconds: outcome.retryAfterSeconds,
          activeDeviceLabel: outcome.deviceLabel,
          error: outcome.cooling
            ? '這組金鑰剛才才在別的裝置上啟動，請稍後再試。'
            : '這組金鑰正在其他裝置使用中。關掉那一邊，或選擇「在這台裝置使用」接手。',
        });
        return;
      }

      logger.info('Session granted', { orderId: order.orderId, tookOver: outcome.tookOver });
      response.status(200).json({
        ok: true,
        valid: true,
        reason: 'OK',
        sessionId: outcome.sessionId,
        // 接手成功時前端可以提示「已從其他裝置接手」
        tookOver: outcome.tookOver,
        heartbeatSeconds: SESSION_HEARTBEAT_SECONDS,
        leaseSeconds: Math.floor(SESSION_LEASE_MS / 1000),
        expiresAt: expiresAt ? expiresAt.toISOString() : '',
        daysLeft: daysLeftFrom(expiresAt),
      });
      return;
    }

    // 6-2. 續租。桌面程式每 heartbeatSeconds 秒打一次；
    //      回 409 就代表席位已經被別人接手，程式應該停下來。
    if (request.method === 'POST' && path === '/session/heartbeat') {
      const body = request.body || {};
      const licenseKey = normalizeLicenseKey(body.licenseKey);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

      if (!licenseKey || !sessionId) {
        response.status(400).json({
          ok: false, valid: false, reason: 'INVALID_REQUEST',
          error: '缺少金鑰或工作階段憑證。',
        });
        return;
      }

      // 心跳不做 IP 次數限制：網咖／宿舍會共用出口 IP，一限就把正常使用者擋死。
      // 改成靠下面的 SESSION_HEARTBEAT_MIN_WRITE_MS 節流，狂打也只是多幾次讀取。
      const sessionRef = db.collection(SESSIONS).doc(hashLicenseKey(licenseKey));
      const session = (await sessionRef.get()).data();

      if (!session) {
        response.status(409).json({
          ok: false, valid: false, reason: 'SESSION_LOST',
          error: '工作階段已失效，請重新啟動程式。',
        });
        return;
      }
      if (session.sessionId !== sessionId) {
        response.status(409).json({
          ok: false, valid: false, reason: 'SESSION_TAKEN_OVER',
          error: '這組金鑰已在其他裝置啟動，這一邊已被停用。',
        });
        return;
      }

      const expiresAt = readExpiresAt(session);
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        response.status(403).json({
          ok: true, valid: false, reason: 'EXPIRED',
          expiresAt: expiresAt.toISOString(),
          error: '授權已到期，重新購買後即可繼續使用。',
        });
        return;
      }

      // 節流：距離上次心跳太近就不寫，只回 ok
      const lastSeen = toDateOrNull(session.lastSeenAt);
      if (!lastSeen || Date.now() - lastSeen.getTime() >= SESSION_HEARTBEAT_MIN_WRITE_MS) {
        await sessionRef.set(
          { lastSeenAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true },
        );
      }

      response.status(200).json({
        ok: true,
        valid: true,
        reason: 'OK',
        heartbeatSeconds: SESSION_HEARTBEAT_SECONDS,
        expiresAt: expiresAt ? expiresAt.toISOString() : '',
        daysLeft: daysLeftFrom(expiresAt),
      });
      return;
    }

    // 6-3. 正常關閉程式時主動釋放席位，下一個人就不用等租約到期。
    //      拿不到回應也沒關係 —— 租約本來就會自己過期。
    if (request.method === 'POST' && path === '/session/release') {
      const body = request.body || {};
      const licenseKey = normalizeLicenseKey(body.licenseKey);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

      if (!licenseKey || !sessionId) {
        response.status(400).json({ ok: false, error: '缺少金鑰或工作階段憑證。' });
        return;
      }

      const sessionRef = db.collection(SESSIONS).doc(hashLicenseKey(licenseKey));
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(sessionRef);
        // 只有持有這張租約的人能釋放它，否則就變成「知道金鑰就能把別人踢下線」
        if (snapshot.exists && snapshot.data().sessionId === sessionId) {
          tx.delete(sessionRef);
        }
      });

      response.status(200).json({ ok: true });
      return;
    }

    // 7. 授權下載：每次下載都重新驗訂單與有效期限，再把 Storage 上的檔案串回去。
    //    程式更新只要覆蓋 Storage 上的物件，使用者下次點下載拿到的就是新版。
    if ((request.method === 'GET' || request.method === 'HEAD') && path === '/download') {
      const orderId = typeof request.query.orderId === 'string' ? request.query.orderId.trim() : '';
      const token = typeof request.query.token === 'string' ? request.query.token.trim() : '';

      if (!ORDER_ID_PATTERN.test(orderId) || !token) {
        sendDownloadError(response, 400, 'MISSING_PARAMS', '下載連結不完整，請回到網站重新取得下載連結。');
        return;
      }

      const ref = db.collection(ORDERS).doc(orderId);
      const data = (await ref.get()).data();
      if (!data || data.accessToken !== token) {
        sendDownloadError(response, 404, 'ORDER_NOT_FOUND', '找不到這筆訂單，下載連結可能已經失效，請用「找回授權」重新取得。');
        return;
      }
      if (data.status !== 'paid') {
        sendDownloadError(response, 403, 'NOT_PAID', '這筆訂單尚未付款完成。');
        return;
      }

      const expiresAt = readExpiresAt(data);
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        sendDownloadError(response, 403, 'LICENSE_EXPIRED', '授權已到期，重新購買後即可再次下載。');
        return;
      }

      let file;
      let metadata;
      try {
        file = admin.storage().bucket(STORAGE_BUCKET || undefined).file(DOWNLOAD_OBJECT);
        const [exists] = await file.exists();

        if (!exists) {
          // 檔案還沒放上 Storage 時，退回舊的固定下載連結（若有設定），不要讓已付款的人卡住
          const fallback = (process.env.MLEVEL_DOWNLOAD_URL || '').trim();
          if (fallback) {
            logger.warn('Download object missing, falling back to MLEVEL_DOWNLOAD_URL', {
              object: DOWNLOAD_OBJECT,
            });
            response.redirect(302, fallback);
            return;
          }

          logger.error('Download object missing', { bucket: STORAGE_BUCKET, object: DOWNLOAD_OBJECT });
          sendDownloadError(
            response,
            503,
            'OBJECT_MISSING',
            `程式檔案還沒上架到 Storage（${DOWNLOAD_OBJECT}），請聯絡客服。`,
          );
          return;
        }

        [metadata] = await file.getMetadata();
      } catch (error) {
        // 最常見的是 Functions 的服務帳號沒有讀取 Storage 的權限
        logger.error('Storage read failed', {
          bucket: STORAGE_BUCKET,
          object: DOWNLOAD_OBJECT,
          message: error instanceof Error ? error.message : String(error),
        });
        sendDownloadError(response, 502, 'STORAGE_UNAVAILABLE', '讀取程式檔案失敗，請聯絡客服。');
        return;
      }
      const { url: fileUrl, kind } = await resolveStorageDownloadUrl(file, metadata);
      if (!fileUrl) {
        logger.error('Cannot build a download URL for the object', {
          bucket: STORAGE_BUCKET,
          object: DOWNLOAD_OBJECT,
        });
        sendDownloadError(response, 502, 'NO_DOWNLOAD_URL', '產生下載網址失敗，請聯絡客服。');
        return;
      }

      // 轉址本身不要被快取，換版才會立刻生效
      response.setHeader('Cache-Control', 'private, no-store');

      if (request.method === 'HEAD') {
        response.status(200).end();
        return;
      }

      // 下載紀錄純粹是營運資訊，寫失敗不該影響下載本身
      ref
        .set(
          {
            downloadCount: admin.firestore.FieldValue.increment(1),
            lastDownloadAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch((error) => logger.warn('Failed to record download', error));

      logger.info('Download served', { orderId, object: DOWNLOAD_OBJECT, kind, size: metadata.size });
      response.redirect(302, fileUrl);
      return;
    }

    response.status(404).json({
      ok: false,
      error: `Unsupported route: ${request.method} ${path}`,
    });
  } catch (error) {
    // 走到這裡的都是「沒預期到」的錯誤：Firestore 失敗、綠界設定不完整等等。
    // 詳細內容只進 Cloud Logging，不回給前端 —— 錯誤訊息常常會帶出內部路徑、
    // 資料庫欄位、設定名稱這類不該對外的資訊。
    const traceId = String(request.get('x-cloud-trace-context') || '').split('/')[0];

    logger.error('ecpayApi failed', {
      path,
      method: request.method,
      traceId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // /download 串檔途中失敗時 header 已經送出，只能把連線收掉
    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(500).json({
      ok: false,
      // 附上 trace id，使用者回報時我們才對得到 Cloud Logging 那一筆
      error: traceId
        ? `伺服器忙線或發生錯誤，請稍後再試。（代碼 ${traceId.slice(0, 16)}）`
        : '伺服器忙線或發生錯誤，請稍後再試。',
    });
  }
});
