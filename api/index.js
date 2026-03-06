const { getRouter } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

const manifest = {
    id: 'com.trailers.youtube.addon',
    version: '1.0.1',
    name: 'YouTube Trailers',
    description: 'Direct links to YouTube trailers - No buffering!',
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

function extractYear(dateString) {
    return dateString ? dateString.split('-')[0] : null;
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

        // Priority 1: Official Trailer in English or Portuguese
        const trailer = results.find(v => 
            v.type === 'Trailer' && 
            v.site === 'YouTube' && 
            (v.iso_639_1 === 'en' || v.iso_639_1 === 'pt')
        );
        if (trailer) return `https://www.youtube.com/watch?v=${trailer.key}`;

        // Priority 2: Any Trailer on YouTube
        const anyTrailer = results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
        if (anyTrailer) return `https://www.youtube.com/watch?v=${anyTrailer.key}`;

        // Priority 3: Teaser in English or Portuguese
        const teaser = results.find(v =>
            v.type === 'Teaser' &&
            v.site === 'YouTube' &&
            (v.iso_639_1 === 'en' || v.iso_639_1 === 'pt')
        );
        if (teaser) return `https://www.youtube.com/watch?v=${teaser.key}`;

        // Priority 4: Any Teaser on YouTube
        const anyTeaser = results.find(v => v.type === 'Teaser' && v.site === 'YouTube');
        if (anyTeaser) return `https://www.youtube.com/watch?v=${anyTeaser.key}`;

        // Priority 5: Any YouTube video (Clip, Featurette, etc.)
        const anyVideo = results.find(v => v.site === 'YouTube');
        if (anyVideo) return `https://www.youtube.com/watch?v=${anyVideo.key}`;
        
        return null;
    } catch (error) {
        console.error('Error getting TMDB trailer:', error);
        return null;
    }
}

function buildFallbackSearchStreams(name, year) {
    const streams = [];

    if (year) {
        const queryWithTrailer = `${name} ${year} trailer`;
        const queryBroad = `${name} (${year})`;
        streams.push({
            name: '🔍 Search Trailer (Title + Year)',
            title: `Search: "${queryWithTrailer}"`,
            externalUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(queryWithTrailer)}`,
            behaviorHints: { notWebReady: true, bingeGroup: 'trailer' }
        });
        streams.push({
            name: '🎬 Search on YouTube',
            title: `Search: "${queryBroad}"`,
            externalUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(queryBroad)}`,
            behaviorHints: { notWebReady: true, bingeGroup: 'trailer' }
        });
    } else {
        const query = `${name} official trailer`;
        streams.push({
            name: '🔍 Search Trailer',
            title: `Search for "${query}"`,
            externalUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
            behaviorHints: { notWebReady: true, bingeGroup: 'trailer' }
        });
    }

    return streams;
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
                        streams: [{
                            name: '🎬 Search Trailer on YouTube',
                            title: 'Search for trailer',
                            externalUrl: `https://www.youtube.com/results?search_query=${imdbId}+official+trailer`,
                            behaviorHints: { 
                                notWebReady: true,
                                bingeGroup: 'trailer'
                            }
                        }]
                    };
                }
                
                const trailerUrl = await getTMDBTrailer(tmdbInfo.id, tmdbInfo.type);
                
                if (trailerUrl) {
                    return {
                        streams: [{
                            name: '▶️ Watch Trailer',
                            title: `${tmdbInfo.name} - Official Trailer`,
                            externalUrl: trailerUrl,
                            behaviorHints: { 
                                notWebReady: true,
                                bingeGroup: 'trailer'
                            }
                        }]
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
