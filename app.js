/* Ay Pollito — app del personal. Vanilla JS, sin build. */
(() => {
  'use strict';
  const CFG = window.AYP_CONFIG || {};
  const LS = {
    cache: 'ayp_cache_v1',     // products, orders, history, settings
    outbox: 'ayp_outbox_v1',   // cambios pendientes de enviar
    unlocked: 'ayp_unlocked'   // sesión de PIN (sessionStorage)
  };

  // ---------- Estado ----------
  const S = {
    sb: null, session: null,
    products: [], orders: [], history: [], settings: {},
    cart: {}, service: 'llevar', customer: '', address: '',
    screen: 'pedido', sheet: false, unlocked: sessionStorage.getItem(LS.unlocked) === '1',
    pinEntered: '', pinError: false, pinMode: 'login', // login | create
    range: 'hoy', online: navigator.onLine, outbox: [], syncing: false, lastSync: 0
  };

  // ---------- Utilidades ----------
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const serviceLabel = (s) => s === 'domicilio' ? 'A domicilio' : 'Para llevar';
  const dayKey = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const timeLabel = (iso) => new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
  const dayLabel = (key) => {
    const today = dayKey(new Date().toISOString());
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (key === today) return 'Hoy';
    if (key === dayKey(y.toISOString())) return 'Ayer';
    const [Y, M, D] = key.split('-').map(Number);
    return new Date(Y, M - 1, D).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const orderTotal = (o) => (o.items || []).reduce((s, l) => s + l.qty * l.price, 0);
  const summary = (o) => (o.items || []).map((l) => l.qty + ' × ' + l.name).join(', ');
  let toastT;
  const toast = (msg, kind = '') => { const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); };
  async function sha256(text) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }

  // ---------- Caché local ----------
  function saveCache() {
    localStorage.setItem(LS.cache, JSON.stringify({ products: S.products, orders: S.orders, history: S.history, settings: S.settings }));
    localStorage.setItem(LS.outbox, JSON.stringify(S.outbox));
  }
  function loadCache() {
    try { const c = JSON.parse(localStorage.getItem(LS.cache) || '{}'); Object.assign(S, { products: c.products || [], orders: c.orders || [], history: c.history || [], settings: c.settings || {} }); } catch (e) { /* vacío */ }
    try { S.outbox = JSON.parse(localStorage.getItem(LS.outbox) || '[]'); } catch (e) { S.outbox = []; }
  }

  // ---------- Supabase ----------
  function initSupabase() {
    if (!window.supabase || !CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('TU-PROYECTO')) return null;
    return window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }
  function queue(op) { S.outbox.push(op); saveCache(); flush(); }
  async function runOp(op) {
    const t = S.sb.from(op.table);
    if (op.type === 'upsert') { const { error } = await t.upsert(op.rows); if (error) throw error; }
    else if (op.type === 'update') { const { error } = await t.update(op.patch).eq('id', op.id); if (error) throw error; }
    else if (op.type === 'insert') { const { error } = await t.insert(op.rows); if (error) throw error; }
  }
  async function flush() {
    if (!S.sb || !S.session || !S.online || S.syncing || !S.outbox.length) return;
    S.syncing = true;
    try {
      while (S.outbox.length) {
        const op = S.outbox[0];
        try { await runOp(op); }
        catch (e) {
          // Número de pedido duplicado (dos dispositivos): reasignar y reintentar
          if (op.type === 'insert' && op.table === 'orders' && String(e.code) === '23505') {
            const { data } = await S.sb.from('orders').select('number').order('number', { ascending: false }).limit(1);
            const n = ((data && data[0] && data[0].number) || 0) + 1;
            op.rows[0].number = n;
            const local = S.orders.find((o) => o.id === op.rows[0].id) || S.history.find((o) => o.id === op.rows[0].id);
            if (local) local.number = n;
            continue;
          }
          throw e;
        }
        S.outbox.shift(); saveCache();
      }
    } catch (e) { console.warn('sync pendiente', e.message || e); }
    S.syncing = false;
    render();
  }
  async function pull(force) {
    if (!S.sb || !S.session || !S.online) return;
    if (!force && Date.now() - S.lastSync < 15000) return;
    try {
      await flush();
      const since = new Date(); since.setDate(since.getDate() - 90);
      const [p, o, st] = await Promise.all([
        S.sb.from('products').select('*').eq('deleted', false).order('position').order('name'),
        S.sb.from('orders').select('*, items:order_items(name, qty, price)').gte('created_at', since.toISOString()).order('created_at', { ascending: false }),
        S.sb.from('settings').select('*')
      ]);
      if (p.error || o.error || st.error) throw (p.error || o.error || st.error);
      // Mantener pedidos locales aún no enviados
      const pendingIds = new Set(S.outbox.filter((x) => x.table === 'orders').map((x) => x.type === 'insert' ? x.rows[0].id : x.id));
      const localPending = [...S.orders, ...S.history].filter((x) => pendingIds.has(x.id));
      const all = o.data.filter((x) => !pendingIds.has(x.id)).concat(localPending);
      S.products = p.data;
      S.orders = all.filter((x) => x.status === 'prep' || x.status === 'listo').sort((a, b) => a.created_at.localeCompare(b.created_at));
      S.history = all.filter((x) => x.status === 'entregado').sort((a, b) => b.delivered_at.localeCompare(a.delivered_at));
      S.settings = Object.fromEntries(st.data.map((r) => [r.key, r.value]));
      S.lastSync = Date.now(); saveCache(); render();
    } catch (e) { console.warn('pull', e.message || e); }
  }

  // ---------- Acciones ----------
  const A = {
    nav(scr) { S.screen = scr; S.sheet = false; render(); if (scr !== 'pedido') pull(); },
    add(id) { S.cart[id] = (S.cart[id] || 0) + 1; render(); },
    dec(id) { if (S.cart[id] > 1) S.cart[id]--; else delete S.cart[id]; if (!Object.keys(S.cart).length) S.sheet = false; render(); },
    openSheet() { S.sheet = true; render(); },
    closeSheet() { S.sheet = false; render(); },
    service(s) { S.service = s; render(); },
    confirm() {
      const items = S.products.filter((p) => S.cart[p.id]).map((p) => ({ name: p.name, qty: S.cart[p.id], price: Number(p.price) }));
      if (!items.length) return;
      const maxN = Math.max(0, ...S.orders.map((o) => o.number), ...S.history.map((o) => o.number));
      const order = { id: uuid(), number: maxN + 1, customer: S.customer.trim() || 'Sin nombre', service: S.service,
        address: S.service === 'domicilio' ? S.address.trim() : '', status: 'prep', total: items.reduce((s, l) => s + l.qty * l.price, 0),
        created_at: new Date().toISOString(), delivered_at: null, items };
      S.orders.push(order);
      const { items: its, ...row } = order;
      queue({ type: 'insert', table: 'orders', rows: [row] });
      queue({ type: 'insert', table: 'order_items', rows: its.map((l) => ({ order_id: order.id, ...l })) });
      S.cart = {}; S.customer = ''; S.address = ''; S.sheet = false; S.screen = 'pedidos';
      toast('Pedido #' + order.number + ' confirmado', 'ok'); render();
    },
    advance(id) {
      const o = S.orders.find((x) => x.id === id); if (!o) return;
      if (o.status === 'prep') { o.status = 'listo'; queue({ type: 'update', table: 'orders', id, patch: { status: 'listo' } }); }
      else { o.status = 'entregado'; o.delivered_at = new Date().toISOString(); S.orders = S.orders.filter((x) => x.id !== id); S.history.unshift(o);
        queue({ type: 'update', table: 'orders', id, patch: { status: 'entregado', delivered_at: o.delivered_at } }); toast('Pedido #' + o.number + ' entregado', 'ok'); }
      render();
    },
    cancel(id) {
      const o = S.orders.find((x) => x.id === id); if (!o) return;
      if (!window.confirm('¿Cancelar el pedido #' + o.number + ' de ' + o.customer + '?')) return;
      S.orders = S.orders.filter((x) => x.id !== id);
      queue({ type: 'update', table: 'orders', id, patch: { status: 'cancelado' } }); render();
    },
    // Precios
    setName(id, v) { const p = S.products.find((x) => x.id === id); if (!p) return; p.name = v.trim() || p.name; queue({ type: 'update', table: 'products', id, patch: { name: p.name, updated_at: new Date().toISOString() } }); render(); },
    setPrice(id, v) { const p = S.products.find((x) => x.id === id); if (!p) return; p.price = Math.max(0, Number(v) || 0); queue({ type: 'update', table: 'products', id, patch: { price: p.price, updated_at: new Date().toISOString() } }); render(); },
    step(id, d) { const p = S.products.find((x) => x.id === id); if (p) A.setPrice(id, Number(p.price) + d); },
    toggle(id) { const p = S.products.find((x) => x.id === id); if (!p) return; p.available = !p.available; queue({ type: 'update', table: 'products', id, patch: { available: p.available } }); render(); },
    remove(id) { const p = S.products.find((x) => x.id === id); if (!p || !window.confirm('¿Quitar "' + p.name + '" del menú?')) return; S.products = S.products.filter((x) => x.id !== id); delete S.cart[id]; queue({ type: 'update', table: 'products', id, patch: { deleted: true } }); render(); },
    addProduct() { const p = { id: uuid(), name: 'Nuevo producto', price: 0, available: true, position: S.products.length + 1, deleted: false }; S.products.push(p); queue({ type: 'insert', table: 'products', rows: [p] }); render(); setTimeout(() => { const el = document.querySelector('[data-name="' + p.id + '"]'); if (el) { el.focus(); el.select(); } }, 50); },
    async setPin(v) {
      const pin = String(v).replace(/\D/g, '');
      if (pin.length !== 4) { toast('El PIN debe tener 4 números', 'err'); render(); return; }
      const salt = uuid(); const hash = await sha256(salt + ':' + pin);
      S.settings.pin_salt = salt; S.settings.pin_hash = hash;
      queue({ type: 'upsert', table: 'settings', rows: [{ key: 'pin_salt', value: salt }, { key: 'pin_hash', value: hash }] });
      toast('PIN actualizado', 'ok'); render();
    },
    lock() { S.unlocked = false; sessionStorage.removeItem(LS.unlocked); S.pinEntered = ''; S.sheet = false; render(); },
    async key(k) {
      if (k === 'del') { S.pinEntered = S.pinEntered.slice(0, -1); S.pinError = false; return render(); }
      if (k === 'ok') return A.tryPin();
      if (S.pinEntered.length >= 4) return;
      S.pinEntered += k; S.pinError = false; render();
      if (S.pinEntered.length === 4) A.tryPin();
    },
    async tryPin() {
      if (S.pinEntered.length !== 4) return;
      if (S.pinMode === 'create') { await A.setPin(S.pinEntered); S.pinEntered = ''; S.unlocked = true; sessionStorage.setItem(LS.unlocked, '1'); S.pinMode = 'login'; return render(); }
      const h = await sha256((S.settings.pin_salt || '') + ':' + S.pinEntered);
      if (h === S.settings.pin_hash) { S.unlocked = true; sessionStorage.setItem(LS.unlocked, '1'); S.pinEntered = ''; S.pinError = false; pull(true); }
      else { S.pinEntered = ''; S.pinError = true; }
      render();
    },
    async login(email, password) {
      if (!S.sb) return toast('Falta configurar Supabase en config.js', 'err');
      const { data, error } = await S.sb.auth.signInWithPassword({ email, password });
      if (error) return toast('No se pudo entrar: ' + error.message, 'err');
      S.session = data.session; toast('Dispositivo configurado', 'ok'); await pull(true); render();
    },
    range(r) { S.range = r; render(); },
    exportPdf() { exportPdf(); },
    exportExcel() { exportExcel(); }
  };

  // ---------- Historial / exportación ----------
  function rangeRows() {
    const now = new Date(); const start = new Date(now);
    if (S.range === 'hoy') start.setHours(0, 0, 0, 0);
    else if (S.range === '7d') { start.setDate(now.getDate() - 6); start.setHours(0, 0, 0, 0); }
    else if (S.range === 'mes') { start.setDate(1); start.setHours(0, 0, 0, 0); }
    else start.setTime(0);
    return S.history.filter((o) => new Date(o.delivered_at || o.created_at) >= start);
  }
  function rangeLabel() { return { hoy: 'Hoy', '7d': 'Últimos 7 días', mes: 'Este mes', todo: 'Todo (90 días)' }[S.range]; }
  function fileStamp() { return dayKey(new Date().toISOString()); }
  function exportRowsFlat(rows) {
    return rows.map((o) => ({
      Pedido: o.number, Fecha: new Date(o.delivered_at || o.created_at).toLocaleDateString('es-MX'), Hora: timeLabel(o.delivered_at || o.created_at),
      Cliente: o.customer, Entrega: serviceLabel(o.service), Productos: summary(o), Total: orderTotal(o)
    }));
  }
  function exportPdf() {
    if (!window.jspdf) return toast('Aún cargando el generador de PDF, intenta de nuevo', 'err');
    const rows = rangeRows(); const total = rows.reduce((s, o) => s + orderTotal(o), 0);
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
    doc.setFillColor(11, 58, 110); doc.rect(0, 0, 612, 70, 'F');
    doc.setTextColor(255, 176, 0); doc.setFontSize(22); doc.text(CFG.SHOP_NAME || 'Ay, Pollito!', 40, 42);
    doc.setTextColor(191, 212, 242); doc.setFontSize(10); doc.text(CFG.SHOP_ADDRESS || '', 40, 58);
    doc.setTextColor(26, 26, 46); doc.setFontSize(13); doc.text('Ventas: ' + rangeLabel(), 40, 100);
    doc.setFontSize(11); doc.text(rows.length + ' pedidos entregados. Total: ' + money(total), 40, 118);
    doc.autoTable({ startY: 132, head: [['#', 'Fecha', 'Hora', 'Cliente', 'Entrega', 'Productos', 'Total']],
      body: rows.map((o) => [o.number, new Date(o.delivered_at || o.created_at).toLocaleDateString('es-MX'), timeLabel(o.delivered_at || o.created_at), o.customer, serviceLabel(o.service), summary(o), money(orderTotal(o))]),
      styles: { fontSize: 9, cellPadding: 4 }, headStyles: { fillColor: [11, 58, 110] }, columnStyles: { 5: { cellWidth: 180 }, 6: { halign: 'right' } } });
    doc.save('ventas-ay-pollito-' + fileStamp() + '.pdf'); toast('PDF descargado', 'ok');
  }
  function exportExcel() {
    if (!window.XLSX) return toast('Aún cargando el generador de Excel, intenta de nuevo', 'err');
    const rows = rangeRows();
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.json_to_sheet(exportRowsFlat(rows));
    ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 50 }, { wch: 10 }];
    window.XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
    // Hoja de totales por día
    const byDay = {}; rows.forEach((o) => { const k = dayKey(o.delivered_at || o.created_at); byDay[k] = byDay[k] || { Fecha: k, Pedidos: 0, Total: 0 }; byDay[k].Pedidos++; byDay[k].Total += orderTotal(o); });
    const ws2 = window.XLSX.utils.json_to_sheet(Object.values(byDay)); window.XLSX.utils.book_append_sheet(wb, ws2, 'Por día');
    // Hoja de productos vendidos
    const byProd = {}; rows.forEach((o) => (o.items || []).forEach((l) => { byProd[l.name] = byProd[l.name] || { Producto: l.name, Cantidad: 0, Importe: 0 }; byProd[l.name].Cantidad += l.qty; byProd[l.name].Importe += l.qty * l.price; }));
    const ws3 = window.XLSX.utils.json_to_sheet(Object.values(byProd).sort((a, b) => b.Importe - a.Importe)); window.XLSX.utils.book_append_sheet(wb, ws3, 'Productos');
    window.XLSX.writeFile(wb, 'ventas-ay-pollito-' + fileStamp() + '.xlsx'); toast('Excel descargado', 'ok');
  }

  // ---------- Vistas ----------
  function vSetup() {
    return `<div class="center"><h2>Configurar este dispositivo</h2>
      <p class="hint">Se hace una sola vez. Entra con la cuenta del negocio (la que creaste en Supabase).</p>
      <form class="form" id="f-login">
        <label class="label" for="email">Correo</label><input class="input" id="email" type="email" autocomplete="username" required>
        <label class="label" for="pass">Contraseña</label><input class="input" id="pass" type="password" autocomplete="current-password" required>
        <button type="submit" class="btn-primary wide">Entrar</button>
      </form>
      ${S.sb ? '' : '<p class="hint err">Falta poner la URL y la anon key de Supabase en config.js</p>'}</div>`;
  }
  function vPin() {
    const create = S.pinMode === 'create';
    const dots = [0, 1, 2, 3].map((i) => `<div class="dot ${S.pinError ? 'err' : (i < S.pinEntered.length ? 'on' : '')}"></div>`).join('');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => `<button type="button" data-key="${k}" class="${k === 'del' ? 'del' : (k === 'ok' ? 'ok' : '')}" aria-label="${k === 'del' ? 'Borrar' : (k === 'ok' ? 'Entrar' : k)}">${k === 'del' ? '⌫' : (k === 'ok' ? 'Entrar' : k)}</button>`).join('');
    return `<div class="center"><div><h2 style="text-align:center">${create ? 'Crea el PIN del personal' : 'Escribe tu PIN'}</h2>
      <p class="hint ${S.pinError ? 'err' : ''}">${create ? 'Cuatro números. Lo usarán todos para abrir la app.' : (S.pinError ? 'PIN incorrecto, inténtalo de nuevo.' : 'Pídelo al encargado si no lo tienes.')}</p></div>
      <div class="dots">${dots}</div><div class="keypad">${keys}</div></div>`;
  }
  function vPedido() {
    const tiles = S.products.map((p) => {
      const q = S.cart[p.id] || 0;
      if (!p.available) return `<div class="tile-off"><div class="name">${esc(p.name)}</div><div>Agotado</div></div>`;
      if (!q) return `<button type="button" class="tile" data-add="${p.id}"><div class="name">${esc(p.name)}</div><div class="price">${money(p.price)}</div></button>`;
      return `<div class="tile-active"><div class="top"><div class="name">${esc(p.name)}</div><div class="price">${money(p.price)}</div></div>
        <div class="stepper"><button type="button" class="btn-round-minus" data-dec="${p.id}" aria-label="Quitar uno">−</button><div class="qty">${q}</div><button type="button" class="btn-round-plus" data-add="${p.id}" aria-label="Agregar uno">+</button></div></div>`;
    }).join('');
    const count = Object.values(S.cart).reduce((s, q) => s + q, 0);
    const total = S.products.reduce((s, p) => s + Number(p.price) * (S.cart[p.id] || 0), 0);
    const bar = count ? `<div class="bar"><div><div class="sub">${count} ${count === 1 ? 'artículo' : 'artículos'}</div><div class="total">${money(total)}</div></div><button type="button" class="btn-primary" data-act="openSheet">Ver pedido</button></div>` : '';
    const empty = S.products.length ? '' : `<div class="empty">${S.session ? 'No hay productos. Agrégalos en Precios.' : 'Sin datos todavía.'}</div>`;
    return `<div class="title-row"><h2>Toca para agregar</h2><span class="sub">${S.products.filter((p) => p.available).length} productos</span></div>
      <div class="scroll"><div class="grid2">${tiles}</div>${empty}</div>${bar}${S.sheet ? vSheet(total) : ''}`;
  }
  function vSheet(total) {
    const lines = S.products.filter((p) => S.cart[p.id]).map((p) => { const q = S.cart[p.id]; return `<div class="card"><div class="grow"><div class="n">${esc(p.name)}</div><div class="s">${q} × ${money(p.price)} = ${money(q * p.price)}</div></div>
      <button type="button" class="btn-round-minus" data-dec="${p.id}" aria-label="Quitar uno">−</button><div style="width:28px;text-align:center;font-size:20px">${q}</div><button type="button" class="btn-round-plus" data-add="${p.id}" aria-label="Agregar uno">+</button></div>`; }).join('');
    return `<div class="sheet"><div class="title-row"><h2>Pedido</h2><button type="button" class="btn-secondary" data-act="closeSheet">← Seguir agregando</button></div>
      <div class="scroll">${lines}
        <div class="label">¿Cómo se entrega?</div>
        <div class="seg"><button type="button" class="${S.service === 'llevar' ? 'on' : ''}" data-service="llevar">Para llevar</button><button type="button" class="${S.service === 'domicilio' ? 'on' : ''}" data-service="domicilio">A domicilio</button></div>
        <label class="label" for="cliente">Nombre del cliente</label><input class="input" id="cliente" type="text" placeholder="Ej. Sra. Lupita" value="${esc(S.customer)}" data-field="customer">
        ${S.service === 'domicilio' ? `<label class="label" for="dir">Teléfono y dirección</label><input class="input" id="dir" type="text" placeholder="55 1234 5678, Calle y número" value="${esc(S.address)}" data-field="address">` : ''}
        <div style="height:8px"></div></div>
      <div class="footer"><div class="row"><span class="sub">Total</span><span class="big">${money(total)}</span></div><button type="button" class="btn-primary wide" data-act="confirm">Confirmar pedido</button></div></div>`;
  }
  function vPedidos() {
    const cards = S.orders.map((o) => { const ready = o.status === 'listo'; const dom = o.service === 'domicilio';
      return `<div class="order"><div class="head"><div class="who"><div class="num">${o.number}</div><div><div class="cust">${esc(o.customer)}</div><div class="meta">${serviceLabel(o.service)}, ${timeLabel(o.created_at)}</div></div></div>
        <span class="status ${ready ? 'listo' : 'prep'}">${ready ? (dom ? 'En camino' : 'Listo') : 'Preparando'}</span></div>
        <div class="lines">${esc(summary(o))}</div>${o.address ? `<div class="addr">${esc(o.address)}</div>` : ''}
        <div class="foot"><div class="tot">${money(orderTotal(o))}</div><div style="display:flex;gap:8px;align-items:center"><button type="button" class="btn-cancel" data-cancel="${o.id}">Cancelar</button>
        <button type="button" class="btn-advance ${ready ? 'deliver' : ''}" data-advance="${o.id}">${ready ? 'Entregado' : (dom ? 'Salió a entrega' : 'Marcar listo')}</button></div></div></div>`; }).join('');
    return `<div class="title-row"><h2>Pedidos en curso</h2><span class="sub">${S.orders.length} ${S.orders.length === 1 ? 'pedido' : 'pedidos'}</span></div>
      <div class="scroll">${cards || '<div class="empty">No hay pedidos pendientes. Los pedidos confirmados aparecen aquí.</div>'}</div>`;
  }
  function vHistorial() {
    const rows = rangeRows(); const total = rows.reduce((s, o) => s + orderTotal(o), 0);
    const days = {}; rows.forEach((o) => { const k = dayKey(o.delivered_at || o.created_at); (days[k] = days[k] || []).push(o); });
    const list = Object.keys(days).sort().reverse().map((k) => `<div class="dayhead"><span>${dayLabel(k)}</span><span class="t">${money(days[k].reduce((s, o) => s + orderTotal(o), 0))}</span></div>` +
      days[k].map((o) => `<div class="hist"><div class="num soft">${o.number}</div><div class="grow"><div class="c">${esc(o.customer)}</div><div class="m">${serviceLabel(o.service)}, ${timeLabel(o.delivered_at || o.created_at)}</div><div class="l">${esc(summary(o))}</div></div><div class="t">${money(orderTotal(o))}</div></div>`).join('')).join('');
    const rb = (k, l) => `<button type="button" class="${S.range === k ? 'on' : ''}" data-range="${k}">${l}</button>`;
    return `<div class="stack"><h2>Historial de ventas</h2><span class="sub">Pedidos entregados. Se guardan 90 días en la app; todo queda en la base de datos.</span></div>
      <div class="scroll">
        <div class="range">${rb('hoy', 'Hoy')}${rb('7d', '7 días')}${rb('mes', 'Mes')}${rb('todo', 'Todo')}</div>
        <div class="summary"><div><div class="k">Vendido</div><div class="v y">${money(total)}</div></div><div><div class="k">Pedidos</div><div class="v">${rows.length}</div></div>
          <div><div class="k">Para llevar</div><div class="m">${rows.filter((o) => o.service === 'llevar').length}</div></div><div><div class="k">A domicilio</div><div class="m">${rows.filter((o) => o.service === 'domicilio').length}</div></div></div>
        <div class="seg"><button type="button" class="btn-secondary" data-act="exportPdf" ${rows.length ? '' : 'disabled'}>Exportar PDF</button><button type="button" class="btn-secondary" data-act="exportExcel" ${rows.length ? '' : 'disabled'}>Exportar Excel</button></div>
        ${list || '<div class="empty">Sin ventas en este periodo.</div>'}</div>`;
  }
  function vPrecios() {
    const prods = S.products.map((p) => `<div class="prod">
      <div class="row"><label for="n-${p.id}">Nombre</label><input class="in-name" id="n-${p.id}" type="text" value="${esc(p.name)}" data-name="${p.id}"></div>
      <div class="row"><label for="p-${p.id}">Precio</label><button type="button" class="btn-step minus" data-step="${p.id}" data-d="-5" aria-label="Bajar 5 pesos">−5</button>
        <input class="in-price" id="p-${p.id}" type="number" inputmode="numeric" min="0" value="${Number(p.price)}" data-price="${p.id}"><button type="button" class="btn-step plus" data-step="${p.id}" data-d="5" aria-label="Subir 5 pesos">+5</button></div>
      <div class="row"><button type="button" class="btn-toggle ${p.available ? 'on' : 'off'}" data-toggle="${p.id}">${p.available ? 'Disponible ✓' : 'Agotado'}</button><button type="button" class="btn-ghost" data-remove="${p.id}">Quitar</button></div></div>`).join('');
    return `<div class="stack"><h2>Precios y productos</h2><span class="sub">Los cambios se guardan solos y se ven al instante en todos los dispositivos.</span></div>
      <div class="scroll">${prods}<button type="button" class="btn-dashed" data-act="addProduct">+ Agregar producto</button>
        <div class="prod" style="margin-top:8px"><div style="font-size:16px">PIN del personal</div><span class="sub">Cuatro números. Se pide al abrir la app y al cerrar sesión.</span>
          <form class="row" id="f-pin"><label for="pin">Nuevo PIN</label><input class="in-pin" id="pin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off" required><button type="submit" class="btn-step plus" style="width:auto;padding:0 14px">Guardar</button></form></div>
        <div class="sub" style="text-align:center;padding:8px 0">${S.session ? 'Cuenta: ' + esc(S.session.user.email) : 'Sin cuenta'} · ${S.outbox.length ? S.outbox.length + ' cambios por enviar' : 'Todo sincronizado'}</div></div>`;
  }

  function render() {
    const root = $('#screen');
    const needsSetup = !S.session && !(S.products.length && S.settings.pin_hash);
    const hasPin = !!S.settings.pin_hash;
    let html, showNav = false;
    if (needsSetup) html = vSetup();
    else if (!hasPin) { S.pinMode = 'create'; html = vPin(); }
    else if (!S.unlocked) { S.pinMode = 'login'; html = vPin(); }
    else { showNav = true; html = { pedido: vPedido, pedidos: vPedidos, historial: vHistorial, precios: vPrecios }[S.screen](); }
    root.innerHTML = html;
    $('#nav').hidden = !showNav; $('#btn-lock').hidden = !showNav;
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.nav === S.screen));
    $('#nav-pedidos-label').textContent = 'En curso' + (S.orders.length ? ' (' + S.orders.length + ')' : '');
    $('#offline-pill').hidden = S.online;
    $('#brand').textContent = CFG.SHOP_NAME || 'Ay, Pollito!'; $('#brand-sub').textContent = CFG.SHOP_ADDRESS || '';
  }

  // ---------- Eventos (delegación) ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.nav) return A.nav(d.nav);
    if (d.add) return A.add(d.add);
    if (d.dec) return A.dec(d.dec);
    if (d.service) return A.service(d.service);
    if (d.advance) return A.advance(d.advance);
    if (d.cancel) return A.cancel(d.cancel);
    if (d.step) return A.step(d.step, Number(d.d));
    if (d.toggle) return A.toggle(d.toggle);
    if (d.remove) return A.remove(d.remove);
    if (d.range) return A.range(d.range);
    if (d.key) return A.key(d.key);
    if (b.id === 'btn-lock') return A.lock();
    if (d.act && A[d.act]) return A[d.act]();
  });
  document.addEventListener('input', (e) => {
    const t = e.target; if (!t.dataset) return;
    if (t.dataset.field === 'customer') S.customer = t.value;
    if (t.dataset.field === 'address') S.address = t.value;
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.name) A.setName(t.dataset.name, t.value);
    if (t.dataset.price) A.setPrice(t.dataset.price, t.value);
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'f-login') { e.preventDefault(); A.login($('#email').value.trim(), $('#pass').value); }
    if (e.target.id === 'f-pin') { e.preventDefault(); A.setPin($('#pin').value); $('#pin').value = ''; }
  });
  window.addEventListener('online', () => { S.online = true; render(); flush().then(() => pull(true)); });
  window.addEventListener('offline', () => { S.online = false; render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  setInterval(() => pull(), 60000);

  // ---------- Arranque ----------
  (async () => {
    loadCache();
    S.sb = initSupabase();
    if (S.sb) {
      const { data } = await S.sb.auth.getSession(); S.session = data.session;
      S.sb.auth.onAuthStateChange((_e, s) => { S.session = s; render(); });
    }
    render();
    await pull(true);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => null);
  })();
})();
