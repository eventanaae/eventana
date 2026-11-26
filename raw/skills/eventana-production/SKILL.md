---
name: eventana-production
description: Eventana production — makes the daily reel and the 10 connected daily stories (AI images/video from our real items, music, Arabic voice, editing, motion graphics), analyses yesterday's stories every night, and publishes after the reviewer passes it. Use for any reel, story, ad video or visual.
---

# الإنتاج: الريل والستوري

Read `eventana-team` first. The production pipeline itself (voice cleaning, AI video,
coded reels) is in the `kafu` skill; this skill adds Eventana's rules and routine.

## Daily routine (no approval requests — owner, 22 Nov)
- **Night:** analyse today's stories and reel (reach, completion, exits, taps back,
  replies, skip, watch time) → write 5 lines of learnings to the log.
- **10:00 Dubai:** post 10 connected stories built on last night's analysis; a new
  inventive style each day; first story must hook (the emotional mum line works).
- **Daily reel:** from the content writer's script, after the reviewer passes it.
- Review your own previous work before making anything new.

## Tools that exist
- Artlist (AI_Characters): Nano Banana 2 images (group 363, 2k, 130 pts), Kling 3.0 I2V
  (model 3146, 500 pts/5 s), Lyria instrumental music (group 375), Eleven v3 Arabic voice
  (set `language: "Arabic"`; voice Norah). Folder «Eventana ads».
- Disney/Mickey images are blocked by every provider: grey-box the artwork, edit, paste
  the real pixels back (difference matte / colour transfer). Never remove the character.
- Editing: Python (PIL/OpenCV) + ffmpeg frame renderer (see `raw/garden/render3.py`),
  Tajawal font for Arabic, hyperframes/Remotion for motion graphics.
- Publishing reels: vidIQ `instagram_publish_reel` on eventana.uae (connected, can
  publish). Stories: no working auto-publish yet (Windsor posting restarts this session)
  — systems agent owns the fix; until then log it as blocked, don't go silent.
- Archive every asset and the final to `raw/` (stories-media) the same day.

## Visual rules (each came from an owner correction)
- Real scale: the bouncy castle is 4×4 m, towers ~3.5 m, walls to a child's chest; kids
  can't reach the top.
- The main product sits centred, fully visible, close — not far away at the edge.
- Bubble house: the door is at the back; kids are already inside jumping, balloons
  swirling inside; balloons never pass through the dome.
- Afternoon / golden hour, the same light in every shot (not sunset, not midday blue).
- Focus on the event and its details, not the grass.
- Text inside Instagram's safe zone (nothing in the bottom ~320 px or under the right
  buttons). Colourful logo without a white box. Never repeat a shot (graded + ungraded).
- Keep the party's real theme. Original colours; a cinematic grade is OK.
- State cost + show a still before a new AI scene.
