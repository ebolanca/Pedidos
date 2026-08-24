/* public/js/admin.js - Gestor de Catálogo y Parámetros optimizado para móviles */
import { firebaseConfig, ADMIN_EMAILS, MAPA_USUARIOS } from './config.js';

// Inicializar Firebase
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Variables de estado local
const DEFAULT_LECTOR_PROVS = ["Chinos", "Inde", "Vecino", "Mercadona", "Mercamadrid", "Supeco", "Makro"];
let allProducts = [];
let allSuppliers = [];
let uniqueCategories = [];
let uniqueResponsibles = [];
let activeTab = 'productos';
let selectionMode = false;
let selectedProductIds = new Set();

// --- 1. CONTROL DE ACCESO (AUTENTICACIÓN) ---
auth.onAuthStateChanged(async user => {
    if (user) {
        const email = user.email ? user.email.trim().toLowerCase() : '';
        if (!ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)) {
            alert("Acceso denegado: No tienes permisos de administrador.");
            auth.signOut().then(() => {
                window.location.href = "login.html";
            });
            return;
        }

        // AUTO-MIGRACIÓN DE MAPA_USUARIOS A FIRESTORE SI ESTÁ VACÍO
        try {
            const personalRef = db.collection("personal");
            const snapshot = await personalRef.limit(1).get();
            if (snapshot.empty) {
                console.log("Migrando MAPA_USUARIOS a Firestore...");
                const batch = db.batch();
                for (const [correo, nombre] of Object.entries(MAPA_USUARIOS)) {
                    batch.set(personalRef.doc(correo), {
                        email: correo,
                        nombre: nombre,
                        rol: ADMIN_EMAILS.includes(correo) ? "admin" : "worker"
                    });
                }
                await batch.commit();
                console.log("Migración de personal completada.");
            }
        } catch(e) {
            console.error("Error en auto-migración de personal:", e);
        }

        // Obtener nombre del usuario actual desde Firestore
        let nombreAdmin = 'Admin';
        try {
            const docUser = await db.collection("personal").doc(email).get();
            if (docUser.exists) {
                nombreAdmin = docUser.data().nombre || 'Admin';
            } else {
                // Si no existe pero es admin, lo agregamos
                await db.collection("personal").doc(email).set({
                    email: email,
                    nombre: MAPA_USUARIOS[email] || 'Admin',
                    rol: 'admin'
                });
                nombreAdmin = MAPA_USUARIOS[email] || 'Admin';
            }
        } catch(e) {
            console.error("Error al cargar datos del usuario admin:", e);
            nombreAdmin = MAPA_USUARIOS[email] || 'Admin'; // fallback
        }

        document.getElementById("authStatus").innerHTML = `
            <span style="color:#10b981; font-weight:600; display:flex; align-items:center; gap:4px">
                <span class="material-icons-round" style="font-size:16px">admin_panel_settings</span>
                ${nombreAdmin}
            </span>
        `;
        habilitarBotonesCSV();
        inicializarGestor();
    } else {
        window.location.href = "login.html";
    }
});

function habilitarBotonesCSV() {
    const btnImport = document.getElementById("btnImport");
    if (btnImport) {
        btnImport.innerText = "🚀 PROCESAR IMPORTACIÓN CSV";
        btnImport.disabled = false;
    }
}

// --- 2. INICIALIZACIÓN Y CARGA DE DATOS ---
async function inicializarGestor() {
    try {
        // Cargar responsables desde Firestore (colección personal)
        const personalSnap = await db.collection("personal").get();
        let staffNames = [];
        if (!personalSnap.empty) {
            personalSnap.forEach(doc => {
                const data = doc.data();
                if (data.nombre) staffNames.push(data.nombre);
            });
            staffNames = Array.from(new Set(staffNames));
        } else {
            // Fallback si por alguna razón falla la carga
            staffNames = Array.from(new Set(Object.values(MAPA_USUARIOS)));
        }
        
        staffNames.sort((a, b) => a.localeCompare(b));
        uniqueResponsibles = ['Todos', ...staffNames];

        // Llenar select de responsables en modal de productos
        const respSelect = document.getElementById("prod-responsible");
        if (respSelect) {
            respSelect.innerHTML = "";
            uniqueResponsibles.forEach(r => {
                const opt = document.createElement("option");
                opt.value = r;
                opt.innerText = r;
                respSelect.appendChild(opt);
            });
        }

        // --- ACTUALIZAR LA VERSIÓN DEL SISTEMA EN FIRESTORE ---
        const CLIENT_VERSION = "11.49";
        try {
            await db.collection("system").doc("config").set({
                version: CLIENT_VERSION,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log("✅ Versión del sistema sincronizada con Firestore:", CLIENT_VERSION);
        } catch (verErr) {
            console.warn("⚠️ No se pudo sincronizar la versión del sistema en Firestore:", verErr);
        }

        await cargarDatos();
        
        // Ejecutar migración silenciosa en segundo plano para limpiar responsables antiguos
        setTimeout(ejecutarMigracionResponsables, 2000);
    } catch (e) {
        console.error("Error al inicializar el gestor:", e);
        showToast("Error al cargar la base de datos", "error");
    }
}

async function ejecutarMigracionResponsables() {
    try {
        let batch = db.batch();
        let ops = 0;
        let countProds = 0;
        let countProvs = 0;

        // 1. Migrar responsables en la colección de proveedores
        const snapProvs = await db.collection("proveedores").get();
        for (const doc of snapProvs.docs) {
            const data = doc.data();
            let responsables = data.responsables || [];
            let changedProv = false;
            
            const index = responsables.findIndex(r => r === "Jazmín y Aarón" || r === "Jazmín y Aaron");
            if (index !== -1) {
                responsables.splice(index, 1);
                if (!responsables.includes("Jazmín")) responsables.push("Jazmín");
                if (!responsables.includes("Aarón")) responsables.push("Aarón");
                changedProv = true;
            }

            // También normalizar cualquier "Aaron" sin acento a "Aarón"
            const aaronIndex = responsables.indexOf("Aaron");
            if (aaronIndex !== -1) {
                responsables[aaronIndex] = "Aarón";
                changedProv = true;
            }

            if (changedProv) {
                // Eliminar posibles duplicados
                responsables = [...new Set(responsables)];
                batch.update(doc.ref, { responsables: responsables });
                ops++;
                countProvs++;
            }

            // 2. Migrar productos de este proveedor
            const snapProds = await doc.ref.collection("productos").get();
            for (const pDoc of snapProds.docs) {
                const pData = pDoc.data();
                let needUpdate = false;
                let newResponsable = pData.responsable;

                if (pData.responsable === "Jazmín y Aarón" || pData.responsable === "Jazmín y Aaron") {
                    newResponsable = "Aarón";
                    needUpdate = true;
                } else if (pData.responsable === "Aaron") {
                    newResponsable = "Aarón";
                    needUpdate = true;
                }

                if (needUpdate) {
                    batch.update(pDoc.ref, { responsable: newResponsable });
                    ops++;
                    countProds++;
                }

                if (ops >= 450) {
                    await batch.commit();
                    batch = db.batch();
                    ops = 0;
                }
            }
        }

        if (ops > 0) {
            await batch.commit();
        }

        if (countProds > 0 || countProvs > 0) {
            console.log(`✅ MIGRACIÓN: Se actualizaron ${countProds} productos y ${countProvs} proveedores con responsables dobles o sin tilde a 'Aarón' / 'Jazmín'.`);
            showToast(`Migrados ${countProds} productos antiguos a Aarón`, "success");
            await cargarDatos();
        }
    } catch (e) {
        console.error("Error al ejecutar migración de responsables:", e);
    }
}

async function cargarDatos() {
    // Preservar valores de filtros antes de vaciar/recargar
    const filterProv = document.getElementById("filter-proveedor");
    const filterCat = document.getElementById("filter-categoria");
    const filterProvEncargado = document.getElementById("filter-prov-encargado");
    const prevFilterProvVal = filterProv ? filterProv.value : "";
    const prevFilterCatVal = filterCat ? filterCat.value : "";
    const prevFilterProvEncargadoVal = filterProvEncargado ? filterProvEncargado.value : "";

    // Mostrar cargando
    document.getElementById("prods-loading").style.display = "flex";
    document.getElementById("prods-grid").style.display = "none";
    document.getElementById("prods-empty").style.display = "none";
    document.getElementById("provs-loading").style.display = "flex";
    document.getElementById("provs-grid").style.display = "none";
    document.getElementById("provs-empty").style.display = "none";

    try {
        // 1. Cargar proveedores
        const snapProvs = await db.collection("proveedores").get();
        allSuppliers = [];
        const responsablesSet = new Set();
        snapProvs.forEach(doc => {
            const data = doc.data();
            let isEnLector = data.enLector;
            if (isEnLector === undefined) {
                isEnLector = DEFAULT_LECTOR_PROVS.includes(doc.id);
                // Guardar en Firestore para persistir el valor migrado
                doc.ref.set({ enLector: isEnLector }, { merge: true }).catch(console.error);
            }
            allSuppliers.push({
                id: doc.id,
                ...data,
                enLector: isEnLector
            });
            if (data.responsables && Array.isArray(data.responsables)) {
                data.responsables.forEach(r => {
                    if (r !== "Todos") responsablesSet.add(r);
                });
            }
        });
        allSuppliers.sort((a, b) => a.id.localeCompare(b.id));

        // Llenar select de encargados en la pestaña de proveedores
        if (filterProvEncargado) {
            filterProvEncargado.innerHTML = '<option value="">-- Todos los Encargados --</option>';
            const uniqueResponsables = Array.from(responsablesSet).sort();
            uniqueResponsables.forEach(r => {
                filterProvEncargado.innerHTML += `<option value="${r}">${r}</option>`;
            });
            filterProvEncargado.value = prevFilterProvEncargadoVal;
        }

        // Llenar select de proveedores en los filtros
        const prodProvSelect = document.getElementById("prod-supplier");
        if (filterProv) {
            filterProv.innerHTML = '<option value="">-- Todos los Proveedores --</option>';
            allSuppliers.forEach(s => {
                filterProv.innerHTML += `<option value="${s.id}">${s.id}</option>`;
            });
            // Restaurar filtro
            filterProv.value = prevFilterProvVal;
        }
        if (prodProvSelect) {
            prodProvSelect.innerHTML = '<option value="">-- Selecciona Proveedor --</option>';
            allSuppliers.forEach(s => {
                prodProvSelect.innerHTML += `<option value="${s.id}">${s.id}</option>`;
            });
        }

        // 2. Cargar todos los productos de todos los proveedores
        allProducts = [];
        const categoriesSet = new Set();

        for (const prov of allSuppliers) {
            const snapProds = await db.collection("proveedores").doc(prov.id).collection("productos").get();
            snapProds.forEach(doc => {
                const data = doc.data();
                allProducts.push({
                    id: doc.id,
                    supplierId: prov.id,
                    ...data
                });
                if (data.categoria) categoriesSet.add(data.categoria.trim());
            });
        }

        // Cargar categorías únicas
        uniqueCategories = Array.from(categoriesSet);
        uniqueCategories.sort();

        // Llenar select de categorías en los filtros
        if (filterCat) {
            filterCat.innerHTML = '<option value="">-- Todas las Categorías --</option>';
            uniqueCategories.forEach(c => {
                filterCat.innerHTML += `<option value="${c}">${c}</option>`;
            });
            // Restaurar filtro
            filterCat.value = prevFilterCatVal;
        }

        // Ocultar spinners y renderizar
        document.getElementById("prods-loading").style.display = "none";
        document.getElementById("provs-loading").style.display = "none";

        renderProductos();
        renderProveedores();

    } catch (e) {
        console.error("Error al cargar datos desde Firestore:", e);
        showToast("Error al cargar datos", "error");
    }
}

// --- 3. RENDERIZACIÓN ---

function renderProductos() {
    const grid = document.getElementById("prods-grid");
    const emptyState = document.getElementById("prods-empty");
    grid.innerHTML = "";

    const searchVal = document.getElementById("prod-search").value.toLowerCase().trim();
    const filterProvVal = document.getElementById("filter-proveedor").value;
    const filterCatVal = document.getElementById("filter-categoria").value;

    const filtered = allProducts.filter(p => {
        const matchesSearch = p.nombre ? p.nombre.toLowerCase().includes(searchVal) : false;
        const matchesProv = filterProvVal ? p.supplierId === filterProvVal : true;
        const matchesCat = filterCatVal ? p.categoria === filterCatVal : true;
        return matchesSearch && matchesProv && matchesCat;
    });

    // Ordenar alfabéticamente
    filtered.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    if (filtered.length === 0) {
        grid.style.display = "none";
        emptyState.style.display = "block";
        return;
    }

    emptyState.style.display = "none";
    grid.style.display = "grid";

    filtered.forEach(p => {
        const card = document.createElement("div");
        
        const isSelected = selectedProductIds.has(p.id);
        if (isSelected) {
            card.className = "product-card selected";
        } else {
            card.className = "product-card";
        }

        const precioStr = p.precio ? `${parseFloat(p.precio).toFixed(2)}€` : 'Sin Precio';
        const ivaStr = p.iva ? `(IVA ${p.iva}%)` : '';

        if (selectionMode) {
            const checkIcon = isSelected ? 'check_box' : 'check_box_outline_blank';
            card.innerHTML = `
                <span class="material-icons-round card-checkbox-icon" onclick="event.stopPropagation(); toggleSelectProduct('${p.id}')">${checkIcon}</span>
                <div class="card-header" onclick="toggleSelectProduct('${p.id}')" style="cursor: pointer;">
                    <h4 class="card-title" style="padding-right: 28px;">${p.nombre}</h4>
                    <div class="card-subtitle">${p.supplierId}</div>
                </div>
                <div class="card-details" onclick="toggleSelectProduct('${p.id}')" style="cursor: pointer; flex-grow: 1;">
                    <span class="badge badge-blue">
                        <span class="material-icons-round" style="font-size: 12px">label</span>
                        ${p.categoria || 'General'}
                    </span>
                    <span class="badge badge-orange">
                        <span class="material-icons-round" style="font-size: 12px">person</span>
                        ${p.responsable || 'Todos'}
                    </span>
                    <span class="badge badge-gray">
                        <span class="material-icons-round" style="font-size: 12px">inventory</span>
                        1 ${p.unidad || 'ud'}
                    </span>
                    <span class="badge badge-green">
                        <span class="material-icons-round" style="font-size: 12px">payments</span>
                        ${precioStr} ${ivaStr}
                    </span>
                </div>
            `;
        } else {
            card.innerHTML = `
                <button class="btn-delete-card" style="position: absolute; top: 12px; right: 12px; border: none; background: #fee2e2; color: #ef4444; width: 32px; height: 32px; border-radius: 50%; display: flex; justify-content: center; align-items: center; cursor: pointer;" onclick="event.stopPropagation(); borrarProductoConfirmar('${p.id}', '${p.supplierId}', '${p.nombre.replace(/'/g, "\\'")}')">
                    <span class="material-icons-round" style="font-size: 18px">delete</span>
                </button>
                <div class="card-header" onclick="abrirModalProducto('${p.id}')" style="cursor: pointer;">
                    <h4 class="card-title">${p.nombre}</h4>
                    <div class="card-subtitle">${p.supplierId}</div>
                </div>
                <div class="card-details" onclick="abrirModalProducto('${p.id}')" style="cursor: pointer; flex-grow: 1;">
                    <span class="badge badge-blue">
                        <span class="material-icons-round" style="font-size: 12px">label</span>
                        ${p.categoria || 'General'}
                    </span>
                    <span class="badge badge-orange">
                        <span class="material-icons-round" style="font-size: 12px">person</span>
                        ${p.responsable || 'Todos'}
                    </span>
                    <span class="badge badge-gray">
                        <span class="material-icons-round" style="font-size: 12px">inventory</span>
                        1 ${p.unidad || 'ud'}
                    </span>
                    <span class="badge badge-green">
                        <span class="material-icons-round" style="font-size: 12px">payments</span>
                        ${precioStr} ${ivaStr}
                    </span>
                </div>
                <div class="card-actions">
                    <button class="btn-card-action btn-edit" onclick="abrirModalProducto('${p.id}')">
                        <span class="material-icons-round">edit</span> Editar
                    </button>
                </div>
            `;
        }
        grid.appendChild(card);
    });
}

function renderProveedores() {
    const grid = document.getElementById("provs-grid");
    const emptyState = document.getElementById("provs-empty");
    const filterEncargadoVal = document.getElementById("filter-prov-encargado") ? document.getElementById("filter-prov-encargado").value : "";
    grid.innerHTML = "";

    let filteredSuppliers = allSuppliers;
    if (filterEncargadoVal) {
        filteredSuppliers = allSuppliers.filter(s => {
            const responsables = s.responsables || [];
            return responsables.includes("Todos") || responsables.includes(filterEncargadoVal);
        });
    }

    if (filteredSuppliers.length === 0) {
        grid.style.display = "none";
        emptyState.style.display = "block";
        return;
    }

    emptyState.style.display = "none";
    grid.style.display = "grid";

    filteredSuppliers.forEach(s => {
        const card = document.createElement("div");
        card.className = "supplier-card";

        const responsables = s.responsables || [];
        const isTodosAllowed = responsables.includes("Todos");
        
        let tagsHtml = "";
        if (isTodosAllowed) {
            tagsHtml = `<span class="badge badge-orange" style="font-weight:600">Todos (Cualquiera del personal)</span>`;
        } else if (responsables.length === 0) {
            tagsHtml = `<span class="badge badge-gray" style="font-style: italic">Nadie asignado (Solo administradores)</span>`;
        } else {
            responsables.forEach(r => {
                tagsHtml += `<span class="badge badge-blue">${r}</span> `;
            });
        }

        // Obtener recuento de productos
        const count = allProducts.filter(p => p.supplierId === s.id).length;
        const isLectorActive = s.enLector === true;

        card.innerHTML = `
            <button class="btn-lector-card ${isLectorActive ? 'active' : 'inactive'}" 
                    title="${isLectorActive ? 'Activo en Lector (Click para desactivar)' : 'Inactivo en Lector (Click para activar)'}" 
                    onclick="event.stopPropagation(); toggleProveedorLector('${s.id}', this)">
                <span class="material-icons-round" style="font-size: 18px">qr_code_scanner</span>
            </button>
            <button class="btn-delete-card" style="position: absolute; top: 12px; right: 12px; border: none; background: #fee2e2; color: #ef4444; width: 32px; height: 32px; border-radius: 50%; display: flex; justify-content: center; align-items: center; cursor: pointer;" onclick="event.stopPropagation(); borrarProveedorConfirmar('${s.id}')">
                <span class="material-icons-round" style="font-size: 18px">delete</span>
            </button>
            <div class="card-header">
                <h4 class="card-title">${s.id}</h4>
                <div class="card-subtitle" style="background:#e0f2fe; color:#0369a1">${count} productos</div>
            </div>
            <div class="responsibles-list">
                <div class="responsibles-title">Autorizados para pedir:</div>
                <div class="responsibles-tags">
                    ${tagsHtml}
                </div>
            </div>
            <div class="card-actions">
                <button class="btn-card-action btn-edit" onclick="abrirModalProveedor('${s.id}')">
                    <span class="material-icons-round">edit</span> Configurar Responsables
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function filtrarCatalogo() {
    renderProductos();
}

// --- 4. TABS & INTERFAZ ---
function switchTab(tab) {
    activeTab = tab;
    
    const panes = {
        'productos': document.getElementById("pane-productos"),
        'proveedores': document.getElementById("pane-proveedores"),
        'personal': document.getElementById("pane-personal")
    };
    
    const btns = {
        'productos': document.getElementById("tab-prods-btn"),
        'proveedores': document.getElementById("tab-provs-btn"),
        'personal': document.getElementById("tab-personal-btn")
    };

    Object.keys(panes).forEach(k => {
        if (panes[k]) panes[k].style.display = (k === tab) ? "block" : "none";
        if (btns[k]) {
            if (k === tab) btns[k].classList.add("active");
            else btns[k].classList.remove("active");
        }
    });

    if (tab === 'personal') {
        renderPersonal();
    }
}

function toggleBackupBody() {
    const body = document.getElementById("backup-body");
    const icon = document.getElementById("backup-icon");
    if (body.style.display === "none") {
        body.style.display = "block";
        icon.innerText = "keyboard_arrow_down";
    } else {
        body.style.display = "none";
        icon.innerText = "keyboard_arrow_right";
    }
}

// --- 5. OPERACIONES MODAL PRODUCTO ---
function abrirCrearNuevo() {
    if (activeTab === 'productos') {
        abrirModalProducto(null);
    } else {
        abrirModalProveedor(null);
    }
}

function abrirModalProducto(prodId) {
    const modal = document.getElementById("modal-producto");
    const title = document.getElementById("modal-prod-title");
    const form = document.getElementById("form-producto");
    
    form.reset();

    // Llenar selects
    const suppSelect = document.getElementById("prod-supplier");
    suppSelect.innerHTML = '<option value="">-- Selecciona Proveedor --</option>';
    allSuppliers.forEach(s => {
        suppSelect.innerHTML += `<option value="${s.id}">${s.id}</option>`;
    });

    if (prodId) {
        title.innerText = "Editar Producto";
        const prod = allProducts.find(p => p.id === prodId);
        if (prod) {
            document.getElementById("prod-id").value = prod.id;
            document.getElementById("prod-original-supplier").value = prod.supplierId;
            document.getElementById("prod-name").value = prod.nombre || '';
            document.getElementById("prod-price").value = prod.precio || '';
            document.getElementById("prod-unit").value = prod.unidad || '';
            document.getElementById("prod-category").value = prod.categoria || '';
            document.getElementById("prod-supplier").value = prod.supplierId;
            document.getElementById("prod-responsible").value = prod.responsable || 'Todos';
        }
    } else {
        title.innerText = "Nuevo Producto";
        document.getElementById("prod-id").value = "";
        document.getElementById("prod-original-supplier").value = "";
        document.getElementById("prod-responsible").value = "Todos";
    }

    modal.classList.add("active");
}

function cerrarModalProducto() {
    const modal = document.getElementById("modal-producto");
    modal.classList.remove("active");
}

async function guardarProducto(event) {
    event.preventDefault();
    
    const id = document.getElementById("prod-id").value;
    const originalSupplier = document.getElementById("prod-original-supplier").value;
    const nombre = document.getElementById("prod-name").value.trim();
    const precioVal = document.getElementById("prod-price").value;
    const unidad = document.getElementById("prod-unit").value.trim();
    const categoria = document.getElementById("prod-category").value.trim();
    const proveedor = document.getElementById("prod-supplier").value;
    const responsable = document.getElementById("prod-responsible").value;

    if (!nombre || !unidad || !categoria || !proveedor || !responsable) {
        showToast("Por favor complete los campos obligatorios (*)", "error");
        return;
    }

    try {
        const isEdit = id !== "";
        let existingProd = isEdit ? allProducts.find(p => p.id === id) : {};
        
        // Estructurar el objeto de datos
        const dataToSave = {
            nombre: nombre,
            unidad: unidad,
            categoria: categoria,
            responsable: responsable,
            proveedor: proveedor,
            peso: existingProd.peso || "",
            iva: existingProd.iva || 0
        };

        // Procesamiento del precio e historial de precios
        const newPriceStr = precioVal !== "" ? parseFloat(precioVal).toFixed(2) : "";
        const oldPriceStr = existingProd.precio || "";

        if (oldPriceStr !== newPriceStr) {
            let history = existingProd.historialPrecios || [];
            const now = new Date();
            history.push({ fecha: now.toISOString(), precio: newPriceStr });
            if (history.length > 5) history = history.slice(-5);
            
            dataToSave.precio = newPriceStr;
            dataToSave.precioAnterior = oldPriceStr;
            dataToSave.historialPrecios = history;
        } else {
            dataToSave.precio = existingProd.precio || "";
            dataToSave.precioAnterior = existingProd.precioAnterior || "";
            dataToSave.historialPrecios = existingProd.historialPrecios || [];
        }

        if (isEdit) {
            // Caso de edición
            if (originalSupplier !== proveedor) {
                // CAMBIÓ DE PROVEEDOR: se copia al nuevo y se elimina del viejo
                const newId = generarIdProducto(proveedor, nombre);
                
                // 1. Guardar en el nuevo proveedor
                await db.collection("proveedores").doc(proveedor)
                    .collection("productos").doc(newId).set(dataToSave);
                
                // 2. Eliminar del viejo proveedor
                await db.collection("proveedores").doc(originalSupplier)
                    .collection("productos").doc(id).delete();
                
                showToast("Producto actualizado y trasladado", "success");
            } else {
                // Mismo proveedor, actualización normal
                await db.collection("proveedores").doc(proveedor)
                    .collection("productos").doc(id).set(dataToSave, { merge: true });
                showToast("Producto actualizado", "success");
            }
        } else {
            // Caso creación
            const newId = generarIdProducto(proveedor, nombre);
            
            // Verificar si ya existe un producto con el mismo ID en el proveedor
            const checkDoc = await db.collection("proveedores").doc(proveedor)
                .collection("productos").doc(newId).get();
            
            if (checkDoc.exists) {
                if (!confirm("Ya existe un producto similar. ¿Deseas sobreescribirlo?")) {
                    return;
                }
            }

            await db.collection("proveedores").doc(proveedor)
                .collection("productos").doc(newId).set(dataToSave);
            showToast("Producto creado correctamente", "success");
        }

        cerrarModalProducto();
        await cargarDatos();
    } catch (e) {
        console.error("Error al guardar producto:", e);
        showToast("Error al guardar el producto", "error");
    }
}

async function borrarProductoConfirmar(id, supplierId, name) {
    if (confirm(`¿Estás seguro de que deseas eliminar permanentemente el producto "${name}"?`)) {
        try {
            await db.collection("proveedores").doc(supplierId).collection("productos").doc(id).delete();
            showToast("Producto eliminado", "success");
            await cargarDatos();
        } catch (e) {
            console.error(e);
            showToast("Error al eliminar producto", "error");
        }
    }
}

// --- 6. OPERACIONES MODAL PROVEEDOR ---
function abrirModalProveedor(provId) {
    const modal = document.getElementById("modal-proveedor");
    const title = document.getElementById("modal-prov-title");
    const nameInput = document.getElementById("prov-name");
    const chkGrid = document.getElementById("prov-responsibles-checkboxes");
    
    document.getElementById("form-proveedor").reset();
    chkGrid.innerHTML = "";

    // Construir casillas de verificación
    uniqueResponsibles.forEach(r => {
        const div = document.createElement("div");
        div.className = "checkbox-label-wrapper";
        div.innerHTML = `
            <label class="checkbox-label">
                <input type="checkbox" class="checkbox-input" value="${r}" id="chk-resp-${r}">
                <span>${r}</span>
            </label>
        `;
        chkGrid.appendChild(div);
    });

    if (provId) {
        title.innerText = "Configurar Proveedor";
        document.getElementById("prov-edit-mode").value = provId;
        nameInput.value = provId;
        nameInput.disabled = true; // No permitir cambiar la clave ID del documento

        const prov = allSuppliers.find(s => s.id === provId);
        if (prov) {
            const responsables = prov.responsables || [];
            responsables.forEach(r => {
                const el = document.getElementById(`chk-resp-${r}`);
                if (el) el.checked = true;
            });
        }
    } else {
        title.innerText = "Nuevo Proveedor";
        document.getElementById("prov-edit-mode").value = "";
        nameInput.value = "";
        nameInput.disabled = false;
        
        // Predeterminado marcar "Todos"
        const el = document.getElementById("chk-resp-Todos");
        if (el) el.checked = true;
    }

    modal.classList.add("active");
}

function cerrarModalProveedor() {
    const modal = document.getElementById("modal-proveedor");
    modal.classList.remove("active");
}

async function guardarProveedor(event) {
    event.preventDefault();
    
    const editModeId = document.getElementById("prov-edit-mode").value;
    const nombre = document.getElementById("prov-name").value.trim();

    if (!nombre) {
        showToast("Introduce el nombre del proveedor", "error");
        return;
    }

    // Obtener responsables marcados
    const checked = [];
    uniqueResponsibles.forEach(r => {
        const el = document.getElementById(`chk-resp-${r}`);
        if (el && el.checked) {
            checked.push(r);
        }
    });

    try {
        const provRef = db.collection("proveedores").doc(nombre);
        
        if (editModeId === "") {
            // Creación: comprobar duplicado
            const checkDoc = await provRef.get();
            if (checkDoc.exists) {
                showToast("Ya existe un proveedor con ese nombre", "error");
                return;
            }
        }

        await provRef.set({
            actual: new Date(),
            responsables: checked
        }, { merge: true });

        showToast("Proveedor guardado", "success");
        cerrarModalProveedor();
        await cargarDatos();
    } catch (e) {
        console.error("Error al guardar proveedor:", e);
        showToast("Error al guardar el proveedor", "error");
    }
}

async function borrarProveedorConfirmar(provId) {
    const prodsCount = allProducts.filter(p => p.supplierId === provId).length;
    let warningMsg = `¿Estás seguro de que deseas eliminar permanentemente el proveedor "${provId}"?`;
    if (prodsCount > 0) {
        warningMsg += `\n\n⚠️ ¡ATENCIÓN! Se eliminarán también los ${prodsCount} productos asociados a este proveedor. Esta acción no se puede deshacer.`;
    }

    if (confirm(warningMsg)) {
        try {
            let batch = db.batch();
            let ops = 0;

            // 1. Añadir borrado de los productos del sub-catálogo
            const prodsToDelete = allProducts.filter(p => p.supplierId === provId);
            for (const p of prodsToDelete) {
                const pRef = db.collection("proveedores").doc(provId).collection("productos").doc(p.id);
                batch.delete(pRef);
                ops++;
                if (ops >= 450) {
                    await batch.commit();
                    batch = db.batch();
                    ops = 0;
                }
            }

            // 2. Eliminar el documento del proveedor
            const provRef = db.collection("proveedores").doc(provId);
            batch.delete(provRef);
            ops++;

            await batch.commit();
            showToast("Proveedor y catálogo eliminados", "success");
            await cargarDatos();
        } catch (e) {
            console.error("Error al borrar proveedor:", e);
            showToast("Error al eliminar proveedor", "error");
        }
    }
}

async function toggleProveedorLector(provId, btnEl) {
    const prov = allSuppliers.find(s => s.id === provId);
    if (!prov) return;

    const newState = !prov.enLector;
    prov.enLector = newState;

    // Actualización visual inmediata
    if (btnEl) {
        btnEl.className = `btn-lector-card ${newState ? 'active' : 'inactive'}`;
        btnEl.title = newState ? 'Activo en Lector (Click para desactivar)' : 'Inactivo en Lector (Click para activar)';
    }

    try {
        await db.collection("proveedores").doc(provId).set({
            enLector: newState
        }, { merge: true });
        showToast(newState ? `"${provId}" añadido al lector` : `"${provId}" retirado del lector`, "success");
    } catch (e) {
        console.error("Error al actualizar estado del lector:", e);
        showToast("Error al guardar cambio del lector", "error");
        prov.enLector = !newState;
        if (btnEl) {
            btnEl.className = `btn-lector-card ${!newState ? 'active' : 'inactive'}`;
            btnEl.title = !newState ? 'Activo en Lector (Click para desactivar)' : 'Inactivo en Lector (Click para activar)';
        }
    }
}

// --- 7. NOTIFICACIONES TOAST ---
function showToast(text, type = "success") {
    const container = document.getElementById("toast-container");
    const element = document.getElementById("toast-element");
    const icon = document.getElementById("toast-icon");
    const textEl = document.getElementById("toast-text");

    textEl.innerText = text;
    element.className = `toast ${type}`;
    icon.innerText = type === "success" ? "check_circle" : "error";

    container.classList.add("active");
    
    setTimeout(() => {
        container.classList.remove("active");
    }, 3000);
}

// --- 8. PRESERVACIÓN DE IMPORTADOR CSV (RESPALDO / AVANZADO) ---

function generarIdProducto(provName, prodName) {
    if(!provName || !prodName) return "error_" + Date.now();
    const cleanProv = provName.trim().toUpperCase()
        .replace(/[^A-Z0-9]/g, "") 
        .substring(0, 10);
    const cleanProd = prodName.trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
        .replace(/[^a-z0-9]/g, ""); 
    return `${cleanProv}_${cleanProd}`;
}

function normalizarResponsable(resp) {
    if (!resp || resp.toLowerCase() === "responsable") return "Todos";
    const r = resp.toLowerCase();
    if(r.includes("flor")) return "Flor";
    if(r.includes("jose") || r.includes("josé")) return "Jose";
    if(r.includes("amina")) return "Amina";
    if(r.includes("aaron")) return "Aarón";
    if(r.includes("jazmin")) return "Jazmín";
    if(r.includes("jhoan")) return "Jhoan";
    return resp;
}

function leerArchivo(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsText(file, "UTF-8"); 
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
    });
}

function csvToArray(text) {
    let p = '', row = [''], ret = [row], i = 0, r = 0, s = !0, l;
    for (l of text) {
        if ('"' === l) {
            if (s && l === p) row[i] += l;
            s = !s;
        } else if (',' === l && s) l = row[++i] = '';
        else if ('\n' === l && s) {
            if ('\r' === p) row[i] = row[i].slice(0, -1);
            row = ret[++r] = [l = '']; i = 0;
        } else row[i] += l;
        p = l;
    }
    return ret;
}

async function procesarImportacion() {
    const btn = document.getElementById("btnImport");
    const status = document.getElementById("status");
    const fileInput = document.getElementById("fileUpload");
    const textArea = document.getElementById("csvData");

    let rawData = "";

    if (fileInput && fileInput.files.length > 0) {
        try {
            status.style.display = "block";
            status.className = "status info";
            status.innerHTML = "📂 Leyendo archivo...";
            rawData = await leerArchivo(fileInput.files[0]);
        } catch (e) {
            return alert("Error al leer archivo: " + e.message);
        }
    } else if (textArea) {
        rawData = textArea.value.trim();
    }

    if(!rawData) return alert("❌ Selecciona un archivo CSV o pega el contenido.");

    btn.disabled = true;
    status.innerHTML = "Analizando estructura inteligente...";
    status.style.display = "block";

    try {
        const filas = csvToArray(rawData);
        const datosPorProveedor = {};
        let proveedorActual = "Sin Proveedor"; 
        let totalProductos = 0;

        for(let i=0; i<filas.length; i++) {
            const cols = filas[i];
            const col0 = cols[0] ? cols[0].toString().trim() : "";
            
            if(!col0 || col0.toLowerCase() === "nombre") continue; 

            const esLineaProveedor = (!cols[2] || cols[2].trim() === "") && (!cols[3] || cols[3].trim() === "");

            if (esLineaProveedor) {
                proveedorActual = col0.replace(/[:\.]/g, '').replace(/"/g, '').trim();
                if(!datosPorProveedor[proveedorActual]) {
                    datosPorProveedor[proveedorActual] = { prod: [], resp: new Set(["Roberto"]) };
                }
                continue;
            }

            const nombre = col0.replace(/"/g, '');
            const resp = normalizarResponsable(cols[3] || "Todos");
            
            if (!datosPorProveedor[proveedorActual]) {
                 datosPorProveedor[proveedorActual] = { prod: [], resp: new Set(["Roberto"]) };
            }

            const precioCSV = cols[5] ? cols[5].toString().trim() : "";
            const productoData = {
                nombre: nombre,
                unidad: cols[2] || "ud",
                responsable: resp,
                categoria: cols[4] || "General",
                proveedor: proveedorActual
            };

            if (precioCSV !== "") {
                productoData.precio = precioCSV;
            }

            datosPorProveedor[proveedorActual].prod.push({
                id: generarIdProducto(proveedorActual, nombre),
                data: productoData
            });
            datosPorProveedor[proveedorActual].resp.add(resp);
            totalProductos++;
        }

        let batch = db.batch(); 
        let op = 0;
        
        status.innerHTML = "Sincronizando base de datos global...";

        const todosLosIdsCSV = new Set();
        for (const dat of Object.values(datosPorProveedor)) {
            dat.prod.forEach(p => todosLosIdsCSV.add(p.id));
        }

        try {
            const snapProveedores = await db.collection("proveedores").get();
            for (const docProv of snapProveedores.docs) {
                const provRef = docProv.ref;
                const snapProds = await provRef.collection("productos").get();
                
                for (const docProd of snapProds.docs) {
                    if (!todosLosIdsCSV.has(docProd.id)) {
                        batch.delete(docProd.ref);
                        op++;
                        if (op >= 450) { await batch.commit(); batch = db.batch(); op = 0; }
                    }
                }
            }
        } catch(e) { console.error("Error en limpieza global:", e); }

        for (const [nom, dat] of Object.entries(datosPorProveedor)) {
            const provRef = db.collection("proveedores").doc(nom);
            batch.set(provRef, { actual: new Date(), responsables: Array.from(dat.resp) }, { merge: true });
            op++;
            if (op >= 450) { await batch.commit(); batch = db.batch(); op = 0; }

            for (const p of dat.prod) {
                batch.set(provRef.collection("productos").doc(p.id), p.data, { merge: true });
                op++;
                if (op >= 450) { await batch.commit(); batch = db.batch(); op = 0; }
            }
        }

        if (op > 0) await batch.commit();

        status.className = "status success";
        status.innerHTML = `✅ <b>IMPORTACIÓN COMPLETADA</b><br>Se han cargado ${totalProductos} productos en ${Object.keys(datosPorProveedor).length} proveedores.`;
        
        await cargarDatos();
        btn.innerText = "🚀 PROCESO FINALIZADO";
        setTimeout(() => { btn.disabled = false; btn.innerText = "🚀 PROCESAR OTRA VEZ"; fileInput.value = ""; }, 3000);

    } catch (e) {
        console.error(e);
        status.className = "status error";
        status.innerText = "❌ Error: " + e.message;
        btn.disabled = false;
    }
}

// --- 9. ACCIONES MASIVAS (BULK ACTIONS LOGIC) ---

function toggleSelectionMode(forceValue) {
    if (typeof forceValue === "boolean") {
        selectionMode = forceValue;
    } else {
        selectionMode = !selectionMode;
    }

    const btn = document.getElementById("btn-toggle-select-mode");
    const icon = document.getElementById("icon-toggle-select-mode");
    const lbl = document.getElementById("lbl-toggle-select-mode");
    const bulkBar = document.getElementById("bulk-actions-bar");

    selectedProductIds.clear();

    if (selectionMode) {
        if (btn) {
            btn.style.borderColor = "var(--primary)";
            btn.style.background = "var(--primary-light)";
            btn.style.color = "var(--primary)";
        }
        if (icon) {
            icon.innerText = "check_box";
            icon.style.color = "var(--primary)";
        }
        if (lbl) lbl.innerText = "Cancelar";
        if (bulkBar) bulkBar.style.display = "flex";
        document.body.classList.add("has-bulk-bar");
        document.getElementById("bulk-selected-count").innerText = "0 seleccionados";
    } else {
        if (btn) {
            btn.style.borderColor = "var(--border)";
            btn.style.background = "var(--bg-card)";
            btn.style.color = "var(--text-main)";
        }
        if (icon) {
            icon.innerText = "check_box_outline_blank";
            icon.style.color = "var(--text-muted)";
        }
        if (lbl) lbl.innerText = "Seleccionar";
        if (bulkBar) bulkBar.style.display = "none";
        document.body.classList.remove("has-bulk-bar");
    }

    renderProductos();
}

function toggleSelectProduct(id) {
    if (selectedProductIds.has(id)) {
        selectedProductIds.delete(id);
    } else {
        selectedProductIds.add(id);
    }

    renderProductos();
    
    const count = selectedProductIds.size;
    document.getElementById("bulk-selected-count").innerText = `${count} seleccionado${count !== 1 ? 's' : ''}`;
}

async function borrarSeleccionadosConfirmar() {
    const count = selectedProductIds.size;
    if (count === 0) {
        showToast("No hay productos seleccionados", "error");
        return;
    }

    if (confirm(`¿Estás seguro de que deseas eliminar permanentemente los ${count} productos seleccionados? Esta acción no se puede deshacer.`)) {
        try {
            let batch = db.batch();
            let op = 0;

            for (const prodId of selectedProductIds) {
                const prod = allProducts.find(p => p.id === prodId);
                if (prod) {
                    const ref = db.collection("proveedores").doc(prod.supplierId).collection("productos").doc(prodId);
                    batch.delete(ref);
                    op++;

                    if (op >= 450) {
                        await batch.commit();
                        batch = db.batch();
                        op = 0;
                    }
                }
            }

            if (op > 0) await batch.commit();

            showToast(`Se han eliminado ${count} productos`, "success");
            toggleSelectionMode(false);
            await cargarDatos();
        } catch (e) {
            console.error("Error en borrado masivo:", e);
            showToast("Error al eliminar los productos", "error");
        }
    }
}

function abrirBulkEditModal() {
    const count = selectedProductIds.size;
    if (count === 0) {
        showToast("No hay productos seleccionados", "error");
        return;
    }

    const modal = document.getElementById("modal-bulk-edit");
    const form = document.getElementById("form-bulk-edit");
    form.reset();

    // Rellenar proveedores select
    const suppSelect = document.getElementById("bulk-supplier");
    suppSelect.innerHTML = '<option value="">-- Mantener actual --</option>';
    allSuppliers.forEach(s => {
        suppSelect.innerHTML += `<option value="${s.id}">${s.id}</option>`;
    });

    // Rellenar responsables select
    const respSelect = document.getElementById("bulk-responsible");
    respSelect.innerHTML = '<option value="">-- Mantener actual --</option>';
    uniqueResponsibles.forEach(r => {
        respSelect.innerHTML += `<option value="${r}">${r}</option>`;
    });

    modal.classList.add("active");
}

function cerrarBulkEditModal() {
    const modal = document.getElementById("modal-bulk-edit");
    modal.classList.remove("active");
}

async function guardarBulkEdit(event) {
    event.preventDefault();

    const count = selectedProductIds.size;
    const targetSupplier = document.getElementById("bulk-supplier").value;
    const targetResponsible = document.getElementById("bulk-responsible").value;
    const targetCategory = document.getElementById("bulk-category").value.trim();

    if (!targetSupplier && !targetResponsible && !targetCategory) {
        showToast("No has seleccionado ningún cambio a realizar", "error");
        return;
    }

    if (confirm(`Se aplicarán los cambios a ${count} productos. ¿Continuar?`)) {
        try {
            let batch = db.batch();
            let op = 0;

            for (const prodId of selectedProductIds) {
                const prod = allProducts.find(p => p.id === prodId);
                if (!prod) continue;

                // Construimos la actualización
                const updates = {};
                if (targetResponsible) updates.responsable = targetResponsible;
                if (targetCategory) updates.categoria = targetCategory;

                const originalSupplier = prod.supplierId;
                const newSupplier = targetSupplier || originalSupplier;

                if (originalSupplier !== newSupplier) {
                    // CAMBIO DE PROVEEDOR (Traslado):
                    // 1. Clonar producto en la nueva colección
                    const newId = generarIdProducto(newSupplier, prod.nombre || 'Sin nombre');
                    
                    const clonedData = {
                        nombre: prod.nombre || 'Sin nombre',
                        unidad: prod.unidad || 'ud',
                        categoria: targetCategory || prod.categoria || 'General',
                        responsable: targetResponsible || prod.responsable || 'Todos',
                        proveedor: newSupplier,
                        precio: prod.precio || "",
                        precioAnterior: prod.precioAnterior || "",
                        historialPrecios: prod.historialPrecios || [],
                        peso: prod.peso || "",
                        iva: prod.iva || 0
                    };

                    const newRef = db.collection("proveedores").doc(newSupplier).collection("productos").doc(newId);
                    batch.set(newRef, clonedData);
                    op++;

                    // 2. Eliminar de la antigua colección
                    const oldRef = db.collection("proveedores").doc(originalSupplier).collection("productos").doc(prodId);
                    batch.delete(oldRef);
                    op++;
                } else {
                    // Mismo proveedor, actualización normal de propiedades
                    if (Object.keys(updates).length > 0) {
                        const ref = db.collection("proveedores").doc(originalSupplier).collection("productos").doc(prodId);
                        batch.update(ref, updates);
                        op++;
                    }
                }

                if (op >= 450) {
                    await batch.commit();
                    batch = db.batch();
                    op = 0;
                }
            }

            if (op > 0) await batch.commit();

            showToast(`Se han actualizado ${count} productos`, "success");
            cerrarBulkEditModal();
            toggleSelectionMode(false);
            await cargarDatos();
        } catch (e) {
            console.error("Error en edición masiva:", e);
            showToast("Error al guardar cambios", "error");
        }
    }
}

// Exportación de funciones al HTML
window.switchTab = switchTab;
window.toggleBackupBody = toggleBackupBody;
window.abrirCrearNuevo = abrirCrearNuevo;
window.abrirModalProducto = abrirModalProducto;
window.cerrarModalProducto = cerrarModalProducto;
window.guardarProducto = guardarProducto;
window.abrirModalProveedor = abrirModalProveedor;
window.cerrarModalProveedor = cerrarModalProveedor;
window.guardarProveedor = guardarProveedor;
window.filtrarCatalogo = filtrarCatalogo;
window.renderProveedores = renderProveedores;
window.borrarProductoConfirmar = borrarProductoConfirmar;
window.borrarProveedorConfirmar = borrarProveedorConfirmar;
window.toggleProveedorLector = toggleProveedorLector;
window.procesarImportacion = procesarImportacion;

// Nuevas exportaciones para acciones masivas
window.toggleSelectionMode = toggleSelectionMode;
window.toggleSelectProduct = toggleSelectProduct;
window.abrirBulkEditModal = abrirBulkEditModal;
window.cerrarBulkEditModal = cerrarBulkEditModal;
window.guardarBulkEdit = guardarBulkEdit;
window.borrarSeleccionadosConfirmar = borrarSeleccionadosConfirmar;
window.switchTab = switchTab;

// --- 9. GESTIÓN DE PERSONAL ---
async function renderPersonal() {
    const grid = document.getElementById("personal-grid");
    const loading = document.getElementById("personal-loading");
    
    grid.innerHTML = "";
    grid.style.display = "none";
    loading.style.display = "block";

    try {
        const snap = await db.collection("personal").get();
        loading.style.display = "none";
        grid.style.display = "grid";

        if (snap.empty) return;

        let optionsHtml = "";
        const personalList = [];

        snap.forEach(doc => {
            const data = doc.data();
            personalList.push(data);
            optionsHtml += `<option value="${data.email}">${data.nombre}</option>`;
        });

        // Guardamos opciones para el modal
        window.opcionesPersonalHtml = optionsHtml;

        personalList.sort((a,b) => (a.nombre||'').localeCompare(b.nombre||'')).forEach(p => {
            const card = document.createElement("div");
            card.className = "supplier-card";

            let vacacionBadge = "";
            let vacacionBtn = "";

            if (p.sustituto) {
                vacacionBadge = `
                    <div style="margin-top: 8px;">
                        <span class="badge badge-orange" style="font-weight:600; display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 6px; background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5;">
                            <span class="material-icons-round" style="font-size: 16px;">beach_access</span> De vacaciones → Sustituye: <strong>${p.sustituto}</strong>
                        </span>
                    </div>
                `;
                vacacionBtn = `
                    <button class="btn-card-action" style="color: #d97706; border-color: #fcd34d; background: #fffbeb;" onclick="quitarSustituto('${p.email}')">
                        <span class="material-icons-round">event_available</span> Finalizar Vacaciones
                    </button>
                `;
            } else {
                vacacionBtn = `
                    <button class="btn-card-action" style="color: #0284c7; border-color: #bae6fd; background: #f0f9ff;" onclick="abrirModalSustituto('${p.email}', '${p.nombre}')">
                        <span class="material-icons-round">beach_access</span> Asignar Vacaciones
                    </button>
                `;
            }

            card.innerHTML = `
                <div class="card-header">
                    <h4 class="card-title">${p.nombre}</h4>
                    <div class="card-subtitle" style="background:#f1f5f9; color:#475569;">${p.email}</div>
                </div>
                ${vacacionBadge}
                <div class="card-actions" style="margin-top: 12px; display: flex; flex-direction: column; gap: 6px;">
                    ${vacacionBtn}
                    <button class="btn-card-action btn-edit" style="color: var(--danger); border-color: var(--danger);" onclick="abrirModalTransfer('${p.email}', '${p.nombre}')">
                        <span class="material-icons-round">person_remove</span> Dar de baja
                    </button>
                </div>
            `;
            grid.appendChild(card);
        });

    } catch (e) {
        console.error("Error al cargar personal", e);
        loading.style.display = "none";
        showToast("Error al cargar personal", "error");
    }
}

async function altaPersonal() {
    const emailInput = document.getElementById("nuevo-personal-email");
    const nameInput = document.getElementById("nuevo-personal-nombre");
    const email = emailInput.value.trim().toLowerCase();
    const name = nameInput.value.trim();

    if (!email || !name) {
        showToast("Rellena email y nombre", "error");
        return;
    }

    try {
        await db.collection("personal").doc(email).set({
            email: email,
            nombre: name,
            rol: "worker"
        });
        
        // Crear usuario en Firebase Auth sin desloguear al admin actual
        try {
            const secondaryApp = firebase.initializeApp(firebaseConfig, "SecondaryApp");
            await secondaryApp.auth().createUserWithEmailAndPassword(email, "rail2026");
            await secondaryApp.auth().signOut();
            await secondaryApp.delete();
            console.log("Usuario Auth creado exitosamente");
        } catch (authErr) {
            console.warn("El usuario ya existe en Auth o hubo un error:", authErr);
            // Si la app secundaria quedó viva por algún error, intentamos borrarla
            try {
                const appToDel = firebase.app("SecondaryApp");
                if (appToDel) await appToDel.delete();
            } catch(e){}
        }

        showToast("Encargado añadido con éxito", "success");
        emailInput.value = "";
        nameInput.value = "";
        
        // Actualizar responsable lists globally
        await inicializarGestor(); 
        renderPersonal();
    } catch (e) {
        console.error("Error al dar de alta", e);
        showToast("Error al guardar", "error");
    }
}

function abrirModalTransfer(email, nombre) {
    document.getElementById("transfer-old-email").value = email;
    document.getElementById("transfer-old-name").innerText = nombre;
    
    const select = document.getElementById("transfer-new-email");
    select.innerHTML = window.opcionesPersonalHtml || "";
    
    // Remover a sí mismo de las opciones
    for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === email) {
            select.remove(i);
            break;
        }
    }

    document.getElementById("modal-transfer-personal").classList.add("active");
}

function cerrarModalTransfer() {
    document.getElementById("modal-transfer-personal").classList.remove("active");
}

async function confirmarTransferYBorrado() {
    const oldEmail = document.getElementById("transfer-old-email").value;
    const oldName = document.getElementById("transfer-old-name").innerText;
    const newEmail = document.getElementById("transfer-new-email").value;
    const selectEl = document.getElementById("transfer-new-email");
    const newName = selectEl.options[selectEl.selectedIndex] ? selectEl.options[selectEl.selectedIndex].text : "";

    if (!newEmail) {
        showToast("Selecciona un encargado destino", "error");
        return;
    }

    const btn = document.querySelector("#modal-transfer-personal .btn-primary");
    btn.disabled = true;
    btn.innerText = "Traspasando...";

    try {
        const batch = db.batch();

        // 1. Productos: cambiar responsable (iterando proveedores para evitar error de índice en collectionGroup)
        for (const prov of allSuppliers) {
            const snapProds = await db.collection("proveedores").doc(prov.id).collection("productos").where("responsable", "==", oldName).get();
            snapProds.forEach(doc => {
                batch.update(doc.ref, { responsable: newName });
            });
        }

        // 2. Proveedores: reemplazar oldName por newName
        const snapProvs = await db.collection("proveedores").where("responsables", "array-contains", oldName).get();
        snapProvs.forEach(doc => {
            const data = doc.data();
            let resp = data.responsables || [];
            resp = resp.filter(r => r !== oldName);
            if (!resp.includes(newName)) resp.push(newName);
            batch.update(doc.ref, { responsables: resp });
        });

        // 3. Borrar de personal
        batch.delete(db.collection("personal").doc(oldEmail));

        await batch.commit();

        showToast("Traspaso y baja completados", "success");
        cerrarModalTransfer();
        
        await inicializarGestor(); 
        renderPersonal();

    } catch (e) {
        console.error("Error en traspaso", e);
        showToast("Error en el traspaso", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-icons-round" style="font-size: 18px;">delete_forever</span> Traspasar y Borrar`;
    }
}

function abrirModalSustituto(email, nombre) {
    document.getElementById("sustituto-target-email").value = email;
    document.getElementById("sustituto-target-name").innerText = nombre;
    
    const select = document.getElementById("sustituto-select-email");
    select.innerHTML = window.opcionesPersonalHtml || "";
    
    // Remover a sí mismo de las opciones
    for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === email) {
            select.remove(i);
            break;
        }
    }

    document.getElementById("modal-sustituto-personal").classList.add("active");
}

function cerrarModalSustituto() {
    document.getElementById("modal-sustituto-personal").classList.remove("active");
}

async function confirmarGuardarSustituto() {
    const targetEmail = document.getElementById("sustituto-target-email").value;
    const targetName = document.getElementById("sustituto-target-name").innerText;
    const selectEl = document.getElementById("sustituto-select-email");
    const subEmail = selectEl.value;
    const subName = selectEl.options[selectEl.selectedIndex] ? selectEl.options[selectEl.selectedIndex].text : "";

    if (!subEmail || !subName) {
        showToast("Selecciona un encargado sustituto", "error");
        return;
    }

    try {
        await db.collection("personal").doc(targetEmail).update({
            sustituto: subName,
            sustitutoEmail: subEmail
        });

        showToast(`${subName} asignado/a como sustituto/a de ${targetName}`, "success");
        cerrarModalSustituto();
        renderPersonal();
    } catch (e) {
        console.error("Error al asignar sustituto", e);
        showToast("Error al guardar sustituto", "error");
    }
}

async function quitarSustituto(email) {
    if (!confirm("¿Finalizar vacaciones y retirar el sustituto asignado?")) return;

    try {
        await db.collection("personal").doc(email).update({
            sustituto: firebase.firestore.FieldValue.delete(),
            sustitutoEmail: firebase.firestore.FieldValue.delete()
        });

        showToast("Vacaciones finalizadas. Sustitución retirada.", "success");
        renderPersonal();
    } catch (e) {
        console.error("Error al quitar sustituto", e);
        showToast("Error al actualizar estado", "error");
    }
}

window.renderPersonal = renderPersonal;
window.altaPersonal = altaPersonal;
window.abrirModalTransfer = abrirModalTransfer;
window.cerrarModalTransfer = cerrarModalTransfer;
window.confirmarTransferYBorrado = confirmarTransferYBorrado;
window.abrirModalSustituto = abrirModalSustituto;
window.cerrarModalSustituto = cerrarModalSustituto;
window.confirmarGuardarSustituto = confirmarGuardarSustituto;
window.quitarSustituto = quitarSustituto;