const axios = require('axios');
const manifest = require('../manifest.json');

const API_BASE = 'https://reidosembeds.lat/api';

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://reidosembeds.lat/',
  'Origin': 'https://reidosembeds.lat'
};

const CATEGORIES = {
  'cat_canais-abertos': 'Canais Abertos',
  'cat_globo': 'Globo',
  'cat_noticias': 'Notícias',
  'cat_filmes': 'Filmes',
  'cat_series': 'Séries',
  'cat_variedades': 'Variedades',
  'cat_documentarios': 'Documentários',
  'cat_desenhos': 'Desenhos',
  'cat_infantil': 'Infantil',
  'cat_animes': 'Animes',
  'cat_24-horas': '24 Horas',
  'cat_realitys': 'Realitys',
  'cat_a-fazenda': 'A Fazenda'
};

function normalizeName(name) {
  if (!name) return '';
  return name.replace(/\s+(?:\d+|[IVXLCDM]+)$/i, '').replace(/\s+\(?(?:feed|sinal|alt|backup|opção|\d+)\)?$/i, '').trim();
}

function toSlug(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function groupChannels(rawList) {
  const map = new Map();
  for (const item of rawList) {
    const baseName = normalizeName(item.name);
    const key = toSlug(baseName || 'canal');

    if (!map.has(key)) {
      map.set(key, {
        id: `rde_${key}`,
        name: baseName || item.name,
        category: item.category,
        logo: item.logo_url || manifest.logo,
        preview: item.preview_url || item.logo_url,
        isActive: item.is_active || false,
        program: item.now_playing_title || '',
        sources: []
      });
    }

    const grp = map.get(key);
    if (item.is_active) grp.isActive = true;
    grp.sources.push(item);
  }
  return Array.from(map.values());
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = req.url.split('?')[0];

  // 1. MANIFEST
  if (url === '/' || url === '/manifest.json') {
    return res.end(JSON.stringify(manifest));
  }

  // 2. CATALOG
  if (url.includes('/catalog/')) {
    // Extrai o catalogId da URL ignorando .json e query strings
    const match = url.match(/\/catalog\/tv\/([^/.]+)/);
    const catalogId = match ? match[1] : null;

    if (!catalogId) {
      return res.end(JSON.stringify({ metas: [] }));
    }

    // --- Catálogo de Esportes (Agenda) ---
    if (catalogId === 'cat_esportes') {
      try {
        const resp = await axios.get(`${API_BASE}/eventos`, { headers: HTTP_HEADERS, timeout: 6000 });
        const list = resp.data?.data || [];

        list.sort((a, b) => {
          if (a.status === 'live' && b.status !== 'live') return -1;
          if (b.status === 'live' && a.status !== 'live') return 1;
          return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
        });

        const metas = list.map(ev => ({
          id: `rde_${toSlug(ev.slug || ev.id)}`,
          type: 'tv',
          name: ev.status === 'live' ? `🔴 AO VIVO: ${ev.title}` : `⏳ ${ev.title}`,
          poster: ev.poster || ev.time1 || manifest.logo,
          posterShape: 'landscape',
          background: ev.poster,
          description: `${ev.competition || ''} - Início: ${ev.start_time}\n${ev.description || ''}`,
          genres: ['Esportes']
        }));

        return res.end(JSON.stringify({ metas }));
      } catch (err) {
        return res.end(JSON.stringify({ metas: [] }));
      }
    }

    // --- Catálogo de Canais de TV ---
    try {
      let endpoint = `${API_BASE}/channels`;
      if (CATEGORIES[catalogId]) {
        endpoint = `${API_BASE}/channels?category=${encodeURIComponent(CATEGORIES[catalogId])}`;
      }

      const resp = await axios.get(endpoint, { headers: HTTP_HEADERS, timeout: 6000 });
      let channels = resp.data?.data || [];
      let grouped = groupChannels(channels);

      if (catalogId === 'cat_aovivo') {
        grouped = grouped.filter(c => c.isActive);
      }

      grouped.sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));

      const metas = grouped.map(g => ({
        id: g.id,
        type: 'tv',
        name: g.isActive ? `🔴 ${g.name}` : g.name,
        poster: g.logo,
        posterShape: 'landscape',
        background: g.preview || g.logo,
        description: g.sources.length > 1 
          ? `Disponível em ${g.sources.length} sinais.\nNo ar: ${g.program || 'Ao Vivo'}`
          : (g.program || g.category || 'Canal Ao Vivo'),
        genres: [g.category || 'Variedades']
      }));

      return res.end(JSON.stringify({ metas }));
    } catch (err) {
      return res.end(JSON.stringify({ metas: [] }));
    }
  }

  // 3. META
  if (url.includes('/meta/')) {
    const match = url.match(/\/meta\/tv\/([^/.]+)/);
    const metaId = match ? match[1] : null;

    try {
      const resp = await axios.get(`${API_BASE}/channels`, { headers: HTTP_HEADERS });
      const grouped = groupChannels(resp.data?.data || []);
      const channel = grouped.find(g => g.id === metaId);

      if (channel) {
        return res.end(JSON.stringify({
          meta: {
            id: channel.id,
            type: 'tv',
            name: channel.name,
            poster: channel.logo,
            posterShape: 'landscape',
            background: channel.preview || channel.logo,
            description: `Sinais:\n${channel.sources.map(s => `• ${s.name}`).join('\n')}\n\nPrograma atual: ${channel.program || 'Ao Vivo'}`
          }
        }));
      }

      // Procura em eventos esportivos se não for canal
      const rawSlug = metaId.replace('rde_', '');
      const evResp = await axios.get(`${API_BASE}/eventos/${rawSlug}`, { headers: HTTP_HEADERS });
      const ev = evResp.data?.data?.[0] || evResp.data?.data;
      if (ev) {
        return res.end(JSON.stringify({
          meta: {
            id: metaId,
            type: 'tv',
            name: ev.title,
            poster: ev.poster || ev.time1 || manifest.logo,
            posterShape: 'landscape',
            background: ev.poster,
            description: `${ev.competition || ''}\n${ev.description || ''}`
          }
        }));
      }
    } catch (err) {
      return res.end(JSON.stringify({ meta: null }));
    }
  }

  // 4. STREAM
  if (url.includes('/stream/')) {
    const match = url.match(/\/stream\/tv\/([^/.]+)/);
    const streamId = match ? match[1] : null;
    const streams = [];

    try {
      // Verifica nos canais
      const resp = await axios.get(`${API_BASE}/channels`, { headers: HTTP_HEADERS });
      const grouped = groupChannels(resp.data?.data || []);
      const channel = grouped.find(g => g.id === streamId);

      if (channel) {
        channel.sources.forEach(src => {
          streams.push({
            title: src.name,
            url: src.embed_url
          });
        });
        return res.end(JSON.stringify({ streams }));
      }

      // Verifica nos eventos
      const rawSlug = streamId.replace('rde_', '');
      const evResp = await axios.get(`${API_BASE}/eventos/${rawSlug}`, { headers: HTTP_HEADERS });
      const ev = evResp.data?.data?.[0] || evResp.data?.data;
      if (ev && Array.isArray(ev.embeds)) {
        ev.embeds.forEach(emb => {
          streams.push({
            title: `${emb.provider} (${emb.quality || 'HD'})`,
            url: emb.embed_url
          });
        });
        return res.end(JSON.stringify({ streams }));
      }
    } catch (err) {
      return res.end(JSON.stringify({ streams: [] }));
    }
  }

  return res.status(404).end(JSON.stringify({ error: 'Rota não encontrada' }));
};
