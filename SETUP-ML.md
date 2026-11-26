# One Upload — സെറ്റപ്പ് ഗൈഡ്

ഒരു വീഡിയോ ഈ ആപ്പിൽ ഇട്ടാൽ **YouTube, Instagram, Facebook** മൂന്നിലും ഒരുമിച്ച് പോസ്റ്റ് ആവും.
Reel ആണെങ്കിൽ YouTube-ൽ **Short** ആയും, Facebook-ൽ **Reel** ആയും, Instagram-ൽ **Reel** ആയും പോവും.

ആദ്യത്തെ തവണ മാത്രം താഴെയുള്ള സെറ്റപ്പ് ചെയ്താൽ മതി (ഏകദേശം 30–45 മിനിറ്റ്).

---

## 0. ആപ്പ് ഓൺ ആക്കാൻ

```powershell
cd E:\instayoutube
npm install
copy .env.example .env
npm start
```

ബ്രൗസറിൽ **http://localhost:3000** തുറക്കുക. Password ചോദിക്കും: username എന്തും ഇടാം, password `.env`-ലെ `APP_PASSWORD`.

> `.env` ഫയൽ Notepad-ൽ തുറന്ന് `APP_PASSWORD` മാറ്റാൻ മറക്കരുത്.
> `.env`-ൽ എന്ത് മാറ്റിയാലും ആപ്പ് നിർത്തി (Ctrl+C) വീണ്ടും `npm start` ചെയ്യണം.

---

## 1. YouTube (Google Cloud)

1. https://console.cloud.google.com തുറക്കുക → മുകളിൽ **Select a project → New Project** → പേര് കൊടുക്കുക (ഉദാ: `one-upload`) → Create.
2. **APIs & Services → Library** → "**YouTube Data API v3**" സെർച്ച് ചെയ്ത് **Enable**.
3. **APIs & Services → OAuth consent screen** (പുതിയ UI-ൽ "Google Auth Platform"):
   - User type: **External** → App name, നിങ്ങളുടെ email കൊടുക്കുക → Save.
   - **Audience / Test users**-ൽ നിങ്ങളുടെ YouTube ചാനലിന്റെ Gmail ചേർക്കുക.
4. **Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URIs**-ൽ ഇത് കൃത്യമായി ചേർക്കുക:
     `http://localhost:3000/auth/google/callback`
   - Create → കിട്ടുന്ന **Client ID**, **Client Secret** `.env`-ൽ `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` ആയി ഇടുക.
5. ആപ്പ് restart ചെയ്ത് **Connect YouTube** അമർത്തുക. "Google hasn't verified this app" എന്ന് കാണിച്ചാൽ **Continue** അമർത്തുക (നിങ്ങളുടെ സ്വന്തം ആപ്പ് ആയതുകൊണ്ട് കുഴപ്പമില്ല).

### ⚠️ YouTube-ൽ അറിഞ്ഞിരിക്കേണ്ടത്
- Google **verify/audit** ചെയ്യാത്ത പ്രോജക്റ്റിൽ നിന്ന് അപ്‌ലോഡ് ചെയ്യുന്ന വീഡിയോകൾ YouTube **Private** ആക്കി ലോക്ക് ചെയ്യും. അപ്പോൾ ആപ്പിൽ ഒരു മെസേജ് കാണിക്കും. YouTube Studio-ൽ പോയി Public ആക്കാൻ ശ്രമിക്കാം, പക്ഷേ ചിലപ്പോൾ അതിനും പറ്റിയെന്ന് വരില്ല.
  - ശാശ്വത പരിഹാരം: **YouTube API Services Audit** ഫോം സമർപ്പിക്കുക (https://support.google.com/youtube/contact/yt_api_form). സ്വന്തം ചാനലിന് മാത്രം ഉപയോഗിക്കുന്ന ടൂൾ ആണെന്ന് എഴുതിയാൽ മതി. അപ്രൂവ് ആവാൻ കുറച്ച് ദിവസം/ആഴ്ച എടുക്കാം.
- "Testing" മോഡിലുള്ള Google ആപ്പിന്റെ ലോഗിൻ **7 ദിവസം** കഴിഞ്ഞാൽ expire ആവും. അങ്ങനെ വന്നാൽ **Reconnect** അമർത്തിയാൽ മതി. ഇത് ഒഴിവാക്കാൻ OAuth consent screen-ൽ **Publish app** (In production) ആക്കാം.
- YouTube API-ക്ക് ദിവസം ഏകദേശം **6 വീഡിയോ** വരെയാണ് ഫ്രീ ലിമിറ്റ്.

---

## 2. Facebook + Instagram (Meta)

### ആദ്യം ഇത് ഉറപ്പാക്കുക
- Instagram അക്കൗണ്ട് **Professional (Business അല്ലെങ്കിൽ Creator)** ആയിരിക്കണം.
  Instagram app → Settings → Account type and tools → Switch to professional account.
- ആ Instagram അക്കൗണ്ട് നിങ്ങളുടെ **Facebook Page**-മായി link ചെയ്തിരിക്കണം.
  Facebook Page → Settings → Linked accounts → Instagram → Connect.

### Meta App ഉണ്ടാക്കാൻ
1. https://developers.facebook.com തുറക്കുക → **My Apps → Create App**.
2. Use case ചോദിക്കുമ്പോൾ **"Other"** → App type **"Business"** തിരഞ്ഞെടുക്കുക. (പുതിയ UI-ൽ "Manage everything on your Page", "Manage messaging & content on Instagram" എന്നീ use case-കൾ ചേർത്താലും മതി.)
3. App ഉണ്ടാക്കിക്കഴിഞ്ഞാൽ:
   - **Add product → Facebook Login** (അല്ലെങ്കിൽ "Facebook Login for Business") ചേർക്കുക.
   - Facebook Login → **Settings** → **Valid OAuth Redirect URIs**-ൽ ഇത് ചേർക്കുക:
     `http://localhost:3000/auth/facebook/callback`
4. **App settings → Basic**-ൽ നിന്ന് **App ID**, **App Secret** എടുത്ത് `.env`-ൽ `META_APP_ID`, `META_APP_SECRET` ആയി ഇടുക.
5. ആപ്പ് restart ചെയ്ത് **Connect Facebook + Instagram** അമർത്തുക.
   Facebook ചോദിക്കുമ്പോൾ നിങ്ങളുടെ **Page-ഉം Instagram അക്കൗണ്ടും tick ചെയ്യുക**, എല്ലാ permission-ഉം allow ചെയ്യുക.

> App "Development" മോഡിൽ ഇരുന്നാലും കുഴപ്പമില്ല. App ഉണ്ടാക്കിയ ആൾ (നിങ്ങൾ) തന്നെ admin ആയതുകൊണ്ട് നിങ്ങളുടെ സ്വന്തം Page-ലും Insta-യിലും പോസ്റ്റ് ചെയ്യാൻ App Review ആവശ്യമില്ല.

### ⚠️ Instagram / Facebook-ൽ അറിഞ്ഞിരിക്കേണ്ടത്
- Instagram API വഴി വീഡിയോ എപ്പോഴും **Reel** ആയിട്ടാണ് പോവുക (ലോങ് വീഡിയോ ആണെങ്കിലും). പരമാവധി **15 മിനിറ്റ്**.
- Facebook **Reel** 3–90 സെക്കൻഡ്, vertical ആയിരിക്കണം. അല്ലെങ്കിൽ ആപ്പ് അത് സാധാരണ വീഡിയോ ആയി പോസ്റ്റ് ചെയ്യും.
- Instagram-ന് ദിവസം 50 പോസ്റ്റ് വരെ API വഴി ചെയ്യാം.

---

## 3. ഫോണിൽ നിന്നും മറ്റ് സ്ഥലത്ത് നിന്നും ഉപയോഗിക്കാൻ (ഓപ്ഷണൽ)

ഇപ്പോൾ ആപ്പ് നിങ്ങളുടെ കമ്പ്യൂട്ടറിൽ മാത്രമേ ഓടുന്നുള്ളൂ, അതായത് കമ്പ്യൂട്ടർ ഓൺ ആയിരിക്കുമ്പോൾ മാത്രം. ഫോണിൽ നിന്ന് ഉപയോഗിക്കാൻ രണ്ട് വഴി:

**A. Cloudflare Tunnel (ഫ്രീ, എളുപ്പം):** കമ്പ്യൂട്ടർ ഓൺ ആയിരിക്കണം.
```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```
കിട്ടുന്ന `https://....trycloudflare.com` അഡ്രസ് `.env`-ൽ `PUBLIC_BASE_URL` ആയി ഇടുക. എന്നിട്ട് Google-ലും Meta-യിലും redirect URI ആയി
`https://....trycloudflare.com/auth/google/callback`, `https://....trycloudflare.com/auth/facebook/callback` എന്നിവ ചേർക്കുക.
(ഫ്രീ tunnel-ന്റെ അഡ്രസ് ഓരോ തവണയും മാറും. സ്ഥിരം അഡ്രസ് വേണമെങ്കിൽ Cloudflare അക്കൗണ്ടിൽ named tunnel ഉണ്ടാക്കാം.)

**B. Server-ൽ ഹോസ്റ്റ് ചെയ്യുക** (Render, Railway, ഒരു VPS): കമ്പ്യൂട്ടർ ഓഫ് ആയാലും ഓടും. ഇതിന് സഹായം വേണമെങ്കിൽ ചോദിച്ചാൽ മതി.

---

## പ്രശ്നങ്ങൾ വന്നാൽ

| പ്രശ്നം | പരിഹാരം |
|---|---|
| `redirect_uri_mismatch` | Google/Meta-യിൽ ചേർത്ത redirect URI-യും `.env`-ലെ `PUBLIC_BASE_URL`-ഉം ഒന്നായിരിക്കണം (അവസാനം `/` പാടില്ല) |
| "No Facebook Pages found" | Reconnect ചെയ്ത്, Facebook ചോദിക്കുമ്പോൾ Page tick ചെയ്യുക |
| Instagram "no Business/Creator account linked" | Insta അക്കൗണ്ട് Professional ആക്കി Page-മായി link ചെയ്ത് Reconnect ചെയ്യുക |
| YouTube `invalid_grant` | ലോഗിൻ expire ആയി, **Reconnect** അമർത്തുക |
| YouTube വീഡിയോ Private ആയി | മുകളിലെ "YouTube-ൽ അറിഞ്ഞിരിക്കേണ്ടത്" നോക്കുക |

അപ്‌ലോഡ് ചെയ്ത വീഡിയോ ഫയലുകൾ `uploads` ഫോൾഡറിൽ 24 മണിക്കൂർ സൂക്ഷിച്ചശേഷം ഓട്ടോമാറ്റിക്കായി ഡിലീറ്റ് ആവും (`KEEP_FILES_HOURS`).
