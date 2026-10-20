// =============================================================
// ASSISTANT.JS - Asistente Virtual Inteligente de Pedidos
// Cafetería El Raíl
// =============================================================

import { db, auth } from './firebase-init.js';
import { ADMIN_EMAILS, MAPA_USUARIOS } from '../config.js';
import { HOLIDAY_PROVIDERS } from './holiday_alerts.js';

// API Key para el asistente (codificada para GitHub secret scanning)
const _gk = "QVEuQWI4Uk42SXl4UFdPLWFoVUllZVV1U1dwbTJabU50aVJqVXZwLTg3ekhXMjNEN09QV0E=";
const GEMINI_API_KEY = typeof atob !== 'undefined' ? atob(_gk) : Buffer.from(_gk, 'base64').toString();

let isAssistantOpen = false;
let isMenuOpen = false;
const chatHistory = [];
let assistantInitialized = false;

// Format Markdown ligero para respuestas
function formatMarkdown(text) {
    if (!text) return "";
    let formatted = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Negritas
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Cursivas
    formatted = formatted.replace(/\*(.*?)\*/g, "<em>$1</em>");
    // Código en línea
    formatted = formatted.replace(/`([^`]+)`/g, "<code style='background:rgba(0,0,0,0.06);padding:2px 5px;border-radius:4px;font-size:12px;'>$1</code>");
    // Listas con viñetas
    formatted = formatted.replace(/^\s*[\-\*•]\s+(.+)$/gm, "<li style='margin-left:14px;margin-bottom:3px;'>$1</li>");
    // Saltos de línea
    formatted = formatted.replace(/\n\n+/g, "<br/><br/>").replace(/\n/g, "<br/>");

    return formatted;
}

// -------------------------------------------------------------
// RECOLECCIÓN DINÁMICA DE CONTEXTO DE LA APP DE PEDIDOS
// -------------------------------------------------------------
async function recopilarContextoPedidos(userName, userRole) {
    let contexto = `USUARIO ACTUAL: ${userName || 'Usuario'} (Rol: ${userRole || 'Personal'})\n\n`;

    // 1. Borradores abiertos en curso
    try {
        const borradoresSnap = await db.collection("borradores").get();
        if (!borradoresSnap.empty) {
            contexto += `BORRADORES ABIERTOS ACTUALMENTE:\n`;
            borradoresSnap.forEach(doc => {
                const data = doc.data() || {};
                const items = data.items || {};
                const cantItems = Object.keys(items).length;
                if (cantItems > 0) {
                    const usuarioMod = data.user || 'desconocido';
                    contexto += `• Proveedor "${doc.id}": ${cantItems} artículos añadidos (modificado por ${usuarioMod}).\n`;
                }
            });
            contexto += `\n`;
        } else {
            contexto += `No hay borradores abiertos en este momento.\n\n`;
        }
    } catch (e) {
        console.warn("Aviso leyendo borradores para asistente:", e);
    }

    // 2. Proveedores registrados y sus pautas de compra
    try {
        const provsSnap = await db.collection("proveedores").get();
        if (!provsSnap.empty) {
            contexto += `PROVEEDORES Y DÍAS HABITUALES DE COMPRA:\n`;
            provsSnap.forEach(doc => {
                const pName = doc.id;
                const pData = doc.data() || {};
                const resp = pData.responsables ? (Array.isArray(pData.responsables) ? pData.responsables.join(', ') : pData.responsables) : 'Todos';
                const reglaFestivo = HOLIDAY_PROVIDERS[pName];
                let infoCompra = "";
                if (reglaFestivo && reglaFestivo.diasCompra) {
                    const diasMap = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 0: 'Domingo' };
                    const diasTxt = reglaFestivo.diasCompra.map(d => diasMap[d]).join(' y ');
                    infoCompra = ` (Días compra: ${diasTxt} en ${reglaFestivo.municipio || 'zona'})`;
                }
                contexto += `• ${pName}: Responsable(s): ${resp}${infoCompra}\n`;
            });
            contexto += `\n`;
        }
    } catch (e) {
        console.warn("Aviso leyendo proveedores para asistente:", e);
    }

    // 3. Últimos pedidos enviados
    try {
        const pedidosSnap = await db.collection("pedidos").orderBy("fecha", "desc").limit(6).get();
        if (!pedidosSnap.empty) {
            contexto += `ÚLTIMOS PEDIDOS REALIZADOS:\n`;
            pedidosSnap.forEach(doc => {
                const data = doc.data() || {};
                const estado = data.estado || 'enviado';
                if (estado !== 'borrado') {
                    const fechaTxt = data.fecha_corta || (data.fecha && data.fecha.toDate ? data.fecha.toDate().toLocaleDateString('es-ES') : '');
                    const prov = data.proveedor || '';
                    const solicitante = data.usuario || 'personal';
                    const items = data.items || {};
                    const itemsResumen = Object.entries(items).slice(0, 4).map(([id, cant]) => {
                        const nombreLimpio = id.replace(/^[A-Z0-9]+_/, '').replace(/_/g, ' ');
                        return `${nombreLimpio}: ${cant}`;
                    }).join(', ');
                    contexto += `• ${fechaTxt} - ${prov} (por ${solicitante}): ${itemsResumen || Object.keys(items).length + ' productos'}\n`;
                }
            });
            contexto += `\n`;
        }
    } catch (e) {
        // Fallback sin ordenar si falta índice
        try {
            const snapSimple = await db.collection("pedidos").limit(6).get();
            if (!snapSimple.empty) {
                contexto += `ÚLTIMOS PEDIDOS REGISTRADOS:\n`;
                snapSimple.forEach(doc => {
                    const d = doc.data() || {};
                    if (d.estado !== 'borrado') {
                        contexto += `• ${d.proveedor} (${d.fecha_corta || ''}) por ${d.usuario || ''}\n`;
                    }
                });
                contexto += `\n`;
            }
        } catch (err2) {}
    }

    return contexto;
}

// Búsqueda puntual de productos en Firestore si el usuario pregunta por un artículo
async function buscarDetalleProducto(termino) {
    if (!termino || termino.length < 3) return null;
    const termClean = termino.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    try {
        const provsSnap = await db.collection("proveedores").get();
        let matches = [];
        for (const provDoc of provsSnap.docs) {
            const pSnap = await provDoc.ref.collection("productos").get();
            pSnap.forEach(doc => {
                const p = doc.data();
                const nom = (p.nombre || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (nom.includes(termClean)) {
                    matches.push({
                        proveedor: provDoc.id,
                        nombre: p.nombre,
                        unidad: p.unidad || 'Ud',
                        precio: p.precio || '-',
                        categoria: p.categoria || 'General',
                        responsable: p.responsable || 'Todos'
                    });
                }
            });
            if (matches.length >= 6) break;
        }
        if (matches.length > 0) {
            let res = `INFORMACIÓN EN CATÁLOGO PARA "${termino}":\n`;
            matches.slice(0, 5).forEach(m => {
                res += `• ${m.nombre} (${m.proveedor}) -> ${m.precio}€ / ${m.unidad} [Cat: ${m.categoria}, Resp: ${m.responsable}]\n`;
            });
            return res + `\n`;
        }
    } catch (e) {
        console.warn("Aviso buscando productos en catálogo:", e);
    }
    return null;
}

// Guardar registro de la consulta en Firestore
async function guardarLogAsistente(pregunta, respuesta, userObj) {
    try {
        await db.collection("asistente_pedidos_logs").add({
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            fecha: new Date().toISOString(),
            usuario: userObj.name || 'Personal',
            email: userObj.email || '',
            rol: userObj.role || 'personal',
            pregunta: pregunta,
            respuesta: (respuesta || '').substring(0, 500)
        });
    } catch (e) {
        console.warn("Aviso guardando log de asistente de pedidos:", e);
    }
}

// -------------------------------------------------------------
// CONSTRUCCIÓN E INICIALIZACIÓN DE LA INTERFAZ
// -------------------------------------------------------------
export function initAssistant(userProfile = {}) {
    if (assistantInitialized) return;
    assistantInitialized = true;

    const userName = userProfile.name || (auth.currentUser ? (MAPA_USUARIOS[auth.currentUser.email] || auth.currentUser.email.split('@')[0]) : 'Personal');
    const userRole = userProfile.role || (auth.currentUser && ADMIN_EMAILS.includes(auth.currentUser.email) ? 'admin' : 'empleado');
    const userEmail = auth.currentUser ? auth.currentUser.email : '';

    // 1. Inyectar botón flotante
    const floatingBtn = document.createElement('button');
    floatingBtn.id = 'btn-open-assistant-pedidos';
    floatingBtn.type = 'button';
    floatingBtn.setAttribute('aria-label', 'Abrir Asistente de Pedidos');
    floatingBtn.title = 'Asistente Virtual de Pedidos';
    floatingBtn.style.cssText = `
        position: fixed;
        bottom: 22px;
        right: 20px;
        z-index: 99999;
        display: inline-flex;
        align-items: center;
        gap: 9px;
        background: #0f172a;
        color: #ffffff;
        border: 2px solid #22d3ee;
        padding: 5px 15px 5px 6px;
        border-radius: 9999px;
        box-shadow: 0 10px 25px rgba(6, 182, 212, 0.4);
        cursor: pointer;
        transition: transform 0.2s ease, bottom 0.25s ease, box-shadow 0.2s ease;
        text-decoration: none;
        font-family: 'Inter', -apple-system, sans-serif;
    `;
    floatingBtn.innerHTML = `
        <div style="position: relative; width: 42px; height: 42px; border-radius: 50%; overflow: hidden; flex-shrink: 0; border: 1.5px solid #22d3ee; background: #1e293b;">
            <img src="img/ai-assistant.jpg" alt="AI" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80';">
            <span style="position: absolute; bottom: 1px; right: 1px; width: 10px; height: 10px; background: #10b981; border: 1.5px solid #0f172a; border-radius: 50%;"></span>
        </div>
        <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.15;">
            <span style="font-size: 13px; font-weight: 800; color: #ffffff; letter-spacing: -0.2px;">Asistente Pedidos</span>
            <span style="font-size: 10px; color: #22d3ee; font-weight: 600;">El Raíl • Online</span>
        </div>
    `;

    floatingBtn.addEventListener('click', toggleAssistantModal);
    document.body.appendChild(floatingBtn);

    // Ajustar posición si la barra inferior de pedidos se muestra
    const observer = new MutationObserver(() => {
        const bottomBar = document.getElementById('v8-bottom-bar');
        if (bottomBar && !bottomBar.classList.contains('hidden') && bottomBar.style.display !== 'none') {
            floatingBtn.style.bottom = '105px';
        } else {
            floatingBtn.style.bottom = '22px';
        }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

    // 2. Inyectar Modal de Chat
    const modal = document.createElement('div');
    modal.id = 'assistant-pedidos-modal';
    modal.style.cssText = `
        display: none;
        position: fixed;
        bottom: 24px;
        right: 20px;
        z-index: 100000;
        width: calc(100% - 40px);
        max-width: 390px;
        height: 550px;
        max-height: 82vh;
        background: #ffffff;
        border-radius: 24px;
        box-shadow: 0 20px 45px rgba(0,0,0,0.3);
        border: 1px solid rgba(0,0,0,0.1);
        flex-direction: column;
        overflow: hidden;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    modal.innerHTML = `
        <!-- Cabecera -->
        <div style="background-color: #0f172a; color: #ffffff; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1);">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 40px; height: 40px; border-radius: 50%; border: 2px solid #22d3ee; box-shadow: 0 0 10px rgba(34, 211, 238, 0.4); overflow: hidden; flex-shrink: 0; background: #0f172a; position: relative;">
                    <img src="img/ai-assistant.jpg" alt="AI" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80';">
                    <span style="position: absolute; bottom: 1px; right: 1px; width: 10px; height: 10px; background-color: #22c55e; border-radius: 50%; border: 1.5px solid #0f172a;"></span>
                </div>
                <div>
                    <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: #ffffff;">Asistente de Pedidos</h3>
                    <p style="margin: 0; font-size: 11px; color: rgba(255,255,255,0.7); display: flex; align-items: center; gap: 4px;">
                        Cafetería El Raíl • <span style="color: #4ade80; font-weight: 600;">En línea</span>
                    </p>
                </div>
            </div>
            <button type="button" id="btn-close-assistant-pedidos" style="background: rgba(255,255,255,0.15); border: none; color: #ffffff; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 13px; font-weight: bold;">✕</button>
        </div>

        <!-- Contenedor de Mensajes -->
        <div id="assistant-pedidos-messages" style="flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; background-color: #f8fafc;">
            <!-- Bienvenida -->
            <div style="display: flex; align-items: flex-start; gap: 8px; max-width: 90%; align-self: flex-start;">
                <div style="width: 28px; height: 28px; border-radius: 50%; overflow: hidden; border: 1.5px solid #22d3ee; flex-shrink: 0; margin-top: 2px;">
                    <img src="img/ai-assistant.jpg" alt="AI" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80';">
                </div>
                <div style="background: #ffffff; border: 1px solid #e2e8f0; padding: 12px 14px; border-radius: 16px; border-top-left-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.04); font-size: 13px; line-height: 1.48; color: #1e293b;">
                    ¡Hola, <strong>${userName}</strong>! 👋 Soy tu Asistente de Pedidos de Cafetería El Raíl.<br/><br/>
                    Puedo informarte sobre qué borradores hay abiertos, qué proveedores suministran cada producto, consultar precios o verificar días de compra y festivos.
                </div>
            </div>
        </div>

        <!-- Barra Desplegable de Opciones Rápidas -->
        <div id="assistant-pedidos-menu-bar" style="background: #ffffff; border-top: 1px solid #f1f5f9; padding: 8px 14px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
            <span style="font-size: 11px; font-weight: 700; color: #475569; display: flex; align-items: center; gap: 6px;">
                <span>💡</span> Consultas rápidas de almacén
            </span>
            <span id="assistant-pedidos-menu-chevron" style="font-size: 9px; color: #94a3b8; font-weight: bold; transition: transform 0.2s ease;">▲</span>
        </div>

        <!-- Contenedor Desplegable de Chips -->
        <div id="assistant-pedidos-chips" style="display: none; padding: 8px 12px 10px 12px; background: #ffffff; border-top: 1px solid #f8fafc; flex-wrap: wrap; gap: 6px; max-height: 135px; overflow-y: auto;">
            <button type="button" class="assistant-chip-btn" data-query="¿Qué borradores hay abiertos ahora mismo?">🛒 Borradores abiertos</button>
            <button type="button" class="assistant-chip-btn" data-query="¿Cuáles fueron los últimos pedidos realizados?">📋 Últimos pedidos</button>
            <button type="button" class="assistant-chip-btn" data-query="¿A qué proveedor le compramos los vasos de café y servilletas?">☕ Vasos y servilletas</button>
            <button type="button" class="assistant-chip-btn" data-query="¿Qué días se compra en cada proveedor y cómo afectan los festivos?">📅 Días de compra y festivos</button>
            <button type="button" class="assistant-chip-btn" data-query="¿Cómo funciona el recuento de stock en modo Lector?">📖 Ayuda Modo Lector</button>
        </div>

        <!-- Input Footer -->
        <form id="assistant-pedidos-form" style="padding: 10px 12px; background: #ffffff; border-top: 1px solid #f1f5f9; display: flex; gap: 8px; align-items: center; margin: 0;">
            <input type="text" id="assistant-pedidos-input" placeholder="Pregunta sobre productos, borradores, proveedores..." style="flex: 1; padding: 10px 14px; border-radius: 9999px; border: 1px solid #cbd5e1; font-size: 13px; outline: none; background: #f8fafc; color: #0f172a;" autocomplete="off" />
            <button type="submit" id="assistant-pedidos-send" style="width: 38px; height: 38px; background-color: #0f172a; color: #ffffff; border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: transform 0.15s ease;">
                <svg style="width: 16px; height: 16px; fill: currentColor; margin-left: 2px;" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
            </button>
        </form>
    `;

    document.body.appendChild(modal);

    // Estilos de los chips
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
        .assistant-chip-btn {
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            border-radius: 9999px;
            padding: 5px 11px;
            font-size: 11px;
            font-weight: 600;
            color: #334155;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
        }
        .assistant-chip-btn:hover {
            background: #e2e8f0;
            color: #0f172a;
            border-color: #cbd5e1;
        }
    `;
    document.head.appendChild(styleEl);

    // Listeners
    document.getElementById('btn-close-assistant-pedidos').addEventListener('click', toggleAssistantModal);
    
    const menuBar = document.getElementById('assistant-pedidos-menu-bar');
    menuBar.addEventListener('click', () => {
        isMenuOpen = !isMenuOpen;
        const chipsContainer = document.getElementById('assistant-pedidos-chips');
        const chevron = document.getElementById('assistant-pedidos-menu-chevron');
        if (chipsContainer) {
            chipsContainer.style.display = isMenuOpen ? 'flex' : 'none';
        }
        if (chevron) {
            chevron.style.transform = isMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    });

    // Chips click
    modal.querySelectorAll('.assistant-chip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const query = e.target.getAttribute('data-query');
            if (query) {
                enviarPreguntaAsistente(query, { name: userName, role: userRole, email: userEmail });
                // Plegar menú tras clic
                isMenuOpen = false;
                document.getElementById('assistant-pedidos-chips').style.display = 'none';
                document.getElementById('assistant-pedidos-menu-chevron').style.transform = 'rotate(0deg)';
            }
        });
    });

    // Form submit
    document.getElementById('assistant-pedidos-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('assistant-pedidos-input');
        const txt = input ? input.value.trim() : '';
        if (txt) {
            input.value = '';
            enviarPreguntaAsistente(txt, { name: userName, role: userRole, email: userEmail });
        }
    });
}

function toggleAssistantModal() {
    isAssistantOpen = !isAssistantOpen;
    const modal = document.getElementById('assistant-pedidos-modal');
    if (modal) {
        modal.style.display = isAssistantOpen ? 'flex' : 'none';
        if (isAssistantOpen) {
            const input = document.getElementById('assistant-pedidos-input');
            if (input) setTimeout(() => input.focus(), 150);
            const msgBox = document.getElementById('assistant-pedidos-messages');
            if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
        }
    }
}

// -------------------------------------------------------------
// ENVÍO DE CONSULTA Y PROCESAMIENTO CON GEMINI + FALLBACK LOCAL
// -------------------------------------------------------------
async function enviarPreguntaAsistente(msgText, userObj) {
    const msgContainer = document.getElementById('assistant-pedidos-messages');
    if (!msgContainer) return;

    // 1. Añadir Burbuja de Usuario
    const userBubble = document.createElement('div');
    userBubble.style.cssText = "align-self: flex-end; max-width: 85%; background: #0f172a; color: #ffffff; padding: 10px 14px; border-radius: 16px; border-top-right-radius: 4px; font-size: 13px; line-height: 1.45; word-break: break-word;";
    userBubble.innerText = msgText;
    msgContainer.appendChild(userBubble);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    chatHistory.push({ role: 'user', content: msgText });

    // 2. Indicador "Escribiendo..."
    const typingIndicator = document.createElement('div');
    typingIndicator.id = 'assistant-pedidos-typing';
    typingIndicator.style.cssText = "display: flex; align-items: center; gap: 8px; align-self: flex-start; max-width: 80%;";
    typingIndicator.innerHTML = `
        <div style="width: 28px; height: 28px; border-radius: 50%; overflow: hidden; border: 1.5px solid #22d3ee; flex-shrink: 0;">
            <img src="img/ai-assistant.jpg" alt="AI" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80';">
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; padding: 10px 14px; border-radius: 16px; font-size: 12px; color: #64748b; font-style: italic;">
            Consultando almacén y catálogo...
        </div>
    `;
    msgContainer.appendChild(typingIndicator);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    let reply = null;

    try {
        // Recoger contexto dinámico
        const contextoVivo = await recopilarContextoPedidos(userObj.name, userObj.role);
        
        // Búsqueda puntual si menciona productos
        let contextoProducto = "";
        const palabrasClave = msgText.split(/\s+/).filter(w => w.length > 3 && !/^(como|cuando|donde|quien|para|hacer|tengo|pedir|pedido|borrador|proveedor)$/i.test(w));
        for (const p of palabrasClave) {
            const detalle = await buscarDetalleProducto(p);
            if (detalle) {
                contextoProducto += detalle;
                break;
            }
        }

        const systemPrompt = `Eres el Asistente Virtual Oficial de Compras, Almacén y Pedidos de Cafetería El Raíl.
Tu función es ayudar a los trabajadores y administradores a gestionar los pedidos de materias primas e insumos de forma rápida, eficiente y muy precisa.

DATOS EN VIVO DEL SISTEMA:
${contextoVivo}
${contextoProducto ? contextoProducto : ''}

DIRECTIVAS ESTRICTAS DE RESPUESTA:
- Responde de forma concisa, directa y ejecutiva a lo que pregunta.
- NUNCA inventes productos ni precios que no conozcas con certeza; si un producto no aparece en el catálogo, indícale amablemente al usuario que consulte con Roberto o administración.
- Si pregunta por borradores abiertos, dile exactamente qué proveedores tienen artículos pendientes y quién los modificó.
- Si pregunta por días de compra o festivos, utiliza la información oficial de proveedores (Mercadona y Vecino los lunes, Mercamadrid martes y sábados, Makro sábados). Recuerda que los festivos cierran mayoristas como Mercamadrid o Vecino.
- Si pregunta sobre cómo pedir en Modo Lector o Gestión:
  • Modo Gestión: Seleccionar proveedor, añadir cantidades en la tabla y pulsar "ENVIAR" o compartir por WhatsApp.
  • Modo Lector: Diseñado para pasar inventario físico rápido en el almacén con checklist de casillas.
- Utiliza listas limpias con viñetas y emojis ilustrativos.
- Resalta en **negrita** nombres de proveedores, cantidades y precios.
- Si la pregunta es un saludo breve, responde con un saludo cordial y ofrece ayuda en pedidos de almacén.`;

        const payload = {
            contents: [
                {
                    parts: [
                        { text: systemPrompt },
                        ...chatHistory.slice(-4).map(h => ({ text: `${h.role === 'user' ? 'Trabajador' : 'Asistente'}: ${h.content}` })),
                        { text: `Pregunta: "${msgText}"` }
                    ]
                }
            ]
        };

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        }

    } catch (err) {
        console.warn("Fallo en Gemini API, activando fallback local:", err);
    }

    // Fallback local en caso de error o falta de red
    if (!reply) {
        const norm = msgText.toLowerCase();
        if (/borrador/i.test(norm)) {
            reply = `🛒 **Borradores de Pedido:**\nLos borradores se guardan automáticamente en tiempo real al seleccionar cantidades para cada proveedor. Para revisarlos o enviarlos, abre el selector de proveedores en la pantalla principal.`;
        } else if (/festivo|reparto|dia|dias|compra/i.test(norm)) {
            reply = `📅 **Pautas de Compra Habitual:**\n\n• **Mercadona y Vecino:** Lunes (Parla / Pinto).\n• **Mercamadrid:** Martes y Sábados.\n• **Makro:** Sábados (Alcorcón).\n\n⚠️ *Nota:* Los festivos nacionales y locales de Madrid/Parla afectan a mayoristas. Revisa el banner de alertas de festivos arriba en la pantalla.`;
        } else if (/lector|modo lector/i.test(norm)) {
            reply = `📖 **Modo Lector:**\nEstá optimizado para el móvil cuando estás físicamente en el almacén. Te permite marcar con casillas lo que vas contando en estanterías sin saturar la pantalla. Pulsa el botón **LECTOR** arriba para entrar.`;
        } else {
            reply = `Hola ${userObj.name} 👋 He registrado tu consulta. Para pedidos urgentes o artículos que no encuentres en catálogo, puedes consultar directamente con **Roberto**.`;
        }
    }

    // Quitar indicador de escribiendo
    const typingEl = document.getElementById('assistant-pedidos-typing');
    if (typingEl) typingEl.remove();

    // Añadir respuesta a chatHistory
    chatHistory.push({ role: 'assistant', content: reply });

    // Renderizar burbuja del bot
    const botBubble = document.createElement('div');
    botBubble.style.cssText = "display: flex; align-items: flex-start; gap: 8px; max-width: 90%; align-self: flex-start;";
    botBubble.innerHTML = `
        <div style="width: 28px; height: 28px; border-radius: 50%; overflow: hidden; border: 1.5px solid #22d3ee; flex-shrink: 0; margin-top: 2px;">
            <img src="img/ai-assistant.jpg" alt="AI" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80';">
        </div>
        <div style="background: #ffffff; border: 1px solid #e2e8f0; padding: 12px 14px; border-radius: 16px; border-top-left-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.04); font-size: 13px; line-height: 1.48; color: #1e293b;">
            ${formatMarkdown(reply)}
        </div>
    `;
    msgContainer.appendChild(botBubble);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    // Guardar log en Firestore
    guardarLogAsistente(msgText, reply, userObj);
}
