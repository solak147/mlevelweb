# MLevel 官網

楓之谷經典版自動化輔助程式的單頁官網，含綠界（ECPay）信用卡一次付清金流與授權金鑰發放。

- 前端：Vue 3 + Vite（`src/`）
- 後端：Firebase Cloud Functions（`functions/`，Node 22，部署在 `asia-east1`）
- 資料：Firestore `mlevel_orders` collection
- 部署：Firebase Hosting

## 開始使用前要填的三個地方

1. **Firebase 專案 ID** — `.firebaserc` 的 `YOUR_FIREBASE_PROJECT_ID` 換成你在 Firebase Console 建好的專案 ID。
2. **前端 API 位址** — 複製 `.env.example` 為 `.env`，填入
   `VITE_ECPAY_API_URL=https://asia-east1-<專案 ID>.cloudfunctions.net/ecpayApi`
3. **後端環境變數** — 複製 `functions/.env.example` 為 `functions/.env`，填入綠界特店資料與下載連結。

> 目前 `functions/.env` 留空時會使用**綠界官方公開測試特店**（MerchantID `2000132`、測試結帳網址 `payment-stage.ecpay.com.tw`），可以直接跑完整流程。正式上線前務必換成自己的 `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV`，並把 `ECPAY_API_URL` 改成正式網址 `https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5`。

## 常用指令

```bash
npm run dev               # 前端開發伺服器
npm run build             # 打包到 dist/
npm run deploy            # build + 部署 Hosting、Functions、Firestore 規則
npm run deploy:functions  # 只部署 Cloud Functions
npm run logs              # 看 ecpayApi 的 log
```

## 購買流程

```
使用者填 email → POST /create ──────────► Firestore 建立 pending 訂單
                        │
                        └─► 前端以隱藏表單 POST 到綠界結帳頁（信用卡一次付清）
                                    │
        綠界背景通知 POST /notify ◄──┤ 驗 CheckMacValue → 發授權金鑰、狀態改 paid → 回 "1|OK"
                                    │
        使用者瀏覽器 /result      ◄──┘ 驗章 →（冪等）補發金鑰 → 302 導回 /?orderId=&status=&token=
                                    │
        前端 GET /order?orderId=&token= ─► 顯示授權金鑰、有效期限、下載連結
```

### 為什麼有 `token`
`/order` 只憑訂單編號就能查到授權金鑰的話，編號被猜中就等於金鑰外流。因此 `/create` 會另外產生一組 24 bytes 的 `accessToken` 存在訂單上，回跳網址帶著它，`/order` 必須 orderId + token 都對才回傳金鑰。

### 金額由後端決定
`/create` 完全不採用前端傳來的 `amount`，一律用 `functions/index.js` 的 `PRODUCT.amount`（NT$399），避免有人自組 request 用 1 元換金鑰。**調價時要同步改** `functions/index.js` 的 `PRODUCT`、`src/components/CheckoutModal.vue` 的 `PRICE`、`src/components/HeroSection.vue` 的顯示價格。

### 授權金鑰
格式 `MLV-XXXX-XXXX-XXXX-XXXX`（去掉 0/O/1/I/L 等易混淆字元），以 CSPRNG 產生，自付款起算 30 天（`functions/license.js` 的 `calcExpiresAt`）。發放寫在 Firestore transaction 裡，`/notify` 與 `/result` 重複觸發也只會發一組。

## 檔案位置

| 檔案 | 用途 |
| --- | --- |
| `functions/ecpay.js` | CheckMacValue 計算／驗證、AIO 訂單參數組裝 |
| `functions/license.js` | 授權金鑰、存取權杖、到期日、email 遮罩 |
| `functions/index.js` | `ecpayApi` 的 `/create` `/notify` `/result` `/order` 路由 |
| `src/lib/ecpay.js` | 前端呼叫後端、動態表單 POST 導向綠界、查訂單 |
| `src/components/CheckoutModal.vue` | 結帳視窗（收 email、送出付款） |
| `src/components/LicenseResult.vue` | 付款回跳後顯示授權金鑰 |
| `firestore.rules` | 前端一律不可讀寫訂單，只有 Functions（Admin SDK）能存取 |

## 安全性備註

- 訂單含授權金鑰與購買者 email，`firestore.rules` 全部 deny，只走 Cloud Functions。
- `/result` 的導回網址會比對允許清單（localhost、`<專案>.web.app`、`<專案>.firebaseapp.com`，以及 `MLEVEL_ALLOWED_REDIRECT_HOSTS` 額外指定的網域），避免變成開放轉址。**綁自訂網域後記得把網域加進 `MLEVEL_ALLOWED_REDIRECT_HOSTS`**，否則付款完不會導回前端。
- 綠界的 HashKey / HashIV 只存在 `functions/.env`，不會進前端 bundle。
