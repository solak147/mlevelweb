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

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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

function orderPublicView(data) {
  const paidAt = data.paidAt && typeof data.paidAt.toDate === 'function' ? data.paidAt.toDate() : null;
  const expiresAt =
    data.licenseExpiresAt && typeof data.licenseExpiresAt.toDate === 'function'
      ? data.licenseExpiresAt.toDate()
      : null;

  return {
    orderId: data.orderId,
    status: data.status,
    productName: data.productName,
    amount: data.amount,
    email: maskEmail(data.email),
    // 只有付款完成才吐出授權金鑰與下載連結
    licenseKey: data.status === 'paid' ? data.licenseKey || '' : '',
    licenseExpiresAt: data.status === 'paid' && expiresAt ? expiresAt.toISOString() : '',
    downloadUrl: data.status === 'paid' ? (process.env.MLEVEL_DOWNLOAD_URL || '').trim() : '',
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
        routes: ['POST /create', 'POST /notify', 'GET|POST /result', 'GET /order'],
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

      response.status(200).json({ ok: true, order: orderPublicView(data) });
      return;
    }

    response.status(404).json({
      ok: false,
      error: `Unsupported route: ${request.method} ${path}`,
    });
  } catch (error) {
    logger.error('ecpayApi failed', error);
    response.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
