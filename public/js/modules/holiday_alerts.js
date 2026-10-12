/* =============================================================
   HOLIDAY_ALERTS.JS - Sistema de Alertas Preventivas de Festivos
   Detecta con 7 días de antelación si un proveedor habitual
   estará cerrado el día que se suele ir a comprar.
   Permite confirmación manual para casos como Mercamadrid.
   ============================================================= */

import { db } from './firebase-init.js';

// 1. Configuración de Proveedores del Lector
export const HOLIDAY_PROVIDERS = {
    'Mercamadrid': {
        nombre: 'Mercamadrid',
        diasCompra: [1, 2, 6], // Lunes (1), Martes (2), Sábado (6)
        cierraEnFestivo: true,
        requiereConfirmacion: true, // Acuerdos variables en puentes
        municipio: 'Madrid',
        nota: 'Sujeto a circulares y acuerdos de mayoristas'
    },
    'Mercadona': {
        nombre: 'Mercadona',
        diasCompra: [1], // Lunes (1)
        cierraEnFestivo: true,
        municipio: 'Parla',
        nota: 'Cierra domingos y festivos al 100%'
    },
    'Hiper Usera': {
        nombre: 'Hiper Usera',
        diasCompra: [1], // Lunes (1)
        cierraEnFestivo: true,
        municipio: 'Parla',
        nota: 'Cash mayorista cerrado en festivos'
    },
    'Vecino': {
        nombre: 'Vecino (Cash Hiper)',
        diasCompra: [1], // Lunes (1)
        cierraEnFestivo: true,
        municipio: 'Pinto',
        nota: 'Cash mayorista cerrado en festivos'
    },
    'Supeco': {
        nombre: 'Supeco',
        diasCompra: [1], // Lunes (1)
        cierraEnFestivo: false,
        festivosCierreEspecial: ['01-01', '01-06', '05-01', '12-25'],
        municipio: 'Parla',
        nota: 'Suele abrir festivos ordinarios'
    },
    'Makro': {
        nombre: 'Makro',
        diasCompra: [6], // Sábado (6)
        cierraEnFestivo: false,
        festivosCierreEspecial: ['01-01', '01-06', '05-01', '12-25', '09-08'],
        municipio: 'Alcorcón',
        nota: 'Abre festivos autorizados de comercio'
    },
    'Chinos': {
        nombre: 'Chinos (Menaje)',
        diasCompra: [1], // Lunes (1)
        cierraEnFestivo: false,
        festivosCierreEspecial: ['01-01', '12-25'],
        municipio: 'Fuenlabrada',
        nota: 'Cobo Calleja suele abrir festivos'
    },
    'Inde': {
        nombre: 'Inde (Super Carrier)',
        diasCompra: [1], // Lunes (1)
        cierraEnFestivo: false,
        festivosCierreEspecial: ['01-01', '12-25'],
        municipio: 'Fuenlabrada',
        nota: 'Cobo Calleja suele abrir festivos'
    }
};

// 2. Diccionario de festivos (Nacionales, Autonómicos y Locales)
export const FESTIVOS_DB = {
    // Fijos anuales Nacionales y Comunidad de Madrid
    '01-01': { nombre: 'Año Nuevo', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '01-06': { nombre: 'Epifanía del Señor (Reyes)', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '05-01': { nombre: 'Fiesta del Trabajo', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '05-02': { nombre: 'Fiesta de la Comunidad de Madrid', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '08-15': { nombre: 'Asunción de la Virgen', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '10-12': { nombre: 'Fiesta Nacional de España', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '11-01': { nombre: 'Todos los Santos', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '12-06': { nombre: 'Día de la Constitución', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '12-08': { nombre: 'Inmaculada Concepción', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '12-25': { nombre: 'Natividad del Señor (Navidad)', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },

    // Locales Madrid Capital (Mercamadrid)
    '05-15': { nombre: 'San Isidro Labrador', ambito: ['Madrid', 'Pinto'] },
    '11-09': { nombre: 'Nuestra Señora de la Almudena', ambito: ['Madrid'] },

    // Locales Parla (Mercadona, Hiper Usera, Supeco)
    '06-15': { nombre: 'Fiesta del Agua (Parla)', ambito: ['Parla'] },
    '09-14': { nombre: 'Fiestas Patronales de Parla', ambito: ['Parla', 'Fuenlabrada'] },

    // Locales Pinto (Cash Hiper Vecino)
    '03-19': { nombre: 'San José (Pinto)', ambito: ['Pinto'] },

    // Locales Fuenlabrada (Cobo Calleja: Inde, Chinos)
    '12-26': { nombre: 'San Esteban (Fuenlabrada)', ambito: ['Fuenlabrada'] },

    // Locales Alcorcón (Makro)
    '09-08': { nombre: 'Ntra. Sra. de los Remedios (Alcorcón)', ambito: ['Alcorcón'] },

    // Festivos móviles y traslados específicos:
    // --- 2026 ---
    '2026-04-02': { nombre: 'Jueves Santo', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '2026-04-03': { nombre: 'Viernes Santo', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '2026-11-02': { nombre: 'Traslado de Todos los Santos (Lunes)', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '2026-12-07': { nombre: 'Traslado Día de la Constitución (Lunes)', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },

    // --- 2027 ---
    '2027-03-25': { nombre: 'Jueves Santo', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] },
    '2027-03-26': { nombre: 'Viernes Santo', ambito: ['Madrid', 'Parla', 'Pinto', 'Fuenlabrada', 'Alcorcón'] }
};

const NOMBRES_DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const NOMBRES_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Cache en memoria de confirmaciones manuales
let manualOverrides = {};
let overridesLoaded = false;

/**
 * Carga confirmaciones manuales guardadas en Firestore o localStorage
 */
async function cargarOverrides() {
    if (overridesLoaded) return;
    try {
        const local = localStorage.getItem('holiday_overrides');
        if (local) manualOverrides = JSON.parse(local);

        if (db) {
            const doc = await db.collection("system").doc("festivos_override").get();
            if (doc.exists) {
                manualOverrides = { ...manualOverrides, ...doc.data() };
                localStorage.setItem('holiday_overrides', JSON.stringify(manualOverrides));
            }
        }
        overridesLoaded = true;
    } catch (e) {
        console.warn("No se pudieron cargar overrides de festivos:", e);
    }
}

/**
 * Comprueba si una fecha concreta es festiva para un municipio dado
 */
export function getFestivoInfo(date, municipio) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');

    const keyFull = `${yyyy}-${mm}-${dd}`;
    const keyShort = `${mm}-${dd}`;

    const festivo = FESTIVOS_DB[keyFull] || FESTIVOS_DB[keyShort];
    if (!festivo) return null;

    if (festivo.ambito.includes(municipio)) {
        return festivo;
    }
    return null;
}

/**
 * Obtiene las alertas de cierres previstos en los próximos X días (por defecto 7)
 */
export function obtenerAlertasProximosFestivos(diasAntelacion = 7, mockDate = null) {
    const alertas = [];
    const baseDate = mockDate ? new Date(mockDate) : new Date();

    baseDate.setHours(0, 0, 0, 0);

    for (let i = 0; i <= diasAntelacion; i++) {
        const checkDate = new Date(baseDate);
        checkDate.setDate(checkDate.getDate() + i);

        const dayOfWeek = checkDate.getDay();
        const yyyy = checkDate.getFullYear();
        const mm = String(checkDate.getMonth() + 1).padStart(2, '0');
        const dd = String(checkDate.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const mmdd = `${mm}-${dd}`;

        const comerciosCerrados = [];
        const comerciosConfirmadosAbiertos = [];
        const comerciosPendientesConfirmar = [];
        let nombreFestivoDetectado = '';

        for (const [key, prov] of Object.entries(HOLIDAY_PROVIDERS)) {
            if (!prov.diasCompra.includes(dayOfWeek)) continue;

            const festivoInfo = getFestivoInfo(checkDate, prov.municipio);
            if (!festivoInfo) continue;

            if (!nombreFestivoDetectado) nombreFestivoDetectado = festivoInfo.nombre;

            // Verificar si hay override manual (ej. para Mercamadrid)
            const overrideKey = `${dateStr}_${key}`;
            const overrideVal = manualOverrides[overrideKey];

            if (overrideVal === 'abierto') {
                comerciosConfirmadosAbiertos.push(prov.nombre);
                continue;
            } else if (overrideVal === 'cerrado') {
                comerciosCerrados.push(prov.nombre);
                continue;
            }

            // Lógica por defecto
            if (prov.requiereConfirmacion) {
                comerciosPendientesConfirmar.push({ id: key, nombre: prov.nombre, overrideKey });
            } else if (prov.cierraEnFestivo) {
                comerciosCerrados.push(prov.nombre);
            } else if (prov.festivosCierreEspecial && prov.festivosCierreEspecial.includes(mmdd)) {
                comerciosCerrados.push(prov.nombre);
            }
        }

        if (comerciosCerrados.length > 0 || comerciosPendientesConfirmar.length > 0) {
            const diasFaltan = i;
            let tiempoTexto = "";
            if (diasFaltan === 0) tiempoTexto = "¡HOY!";
            else if (diasFaltan === 1) tiempoTexto = "MAÑANA";
            else tiempoTexto = `en ${diasFaltan} días`;

            const diaSemana = NOMBRES_DIAS[dayOfWeek];
            const diaNum = checkDate.getDate();
            const mesNombre = NOMBRES_MESES[checkDate.getMonth()];

            alertas.push({
                fecha: checkDate,
                dateStr: dateStr,
                fechaFormateada: `${diaSemana} ${diaNum} de ${mesNombre}`,
                diasFaltan: diasFaltan,
                tiempoTexto: tiempoTexto,
                festivo: nombreFestivoDetectado,
                cerrados: comerciosCerrados,
                pendientes: comerciosPendientesConfirmar,
                abiertos: comerciosConfirmadosAbiertos
            });
        }
    }

    return alertas;
}

/**
 * Renderiza el banner de alerta en el contenedor indicado
 */
export async function renderHolidayAlerts(containerId = 'holiday-alerts-gestion') {
    const container = document.getElementById(containerId);
    if (!container) return;

    await cargarOverrides();

    const descartado = sessionStorage.getItem(`holiday_alert_dismissed_${containerId}`);
    if (descartado === 'true') {
        container.innerHTML = '';
        return;
    }

    const alertas = obtenerAlertasProximosFestivos(7);
    if (alertas.length === 0) {
        container.innerHTML = '';
        return;
    }

    const a = alertas[0]; // La más próxima

    let listaCerradosHtml = '';
    if (a.cerrados.length > 0) {
        listaCerradosHtml = `
            <div class="holiday-alert-group">
                <span class="holiday-badge-red">🛑 CERRADO SEGURO:</span>
                <span class="holiday-names-bold">${a.cerrados.join(', ')}</span>
            </div>
        `;
    }

    let pendientesHtml = '';
    if (a.pendientes.length > 0) {
        pendientesHtml = a.pendientes.map(p => `
            <div class="holiday-alert-override-box">
                <div class="holiday-override-text">
                    <strong>⚠️ ${p.nombre}:</strong> Jornada festiva/puente variable. ¿Abren este día?
                </div>
                <div class="holiday-override-actions">
                    <button class="btn-holiday-confirm open" onclick="establecerHolidayOverride('${p.overrideKey}', 'abierto', '${containerId}')">
                        ✓ Sí, abre
                    </button>
                    <button class="btn-holiday-confirm close" onclick="establecerHolidayOverride('${p.overrideKey}', 'cerrado', '${containerId}')">
                        ✕ No, cierra
                    </button>
                </div>
            </div>
        `).join('');
    }

    let abiertosHtml = '';
    if (a.abiertos.length > 0) {
        abiertosHtml = `
            <div class="holiday-alert-group" style="margin-top:6px;">
                <span class="holiday-badge-green">✅ CONFIRMADO ABIERTO:</span>
                <span style="color:#065f46; font-size:13px; font-weight:600">${a.abiertos.join(', ')}</span>
            </div>
        `;
    }

    let sugerencia = "Planifica o adelanta tus pedidos con antelación.";
    if (a.fecha.getDay() === 1) {
        sugerencia = "💡 Sugerencia: Adelanta la compra al sábado anterior.";
    } else if (a.fecha.getDay() === 2) {
        sugerencia = "💡 Sugerencia: Si Mercamadrid cierra el martes, adelanta al lunes o pasa al miércoles.";
    } else if (a.fecha.getDay() === 6) {
        sugerencia = "💡 Sugerencia: Realiza las compras el viernes previo.";
    }

    container.innerHTML = `
        <div class="holiday-alert-card">
            <div class="holiday-alert-header">
                <div class="holiday-alert-badge">⚠️ AVISO DE FESTIVO (${a.tiempoTexto.toUpperCase()})</div>
                <button class="holiday-alert-close" onclick="cerrarHolidayAlert('${containerId}')" title="Descartar aviso">✕</button>
            </div>
            <div class="holiday-alert-body">
                <div class="holiday-alert-title">
                    El <strong>${a.fechaFormateada}</strong> (${a.festivo})
                </div>
                ${listaCerradosHtml}
                ${pendientesHtml}
                ${abiertosHtml}
                <div class="holiday-alert-tip">${sugerencia}</div>
            </div>
        </div>
    `;
}

/**
 * Permite confirmar o descartar apertura de un proveedor para un festivo concreto
 */
export async function establecerHolidayOverride(overrideKey, valor, containerId) {
    manualOverrides[overrideKey] = valor;
    localStorage.setItem('holiday_overrides', JSON.stringify(manualOverrides));

    if (db) {
        try {
            await db.collection("system").doc("festivos_override").set({
                [overrideKey]: valor,
                actualizadoEn: new Date()
            }, { merge: true });
        } catch (e) {
            console.warn("Guardado localmente. Error en Firestore:", e);
        }
    }

    // Volver a renderizar
    renderHolidayAlerts(containerId);
    // Si hay otro contenedor hermano (ej. lector), actualizarlo también
    const otherContainer = containerId === 'holiday-alerts-gestion' ? 'holiday-alerts-lector' : 'holiday-alerts-gestion';
    renderHolidayAlerts(otherContainer);
}

/**
 * Permite cerrar la alerta para la sesión actual
 */
export function cerrarHolidayAlert(containerId = 'holiday-alerts-gestion') {
    sessionStorage.setItem(`holiday_alert_dismissed_${containerId}`, 'true');
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '';
    }
}

// Exportar globalmente para eventos onclick
if (typeof window !== 'undefined') {
    window.cerrarHolidayAlert = cerrarHolidayAlert;
    window.renderHolidayAlerts = renderHolidayAlerts;
    window.establecerHolidayOverride = establecerHolidayOverride;
}
