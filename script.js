/* ==========================================================
   VG Indumentaria — script.js
   Catálogo cargado desde Google Sheets (publicado como CSV),
   carrito en localStorage, y derivación de consultas a
   WhatsApp / Instagram (el sitio no cobra ni vende).
   ========================================================== */

/* ------------------------------------------------------------
   1) CONFIGURACIÓN — completar con tus datos
   ------------------------------------------------------------ */
const CONFIG = {
  // Pegá acá la URL "Publicar en la web" de tu Google Sheet en formato CSV.
  // Guía completa en GUIA-GOOGLE-SHEETS.md
  SHEET_CSV_URL: "https://docs.google.com/spreadsheets/d/1DKbQ39l8EvKyJxL9S_wdDXyhPpbVJunXxt6ULjLEH7g/export?format=csv&gid=0",

  WHATSAPP_NUMBER: "5492657218291", // sin +, sin espacios ni guiones
  INSTAGRAM_USER: "indumentaria_deportiva.vg",

  // Orden sugerido de categorías en los filtros (si aparece una categoría
  // nueva en la planilla que no está en esta lista, se agrega al final).
  CATEGORY_ORDER: ["Remeras", "Camperas", "Pantalones", "Shorts", "Calzas", "Medias", "Accesorios"],

  CURRENCY: "ARS",
};

const IG_PROFILE_URL = `https://www.instagram.com/${CONFIG.INSTAGRAM_USER}/`;
const IG_DM_URL = `https://ig.me/m/${CONFIG.INSTAGRAM_USER}`;

/* ------------------------------------------------------------
   2) ESTADO
   ------------------------------------------------------------ */
let PRODUCTS = [];
let activeCategory = "todos";
let cart = loadCart(); // { [id]: qty }

/* ------------------------------------------------------------
   3) UTILIDADES
   ------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function formatPrice(n) {
  const num = Number(n) || 0;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: CONFIG.CURRENCY,
    maximumFractionDigits: 0,
  }).format(num);
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function showToast(msg, duration = 2600) {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.classList.add("is-visible");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("is-visible"), duration);
}

/* ------------------------------------------------------------
   4) PARSER CSV (soporta comillas y comas dentro de campos)
   ------------------------------------------------------------ */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((v) => v !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows
    .slice(1)
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
      return obj;
    })
    // descarta filas completamente vacías (espacios en blanco al final de la hoja, etc.)
    .filter((obj) => Object.values(obj).some((v) => v !== ""));
}

// Normaliza encabezados: saca BOM, tildes y mayúsculas, para que "Categoría",
// " precio " o el BOM que agrega Google Sheets no rompan el mapeo de columnas.
function normalizeHeader(h) {
  return String(h)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/* ------------------------------------------------------------
   5) CARGA DE PRODUCTOS DESDE GOOGLE SHEETS
   Columnas esperadas: id, nombre, categoria, precio, imagen,
   descripcion, disponible
   ------------------------------------------------------------ */
async function loadProducts() {
  const status = $("#catalogStatus");

  if (!CONFIG.SHEET_CSV_URL || CONFIG.SHEET_CSV_URL.includes("PEGA_ACA")) {
    status.textContent = "Falta configurar la URL del Google Sheet en script.js (CONFIG.SHEET_CSV_URL).";
    status.classList.add("is-error");
    return;
  }

  try {
    const res = await fetch(CONFIG.SHEET_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = (await res.text()).replace(/^\uFEFF/, "");
    const rows = parseCSV(text);

    PRODUCTS = rows
      .map((r, i) => ({
        id: r.id || slugify(r.nombre || `producto-${i}`),
        nombre: (r.nombre || "").trim(),
        categoria: r.categoria || "Otros",
        precio: Number(String(r.precio).replace(/[^\d.,]/g, "").replace(",", ".")) || 0,
        imagen: r.imagen || "",
        descripcion: r.descripcion || "",
        disponible: String(r.disponible || "si").trim().toLowerCase() !== "no",
      }))
      // si no tiene nombre, no es un producto válido: se descarta en vez de
      // mostrarse como "Producto sin nombre"
      .filter((p) => p.nombre);

    if (!PRODUCTS.length) {
      status.textContent = "Todavía no hay productos cargados en el catálogo.";
      return;
    }

    status.classList.add("is-hidden");
    buildFilters();
    renderGrid();
  } catch (err) {
    console.error(err);
    status.textContent = "No se pudo cargar el catálogo. Volvé a intentar en unos minutos.";
    status.classList.add("is-error");
  }
}

/* ------------------------------------------------------------
   6) FILTROS DE CATEGORÍA
   ------------------------------------------------------------ */
function buildFilters() {
  const container = $("#filters");
  const present = Array.from(new Set(PRODUCTS.map((p) => p.categoria)));
  const ordered = [
    ...CONFIG.CATEGORY_ORDER.filter((c) => present.includes(c)),
    ...present.filter((c) => !CONFIG.CATEGORY_ORDER.includes(c)),
  ];

  container.innerHTML = `<button class="filter is-active" data-cat="todos" type="button">Todos</button>`;
  ordered.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "filter";
    btn.type = "button";
    btn.dataset.cat = cat;
    btn.textContent = cat;
    container.appendChild(btn);
  });

  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter");
    if (!btn) return;
    activeCategory = btn.dataset.cat;
    $$(".filter", container).forEach((f) => f.classList.toggle("is-active", f === btn));
    renderGrid();
  });
}

/* ------------------------------------------------------------
   7) RENDER DEL GRID DE PRODUCTOS
   ------------------------------------------------------------ */
function renderGrid() {
  const grid = $("#productGrid");
  const items = PRODUCTS.filter((p) => activeCategory === "todos" || p.categoria === activeCategory);

  if (!items.length) {
    grid.innerHTML = `<p class="catalog__status">No hay productos en esta categoría por ahora.</p>`;
    return;
  }

  grid.innerHTML = items.map(productCardHTML).join("");
}

function productCardHTML(p) {
  const img = p.imagen || "assets/logo.png";
  return `
    <article class="card" data-id="${p.id}">
      <div class="card__image" data-action="view" data-id="${p.id}">
        <span class="card__tag">${p.categoria}</span>
        <img src="${img}" alt="${p.nombre}" loading="lazy" onerror="this.src='assets/logo.png'">
      </div>
      <div class="card__body">
        <p class="card__name" data-action="view" data-id="${p.id}">${p.nombre}</p>
        <p class="card__price">${formatPrice(p.precio)}</p>
        ${
          p.disponible
            ? `<div class="card__row">
                 <button class="card__add" data-action="add" data-id="${p.id}" type="button">Agregar</button>
                 <button class="card__view" data-action="view" data-id="${p.id}" type="button" aria-label="Ver producto">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
                 </button>
               </div>`
            : `<p class="card__unavailable">Sin stock por ahora</p>`
        }
      </div>
    </article>`;
}

/* Delegación de eventos del grid: agregar al carrito / ver producto */
$("#productGrid").addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const id = el.dataset.id;

  if (el.dataset.action === "add") {
    addToCart(id);
    el.textContent = "Agregado ✓";
    el.classList.add("is-added");
    setTimeout(() => {
      el.textContent = "Agregar";
      el.classList.remove("is-added");
    }, 1100);
  }
  if (el.dataset.action === "view") openModal(id);
});

/* ------------------------------------------------------------
   8) MODAL DE PRODUCTO (vista rápida)
   ------------------------------------------------------------ */
function openModal(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  const img = p.imagen || "assets/logo.png";

  $("#modalContent").innerHTML = `
    <div class="modal__image"><img src="${img}" alt="${p.nombre}" onerror="this.src='assets/logo.png'"></div>
    <div class="modal__body">
      <p class="modal__cat">${p.categoria}</p>
      <h3 class="modal__name">${p.nombre}</h3>
      <p class="modal__price">${formatPrice(p.precio)}</p>
      ${p.descripcion ? `<p class="modal__desc">${p.descripcion}</p>` : ""}
      <div class="modal__actions">
        ${p.disponible ? `<button class="btn btn--outline" id="modalAdd" data-id="${p.id}" type="button">Agregar a la selección</button>` : `<p class="card__unavailable">Sin stock por ahora</p>`}
        <button class="btn btn--primary" id="modalWa" data-id="${p.id}" type="button">Consultar por WhatsApp</button>
        <button class="btn btn--outline" id="modalIg" data-id="${p.id}" type="button">Consultar por Instagram</button>
      </div>
    </div>`;

  $("#modalOverlay").classList.add("is-visible");
  $("#productModal").classList.add("is-open");
  $("#productModal").setAttribute("aria-hidden", "false");

  const addBtn = $("#modalAdd");
  if (addBtn) addBtn.addEventListener("click", () => { addToCart(p.id); showToast(`${p.nombre} agregado a tu selección`); });
  $("#modalWa").addEventListener("click", () => consultSingleProduct(p, "whatsapp"));
  $("#modalIg").addEventListener("click", () => consultSingleProduct(p, "instagram"));
}

function closeModal() {
  $("#modalOverlay").classList.remove("is-visible");
  $("#productModal").classList.remove("is-open");
  $("#productModal").setAttribute("aria-hidden", "true");
}
$("#modalOverlay").addEventListener("click", closeModal);
$("#modalClose").addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closeCart(); } });

/* ------------------------------------------------------------
   8.1) MENÚ MÓVIL
   ------------------------------------------------------------ */
const navBurger = $("#navBurger");
const navLinks = $("#navLinks");
navBurger.addEventListener("click", () => {
  const open = navLinks.classList.toggle("is-open");
  navBurger.classList.toggle("is-open", open);
  navBurger.setAttribute("aria-expanded", String(open));
});
$$("#navLinks a").forEach((a) => a.addEventListener("click", () => {
  navLinks.classList.remove("is-open");
  navBurger.classList.remove("is-open");
  navBurger.setAttribute("aria-expanded", "false");
}));

/* ------------------------------------------------------------
   9) CARRITO (localStorage)
   ------------------------------------------------------------ */
function loadCart() {
  try { return JSON.parse(localStorage.getItem("vg_cart")) || {}; }
  catch { return {}; }
}
function saveCart() {
  localStorage.setItem("vg_cart", JSON.stringify(cart));
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  saveCart();
  renderCart();
  updateCartCount();
}
function changeQty(id, delta) {
  if (!cart[id]) return;
  cart[id] += delta;
  if (cart[id] <= 0) delete cart[id];
  saveCart();
  renderCart();
  updateCartCount();
}
function removeFromCart(id) {
  delete cart[id];
  saveCart();
  renderCart();
  updateCartCount();
}

function updateCartCount() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const el = $("#cartCount");
  el.textContent = count;
  el.style.display = count ? "flex" : "none";
}

function cartEntries() {
  return Object.entries(cart)
    .map(([id, qty]) => ({ product: PRODUCTS.find((p) => p.id === id), qty }))
    .filter((e) => e.product);
}

function renderCart() {
  const entries = cartEntries();
  const itemsEl = $("#cartItems");
  const emptyEl = $("#cartEmpty");
  const footerEl = $("#cartFooter");

  if (!entries.length) {
    itemsEl.innerHTML = "";
    emptyEl.classList.remove("is-hidden");
    footerEl.classList.add("is-hidden");
    return;
  }

  emptyEl.classList.add("is-hidden");
  footerEl.classList.remove("is-hidden");

  itemsEl.innerHTML = entries.map(({ product: p, qty }) => `
    <div class="cart__item" data-id="${p.id}">
      <img src="${p.imagen || "assets/logo.png"}" alt="${p.nombre}" onerror="this.src='assets/logo.png'">
      <div class="cart__item-info">
        <p class="cart__item-name">${p.nombre}</p>
        <p class="cart__item-cat">${p.categoria}</p>
        <p class="cart__item-price">${formatPrice(p.precio * qty)}</p>
        <div class="cart__qty">
          <button data-action="dec" data-id="${p.id}" type="button" aria-label="Restar">−</button>
          <span>${qty}</span>
          <button data-action="inc" data-id="${p.id}" type="button" aria-label="Sumar">+</button>
        </div>
        <button class="cart__item-remove" data-action="remove" data-id="${p.id}" type="button">Quitar</button>
      </div>
    </div>`).join("");

  const total = entries.reduce((sum, { product: p, qty }) => sum + p.precio * qty, 0);
  $("#cartTotal").textContent = formatPrice(total);
}

$("#cartItems").addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const id = el.dataset.id;
  if (el.dataset.action === "inc") changeQty(id, 1);
  if (el.dataset.action === "dec") changeQty(id, -1);
  if (el.dataset.action === "remove") removeFromCart(id);
});

/* ------------------------------------------------------------
   10) DRAWER DEL CARRITO
   ------------------------------------------------------------ */
function openCart() {
  renderCart();
  $("#cart").classList.add("is-open");
  $("#cart").setAttribute("aria-hidden", "false");
  $("#overlay").classList.add("is-visible");
}
function closeCart() {
  $("#cart").classList.remove("is-open");
  $("#cart").setAttribute("aria-hidden", "true");
  $("#overlay").classList.remove("is-visible");
}
$("#cartToggle").addEventListener("click", openCart);
$("#cartClose").addEventListener("click", closeCart);
$("#overlay").addEventListener("click", closeCart);

/* ------------------------------------------------------------
   11) DERIVACIÓN A WHATSAPP / INSTAGRAM
   El sitio nunca cobra: solo arma el mensaje y abre el chat.
   ------------------------------------------------------------ */
function buildCartMessage() {
  const entries = cartEntries();
  if (!entries.length) return "Hola! Quería consultar por productos de VG Indumentaria.";

  const lines = entries.map(({ product: p, qty }) =>
    `• ${p.nombre} (${p.categoria}) x${qty} — ${formatPrice(p.precio * qty)}`
  );
  const total = entries.reduce((sum, { product: p, qty }) => sum + p.precio * qty, 0);

  return [
    "Hola! Quería consultar precio y disponibilidad de estos productos:",
    "",
    ...lines,
    "",
    `Total estimado: ${formatPrice(total)}`,
  ].join("\n");
}

function buildSingleProductMessage(p) {
  return `Hola! Quería consultar precio y disponibilidad de: ${p.nombre} (${p.categoria}) — ${formatPrice(p.precio)}`;
}

function goToWhatsApp(message) {
  const url = `https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener");
}

async function goToInstagram(message) {
  try {
    await navigator.clipboard.writeText(message);
    showToast("Mensaje copiado. Pegalo en el chat de Instagram que se abrió 👆");
  } catch {
    showToast("Abriendo Instagram — contanos qué productos te interesan");
  }
  window.open(IG_DM_URL, "_blank", "noopener");
}

function consultSingleProduct(p, channel) {
  const msg = buildSingleProductMessage(p);
  if (channel === "whatsapp") goToWhatsApp(msg);
  else goToInstagram(msg);
}

$("#waCart").addEventListener("click", () => goToWhatsApp(buildCartMessage()));
$("#igCart").addEventListener("click", () => goToInstagram(buildCartMessage()));

$("#waDirect").addEventListener("click", (e) => {
  e.preventDefault();
  goToWhatsApp("Hola! Quería consultar por productos de VG Indumentaria.");
});
$("#igDirect").addEventListener("click", (e) => {
  e.preventDefault();
  window.open(IG_PROFILE_URL, "_blank", "noopener");
});

/* ------------------------------------------------------------
   12) INIT
   ------------------------------------------------------------ */
updateCartCount();
loadProducts();