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

        const isYT      = v => v.site === 'YouTube';
        const isTrailer = v => v.type === 'Trailer' && isYT(v);
        const isTeaser  = v => v.type === 'Teaser'  && isYT(v);

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
    router(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};
