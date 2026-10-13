---
name: write-guide
description: Writes or updates a connector's setup guide in the Três Pinos repository, following docs/GUIDE.md, with its GIFs. Use when asked to document how to set up a connector, or to add a new connector's README.
---

# Write a connector guide

The guide is `connectors/<connector>/README.md`, in Portuguese, with the sections of `docs/GUIDE.md`, in order.

1. Read `docs/GUIDE.md` and the connector's code: `src/server.mjs` for the settings, `src/tools.mjs` for the tools
   and `src/guard.mjs` for what it refuses.
2. Write each section from what the code does. Never guess a menu name, a setting or a behavior; if you can't find
   it, write `<!-- TODO: ... -->` and say so.
3. If the connector has a sign-in page (its `server.mjs` passes `PUBLIC_URL` to `serve()`), record it:

   ```bash
   node .agents/skills/write-guide/scripts/record-sign-in.mjs <connector> connectors/<connector>/entrar.gif
   ```

   It runs the real connector with fictional data and needs Playwright with Chromium, and ffmpeg.

4. For the service's own screens, such as a bank's, ask the owner to log in, then go through the steps in their
   browser and take a screenshot of each screen. Write the steps from the screenshots, and join them into a GIF:

   ```bash
   sh .agents/skills/write-guide/scripts/screens-to-gif.sh connectors/<connector>/<step>.gif <screen.png>...
   ```

   The owner types every password and code. Stop and ask before anything that creates, accepts or downloads, and
   never capture or repeat a key, secret, balance, CNPJ, account number or name.

5. Look at every frame of every GIF before using it. Run `bun run check` and the connector's tests.
