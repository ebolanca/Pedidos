// ==========================================================
// PEDIDOS REMINDER - BOT WHATSAPP HORARIOS
// Comprueba pedidos pendientes a las 15:00 del día anterior
// Agrupa por persona, verifica productos por responsable,
// gestiona sustitutos y aplica exclusiones
// ==========================================================

const https = require('https');

const PEDIDOS_API_KEY = "AIzaSyATkItPtDhyjv9hkL54Q1JZauK5DfqdKh4";
const PEDIDOS_PROJECT_ID = "pedidos-rail-app-2025-87f2c";
const PEDIDOS_APP_URL = "https://pedidos-rail-app-2025-87f2c.web.app";

// Días de compra por proveedor (0 = Domingo, 1 = Lunes, 2 = Martes, 3 = Miércoles, 4 = Jueves, 5 = Viernes, 6 = Sábado)
// La alarma se comprueba a las 15:00 del día previo (diaAlarma = (diaCompra + 6) % 7)
const SCHEDULE_CONFIG = [
    // SÁBADO (6): Mercamadrid y Makro -> Alarma VIERNES (5) a las 15:00
    { dayOfWeekCompra: 6, providers: ['Mercamadrid', 'Makro'] },
    // LUNES (1): Mercamadrid, Vecino, Chinos, Hiper Usera, Supeco, Mercadona -> Alarma DOMINGO (0) a las 15:00
    { dayOfWeekCompra: 1, providers: ['Mercamadrid', 'Vecino', 'Chinos', 'Hiper Usera', 'Supeco', 'Mercadona'] },
    // MARTES (2): Mercamadrid -> Alarma LUNES (1) a las 15:00
    { dayOfWeekCompra: 2, providers: ['Mercamadrid'] }
];

// Nombres y emails de Roberto (Siempre excluido de WhatsApp)
const EXCLUDED_EMAILS = [
    "quiebrakanto@gmail.com",
    "ebolanca@hotmail.com"
];

const EXCLUDED_NAMES = ["Roberto", "roberto"];

// Caché de eventos notificados para evitar spam (Formato: reminder_YYYY-MM-DD_userEmail)
const notifiedDailyReminders = new Set();

// Autenticación anónima para consultar Firestore de Pedidos vía REST API
async function getPedidosAuthToken() {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ returnSecureToken: true });
        const req = https.request({
            hostname: 'identitytoolkit.googleapis.com',
            path: `/v1/accounts:signUp?key=${PEDIDOS_API_KEY}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.idToken) resolve(data.idToken);
                    else reject(new Error(data.error?.message || "No se pudo obtener token anónimo"));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

// Petición GET genérica a Firestore de Pedidos
async function fetchPedidosFirestore(collectionPath, token) {
    return new Promise((resolve, reject) => {
        https.get({
            hostname: 'firestore.googleapis.com',
            path: `/v1/projects/${PEDIDOS_PROJECT_ID}/databases/(default)/documents/${collectionPath}?pageSize=100`,
            headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve(parsed.documents || []);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Obtener un documento específico de Pedidos
async function fetchPedidosDoc(docPath, token) {
    return new Promise((resolve) => {
        https.get({
            hostname: 'firestore.googleapis.com',
            path: `/v1/projects/${PEDIDOS_PROJECT_ID}/databases/(default)/documents/${docPath}`,
            headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
            if (res.statusCode === 404) return resolve(null);
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

function normalizeName(str) {
    if (!str) return '';
    return str.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/**
 * Función principal para comprobar pedidos y enviar recordatorios agrupados
 * @param {Object} dbHorarios - Instancia Firestore de Firebase Admin en Horarios
 * @param {Function} sendMessage - Función para enviar WhatsApp con Meta Cloud API
 * @param {Object} [options] - Opciones para testing manual
 */
async function checkPedidosReminders(dbHorarios, sendMessage, options = {}) {
    const now = options.mockDate ? new Date(options.mockDate) : new Date();
    const currentDayOfWeek = now.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
    const targetDayOfWeek = (currentDayOfWeek + 1) % 7; // Día de compra mañana

    const dateStr = now.toLocaleDateString("es-ES", { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Madrid' });
    console.log(`\n🛒 [PEDIDOS REMINDER] Iniciando auditoría detallada a las 15:00 (${dateStr} - Hoy: día ${currentDayOfWeek}, Compra mañana: día ${targetDayOfWeek})`);

    // 1. Identificar proveedores programados para comprar mañana
    const scheduledSchedules = SCHEDULE_CONFIG.filter(s => s.dayOfWeekCompra === targetDayOfWeek);
    if (scheduledSchedules.length === 0) {
        console.log(`ℹ️ [PEDIDOS REMINDER] Mañana (día ${targetDayOfWeek}) no hay compras programadas.`);
        return { success: true, message: "Sin compras programadas para mañana" };
    }

    const targetProviders = Array.from(new Set(scheduledSchedules.flatMap(s => s.providers)));
    console.log(`📋 [PEDIDOS REMINDER] Proveedores con compra programada para mañana: ${targetProviders.join(', ')}`);

    try {
        // 2. Autenticación con Pedidos Firestore
        const token = await getPedidosAuthToken();

        // 3. Cargar proveedores y personal de Pedidos
        const [rawProvs, rawPersonal] = await Promise.all([
            fetchPedidosFirestore('proveedores', token),
            fetchPedidosFirestore('personal', token)
        ]);

        // Mapa de Proveedores con su configuración (lector y responsables)
        const provsMap = {};
        rawProvs.forEach(d => {
            const id = d.name.split('/').pop();
            const f = d.fields || {};
            const enLector = f.enLector?.booleanValue ?? false;
            const resp = (f.responsables?.arrayValue?.values || []).map(v => v.stringValue).filter(Boolean);
            provsMap[id] = { id, enLector, responsables: resp };
        });

        // Mapa de Personal (para sustitutos de vacaciones)
        const personalByEmail = {};
        const personalByName = {};
        rawPersonal.forEach(d => {
            const email = d.name.split('/').pop();
            const f = d.fields || {};
            const nombre = f.nombre?.stringValue || email;
            const sustituto = f.sustituto?.stringValue || null;
            const sustitutoEmail = f.sustitutoEmail?.stringValue || null;
            const pInfo = { email, nombre, sustituto, sustitutoEmail };
            personalByEmail[email.toLowerCase()] = pInfo;
            personalByName[normalizeName(nombre)] = pInfo;
        });

        // 4. Cargar usuarios de Horarios (para obtener teléfonos)
        const usersSnap = await dbHorarios.collection('users').get();
        const usersByEmail = {};
        const usersByName = {};
        usersSnap.forEach(doc => {
            const u = doc.data();
            if (u.active !== false && u.phone) {
                if (u.email) usersByEmail[u.email.toLowerCase()] = u;
                const nameKey = normalizeName(u.displayName || u.name || '');
                if (nameKey) usersByName[nameKey] = u;
            }
        });

        // 5. Auditoría a nivel de responsable para cada proveedor programado
        // recipientQueue: targetKey -> { name, email, phone, missingList: [ 'Mercamadrid', ... ] }
        const recipientQueue = {};

        for (const provName of targetProviders) {
            const provConfig = provsMap[provName];
            // Regla estricta: Solo proveedores del lector
            if (!provConfig || provConfig.enLector !== true) {
                console.log(`⏩ [PEDIDOS REMINDER] Saltando ${provName} (no está activo en el lector).`);
                continue;
            }

            // A. Obtener todos los productos de este proveedor
            const rawProds = await fetchPedidosFirestore(`proveedores/${encodeURIComponent(provName)}/productos`, token);
            
            // Mapear productos por responsable
            // prodInfo: { id, nombre, responsable }
            const productsList = rawProds.map(pDoc => {
                const pId = pDoc.name.split('/').pop();
                const pFields = pDoc.fields || {};
                const pResp = pFields.responsable?.stringValue ? pFields.responsable.stringValue.trim() : 'Todos';
                return { id: pId, responsable: pResp };
            });

            // B. Consultar borrador actual de este proveedor
            const borradorDoc = await fetchPedidosDoc(`borradores/${encodeURIComponent(provName)}`, token);
            const draftItems = borradorDoc?.fields?.items?.mapValue?.fields || {};
            
            // Set de IDs de productos en el borrador con cantidad > 0
            const activeDraftProdIds = new Set();
            for (const [prodId, valObj] of Object.entries(draftItems)) {
                const qty = parseFloat(valObj.integerValue || valObj.doubleValue || valObj.stringValue || 0);
                if (qty > 0) activeDraftProdIds.add(prodId);
            }

            // C. Determinar la lista de responsables que tienen productos en este proveedor
            const respInProviderSet = new Set();
            productsList.forEach(p => {
                if (p.responsable && p.responsable !== 'Todos') {
                    respInProviderSet.add(p.responsable);
                }
            });

            // Si no hay productos con responsable específico, usar la lista del proveedor
            if (respInProviderSet.size === 0) {
                (provConfig.responsables || []).forEach(r => {
                    if (r && r !== 'Todos') respInProviderSet.add(r);
                });
            }

            // Fallback por defecto si no está especificado
            if (respInProviderSet.size === 0) {
                ['Jazmín', 'Amina', 'Aarón'].forEach(r => respInProviderSet.add(r));
            }

            console.log(`🔍 [PEDIDOS REMINDER] ${provName} - Encargados evaluados: ${Array.from(respInProviderSet).join(', ')}`);

            // D. Para cada responsable, comprobar si SUS productos están en el borrador
            for (const respName of respInProviderSet) {
                const normResp = normalizeName(respName);

                // Exclusión de Roberto
                if (EXCLUDED_NAMES.some(n => normResp.includes(normalizeName(n)))) {
                    continue;
                }

                // Exclusión de Flor para Mercamadrid
                if (provName === 'Mercamadrid' && normResp.includes('flor')) {
                    console.log(`ℹ️ [PEDIDOS REMINDER] Excluyendo a Flor del aviso de Mercamadrid.`);
                    continue;
                }

                // Productos específicos de este responsable
                const myProducts = productsList.filter(p => normalizeName(p.responsable) === normResp);
                
                let hasOrderedMyPart = false;
                if (myProducts.length > 0) {
                    // Si tiene productos asignados, verificar si al menos uno de SUS productos tiene cantidad > 0
                    hasOrderedMyPart = myProducts.some(p => activeDraftProdIds.has(p.id));
                } else {
                    // Si no tiene productos asignados específicos (proveedor genérico), comprobar si hay cualquier item > 0
                    hasOrderedMyPart = activeDraftProdIds.size > 0;
                }

                if (hasOrderedMyPart) {
                    console.log(`✅ [PEDIDOS REMINDER] ${respName} YA ha completado su parte de ${provName}.`);
                    continue;
                }

                console.log(`⚠️ [PEDIDOS REMINDER] ${respName} NO ha completado su parte de ${provName} (0 productos suyos en borrador).`);

                // E. Resolver sustituto si está de vacaciones
                let effectiveName = respName;
                let effectiveEmail = null;

                const personalData = personalByName[normResp];
                if (personalData) {
                    effectiveEmail = personalData.email;
                    if (personalData.sustituto) {
                        console.log(`🏖️ [PEDIDOS REMINDER] ${respName} está de vacaciones. Reasignando a: ${personalData.sustituto}`);
                        effectiveName = personalData.sustituto;
                        effectiveEmail = personalData.sustitutoEmail || null;
                    }
                }

                // Re-verificar exclusiones sobre el sustituto
                const normEffective = normalizeName(effectiveName);
                if (EXCLUDED_NAMES.some(n => normEffective.includes(normalizeName(n))) ||
                    (effectiveEmail && EXCLUDED_EMAILS.includes(effectiveEmail.toLowerCase()))) {
                    continue;
                }
                if (provName === 'Mercamadrid' && normEffective.includes('flor')) {
                    continue;
                }

                // F. Localizar teléfono del destinatario
                let userObj = null;
                if (effectiveEmail && usersByEmail[effectiveEmail.toLowerCase()]) {
                    userObj = usersByEmail[effectiveEmail.toLowerCase()];
                } else if (usersByName[normEffective]) {
                    userObj = usersByName[normEffective];
                }

                if (!userObj || !userObj.phone) {
                    console.warn(`⚠️ [PEDIDOS REMINDER] No se encontró teléfono para: ${effectiveName} (${effectiveEmail})`);
                    continue;
                }

                const targetKey = userObj.email ? userObj.email.toLowerCase() : userObj.phone;
                if (!recipientQueue[targetKey]) {
                    recipientQueue[targetKey] = {
                        name: userObj.displayName || userObj.name || effectiveName,
                        email: userObj.email || effectiveEmail,
                        phone: userObj.phone,
                        missingList: []
                    };
                }

                if (!recipientQueue[targetKey].missingList.includes(provName)) {
                    recipientQueue[targetKey].missingList.push(provName);
                }
            }
        }

        // 6. Generar y enviar UN SOLO mensaje consolidado por destinatario
        const recipientsList = Object.values(recipientQueue);
        console.log(`\n📬 [PEDIDOS REMINDER] Total destinatarios pendientes (${recipientsList.length}):`, recipientsList.map(r => `${r.name} (${r.missingList.join(', ')})`));

        if (recipientsList.length === 0) {
            console.log(`🎉 [PEDIDOS REMINDER] Todos los encargados han completado sus pedidos para mañana.`);
            return { success: true, message: "Todos los pedidos están completados", sentCount: 0 };
        }

        let sentCount = 0;
        const todayKey = now.toISOString().split('T')[0];

        for (const recipient of recipientsList) {
            const reminderKey = `reminder_${todayKey}_${recipient.email || recipient.phone}`;
            if (notifiedDailyReminders.has(reminderKey) && !options.force) {
                console.log(`🔇 [PEDIDOS REMINDER] ${recipient.name} ya fue notificado/a hoy (${reminderKey}).`);
                continue;
            }

            let messageBody = "";
            if (recipient.missingList.length === 1) {
                messageBody = `🤖 ¡Hola ${recipient.name}!

⚠️ Te recordamos que mañana hay compra de *${recipient.missingList[0]}* y todavía no has registrado tus productos en la app.

📝 Por favor, revisa existencias y añade los productos necesarios antes de finalizar el turno.

👉 ${PEDIDOS_APP_URL}`;
            } else {
                const provsBullets = recipient.missingList.map(p => `  ▫️ *${p}*`).join('\n');
                messageBody = `🤖 ¡Hola ${recipient.name}!

⚠️ Te recordamos que mañana hay compra de los siguientes proveedores y todavía no has registrado tus productos en la app:

${provsBullets}

📝 Por favor, revisa existencias y añade los productos necesarios antes de finalizar el turno.

👉 ${PEDIDOS_APP_URL}`;
            }

            console.log(`📲 [PEDIDOS REMINDER] Enviando WhatsApp a ${recipient.name} (${recipient.phone})...`);
            
            if (options.dryRun) {
                console.log(`[DRY RUN - SIMULACIÓN]\n${messageBody}\n-----------------------------------`);
                sentCount++;
            } else {
                const ok = await sendMessage(recipient.phone, messageBody, recipient.email);
                if (ok) {
                    sentCount++;
                    notifiedDailyReminders.add(reminderKey);
                }
            }
        }

        console.log(`✅ [PEDIDOS REMINDER] Proceso completado. Mensajes enviados: ${sentCount}`);
        return { success: true, sentCount, recipients: recipientsList };

    } catch (err) {
        console.error(`❌ [PEDIDOS REMINDER] Error durante la comprobación:`, err);
        return { success: false, error: err.message };
    }
}

module.exports = { checkPedidosReminders, SCHEDULE_CONFIG };
