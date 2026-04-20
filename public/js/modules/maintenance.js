/* public/js/modules/maintenance.js */
import { db } from './firebase-init.js';

/**
 * Ejecuta la limpieza de pedidos más antiguos de X días.
 * Solo debe ser llamada por administradores.
 */
export async function ejecutarMantenimientoPedidos(dias = 30) {
    console.log(`🧹 Iniciando mantenimiento automático (${dias} días)...`);
    
    const fechaCorte = new Date();
    fechaCorte.setDate(fechaCorte.getDate() - dias);
    
    try {
        const snap = await db.collection("pedidos")
            .where("fecha", "<", fechaCorte)
            .limit(100)
            .get();
            
        if (snap.empty) {
            console.log("✨ No hay pedidos antiguos que borrar.");
            return 0;
        }
        
        let batch = db.batch();
        let contador = 0;
        
        snap.forEach(doc => {
            batch.delete(doc.ref);
            contador++;
        });
        
        await batch.commit();
        console.log(`✅ Mantenimiento completado: ${contador} pedidos eliminados.`);
        return contador;
        
    } catch (e) {
        console.error("❌ Error en mantenimiento:", e);
        return -1;
    }
}
