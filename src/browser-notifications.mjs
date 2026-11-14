export async function enableBrowserNotifications() {
    if (!('Notification' in window) || !window.isSecureContext) throw new Error('This browser does not support notifications here. Use HTTPS in a supported browser.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in this site’s browser settings.');
}
export async function showBrowserNotification(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration) {
        await registration.showNotification(title, { body, tag, icon: '/icon.svg', data: { url: '/' } });
    } else {
        const notification = new Notification(title, { body, tag });
        notification.onclick = () => { window.focus(); notification.close(); };
    }
    return true;
}
