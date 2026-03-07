const { getRouter } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

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
    // Certificação Stremio Addons
    stremioAddonsConfig: {
        issuer: 'https://stremio-addons.net',
        signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..pB-EC9zlZduz6a-zU0OxsQ.R_CydhOhJx12LAA6b5K_c7GxYcxMu0e1FlAGC9elpvhCZJPtVMwdsTEnbMXROVZL9FNBERr9Z2kF45wFQN7uLN5fHXV3MmSqGmO2hHnic-oc3vcbzQ0rl2LUmo8uTXM8.1uu_6hsolyXULB6kmaghdQ'
    }
};

// ---- Shared stream helpers ----

const STREAM_HINTS = { notWebReady: true, bingeGroup: 'trailer' };

function ytWatchUrl(key) {
    return `https://www.youtube.com/watch?v=${key}`;
}

function ytSearchUrl(query) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function makeStream(name, title, externalUrl) {
    return { name, title, externalUrl, behaviorHints: STREAM_HINTS };
}

function extractYear(dateString) {
    if (typeof dateString !== 'string') return null;
    const m = dateString.match(/^(\d{4})/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    if (year < 1888 || year > 9999) return null;
    return m[1];
}

async function getTMDBInfo(imdbId, type) {
    if (!TMDB_API_KEY) return null;
    
    try {
        const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
        const response = await fetch(url);
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
    }
}

async function getTMDBTrailer(tmdbId, mediaType) {
    if (!TMDB_API_KEY) return null;
    
    try {
        const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/videos?api_key=${TMDB_API_KEY}`;
        const response = await fetch(url);
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
