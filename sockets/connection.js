let socket = null;

export function getSocket() {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
        return socket;
    }

    const WS = typeof WebSocket !== "undefined" ? WebSocket : global.WebSocket;

    if (!WS) {
        console.error("WebSocket is not available in this environment.");
        return null;
    }

    socket = new WS("ws://192.168.100.101:5000"); // <-- asegúrate que la IP/puerto esté correcto
    return socket;
}

export function closeSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
    }
}
