const axios = require('axios');
const manifest = require('../manifest.json');

const API_BASE = 'https://reidosembeds.lat/api';

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
    const groupKey = slugify(rootName);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        id: `rde_grp_${groupKey}`,
        rootName,
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Cache: resposta fresca por 30 segundos; revalidação em background até 60 segundos
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=60');

  const { url } = req;

  // ROTA: MANIFESTO
  if (url === '/' || url === '/manifest.json') {
    return res.json(manifest);
  }

  // ROTA: CATÁLOGO
  if (url.startsWith('/catalog/tv/')) {
    const parts = url.replace('/catalog/tv/', '').replace('.json', '').split('/');
    const catalogId = parts[0];
    const extraQuery = parts[1] ? new URLSearchParams(parts[1]) : new URLSearchParams();

    // 1. Catálogo de Esportes (Agenda ao vivo ordenada)
    if (catalogId === 'cat_esportes') {
      try {
        const genre = extraQuery.get('genre');
        const endpoint = (genre && genre !== 'Todos')
          ? `${API_BASE}/eventos?category=${encodeURIComponent(genre)}`
          : `${API_BASE}/eventos`;

        const resp = await axios.get(endpoint, { timeout: 4500 });
        let events = resp.data?.data || [];

        // Ordenação: 1º 'live', 2º horário de início crescente
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

    // 2. Catálogos de Canais (com agrupamento Apple TV 1, 2, 3...)
    try {
      let apiRoute = `${API_BASE}/channels`;
      if (catalogId.startsWith('cat_') && catalogId !== 'cat_todos' && catalogId !== 'cat_aovivo') {
        const catSlug = catalogId.replace('cat_', '');
        apiRoute = `${API_BASE}/channels?category=${encodeURIComponent(catSlug)}`;
      }

      const resp = await axios.get(apiRoute, { timeout: 4500 });
      let channels = resp.data?.data || [];
      let grouped = processChannels(channels);

      if (catalogId === 'cat_aovivo') {
        grouped = grouped.filter(g => g.is_active === true);
      }

      // Ao Vivo sempre no topo
      grouped.sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0));

      const metas = grouped.map(g => ({
        id: g.id,
        type: 'tv',
        name: g.is_active ? `🔴 ${g.rootName}` : g.rootName,
        poster: g.logo_url || manifest.logo,
        background: g.preview_url || g.logo_url,
        description: g.subChannels.length > 1
          ? `${g.subChannels.length} Sinais disponíveis • ${g.now_playing_title || g.category}`
          : (g.now_playing_title || g.category),
        genres: [g.category || 'Variedades']
      }));

      return res.json({ metas });
    } catch (err) {
      return res.json({ metas: [] });
    }
  }

  // ROTA: METADADOS
  if (url.startsWith('/meta/tv/')) {
    const id = url.replace('/meta/tv/', '').replace('.json', '');

    if (id.startsWith('rde_ev_')) {
      const slug = id.replace('rde_ev_', '');
      try {
        const resp = await axios.get(`${API_BASE}/eventos/${slug}`);
        const ev = resp.data?.data?.[0] || resp.data?.data;
        return res.json({
          meta: {
            id,
            type: 'tv',
            name: ev.title,
            poster: ev.poster || ev.time1,
            background: ev.poster,
            description: `🏆 ${ev.competition || ''}\n⏰ Horário: ${ev.start_time}\n\n${ev.description || ''}`
          }
        });
      } catch (err) {
        return res.status(500).json({ meta: null });
      }
    }

    if (id.startsWith('rde_grp_')) {
      const key = id.replace('rde_grp_', '');
      try {
        const resp = await axios.get(`${API_BASE}/channels`);
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
              background: target.preview_url || target.logo_url,
              description: `Sinais disponíveis:\n${signals}\n\nNo ar: ${target.now_playing_title || 'Ao Vivo'}`
            }
          });
        }
      } catch (err) {
        return res.status(500).json({ meta: null });
      }
    }
  }

  // ROTA: STREAMS (ENTREGA DOS SINAIS)
  if (url.startsWith('/stream/tv/')) {
    const id = url.replace('/stream/tv/', '').replace('.json', '');
    const streams = [];

    // Streams para Eventos Esportivos
    if (id.startsWith('rde_ev_')) {
      const slug = id.replace('rde_ev_', '');
      try {
        const resp = await axios.get(`${API_BASE}/eventos/${slug}`);
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

    // Streams para Canais Agrupados (Ex: Apple TV 1, 2, 3...)
    if (id.startsWith('rde_grp_')) {
      try {
        const resp = await axios.get(`${API_BASE}/channels`);
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