# Friction Log

Personal logger for Stage 2 of the HCI research plan: record moments where interacting with a computer felt slow, laborious or awkward, from the laptop and the iPhone, and see the proportions at the end.

Personal use only. Work friction is not logged.

## What it does

- **Voice first.** Say one sentence about what you were trying to do. The Worker classifies it (channel / abstraction / context, plus setting and step count if you mention them) and logs it.
  - iPhone: a Siri Shortcut dictates on-device and sends only the text.
  - Laptop: the mic button on the form records audio; the Worker transcribes it with Whisper.
- **Typing still works.** The form has the manual fields, and typed entries queue offline and sync later. Voice needs a connection.
- `/summary`: counts by type, device and setting, average steps, recent entries, CSV export. Voice entries classified by the model are flagged: confirm with ✓ or pick the right type. Corrected entries count as yours.
- All data endpoints need the access key (`LOG_TOKEN`). Each device asks for it once.

Models (Cloudflare Workers AI): `@cf/openai/whisper-large-v3-turbo` for transcription, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for classification. If classification fails, the entry is saved as `unclassified` for you to review.

## Deploy

The D1 database `friction-log` already exists (ID in `wrangler.toml`) with the current schema applied. Don't run `migrate:remote` against it.

1. In Cloudflare: Workers & Pages > Create > Import a repository > `uokoroo/friction-log`. Deploy command: `npx wrangler deploy`. The Workers AI binding is declared in `wrangler.toml`.
2. Set the secret: Worker > Settings > Variables and Secrets > add `LOG_TOKEN` (type Secret). Use a long random string, e.g. the output of `openssl rand -hex 24`.
3. Open the `*.workers.dev` URL, enter the key, and log a test entry by voice and by typing.

Optional: protect the whole site with Cloudflare Access (Zero Trust > Access > Applications) for a second layer. If you do, the iOS Shortcut will need an Access service token as well.

## iPhone: voice Shortcut

Create a shortcut in the Shortcuts app named **Friction**:

1. **Dictate Text.** Stop Listening: After Pause. Language: English (UK).
2. **Get Contents of URL.**
   - URL: `https://<your-worker>.workers.dev/api/voice`
   - Method: POST
   - Headers: `Authorization` = `Bearer <your LOG_TOKEN>`
   - Request Body: JSON, with `text` = *Dictated Text* and `device` = `iphone`
3. **Get Dictionary Value** for key `message` in *Contents of URL*.
4. **Show Notification** with *Dictionary Value*.

Ways to trigger it without opening anything:

- "Hey Siri, Friction".
- Action Button (iPhone 15 Pro and later): Settings > Action Button > Shortcut > Friction.
- Back Tap: Settings > Accessibility > Touch > Back Tap > Double Tap > Friction.
- Control Centre or Lock Screen: add a Shortcut control and pick Friction.

You get a notification such as "Logged as abstraction, sofa, 7 steps."

The web app also works on the phone: open the URL in Safari, enter the key, Share > Add to Home Screen. The home-screen app has its own storage, so it asks for the key once more.

## Laptop

Bind a global hotkey to `https://<your-worker>.workers.dev/?voice=1`. That opens the form and starts listening straight away (after you allow the microphone once). Speak, then press `Space` or click to finish.

- **Mac:** Raycast or Alfred quicklink with a hotkey, or Shortcuts app > New > Open URLs, then Shortcut Details > Add Keyboard Shortcut.
- **Windows:** create a desktop shortcut to the URL, then Properties > Shortcut key.

In the form: `Space` starts and stops voice; when typing, `Alt+1/2/3` picks the type and `Ctrl/⌘+Enter` saves.

## Local development

```
npm install
echo 'LOG_TOKEN=dev-key' > .dev.vars
npm run migrate:local
npm run dev
```

Workers AI calls go to your Cloudflare account even in local development.
