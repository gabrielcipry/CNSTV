const axios = require('axios');
const manifest = require('../manifest.json');

const API_BASE = 'https://reidosembeds.lat/api';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://reidosembeds.lat/',
  'Origin': 'https://reidosembeds.lat'
};

function cleanChannelName(rawName) {
  if (!rawName) return '';
  return rawName
    .replace(/\s+(?:\d+|[IVXLCDM]+)$/i, '')
    .replace(/\s+\(?(?:feed|sinal|alt|backup|opção|\d+)\)?$/i, '')
    .trim();
}

function slugify(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function processChannels(channels) {
  const groups = new Map();

  channels.forEach(ch => {
    const rootName = cleanChannelName(ch.name);
    const groupKey = slugify(rootName || 'canal');

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        id: `tv_rde_${groupKey}`,
        rootName: rootName || ch.name,
        category: ch.category || 'Geral',
        logo_url: ch.logo_url || manifest.logo,
        preview_url: ch.preview_url || ch.logo_url || manifest.background,
        is_active: ch.is_active || false,
        now_playing_title: ch.now_playing_title || '',
        subChannels: []
      });
    }

    const grp = groups.get(groupKey);
    if (ch.is_active) grp.is_active = true;
    grp.subChannels.push(ch);
  });

  return Array.from(groups.values());
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawUrl = req.url.split('?')[0];

  // 1. MANIFEST
  if (rawUrl === '/' || rawUrl.endsWith('/manifest.json')) {
    return res.end(JSON.stringify(manifest));
  }

  // 2. CATALOG (/catalog/:type/:id/:extra?.json)
  if (rawUrl.includes('/catalog/')) {
    const match = rawUrl.match(/\/catalog\/([^/]+)\/([^/.]+)(?:\/(.*))?\.json/);
    const type = match ? match[1] : 'tv';
    const catalogId = match ? match[2] : '';
    const extraStr = match && match[3] ? decodeURIComponent(match[3]) : '';

    const extra = new URLSearchParams(extraStr.replace(/&amp;/g, '&'));
    const selectedGenre = extra.get('genre') || 'Todos';

    // --- CATÁLOGO DE EVENTOS ---
    if (catalogId === 'tv_eventos') {
      try {
        const resp = await axios.get(`${API_BASE}/eventos`, { headers: HEADERS, timeout: 6000 });
        let events = resp.data?.data || [];

        if (selectedGenre !== 'Todos') {
          events = events.filter(e => (e.category || '').toLowerCase().includes(selectedGenre.toLowerCase()));
        }

        events.sort((a, b) => {
          if (a.status === 'live' && b.status !== 'live') return -1;
          if (b.status === 'live' && a.status !== 'live') return 1;
          return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
        });

        const metas = events.map(ev => ({
          id: `tv_ev_${ev.slug || ev.id}`,
          type: 'tv',
          name: ev.status === 'live' ? `🔴 AO VIVO: ${ev.title}` : `⏳ ${ev.title}`,
          poster: ev.poster || ev.time1 || manifest.logo,
          posterShape: 'square',
          background: ev.poster || manifest.background,
          description: `Competição: ${ev.competition || 'Ao Vivo'}\nInício: ${ev.start_time || ''}`,
          genres: [ev.category || 'Esportes']
        }));

        return res.end(JSON.stringify({ metas }));
      } catch (err) {
        return res.end(JSON.stringify({ metas: [] }));
      }
    }

    // --- CATÁLOGO DE CANAIS ---
    if (catalogId === 'tv_canais') {
      try {
        const resp = await axios.get(`${API_BASE}/channels`, { headers: HEADERS, timeout: 6000 });
        let channels = resp.data?.data || [];
        let grouped = processChannels(channels);

        if (selectedGenre === 'Ao Vivo Agora') {
          grouped = grouped.filter(g => g.is_active);
        } else if (selectedGenre !== 'Todos') {
          grouped = grouped.filter(g => (g.category || '').toLowerCase().includes(selectedGenre.toLowerCase()));
        }

        grouped.sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0));

        const metas = grouped.map(g => ({
          id: g.id,
          type: 'tv',
          name: g.is_active ? `🔴 ${g.rootName}` : g.rootName,
          poster: g.logo_url,
          posterShape: 'square',
          background: g.preview_url,
          description: g.subChannels.length > 1
            ? `${g.subChannels.length} Sinais disponíveis • ${g.now_playing_title || g.category}`
            : (g.now_playing_title || g.category),
          genres: [g.category]
        }));

        return res.end(JSON.stringify({ metas }));
      } catch (err) {
        return res.end(JSON.stringify({ metas: [] }));
      }
    }

    return res.end(JSON.stringify({ metas: [] }));
  }

  // 3. META
  if (rawUrl.includes('/meta/')) {
    const match = rawUrl.match(/\/meta\/([^/]+)\/([^/.]+)\.json/);
    const metaId = match ? match[2] : '';

    try {
      if (metaId.startsWith('tv_rde_')) {
        const resp = await axios.get(`${API_BASE}/channels`, { headers: HEADERS });
        const grouped = processChannels(resp.data?.data || []);
        const item = grouped.find(g => g.id === metaId);

        if (item) {
          return res.end(JSON.stringify({
            meta: {
              id: item.id,
              type: 'tv',
              name: item.rootName,
              poster: item.logo_url,
              posterShape: 'square',
              background: item.preview_url,
              description: `Sinais disponíveis:\n${item.subChannels.map(s => `• ${s.name}`).join('\n')}\n\nPrograma atual: ${item.now_playing_title || 'Ao Vivo'}`
            }
          }));
        }
      }

      if (metaId.startsWith('tv_ev_')) {
        const slug = metaId.replace('tv_ev_', '');
        const resp = await axios.get(`${API_BASE}/eventos/${slug}`, { headers: HEADERS });
        const ev = resp.data?.data?.[0] || resp.data?.data;
        if (ev) {
          return res.end(JSON.stringify({
            meta: {
              id: metaId,
              type: 'tv',
              name: ev.title,
              poster: ev.poster || ev.time1 || manifest.logo,
              posterShape: 'square',
              background: ev.poster || manifest.background,
              description: `${ev.competition || ''}\n${ev.description || ''}`
            }
          }));
        }
      }
    } catch (err) {
      return res.end(JSON.stringify({ meta: null }));
    }
  }

  // 4. STREAM
  if (rawUrl.includes('/stream/')) {
    const match = rawUrl.match(/\/stream\/([^/]+)\/([^/.]+)\.json/);
    const streamId = match ? match[2] : '';
    const streams = [];

    try {
      if (streamId.startsWith('tv_rde_')) {
        const resp = await axios.get(`${API_BASE}/channels`, { headers: HEADERS });
        const grouped = processChannels(resp.data?.data || []);
        const item = grouped.find(g => g.id === streamId);

        if (item && item.subChannels) {
          item.subChannels.forEach(ch => {
            streams.push({
              title: ch.name,
              url: ch.embed_url
            });
          });
        }
        return res.end(JSON.stringify({ streams }));
      }

      if (streamId.startsWith('tv_ev_')) {
        const slug = streamId.replace('tv_ev_', '');
        const resp = await axios.get(`${API_BASE}/eventos/${slug}`, { headers: HEADERS });
        const ev = resp.data?.data?.[0] || resp.data?.data;

        if (ev && Array.isArray(ev.embeds)) {
          ev.embeds.forEach(emb => {
            streams.push({
              title: `${emb.provider} (${emb.quality || 'HD'})`,
              url: emb.embed_url
            });
          });
        }
        return res.end(JSON.stringify({ streams }));
      }
    } catch (err) {
      return res.end(JSON.stringify({ streams: [] }));
    }
  }

  res.statusCode = 404;
  return res.end(JSON.stringify({ error: 'Not found' }));
};
