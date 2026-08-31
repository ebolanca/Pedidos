// ==========================================================
// PEDIDOS REMINDER - BOT WHATSAPP HORARIOS
// Comprueba pedidos pendientes a las 15:00 del día anterior
// Agrupa por persona, gestiona sustitutos y exclusiones
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
    console.log(`\n🛒 [PEDIDOS REMINDER] Iniciando auditoría a las 15:00 (${dateStr} - Día actual: ${currentDayOfWeek}, Compra mañana: ${targetDayOfWeek})`);

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
            personalByName[nombre.toLowerCase()] = pInfo;
        });

        // 4. Cargar usuarios de Horarios (para obtener teléfonos)
        const usersSnap = await dbHorarios.collection('users').get();
        const usersByEmail = {};
        const usersByName = {};
        usersSnap.forEach(doc => {
            const u = doc.data();
            if (u.active !== false && u.phone) {
                if (u.email) usersByEmail[u.email.toLowerCase()] = u;
                const nameKey = (u.displayName || u.name || '').toLowerCase().trim();
                if (nameKey) usersByName[nameKey] = u;
            }
        });

        // 5. Auditar cada proveedor objetivo: ¿Tiene pedido/borrador hecho?
        const missingProviders = [];

        for (const provName of targetProviders) {
            const provConfig = provsMap[provName];
            // Regla estricta: Solo proveedores del lector
            if (!provConfig || provConfig.enLector !== true) {
                console.log(`⏩ [PEDIDOS REMINDER] Saltando ${provName} (no está activo en el lector).`);
                continue;
            }

            // Consultar borrador actual
            const borradorDoc = await fetchPedidosDoc(`borradores/${encodeURIComponent(provName)}`, token);
            let hasItems = false;
            if (borradorDoc && borradorDoc.fields && borradorDoc.fields.items) {
                const itemsMap = borradorDoc.fields.items.mapValue?.fields || {};
                const nonZeroItems = Object.values(itemsMap).filter(v => {
                    const val = parseFloat(v.integerValue || v.doubleValue || v.stringValue || 0);
                    return val > 0;
                });
                if (nonZeroItems.length > 0) hasItems = true;
            }

            if (hasItems) {
                console.log(`✅ [PEDIDOS REMINDER] ${provName}: Ya tiene productos en el borrador.`);
            } else {
                console.log(`⚠️ [PEDIDOS REMINDER] ${provName}: BORRADOR VACÍO. Falta hacer el pedido.`);
                missingProviders.push(provConfig);
            }
        }

        if (missingProviders.length === 0) {
            console.log(`🎉 [PEDIDOS REMINDER] Todos los pedidos para mañana ya están registrados.`);
            return { success: true, message: "Todos los pedidos están completados" };
        }

        // 6. Mapear proveedores pendientes por destinatario (agrupación)
        // Estructura: targetKey -> { name, email, phone, missingList: [ 'Mercamadrid', 'Makro' ] }
        const recipientQueue = {};

        for (const prov of missingProviders) {
            let respList = prov.responsables || [];
            if (respList.length === 0 || respList.includes("Todos")) {
                // Fallback por defecto si no hay responsables específicos
                respList = ["Jazmín", "Amina", "Flor", "Aarón"];
            }

            for (const respName of respList) {
                // A. Exclusión fija de Roberto
                if (EXCLUDED_NAMES.some(n => respName.toLowerCase().includes(n.toLowerCase()))) {
                    continue;
                }

                // B. Exclusión fija de Flor para Mercamadrid
                if (prov.id === 'Mercamadrid' && respName.toLowerCase().includes('flor')) {
                    console.log(`ℹ️ [PEDIDOS REMINDER] Excluyendo a Flor del aviso de Mercamadrid.`);
                    continue;
                }

                // C. Resolver si está de vacaciones y tiene sustituto
                let effectiveName = respName;
                let effectiveEmail = null;

                const personalData = personalByName[respName.toLowerCase()];
                if (personalData) {
                    effectiveEmail = personalData.email;
                    if (personalData.sustituto) {
                        console.log(`🏖️ [PEDIDOS REMINDER] ${respName} está de vacaciones. Reasignando a sustituto: ${personalData.sustituto}`);
                        effectiveName = personalData.sustituto;
                        effectiveEmail = personalData.sustitutoEmail || null;
                    }
                }

                // Si el sustituto es Roberto o Flor en Mercamadrid, volvemos a aplicar exclusiones
                if (EXCLUDED_NAMES.some(n => effectiveName.toLowerCase().includes(n.toLowerCase())) ||
                    (effectiveEmail && EXCLUDED_EMAILS.includes(effectiveEmail.toLowerCase()))) {
                    continue;
                }
                if (prov.id === 'Mercamadrid' && effectiveName.toLowerCase().includes('flor')) {
                    continue;
                }

                // D. Localizar teléfono del destinatario
                let userObj = null;
                if (effectiveEmail && usersByEmail[effectiveEmail.toLowerCase()]) {
                    userObj = usersByEmail[effectiveEmail.toLowerCase()];
                } else if (usersByName[effectiveName.toLowerCase()]) {
                    userObj = usersByName[effectiveName.toLowerCase()];
                }

                if (!userObj || !userObj.phone) {
                    console.warn(`⚠️ [PEDIDOS REMINDER] No se encontró teléfono para el encargado: ${effectiveName} (${effectiveEmail})`);
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

                if (!recipientQueue[targetKey].missingList.includes(prov.id)) {
                    recipientQueue[targetKey].missingList.push(prov.id);
                }
            }
        }

        // 7. Generar y enviar UN SOLO mensaje consolidado por destinatario
        const recipientsList = Object.values(recipientQueue);
        console.log(`📬 [PEDIDOS REMINDER] Destinatarios a notificar (${recipientsList.length}):`, recipientsList.map(r => `${r.name} (${r.missingList.join(', ')})`));

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

⚠️ Te recordamos que mañana hay compra de *${recipient.missingList[0]}* y todavía no se ha registrado el pedido en la app.

📝 Por favor, revisa existencias y añade los productos necesarios antes de finalizar el turno.

👉 ${PEDIDOS_APP_URL}`;
            } else {
                const provsBullets = recipient.missingList.map(p => `  ▫️ *${p}*`).join('\n');
                messageBody = `🤖 ¡Hola ${recipient.name}!

⚠️ Te recordamos que mañana hay compra de los siguientes proveedores y todavía no se ha registrado el pedido en la app:

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

        console.log(`✅ [PEDIDOS REMINDER] Proceso completado. Mensajes enviados/simulados: ${sentCount}`);
        return { success: true, sentCount, recipients: recipientsList };

    } catch (err) {
        console.error(`❌ [PEDIDOS REMINDER] Error durante la comprobación:`, err);
        return { success: false, error: err.message };
    }
}

module.exports = { checkPedidosReminders, SCHEDULE_CONFIG };
