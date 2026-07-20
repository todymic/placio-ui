import { apiFetch } from './auth.js';

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Serializes all read-modify-write operations on a given chart's objects so
// concurrent saves (drag, debounced field edits, etc.) never race each other.
const chartQueues = new Map();
function enqueueChartOp(chartId, task) {
  const prev = chartQueues.get(chartId) || Promise.resolve();
  const run = prev.then(task, task);
  chartQueues.set(chartId, run.then(() => {}, () => {}));
  return run;
}

function splitObjects(objects = []) {
  const zones = [], seatRows = [], freeZones = [], tableZones = [], tableSections = [];
  for (const obj of objects) {
    if (obj._type === 'zone') zones.push(obj);
    else if (obj._type === 'seatRow') seatRows.push(obj);
    else if (obj._type === 'freeZone') freeZones.push(obj);
    else if (obj._type === 'tableZone') tableZones.push(obj);
    else if (obj._type === 'tableSection') tableSections.push(obj);
  }
  return { zones, seatRows, freeZones, tableZones, tableSections };
}

async function saveObjects(chartId, zones, seatRows, freeZones, categories, tableZones = [], tableSections = []) {
  const catByKey = Object.fromEntries(categories.map(c => [c.id, c.key]));
  const objects = [
    ...zones.map(z => ({ ...z, _type: 'zone', categoryKey: catByKey[z.categoryId] ?? null })),
    ...seatRows.map(s => ({ ...s, _type: 'seatRow', categoryKey: catByKey[s.categoryId] ?? null })),
    ...freeZones.map(f => ({ ...f, _type: 'freeZone', categoryKey: null })),
    ...tableZones.map(t => ({ ...t, _type: 'tableZone', categoryKey: catByKey[t.categoryId] ?? null })),
    ...tableSections.map(ts => ({ ...ts, _type: 'tableSection', categoryKey: catByKey[ts.categoryId] ?? null })),
  ];
  const res = await apiFetch(`/api/charts/${chartId}/objects`, {
    method: 'PUT',
    body: JSON.stringify({ objects }),
  });
  return res.json();
}

// Helper: fetch chart + cats, returns { zones, seatRows, freeZones, tableZones, tableSections, cats }
async function fetchAll(chartId) {
  const [chartRes, catsRes] = await Promise.all([
    apiFetch(`/api/charts/${chartId}`),
    apiFetch(`/api/charts/${chartId}/categories`),
  ]);
  const chart = await chartRes.json();
  const cats = await catsRes.json();
  return { ...splitObjects(chart.objects), cats };
}

export const adminApi = {
  // ---------- BULK SAVE ----------
  async saveAllObjects(chartId, zones, seatRows, freeZones, categories, tableZones = [], tableSections = []) {
    return enqueueChartOp(chartId, () => saveObjects(chartId, zones, seatRows, freeZones, categories, tableZones, tableSections));
  },

  // ---------- VENUES ----------
  async listVenues() { return (await apiFetch('/api/charts')).json(); },
  async createVenue(payload) {
    return (await apiFetch('/api/charts', { method: 'POST', body: JSON.stringify({ name: payload.name, slug: slugify(payload.name) }) })).json();
  },
  async updateVenue(id, payload) {
    return (await apiFetch(`/api/charts/${id}`, { method: 'PUT', body: JSON.stringify({ name: payload.name, slug: slugify(payload.name) }) })).json();
  },
  async updateVenueStatus(id, status) {
    return (await apiFetch(`/api/charts/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })).json();
  },
  async markVenuePendingChanges(id) {
    return (await apiFetch(`/api/charts/${id}/mark-pending`, { method: 'POST' })).json();
  },
  async publishVenue(id) {
    return (await apiFetch(`/api/charts/${id}/publish`, { method: 'POST' })).json();
  },
  async deleteVenue(id) { await apiFetch(`/api/charts/${id}`, { method: 'DELETE' }); return { success: true }; },

  // ---------- CATEGORIES ----------
  async listCategories(chartId) { return (await apiFetch(`/api/charts/${chartId}/categories`)).json(); },
  async createCategory(chartId, payload) {
    return (await apiFetch(`/api/charts/${chartId}/categories`, {
      method: 'POST',
      body: JSON.stringify({ name: payload.name, key: slugify(payload.name), color: payload.color }),
    })).json();
  },
  async updateCategory(id, payload, chartId, categoryKey) {
    return (await apiFetch(`/api/charts/${chartId}/categories/${categoryKey}`, {
      method: 'PUT',
      body: JSON.stringify({ name: payload.name, key: slugify(payload.name), color: payload.color }),
    })).json();
  },
  async deleteCategory(id, chartId, categoryKey) {
    await apiFetch(`/api/charts/${chartId}/categories/${categoryKey}`, { method: 'DELETE' });
    return { success: true };
  },

  // ---------- ZONES ----------
  async listZones(chartId) {
    const { zones } = splitObjects((await (await apiFetch(`/api/charts/${chartId}`)).json()).objects);
    return zones.map(z => ({ ...z, venueId: chartId }));
  },
  async createZone(chartId, payload) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const newZone = { id: `z${Date.now()}`, venueId: chartId, shape: 'rect', labelFontSize: 11, ...payload, _type: 'zone' };
      zones.push(newZone);
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return { ...newZone, venueId: chartId };
    });
  },
  async updateZone(id, payload, chartId) {
    chartId = chartId ?? payload.venueId;
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const idx = zones.findIndex(z => z.id === id);
      if (idx === -1) throw new Error('Zone introuvable');
      zones[idx] = { ...zones[idx], ...payload };
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return zones[idx];
    });
  },
  async deleteZone(id, chartId) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      await saveObjects(chartId, zones.filter(z => z.id !== id), seatRows, freeZones, cats, tableZones, tableSections);
      return { success: true };
    });
  },

  // ---------- SEAT ROWS ----------
  async listSeatRows(chartId) {
    const { seatRows } = splitObjects((await (await apiFetch(`/api/charts/${chartId}`)).json()).objects);
    return seatRows.map(s => ({ ...s, venueId: chartId }));
  },
  async createSeatRow(chartId, payload) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const newRow = {
        id: `sr${Date.now()}`, venueId: chartId, shape: 'rounded',
        seatSize: 22, rowFormat: 'A-Z', rowDirection: 'normal',
        colFormat: '1-9', colDirection: 'normal',
        disabledSeats: [], categoryOverrides: {}, blockNumber: null, rowLabelFontSize: 10,
        ...payload, _type: 'seatRow',
      };
      seatRows.push(newRow);
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return { ...newRow, venueId: chartId };
    });
  },
  async updateSeatRow(id, payload, chartId) {
    chartId = chartId ?? payload.venueId;
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const idx = seatRows.findIndex(s => s.id === id);
      if (idx === -1) throw new Error('Rangée introuvable');
      seatRows[idx] = { ...seatRows[idx], ...payload };
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return seatRows[idx];
    });
  },
  async deleteSeatRow(id, chartId) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      await saveObjects(chartId, zones, seatRows.filter(s => s.id !== id), freeZones, cats, tableZones, tableSections);
      return { success: true };
    });
  },

  // ---------- FREE ZONES ----------
  async listFreeZones(chartId) {
    const { freeZones } = splitObjects((await (await apiFetch(`/api/charts/${chartId}`)).json()).objects);
    return freeZones.map(f => ({ ...f, venueId: chartId }));
  },
  async createFreeZone(chartId, payload) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const newFz = {
        id: `fz${Date.now()}`, venueId: chartId, icon: 'none', color: '#6b7280',
        textColor: '#000000', pattern: 'solid', width: 100, height: 50, labelFontSize: 10,
        ...payload, _type: 'freeZone',
      };
      freeZones.push(newFz);
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return { ...newFz, venueId: chartId };
    });
  },
  async updateFreeZone(id, payload, chartId) {
    chartId = chartId ?? payload.venueId;
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const idx = freeZones.findIndex(f => f.id === id);
      if (idx === -1) throw new Error('Zone libre introuvable');
      freeZones[idx] = { ...freeZones[idx], ...payload };
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return freeZones[idx];
    });
  },
  async deleteFreeZone(id, chartId) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      await saveObjects(chartId, zones, seatRows, freeZones.filter(f => f.id !== id), cats, tableZones, tableSections);
      return { success: true };
    });
  },

  // ---------- TABLE ZONES ----------
  async listTableZones(chartId) {
    const { tableZones } = splitObjects((await (await apiFetch(`/api/charts/${chartId}`)).json()).objects);
    return tableZones.map(t => ({ ...t, venueId: chartId }));
  },
  async createTableZone(chartId, payload) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const newT = {
        id: `tz${Date.now()}`, venueId: chartId,
        section: '', label: 'Table', seatCount: 6,
        tableSize: 30, seatSize: 13, seatLabelFontSize: 9, tableLabelFontSize: 8, categoryId: null,
        rowLabelFontSize: 10, disabledSeats: [],
        ...payload, _type: 'tableZone',
      };
      tableZones.push(newT);
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return { ...newT, venueId: chartId };
    });
  },
  async updateTableZone(id, payload, chartId) {
    chartId = chartId ?? payload.venueId;
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const idx = tableZones.findIndex(t => t.id === id);
      if (idx === -1) throw new Error('Table introuvable');
      tableZones[idx] = { ...tableZones[idx], ...payload };
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return tableZones[idx];
    });
  },
  async deleteTableZone(id, chartId) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones.filter(t => t.id !== id), tableSections);
      return { success: true };
    });
  },

  // ---------- EVENTS ----------
  async listEvents() {
    return (await apiFetch('/api/events')).json();
  },
  async getEvent(id) {
    return (await apiFetch(`/api/events/${id}`)).json();
  },
  async createEvent(payload) {
    return (await apiFetch('/api/events', { method: 'POST', body: JSON.stringify(payload) })).json();
  },
  async updateEvent(id, payload) {
    return (await apiFetch(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) })).json();
  },
  async deleteEvent(id) {
    await apiFetch(`/api/events/${id}`, { method: 'DELETE' });
    return { success: true };
  },
  async getEventSeats(eventId) {
    return (await apiFetch(`/api/events/${eventId}/seats`)).json();
  },
  async bulkUpdateEventSeats(eventId, seatKeys, status) {
    return (await apiFetch(`/api/events/${eventId}/seats/bulk-status`, {
      method: 'PATCH',
      body: JSON.stringify({ seatKeys, status }),
    })).json();
  },

  // ---------- API KEYS ----------
  async listApiKeys() { return (await apiFetch('/api/api-keys')).json(); },
  async createApiKey(name, scope) {
    return (await apiFetch('/api/api-keys', { method: 'POST', body: JSON.stringify({ name, scope }) })).json();
  },
  async deleteApiKey(id) { return (await apiFetch(`/api/api-keys/${id}`, { method: 'DELETE' })).json(); },

  // ---------- TABLE SECTIONS ----------
  async listTableSections(chartId) {
    const { tableSections } = splitObjects((await (await apiFetch(`/api/charts/${chartId}`)).json()).objects);
    return tableSections.map(ts => ({ ...ts, venueId: chartId }));
  },
  async createTableSection(chartId, payload) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const newTs = {
        id: `tse${Date.now()}`, venueId: chartId,
        section: '', label: 'Section de tables', tableCount: 3, tableRows: 1, seatsPerTable: 6,
        tableSize: 30, seatSize: 13, seatLabelFontSize: 9, tableLabelFontSize: 13, tableSpacing: 0, categoryId: null,
        rowLabelFontSize: 10, disabledSeats: [],
        ...payload, _type: 'tableSection',
      };
      tableSections.push(newTs);
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return { ...newTs, venueId: chartId };
    });
  },
  async updateTableSection(id, payload, chartId) {
    chartId = chartId ?? payload.venueId;
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      const idx = tableSections.findIndex(ts => ts.id === id);
      if (idx === -1) throw new Error('Section de tables introuvable');
      tableSections[idx] = { ...tableSections[idx], ...payload };
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections);
      return tableSections[idx];
    });
  },
  async deleteTableSection(id, chartId) {
    return enqueueChartOp(chartId, async () => {
      const { zones, seatRows, freeZones, tableZones, tableSections, cats } = await fetchAll(chartId);
      await saveObjects(chartId, zones, seatRows, freeZones, cats, tableZones, tableSections.filter(ts => ts.id !== id));
      return { success: true };
    });
  },
};
