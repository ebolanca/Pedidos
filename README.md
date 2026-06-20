# Pedidos Rail App

Aplicación web móvil-first para la gestión y realización de pedidos de materias primas e insumos de proveedores. Cuenta con sincronización en tiempo real a través de Firebase Firestore y soporte offline mediante un Service Worker (PWA).

---

## 🚀 Características Principales

*   **Panel de Pedidos**: Visualización en tiempo real de los últimos pedidos enviados y cancelados, filtrado automático por rol de usuario (los administradores ven todo, el personal ve los suyos propios).
*   **Catálogo Interactivo**: Realización de pedidos con cantidades, pesos, notas por producto y buscador rápido con filtros por proveedor/categoría.
*   **Gestor de Catálogo y Parámetros (Pantalla de Gestión)**:
    *   Administración completa de productos (CRUD: Crear, Leer, Actualizar, Borrar).
    *   Gestión de proveedores y asignación de personal responsable (quién puede realizar pedidos a cada proveedor).
    *   Traspaso automático de productos entre proveedores (limpieza e indexado dinámico de claves).
    *   Seguimiento del historial de precios y variaciones de costes.
*   **Modo Lector**: Vista simplificada optimizada para la lectura rápida de productos y revisión de checklists en almacén.
*   **Herramientas Auxiliares integradas**:
    *   Calculadora de coste por unidad (€/Unidad).
    *   Calculadora aritmética integrada con historial.
*   **Soporte Offline**: Uso de un Service Worker que cachea los recursos esenciales de la interfaz de usuario para permitir el acceso básico sin conexión.

---

## 🛠️ Tecnologías

*   **Frontend**: HTML5, CSS3 (diseño mobile-first adaptativo con variables y modales Bottom-Sheet), JavaScript (ES6+ Modular).
*   **Base de Datos y Autenticación**: Firebase Auth (Autenticación de personal) y Firebase Firestore (Persistencia de datos y borradores en tiempo real).
*   **PWA**: Service Worker para almacenamiento en caché local.

---

## 📂 Estructura de Directorios

```text
├── .agent/                  # Configuración y workflows del agente de codificación
│   └── workflows/           # Guías de automatización (/deploy, /preview, etc.)
├── public/                  # Directorio raíz del servidor estático (Hosting)
│   ├── css/
│   │   ├── styles.css       # Estilos principales de la aplicación de usuario
│   │   └── admin.css        # Estilos modernos para la consola de administración
│   ├── js/
│   │   ├── modules/         # Módulos de JavaScript reutilizables (Firebase, constantes, utils)
│   │   ├── main.js          # Lógica principal del panel de pedidos de usuario
│   │   ├── admin.js         # Lógica del gestor de catálogo y proveedores
│   │   └── config.js        # Configuración de credenciales de Firebase y mapa de usuarios
│   ├── index.html           # Vista principal del gestor de pedidos
│   ├── admin.html           # Vista de gestión de catálogo
│   ├── login.html           # Portal de inicio de sesión
│   └── sw.js                # Service Worker para control de caché PWA
├── firebase.json            # Configuración de despliegue de Firebase Hosting
├── package.json             # Dependencias del proyecto (utilidades del sistema)
└── temp_sync_version.js     # Script auxiliar de sincronización de versiones de Firestore
```

---

## 🔄 Flujos de Trabajo (Slash Commands)

El proyecto cuenta con workflows predefinidos para la automatización de tareas en la terminal:

### 1. Previsualización Local (`/preview`)
Para levantar un servidor local en el puerto `8080` con recarga automática:
```powershell
npx live-server --port=8080 --open
```

### 2. Despliegue de Reglas de Seguridad (`/rules`)
Para aplicar cambios de seguridad definidos en las directivas de Firestore:
```powershell
firebase deploy --only firestore:rules
```

### 3. Actualización de Versión y Despliegue (`/deploy`)
Este workflow automatiza la puesta en producción siguiendo estos pasos:
1.  Incrementar la versión (ej. `11.34` -> `11.35`) en `public/js/modules/constants.js`.
2.  Bumpear el identificador de la memoria caché (`CACHE_NAME`) en `public/sw.js`.
3.  Actualizar los parámetros de consulta `?v=` de los archivos estáticos en `index.html` y `admin.html` para forzar la recarga en los navegadores de los clientes.
4.  Desplegar el hosting en Firebase:
    ```powershell
    firebase deploy
    ```
5.  Añadir los archivos, hacer commit con la versión en el título y subir a GitHub (`git push`).
6.  *Nota*: La sincronización del número de versión con la base de datos se realiza automáticamente en Firestore la primera vez que un administrador accede a la pestaña de **Gestión** desde el sitio web desplegado.

---

## 🗄️ Modelo de Datos (Firestore)

El proyecto se estructura con tres colecciones de nivel superior:

### 1. `proveedores` (Colección)
*   **Documento**: Nombre del proveedor (ej. `Mercadona`).
*   **Campos**:
    *   `actual` (Timestamp): Última actualización de datos.
    *   `responsables` (Array): Nombres de usuarios con acceso a realizar pedidos (ej. `["Todos"]` o `["Roberto", "Flor"]`).
*   **Subcolección `productos`**:
    *   **Documento**: Clave generada (`PROVEEDOR_nombre_producto`).
    *   **Campos**:
        *   `nombre` (String): Nombre descriptivo.
        *   `unidad` (String): Unidad de medida (Ud, kg, Caja...).
        *   `categoria` (String): Clasificación del artículo.
        *   `responsable` (String): Personal específico a cargo o "Todos".
        *   `proveedor` (String): Nombre del proveedor.
        *   `precio` (String): Precio unitario (€).
        *   `precioAnterior` (String): Registro del precio previo antes del cambio.
        *   `historialPrecios` (Array): Últimos 5 cambios registrados `{fecha: string, precio: string}`.
        *   `peso` (String): Peso neto de la unidad (opcional).
        *   `iva` (Number): Tipo de IVA aplicable (0, 4, 10, 21).

### 2. `pedidos` (Colección)
*   **Documento**: Clave autogenerada (ej. `DEL_123456_Mercadona` para cancelados, o ID Firebase).
*   **Campos**:
    *   `id_unico` (String): Identificador del registro.
    *   `usuario` (String): Nombre del usuario que ejecutó la acción.
    *   `email` (String): Correo electrónico del responsable.
    *   `proveedor` (String): Proveedor a quien va el pedido.
    *   `fecha` (Timestamp): Fecha del envío o cancelación.
    *   `fecha_corta` (String): Fecha corta formateada (`AAAA-MM-DD`).
    *   `estado` (String): Estado del pedido (`enviado` / `borrado`).
    *   `items` (Map): Parejas clave-valor de `{id_producto: cantidad}`.

### 3. `borradores` (Colección)
Guarda los borradores de pedidos en progreso para evitar pérdidas de información por caídas de cobertura.
*   **Documento**: Nombre del proveedor (ej. `Mercadona`).
*   **Campos**:
    *   `items` (Map): `{id_producto: cantidad}` en borrador.
    *   `notas` (Map): `{id_producto: texto_nota}` de anotaciones específicas.
    *   `lastUpdate` (Timestamp): Momento del último guardado de borrador.
    *   `user` (String): Nombre del último usuario que modificó la lista.
