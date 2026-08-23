# MLevel 官網

楓之谷經典版自動化輔助程式的單頁官網，含綠界（ECPay）信用卡一次付清金流與授權金鑰發放。

- 前端：Vue 3 + Vite（`src/`）
- 後端：Firebase Cloud Functions（`functions/`，Node 22，部署在 `asia-east1`）
- 資料：Firestore `mlevel_orders`（訂單與授權）、`mlevel_sessions`（席位租約）
- 部署：Firebase Hosting

Firebase 專案為 **`mlevel-f575a`**（見 `.firebaserc`），前端設定寫在 `src/firebase.js`。

## 開始使用前要填的地方

1. **前端 API 位址** — `.env` 已填好
   `VITE_ECPAY_API_URL=https://asia-east1-mlevel-f575a.cloudfunctions.net/ecpayApi`（`.env` 不進版控，clone 後照 `.env.example` 補上）。
2. **後端環境變數** — 複製 `functions/.env.example` 為 `functions/.env`，填入綠界特店資料與 Storage 設定。
3. **Firestore 資料庫** — 到 Firebase Console 建立 Firestore（位置選 `asia-east1`），否則 `/create` 寫不進訂單。
4. **App Check（選用但建議）** — 見下面的〈App Check〉，填 `.env` 的 `VITE_FIREBASE_APPCHECK_SITE_KEY`。留空也能正常運作。

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
        前端 GET /order?orderId=&token= ─► 顯示授權金鑰、有效期限、安裝檔與使用手冊下載連結
```

找回授權（付款回跳的網址關掉之後）：

```
使用者填 email + licenseKey → POST /lookup ─► 驗金鑰＋email → 回傳金鑰、有效期限、安裝檔與使用手冊下載連結
```

### 為什麼有 `token`
`/order` 只憑訂單編號就能查到授權金鑰的話，編號被猜中就等於金鑰外流。因此 `/create` 會另外產生一組 24 bytes 的 `accessToken` 存在訂單上，回跳網址帶著它，`/order` 必須 orderId + token 都對才回傳金鑰。

### 金額由後端決定
`/create` 完全不採用前端傳來的 `amount`，一律用 `functions/index.js` 的 `PRODUCT.amount`（NT$399），避免有人自組 request 用 1 元換金鑰。**調價時要同步改** `functions/index.js` 的 `PRODUCT`、`src/components/CheckoutModal.vue` 的 `PRICE`、`src/components/HeroSection.vue` 的顯示價格。

### 下載與程式更新
付費後可以拿到兩個檔案，都放在同一個 Storage bucket（`MLEVEL_STORAGE_BUCKET`，正式站是
`gs://mlevel-f575a.firebasestorage.app`）：

| `?file=` | 環境變數 | 預設物件 | 內容 |
| --- | --- | --- | --- |
| `app`（省略時的預設值） | `MLEVEL_STORAGE_OBJECT` | `mlevel.zip` | 安裝檔 |
| `manual` | `MLEVEL_STORAGE_MANUAL_OBJECT` | `使用手冊.md` | 使用手冊 |

下載走 `GET /download?orderId=&token=&file=`：驗訂單已付款、授權未到期，然後 **302 轉址**到 Cloud Storage 上
對應物件的下載網址。`file` 只認上表這兩個值，傳別的一律當 `app`，所以它不會變成「用 query string
指定任意 Storage 路徑」的入口。`/order` 與 `/lookup` 回傳的 `downloadUrl`（安裝檔）與 `manualUrl`（使用手冊）
就是這兩條連結。

使用手冊的檔名是中文，而 `Content-Disposition` 只能放 ASCII，所以簽章網址照 RFC 5987 同時帶
ASCII 退路檔名（`mlevel-manual.md`）與 UTF-8 的真正檔名（見 `attachmentDisposition`）。

**要發布新版，只要覆蓋 Storage 上對應的物件就好** —— 不必改環境變數、不必重新部署 Functions，
使用者下次點下載拿到的就是新版。安裝檔與使用手冊各自獨立，只更新其中一個也可以。

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

Storage 上找不到安裝檔時，若 `MLEVEL_DOWNLOAD_URL` 有設定會轉址過去當退路，否則回 `OBJECT_MISSING`；
使用手冊沒有這條退路（那個變數只指向安裝檔），缺檔就直接回 `OBJECT_MISSING`。

下載次數分開記在訂單上：安裝檔是 `downloadCount` / `lastDownloadAt`，使用手冊是
`manualDownloadCount` / `lastManualDownloadAt`。

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

### 一次只能一個人使用（席位租約）

同一把金鑰同時只會有**一個**工作階段成立。做法是「租約 + 心跳」，而不是把金鑰綁死在某台電腦上
—— 使用者可以自由換電腦、重裝系統，不必來要解綁。

三支端點（都不需要 App Check，桌面程式帶不了）：

| 端點 | body | 用途 |
| --- | --- | --- |
| `POST /session/acquire` | `{ licenseKey, deviceId, deviceLabel?, force? }` | 啟動時取得席位 |
| `POST /session/heartbeat` | `{ licenseKey, sessionId }` | 每 `heartbeatSeconds` 秒續租 |
| `POST /session/release` | `{ licenseKey, sessionId }` | 正常關閉時釋放席位 |

`acquire` 成功回 `{ ok:true, valid:true, sessionId, tookOver, heartbeatSeconds, leaseSeconds, expiresAt, daysLeft }`。
`sessionId` 是這張租約的憑證，**心跳與釋放都要帶**，所以光知道金鑰不能把別人踢下線。

`reason` 一覽：

- `OK` — 拿到席位。`tookOver: true` 表示是從別的裝置接手來的，可以提示使用者。
- `IN_USE`（409）— 別的裝置正在用。附 `retryAfterSeconds` 與遮罩過的 `activeDeviceLabel`
  （只給前兩個字，本人認得出是自己另一台，但不會把完整電腦名交給其他拿到金鑰的人）。
  想接手就重打一次並帶 `force: true`。
- `TAKEOVER_COOLDOWN`（409）— 剛剛才有人接手過，2 分鐘內不能再搶。避免兩個人互踢來互踢去
  把共用變成勉強可用。
- `SESSION_TAKEN_OVER`（409，心跳）— 席位已被別的裝置接手，**這一邊要停止運作**。
- `SESSION_LOST`（409，心跳）— 租約不見了（例如被釋放過），重新 `acquire` 即可。
- `EXPIRED` / `NOT_FOUND` / `INVALID_FORMAT` / `MISSING_DEVICE_ID` / `RATE_LIMITED` — 同 `/verify`。

參數（`functions/index.js` 上方）：心跳 **360 秒**一次、租約 **900 秒**沒消息才釋放。
這是在「被佔用時要等多久」與「自己當機後要等多久才能重開」之間取捨：真的當機最多等 15 分鐘。
同一台裝置重開會直接換發新 `sessionId`，所以**當機重開不必等租約到期**。
心跳距上一次不到 300 秒就不寫 Firestore（只回 `ok`），寫入量約每人每天 240 筆。

租約是心跳的 2.5 倍，掉一次心跳（下一次 720 秒後）還在租約內，正常網路抖動不會被接手；
連掉兩次才會出現一段「自己還在跑、但別人不用 `force` 就能接手」的空窗，所以客戶端心跳失敗
還是要盡快重試（例如 10／30／60 秒後），不要等到下一輪。

搶席位是在 Firestore transaction 裡做的，兩台電腦同時啟動只有一邊會成功。

#### 程式端要改的地方

1. 啟動時把 `/verify` 換成 `/session/acquire`，並帶一個穩定的 `deviceId`
   （Windows 上用 `MachineGuid` 或主機板序號的雜湊；後端只存它的 SHA-256，不留原始值）。
2. 背景每 `heartbeatSeconds` 秒送一次心跳（別寫死 360，照回應給的值走）。失敗要馬上重試，
   不要等下一輪。**收到 409 就要真的停下來**，不然這個限制等於沒做。
3. 正常關閉時打一次 `/session/release`，下一個人就不必等 15 分鐘。失敗也不用重試，租約本來會過期。
4. ⚠️ **離線寬限期要重新想。** 目前 `license_gate.py` 在連不上後端時，只要上次驗證成功還在 3 天內
   就放行 —— 套到席位上就變成「把程式擋在防火牆外就能無限同時使用」。建議改成：心跳連續失敗
   最多容忍 30 分鐘（讓後端維護、短暫斷線不會中斷掛機），超過就停。這個數字直接決定限制的強度。

#### 舊版怎麼收尾

`/verify` 維持原樣（不佔席位），所以既有安裝不會被弄壞 —— 但舊版可以拿同一把金鑰同時開好幾份，
**新版鋪開前這個限制是形同沒有的**。等新版上線一段時間後，把 `functions/.env` 的
`MLEVEL_REQUIRE_SESSION` 設成 `true`，`/verify` 就會回 426 `UPGRADE_REQUIRED`
要求使用者更新，舊版就再也繞不過去。

#### 這個做法擋不住什麼

擋的是「同時」，不是「分時」：兩個人講好輪流用（一人白天一人晚上）仍然做得到，只是不能同時掛機。
要連分時也擋，就得回到裝置綁定（綁定 N 台、換機要解綁），代價是正常使用者換電腦要來找客服。

### 授權金鑰
格式 `MLV-XXXX-XXXX-XXXX-XXXX`（去掉 0/O/1/I/L 等易混淆字元），以 CSPRNG 產生，自付款起算 30 天（`functions/license.js` 的 `calcExpiresAt`）。發放寫在 Firestore transaction 裡，`/notify` 與 `/result` 重複觸發也只會發一組。

## 檔案位置

| 檔案 | 用途 |
| --- | --- |
| `functions/ecpay.js` | CheckMacValue 計算／驗證、AIO 訂單參數組裝 |
| `functions/license.js` | 授權金鑰、存取權杖、席位憑證、金鑰／裝置雜湊、到期日、email 遮罩 |
| `functions/index.js` | `ecpayApi` 的 `/create` `/notify` `/result` `/order` `/lookup` `/verify` `/session/*` `/download` 路由 |
| `src/lib/ecpay.js` | 前端呼叫後端、動態表單 POST 導向綠界、查訂單 |
| `src/components/CheckoutModal.vue` | 結帳視窗（收 email、送出付款） |
| `src/components/LicenseResult.vue` | 付款回跳後顯示授權金鑰 |
| `src/components/LicenseLookup.vue` | 用 email + 金鑰找回授權、安裝檔與使用手冊的下載連結 |
| `firestore.rules` | 前端一律不可讀寫訂單，只有 Functions（Admin SDK）能存取 |
| `src/firebase.js` | 前端 Firebase App 設定、App Check 初始化與 `getAppCheckHeaders()`；Analytics 暫時註解停用 |

## App Check

App Check 用來讓後端分辨「請求真的是從這個網站發出來的」，擋掉自己組 request 去刷 `/create`、`/lookup` 的腳本。

**只有瀏覽器會打的三支端點會驗**：`/create`、`/order`、`/lookup`。
`/notify`、`/result`（綠界的伺服器與轉址）、`/verify` 與 `/session/*`（桌面程式）、`/download`（使用者直接點連結開新頁）**一律不驗** —— 這些請求帶不了 App Check token，驗了只會把正常流程擋死。

前端在 `src/firebase.js` 用 reCAPTCHA Enterprise 初始化，`src/lib/ecpay.js` 每次 fetch 會帶上 `X-Firebase-AppCheck` 標頭；後端在 `functions/index.js` 用 Admin SDK 的 `admin.appCheck().verifyToken()` 驗。

### 開通步驟

1. Firebase Console → **App Check** → 註冊網頁 App，供應商選 **reCAPTCHA Enterprise**，拿到 site key。
2. 把 site key 填進 `.env` 的 `VITE_FIREBASE_APPCHECK_SITE_KEY`，`npm run deploy:hosting`。
3. 觀察 Console → App Check 的請求報表，等「已驗證」的比例穩定（通常 1～2 天，讓還開著舊分頁的人也換到新版）。
4. 把 `functions/.env` 的 `MLEVEL_APPCHECK_ENFORCE` 改成 `true`，`npm run deploy:functions` —— 這時候才會真的開始擋。

`MLEVEL_APPCHECK_ENFORCE=false`（預設）是**只記錄不阻擋**：沒帶 token 或 token 無效時只在 log 留 `App Check token missing / rejected`，請求照樣放行。所以照上面的順序做，中途不會有任何一刻擋到真實使用者。

### 本機開發

`vite dev` 下會自動掛上 debug token。第一次跑時瀏覽器 console 會印出一組 UUID，複製到 Console → App Check → 該 App 的**管理 debug token**註冊，之後把它填進 `.env` 的 `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` 就不會每次重開都換一組。site key 沒填時前端不會啟用 App Check，後端在預設的非強制模式下照樣放行，本機不設定也能跑完整流程。

## 安全性備註

- 訂單含授權金鑰與購買者 email，`firestore.rules` 全部 deny，只走 Cloud Functions。
- `/result` 的導回網址會比對允許清單（localhost、`<專案>.web.app`、`<專案>.firebaseapp.com`，以及 `MLEVEL_ALLOWED_REDIRECT_HOSTS` 額外指定的網域），避免變成開放轉址。**綁自訂網域後記得把網域加進 `MLEVEL_ALLOWED_REDIRECT_HOSTS`**，否則付款完不會導回前端。
- 綠界的 HashKey / HashIV 只存在 `functions/.env`（不進版控），不會進前端 bundle。要再收緊可以改用 Secret Manager（`defineSecret` + `setGlobalOptions` 的 `secrets`），代價是要啟用 Secret Manager API、且首次部署前得先建立 secret。
- 只要 `ECPAY_API_URL` 指向正式結帳網址，`getEcpayConfig()` 就會要求特店金鑰必填、且拒絕綠界公開的測試金鑰，避免用公開金鑰跑正式流量（那等於任何人都能偽造付款回呼）。
- 付款回呼只保留欄位白名單（`CALLBACK_FIELDS`）：卡號後四碼 `card4no` 留著給客服核對，前六碼 `card6no`（BIN）不寫進 Firestore、也不進 log。
- 未預期的錯誤只把細節寫進 Cloud Logging，回給前端的是通用訊息加一組 trace id，不外洩內部路徑或設定名稱。
- 一把金鑰同時只有一個席位（`mlevel_sessions` 的租約 + 心跳）。`sessionId` 是租約憑證，只知道金鑰無法把別人踢下線；席位文件的 id 是金鑰的 SHA-256，金鑰本身不會出現在 Firestore 路徑或 log 裡；裝置識別碼也只存雜湊。
- App Check 驗的是「請求來自這個網站」，不是「這個人是誰」，所以它是**額外一層**：`/order` 與 `/download` 仍然要 `accessToken`、`/lookup` 與 `/verify` 仍然有 IP 次數上限，這些都沒有因為 App Check 而放寬。
- 程式檔案與使用手冊都不對外公開：Storage 物件不需要（也不該）設成公開，一律由 `/download` 驗過授權才給短效簽章網址。
