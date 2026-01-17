
// js/modules/utils.js

export function haptic(pattern = 'light') {
    if (!navigator.vibrate) return;
    
    switch(pattern) {
        case 'light': navigator.vibrate(10); break;
        case 'medium': navigator.vibrate(20); break;
        case 'success': navigator.vibrate([10, 30, 10]); break;
        case 'error': navigator.vibrate([30, 50, 30, 50, 30]); break;
        case 'heavy': navigator.vibrate(40); break;
        default: navigator.vibrate(15);
    }
}

export function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

export function updateConnectionStatus() {
    if (navigator.onLine) document.body.classList.remove('offline');
    else document.body.classList.add('offline');
}

export function redirectToLogin() {
    setTimeout(() => {
        if (window.location.pathname.indexOf('login.html') === -1)
            window.location.href = "login.html";
    }, 50);
}
