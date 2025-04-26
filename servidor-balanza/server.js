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

const COLORES = ["red", "blue", "green", "orange", "purple"];

let jugadores = [];
let turnoActual = 0;
let pesoIzquierdo = 0;
let pesoDerecho = 0;
let bloquesPorJugador = {}; // { nombre: [bloques] }
let bloquesColocadosPorJugador = {}; // { nombre: cantidad }
let sesionesIndividuales = {}; // { nombre: { ... } }
let turnoTimeout = null;

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
                        COLORES.forEach(color => {
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
                    const yaExiste = jugadores.find(j => j.nombre === msg.jugador);
                    if (yaExiste) {
                        ws.send(JSON.stringify({ type: "ERROR", mensaje: "Nombre ya en uso." }));
                        ws.close();
                        return;
                    }

                    const bloques = [];
                    COLORES.forEach(color => {
                        for (let i = 0; i < 2; i++) {
                            bloques.push({ color, peso: Math.floor(Math.random() * 19) + 2 });
                        }
                    });
                    bloquesPorJugador[msg.jugador] = bloques;
                    bloquesColocadosPorJugador[msg.jugador] = 0;

                    jugadores.push(ws);

                    broadcast({
                        type: "MENSAJE",
                        contenido: `${msg.jugador} se ha unido al juego.`,
                    });

                    broadcast({
                        type: "ENTRADA",
                        totalJugadores: jugadores.length,
                    });

                    if (jugadores.length >= 2) { // Aquí puedes cambiar a >= 10 después
                        enviarTurno();
                    }
                }
            }

            if (msg.type === "JUGADA") {
                if (ws.modo === "individual") {
                    procesarJugadaIndividual(ws, msg);
                } else {
                    procesarJugadaMultijugador(ws, msg);
                }
            }
        } catch (err) {
            console.error("❌ Error:", err.message);
        }
    });

    ws.on("close", () => {
        jugadores = jugadores.filter(j => j !== ws);
        if (turnoActual >= jugadores.length) turnoActual = 0;
        enviarTurno();
    });
});

function procesarJugadaIndividual(ws, msg) {
    const sesion = sesionesIndividuales[ws.nombre];
    if (!sesion || sesion.terminado) return;

    sesion.jugadas.push(msg);
    if (msg.lado === "izquierdo") sesion.pesoIzquierdo += msg.peso;
    else sesion.pesoDerecho += msg.peso;

    ws.send(JSON.stringify({
        type: "ACTUALIZAR_BALANZA",
        izquierdo: sesion.pesoIzquierdo,
        derecho: sesion.pesoDerecho,
    }));

    if (sesion.jugadas.length >= 10) {
        sesion.terminado = true;
        ws.send(JSON.stringify({
            type: "RESUMEN",
            jugador: ws.nombre,
            totales: {
                izquierdo: sesion.pesoIzquierdo,
                derecho: sesion.pesoDerecho,
            },
            contenido: sesion.jugadas,
            sobrevivientes: [ws.nombre],
            ganador:
                sesion.pesoIzquierdo === sesion.pesoDerecho ? "Empate" :
                    sesion.pesoIzquierdo < sesion.pesoDerecho ? "Izquierdo" : "Derecho",
            bloquesPorJugador: {
                [ws.nombre]: sesion.bloques,
            },
        }));
    } else {
        ws.send(JSON.stringify({
            type: "TURNO",
            tuTurno: true,
            jugadorEnTurno: ws.nombre,
        }));
    }
}

async function procesarJugadaMultijugador(ws, msg) {
    clearTimeout(turnoTimeout);

    const jugadorActual = jugadores[turnoActual];
    if (!jugadorActual || jugadorActual.eliminado) return;

    if (!bloquesColocadosPorJugador[msg.jugador]) {
        bloquesColocadosPorJugador[msg.jugador] = 0;
    }
    bloquesColocadosPorJugador[msg.jugador]++;

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
        contenido: `${msg.jugador} colocó ${msg.peso}g en el lado ${msg.lado}`,
    });

    const todosTerminaron = jugadores.every(j => bloquesColocadosPorJugador[j.nombre] >= 10);

    if (todosTerminaron) {
        enviarResumenFinal();
    } else {
        avanzarTurno();
    }
}

function enviarTurno() {
    clearTimeout(turnoTimeout);

    if (!jugadores.length || turnoActual >= jugadores.length) return;

    const jugadorActual = jugadores[turnoActual];
    if (!jugadorActual || jugadorActual.eliminado) {
        avanzarTurno();
        return;
    }

    jugadores.forEach((j, i) => {
        if (j.readyState === WebSocket.OPEN) {
            j.send(JSON.stringify({
                type: "TURNO",
                tuTurno: i === turnoActual,
                jugadorEnTurno: jugadorActual.nombre,
            }));
        }
    });

    turnoTimeout = setTimeout(() => {
        jugadorActual.eliminado = true;
        jugadorActual.send(JSON.stringify({
            type: "ELIMINADO",
            mensaje: "Eliminado por inactividad (60s sin mover bloque).",
        }));
        broadcast({
            type: "MENSAJE",
            contenido: `${jugadorActual.nombre} fue eliminado por inactividad.`,
        });
        avanzarTurno();
    }, 60000);
}

function avanzarTurno() {
    if (!jugadores.length) return;

    let intentos = 0;
    do {
        turnoActual = (turnoActual + 1) % jugadores.length;
        intentos++;
    } while (jugadores[turnoActual]?.eliminado && intentos < jugadores.length);

    enviarTurno();
}

function broadcast(data) {
    const mensaje = typeof data === "string" ? data : JSON.stringify(data);
    jugadores.forEach(j => {
        if (j.readyState === WebSocket.OPEN) {
            j.send(mensaje);
        }
    });
}

async function enviarResumenFinal() {
    const sobrevivientes = jugadores.filter(j => !j.eliminado).map(j => j.nombre);

    broadcast({
        type: "RESUMEN",
        contenido: [],
        totales: {
            izquierdo: pesoIzquierdo,
            derecho: pesoDerecho,
        },
        sobrevivientes,
        ganador:
            pesoIzquierdo === pesoDerecho ? "Empate" :
                pesoIzquierdo < pesoDerecho ? "Izquierdo" : "Derecho",
        bloquesPorJugador,
    });
}

const PORT = 5000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});
