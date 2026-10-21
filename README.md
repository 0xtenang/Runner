# RUNNER — run to earn (beta)

A simple, Strava-style running app with a move-to-earn layer: equip a sneaker, run inside its pace zone, and earn **EARN** coins, mystery boxes and new sneakers.

**Try it:** https://0xtenang.github.io/runner/

> Beta: everything is stored on your own phone. EARN coins are in-app points with no cash value.

## Install on your phone

1. Open the link above on your phone.
2. Add it to your home screen:
   - **iPhone (Safari):** Share → *Add to Home Screen*
   - **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*
3. Open RUNNER from the home screen and go through the short setup.

## What to test

1. **Onboarding** — pick a starter sneaker and enter your name.
2. **Record a real outdoor run** — tap Record → Start. Check the GPS line, distance and pace look right (compare with your watch if you have one).
3. **Earning** — while running, the bar should say *Earning*, *Too fast* or *Too slow* for your sneaker's pace zone. Coins appear when you finish.
4. **Import from your watch** — You → Devices → choose files:
   - **Garmin:** Garmin Connect (web) → open a run → ⚙ → *Export Original* (.zip)
   - **COROS / Suunto:** export the run as .fit
   - **Polar:** Polar Flow → *Export session* (.tcx / .gpx)
   - **Apple Watch:** export with HealthFit or RunGap (.fit / .gpx)
5. **Earn tab** — level up, assign attribute points, open mystery boxes, buy from the marketplace, mint a new sneaker.
6. **Indoors?** You → ⚙ Settings → *GPS simulator* fakes a jog so you can try everything at home.

## Known limitations

- **iPhone:** Safari pauses GPS when the screen locks — keep the screen on while running (the app asks it to stay awake).
- **Bluetooth heart-rate sensors** work in Chrome on Android / desktop, not on iPhone.
- Data lives on each device — no accounts, friends or leaderboards yet.
- Only runs recorded live with GPS earn coins; imported runs count for stats and streaks.

## Send feedback

Found a bug or have an idea? [Open an issue](https://github.com/0xtenang/runner/issues/new) — include your phone model, browser and what happened. You can also reach it from **Settings → Send feedback** in the app.

## Run locally

It's a static web app — no build step:

```bash
python3 -m http.server 5190
```

Then open http://localhost:5190. `samples/` contains example FIT / GPX / TCX / ZIP files for testing imports.
