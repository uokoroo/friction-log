# Friction Log

Personal logger for Stage 2 of the HCI research plan: record moments where interacting with a computer felt slow, laborious or awkward, from the laptop and the iPhone, and see the proportions at the end.

Personal use only. Work friction is not logged.

## What it does

- `/`: the logging form. Note, friction type (channel / abstraction / context), optional setting and step count. Device is detected automatically.
- `/summary`: counts by type, device and setting, average steps by type, recent entries, CSV export.
- Entries are queued in the browser and synced in batches, so logging works offline. Retries are safe: each entry has a client-generated ID.
- All data endpoints need the access key (`LOG_TOKEN`). Each device asks for it once.

## Deploy

The D1 database `friction-log` already exists (ID in `wrangler.toml`) with the schema applied.

1. In Cloudflare: Workers & Pages > Create > Import a repository > `uokoroo/friction-log`. Deploy command: `npx wrangler deploy`.
2. Set the secret: Worker > Settings > Variables and Secrets > add `LOG_TOKEN` (type Secret). Use a long random string, e.g. the output of `openssl rand -hex 24`.
3. Open the `*.workers.dev` URL, enter the key, and log a test entry.

Optional: protect the whole site with Cloudflare Access (Zero Trust > Access > Applications) for a second layer.

## iPhone

1. Open the URL in Safari, enter the key.
2. Share > Add to Home Screen. It opens full-screen like an app and works offline.
3. Optional one-tap logging: Settings > Accessibility > Touch > Back Tap > Double Tap, pick a Shortcut that opens the URL (Shortcuts app > New > Open URLs).

The home-screen app has its own storage, separate from Safari, so it asks for the key once more on first launch.

## Laptop

Open the form with a global hotkey:

- **Mac:** Raycast or Alfred quicklink to the URL with a hotkey, or Shortcuts app > New > Open URLs, then Shortcut Details > Add Keyboard Shortcut.
- **Windows:** create a desktop shortcut to the URL, then Properties > Shortcut key.

In the form: `Alt+1/2/3` picks the type, `Ctrl/⌘+Enter` saves.

## Local development

```
npm install
echo 'LOG_TOKEN=dev-key' > .dev.vars
npm run migrate:local
npm run dev
```
