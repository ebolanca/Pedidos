/* scripts/sync_escandallo_cron.js - Sincronizador en la nube (GitHub Actions) */
const https = require('https');

const ESCANDALLO_CSV_URL = 'https://docs.google.com/spreadsheets/d/1B77f3gIVm-jx87fwy4nxM_8ZJp37V0eir6lyu_4ERME/gviz/tq?tqx=out:csv&gid=1786108103';
const SUPERMERCADOS_LIST = ['supeco', 'hiper usera', 'mercadona'];
const PROJECT_ID = "pedidos-rail-app-2025-87f2c";

function normalizarTexto(str) {
    if (!str) return '';
    return str.toString()
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parsearPrecio(str) {
    if (!str) return null;
    const cleaned = str.toString().replace(/[€\s"]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return (isNaN(num) || num <= 0) ? null : Math.round(num * 100) / 100;
}

function calcularTipoIVA(precioSinIva, precioConIva) {
    if (!precioSinIva || !precioConIva || precioSinIva <= 0 || precioConIva <= 0) return null;
    const ratio = precioConIva / precioSinIva;
    if (ratio < 1.01) return 0;
    if (ratio <= 1.07) return 4;
    if (ratio <= 1.16) return 10;
    return 21;
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function main() {
    console.log("🕒 [CRON LUNES] Iniciando sincronización de precios desde Escandallo...");
    try {
        const csvText = await fetchUrl(ESCANDALLO_CSV_URL);
        const lines = csvText.split(/\r?\n/);
        console.log(`📊 Filas descargadas de Google Sheets: ${lines.length}`);
        
        console.log("✅ Proceso de comprobación de Escandallo finalizado correctamente.");
    } catch (e) {
        console.error("❌ Error en cron de Escandallo:", e);
    }
}

main();
