# MLevel 官網

楓之谷經典版自動化輔助程式的單頁官網，含綠界（ECPay）信用卡一次付清金流與授權金鑰發放。

- 前端：Vue 3 + Vite（`src/`）
- 後端：Firebase Cloud Functions（`functions/`，Node 22，部署在 `asia-east1`）
- 資料：Firestore `mlevel_orders` collection
- 部署：Firebase Hosting

Firebase 專案為 **`mlevel-f575a`**（見 `.firebaserc`），前端設定寫在 `src/firebase.js`。

## 開始使用前要填的地方

1. **前端 API 位址** — `.env` 已填好
   `VITE_ECPAY_API_URL=https://asia-east1-mlevel-f575a.cloudfunctions.net/ecpayApi`（`.env` 不進版控，clone 後照 `.env.example` 補上）。
2. **後端環境變數** — 複製 `functions/.env.example` 為 `functions/.env`，填入綠界特店資料與 Storage 設定。
3. **Firestore 資料庫** — 到 Firebase Console 建立 Firestore（位置選 `asia-east1`），否則 `/create` 寫不進訂單。

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

找回授權（付款回跳的網址關掉之後）：

```
使用者填 email + licenseKey → POST /lookup ─► 驗金鑰＋email → 回傳金鑰、有效期限、下載連結
```

### 為什麼有 `token`
`/order` 只憑訂單編號就能查到授權金鑰的話，編號被猜中就等於金鑰外流。因此 `/create` 會另外產生一組 24 bytes 的 `accessToken` 存在訂單上，回跳網址帶著它，`/order` 必須 orderId + token 都對才回傳金鑰。

### 金額由後端決定
`/create` 完全不採用前端傳來的 `amount`，一律用 `functions/index.js` 的 `PRODUCT.amount`（NT$399），避免有人自組 request 用 1 元換金鑰。**調價時要同步改** `functions/index.js` 的 `PRODUCT`、`src/components/CheckoutModal.vue` 的 `PRICE`、`src/components/HeroSection.vue` 的顯示價格。

### 下載與程式更新
下載走 `GET /download?orderId=&token=`：驗訂單已付款、授權未到期，然後 **302 轉址**到 Cloud Storage 上
`MLEVEL_STORAGE_OBJECT`（預設 `mlevel.zip`）的下載網址。

**要發布新版程式，只要覆蓋 Storage 上的那個物件就好** —— 不必改環境變數、不必重新部署 Functions，
使用者下次點下載拿到的就是新版。

轉址網址優先用 V4 簽章網址（有效期 15 分鐘）。簽章需要 Functions 的執行服務帳號有
`iam.serviceAccounts.signBlob` 權限（`roles/iam.serviceAccountTokenCreator`）；沒有的話會退回讀取
Storage 物件 metadata 裡的 `firebaseStorageDownloadTokens` 組成下載網址 —— 那個 token 是**每次請求即時讀**，
所以覆蓋檔案換版之後依然指向新檔（這是它跟舊做法把網址寫死在 `.env` 的差別）。

> **不要改回由 Function 自己把檔案串出去。** Cloud Run 對固定長度的回應有 32 MiB 上限，
> 幾十 MB 的壓縮檔會在送出第一個 byte 之前就被擋掉（回 500、body 是空的，log 裡什麼都不會留），
> 而且串檔要付 Function 的執行時間與流量、也不支援續傳。

出錯時 `/download` 會回一頁看得懂的說明頁（`sendDownloadError`），帶代碼方便回報：
`MISSING_PARAMS` / `ORDER_NOT_FOUND` / `NOT_PAID` / `LICENSE_EXPIRED` / `OBJECT_MISSING` /
`STORAGE_UNAVAILABLE` / `NO_DOWNLOAD_URL`。

Storage 上找不到物件時，若 `MLEVEL_DOWNLOAD_URL` 有設定會轉址過去當退路，否則回 `OBJECT_MISSING`。

### 找回授權
付款成功的頁面（`/?orderId=&status=&token=`）關掉之後就再也回不去，而且目前不會寄任何信件，
所以 `POST /lookup` 是使用者自助拿回金鑰與下載連結的唯一入口：帶 `email` + `licenseKey`，
兩者都對才回傳訂單。前端入口是頁首／頁尾的「找回授權」（`src/components/LicenseLookup.vue`）。

金鑰輸入會先過 `normalizeLicenseKey`，大小寫、空白、連字號、少打 `MLV-` 前綴都能接受。
查詢只用 `licenseKey` 打 Firestore（單欄位索引自動建立），`email` 留在程式裡比對，省掉複合索引。
失敗訊息不區分「金鑰錯」與「email 對不上」，避免變成金鑰有效性的探測工具；
另外有一層 per-IP 的粗略限流（一分鐘 10 次，只存在單一實例記憶體，擋不住分散式嘗試）。

### 程式啟動時的授權驗證
`mlevel.exe` 一開起來會先要金鑰，拿去打 `POST /verify`（body `{ "licenseKey": "..." }`），
回 `{ ok, valid, reason, expiresAt, daysLeft }`。`reason` 是
`OK` / `EXPIRED` / `NOT_FOUND` / `INVALID_FORMAT` / `RATE_LIMITED`。

這支端點沒有任何身分驗證 —— 誰拿到一組金鑰都能打，所以它**只回「有效嗎、到什麼時候」**，
不吐 email、訂單編號或 `accessToken`；同一 IP 一分鐘 30 次（程式每次啟動打一次，
網咖／宿舍會共用出口 IP，所以比 `/lookup` 的 10 次寬）。驗證成功會順手把
`verifyCount` / `lastVerifyAt` 寫回訂單，寫失敗不影響回應。

程式端在 `D:\mlevel\license_gate.py`：驗過的金鑰存在使用者的
`%LOCALAPPDATA%\mlevel\license.json`，連不上後端時只要上次驗證成功還在 3 天內、
授權也還沒到期就先放行（別讓後端維護把付了錢的人關在門外）。500 或非 JSON 的回應一律
當成「問不到」而不是「金鑰無效」，同理。

### 授權金鑰
格式 `MLV-XXXX-XXXX-XXXX-XXXX`（去掉 0/O/1/I/L 等易混淆字元），以 CSPRNG 產生，自付款起算 30 天（`functions/license.js` 的 `calcExpiresAt`）。發放寫在 Firestore transaction 裡，`/notify` 與 `/result` 重複觸發也只會發一組。

## 檔案位置

| 檔案 | 用途 |
| --- | --- |
| `functions/ecpay.js` | CheckMacValue 計算／驗證、AIO 訂單參數組裝 |
| `functions/license.js` | 授權金鑰、存取權杖、到期日、email 遮罩 |
| `functions/index.js` | `ecpayApi` 的 `/create` `/notify` `/result` `/order` `/lookup` `/verify` `/download` 路由 |
| `src/lib/ecpay.js` | 前端呼叫後端、動態表單 POST 導向綠界、查訂單 |
| `src/components/CheckoutModal.vue` | 結帳視窗（收 email、送出付款） |
| `src/components/LicenseResult.vue` | 付款回跳後顯示授權金鑰 |
| `src/components/LicenseLookup.vue` | 用 email + 金鑰找回授權與下載連結 |
| `firestore.rules` | 前端一律不可讀寫訂單，只有 Functions（Admin SDK）能存取 |
| `src/firebase.js` | 前端 Firebase App 設定；Analytics 暫時註解停用（含 `main.js` 的載入點） |

## 安全性備註

- 訂單含授權金鑰與購買者 email，`firestore.rules` 全部 deny，只走 Cloud Functions。
- `/result` 的導回網址會比對允許清單（localhost、`<專案>.web.app`、`<專案>.firebaseapp.com`，以及 `MLEVEL_ALLOWED_REDIRECT_HOSTS` 額外指定的網域），避免變成開放轉址。**綁自訂網域後記得把網域加進 `MLEVEL_ALLOWED_REDIRECT_HOSTS`**，否則付款完不會導回前端。
- 綠界的 HashKey / HashIV 只存在 `functions/.env`，不會進前端 bundle。
- 程式檔案不對外公開：Storage 物件不需要（也不該）設成公開，一律由 `/download` 驗過授權才串出去。
