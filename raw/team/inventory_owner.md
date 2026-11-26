# Eventana: owner inventory (source for agent skills)

Built only from:
- `raw/team/owner_messages.txt`: owner messages 21–26 Nov 2026, plus two long session summaries (21 Nov 08:51 and 26 Nov 11:26) that restate older history from about 17–20 Nov.
- `raw/RULES.md`.
- The file listing of `raw/`, plus a skim of `raw/office/index.html`, `raw/office/marsha_brief_paused.patch` and `raw/garden/*.py`. No media was opened.

**Conventions**
- Dates are 2026. "Pre-21" means restated in a summary and not seen as a raw owner message; its exact day is uncertain unless the summary gives it.
- **[UNCERTAIN]** marks anything I could not pin down.
- **[CLAUDE]** marks something Claude wrote or proposed, not something the owner said.
- Owner quotes are verbatim in «…». Many are voice-dictated, so the spelling is hers.

**About the owner**
- Name: Shaima.
- Writes Gulf Arabic and often dictates by voice.
- Owns four businesses: Eventana, مذاكرتي, أودلي, مطبخي.

---

## 0. Headline facts for team design

**The core three (26 Nov 15:32)**
- She told Claude to start with "the basics where we actually have problems":
  - the content creator
  - the reviewer
  - the ads manager
- «بس نحن خلينا نعتمد الأساسيين اللي فعليا نحن ياسين نواجه مشاكل معاهم، اللي هو الكونتنت كرييتر، واللي قلت لك اللي يراجع واللي يمسك الادز مانجر. هذا اوريدي فعليا نحن نحتاجه، لأن هذا اللي أنا أشتغل عليه معاك كل يوم»
- «ياسين» appears twice ("اللي هو ياسين يشتغل عليه الحين"). It may be a dictation artefact, or a real person who works on Meta ads. **[UNCERTAIN: ask her]**

**The full function list (26 Nov 15:36)**
- She dictated it herself; it is the basis of this inventory:
  - Meta campaign agent
  - Content writer, working "from its own head", on deep research and reel analysis
  - Production of reels **and** daily stories, including reviewing old stories
  - Website development, for both the Eventana site and the customer site
  - New-client acquisition and corporate contracts
  - An email agent that sees who booked and who didn't
  - Service innovation
  - Finance analyst with recommendations
  - Systems integration
  - Quality team
- She closed with «إذا في شي ناقص قولي».

**Skills must come from real work (26 Nov 15:36)**
- «ما نعطيهم سكيل بشكل عشوائي، لازم يكون سكيل بناء على كل الأشياء اللي موجودة عندنا، كل الأشياء اللي اشتغلنا عليها من يوم فتحنا كلود»
- She also said she may not have mentioned some needs «لأني أنا موش بروفيشنال في هالأشياء». She expects Claude to fill the gaps.

**She was not listened to (26 Nov 15:35)**
- «وأنا أوريدي عطيتك قائمة بالأشياء، بس أنت ما سمعت كلامي في الموضوع، وقلت لك شو أحتاج.»

**Delegation**
- Ads and marketing decisions were delegated (pre-21; the eventana-ads skill dates this to 17 Nov).
- On 26 Nov 11:18, for the garden reel: «انت طبق اللي تشوفه مناسب وانا موافقة على كل الكوست».
- But she still corrects hard when work goes wrong.

---

## 1. Meta / Instagram ads management

### (a) Rules and preferences
- Instagram placements only (pre-21).
- One live campaign (pre-21; listed on 21 Nov, not repeated in the 26 Nov summary). **[UNCERTAIN whether still in force]**
- Budget is **2,000 AED per month across all campaigns**. Tell her before raising the budget (pre-21; repeated 26 Nov).
- Professional ad names (pre-21).
- Give the cost before big spends (pre-21).
- Decisions are delegated and must be data-based (pre-21). She expects Claude to act «كمدير اعلانات».
- **Keep the real party theme (for example Mickey) in BOTH organic reels and paid ads (26 Nov 13:20, written into RULES.md).**
  - «لا يالحمار خله ميمي عادي / انا قبل سويت اعلانات الامور طيبه / مابا كله غلط خربت شغلي»
  - Never strip or replace a theme or character without her explicit ask.
  - Paid version of the garden reel = the Mickey v3 files. The no-character "paid" files are discarded.
- **Never use the gender-reveal reel (DW02HDeCHXa, 542K) as a benchmark or example** (26 Nov 10:56, RULES.md dated 25 Nov).
  - «لا تعتمد على ريل جندر ريفيل، لأن كل مرة تقولي ريل جندر ريفيل هذا امسحها من قائمتك… مشاعل الشحي مشهورة وهي دي شهرة الفيديو»
- Copying a competitor ad is allowed: same content, same hook, same strategy (24 Nov).
  - «ابا نفس عالاعلان لايفنتانا» and «استخدم نفس الكونتانت نفس الهوك نفس الستراتيجيه»
  - This was for the Uranus ad modelled on reel DfcihDJI53k («تخيل لو 8 مليار إنسان وجهوا ليزر لأورانوس»).
- Stay close to the source reel when adapting (24 Nov 19:34): «اعتمد على الريل الاساسي».
- No safety or operational rules in ads (pre-21).
- Judge an ad by whether it attracts the customer (26 Nov 11:51): «كيف تشوف الفيديو وهل هو يجذب العميل».

### (b) Recurring tasks
- Ads review: cost per WhatsApp chat per ad. The 20 Nov 3-day review:
  - Mermaid: 5.1 AED per chat
  - Bow golden: 12.9 AED per chat
  - Clown short: 8.9 AED per chat
  - Nothing was paused.
- Swap creatives inside existing ads. Example: mermaid ad 120254726771710422 was swapped to the v18 voiced ad.
- Adapt reference reels she sends into Eventana ads (24 Nov, 26 Nov 13:52).
  - DgKZPUDgwZq: «وهالفيديو فكرة بعد حق ايفنتانا عشان الإعلان»
- She asks to see the original source video of an ad (25 Nov): «راوني الفيديو الأساسي لهذا الإعلان، الإنستغرام».

### (c) Corrections (become reviewer checks)
1. Uranus ad v1 (24 Nov 19:13): logo wrong, «حاط لي خلفية بيضة». Fixed in v2.
2. Uranus ad v1: the shot where the clown gives the girl the «الكفئوية» was used twice, once colour-graded and once not.
   - «الكفئوية» is probably a crown or tiara. **[UNCERTAIN]**
3. Uranus ad v1: «يوم تقول نار علامة تعجب، في الأوريجينال فيديو فيه قال نار».
   - The issue was the «نار!» line or text versus how the original said it. **[UNCERTAIN exact fix]**
4. Uranus ad v1: Claude did not self-review. «راجع انت كمدير اعلانات شو تشوف».
5. Uranus ad: drifted from the source reel. «اعتمد على الريل الاساسي» (24 Nov 19:34).
6. Claude repeatedly cited the gender-reveal reel as a benchmark («كل مرة تقولي»).
7. **Claude stripped Mickey from the paid version** of the garden reel. «خربت شغلي» (26 Nov 13:20).
8. Answered in English. «عربي كلمني» (24 Nov 19:00).

### (d) Pending decisions
- Uranus ad (v3, with music): CTA in the comments or on WhatsApp? Organic reel or paid ad? Not answered.
- Which garden-reel hook or version to run first. Two Mickey versions exist: v3 and v3_hookB.
  - She said «اشوفهم اول» (26 Nov 13:23).
- [CLAUDE] proposal: a «أنقذوا عيد ميلاد سيف» comment-vote ad at about 3,500 points. It is listed as an ask in office/index.html; she has not answered. **[UNCERTAIN whether she saw it]**
- [CLAUDE] caption proposal: «لو عطيتينا حديقتج بكرة… أي ثيم تختارين؟ 👇» + Golden Package 5,999 + WhatsApp. Not confirmed.

### (e) Tools and assets
- Windsor.ai (Meta and Instagram):
  - Facebook ad account 638060898452533
  - Instagram eventana.uae
  - Actions: create_ad_video, update_ad
  - Trial plan, frequent timeouts
- Supermetrics: Facebook ads and IG insights queries.
- Skills: `eventana-ads`, plus `kafu-wa-nus` for مذاكرتي.
- WhatsApp CTA number: +971 56 450 0777.
- Files: `raw/uranus/` (v1, v2f and v3, vo.mp3, music.mp3) and `raw/garden/eventana_garden_reel_v3*.mp4`.

---

## 2. Content writing (hooks, captions, scripts, research)

### (a) Rules and preferences
- The writer must think for itself, from deep research and reel analysis (26 Nov 15:36).
  - «يكتب المحتوى مفروض من مخه بناء على سيرة عميق وبناء على بحث وبناء على الريل ويسوي أنالايز بعدها يكتب المحتوى ويصيغه»
  - «سيرة عميق» is most likely «سيرش عميق» (deep search).
- Gulf Arabic only (pre-21, repeated). She writes «عربي» whenever English appears.
- Wording bans (pre-21):
  - Never write «خلفية»; say «ستاند بالون رئيسي فخم».
  - Never write stand counts.
  - Eventana does **not** provide cakes, only cake display stands.
- Package presentation:
  - Not text lists: «عرض الباقه كله كتابه ومايجذب العميل».
  - Her official Golden Package card is the reference.
- Golden Package contents (her card, pre-21):
  - Big main balloon stand and an entrance stand with balloons
  - Castle inflatable 4×4 and bubble house 4×4
  - 3 clowns with dance and competitions
  - Face painting, cotton candy and popcorn, each for 40 kids
  - Tables, chairs and a full theme for 20 kids
  - Cake display stands
  - 10 competition gifts
  - Music speaker
  - Price **5,999**. Her card shows tabby; whether it is Tabby or Tamara is **[UNCERTAIN, unresolved]**.
- No safety or operational rules in stories or ads (pre-21).
- The clown never talks (pre-21). This matters for scripts and voice-overs.
- Research method she asked for (26 Nov 10:53):
  - Analyse ALL reels, "ours together" and "the ones we made".
  - Find the best and worst, then derive a strategy.
  - Check all previously reviewed ideas.
  - Do deep research on trending reels, especially event reels.

### (b) Recurring tasks
- Before every new reel, review the reels Claude made, then build from our ideas (21 Nov 11:47).
- Hooks, captions and ad scripts for each reel. Example: the five garden-reel text lines t1–t5 («عطيتينا حديقة فاضية…», «…وخلال ساعات», «كل تفصيلة مسوية بحب», «وهذي اللحظة اللي تسوى كل شي», «حفلة طفلج… علينا»).
- Trend research with vidIQ outliers. Findings so far:
  - Process-to-reveal transformations
  - Kid-reaction surprises
  - Gulf-mum emotional captions
- Learn from the reference reels she sends:
  - DgFJBh8Kgt4: «روح تعلم من هالفيديو… وشو هالمكتبة»
  - DgKZPUDgwZq
  - DgCjzulAdey
  - DfcihDJI53k
  - auraflowers_warsaw «GTA: Flower Business Edition» carousel

### (c) Corrections
1. Package display was all text and didn't attract (pre-21).
2. The Golden Package item list was incomplete: «اغراض الباقه الذهبيه ناقصه» (pre-21).
3. She asked for an analysis of the reels Claude made, and Claude analysed the wrong set: «‏انا اتكلم عن الريلات اللي انت سويتها فقط» (21 Nov 11:49).
   - On 26 Nov she widened the scope to all reels, ours and Claude's.
4. The gender reveal was used as an example again and again (see 1c-6).
5. English in replies (see section 12).
6. She had to ask for the analysis to be redone as a director: «راجع مرة ثانية الفكرة اللي أعطيتها وراجع إخراجها، وأبغي إخراج حلو 100% يطلع ترند» (26 Nov 10:56). This implies the first concept was not good enough.

### (d) Pending
- Whether she meant "library" in DgFJBh8Kgt4 as a sound or asset library or a skill library. Outcome unknown. **[UNCERTAIN]**
- Tabby or Tamara wording on package copy.

### (e) Tools
- vidIQ: watch_shortform_content, instagram_tiktok_outlier_search, ig_profile_reels.
- Windsor and Supermetrics for metrics.
- Skills: `kafu`, `ig-caption`, `ig-reel`, `ig-plan`.
- `approved.md`, which held the reel lessons and package contents, was **lost in a container wipe**. Only RULES.md survives.

---

## 3. Production (reels, AI images and video, music and voice, editing)

### (a) Rules and preferences
- **Before any new AI scene, show a still first and give the cost** (pre-21).
  - For the garden reel she pre-approved all cost (26 Nov 11:18).
  - She approved GTA samples with «اوك» (21 Nov).
- Use AI only for moments real footage can't show (pre-21).
- Using AI on her own work is fine (26 Nov 11:07): «هذا الشغل كله شغلنا نحن، عندنا الحق إن نحن نسويه».
- Her preferred quality and method (26 Nov 10:58–11:10):
  - "Very high professionalism, especially of the venue."
  - Work like an architect: empty grass garden → fixed party plan → her real items placed in fixed positions «عشان لما تطلع في الفيديو الآيتم ما يتغير مكانهم كل شوي» → add kids in video.
  - Place items professionally and «ما تنسى الديتيلز خاصة اللي على الطاولات».
  - Show the castle inflatable complete: «النطاطية… حطها كاملة» and «خلها واضحة كاملة».
  - Upgrade quality, make it «احترافية وسينمائية». She is fine with editing her own photos, for example turning paving into grass.
  - Focus on the event and its details and beauty, not the grass (26 Nov 11:15).
  - **The main product sits in the centre** (26 Nov 11:32): «لازم انت تركز على المين برودكت».
  - **Respect real dimensions**: the castle is 4×4 m and the bubble house is 4×4.
  - **Bubble-house door is at the back**: kids should already be inside, jumping, with balloons swirling.
  - **Time of day: afternoon or golden hour, not sunset** (26 Nov 11:51): «أنا أفضل وقت العصر والساعة الذهبية».
  - «جو أهد» (same message) may mean "calmer mood". **[UNCERTAIN]**
- Brand visuals (pre-21):
  - Colourful logo only, with no white box.
  - Original colours (HDR tonemap allowed). Cinematic grading is now OK at her request (26 Nov).
  - No FaceApp-edited photos.
  - The mermaid performer is Filipina, in a modest costume.
  - The clown never talks.
- No code-made graphics or motion. She rejected them: «قدراتك تعبانه» (pre-21).
- Lessons from reel data (20 Nov review, restated):
  - Real footage plus voice was best (the bow reel got 11 saves).
  - The pixel-game reel was the worst.
  - Skip rate was 61–69% on every reel, which means a weak first frame.
  - Read-heavy formats had the shortest watch time.
  - Plan: a face in the first frame, real footage, her voice.

### (b) Recurring tasks
- **One reel per day**, each built after reviewing previous reels (21 Nov 11:47): «كل يوم على نفس المنوال… ريل واخد خلاص».
- Production of the daily stories as well (26 Nov 15:36).
- Reel review 3 days after posting; don't judge reels early (pre-21).
- Pipeline actually used for the garden reel:
  1. AI empty plate
  2. Party plan (01_plan.jpg)
  3. Her real photos composited, with Mickey masked by grey boxes and the real pixels pasted back, because every AI provider blocks Disney
  4. Kling clips of kids
  5. Lyria music
  6. Tajawal Arabic text overlays
  7. A Python/OpenCV/ffmpeg render (`raw/garden/render*.py`, `hookB.py`)

### (c) Corrections
1. Code-made stories and motion graphics were rejected: «قدراتك تعبانه», «الستوري مب حلو قدراتك ضعيفه وايد» (pre-21).
2. Package photo grid rejected: «بعد مب حلو مب لازم صور لعرض الباقه ممكن موشن» (pre-21).
3. «Remove the clown parts» (pre-21). Context unknown. **[UNCERTAIN which piece]**
4. Videos she had sent were gone. «ليش ماعندك فيديوهات ايفنتانا ؟» and «وين الفيديوهات اللي عدلت عليها بالاي اي وزدت اطفال ؟» (24 Nov).
   - The raw footage and AI-edited clips were lost in a container wipe.
   - Bow and mermaid footage must be re-sent. The checklist item is to back everything up to the repo's `raw/`.
5. Uranus logo with a white background (24 Nov).
6. Uranus: duplicated clown shot, one graded and one ungraded (24 Nov).
7. Uranus: «نار!» versus the original's «نار» (24 Nov). **[UNCERTAIN detail]**
8. Garden stills focused on the green grass more than the event and details (26 Nov 11:15).
9. Castle not fully visible in the stills (26 Nov 11:10).
10. **Garden reel v1** (26 Nov 11:32), her two "main errors":
    - The castle was too far away, kids ran until the last shot to reach it, and the castle was not the centred main product.
    - Scale was wrong: a child jumped up and held the top of a 4×4 m castle.
11. **Garden reel v1**, bubble house: kids ran in through the front, but the door is at the back.
12. Garden reel v1: «والباقي عليك انت». She expected Claude to find the other errors itself as ads manager and director.
13. Garden reel: the sunset lighting was Claude's choice, against her preference for afternoon or golden hour (26 Nov 11:51).
14. Garden reel paid version: Mickey removed without being asked (26 Nov 13:20). See 1c-7.
15. A voice-over came out in Spanish because the Eleven v3 default language was not set to Arabic. This was a Claude-found error, not hers, and cost +90 points.
16. Emoji rendered as boxes in PIL output; emojis were removed from engine-rendered text. Claude-found.

### (d) Pending
- Garden reel final: two Mickey versions (v3 and v3_hookB). She wants to see them before anything is posted (13:23).
- Thursday or new reels built from the lessons (pre-21).
- GTA-6-style Eventana image carousel (21 Nov): samples approved, final status unknown. **[UNCERTAIN]**
- Re-sending lost raw footage (bow, mermaid).

### (e) Tools and assets
- Artlist / AI_Characters:
  - Nano Banana 2: 130 points per image
  - Kling 3.0 I2V: 500 points per 5s
  - Lyria instrumental: 150 points, 31s
  - Eleven v3 voice «Norah», language must be set to Arabic
  - Seedream I2I also blocks Mickey
- Canva generate-image (used once) and Figma weave (looked up).
- Local tools: PIL with raqm, OpenCV, rembg, ffmpeg, Playwright render scripts, segment.py (u2net).
- Tajawal Black font.
- Assets:
  - `raw/mickey_party/`: 16 real photos of the «Saif turns One» Mickey party
  - `raw/eventana_ai/`: 14 old AI clips (mermaid door, bow party, castle, bubble)
  - `raw/garden/`: plates, masks, clk/ frames, aft/ afternoon versions, castle_kids.mp4, bubble_v3.mp4, music
  - Logo: email-logo.png from the customer app
- Skills: `kafu`, `hyperframes`, `media-use`, `remotion-best-practices`.

---

## 4. Stories (daily routine and analysis)

### (a) Rules and preferences
- **Always 10 connected stories, each continuing the previous one** (pre-21): «الشي المعتمد للستوري ١٠ ستوري يكون متواصل وكل ستوري يعتمد على اللي قبله».
- **Every day a completely different, more inventive style** (pre-21): «الستوري لازم يكون كليا غير عن اليوم ومبتكر اكثر تعلم من ستوري اليوم».
- No safety or operational rules in stories (pre-21).
- No code-made graphics (pre-21).
- **Nightly full analysis, then post new stories at 10:00 the next morning** (21 Nov 11:50): «لازم تسوي عليه فل انالايز كل يوم فليل والصبع ساعه ١٠ تنشر ستوري يديد بناء على الانلايز السابق».
- **Do not send daily approval requests; posting is automatic** (21 Nov 11:53–11:55):
  - «ماتم تطرشلي موافقات كل يوم»
  - «كيف اعطيق موافقه عشان ماتر جع لي في انستقرام»
  - «هو اوريدي اوتو»
- The story-production role must also review old stories and develop ideas (26 Nov 15:36).

### (b) Recurring tasks
- Nightly prep and analysis.
- Daily 10:00 post through scheduled tasks.
- Metrics read through Windsor IG story fields: reach, exits, taps back, swipe forward, replies.
- Example finding from 21 Nov: reach fell from 96 to 63 (66% completion); story 1 lost 24 of 104; the first reply came on the emotional mum line.

### (c) Corrections
1. «ولا ستوري عدل» (pre-21): none of the stories were good enough.
2. Stories were weak and code-made: «قدراتك تعبانه», «قدراتك ضعيفه وايد».
3. Stories were not connected, which led to the 10-connected rule.
4. Stories were too similar day to day, which led to the "completely different and inventive" rule.
5. **Stories and reels were not being posted** (21 Nov 11:38): «وليش مب يالست تنزل لا ستوري ولا ريل ؟».
   - 20 Nov was missed. On 19 Nov only 9 of 10 were posted.
   - 22–26 Nov were not posted, because the worker restarts on Windsor execute_action.
6. Daily approval requests were annoying her (21 Nov).
7. «طرشت لك قبل» (22 Nov): Claude asked for something she had already sent. **[UNCERTAIN what]**

### (d) Pending
- Auto-posting is broken. Should a new session be opened? Not answered.
- Missed stories for 20 and 22–26 Nov.

### (e) Tools
- Windsor create_story (crashes the worker in this session).
- Render static site `eventana-stories-media` (URLs `/s/<date>/NN.mp4|jpg` and `/reels/`).
- `publish_media.sh` has a known problem: it replaces clip audio with pop.mp3.
- Scheduled tasks for the nightly and 10:00 runs.

---

## 5. Website development (customer booking site, ops dashboard, API)

### (a) Rules and preferences
- **Promo codes work with full payment only (Apple Pay or card), never with Tabby, Tamara or any instalment plan.** Show a note when a code is entered. This covers the welcome code and the individual customer codes (pre-21, restated 21 Nov):
  - «أبى أسوي شيء وايد مهم في الموقع، إن العروض ما تشتغل لا على تابي ولا على تمارة، بس الدفع بأبل باي. فإذا هي بتحط كود العرض لازم يطلع لها نوت… سواء كود ويلكم أو سواء كودات الكاستمر اللي نحن طرشنا لهم كل وحدة بروحها.»
  - [CLAUDE] implementation: staff referral codes are exempt.
- **Merge or deploy only after the word «موافقة»** (pre-21).
- Two sites exist, per her 26 Nov wording: «سواء لـ Eventana أو سواء لموقع العملاء». In the repo these are the customer booking site (eventanauae.com), the Ops dashboard and the API.
- Ops helpers for Marsha were approved on 26 Nov 15:26 («تمام، موافقة عليها»), but:
  - «بس أنا حسيت إن اللي يروح للمطبعة مضطر ما له داعي». The print-shop runner or pickup piece is unnecessary.
  - The Marsha morning-brief code (print list, design cards, 2-day readiness email) is saved as `raw/office/marsha_brief_paused.patch`, marked "paused by owner, not for merge".

### (b) Recurring tasks
- PRs on eventanaae/eventana.
- CI: type-check, API unit tests, Customer E2E (Playwright, run against the live site).
- QA through the `eventana-qa` skill.

### (c) Corrections
- No direct owner complaint about site code in this period.
- Known defect: the E2E test gets stuck at the theme picker and has been red on main since runs #244–246.

### (d) Pending
- **PR #100** (promo codes with full payment only) waits for «موافقة».
- Tabby or Tamara wording.
- The Marsha brief patch: resume or drop? It needs re-scoping without the print runner. **[UNCERTAIN]**
- Fixing the broken E2E test.

### (e) Tools
- GitHub MCP.
- Render: services, postgres, logs, env vars.
- Repo: `apps/api`, `apps/customer`, plus an ops app.
- Skill: `eventana-qa`.
- Secret key files must never be shared: `.ro_db_key`, `.rw_db_key`, `.ig_code_key`.

---

## 6. Lead generation and corporate contracts
- (a) Only her list item: «عندنا جلب عملاء جدد وعقود شركات» (26 Nov 15:36). No rules given.
- (b) No routine exists yet.
- (c) No corrections.
- (d) Everything is pending: the target segments and the corporate offer are undefined. **[UNCERTAIN scope]**
- (e) Nothing in use.
  - Available but unused connectors: Apify scraper skill, QuickBooks CRM (leads and opportunities).
  - Existing customer touchpoint: the WhatsApp number.

## 7. Email and customer follow-up (who booked, who didn't)
- (a) «نحتاج agent يطرش إيميلات ويشوف الإيميلات ويراجع كل شيء أول بأول، يشوف منو حجز ومنو ما حجز» (26 Nov 15:36).
- Hard rule (pre-21): **no customer messages without her approval.** Customer data and her email are private.
- The office mock assumes the same: «أي رد على عميل أجهّزه وأرفعه لشيماء».
- (b) No routine exists yet.
  - Related: individual customer promo codes were "sent to each one" (her words), so some outbound customer messaging already happens. Who sends it is **[UNCERTAIN]**.
- (c) No corrections.
- (d) Which inbox, which sender, and the definition of "didn't book" (an abandoned checkout? a WhatsApp chat with no booking?) are all **[UNCERTAIN]**.
- (e) The API already sends email (the Marsha brief used it). The Resend connector is available but there is no evidence it was used. Booking data is in the Render Postgres.

## 8. Service innovation
- (a) «ابتكار خدمات ما أبالغ إني أنا أسوي» (26 Nov 15:36). The meaning is unclear: possibly "service innovation, which I'm not overdoing myself". **[UNCERTAIN]**
- (b) to (d): nothing defined.
- (e) Known service catalogue (from the package card and the field-team duties in the office mock):
  - Balloon stands and entrance stand
  - Castle and bubble inflatables, foam
  - Clowns, mermaid performer, character costumes
  - Face painting, kids' manicure and pedicure
  - Popcorn and cotton candy, ice-cream machine, food stations
  - Instant camera, gifts, speaker
  - Themed tables and chairs
  - Cricut name cuts, plate papers, water labels

## 9. Finance analysis and profitability
- (a) «تحليل أداء الشركة وربحيتها أحتاج finance analyst، أوكي؟ اللي هو ويسوي لي recommendation» (26 Nov 15:36).
- Related rules:
  - 2,000 AED per month ad cap
  - Give the cost before big AI spends
- (b) Partial routines exist: cost per chat per ad, and AI point spend per reel. Garden reel: images ~1,300, video 1,000 and music 150 points, plus later work.
- (c) No corrections.
- (d) Data sources and report cadence are undefined.
- (e) QuickBooks connector (company_info and customer search were called before 21 Nov; findings not recorded), Artlist balance, Windsor and Supermetrics ad spend.
  - Marsha enters expenses (office mock, from the 26 Nov discussion). **[UNCERTAIN where]**

## 10. Systems integration (connectors and tools)
- (a) «حبيت هاي ربط الأنظمة» (26 Nov 15:36). No rules beyond the security ones in section 12.
- (b) The recurring pain is infrastructure:
  - The worker restarts on every Windsor execute_action, so posting fails.
  - Container wipes lose footage and approved.md. The fix is to back up to `raw/` in the sm worktree and push.
  - Editing settings to allow Windsor was denied by the classifier.
  - Instagram dedupe and timeouts. A scheduled-task update returned "not found".
- (c) Her complaint about missing posts (4c-5) and lost videos (3c-4) are integration failures at root.
- (d) Open: a new session to restore posting, and a durable store for footage.
- (e) Connected tools used:
  - Windsor, Supermetrics, vidIQ
  - Artlist, Canva
  - Render, GitHub
  - QuickBooks
  - Claude Docs
  - Remote scheduled tasks
- The Instagram account is eventana.uae.

## 11. Quality and review: every owner correction (master checklist)
Every item has a date. Pre-21 items come from the summaries.

**Stories and packages (pre-21)**
1. Pre-21: code-made stories and motion rejected (very weak): «قدراتك تعبانه», «قدراتك ضعيفه وايد».
2. Pre-21: none of the stories were acceptable: «ولا ستوري عدل».
3. Pre-21: the package shown as a text list doesn't attract.
4. Pre-21: the package photo grid was rejected; motion was suggested instead.
5. Pre-21: Golden Package items were missing; check them against her official card.
6. Pre-21: stories were not connected; the rule is 10 connected stories.
7. Pre-21: stories were too similar to the day before; the rule is a new, inventive style each day.

**Posting and approvals (pre-21 to 22 Nov)**
8. Pre-21: Claude made a reel schedule on its own: «جدول ريلين … مو بنت سويته على كيفك». Only post reels she approved.
9. Pre-21: «Remove the clown parts». **[UNCERTAIN context]**
10. Pre-21 and 24 Nov: English in replies; the rule is Arabic only.
11. 21 Nov: stories and reels were not being posted.
12. 21 Nov: Claude analysed the wrong reel set; she meant only Claude's reels.
13. 21 Nov: too many daily approval requests; posting is auto.
14. 22 Nov: asked again for something she had already sent: «طرشت لك قبل».

**Lost files and the Uranus ad (24 Nov)**
15. 24 Nov: no Eventana videos on hand, and the AI-edited videos were lost.
16. 24 Nov: Uranus logo wrong, with a white background.
17. 24 Nov: Uranus duplicated clown shot, graded and ungraded.
18. 24 Nov: Uranus «نار!» did not match the original. **[UNCERTAIN detail]**
19. 24 Nov: no self-review as ads manager before delivery.
20. 24 Nov: drifted from the source reel; stick to the original.

**Garden reel and ads (25–26 Nov)**
21. 25 and 26 Nov: the gender-reveal reel was cited as a benchmark again.
22. 26 Nov: the first reel concept or direction needed a redo to reach "100% trend".
23. 26 Nov: the castle was not complete in the stills.
24. 26 Nov: the stills were grass-focused instead of event-focused.
25. 26 Nov: the castle was too far and not centred; the main product was not the hero.
26. 26 Nov: wrong scale; a child grabbed the top of a 4×4 m castle.
27. 26 Nov: kids entered the bubble house through the front, but the door is at the back.
28. 26 Nov: "the rest is on you": Claude missed errors it should have caught.
29. 26 Nov: sunset lighting chosen against her preference for afternoon or golden hour.
30. 26 Nov: no ads-manager judgement of "does it attract the customer?"
31. 26 Nov: English again («عربي.» at 13:07).
32. 26 Nov: Mickey stripped from the paid ad: «خربت شغلي».

**Virtual office and team design (26 Nov)**
33. 26 Nov: the virtual office had too few staff: «الموظفين ناقصين».
34. 26 Nov: the agent names were wrong: «شو هالأسماء؟». The mock uses Emirati names (شمّا، خليفة، كفو…). Whether she wants role names or different names is **[UNCERTAIN]**.
35. 26 Nov: the office was static and lifeless compared with the reference, where people move, talk and share information.
36. 26 Nov: the print-shop runner role is unnecessary.
37. 26 Nov: Claude didn't listen to the list she had already given.
38. 26 Nov: skills must not be random; they must be grounded in the real work.

**Claude-found defects worth checking**
- Voice-over language defaulted to Spanish.
- Emoji boxes in PIL output.
- publish_media.sh strips voice.
- Paste-back seams and halos.
- Misaligned empty and full plates from different seeds.
- rembg cutouts lost the stand and tables.

## 12. Cross-cutting rules

**Language**
- Gulf Arabic only in every reply and every piece of content.
- She types «عربي» or «عربي كلمني» as a correction. This happened on 24 Nov, on 26 Nov, and in the pre-21 summary.

**Approvals**
- Still required: AI spend on a new scene (still plus cost first), ad and budget changes, customer messages, merges and deploys («موافقة»), and posting a reel she hasn't approved.
- Not required: daily story posting (auto), and garden-reel AI cost (pre-approved).
- Tension:
  - On 21 Nov she said "don't send daily approvals; auto".
  - Pre-21 she said "only post reels she approved".
  - On 26 Nov she said «اشوفهم اول».
  - So stories run automatically while reels and ads go to her first. **[UNCERTAIN, confirm]**

**Privacy and security**
- Never enter passwords, card details or tokens.
- Never share the key files.
- The owner's email and customer data are private.
- No model IDs in commits or PRs.
- Commit and PR footers are required.

**Budget**
- 2,000 AED per month on ads; tell her before any increase.
- Give the cost before big spends.

**Brand**
- Colourful logo only, with no white box.
- Original colours, with cinematic grading OK.
- No FaceApp photos.
- The clown never talks.
- The mermaid performer is a modest Filipina.
- Keep real themes and characters (Mickey) in organic and paid.
- Afternoon or golden-hour look.
- Products shown at true scale and fully visible, with the main product centred.

**Content bans**
- No «خلفية» (use «ستاند بالون رئيسي فخم»).
- No stand counts.
- No cakes (only cake stands).
- No safety or operational rules in stories or ads.
- No code-made graphics.
- No text-list or grid package displays.
- No gender reveal as a benchmark.

**Durability**
- Back up all work to the repo `raw/` (stories-media branch) and push. The container gets wiped.

## 13. Other businesses mentioned
- **مذاكرتي** (mthakarti.com), a study platform.
  - It has its own skills: `kafu` (creative) and `kafu-wa-nus` (growth and ads).
  - The office mock gives it 3 AI roles. No owner rules for it appear in these sources.
- **أودلي**: mentioned only by name (26 Nov 13:54). Undefined; the office mock asks her to define it.
- **مطبخي**: mentioned only by name. Undefined. (The mock's "food photographer" role is a Claude guess.)
- She wants one virtual office for all four businesses, modelled on reel DgCjzulAdey (26 Nov 13:54): «سولي أوفيس فيرتشوال… شوف لي شو الموظفين والخطة».
  - Artefact: `raw/office/index.html` («مكتب شيماء»), the Claude-built mock she criticised (items 33–35).
- **Real Eventana staff** (26 Nov, RULES.md):
  - Marsha: operations and design (Cricut, plate papers, water labels, entrance and main stand designs, giveaways, the in-house printer, sending the rest to the print shop on WhatsApp).
  - Field team: Dindo, Diana, Gloria, Jane, who collect from the print shop.
- **Mashael Al Shehhi** (مشاعل الشحي): a celebrity collaborator on the gender-reveal reel. Not a business.
- External accounts used as references, not businesses: auraflowers_warsaw; the creator behind DfcihDJI53k (the summary calls it "Mawrid"); DgFJBh8Kgt4; DgKZPUDgwZq; DgCjzulAdey.
