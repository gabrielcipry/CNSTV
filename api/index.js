const axios = require('axios');
const manifest = require('../manifest.json');

const API_BASE = 'https://reidosembeds.lat/api';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://reidosembeds.lat/',
  'Origin': 'https://reidosembeds.lat'
};

const CATEGORY_MAP = {
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
  'cat_a-fazenda': 'A Fazenda',
  'cat_gospel': 'Gospel',
  'cat_ingles': 'Inglês',
  'cat_internacionais': 'Internacionais',
  'cat_miamitv': 'MiamiTV',
  'cat_adulto': 'Adulto'
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
        id: `rde_grp_${groupKey}`,
        rootName: rootName || ch.name,
        category: ch.category,
        logo_url: ch.logo_url,
        preview_url: ch.preview_url,
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Pega a URL bruta da requisição na Vercel
  const reqUrl = req.headers['x-now-route-matches'] || req.headers['x-matched-path'] || req.url;
  const rawPath = reqUrl.split('?')[0];

  // 1. MANIFESTO
  if (rawPath === '/' || rawPath.endsWith('/manifest.json')) {
    return res.json(manifest);
  }

  // 2. CATÁLOGOS
  if (rawPath.includes('/catalog/tv/')) {
    const afterCatalog = rawPath.substring(rawPath.indexOf('/catalog/tv/') + '/catalog/tv/'.length);
    const cleanSegment = afterCatalog.replace('.json', '');
    const parts = cleanSegment.split('/');
    const catalogId = parts[0];

    // --- ABA DE ESPORTES ---
    if (catalogId === 'cat_esportes') {
      try {
        const resp = await axios.get(`${API_BASE}/eventos`, { headers: HEADERS, timeout: 6000 });
        let events = resp.data?.data || [];

        events.sort((a, b) => {
          if (a.status === 'live' && b.status !== 'live') return -1;
          if (b.status === 'live' && a.status !== 'live') return 1;
          return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
        });

        const metas = events.map(ev => {
          const isLive = ev.status === 'live';
          const time = ev.start_time ? ev.start_time.substring(11, 16) : '';
          return {
            id: `rde_ev_${ev.id || ev.slug}`,
            type: 'tv',
            name: isLive ? `🔴 AO VIVO: ${ev.title}` : `⏳ [${time}] ${ev.title}`,
            poster: ev.poster || ev.time1 || manifest.logo,
            posterShape: 'landscape',
            background: ev.poster,
            description: `${ev.competition || ev.category} • Início: ${ev.start_time}\n${ev.description || ''}`,
            genres: [ev.category || 'Esportes']
          };
        });

        return res.json({ metas });
      } catch (err) {
        return res.json({ metas: [] });
      }
    }

    // --- DEMAIS CATEGORIAS DE CANAIS ---
    try {
      let endpoint = `${API_BASE}/channels`;
      if (CATEGORY_MAP[catalogId]) {
        endpoint = `${API_BASE}/channels?category=${encodeURIComponent(CATEGORY_MAP[catalogId])}`;
      }

      const resp = await axios.get(endpoint, { headers: HEADERS, timeout: 6000 });
      let channels = resp.data?.data || [];
      let grouped = processChannels(channels);

      if (catalogId === 'cat_aovivo') {
        grouped = grouped.filter(g => g.is_active === true);
      }

      grouped.sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0));

      const metas = grouped.map(g => ({
        id: g.id,
        type: 'tv',
        name: g.is_active ? `🔴 ${g.rootName}` : g.rootName,
        poster: g.logo_url || manifest.logo,
        posterShape: 'landscape',
        background: g.preview_url || g.logo_url,
        description: g.subChannels.length > 1
          ? `${g.subChannels.length} Sinais disponíveis • ${g.now_playing_title || g.category || ''}`
          : (g.now_playing_title || g.category || ''),
        genres: [g.category || 'Variedades']
      }));

      return res.json({ metas });
    } catch (err) {
      return res.json({ metas: [] });
    }
  }

  // 3. METADADOS
  if (rawPath.includes('/meta/tv/')) {
    const afterMeta = rawPath.substring(rawPath.indexOf('/meta/tv/') + '/meta/tv/'.length);
    const id = afterMeta.replace('.json', '');

    if (id.startsWith('rde_ev_')) {
      const slug = id.replace('rde_ev_', '');
      try {
        const resp = await axios.get(`${API_BASE}/eventos/${slug}`, { headers: HEADERS });
        const ev = resp.data?.data?.[0] || resp.data?.data;
        return res.json({
          meta: {
            id,
            type: 'tv',
            name: ev.title,
            poster: ev.poster || ev.time1,
            posterShape: 'landscape',
            background: ev.poster,
            description: `🏆 ${ev.competition || ''}\n⏰ Início: ${ev.start_time}\n\n${ev.description || ''}`
          }
        });
      } catch (err) {
        return res.status(500).json({ meta: null });
      }
    }

    if (id.startsWith('rde_grp_')) {
      try {
        const resp = await axios.get(`${API_BASE}/channels`, { headers: HEADERS });
        const grouped = processChannels(resp.data?.data || []);
        const target = grouped.find(g => g.id === id);

        if (target) {
          const signals = target.subChannels.map(s => `• ${s.name}`).join('\n');
          return res.json({
            meta: {
              id,
              type: 'tv',
              name: target.rootName,
              poster: target.logo_url,
              posterShape: 'landscape',
              background: target.preview_url || target.logo_url,
              description: `Sinais disponíveis:\n${signals}\n\nPrograma atual: ${target.now_playing_title || 'Transmissão Ao Vivo'}`
            }
          });
        }
      } catch (err) {
        return res.status(500).json({ meta: null });
      }
    }
  }

  // 4. STREAMS
  if (rawPath.includes('/stream/tv/')) {
    const afterStream = rawPath.substring(rawPath.indexOf('/stream/tv/') + '/stream/tv/'.length);
    const id = afterStream.replace('.json', '');
    const streams = [];

    if (id.startsWith('rde_ev_')) {
      const slug = id.replace('rde_ev_', '');
      try {
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
        return res.json({ streams });
      } catch (err) {
        return res.json({ streams: [] });
      }
    }

    if (id.startsWith('rde_grp_')) {
      try {
        const resp = await axios.get(`${API_BASE}/channels`, { headers: HEADERS });
        const grouped = processChannels(resp.data?.data || []);
        const target = grouped.find(g => g.id === id);

        if (target && target.subChannels) {
          target.subChannels.forEach(ch => {
            streams.push({
              title: ch.name,
              url: ch.embed_url
            });
          });
        }
        return res.json({ streams });
      } catch (err) {
        return res.json({ streams: [] });
      }
    }
  }

  res.status(404).send('Not Found');
};
