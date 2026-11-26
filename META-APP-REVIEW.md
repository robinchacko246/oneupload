# Meta App Review — One Upload

ലക്ഷ്യം: Meta app "One Upload" **Live** ആക്കുക, അപ്പോൾ ഏത് client-നും Buffer പോലെ നേരിട്ട് Facebook / Instagram connect ചെയ്യാം.

App ID: `1565184508705336` · App URL: https://oneupload-omega.vercel.app

---

## ഘട്ടം 1 — App settings (ഞാൻ പൂരിപ്പിക്കും)

App settings → Basic:

| Field | Value |
|---|---|
| App icon (1024×1024) | `public/app-icon-1024.png` |
| Privacy Policy URL | https://oneupload-omega.vercel.app/privacy.html |
| Terms of Service URL | https://oneupload-omega.vercel.app/terms.html |
| User data deletion → Data deletion instructions URL | https://oneupload-omega.vercel.app/data-deletion.html |
| Category | Business and pages |
| App domains | oneupload-omega.vercel.app |
| Contact email | robinchacko246@gmail.com |

---

## ഘട്ടം 2 — Business Verification (നിങ്ങൾ ചെയ്യണം)

Advanced Access-ന് app ഒരു **verified business portfolio**-മായി connect ചെയ്തിരിക്കണം.

1. https://business.facebook.com/settings → **Business info** → **Start verification**
2. Business name, address, phone, website (https://oneupload-omega.vercel.app ആവാം) കൊടുക്കുക
3. Documents upload ചെയ്യുക — ഇവയിൽ ഒന്ന്: **GST certificate**, Udyam / shop registration, business bank statement, utility bill (business പേരിൽ)
4. Phone / email / domain വഴി confirm ചെയ്യുക
5. Verify ആയാൽ, Meta app-ൽ **App settings → Basic → Business portfolio**-ൽ ആ business തിരഞ്ഞെടുക്കുക

> Business portfolio ഇപ്പോൾ ഉള്ളവ: Exploring Kerala, Robin chacko, Eshoppingkart, … — ഏതിലാണ് GST / registration ഉള്ളത്, അത് ഉപയോഗിക്കുക.

സാധാരണ 1–5 working days.

---

## ഘട്ടം 3 — App Review-ന് ചോദിക്കേണ്ട permissions

App dashboard → **Publish / App Review → Permissions and features** → ഓരോന്നിനും **Request advanced access**.

ഓരോ permission-നും താഴെയുള്ള English text **"How will your app use this permission?"**-ൽ paste ചെയ്യുക, പിന്നെ screencast upload ചെയ്യുക.

### pages_show_list
> One Upload is a social media scheduler. After a user logs in with Facebook, we list the Facebook Pages they manage so they can choose which Pages (and the Instagram accounts linked to them) to connect. We only show the list; the user picks the Pages to add on our "Choose accounts" screen.

### pages_read_engagement
> We read basic details of the Pages the user connected (name, picture and the linked Instagram professional account) so we can show the connected channels in the app and find the Instagram account that belongs to each Page.

### pages_manage_posts
> Users create a post in One Upload (a video, a photo or a set of photos with a caption), choose their connected Facebook Page and either publish it now or schedule it. At the chosen time our server publishes the post to that Page. Users can also delete a post they published through One Upload from the "Posted" list.

### business_management
> Many Pages and Instagram accounts are owned by a Business portfolio. We need this permission so that, during Facebook Login, the user can grant access to Pages owned by their business portfolio and connect them to One Upload.

### instagram_basic
> We read the Instagram professional account linked to a connected Page (username and profile picture) to show it as a channel in One Upload, and to read basic information about posts the user published through our app.

### instagram_content_publish
> This is the core feature of One Upload. Users upload a Reel, a photo or a carousel, write a caption, select their Instagram professional account and publish now or at a scheduled time. Our server creates the media container and publishes it to the user's Instagram account.

### instagram_manage_contents
> Users can delete posts they published through One Upload from the "Posted" list in our app. When they press Delete and confirm, we delete that Instagram post.

### instagram_manage_insights
> The Analytics page in One Upload shows the user how their posts performed: views, likes and comments for each post they published through our app.

---

## ഘട്ടം 4 — Screencast videos (നിങ്ങൾ record ചെയ്യണം)

Meta-ക്ക് ഓരോ permission-ഉം app-ൽ എങ്ങനെ ഉപയോഗിക്കുന്നു എന്ന് കാണിക്കുന്ന video വേണം. ഒരു നീണ്ട video record ചെയ്ത് എല്ലാ permission-നും അതേ video upload ചെയ്യാം.

**Record ചെയ്യാൻ:** Windows-ൽ `Win + G` (Xbox Game Bar) അല്ലെങ്കിൽ OBS. Browser zoom 100%, English UI നല്ലത്. 2–5 മിനിറ്റ്.

**കാണിക്കേണ്ട ക്രമം:**

1. https://oneupload-omega.vercel.app തുറന്ന് **login** ചെയ്യുക (login screen കാണിക്കുക)
2. **Channels** → **Instagram account** അമർത്തുക → Facebook login window കാണിക്കുക → Pages / Instagram accounts tick ചെയ്ത് **allow** ചെയ്യുന്നത് കാണിക്കുക
   *(pages_show_list, business_management, instagram_basic, pages_read_engagement)*
3. App-ൽ **"ഏതൊക്കെ ചേർക്കണം?"** list → Instagram + Facebook Page tick ചെയ്ത് **Add channels** → Channels list-ൽ അവ വരുന്നത് കാണിക്കുക
4. **Create** → ഒരു video / photo തിരഞ്ഞെടുക്കുക → caption → Instagram + Facebook Page avatar tick → **Now** → **Upload everywhere** → "Posted ✓" വരുന്നത് കാണിക്കുക
   *(instagram_content_publish, pages_manage_posts)*
5. **Instagram app / instagram.com**-ൽ ആ post വന്നത് കാണിക്കുക, **Facebook Page**-ലും കാണിക്കുക
6. **Create** → **Schedule** → ഒരു സമയം → **Queue**-ൽ post കാണിക്കുക (scheduling കാണിക്കാൻ)
7. **Analytics** → views / likes / comments കാണിക്കുക *(instagram_manage_insights)*
8. **Posted** → ഒരു post-ൽ 🗑 **Delete** → confirm → Instagram-ൽ നിന്ന് പോയത് കാണിക്കുക *(instagram_manage_contents, pages_manage_posts)*

---

## ഘട്ടം 5 — Reviewer-ന് login (submit ചെയ്യുമ്പോൾ)

Meta reviewers നമ്മുടെ app-ൽ login ചെയ്ത് നോക്കും. App Review form-ലെ **"Test instructions"**-ൽ ഇത് കൊടുക്കുക
(reviewer account ഞാൻ ഉണ്ടാക്കി email/password തരാം):

> 1. Open https://oneupload-omega.vercel.app and log in with the test account below.
> 2. Open "Channels" and click "Instagram account". Log in with Facebook and grant access to a Page that has an Instagram professional account linked.
> 3. On "Choose accounts", tick the Instagram account and the Facebook Page, then "Add channels".
> 4. Open "Create", choose a photo or a short vertical video, write a caption, select the Instagram account and the Page, keep "Now" and click "Upload everywhere". The post is published to both.
> 5. "Posted" lists the post with a delete button; "Analytics" shows its views, likes and comments.
>
> Test login: email `<reviewer email>` · password `<reviewer password>`

---

## ഘട്ടം 6 — Submit & Live

1. എല്ലാ permissions-നും text + video ചേർത്ത് **Submit for review**
2. Meta-യിൽ നിന്ന് മറുപടി: സാധാരണ **3–10 days** (reject ആയാൽ കാരണം പറയും — തിരുത്തി വീണ്ടും submit)
3. Approve ആയാൽ App dashboard → **Publish** → app **Live** ആക്കുക
4. അതിനുശേഷം ഏത് client-നും Buffer പോലെ നേരിട്ട് connect ചെയ്യാം ✅

> YouTube-ന് വേണ്ടത് വേറെ: Google OAuth verification + YouTube API quota audit (ദിവസം ~6 uploads limit കൂട്ടാൻ). അത് Meta കഴിഞ്ഞ് ചെയ്യാം.
