const axios = require('axios');
const manifest = require('../manifest.json');

const API_BASE = 'https://reidosembeds.lat/api';

const HTTP_CLIENT = axios.create({
  baseURL: API_BASE,
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  }
});

// Remove números e sufixos repetidos do final do nome (ex: Apple TV 1 -> Apple TV)
function cleanName(rawName) {
  if (!rawName) return '';
  return rawName
    .replace(/\s+(?:\d+|[IVXLCDM]+)$/i, '')
    .replace(/\s+\(?(?:feed|sinal|alt|backup|opção|\d+)\)?$/i, '')
    .trim();
}

// Cria um ID limpo para o grupo
function slugify(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Agrupa múltiplos sinais (Apple TV 1, 2, 3...) em um único canal
function processChannels(channels) {
  const map = new Map();

  channels.forEach(ch => {
    const rootName = cleanName(ch.name);
    const key = slugify(rootName || 'canal');

    if (!map.has(key)) {
      map.set(key, {
        id: `rde_ch_${key}`,
        rootName: rootName || ch.name,
        category: ch.category || 'Geral',
        logo: ch.logo_url || manifest.logo,
        preview: ch.preview_url || ch.logo_url,
        isActive: Boolean(ch.is_active),
        nowPlaying: ch.now_playing_title || '',
        subChannels: []
      });
    }

    const grp = map.get(key);
    if (ch.is_active) grp.isActive = true;
    grp.subChannels.push(ch);
  });

  return Array.from(map.values());
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Limpa a URL removendo barras finais e extensões
  const rawPath = req.url.split('?')[0];

  // 1. MANIFESTO
  if (rawPath === '/' || rawPath.endsWith('/manifest.json')) {
    return res.end(JSON.stringify(manifest));
  }

  // 2. CATÁLOGO (/catalog/tv/:id.json ou /catalog/tv/:id/...)
  if (rawPath.includes('/catalog/')) {
    const match = rawPath.match(/\/catalog\/tv\/([^/.]+)/);
    const catalogId = match ? match[1] : '';

    // --- Catálogo de Eventos/Esportes ---
    if (catalogId === 'rde_cat_esportes') {
      try {
        const resp = await HTTP_CLIENT.get('/eventos');
        const events = resp.data?.data || [];

        // Ao vivo no topo
        events.sort((a, b) => {
          if (a.status === 'live' && b.status !== 'live') return -1;
          if (b.status === 'live' && a.status !== 'live') return 1;
          return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
        });

        const metas = events.map(ev => ({
          id: `rde_ev_${ev.slug || ev.id}`,
          type: 'tv',
          name: ev.status === 'live' ? `🔴 AO VIVO: ${ev.title}` : `⏳ ${ev.title}`,
          poster: ev.poster || ev.time1 || manifest.logo,
          posterShape: 'landscape',
          background: ev.poster || manifest.logo,
          description: `${ev.competition || 'Esportes'} • Início: ${ev.start_time || ''}\n${ev.description || ''}`,
          genres: [ev.category || 'Esportes']
        }));

        return res.end(JSON.stringify({ metas }));
      } catch (err) {
        return res.end(JSON.stringify({ metas: [] }));
      }
    }

    // --- Catálogos de Canais ---
    try {
      let endpoint = '/channels';
      if (catalogId === 'rde_cat_canais_abertos') endpoint = '/channels?category=Canais%20Abertos';
      if (catalogId === 'rde_cat_globo') endpoint = '/channels?category=Globo';

      const resp = await HTTP_CLIENT.get(endpoint);
      const list = resp.data?.data || [];
      let grouped = processChannels(list);

      if (catalogId === 'rde_cat_aovivo') {
        grouped = grouped.filter(g => g.isActive);
      }

      grouped.sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));

      const metas = grouped.map(g => ({
        id: g.id,
        type: 'tv',
        name: g.isActive ? `🔴 ${g.rootName}` : g.rootName,
        poster: g.logo,
        posterShape: 'landscape',
        background: g.preview,
        description: g.subChannels.length > 1
          ? `Disponível em ${g.subChannels.length} sinais.\nNo ar: ${g.nowPlaying || 'Ao Vivo'}`
          : (g.nowPlaying || g.category),
        genres: [g.category]
      }));

      return res.end(JSON.stringify({ metas }));
    } catch (err) {
      return res.end(JSON.stringify({ metas: [] }));
    }
  }

  // 3. METADADOS (/meta/tv/:id.json)
  if (rawPath.includes('/meta/')) {
    const match = rawPath.match(/\/meta\/tv\/([^/.]+)/);
    const metaId = match ? match[1] : '';

    if (metaId.startsWith('rde_ch_')) {
      try {
        const resp = await HTTP_CLIENT.get('/channels');
        const grouped = processChannels(resp.data?.data || []);
        const item = grouped.find(g => g.id === metaId);

        if (item) {
          return res.end(JSON.stringify({
            meta: {
              id: item.id,
              type: 'tv',
              name: item.rootName,
              poster: item.logo,
              posterShape: 'landscape',
              background: item.preview,
              description: `Sinais disponíveis:\n${item.subChannels.map(s => `• ${s.name}`).join('\n')}\n\nPrograma atual: ${item.nowPlaying || 'Ao Vivo'}`
            }
          }));
        }
      } catch (err) {
        return res.end(JSON.stringify({ meta: null }));
      }
    }

    if (metaId.startsWith('rde_ev_')) {
      const slug = metaId.replace('rde_ev_', '');
      try {
        const resp = await HTTP_CLIENT.get(`/eventos/${slug}`);
        const ev = resp.data?.data?.[0] || resp.data?.data;
        if (ev) {
          return res.end(JSON.stringify({
            meta: {
              id: metaId,
              type: 'tv',
              name: ev.title,
              poster: ev.poster || ev.time1 || manifest.logo,
              posterShape: 'landscape',
              background: ev.poster || manifest.logo,
              description: `🏆 ${ev.competition || ''}\nHorário: ${ev.start_time || ''}\n\n${ev.description || ''}`
            }
          }));
        }
      } catch (err) {
        return res.end(JSON.stringify({ meta: null }));
      }
    }
  }

  // 4. STREAM (/stream/tv/:id.json)
  if (rawPath.includes('/stream/')) {
    const match = rawPath.match(/\/stream\/tv\/([^/.]+)/);
    const streamId = match ? match[1] : '';
    const streams = [];

    // Stream de Canal (múltiplos sinais)
    if (streamId.startsWith('rde_ch_')) {
      try {
        const resp = await HTTP_CLIENT.get('/channels');
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
      } catch (err) {
        return res.end(JSON.stringify({ streams: [] }));
      }
    }

    // Stream de Evento Esportivo
    if (streamId.startsWith('rde_ev_')) {
      const slug = streamId.replace('rde_ev_', '');
      try {
        const resp = await HTTP_CLIENT.get(`/eventos/${slug}`);
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
      } catch (err) {
        return res.end(JSON.stringify({ streams: [] }));
      }
    }
  }

  res.statusCode = 404;
  return res.end(JSON.stringify({ error: 'Not found' }));
};
