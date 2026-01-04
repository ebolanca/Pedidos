/* =============================================================
   MAIN.JS - Lógica Principal (Modular)
   ============================================================= */

import { firebaseConfig, ADMIN_EMAILS, PROVEEDORES_LECTOR, MAPA_USUARIOS } from './config.js';

// --- INICIALIZACIÓN FIREBASE ---
// Nota: Usamos la librería 'compat' cargada en el HTML, por lo que 'firebase' existe globalmente.
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
let db = firebase.firestore();
// Habilitar persistencia (caché offline)
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    console.log("Persistencia no disponible (posiblemente múltiples pestañas abiertas):", err.code);
});
let auth = firebase.auth();

// --- VARIABLES GLOBALES DEL MÓDULO ---
// IMPORTANTE: Cambia esto cada vez que subas cambios para forzar la actualización en los móviles
const CURRENT_CLIENT_VERSION = "10.3";

let currentUser, userRole, userName, currentProv, currentLectorProv;
let allProducts = [], cart = {}, cartNotes = {}, favorites = new Set();
let suggestions = {};
let v8_filter = 'todos', v8_expanded = true;
let v8_unsub = null;
let writeDebounceTimer = null;
let v9_currentData = {};
let v9_checkedIds = new Set();
let currentHistoryPedido = null;
let v9_sortMode = 'alpha';
let currentIVAProduct = null;

// --- FUNCIONES UTILITARIAS ---

window.onerror = function (message, source, lineno, colno, error) {
    const loader = document.getElementById('loading-screen');
    if (loader) loader.style.display = 'none';
};

function haptic() { if (navigator.vibrate) navigator.vibrate(15); }

function updateConnectionStatus() {
    if (navigator.onLine) document.body.classList.remove('offline');
    else document.body.classList.add('offline');
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();

function redirectToLogin() {
    setTimeout(() => { if (window.location.pathname.indexOf('login.html') === -1) window.location.href = "login.html"; }, 50);
}

// --- LÓGICA DE INICIO ---

/* main.js */
function iniciarApp() {
    auth.onAuthStateChanged(user => {
        const loader = document.getElementById('loading-screen');
        if (loader) loader.style.display = "none";

        if (user) {
            if (user.isAnonymous) {
                user.delete().catch(() => auth.signOut());
                return;
            }

            const userEmail = user.email || '';
            if (!userEmail) { redirectToLogin(); return; }

            currentUser = userEmail.trim().toLowerCase().replace(/\s/g, '');

            // LÓGICA DE ROLES
            if (ADMIN_EMAILS.includes(currentUser)) userRole = "admin";
            else userRole = "worker";

            userName = MAPA_USUARIOS[currentUser] || `Usuario (${currentUser})`;

            let displayName = userName;
            if (currentUser === 'moisesmonsalve04@gmail.com') displayName = "Moisés (Perfil Cristina)";

            if (document.getElementById("v8-userDisplay")) {
                document.getElementById("v8-userDisplay").innerText = displayName;
            }
            
            // CAMBIO AQUÍ: Mostramos la versión en la barra negra usando la constante global
            const debugBar = document.getElementById("debug-bar");
            if (debugBar) debugBar.innerText = `v${CURRENT_CLIENT_VERSION} | ${displayName}`;

            // Iniciamos el vigilante para que compruebe si esta versión coincide con la de Firebase
            initVersionWatcher();

            // Iniciamos la app
            initV8_GestionMode();

        } else {
            redirectToLogin();
        }
    });
}

// Iniciamos al cargar el DOM
document.addEventListener('DOMContentLoaded', iniciarApp);

function cerrarSesion() {
    haptic();
    auth.signOut().then(() => window.location.reload());
}

function cargarConfigLector() {
    const saved = localStorage.getItem("rail_lector_whitelist");
    if (saved) whitelistLector = new Set(JSON.parse(saved));
}

// --- FUNCIONES NUEVAS PARA CAMBIO DE MODO ---

function v8_entrarModoLector() {
    haptic();
    document.getElementById('app-mode-gestion').classList.add('hidden');
    // Reiniciamos el lector visual
    initV9_VisualMode();
}

function v9_salirModoLector() {
    haptic();
    document.getElementById('app-mode-visual').classList.add('hidden');
    // Aseguramos que la vista interna del lector (productos) también se cierre
    document.getElementById('v9-view-prods').classList.add('hidden');
    document.getElementById('v9-view-provs').classList.remove('hidden');

    // Volvemos a mostrar gestión
    document.getElementById('app-mode-gestion').classList.remove('hidden');
}

// --- MODO GESTIÓN (TRABAJADORES/ADMIN) ---

function initV8_GestionMode() {
    document.getElementById('app-mode-gestion').classList.remove('hidden');
    document.getElementById('v8-roleDisplay').innerText = userRole === 'admin' ? "Administrador" : "Personal";
    if (userRole === 'admin') document.getElementById("v8-admin-lector-toggle").classList.remove("hidden");
    cargarFavoritos();
    v8_cargarProveedores();
    v8_cargarDashboardHistorial();
}

function cargarFavoritos() {
    const key = `favs_${currentUser}`;
    const saved = localStorage.getItem(key);
    if (saved) favorites = new Set(JSON.parse(saved));
}
function toggleFav(id) {
    haptic();
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    localStorage.setItem(`favs_${currentUser}`, JSON.stringify([...favorites]));
    v8_renderTabla();
}

function v8_cargarProveedores() {
    const sel = document.getElementById("v8-proveedor");
    sel.innerHTML = '<option value="">Cargando...</option>';
    db.collection("proveedores").get().then(snap => {
        sel.innerHTML = '<option value="">-- Selecciona Proveedor --</option>';
        let list = [];
        snap.forEach(doc => {
            const d = doc.data();
            const resp = d.responsables || [];

            const userNormalized = userName.toLowerCase().trim();
            const isAllowed = Array.isArray(resp) && resp.some(r => r.toLowerCase().trim() === userNormalized);

            if (userRole === 'admin' || isAllowed || resp.includes("Todos")) {
                list.push(doc.id);
            }
        });
        list.sort().forEach(p => sel.innerHTML += `<option value="${p}">${p}</option>`);
    }).catch(err => {
        sel.innerHTML = '<option value="">Error cargando</option>';
    });
}

function v8_cargarDashboardHistorial() {
    const dashList = document.getElementById("v8-dash-list");
    dashList.innerHTML = "<div style='text-align:center;padding:10px'>Cargando...</div>";

    let q = db.collection("pedidos");
    if (userRole === 'worker') {
        q = q.where("email", "==", currentUser);
    }

    q.limit(20).get().then(snap => {
        if (snap.empty) {
            dashList.innerHTML = "<div style='text-align:center;padding:15px;color:#999'>No hay actividad reciente.</div>";
            return;
        }

        let pedidos = [];
        snap.forEach(doc => pedidos.push(doc.data()));
        pedidos.sort((a, b) => {
            let da = a.fecha && a.fecha.toDate ? a.fecha.toDate() : new Date(0);
            let db = b.fecha && b.fecha.toDate ? b.fecha.toDate() : new Date(0);
            return db - da;
        });
        pedidos = pedidos.slice(0, 10);

        let html = "";
        pedidos.forEach(d => {
            const f = d.fecha && d.fecha.toDate ? d.fecha.toDate() : new Date();
            const fechaStr = f.toLocaleDateString("es-ES", { day: '2-digit', month: '2-digit' });
            const horaStr = f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const esBorrado = d.estado === "borrado";
            const claseCard = esBorrado ? "v50-hist-card deleted" : "v50-hist-card";
            const claseStatus = esBorrado ? "v50-hist-status deleted" : "v50-hist-status";
            const textoStatus = esBorrado ? "CANCELADO" : "Enviado ✅";

            let userLine = "";
            if (userRole === 'admin' && !esBorrado) {
                userLine = `<div class="v50-hist-user">👤 ${d.usuario}</div>`;
            }

            let btnBorrarHtml = `
                  <div class="hist-delete-btn" onclick="event.stopPropagation(); v8_eliminarPedidoHistorial('${d.id_unico}', true)">
                     <span class="material-icons-round">delete</span>
                  </div>`;

            html += `
            <div class="${claseCard}">
                <div class="v50-hist-left" onclick="v8_verDetalleDesdeDashboard('${d.id_unico}')">
                    <div class="v50-hist-date">📅 ${fechaStr} ${horaStr}</div>
                    ${userLine}
                    <div class="v50-hist-prov">${d.proveedor}</div>
                </div>
                <div class="${claseStatus}">${textoStatus}</div>
                ${btnBorrarHtml}
            </div>`;
        });
        dashList.innerHTML = html;
    }).catch(e => {
        dashList.innerHTML = "<div style='text-align:center;padding:15px;color:red'>Error cargando historial.</div>";
    });
}

function v8_verDetalleDesdeDashboard(idUnico) {
    db.collection("pedidos").doc(idUnico).get().then(doc => {
        if (doc.exists) {
            currentHistoryPedido = doc.data();
            v8_mostrarModalDetalle(currentHistoryPedido);
        }
    });
}

function v8_cambiarProveedor() {
    if (v8_unsub) { v8_unsub(); v8_unsub = null; }
    currentProv = document.getElementById("v8-proveedor").value;
    const dashPanel = document.getElementById("v8-dashboard-panel");
    const prodArea = document.getElementById("v8-product-area");
    const bottomBar = document.getElementById("v8-bottom-bar");

    document.getElementById("v8-search-input").value = "";

    if (!currentProv) {
        dashPanel.classList.remove("hidden");
        prodArea.classList.add("hidden");
        bottomBar.classList.add("hidden");
        v8_cargarDashboardHistorial();
        return;
    }

    dashPanel.classList.add("hidden");
    prodArea.classList.remove("hidden");
    bottomBar.classList.remove("hidden");
    document.getElementById("v8-tabla-wrapper").innerHTML = '<div style="padding:20px;text-align:center">Cargando catálogo...</div>';

    cart = {}; cartNotes = {}; suggestions = {};

    db.collection("proveedores").doc(currentProv).collection("productos").get()
        .then(async snapProds => {
            let temp = [];
            snapProds.forEach(doc => {
                const d = doc.data();
                const r = d.responsable || "Todos";
                temp.push({ id: doc.id, ...d, responsable: r });
            });

            allProducts = temp;
            v8_activarSyncRealTime();
            v8_calcularSugerenciasBackground();
        })
        .catch(err => {
            document.getElementById("v8-tabla-wrapper").innerHTML = '<div style="padding:20px;text-align:center;color:red">Error cargando productos.</div>';
        });
}

function v8_activarSyncRealTime() {
    const docRef = db.collection("borradores").doc(currentProv);
    v8_unsub = docRef.onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            cart = data.items || {};
            cartNotes = data.notas || {};
        } else {
            cart = {}; cartNotes = {};
        }
        if (!writeDebounceTimer) {
            v8_renderTabla();
            document.getElementById("v8-totalCount").innerText = Object.keys(cart).length;
        }
    });
}

function v8_anadirManual() {
    haptic();
    if (!currentProv) return alert("Selecciona primero un proveedor.");
    const nombre = prompt("📝 Nombre del producto nuevo:");
    if (!nombre) return;
    const cantStr = prompt("📦 Cantidad:");
    if (!cantStr) return;
    const cant = parseFloat(cantStr);
    if (isNaN(cant) || cant <= 0) return alert("Cantidad inválida");
    const cleanName = nombre.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const idManual = `manual_${Date.now()}_${cleanName}`;
    cart[idManual] = cant;

    v8_setQty(idManual, cant);
}

function v8_actualizarValoresEnTabla() {
    allProducts.forEach(p => {
        const qty = cart[p.id] || "";
        const note = cartNotes[p.id] || "";
        const inp = document.getElementById(`inp_${p.id}`);
        const noteIcon = document.getElementById(`note_${p.id}`);
        if (inp && document.activeElement !== inp) { inp.value = qty; }
        if (inp) {
            const row = inp.closest('.v8-row');
            if (qty) { row.classList.add('v8-row-qty'); }
            else { row.classList.remove('v8-row-qty'); }
        }
        if (noteIcon) {
            if (note) noteIcon.classList.add('has-note'); else noteIcon.classList.remove('has-note');
        }
    });
    document.getElementById("v8-totalCount").innerText = Object.keys(cart).length;
}

function v8_escribirEnBorrador() {
    if (writeDebounceTimer) clearTimeout(writeDebounceTimer);
    writeDebounceTimer = setTimeout(() => {
        const docRef = db.collection("borradores").doc(currentProv);
        docRef.get().then(snap => {
            if (snap.exists) {
                docRef.update({
                    items: cart,
                    notas: cartNotes,
                    lastUpdate: new Date(),
                    user: userName
                }).then(() => { writeDebounceTimer = null; });
            } else {
                docRef.set({
                    items: cart,
                    notas: cartNotes,
                    lastUpdate: new Date(),
                    user: userName
                }).then(() => { writeDebounceTimer = null; });
            }
        }).catch(e => console.error("Error guardando:", e));
    }, 500);
}

function v8_setQty(id, val) {
    const oldQty = cart[id] || 0;
    let newQty = 0;
    if (val === "" || val === null || val === undefined) {
        delete cart[id];
        newQty = 0;
    } else {
        const numVal = parseFloat(val);
        if (isNaN(numVal) || numVal <= 0) { delete cart[id]; newQty = 0; }
        else { cart[id] = numVal; newQty = numVal; }
    }

    v8_autoGestionPeso(id, newQty, oldQty);
    v8_actualizarValoresEnTabla();
    v8_escribirEnBorrador();
    v8_renderTabla();
}

function v8_add(id, amount) {
    haptic();
    const oldQty = cart[id] || 0;
    let current = cart[id] || 0;
    let nuevo = current + amount;
    if (nuevo <= 0) {
        delete cart[id];
        nuevo = 0;
        const inp = document.getElementById(`inp_${id}`);
        if (inp) inp.value = "";
    } else {
        cart[id] = parseFloat(nuevo.toFixed(2));
    }

    v8_autoGestionPeso(id, nuevo, oldQty);
    v8_actualizarValoresEnTabla();
    v8_escribirEnBorrador();
    v8_renderTabla();
}

function v8_autoGestionPeso(id, newQty, oldQty) {
    if (!currentProv) return;
    if (newQty <= 0) {
        v8_actualizarPesoProducto(id, "");
    } else {
        const p = allProducts.find(x => x.id === id);
        if (p) {
            const currentWeight = (p.peso && parseFloat(p.peso) > 0) ? parseFloat(p.peso) : null;
            if (currentWeight === null || currentWeight === oldQty) {
                v8_actualizarPesoProducto(id, newQty);
            }
        }
    }
}

function v8_borrarBorrador() {
    haptic();
    if (confirm("¿Estás seguro de borrar TODO el pedido de " + currentProv + "?\n\nSe registrará en el historial como CANCELADO.")) {

        const d = new Date().toISOString().split('T')[0];
        const idBorrado = `DEL_${Date.now()}_${currentProv.replace(/[^a-zA-Z0-9]/g, '')}`;

        db.collection("pedidos").doc(idBorrado).set({
            id_unico: idBorrado,
            usuario: userName,
            email: currentUser,
            proveedor: currentProv,
            fecha: new Date(),
            fecha_corta: d,
            estado: "borrado",
            items: {}
        }).then(() => {
            cart = {}; cartNotes = {};
            db.collection("borradores").doc(currentProv).delete();
            v8_renderTabla();
            alert("🗑️ Lista borrada y evento registrado en historial.");
        });
    }
}

function v8_editarNota(id, nombreProd) {
    const actual = cartNotes[id] || "";
    const nueva = prompt(`Nota para ${nombreProd}:`, actual);
    if (nueva !== null) {
        if (nueva.trim()) cartNotes[id] = nueva.trim();
        else delete cartNotes[id];
        v8_actualizarValoresEnTabla();
        v8_escribirEnBorrador();
    }
}

async function v8_actualizarPrecioProducto(idProd, rawValue) {
    if (!currentProv) return;

    let val = parseFloat(rawValue.replace(',', '.'));
    if (isNaN(val)) val = 0;
    const nuevoPrecio = val.toFixed(2);

    const prodRef = db.collection("proveedores").doc(currentProv).collection("productos").doc(idProd);

    try {
        const doc = await prodRef.get();
        if (doc.exists) {
            const data = doc.data();
            const oldPrice = data.precio || "";
            let history = data.historialPrecios || [];

            if (oldPrice !== nuevoPrecio) {
                const now = new Date();
                const lastEntry = history.length > 0 ? history[history.length - 1] : null;
                let isCorrection = false;

                if (lastEntry && lastEntry.fecha) {
                    const lastTime = new Date(lastEntry.fecha).getTime();
                    const diffMins = (now.getTime() - lastTime) / 60000;
                    if (diffMins < 5) isCorrection = true;
                }

                if (isCorrection) {
                    history[history.length - 1] = {
                        fecha: now.toISOString(),
                        precio: nuevoPrecio
                    };
                    await prodRef.update({
                        precio: nuevoPrecio,
                        precioAnterior: data.precioAnterior || oldPrice,
                        historialPrecios: history
                    });
                } else {
                    history.push({ fecha: now.toISOString(), precio: nuevoPrecio });
                    if (history.length > 5) history = history.slice(-5);

                    await prodRef.update({
                        precio: nuevoPrecio,
                        precioAnterior: oldPrice,
                        historialPrecios: history
                    });
                }

                const p = allProducts.find(x => x.id === idProd);
                if (p) {
                    p.precio = nuevoPrecio;
                    if (!isCorrection) p.precioAnterior = oldPrice;
                    p.historialPrecios = history;
                }
                v8_renderTabla();
            }
        }
    } catch (e) { }
}

function v8_actualizarPesoProducto(idProd, nuevoPeso) {
    if (!currentProv) return;
    db.collection("proveedores").doc(currentProv).collection("productos").doc(idProd)
        .update({ peso: nuevoPeso })
        .then(() => {
            const p = allProducts.find(x => x.id === idProd);
            if (p) p.peso = nuevoPeso;
            v8_renderTabla();
        })
        .catch(e => console.error("Error al guardar peso:", e));
}

function v8_actualizarIVAProducto(idProd, val) {
    if (!currentProv) return;
    let n = parseFloat(val);
    if (isNaN(n) || n < 0) n = 0;

    const p = allProducts.find(x => x.id === idProd);
    if (p) p.iva = n;

    v8_renderTabla();

    db.collection("proveedores").doc(currentProv).collection("productos").doc(idProd)
        .update({ iva: n })
        .catch(e => console.error("Error guardando IVA:", e));
}

function v8_filtrarProductos() { v8_renderTabla(); document.getElementById("v8-search-input").focus(); }

function v8_verHistorialPrecios(idProd) {
    const p = allProducts.find(x => x.id === idProd);
    if (!p) return;

    const listaDiv = document.getElementById("listaPreciosHistorial");
    listaDiv.innerHTML = "";

    const history = p.historialPrecios || [];
    if (history.length === 0) {
        listaDiv.innerHTML = "<div style='padding:20px; text-align:center; color:#999'>No hay historial de cambios.</div>";
    } else {
        [...history].reverse().forEach(h => {
            const date = new Date(h.fecha).toLocaleDateString("es-ES", { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            listaDiv.innerHTML += `
                <div class="price-row">
                    <span class="price-date">${date}</span>
                    <span class="price-val">${h.precio}€</span>
                </div>
            `;
        });
    }

    document.getElementById("modalPrecioHistorial").style.display = "flex";
}

function v8_renderTabla() {
    const wrapper = document.getElementById("v8-tabla-wrapper");

    if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.classList.contains('v8-qty-simple')) {
        v8_actualizarValoresEnTabla();
        return;
    }

    wrapper.innerHTML = "";
    const groups = {};
    let hasItems = false;
    const searchEl = document.getElementById("v8-search-input");
    const searchText = searchEl ? searchEl.value.toLowerCase().trim() : "";

    let totalCoste = 0;
    let itemsOcultos = 0;

    for (const [id, qty] of Object.entries(cart)) {
        const p = allProducts.find(x => x.id === id);
        if (p) {
            const r = p.responsable ? p.responsable.trim() : "Todos";
            const isVisible = (userRole === 'admin' || r === "Todos" || r.includes(userName));

            if (!isVisible) itemsOcultos++;

            if (p.precio) {
                const precioBase = parseFloat(p.precio.replace(',', '.')) || 0;
                const ivaPct = parseFloat(p.iva) || 0;

                const precioConIva = precioBase * (1 + (ivaPct / 100));
                const factorFinal = (p.peso && parseFloat(p.peso) > 0) ? parseFloat(p.peso) : parseFloat(qty);

                if (precioBase > 0) {
                    totalCoste += precioConIva * factorFinal;
                }
            }
        }
    }

    let hiddenMsg = "";
    if (itemsOcultos > 0) hiddenMsg = `(+${itemsOcultos} de otros)`;

    document.getElementById("v8-totalCount").innerHTML = `${Object.keys(cart).length} <span style="font-size:10px">${hiddenMsg}</span> <span style="opacity:0.5; margin:0 5px">|</span> <span style="color:#28a745">${totalCoste.toFixed(2)}€</span>`;

    const allIds = new Set(allProducts.map(p => p.id));
    for (const [id, qty] of Object.entries(cart)) {
        if (!allIds.has(id) && id.startsWith("manual_")) {
            const parts = id.split('_');
            let realName = "Producto Manual";
            if (parts.length >= 3) { realName = parts.slice(2).join(' ').replace(/_/g, ' '); }
            const manualProd = { id: id, nombre: realName, unidad: "Manual", categoria: "📌 Extras / Manual", esManual: true, responsable: "Todos" };
            if (!groups[manualProd.categoria]) groups[manualProd.categoria] = [];
            groups[manualProd.categoria].push(manualProd);
            hasItems = true;
        }
    }

    allProducts.forEach(p => {
        const r = p.responsable ? p.responsable.trim() : "Todos";
        if (userRole !== 'admin' && r !== "Todos" && !r.includes(userName)) return;

        if (searchText && !p.nombre.toLowerCase().includes(searchText)) return;
        if (v8_filter === 'pedido' && !cart[p.id]) return;
        if (v8_filter === 'favoritos' && !favorites.has(p.id)) return;

        const cat = p.categoria || "General";
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(p); hasItems = true;
    });

    if (!hasItems) { wrapper.innerHTML = `<div style="text-align:center; padding:30px; color:#999">Nada que mostrar</div>`; return; }

    let catKeys = Object.keys(groups).sort();
    if (catKeys.includes("📌 Extras / Manual")) { catKeys = catKeys.filter(c => c !== "📌 Extras / Manual"); catKeys.unshift("📌 Extras / Manual"); }

    const esAdmin = (userRole === 'admin');

    catKeys.forEach(cat => {
        const cid = cat.replace(/\W/g, '_');
        const isExpanded = v8_expanded || searchText !== "";
        const header = document.createElement("div");
        header.className = "v8-cat-header";
        header.innerHTML = `<span>${cat}</span>`;
        header.onclick = () => v8_toggleCat(cid);
        wrapper.appendChild(header);

        const catContainer = document.createElement("div");
        catContainer.className = `cat-group-${cid}`;
        if (!isExpanded) catContainer.style.display = 'none';

        groups[cat].sort((a, b) => a.nombre.localeCompare(b.nombre));

        groups[cat].forEach(p => {
            const isFav = favorites.has(p.id);
            const qty = cart[p.id] || "";
            const hasNote = cartNotes[p.id] ? "has-note" : "";
            const rowClass = p.esManual ? 'v8-row v8-row-manual' : `v8-row ${qty ? 'v8-row-qty' : ''}`;

            const row = document.createElement("div");
            row.className = rowClass;

            let sugHtml = `<div class="v8-suggestion" id="sug_${p.id}"></div>`;
            if (suggestions[p.id] > 0 && !p.esManual) sugHtml = `<div class="v8-suggestion" id="sug_${p.id}"><button class="v8-btn-sug" onclick="v8_setQty('${p.id}', ${suggestions[p.id]})">${suggestions[p.id]}</button></div>`;

            const precioBaseStr = p.precio || "";
            const pesoVal = p.peso || "";
            const ivaVal = parseFloat(p.iva) || 0;

            let htmlPrecio = "";
            let rowTotalHtml = "";

            // CALCULO DE TOTALES VISUALES
            if (qty > 0 && precioBaseStr) {
                const pNum = parseFloat(precioBaseStr.replace(',', '.'));
                const precioFinalUnitario = pNum * (1 + (ivaVal / 100));
                const multiplicador = (pesoVal && parseFloat(pesoVal) > 0) ? parseFloat(pesoVal) : parseFloat(qty);

                if (!isNaN(pNum)) {
                    const totalRow = (precioFinalUnitario * multiplicador).toFixed(2);
                    let infoIva = ivaVal > 0 ? `<span style="font-size:9px; color:#666"> (IVA ${ivaVal}%)</span>` : '';
                    rowTotalHtml = `<span style="font-size:11px; color:#1565c0; font-weight:700; margin-left:6px; background:#e3f2fd; padding:1px 4px; border-radius:3px">= ${totalRow}€${infoIva}</span>`;
                }
            }

            // SI ES ADMIN (quiebrakanto), VE TODA LA HERRAMIENTA
            if (esAdmin) {
                let semaforoHtml = "";
                if (p.precioAnterior && precioBaseStr) {
                    const currentP = parseFloat(precioBaseStr.replace(',', '.'));
                    const prevP = parseFloat(p.precioAnterior.replace(',', '.'));
                    if (!isNaN(currentP) && !isNaN(prevP)) {
                        if (currentP > prevP) semaforoHtml = `<span class="material-icons-round" style="font-size:16px; color:#dc3545; margin-left:4px">thumb_down</span>`;
                        else if (currentP < prevP) semaforoHtml = `<span class="material-icons-round" style="font-size:16px; color:#28a745; margin-left:4px">thumb_up</span>`;
                    }
                }

                const historyIconHtml = `<span class="material-icons-round" style="font-size:16px; color:#007bff; margin-left:4px; cursor:pointer" onclick="event.stopPropagation(); v8_verHistorialPrecios('${p.id}')">show_chart</span>`;

                const ivaOptions = [0, 4, 10, 21];
                let optionsHtml = "";
                ivaOptions.forEach(opt => {
                    const sel = (ivaVal === opt) ? "selected" : "";
                    const label = opt === 0 ? "IVA 0%" : `${opt}%`;
                    optionsHtml += `<option value="${opt}" ${sel}>${label}</option>`;
                });

                const ivaSelectHtml = `<select class="v8-iva-select" onchange="v8_actualizarIVAProducto('${p.id}', this.value)" onclick="event.stopPropagation()">${optionsHtml}</select>`;

                let labelPrecioFinal = "";
                if (precioBaseStr && ivaVal > 0) {
                    const baseNum = parseFloat(precioBaseStr.replace(',', '.'));
                    if (!isNaN(baseNum)) {
                        const final = (baseNum * (1 + ivaVal / 100)).toFixed(2);
                        labelPrecioFinal = `<div style="font-size:10px; color:#1976d2; margin-top:2px; font-weight:600">Total: ${final}€</div>`;
                    }
                }

                htmlPrecio = `<div style="display:flex; align-items:center; margin-left:8px;">
                    <input type="number" value="${pesoVal}" 
                        placeholder="Kg/Ud"
                        style="width:40px; border:1px solid #ced4da; border-radius:4px; padding:2px; font-size:11px; text-align:center; color:#666; margin-right:4px; background:#f9f9f9"
                        onchange="v8_actualizarPesoProducto('${p.id}', this.value)"
                        onclick="event.stopPropagation()">
                    
                    <div style="display:flex; flex-direction:column; align-items:end">
                        <div style="display:flex; align-items:center">
                            <span style="color:#28a745; font-size:12px; margin-right:1px">€</span>
                            <input type="text" value="${precioBaseStr}" 
                                placeholder="Base"
                                style="width:45px; border:1px solid #ced4da; border-radius:4px; padding:2px; font-size:13px; text-align:right; color:#28a745; font-weight:bold"
                                onchange="v8_actualizarPrecioProducto('${p.id}', this.value)"
                                onclick="event.stopPropagation()">
                        </div>
                        ${labelPrecioFinal}
                    </div>

                    ${semaforoHtml}
                    ${historyIconHtml}
                    ${rowTotalHtml}
                </div>`;

                row.innerHTML = `
                    <div class="v8-prod-info">
                        <span class="v8-star ${isFav ? 'fav' : ''}" onclick="toggleFav('${p.id}')">★</span>
                        <div class="v8-text-col">
                            <div class="v8-name-row" style="display:flex; align-items:center">
                                <div class="v8-prod-name">${p.nombre}</div>
                                <span class="material-icons-round v8-note-icon ${hasNote}" id="note_${p.id}" onclick="v8_editarNota('${p.id}', '${p.nombre.replace(/'/g, "")}')">edit</span>
                                ${p.esManual ? '' : ivaSelectHtml} 
                            </div>
                            <div style="display:flex; align-items:center; margin-top:4px;">
                                <span class="v8-prod-unit">${p.unidad || ''}</span>
                                ${htmlPrecio}
                            </div>
                        </div>
                    </div>
                    ${sugHtml}
                    <input type="number" inputmode="decimal" class="v8-qty-simple" value="${qty}" id="inp_${p.id}" 
                           placeholder="0" onfocus="this.select()" onkeyup="v8_setQty('${p.id}', this.value)" onchange="v8_setQty('${p.id}', this.value)">
                `;

            } else {
                // SI ES TRABAJADOR
                row.innerHTML = `
                    <div class="v8-prod-info">
                        <span class="v8-star ${isFav ? 'fav' : ''}" onclick="toggleFav('${p.id}')">★</span>
                        <div class="v8-text-col">
                            <div class="v8-name-row" style="display:flex; align-items:center">
                                <div class="v8-prod-name">${p.nombre}</div>
                                <span class="material-icons-round v8-note-icon ${hasNote}" id="note_${p.id}" onclick="v8_editarNota('${p.id}', '${p.nombre.replace(/'/g, "")}')">edit</span>
                            </div>
                            <div style="display:flex; align-items:center; margin-top:4px;">
                                <span class="v8-prod-unit">${p.unidad || ''}</span>
                            </div>
                        </div>
                    </div>
                    ${sugHtml}
                    <input type="number" inputmode="decimal" class="v8-qty-simple" value="${qty}" id="inp_${p.id}" 
                           placeholder="0" onfocus="this.select()" onkeyup="v8_setQty('${p.id}', this.value)" onchange="v8_setQty('${p.id}', this.value)">
                `;
            }

            catContainer.appendChild(row);
        });
        wrapper.appendChild(catContainer);
    });
    document.getElementById("v8-totalCount").innerText = Object.keys(cart).length;
}

function v8_toggleCat(cid) { const el = document.querySelector(`.cat-group-${cid}`); if (el) el.style.display = (el.style.display === 'none') ? 'block' : 'none'; }
function v8_toggleFiltro(f) { haptic(); v8_filter = (v8_filter === f) ? 'todos' : f; v8_renderTabla(); }
function v8_toggleExpansion() { haptic(); v8_expanded = !v8_expanded; v8_renderTabla(); }

function v8_calcularSugerenciasBackground() {
    db.collection("pedidos").where("proveedor", "==", currentProv).limit(20).get()
        .then(snapHist => {
            if (snapHist.empty) return;
            const sums = {}; const counts = {};
            snapHist.forEach(doc => {
                const items = doc.data().items || {};
                for (const [pid, qty] of Object.entries(items)) {
                    const q = parseFloat(qty);
                    if (q > 0) { sums[pid] = (sums[pid] || 0) + q; counts[pid] = (counts[pid] || 0) + 1; }
                }
            });
            for (const pid in sums) {
                const avg = sums[pid] / counts[pid];
                suggestions[pid] = Math.round(avg);
                if (suggestions[pid] === 0) suggestions[pid] = null;

                const sugSlot = document.getElementById(`sug_${pid}`);
                if (sugSlot && suggestions[pid] > 0) sugSlot.innerHTML = `<button class="v8-btn-sug" onclick="v8_setQty('${pid}', ${suggestions[pid]})">${suggestions[pid]}</button>`;
            }
        }).catch(e => { });
}

function v8_compartir(metodo) {
    haptic();
    if (Object.keys(cart).length === 0) return alert("El pedido está vacío.");
    const texto = v8_generarTextoResumen();

    if (metodo === 'whatsapp') {
        const storageKey = `rail_contact_wa_${currentProv}`;
        let phone = localStorage.getItem(storageKey);
        if (!phone) {
            phone = prompt(`📱 Introduce el teléfono de ${currentProv} (con prefijo 34):`, "34");
            if (!phone) return;
            localStorage.setItem(storageKey, phone.replace(/\D/g, ''));
        }
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`;
        window.open(url, '_blank');
    }
    else if (metodo === 'email') {
        if (currentProv.toLowerCase().includes("reyes") && currentProv.toLowerCase().includes("magos")) {
            const subject = `PEDIDO DE: ${userName.toUpperCase()} - ${currentProv}`;
            const url = `mailto:bodegareyesmagos@hotmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(texto)}`;
            window.location.href = url;
            return;
        }

        const storageKey = `rail_contact_mail_${currentProv}`;
        let email = localStorage.getItem(storageKey);
        if (!email) {
            email = prompt(`📧 Introduce el email de ${currentProv}:`, "");
            if (!email) return;
            localStorage.setItem(storageKey, email.trim());
        }
        const subject = `Pedido ${currentProv} - ${userName}`;
        const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(texto)}`;
        window.location.href = url;
    }
}

function guardarPedidoFinal() {
    haptic();
    if (Object.keys(cart).length === 0) return alert("Vacío.");

    let msgConfirm = "¿Enviar pedido y guardarlo en el historial?\n\n(Los productos seguirán marcados hasta que los borres manualmente)";
    if (!navigator.onLine) msgConfirm += "\n\n⚠️ ESTÁS OFFLINE: El pedido se guardará en tu móvil y se enviará automáticamente cuando recuperes la conexión.";

    if (!confirm(msgConfirm)) return;

    const btn = document.querySelector('.v8-send-btn');
    btn.innerText = "..."; btn.disabled = true;
    const d = new Date().toISOString().split('T')[0];
    const id = `${d}_${currentProv.replace(/[^a-zA-Z0-9]/g, '')}_${userName.replace(/[^a-zA-Z0-9]/g, '')}`;

    db.collection("pedidos").doc(id).set({
        id_unico: id, usuario: userName, email: currentUser, proveedor: currentProv,
        fecha: new Date(), fecha_corta: d, estado: "enviado", items: cart, notas: cartNotes
    }, { merge: true }).then(() => {
        if (!navigator.onLine) alert("📴 Guardado OFFLINE. Se subirá al recuperar conexión.");
        else alert("✅ Guardado en Historial.\nRECUERDA: Borra los productos cuando llegue la mercancía.");
    }).catch(e => { alert("❌ Error: " + e.message); }).finally(() => {
        btn.innerText = "ENVIAR"; btn.disabled = false;
    });
}

function v8_generarTextoResumen(pedidoData = null) {
    const items = pedidoData ? pedidoData.items : cart;
    const notes = pedidoData ? pedidoData.notas : cartNotes;
    const prov = pedidoData ? pedidoData.proveedor : currentProv;
    const user = pedidoData ? pedidoData.usuario : userName;

    let dateStr = "";
    if (pedidoData && pedidoData.fecha) {
        try { dateStr = pedidoData.fecha.toDate().toLocaleDateString("es-ES", { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { }
    } else {
        dateStr = new Date().toLocaleDateString("es-ES", { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    let t = `📝 PEDIDO ${prov}\n`;
    t += `👤 ${user} | 📅 ${dateStr}\n`;
    t += `--------------------------------\n`;

    const lineas = [];
    const manuales = [];

    for (const [pid, qty] of Object.entries(items)) {
        if (qty > 0) {
            if (pid.startsWith("manual_")) {
                const parts = pid.split('_');
                const nombre = parts.length >= 3 ? parts.slice(2).join(' ').replace(/_/g, ' ') : "Extra";
                const nota = notes && notes[pid] ? ` (👀 ${notes[pid]})` : "";
                manuales.push({ nombre, qty, unidad: "ud", nota });
            } else {
                const p = allProducts.find(x => x.id === pid);
                const nombre = p ? p.nombre : pid;
                const unidad = p ? (p.unidad || "") : "";
                const nota = notes && notes[pid] ? ` (👀 ${notes[pid]})` : "";
                lineas.push({ nombre, qty, unidad, nota });
            }
        }
    }

    if (manuales.length > 0) {
        t += `--- EXTRAS MANUALES ---\n`;
        manuales.forEach(l => { t += `▪️ ${l.qty} ${l.unidad} - ${l.nombre}${l.nota}\n`; });
        t += `\n`;
    }

    lineas.sort((a, b) => a.nombre.localeCompare(b.nombre));
    lineas.forEach(l => { t += `▪️ ${l.qty} ${l.unidad} - ${l.nombre}${l.nota}\n`; });
    t += `--------------------------------`;
    return t;
}

// --- HISTORIAL & MODALES ---

function v8_historialSimple() {
    haptic();
    document.getElementById("historialProvName").innerText = currentProv;
    const listContent = document.getElementById("historialListContent");
    listContent.innerHTML = "<div style='text-align:center;padding:10px;color:#999'>Cargando...</div>";
    document.getElementById("modalHistorialSimple").style.display = "flex";

    db.collection("pedidos")
        .where("proveedor", "==", currentProv)
        .limit(20)
        .get()
        .then(snap => {
            if (snap.empty) {
                listContent.innerHTML = "<div style='text-align:center;padding:20px;color:#999'>No hay historial reciente para este proveedor.</div>";
                return;
            }

            let pedidos = [];
            snap.forEach(doc => pedidos.push(doc.data()));

            pedidos = pedidos.filter(p => p.estado !== 'borrado');

            pedidos.sort((a, b) => {
                let da = a.fecha && a.fecha.toDate ? a.fecha.toDate() : new Date(0);
                let db = b.fecha && b.fecha.toDate ? b.fecha.toDate() : new Date(0);
                return db - da;
            });

            let html = "";
            window.tempPedidosHistorial = pedidos;

            pedidos.forEach((d, index) => {
                let fechaStr = "Fecha desconocida";
                try {
                    if (d.fecha && d.fecha.toDate) {
                        fechaStr = d.fecha.toDate().toLocaleDateString("es-ES", { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                    }
                } catch (e) { }

                const itemsCount = d.items ? Object.keys(d.items).length : 0;
                const esBorrado = d.estado === 'borrado';
                const styleBorrado = esBorrado ? "opacity:0.6; background:#fff5f5" : "";

                html += `
             <div class="hist-item-simple" style="${styleBorrado}">
                 <div class="hist-item-content" onclick="v8_verDetalleHistorial(${index})">
                     <div>${fechaStr} ${esBorrado ? '(CANCELADO)' : ''}</div>
                     <span>👤 ${d.usuario} - ${itemsCount} productos</span>
                 </div>
                 <div class="hist-delete-btn" onclick="event.stopPropagation(); v8_eliminarPedidoHistorial('${d.id_unico}')">
                    <span class="material-icons-round">delete</span>
                 </div>
             </div>`;
            });

            listContent.innerHTML = html;
        })
        .catch(err => {
            listContent.innerHTML = `<div style='text-align:center;padding:20px;color:red'>
              Error cargando historial.<br><small>(${err.message})</small>
          </div>`;
        });
}

function v8_eliminarPedidoHistorial(idPedido, esDashboard = false) {
    haptic();
    if (!confirm("¿Borrar definitivamente este pedido del historial?\n\n(Desaparecerá de la lista)")) return;

    db.collection("pedidos").doc(idPedido).delete().then(() => {
        if (esDashboard) v8_cargarDashboardHistorial();
        else v8_historialSimple();
    }).catch(err => {
        alert("Error al borrar: " + err.message);
    });
}

async function v8_mostrarModalDetalle(pedido) {
    currentHistoryPedido = pedido;

    document.getElementById("modalHistorialSimple").style.display = "none";
    document.getElementById("modalDetallePedido").style.display = "flex";

    let fechaStr = "";
    try { fechaStr = pedido.fecha.toDate().toLocaleDateString("es-ES", { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { }

    document.getElementById("detalleTitulo").innerText = `${pedido.proveedor} (${fechaStr})`;
    document.getElementById("detallePedidoContent").innerHTML = "<div style='text-align:center;padding:20px'>Buscando nombres reales...</div>";

    let catalogoMap = {};

    if (currentProv === pedido.proveedor && allProducts.length > 0) {
        allProducts.forEach(p => catalogoMap[p.id] = p.nombre);
    } else {
        try {
            const snap = await db.collection("proveedores").doc(pedido.proveedor).collection("productos").get();
            snap.forEach(doc => {
                catalogoMap[doc.id] = doc.data().nombre;
            });
        } catch (e) { console.log("Error cargando catálogo auxiliar", e); }
    }

    renderDetalleConNombres(pedido, catalogoMap);
}

function renderDetalleConNombres(pedido, catalogoMap) {
    let itemsHtml = `<div style="padding:5px; color:#555; font-family:'Inter',sans-serif">`;
    itemsHtml += `<div style="margin-bottom:10px; font-weight:700; color:#333; font-size:15px">👤 ${pedido.usuario}</div>`;

    const items = pedido.items || {};
    const notes = pedido.notas || {};
    const lineas = [];

    for (const [pid, qty] of Object.entries(items)) {
        if (qty > 0) {
            let nombre = catalogoMap[pid] || pid;
            let unidad = "";
            let nota = notes[pid] || "";

            if (pid.startsWith("manual_")) {
                const parts = pid.split('_');
                nombre = parts.length >= 3 ? parts.slice(2).join(' ').replace(/_/g, ' ') : "Extra Manual";
                unidad = "ud";
            }

            lineas.push({ nombre, qty, unidad, nota });
        }
    }

    lineas.sort((a, b) => a.nombre.localeCompare(b.nombre));

    lineas.forEach(l => {
        let noteBlock = "";
        if (l.nota) noteBlock = `<div style="margin-top:2px; font-size:12px; color:#007bff; font-weight:600">📝 ${l.nota}</div>`;

        itemsHtml += `
        <div style="padding:8px 0; border-bottom:1px solid #eee; font-size:14px">
            <div style="display:flex; justify-content:space-between">
                <span>${l.nombre}</span>
                <strong style="color:#007bff; margin-left:10px; white-space:nowrap">${l.qty} ${l.unidad}</strong>
            </div>
            ${noteBlock}
        </div>`;
    });

    itemsHtml += `</div>`;
    document.getElementById("detallePedidoContent").innerHTML = itemsHtml;
}

function v8_verDetalleHistorial(index) {
    const pedido = window.tempPedidosHistorial[index];
    if (!pedido) return;
    v8_mostrarModalDetalle(pedido);
}

function v8_copiarTextoHistorial() {
    if (!currentHistoryPedido) return;
    const texto = v8_generarTextoResumen(currentHistoryPedido);
    navigator.clipboard.writeText(texto).then(() => {
        alert("✅ Texto copiado al portapapeles");
    }).catch(err => {
        alert("No se pudo copiar automáticamente. Selecciónalo y cópialo manual.");
    });
}

function v8_cargarPedidoHistorial() {
    if (!currentHistoryPedido) return;
    const provSelect = document.getElementById("v8-proveedor");
    provSelect.value = currentHistoryPedido.proveedor;

    if (provSelect.value !== currentHistoryPedido.proveedor) {
        alert("⚠️ No tienes acceso a este proveedor o no existe en tu lista.");
        return;
    }

    if (!confirm("⚠️ ¿Quieres CARGAR estos productos en tu lista actual?\n\nSe sobreescribirá lo que tengas ahora mismo en el borrador.")) return;

    v8_cambiarProveedor();

    setTimeout(() => {
        cart = { ...currentHistoryPedido.items };
        cartNotes = { ...currentHistoryPedido.notas };

        v8_renderTabla();
        v8_escribirEnBorrador();

        document.getElementById("modalDetallePedido").style.display = "none";
        alert("✅ Pedido cargado correctamente.");
    }, 500);
}

// --- MODO LECTOR (VISUAL) ---

function initV9_VisualMode() {
    document.getElementById('app-mode-visual').classList.remove('hidden');
    v9_cargarProveedoresResumen();
    v9_cargarHistorialDashboard();
}

function v9_toggleSortMode() {
    haptic();
    const btn = document.getElementById('v9-sort-icon');
    if (v9_sortMode === 'alpha') {
        v9_sortMode = 'category';
        btn.innerText = 'category';
    } else {
        v9_sortMode = 'alpha';
        btn.innerText = 'sort_by_alpha';
    }
    v9_renderListaLector();
}

async function v9_cargarProveedoresResumen() {
    const cont = document.getElementById("v9-prov-list");
    cont.innerHTML = "<div style='text-align:center;padding:20px'>Buscando pedidos...</div>";

    // LISTA DE SEGURIDAD: Si falla la importación de config.js, usamos esta.
    const LISTA_PROVS = (typeof PROVEEDORES_LECTOR !== 'undefined' && PROVEEDORES_LECTOR.length > 0)
        ? PROVEEDORES_LECTOR
        : ["Chinos", "Inde", "Vecino", "Mercadona", "Mercamadrid", "Supeco", "Makro"];

    try {
        const snap = await db.collection("borradores").get();
        const provs = [];

        snap.forEach(doc => {
            // Lógica permisiva (General): Si existe el borrador...
            if (LISTA_PROVS.includes(doc.id)) {
                provs.push(doc.id);
            }
        });

        cont.innerHTML = "";
        const sorted = provs.sort();

        if (sorted.length === 0) {
            cont.innerHTML = "<div style='text-align:center;padding:20px;color:#999'>No hay listas activas.<br><small>Si acabas de borrar una, crea un pedido nuevo desde el Admin.</small></div>";
            return;
        }

        sorted.forEach(p => {
            const div = document.createElement("div");
            div.className = "v9-card";

            // Botón de borrar con stopPropagation
            let btnDel = `<div onclick="event.stopPropagation(); v9_borrarBorradorDirecto('${p}')" style="background:#ffebee; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#d32f2f; cursor:pointer"><span class="material-icons-round" style="font-size:20px">delete</span></div>`;

            // Click principal
            div.setAttribute("onclick", `v9_abrirProveedorResumen('${p}')`);

            div.innerHTML = `
               <div style="font-weight:600; font-size:16px">${p}</div>
               <div style="display:flex; align-items:center; gap:10px">
                   ${btnDel}
                   <span class="material-icons-round" style="color:#ccc">chevron_right</span>
               </div>
            `;
            cont.appendChild(div);
        });
    } catch (e) {
        console.error(e);
        cont.innerHTML = "<div style='text-align:center;color:red;padding:20px'>Error cargando lista: " + e.message + "</div>";
    }
}

function v9_borrarBorradorDirecto(provName) {
    haptic();
    if (!confirm(`⚠️ ¿Borrar la lista de ${provName}?\n(Desaparecerá para todos)`)) return;

    db.collection("borradores").doc(provName).delete()
        .then(() => {
            v9_cargarProveedoresResumen();
        })
        .catch(e => {
            console.log("Error borrando:", e);
            v9_cargarProveedoresResumen();
        });
}

function v9_cargarHistorialDashboard() {
    const dashList = document.getElementById("v9-dash-list");
    dashList.innerHTML = "<div style='text-align:center;padding:10px'>Cargando historial...</div>";

    db.collection("pedidos").limit(50).get().then(snap => {
        if (snap.empty) {
            dashList.innerHTML = "<div style='text-align:center;padding:15px;color:#999'>Sin historial reciente.</div>";
            return;
        }

        let pedidos = [];
        snap.forEach(doc => pedidos.push(doc.data()));
        pedidos.sort((a, b) => {
            let da = a.fecha && a.fecha.toDate ? a.fecha.toDate() : new Date(0);
            let db = b.fecha && b.fecha.toDate ? b.fecha.toDate() : new Date(0);
            return db - da;
        });

        pedidos = pedidos.filter(p => PROVEEDORES_LECTOR.includes(p.proveedor));
        pedidos = pedidos.slice(0, 10);

        if (pedidos.length === 0) {
            dashList.innerHTML = "<div style='text-align:center;padding:15px;color:#999'>Sin historial reciente (para ti).</div>";
            return;
        }

        let html = "";
        pedidos.forEach(d => {
            const f = d.fecha && d.fecha.toDate ? d.fecha.toDate() : new Date();
            const fechaStr = f.toLocaleDateString("es-ES", { day: '2-digit', month: '2-digit' });
            const horaStr = f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const esBorrado = d.estado === "borrado";
            const colorBorde = esBorrado ? "#dc3545" : "#007bff";
            const colorTexto = esBorrado ? "#dc3545" : "#007bff";
            const bgTexto = esBorrado ? "#ffebee" : "#e3f2fd";
            const textoEstado = esBorrado ? "BORRADO" : "Enviado";

            let btnBorrarHtml = `
                  <div class="hist-delete-btn" onclick="v8_eliminarPedidoHistorial('${d.id_unico}', false); setTimeout(v9_cargarHistorialDashboard, 500);">
                     <span class="material-icons-round">delete</span>
                  </div>`;

            html += `
            <div class="v50-hist-card" style="border-left: 4px solid ${colorBorde};">
                <div class="v50-hist-left">
                    <div class="v50-hist-date">📅 ${fechaStr} ${horaStr} - 👤 ${d.usuario}</div>
                    <div class="v50-hist-prov">${d.proveedor}</div>
                </div>
                <div class="v50-hist-status" style="color:${colorTexto}; background:${bgTexto}; margin-right:5px">${textoEstado}</div>
                ${btnBorrarHtml}
            </div>`;
        });
        dashList.innerHTML = html;
    });
}

async function v9_abrirProveedorResumen(provName) {
    currentLectorProv = provName;
    document.getElementById("v9-view-provs").classList.add("hidden");
    document.getElementById("v9-view-prods").classList.remove("hidden");
    document.getElementById("v9-prov-title").innerText = provName;
    document.getElementById("v9-prod-list").innerHTML = "<div style='padding:20px;text-align:center'>Cargando detalle...</div>";
    v9_checkedIds.clear();

    try {
        const doc = await db.collection("borradores").doc(provName).get();
        if (!doc.exists) { document.getElementById("v9-prod-list").innerHTML = "Borrador vacío."; return; }

        v9_currentData = doc.data();
        v9_currentData.catalogoNombres = {};
        v9_currentData.catalogoCategorias = {};
        v9_currentData.catalogoPrecios = {};
        v9_currentData.catalogoPesos = {};

        v9_currentData.catalogoIvas = {};

        try {
            const snapCat = await db.collection("proveedores").doc(provName).collection("productos").get();
            snapCat.forEach(d => {
                const data = d.data();
                v9_currentData.catalogoNombres[d.id] = data.nombre;
                v9_currentData.catalogoCategorias[d.id] = data.categoria || "General";
                v9_currentData.catalogoPrecios[d.id] = data.precio || "";
                v9_currentData.catalogoPesos[d.id] = data.peso || "1";
                v9_currentData.catalogoIvas[d.id] = data.iva || 0;
            });
        } catch (e) { }

        v9_renderListaLector();

    } catch (e) { document.getElementById("v9-prod-list").innerHTML = "Error: " + e.message; }
}

function v9_renderListaLector() {
    const items = v9_currentData.items || {};
    const notas = v9_currentData.notas || {};
    const catalogo = v9_currentData.catalogoNombres || {};
    const categorias = v9_currentData.catalogoCategorias || {};
    const precios = v9_currentData.catalogoPrecios || {};
    const pesos = v9_currentData.catalogoPesos || {};
    const ivas = v9_currentData.catalogoIvas || {};

    let totalLector = 0;
    for (let k in items) {
        if (items[k] > 0 && precios[k]) {
            const pBase = parseFloat(precios[k].replace(',', '.'));
            const ivaVal = parseFloat(ivas[k]) || 0;

            // CALCULO v94: Base + IVA
            const pConIva = pBase * (1 + ivaVal / 100);

            const pPeso = (pesos[k] && parseFloat(pesos[k]) > 0) ? parseFloat(pesos[k]) : parseFloat(items[k]);

            if (!isNaN(pBase)) totalLector += pConIva * pPeso;
        }
    }

    const tituloDiv = document.getElementById("v9-prov-title");
    if (!tituloDiv.innerHTML.includes("Est:")) {
        tituloDiv.innerHTML = `${currentLectorProv} <div style="font-size:13px; color:#28a745; margin-top:-2px; font-weight:600">Est: ${totalLector.toFixed(2)}€</div>`;
    } else {
        tituloDiv.innerHTML = `${currentLectorProv} <div style="font-size:13px; color:#28a745; margin-top:-2px; font-weight:600">Est: ${totalLector.toFixed(2)}€</div>`;
    }

    let lista = [];

    for (let k in items) {
        if (items[k] > 0) {
            let nombreReal = catalogo[k];
            let categoriaReal = categorias[k] || "General";
            let precioReal = v9_currentData.catalogoPrecios ? v9_currentData.catalogoPrecios[k] : "";

            if (!nombreReal) {
                if (k.startsWith("manual_")) { const parts = k.split('_'); nombreReal = parts.length >= 3 ? parts.slice(2).join(' ').replace(/_/g, ' ') + " (M)" : "Manual"; categoriaReal = "Manual"; }
                else { const parts = k.split('_'); nombreReal = parts.length > 2 ? parts.slice(2).join(' ').replace(/_/g, ' ') : k; }
            }
            const tieneNota = notas[k] ? true : false;
            const textoNota = notas[k] || "";

            lista.push({
                id: k,
                nombre: nombreReal,
                categoria: categoriaReal,
                precio: precioReal,
                cantidad: items[k],
                tieneNota: tieneNota,
                textoNota: textoNota,
                checked: v9_checkedIds.has(k)
            });
        }
    }

    lista.sort((a, b) => {
        if (a.checked !== b.checked) return a.checked ? 1 : -1;
        if (v9_sortMode === 'category') {
            const catCompare = a.categoria.localeCompare(b.categoria);
            if (catCompare !== 0) return catCompare;
        }
        return a.nombre.localeCompare(b.nombre);
    });

    let html = "";
    if (lista.length === 0) html = "<div style='text-align:center;padding:20px;color:#999'>Lista vacía.</div>";

    let lastCat = "";

    lista.forEach(item => {
        if (v9_sortMode === 'category' && item.categoria !== lastCat && !item.checked) {
            html += `<div class="v8-cat-header" style="background:#eee; margin-top:10px; font-size:12px">${item.categoria}</div>`;
            lastCat = item.categoria;
        }

        const checkedClass = item.checked ? "checked" : "";
        const activeClass = item.checked ? "active" : "";
        const checkIcon = item.checked ? "remove_shopping_cart" : "check";

        let noteHtml = "";
        if (item.tieneNota) {
            noteHtml = `<div class="v9-alert-note" onclick="alert('NOTA: ${item.textoNota.replace(/'/g, "")}')">⚠️ LEER NOTA</div>`;
        }

        const precioVal = item.precio || "";
        const ivaVal = parseFloat(ivas[item.id]) || 0;

        let finalPriceHtml = "";
        const precNum = parseFloat(precioVal.replace(',', '.'));

        // Calculo SOLO VISUAL: Base * (1 + IVA)
        if (!isNaN(precNum) && precNum > 0) {
            const pFinal = (precNum * (1 + ivaVal / 100)).toFixed(2);
            finalPriceHtml = `<div class="v9-prod-price-final">${pFinal}€</div>`;
        }

        html += `
        <div class="v9-card-prod ${checkedClass}">
            <div class="v9-prod-left">
                <div style="display:flex; flex-direction:column;">
                    <div class="v9-prod-name">
                        ${item.nombre}
                    </div>
                    ${finalPriceHtml}
                    ${noteHtml}
                </div>
            </div>
            <div class="v9-prod-right">
                <div class="v9-qty-badge">${item.cantidad}</div>
                <button class="v9-check-btn ${activeClass}" onclick="v9_toggleCheck('${item.id}')">
                    <span class="material-icons-round">${checkIcon}</span>
                </button>
            </div>
        </div>`;
    });

    document.getElementById("v9-prod-list").innerHTML = html;
}

function v9_toggleCheck(id) {
    haptic();
    if (v9_checkedIds.has(id)) v9_checkedIds.delete(id);
    else v9_checkedIds.add(id);
    v9_renderListaLector();
}

async function v9_borrarPedidoActual() {
    haptic();
    if (!currentLectorProv) return;
    if (!confirm(`⚠️ ¿CONFIRMAS QUE HA LLEGADO LA MERCANCÍA?\n\nEsto borrará la lista de ${currentLectorProv} para todos.`)) return;
    try {
        await db.collection("borradores").doc(currentLectorProv).delete();
        v9_volverInicio();
        v9_cargarProveedoresResumen();
        v9_cargarHistorialDashboard();
    } catch (e) { alert("Error: " + e.message); }
}

function v9_volverInicio() {
    document.getElementById("v9-view-prods").classList.add("hidden");
    document.getElementById("v9-view-provs").classList.remove("hidden");
}

// ==========================================
// 🛡️ VIGILANTE DE VERSIÓN (AUTO-UPDATE)
// ==========================================
function initVersionWatcher() {
    db.collection("system").doc("config").onSnapshot((doc) => {
        if (doc.exists) {
            const serverVersion = doc.data().version;
            
            // CORRECCIÓN AQUÍ: Usamos CURRENT_CLIENT_VERSION
            console.log(`📡 Verificando: App [${CURRENT_CLIENT_VERSION}] vs Server [${serverVersion}]`);

            if (serverVersion && serverVersion !== CURRENT_CLIENT_VERSION) {
                console.warn("⚠️ VERSIÓN ANTIGUA. ACTUALIZANDO...");
                forceUpdate(serverVersion);
            }
        }
    });
}

function forceUpdate(newVersion) {
    // 1. Borrar todas las cachés
    if ('caches' in window) {
        caches.keys().then((names) => {
            names.forEach(name => caches.delete(name));
        });
    }

    // 2. Desregistrar Service Workers
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
            for(let registration of regs) registration.unregister();
        });
    }

    // 3. Pantalla de bloqueo visual
    const alertDiv = document.createElement('div');
    alertDiv.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(33, 37, 41, 0.98); z-index: 9999;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: white; font-family: sans-serif; text-align: center;
    `;
    
    // AÑADIDO: Estilos de animación inline para asegurar que el spinner gire siempre
    alertDiv.innerHTML = `
        <span class="material-icons-round" style="font-size: 64px; margin-bottom: 20px; color: #4ade80;">rocket_launch</span>
        <h2 style="font-size: 24px; font-weight: 700; margin: 0;">Actualizando...</h2>
        <p style="opacity: 0.8; margin-top: 10px;">Instalando versión ${newVersion}</p>
        <div class="spinner-update" style="margin-top: 20px; width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.3); border-top: 4px solid #fff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(alertDiv);

    // 4. Recarga forzada
    setTimeout(() => { window.location.reload(true); }, 2000);
}

/* =========================================================
   EXPOSICIÓN GLOBAL PARA HTML
   (Necesario porque 'type=module' aísla el scope)
   ========================================================= */

window.cerrarSesion = cerrarSesion;
window.v8_cambiarProveedor = v8_cambiarProveedor;
window.v8_filtrarProductos = v8_filtrarProductos;
window.v8_toggleFiltro = v8_toggleFiltro;
window.v8_toggleExpansion = v8_toggleExpansion;
window.v8_borrarBorrador = v8_borrarBorrador;
window.v8_anadirManual = v8_anadirManual;
window.v8_historialSimple = v8_historialSimple;
window.v8_compartir = v8_compartir;
window.guardarPedidoFinal = guardarPedidoFinal;
window.v8_copiarTextoHistorial = v8_copiarTextoHistorial;
window.v8_cargarPedidoHistorial = v8_cargarPedidoHistorial;
window.v9_volverInicio = v9_volverInicio;
window.v9_toggleSortMode = v9_toggleSortMode;
window.v9_borrarPedidoActual = v9_borrarPedidoActual;
window.v8_eliminarPedidoHistorial = v8_eliminarPedidoHistorial;
window.v8_verDetalleDesdeDashboard = v8_verDetalleDesdeDashboard;
window.toggleFav = toggleFav;
window.v8_editarNota = v8_editarNota;
window.v8_actualizarPesoProducto = v8_actualizarPesoProducto;
window.v8_actualizarPrecioProducto = v8_actualizarPrecioProducto;
window.v8_verHistorialPrecios = v8_verHistorialPrecios;
window.v8_actualizarIVAProducto = v8_actualizarIVAProducto;
window.v8_setQty = v8_setQty;
window.v8_toggleCat = v8_toggleCat;
window.v8_verDetalleHistorial = v8_verDetalleHistorial;
window.v9_borrarBorradorDirecto = v9_borrarBorradorDirecto;
window.v9_abrirProveedorResumen = v9_abrirProveedorResumen;
window.v9_toggleCheck = v9_toggleCheck;
window.v8_entrarModoLector = v8_entrarModoLector;
window.v9_salirModoLector = v9_salirModoLector;