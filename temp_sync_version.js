/* temp_sync_version.js - REST API VERSION */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

function getFirebaseToken() {
    // 1. Intentar leer desde configstore de firebase-tools
    const configPaths = [
        path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json'),
        path.join(process.env.HOME || '', '.config', 'configstore', 'firebase-tools.json')
    ];

    for (const p of configPaths) {
        if (p && fs.existsSync(p)) {
            try {
                const conf = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (conf.tokens && conf.tokens.access_token) {
                    return conf.tokens.access_token;
                }
            } catch (e) {}
        }
    }

    // 2. Fallback al comando CLI
    try {
        return execSync('firebase auth:print-access-token').toString().trim();
    } catch (e) {
        throw new Error("No se pudo obtener el token de Firebase CLI.");
    }
}

async function syncVersion() {
    const VERSION = "11.60";
    const PROJECT_ID = "pedidos-rail-app-2025-87f2c";
    
    console.log(`🚀 Sincronizando versión ${VERSION} con Firestore (REST API)...`);

    try {
        const token = getFirebaseToken();

        const data = JSON.stringify({
            fields: {
                version: { stringValue: VERSION },
                updatedAt: { timestampValue: new Date().toISOString() }
            }
        });

        const options = {
            hostname: 'firestore.googleapis.com',
            path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/system/config?updateMask.fieldPaths=version&updateMask.fieldPaths=updatedAt`,
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (d) => body += d);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log("✅ ¡ÉXITO! Versión actualizada en Firestore.");
                    process.exit(0);
                } else {
                    console.error(`❌ Error en la petición (Status ${res.statusCode}):`, body);
                    process.exit(1);
                }
            });
        });

        req.on('error', (e) => {
            console.error("❌ ERROR de red:", e);
            process.exit(1);
        });

        req.write(data);
        req.end();

    } catch (error) {
        console.error("❌ ERROR fatal al sincronizar versión:");
        console.error(error.message);
        process.exit(1);
    }
}

syncVersion();
