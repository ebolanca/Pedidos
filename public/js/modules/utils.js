
// js/modules/utils.js

export function haptic() {
    if (navigator.vibrate) navigator.vibrate(15);
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
