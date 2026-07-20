/* temp_sync_version.js - REST API VERSION */
const { execSync } = require('child_process');
const https = require('https');

async function syncVersion() {
    const VERSION = "11.43";
    const PROJECT_ID = "pedidos-rail-app-2025-87f2c";
    
    console.log(`🚀 Sincronizando versión ${VERSION} con Firestore (REST API)...`);

    try {
        // 1. Obtener token del CLI
        console.log("🔑 Obteniendo token de acceso de Firebase CLI...");
        const token = execSync('firebase auth:print-access-token').toString().trim();

        // 2. Preparar el cuerpo de la petición para parchear el documento config
        // Documento: projects/PROJECT_ID/databases/(default)/documents/system/config
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
        console.error("❌ ERROR fatal al obtener token o ejecutar script:");
        console.error(error.message);
        process.exit(1);
    }
}

syncVersion();
