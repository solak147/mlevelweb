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
 * Cloud Run 會把真正的來源 IP 放在 X-Forwarded-For 的第一段；
 * request.ip 拿到的是前面那層 proxy，所有人都會長一樣。
 */
function getClientIp(request) {
  const forwarded = String(request.get('x-forwarded-for') || '')
    .split(',')[0]
    .trim();

  return forwarded || request.ip || '';
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

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
      ecpayRawResult: payload,
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
        throw new Error('A valid email is required.');
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

      const merchantTradeNo = typeof payload.MerchantTradeNo === 'string' ? payload.MerchantTradeNo : '';
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

      const merchantTradeNo = typeof payload.MerchantTradeNo === 'string' ? payload.MerchantTradeNo : '';
      const rtnCode = Number(payload.RtnCode);
      const verified = verifyEcpayCallback(payload);
      const status = verified && rtnCode === 1 ? 'success' : 'cancel';

      let redirectBaseUrl = '';
      let accessToken = '';

      if (merchantTradeNo) {
        // 冪等：若背景通知還沒進來，這裡也把成功訂單標記為已付款並發金鑰
        const order =
          status === 'success'
            ? await markOrderPaid(merchantTradeNo, payload)
            : (await db.collection(ORDERS).doc(merchantTradeNo).get()).data();

        if (order) {
          redirectBaseUrl = typeof order.redirectBaseUrl === 'string' ? order.redirectBaseUrl : '';
          accessToken = typeof order.accessToken === 'string' ? order.accessToken : '';
        }
      }

      if (redirectBaseUrl) {
        const query = new URLSearchParams({
          orderId: merchantTradeNo,
          status,
          token: accessToken,
        });
        response.redirect(`${redirectBaseUrl}/?${query.toString()}`);
        return;
      }

      // 沒有可導回的前端網址時（例如直接測 API），至少給一個純文字結果頁
      response.status(200).send(`
        <html lang="zh-Hant">
          <head><meta charset="utf-8" /><title>綠界付款結果</title></head>
          <body style="font-family: sans-serif; padding: 24px;">
            <h1>${status === 'success' ? '付款完成' : '付款未完成'}</h1>
            <p>訂單編號：${merchantTradeNo || '-'}</p>
            <p>綠界訊息：${typeof payload.RtnMsg === 'string' ? payload.RtnMsg : '-'}</p>
          </body>
        </html>
      `);
      return;
    }

    // 4. 前端付款回跳後查詢訂單狀態與授權金鑰
    if (request.method === 'GET' && path === '/order') {
      const orderId = typeof request.query.orderId === 'string' ? request.query.orderId.trim() : '';
      const token = typeof request.query.token === 'string' ? request.query.token.trim() : '';

      if (!orderId || !token) {
        throw new Error('orderId and token are required.');
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

      const matches = await db.collection(ORDERS).where('licenseKey', '==', licenseKey).limit(5).get();
      const hit = matches.docs.find((doc) => doc.data().status === 'paid');

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
        daysLeft: expiresAt
          ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
          : null,
      });
      return;
    }

    // 7. 授權下載：每次下載都重新驗訂單與有效期限，再把 Storage 上的檔案串回去。
    //    程式更新只要覆蓋 Storage 上的物件，使用者下次點下載拿到的就是新版。
    if ((request.method === 'GET' || request.method === 'HEAD') && path === '/download') {
      const orderId = typeof request.query.orderId === 'string' ? request.query.orderId.trim() : '';
      const token = typeof request.query.token === 'string' ? request.query.token.trim() : '';

      if (!orderId || !token) {
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
    logger.error('ecpayApi failed', error);

    // /download 串檔途中失敗時 header 已經送出，只能把連線收掉
    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
