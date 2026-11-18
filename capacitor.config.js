// @ts-check
// The iOS app is a native shell around the live desk on Vercel: same app, same login, same data,
// updated with every deploy. Set CAP_SERVER_URL to your production address (Vercel → Settings → Domains),
// in .env.local for local syncs and in Codemagic's environment for cloud builds.
// (Plain JS on purpose: Capacitor can't load a .ts config with TypeScript 7.)
const { config: loadEnv } = require('dotenv');

loadEnv({ path: ['.env.local', '.env'], quiet: true });
const url = process.env.CAP_SERVER_URL;
if (!url) console.warn('[capacitor] CAP_SERVER_URL is not set — the iOS app will not know where your desk lives.');

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  // Your app's bundle id. Change it to your own reverse-domain id before creating the app in App Store Connect.
  appId: 'com.soldesk.planner',
  appName: 'sol',
  // Shown only if the desk can't be reached (offline on first launch).
  webDir: 'capacitor-www',
  server: {
    url: url || 'https://example.invalid',
    cleartext: false,
    errorPath: 'index.html',
  },
  ios: {
    backgroundColor: '#191919',
    contentInset: 'never',
    scheme: 'sol',
  },
};

module.exports = config;
