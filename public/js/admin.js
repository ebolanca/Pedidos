/* public/js/admin.js - Gestor de Catálogo y Parámetros optimizado para móviles */
import { firebaseConfig, ADMIN_EMAILS, MAPA_USUARIOS } from './config.js';

// Inicializar Firebase
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Variables de estado local
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
        document.getElementById("authStatus").innerHTML = `
            <span style="color:#10b981; font-weight:600; display:flex; align-items:center; gap:4px">
                <span class="material-icons-round" style="font-size:16px">admin_panel_settings</span>
                ${MAPA_USUARIOS[user.email] || 'Admin'}
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
        // Cargar responsables del mapa de usuarios
        const staffNames = Array.from(new Set(Object.values(MAPA_USUARIOS)));
        staffNames.sort();
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
        const CLIENT_VERSION = "11.38";
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
    } catch (e) {
        console.error("Error al inicializar el gestor:", e);
        showToast("Error al cargar la base de datos", "error");
    }
}

async function cargarDatos() {
    // Preservar valores de filtros antes de vaciar/recargar
    const filterProv = document.getElementById("filter-proveedor");
    const filterCat = document.getElementById("filter-categoria");
    const prevFilterProvVal = filterProv ? filterProv.value : "";
    const prevFilterCatVal = filterCat ? filterCat.value : "";

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
        snapProvs.forEach(doc => {
            allSuppliers.push({
                id: doc.id,
                ...doc.data()
            });
        });
        allSuppliers.sort((a, b) => a.id.localeCompare(b.id));

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
    grid.innerHTML = "";

    if (allSuppliers.length === 0) {
        grid.style.display = "none";
        emptyState.style.display = "block";
        return;
    }

    emptyState.style.display = "none";
    grid.style.display = "grid";

    allSuppliers.forEach(s => {
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

        card.innerHTML = `
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
    
    const paneProds = document.getElementById("pane-productos");
    const paneProvs = document.getElementById("pane-proveedores");
    const btnProds = document.getElementById("tab-prods-btn");
    const btnProvs = document.getElementById("tab-provs-btn");

    if (tab === 'productos') {
        paneProds.style.display = "block";
        paneProvs.style.display = "none";
        btnProds.classList.add("active");
        btnProvs.classList.remove("active");
    } else {
        paneProds.style.display = "none";
        paneProvs.style.display = "block";
        btnProds.classList.remove("active");
        btnProvs.classList.add("active");
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
    if(r.includes("jazmin") || r.includes("aaron")) return "Jazmín y Aarón";
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
window.borrarProductoConfirmar = borrarProductoConfirmar;
window.borrarProveedorConfirmar = borrarProveedorConfirmar;
window.procesarImportacion = procesarImportacion;

// Nuevas exportaciones para acciones masivas
window.toggleSelectionMode = toggleSelectionMode;
window.toggleSelectProduct = toggleSelectProduct;
window.abrirBulkEditModal = abrirBulkEditModal;
window.cerrarBulkEditModal = cerrarBulkEditModal;
window.guardarBulkEdit = guardarBulkEdit;
window.borrarSeleccionadosConfirmar = borrarSeleccionadosConfirmar;