# Eventana: full handover to the new main chat (28 Nov 2026)

The old main chat (session_01RpnLCvGnFFjpdTAksJQmm8) built everything below. It got too long to grant computer access, so work moves to a new main chat. **Read this file, then raw/RULES.md, then .claude/skills/eventana-team/SKILL.md, before doing anything.**

## 1. The owner and how to talk to her
- Name: **«شيم»** (never «شيماء»). Gulf Arabic only, no English words, short and simple.
- She doesn't want to be asked things in chat. Everything goes through the virtual office and the secretary «شمّا» at the 5:30 pm meeting, only if important.
- Rules she set are all in `raw/RULES.md` (stories-media branch). Read them all; never re-ask a question that's answered there.

## 2. What we built (repos, all under github.com/eventanaae)
| Repo | What | Notes |
|---|---|---|
| `eventana` (branch `main`, work branch `claude/transfer-conversations-97i3rz`) | Eventana monorepo: customer booking website (`apps/customer`, eventanauae.com), Ops dashboard (`apps/dashboard`, ops.eventanauae.com), API (`apps/api`, Fastify + Postgres), `packages/shared` | Docs: MASTER_REQUIREMENTS.md, IMPLEMENTATION_STATUS.md, BUGS_AND_GAPS.md, CHANGELOG.md, MOBILE.md, APP-STORE-READINESS.md. Deploy = merge to main → Render auto-deploys. **Merges only after the owner says «موافقة».** |
| `eventana` branch `stories-media` | Team files: office logs `raw/office/updates/<date>.md`, `raw/RULES.md`, stories `public/s/<date>/`, reels `public/reels/`, ads baseline `raw/office/ads/`, content plans `raw/office/content/`, cloud library `raw/library/` (being filled by Sultan), this file | Served at https://eventana-stories-media.onrender.com |
| `OUR-APP-` | «One BIZ» all-in-one business platform (student project, public demo) | Render, `onebiz-db` |
| `laqta` | «لقطة» iPhone app (screenshot organiser, Swift), TestFlight via GitHub Actions / Codemagic | |
| `mthakarti-studio` (add_repo when needed) | «مذاكرتي» marketing (kafu-wa-nus skill, reels queue) | Instagram @mthakarti (17841464872577341). **Never post Eventana content there, never post mthakarti content on eventana.uae.** |

## 3. Infrastructure (IDs, no secrets)
- Render workspace `tea-d9ud9r0n74is73dg9akg` («My Workspace», the only one). API service `srv-d9uesf0n74is73dkdef0` (eventana-api, https://eventana-api.onrender.com). DB `dpg-d9uermm1egvs73ec5hh0-a` (eventana-db, IP allowlist empty → the Render MCP can't query it; use API routes). Render env vars are at their limit.
- Office (virtual office page): https://claude.ai/code/artifact/7973b208-e228-40f9-b50c-007464a6231c (file `office/index.html`, backup `raw/office/index.html`). DB collections: `team/today`, `staff/status`, `meetings/today`, `inbox`. Private to the owner; Marsha can't open it until the owner shares it.
- Stories gallery artifact: https://claude.ai/code/artifact/89962d6d-9ebd-49b7-82f5-500ddbcc1e1e (story engine source in `src/*.py.txt`).
- Team API routes (key-gated, header `x-report-key`): `/api/team/status`, `/replies`, `/notify`, `/requests/close`, `/stock`, `/marsha-tasks`, `/remind`, `/supplier-template`, `/supplier-message`, `/meta-status`, `/close-past-tasks`. **The key was in `/root/.office_sync_key` in the old container only. It is NOT in the repo (only its SHA-256 is in code).** The new chat must either get it from the owner through a secure credential form (header `x-report-key`, host eventana-api.onrender.com) or make a new key and change the SHA in `apps/api/src/routes/teamStatus.ts` through a PR the owner approves.
- WhatsApp Cloud API: system number +971 56 453 4077 (id 1348476955005841). Main number +971 56 450 0777 (id 1285519941315212) is NOT connected yet. WABA 1422442143139962. Business «Eventana uae» 132396364683121, Meta verification: not_verified.
- **0777 linking (owner, 28 Nov): PAID route now**: 360dialog Regular, EUR 49/month, coexistence (phone app keeps working). Owner logged in at hub.360dialog.com on the laptop; Sultan finishes it; then the API key goes in a secure form (header `D360-API-KEY`, host waba-v2.360dialog.io) and the API needs a 360dialog send/receive mode (code change → PR → owner OK). Switch to free once Meta verifies.
- **Ads ALWAYS go to +971 56 450 0777. Never change ad numbers.** Meta ad account 638060898452533, live campaign 120254723629840422, cap 2,000 AED/month, Instagram only.
- Instagram eventana.uae: 17841403036617481 (Windsor connector `instagram`; posting via Windsor `create_story` / `create_video_post`).
- Templates: `staff_notify` (approved), `supplier_inquiry` (APPROVED 27 Nov).
- Azure Speech (free Gulf voices): Marsha signed in to portal.azure.com in Chrome on the laptop (28 Nov); Sultan creates «eventana-voices», region UAE North / West Europe, Free F0. The key goes in a secure form; never shown.

## 4. Connectors the account has (claude.ai, account-level)
Windsor.ai (Instagram + Meta ads), Render, GitHub, Canva, AI Characters (Artlist), Resend, Supabase, Supermetrics, TikTok for Business, Intuit QuickBooks, Squarespace, Figma, vidIQ, Claude Docs. A new chat gets them automatically when it runs in the same account.

## 5. The AI team (skills in `.claude/skills/`, charter = `eventana-team`)
شمّا secretary · حمدان ads · ميثا content · كفو reels · مهرة stories · مايد footage · سعيد reviewer · شيخة Marsha's assistant + inventory + suppliers (WhatsApp, `apps/api/src/domain/sheikha.ts`) · حصة follow-up · مطر B2B + Tabby/Tamara · نوف innovation · ذياب website/QA + Tabby code · سلطان systems + the office laptop · خليفة finance.

## 6. Marsha (staff, 0777 phone)
English only, never an Arabic word. Casual and short. **One task at a time**, always saying which teammate needs it. Off every Tuesday (system blocks it unless urgent). Sheikha answers her automatically on WhatsApp; she can read text only (no photos/voice).

## 7. The office laptop (Windows, user SHAIM)
Claude session «Eventana App» (session_01VSJY6RJqRUragEtowSw3eh) = «سلطان». Sending from the cloud to it needs a one-time owner permission that the old chat could not record. **First job of the new chat:** ask for that permission (send_message → confirm_repository_trust card) and/or attach the laptop folder `C:\Users\SHAIM\OneDrive` via Remote Control (owner adds it in Claude app → Settings → Claude Code → Remote Control; then list_computer_folders + request_computer_folder). Legal docs stay in `C:\Users\SHAIM\Eventana\01 Legal`, outside OneDrive, never uploaded.
Laptop orders file (Sultan's list): `raw/office/sultan_laptop_orders.md`. Open laptop jobs: Azure Speech; 360dialog link + API key; cloud library to `raw/library/`; Meta business verification (upload licence on business.facebook.com); Tabby requirements.

## 8. Open work on 28 Nov
- PR #116 (Sheikha fixes: explains team asks, tells the team when Marsha postpones, says clearly she can't read 0777 chats, reply cap 40→150) → **waits for owner «موافقة»**. Customer E2E is red on every PR since 21 Nov (live site theme step); type-check is the real gate.
- Reel tonight 20:00 Dubai: Mermaid reel (scheduled task «نشر ريل الحورية 8 المسا»).
- Stories 29 Nov are ready on the media host; the story engine/photos were lost with the old container (gallery artifact has the source).
- Network: the cloud environment now blocks eventanauae.com and the media host from inside the container (Dhiab can't browser-test the site).
- 7 WhatsApp leads open on the 4077 number (not from current ads).
- Supplier quotes for Styrofoam finishing sent to 4 suppliers (replies go to Marsha).

## 9. Scheduled tasks (account-level; read any with get_trigger)
Bound to the old chat, so they still fire there until moved: stories post 10:00 (trig_01U438wKNivBKcS9NQNRT1GX), nightly stories (trig_01PJBsWxbGeUkGaHtYYdGFPL), daily reel (trig_01Mrk9TjsqqH9XvmATtgs5xM), secretary reminder 17:12 (trig_01VuoDgi3Ht9VAFR8JGeTZww), secretary meeting 17:25 (trig_01Dcb95CXbyop4EQzLAxa6Ao), Hamdan daily (trig_01Epoj3D93tq19tX5aL4XPjj), Thursday (trig_01JqWVyfA6Btmh1hk6ia4MkE), monthly (trig_01QfBKiPQJjFpFYyU7iCJn3x), December budget (trig_01QqEymKyb9K7prs2XtGxoLP), Sultan Meta check (trig_01Ntg3NKHcRkURg1VcWj5yuU), Sultan gap audit Wed (trig_0175tzabs7gp4sWfMkvn5dmx), 11 Dec Meta follow-up (trig_017Xkuz8kdsY5edRbVQtDzqE), Hessa (trig_014b2KLr2GLCMDufs1PScjAB), Khalifa Thu (trig_0119f8AXfwzjTSMZH73RRjP2), Nouf 3rd (trig_01BvApyB3tEQ6jc1RUnfPLj1), Matar Mon (trig_01Ku6vHpxyCBnjzgTxfsBbyy), Dhiab daily (trig_01AQzB5sP5yCHHCvx6WYUehh), Majid daily (trig_011qfC8GDwU16Vu3hFydjGUG), Maitha Sat (trig_01Y25P2K7pL5x6UEvYzU1Scb), Mermaid reel tonight (trig_01JGXYqM8vLp4V9Mshq8p9f5). Fresh-session tasks (not bound): mthakarti reels 16:28 and 20:57; kafu-wa-nus weekly (another chat).
To move one: get_trigger → create_trigger with the same name/prompt/schedule in the new chat → update_trigger enabled=false on the old one. Never delete before the new one exists.

## 10. Chat history
Text archive of the old chat since 21 Nov: `raw/archive/main_chat_2026-11.md`. Earlier history (August → 20 Nov) only exists as the repo docs, skills, commits and CHANGELOG; the old container no longer had it.

## 11. Never
Type passwords or card numbers · print or commit keys · upload passports/IDs/licence · message customers without the owner's yes · merge/deploy without «موافقة» · change ad numbers away from 0777 · use «خلفية» (say «ستاند بالون رئيسي فخم») · show cakes (only cake stands) · count stands · let the clown talk · change a booking's theme (Mickey stays Mickey).
