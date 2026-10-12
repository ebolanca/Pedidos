/* public/js/modules/maintenance.js */
import { db } from './firebase-init.js';

/**
 * Ejecuta la limpieza de pedidos más antiguos de X días.
 * Solo debe ser llamada por administradores.
 */
export async function ejecutarMantenimientoPedidos(dias = 30) {
    console.log(`ℹ️ Mantenimiento desactivado: el histórico de pedidos se conserva permanentemente.`);
    return 0;
}
