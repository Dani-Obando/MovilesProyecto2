// server.js corregido completo

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const conectarDB = require("./db");
const Jugada = require("./models/Jugada");
const Adivinanza = require("./models/Adivinanza");
const jugadasRoute = require("./routes/jugadas");
const adivinanzasRoute = require("./routes/adivinanzas");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use("/jugadas", jugadasRoute);
app.use("/adivinanzas", adivinanzasRoute);

conectarDB();

let jugadores = [];
let turnoActual = 0;
let pesoIzquierdo = 0;
let pesoDerecho = 0;
let totalJugadas = 0;
let bloquesTotales = 0;
let bloquesPorJugador = {};
let turnoTimeout = null;
let juegoIniciado = false; // << NUEVO CONTROL

const sesionesIndividuales = {};
const COLORES = ["red", "blue", "green", "orange", "purple"];

wss.on("connection", (ws) => {
    ws.id = Math.random().toString(36).substring(2);
    ws.eliminado = false;

    ws.on("message", async (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === "ENTRADA") {
                ws.nombre = msg.jugador;
                ws.modo = msg.modo || "multijugador";

                if (ws.modo === "individual") {
                    if (!sesionesIndividuales[ws.nombre]) {
                        const bloques = [];
                        COLORES.forEach((color) => {
                            for (let i = 0; i < 2; i++) {
                                bloques.push({ color, peso: Math.floor(Math.random() * 19) + 2 });
                            }
                        });
                        sesionesIndividuales[ws.nombre] = {
                            pesoIzquierdo: 0,
                            pesoDerecho: 0,
                            bloques,
                            jugadas: [],
                            terminado: false,
                        };
                    }
                    ws.send(JSON.stringify({
                        type: "TURNO",
                        tuTurno: true,
                        jugadorEnTurno: ws.nombre,
                    }));
                } else {
                    const yaExiste = jugadores.find((j) => j.nombre === msg.jugador);
                    if (yaExiste) {
                        ws.send(JSON.stringify({ type: "ERROR", mensaje: "Nombre ya en uso." }));
                        ws.close();
                        return;
                    }

                    if (!bloquesPorJugador[msg.jugador]) {
                        const bloques = [];
                        COLORES.forEach((color) => {
                            for (let i = 0; i < 2; i++) {
                                bloques.push({ color, peso: Math.floor(Math.random() * 19) + 2 });
                                bloquesTotales++;
                            }
                        });
                        bloquesPorJugador[msg.jugador] = bloques;
                    }

                    jugadores.push(ws);
                    broadcast({ type: "MENSAJE", contenido: `${msg.jugador} se unió.` });
                    broadcast({ type: "ENTRADA", totalJugadores: jugadores.length });

                    if (jugadores.length >= 2 && !juegoIniciado) {
                        juegoIniciado = true;
                        turnoActual = 0;
                        enviarTurno();
                    }
                }
            }

            if (msg.type === "JUGADA") {
                if (ws.modo === "individual") {
                    // (individual no cambia)
                } else {
                    clearTimeout(turnoTimeout);
                    const jugadorActual = jugadores[turnoActual];
                    if (!jugadorActual) return;

                    const jugada = new Jugada({
                        jugador: msg.jugador,
                        turno: totalJugadas + 1,
                        peso: msg.peso,
                        equipo: 0,
                        eliminado: false,
                        color: msg.color,
                    });
                    await jugada.save();

                    if (msg.lado === "izquierdo") pesoIzquierdo += msg.peso;
                    else pesoDerecho += msg.peso;

                    broadcast({
                        type: "ACTUALIZAR_BALANZA",
                        izquierdo: pesoIzquierdo,
                        derecho: pesoDerecho,
                        jugador: msg.jugador,
                    });

                    broadcast({
                        type: "MENSAJE",
                        contenido: `${msg.jugador} colocó ${msg.peso}g en ${msg.lado}`,
                    });

                    totalJugadas++;

                    if (totalJugadas >= bloquesTotales) enviarResumenFinal();
                    else avanzarTurno();
                }
            }
        } catch (err) {
            console.error("❌ Error:", err.message);
        }
    });

    ws.on("close", () => {
        jugadores = jugadores.filter((j) => j !== ws);
        if (turnoActual >= jugadores.length) turnoActual = 0;
        if (jugadores.length < 2) juegoIniciado = false;
        enviarTurno();
    });
});

function avanzarTurno() {
    if (jugadores.length === 0) return;
    let intentos = 0;
    do {
        turnoActual = (turnoActual + 1) % jugadores.length;
        intentos++;
    } while (jugadores[turnoActual]?.eliminado && intentos < jugadores.length);
    enviarTurno();
}

function enviarTurno() {
    clearTimeout(turnoTimeout);

    if (!juegoIniciado || jugadores.length < 2) {
        broadcast({ type: "ENTRADA", totalJugadores: jugadores.length });
        return;
    }

    const jugadorActual = jugadores[turnoActual];
    if (!jugadorActual) return;

    const nombreActual = jugadorActual.nombre;

    jugadores.forEach((j, i) => {
        if (j.readyState === WebSocket.OPEN) {
            j.send(JSON.stringify({
                type: "TURNO",
                tuTurno: i === turnoActual && !j.eliminado,
                jugadorEnTurno: nombreActual,
            }));
        }
    });

    turnoTimeout = setTimeout(() => {
        const jugadorTimeout = jugadores[turnoActual];
        if (!jugadorTimeout) return;

        if (!jugadorTimeout.eliminado) {
            jugadorTimeout.eliminado = true;
            jugadorTimeout.send(JSON.stringify({
                type: "ELIMINADO",
                mensaje: "Has sido eliminado por inactividad (5 min).",
            }));
            broadcast({ type: "MENSAJE", contenido: `${jugadorTimeout.nombre} eliminado por inactividad.` });
        }

        avanzarTurno();
    }, 300000); // << 5 minutos
}

function broadcast(data) {
    const mensaje = typeof data === "string" ? data : JSON.stringify(data);
    jugadores.forEach((j) => {
        if (j.readyState === WebSocket.OPEN) {
            j.send(mensaje);
        }
    });
}

async function enviarResumenFinal() {
    const jugadas = await Jugada.find().sort({ turno: 1 });

    const resumen = jugadas.map(j => ({
        jugador: j.jugador,
        turno: j.turno,
        peso: j.peso,
        color: j.color,
    }));

    const sobrevivientes = jugadores.filter(j => !j.eliminado).map(j => j.nombre);

    const ladoGanador = pesoIzquierdo === pesoDerecho ? "Empate" : (pesoIzquierdo < pesoDerecho ? "Izquierdo" : "Derecho");

    broadcast({
        type: "RESUMEN",
        contenido: resumen,
        totales: { izquierdo: pesoIzquierdo, derecho: pesoDerecho },
        sobrevivientes,
        ganador: ladoGanador,
        bloquesPorJugador,
    });
}

const PORT = 5000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});
