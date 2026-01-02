import { firebaseConfig } from './config.js';

// Inicializar Firebase (usando los scripts globales del HTML)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

document.getElementById('btn-entrar').addEventListener('click', entrar);

function entrar() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('pass').value;
    const err = document.getElementById('errorMsg');
    
    auth.signInWithEmailAndPassword(email, pass)
      .then(() => window.location.href = "index.html")
      .catch(e => {
        err.style.display = 'block';
        err.innerText = "Error: " + e.message;
      });
}