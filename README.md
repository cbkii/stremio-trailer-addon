# 🎬 Stremio YouTube Trailers Add-on

A serverless Stremio add-on that provides **direct links to YouTube trailers** - No more buffering or broken trailer players!

> **Authors:** [cbkii](https://github.com/cbkii) (fork) · Based on original work by [MechanicWB](https://github.com/mechanicwb)

## ✨ Features

- ✅ **Direct YouTube links** - Opens trailers in your browser/YouTube app
- ✅ **No buffering** - Bypasses Stremio's built-in trailer player
- ✅ **Always online** - Deployed on Vercel (serverless)
- ✅ **Free forever** - Uses TMDB's free API
- ✅ **Auto-updating** - Updates automatically via GitHub
- ✅ **Works with movies & series** - Full TMDB integration
- ✅ **Configurable language preference** - Prioritise trailers in your language

## 🚀 Deploy Your Own

### Prerequisites

- GitHub account
- Vercel account (free)
- TMDB API key (free)

### Step 1: Get a TMDB API Key

1. Sign up at [themoviedb.org](https://www.themoviedb.org/)
2. Go to **Settings → API**
3. Request an API Key → choose **"Developer"**
4. Fill out the form (any reasonable details)
5. Copy your **API Key (v3 auth)**

### Step 2: Fork this repository

Click **Fork** at the top of this page to create your own copy.

### Step 3: Deploy to Vercel

1. Sign up / log in at [Vercel](https://vercel.com/) using your GitHub account
2. Click **"Add New… → Project"**
3. Select your forked repository and click **"Import"**
4. **Configure Environment Variables** (see [Configuration](#-configuration) below):
   - `TMDB_API_KEY` — your TMDB API key *(required)*
   - `LANGUAGE_PREF` — preferred language codes *(optional, default: `en`)*
   - `LANGUAGE_STRICT` — language strictness *(optional, default: `0`)*
5. Click **"Deploy"**
6. Your add-on URL will be:
   ```
   https://your-project.vercel.app/manifest.json
   ```
   For example:
   ```
   https://my-stremio-trailer-addon-rust.vercel.app/manifest.json
   # i.e. Vercel "Project Domain" + /manifest.json
   ```

### Step 4: Install in Stremio

1. Open **Stremio**
2. Go to **Add-ons** and click the **puzzle icon** (🧩) in the top right
3. Paste your Vercel URL (ending in `/manifest.json`)
4. Click **Install**

Done! Click any movie or series and you'll see **"▶️ Watch Trailer"**.

## ⚙️ Configuration

All settings are configured via **Vercel Environment Variables** (Settings → Environment Variables).

| Variable | Default | Description |
|---|---|---|
| `TMDB_API_KEY` | *(none)* | **Required.** Your TMDB v3 API key. |
| `LANGUAGE_PREF` | `en` | Comma-separated list of preferred ISO 639-1 language codes, in priority order. |
| `LANGUAGE_STRICT` | `0` | Set to `1` to only return results in the preferred language(s). |

### `LANGUAGE_PREF`

A comma-separated list of [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) language codes listed in priority order. Trailers matching the first code are returned first, then the second, and so on.

**Valid language code examples:**

| Code | Language    | Code | Language   |
|------|-------------|------|------------|
| `en` | English     | `de` | German     |
| `es` | Spanish     | `id` | Indonesian |
| `pt` | Portuguese  | `hi` | Hindi      |
| `fr` | French      | `zh` | Chinese    |
| `it` | Italian     | `ko` | Korean     |
| `nl` | Dutch       | `ja` | Japanese   |
| `no` | Norwegian   | `sv` | Swedish    |

**Examples:**

English only (default):
```
LANGUAGE_PREF=en
```

English first, then Spanish:
```
LANGUAGE_PREF=en,es
```

Portuguese first, then English:
```
LANGUAGE_PREF=pt,en
```

### `LANGUAGE_STRICT`

Controls how strictly the language preference is applied.

| Value | Behaviour |
|-------|-----------|
| `0` *(default)* | **Lenient** – preferred language(s) are prioritised, but a "next best" result in any language is returned when no match is found. |
| `1` | **Strict** – only results in the preferred language(s) are returned; no fallback to other languages. |

After changing any environment variable, go to **Deployments → "…" → Redeploy** to apply the new values.

## 📁 Project Structure

```
├── api/
│   └── index.js          # Serverless function (main logic)
├── vercel.json           # Vercel configuration
├── package.json          # Dependencies
└── README.md             # This file
```

## 🔧 How It Works

1. You click "Watch Trailer" in Stremio
2. The add-on receives the IMDB ID
3. It queries the TMDB API to find the movie/series
4. It fetches available YouTube videos and selects the best trailer according to your language preference
5. Returns a link that opens in your browser/YouTube app

**Key difference:** Uses `externalUrl` instead of `url` to force external opening, preventing the "Video is not supported" error.

## 🐛 Troubleshooting

### "Failed to get addon manifest"
- Check that your URL ends with `/manifest.json`
- Open the URL in a browser — it should return JSON

### "Video is not supported"
- Make sure you are on the latest version
- The add-on uses `externalUrl` which forces external playback

### Trailers not appearing
- Verify `TMDB_API_KEY` is set in Vercel Environment Variables
- Redeploy after adding/changing the API key
- Some titles may not have trailers available on TMDB

### No trailers in my language
- Set `LANGUAGE_PREF` to your preferred language code(s)
- If `LANGUAGE_STRICT=1`, try switching to `0` to allow fallback results

### Add-on not updating
- Uninstall and reinstall in Stremio
- Clear Stremio cache

## 📊 Dependencies

- [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk) - Stremio add-on framework
- [node-fetch](https://github.com/node-fetch/node-fetch) - HTTP requests
- [TMDB API](https://www.themoviedb.org/documentation/api) - Movie/series metadata

## 🆓 Cost

**100% Free:**
- ✅ Vercel hosting (unlimited serverless functions)
- ✅ TMDB API (free tier: 1000+ requests/day)
- ✅ No credit card required

## 🙏 Credits

- **Maintained by:** [cbkii](https://github.com/cbkii)
- **Original author:** [MechanicWB](https://github.com/mechanicwb)
- **Powered by:** [Vercel](https://vercel.com/), [TMDB](https://www.themoviedb.org/)
- **Framework:** [Stremio Add-on SDK](https://github.com/Stremio/stremio-addon-sdk)

## 📝 License

MIT License - Feel free to use, modify, and distribute!

## 🤝 Contributing

Found a bug? Have a feature request?

1. Open an issue
2. Submit a pull request
3. Share on [r/StremioAddons](https://reddit.com/r/StremioAddons)

---

**Made with ❤️ for the Stremio community**

[Report Issue](https://github.com/cbkii/stremio-trailer-addon/issues) • [View on Vercel](https://vercel.com)
