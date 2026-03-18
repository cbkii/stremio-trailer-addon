const { getRouter } = require('stremio-addon-sdk');

// Prefer Read Access Token (bearer) over legacy API key.
// Set TMDB_READ_ACCESS_TOKEN in Vercel env vars for the recommended auth method,
// or fall back to TMDB_API_KEY (v3 key appended as a query param).
const TMDB_BEARER_TOKEN = process.env.TMDB_READ_ACCESS_TOKEN || '';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

// Build a TMDB API URL.  When using bearer auth the api_key param is omitted.
function tmdbUrl(path) {
    const base = `https://api.themoviedb.org/3${path}`;
    if (TMDB_BEARER_TOKEN) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}api_key=${TMDB_API_KEY}`;
}

// Fetch wrapper that injects the correct TMDB auth header and an abort signal.
// Callers must verify that at least one auth credential is configured before
// calling this function (see the hasAuth guards in getTMDBInfo / getTMDBTrailer).
function tmdbFetch(path, signal) {
    const headers = { Accept: 'application/json' };
    if (TMDB_BEARER_TOKEN) headers['Authorization'] = `Bearer ${TMDB_BEARER_TOKEN}`;
    return fetch(tmdbUrl(path), { headers, signal });
}

// Language preference: comma-separated ISO 639-1 language codes in priority order.
// The FIRST code listed has the highest priority — when multiple preferred languages
// are available, the one listed earliest is always returned first. English is the default.
// Examples:
//   'en'  - English        'es'  - Spanish       'pt'  - Portuguese
//   'fr'  - French         'it'  - Italian        'nl'  - Dutch
//   'de'  - German         'id'  - Indonesian     'hi'  - Hindi
//   'zh'  - Chinese        'ko'  - Korean         'ja'  - Japanese
//   'no'  - Norwegian      'sv'  - Swedish
const LANGUAGE_PREF = (() => {
    const parsed = (process.env.LANGUAGE_PREF || 'en')
        .split(',')
        .map(code => code.trim().toLowerCase())
        .filter(Boolean);
    return parsed.length > 0 ? parsed : ['en'];
})();

// Language strictness: set to 1 (or any truthy value) to only return results
// that match LANGUAGE_PREF. When disabled (0 / falsy, the default), preferred
// languages are prioritised but a "next best" result in any language is still
// returned when no preferred-language match is found.
const LANGUAGE_STRICT = ['1', 'true', 'yes'].includes(
    (process.env.LANGUAGE_STRICT || '').toLowerCase()
);

const manifest = {
    id: 'com.trailers.youtube.addon',
    version: '1.1.1',
    name: 'YouTube Trailers',
    description: 'Direct link YouTube trailers and teasers (with fallbacks)',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    background: 'https://www.gstatic.com/marketing-cms/assets/images/99/75/ba9b20c04dc2b37c7165e70ba215/external-icon-core-2.png%3Dn-w908-h511-fcrop64%3D1%2C00000000ffffffff-rw',
    logo: 'https://developers.google.com/static/youtube/images/developed-with-youtube-sentence-case-light.png',
};

// ---- Shared stream helpers ----

// notWebReady is intentionally omitted: externalUrl hands off to the OS/app and
// is valid in web contexts too.  bingeGroup ensures consistent trailer-stream
// selection when binge-watching a series.
const STREAM_HINTS = { bingeGroup: 'trailer' };

function ytWatchUrl(key) {
    return `https://www.youtube.com/watch?v=${key}`;
}

function ytSearchUrl(query) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

// Build a stream object per the Stremio stream schema.
// `description` is the current field name; the old `title` field is deprecated.
function makeStream(name, description, externalUrl) {
    return { name, description, externalUrl, behaviorHints: STREAM_HINTS };
}

function extractYear(dateString) {
    if (typeof dateString !== 'string') return null;
    const m = dateString.match(/^(\d{4})/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    if (year < 1888 || year > 9999) return null;
    return m[1];
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function firstHeaderValue(value) {
    if (typeof value !== 'string') return '';
    return value.split(',')[0].trim();
}

function getBaseUrls(req) {
    const protoHeader = firstHeaderValue(req.headers['x-forwarded-proto']);
    const hostHeader = firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host);
    const proto = protoHeader || (req.socket && req.socket.encrypted ? 'https' : 'http');
    const host = hostHeader || 'localhost';
    return {
        manifestUrl: `${proto}://${host}/manifest.json`,
        installUrl: `stremio://${host}/manifest.json`,
    };
}

function getStatusPayload(req) {
    const { manifestUrl, installUrl } = getBaseUrls(req);
    const manifestAvailable = Boolean(manifest && manifest.id && manifest.name);
    const tmdbConfigured = Boolean(TMDB_BEARER_TOKEN || TMDB_API_KEY);

    let status = 'misconfigured';
    if (manifestAvailable && tmdbConfigured) status = 'online';
    else if (manifestAvailable) status = 'degraded';

    return {
        ok: status === 'online',
        status,
        manifestUrl,
        installUrl,
        manifestAvailable,
        tmdbConfigured,
        version: manifestAvailable ? manifest.version : null,
        name: manifestAvailable ? manifest.name : 'Stremio Add-on',
    };
}

function renderStatusPill(label, tone) {
    return `<span class="pill ${tone}">${escapeHtml(label)}</span>`;
}

function renderLandingPage(req) {
    const status = getStatusPayload(req);
    const appLabel = status.status === 'online' ? 'App: Online' : status.status === 'degraded' ? 'App: Degraded' : 'App: Misconfigured';
    const appTone = status.status === 'online' ? 'ok' : status.status === 'degraded' ? 'warn' : 'bad';
    const manifestLabel = `Manifest: ${status.manifestAvailable ? 'Available' : 'Unavailable'}`;
    const manifestTone = status.manifestAvailable ? 'ok' : 'bad';
    const tmdbLabel = `Trailer source: ${status.tmdbConfigured ? 'Configured' : 'Not configured'}`;
    const tmdbTone = status.tmdbConfigured ? 'ok' : 'warn';
    const versionText = status.version ? `Version ${escapeHtml(status.version)}` : 'Version unavailable';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(status.name)} · Stremio Add-on</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0b0c10;color:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5}
main{width:min(760px,100%)}
.card{background:#11131a;border:1px solid #252a37;border-radius:20px;padding:28px;box-shadow:0 10px 35px rgba(0,0,0,.35),0 0 0 1px rgba(125,145,255,.06) inset}
h1{margin:0 0 8px;font-size:clamp(1.8rem,4.5vw,2.5rem);line-height:1.1}
p{margin:0;color:#c7cfdb;font-size:clamp(1rem,2.2vw,1.15rem)}
.status{margin:22px 0;display:flex;flex-wrap:wrap;gap:10px}
.pill{display:inline-flex;align-items:center;padding:.45rem .8rem;border-radius:999px;font-size:.95rem;font-weight:600;border:1px solid transparent}
.pill.ok{background:#102617;color:#9ff0b5;border-color:#244733}
.pill.warn{background:#2b2210;color:#ffd48a;border-color:#5a4521}
.pill.bad{background:#2a1316;color:#ffb3b8;border-color:#5d232a}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}
.btn{display:inline-block;padding:.82rem 1.15rem;border-radius:12px;font-weight:700;text-decoration:none;text-align:center;min-width:190px}
.btn.primary{background:#5066ff;color:#fff;border:1px solid #6174ff}
.btn.secondary{background:#171b25;color:#e3e8f3;border:1px solid #2c3447}
.btn:focus-visible{outline:2px solid #8ea1ff;outline-offset:2px}
.note{margin-top:14px;font-size:.95rem;color:#9aa5bb}
footer{margin-top:18px;font-size:.9rem;color:#8b95aa}
@media (min-width:1200px){.card{padding:34px}.btn{padding:.95rem 1.25rem;font-size:1.05rem}}
</style>
</head>
<body>
<main>
  <article class="card" aria-label="Add-on status and install">
    <h1>${escapeHtml(status.name)}</h1>
    <p>Watch movie and series trailers quickly in Stremio with one tap.</p>
    <div class="status" aria-label="Current service status">
      ${renderStatusPill(appLabel, appTone)}
      ${renderStatusPill(manifestLabel, manifestTone)}
      ${renderStatusPill(tmdbLabel, tmdbTone)}
    </div>
    <div class="actions">
      <a class="btn primary" href="${escapeHtml(status.installUrl)}">Install in Stremio</a>
      <a class="btn secondary" href="${escapeHtml(status.manifestUrl)}">Open manifest</a>
    </div>
    <p class="note">If the app is not installed yet, use the install button first.</p>
    <footer>Works with Stremio using the manifest link above · ${versionText}</footer>
  </article>
</main>
</body>
</html>`;
}

// Per-request timeout (ms).  Two sequential TMDB calls × 4 s each = 8 s worst
// case, safely within the Vercel Hobby 10 s function limit.
const TMDB_TIMEOUT_MS = 4000;

async function getTMDBInfo(imdbId, type) {
    const hasAuth = TMDB_BEARER_TOKEN || TMDB_API_KEY;
    if (!hasAuth) return null;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TMDB_TIMEOUT_MS);
    try {
        const response = await tmdbFetch(
            `/find/${imdbId}?external_source=imdb_id`,
            ac.signal
        );
        const data = await response.json();

        if (type === 'movie' && data.movie_results && data.movie_results.length > 0) {
            const movie = data.movie_results[0];
            return { id: movie.id, name: movie.title, type: 'movie', year: extractYear(movie.release_date) };
        } else if (type === 'series' && data.tv_results && data.tv_results.length > 0) {
            const series = data.tv_results[0];
            return { id: series.id, name: series.name, type: 'tv', year: extractYear(series.first_air_date) };
        }

        return null;
    } catch (error) {
        console.error('Error getting TMDB info:', error);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function getTMDBTrailer(tmdbId, mediaType) {
    const hasAuth = TMDB_BEARER_TOKEN || TMDB_API_KEY;
    if (!hasAuth) return null;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TMDB_TIMEOUT_MS);
    try {
        const response = await tmdbFetch(`/${mediaType}/${tmdbId}/videos`, ac.signal);
        const data = await response.json();

        const results = data.results || [];

        // Returns the first result matching predicate, honoring LANGUAGE_PREF order:
        // iterates preferred languages in declared order so the highest-priority
        // language always wins, regardless of the order TMDB returns results.
        const findPreferred = predicate => {
            for (const lang of LANGUAGE_PREF) {
                const match = results.find(v => predicate(v) && v.iso_639_1 === lang);
                if (match) return match;
            }
            return undefined;
        };

        // Returns the best match for predicate: preferred-language first,
        // then any-language fallback (unless LANGUAGE_STRICT is enabled).
        const pickVideo = predicate =>
            findPreferred(predicate) || (!LANGUAGE_STRICT ? results.find(predicate) : undefined);

        const isYT = v => v.site === 'YouTube';
        const isTrailer = v => v.type === 'Trailer' && isYT(v);
        const isTeaser = v => v.type === 'Teaser' && isYT(v);

        // Priority: Trailer → Teaser → any YouTube video; preferred language first at each step.
        const found = pickVideo(isTrailer) || pickVideo(isTeaser) || pickVideo(isYT);
        return found ? ytWatchUrl(found.key) : null;
    } catch (error) {
        console.error('Error getting TMDB trailer:', error);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function buildFallbackSearchStreams(name, year) {
    const displayName = year ? `${name} ${year}` : name;
    const query = year ? `${name} ${year} trailer|teaser` : `${name} trailer|teaser`;
    return [
        makeStream(
            '🔍 Search Trailer',
            `Find ${displayName} trailer on YouTube. (Official link not found)`,
            ytSearchUrl(query)
        ),
    ];
}

const addonInterface = {
    manifest,
    get: async (resource, type, id) => {
        if (resource === 'stream') {
            const imdbId = id.split(':')[0];

            try {
                const tmdbInfo = await getTMDBInfo(imdbId, type);

                if (!tmdbInfo) {
                    return {
                        streams: [makeStream(
                            '🔍 Search Trailer',
                            `Find ${imdbId} trailer on YouTube. (Official link not found)`,
                            ytSearchUrl(`${imdbId} trailer|teaser`)
                        )]
                    };
                }

                const trailerUrl = await getTMDBTrailer(tmdbInfo.id, tmdbInfo.type);

                if (trailerUrl) {
                    return {
                        streams: [makeStream('▶️ Watch Trailer', `${tmdbInfo.name} 🎬 Trailer`, trailerUrl)]
                    };
                } else {
                    return { streams: buildFallbackSearchStreams(tmdbInfo.name, tmdbInfo.year) };
                }
            } catch (error) {
                console.error('Error:', error);
                return { streams: [] };
            }
        }
        return { streams: [] };
    }
};

const router = getRouter(addonInterface);

module.exports = (req, res) => {
    const path = req.url ? req.url.split('?')[0] : '/';

    if (path === '/') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(renderLandingPage(req));
        return;
    }

    if (path === '/healthz') {
        const payload = getStatusPayload(req);
        res.statusCode = payload.ok ? 200 : 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
        return;
    }

    router(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};