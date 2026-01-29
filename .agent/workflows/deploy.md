---
description: Sube la versión, despliega a Firebase y sube a GitHub
---

This workflow automates the deployment process by incrementing the application version, syncing it with Firestore, deploying to Firebase, and pushing changes to GitHub with a descriptive summary in Spanish.

# Step 1: Increment Version

1.  **Read current version**: Check `public/js/modules/constants.js` for `CURRENT_CLIENT_VERSION` (e.g., "11.19").
2.  **Calculate new version**: Increment the decimal part (e.g., "11.19" -> "11.20").
3.  **Update `public/js/modules/constants.js`**:
    - Update `export const CURRENT_CLIENT_VERSION = "...";`.
4.  **Update `public/sw.js`**:
    - Increment the numeric part of `CACHE_NAME` (e.g., `v11.2` -> `v11.3`).
5.  **Update `public/index.html`**:
    - Update query parameters `?v=...` in CSS and JS imports.
6.  **Update `temp_sync_version.js`**:
    - Update the `VERSION` constant.

# Step 2: Synchronize Version

1.  **Run Sync Script**:
    ```powershell
    node temp_sync_version.js
    ```
    (Ensure the user has run `firebase login` if this fails).

# Step 3: Deploy to Firebase

1.  **Execute Deploy**:
    ```powershell
    firebase deploy
    ```

# Step 4: GitHub Push

1.  **Stage changes**:
    ```powershell
    git add .
    ```
2.  **Generate Spanish Summary**: Analyze the changes made (e.g., "Fix: Eliminados elementos fantasma y mejorada visibilidad de cabeceras").
3.  **Commit and Push**:
    - Use the format: `VERSION Resumen en Español` (e.g., `11.20 Fix: Eliminados elementos fantasma...`)
    - **Command**: `git commit -m "VERSION Resumen"`
    - **Push**: `git push origin main`

# Step 5: Final Report

1.  Confirm to the user that version `vXX.XX` is now live and pushed to GitHub.
