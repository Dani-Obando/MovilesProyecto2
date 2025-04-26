// GameMultijugador.js
import React, { useEffect, useState, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, ScrollView, StyleSheet, Animated, PanResponder, Alert } from 'react-native';
import { getSocket } from '../sockets/connection';
import BalanzaAnimada from '../components/BalanzaAnimada';

const COLORES = ['red', 'blue', 'green', 'orange', 'purple'];

export default function GameMultijugador() {
    const { nombre } = useLocalSearchParams();
    const router = useRouter();
    const [bloques, setBloques] = useState([]);
    const [pesoIzq, setPesoIzq] = useState(0);
    const [pesoDer, setPesoDer] = useState(0);
    const [bloquesIzq, setBloquesIzq] = useState([]);
    const [bloquesDer, setBloquesDer] = useState([]);
    const [miTurno, setMiTurno] = useState(false);
    const [jugadorEnTurno, setJugadorEnTurno] = useState('');
    const [dropAreas, setDropAreas] = useState({ izquierdo: null, derecho: null });
    const [jugadoresConectados, setJugadoresConectados] = useState(0);
    const [contador, setContador] = useState(300); // 5 minutos
    const intervaloRef = useRef(null);

    useEffect(() => {
        const nuevos = [];
        COLORES.forEach(color => {
            for (let i = 0; i < 2; i++) {
                nuevos.push({
                    id: `${color}-${i}-${Math.random().toString(36).substring(2, 7)}`,
                    color,
                    peso: Math.floor(Math.random() * 19) + 2,
                    pan: new Animated.ValueXY(),
                });
            }
        });
        setBloques(nuevos);
    }, []);

    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;

        socket.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'ENTRADA') {
                setJugadoresConectados(data.totalJugadores || 0);
            }
            if (data.type === 'TURNO') {
                setMiTurno(data.tuTurno);
                setJugadorEnTurno(data.jugadorEnTurno);

                if (data.tuTurno) {
                    clearInterval(intervaloRef.current);
                    setContador(300);
                    intervaloRef.current = setInterval(() => {
                        setContador((prev) => {
                            if (prev <= 1) {
                                clearInterval(intervaloRef.current);
                                return 0;
                            }
                            return prev - 1;
                        });
                    }, 1000);
                }
            }
            if (data.type === 'RESUMEN') {
                router.replace({
                    pathname: '/result',
                    params: {
                        resumen: encodeURIComponent(JSON.stringify(data)),
                        nombre,
                    },
                });
            }
        };

        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ENTRADA', jugador: nombre, modo: 'multijugador' }));
        } else {
            socket.onopen = () => {
                socket.send(JSON.stringify({ type: 'ENTRADA', jugador: nombre, modo: 'multijugador' }));
            };
        }

        return () => clearInterval(intervaloRef.current);
    }, []);

    const enviarJugada = (bloque, lado) => {
        if (!miTurno) return;
        const socket = getSocket();
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'JUGADA',
                jugador: nombre,
                peso: bloque.peso,
                color: bloque.color,
                lado,
            }));
        }

        if (lado === 'izquierdo') {
            setPesoIzq(p => p + bloque.peso);
            setBloquesIzq(prev => [...prev, bloque]);
        } else {
            setPesoDer(p => p + bloque.peso);
            setBloquesDer(prev => [...prev, bloque]);
        }

        setBloques(prev => prev.filter(b => b.id !== bloque.id));
        setMiTurno(false);
    };

    const isInDropArea = (gesture, area) => {
        if (!area) return false;
        const { moveX, moveY } = gesture;
        return (
            moveX > area.x &&
            moveX < area.x + area.width &&
            moveY > area.y &&
            moveY < area.y + area.height
        );
    };

    const renderBloque = (bloque) => {
        const panResponder = PanResponder.create({
            onStartShouldSetPanResponder: () => miTurno,
            onPanResponderGrant: () => bloque.pan.extractOffset(),
            onPanResponderMove: Animated.event(
                [null, { dx: bloque.pan.x, dy: bloque.pan.y }],
                { useNativeDriver: false }
            ),
            onPanResponderRelease: (_, gesture) => {
                bloque.pan.flattenOffset();
                if (isInDropArea(gesture, dropAreas.izquierdo)) enviarJugada(bloque, 'izquierdo');
                else if (isInDropArea(gesture, dropAreas.derecho)) enviarJugada(bloque, 'derecho');
                else {
                    Animated.spring(bloque.pan, {
                        toValue: { x: 0, y: 0 },
                        useNativeDriver: false,
                    }).start();
                }
            },
        });

        return (
            <Animated.View
                key={bloque.id}
                {...panResponder.panHandlers}
                style={[
                    styles.bloque,
                    { backgroundColor: bloque.color },
                    { transform: bloque.pan.getTranslateTransform() },
                ]}
            />
        );
    };

    if (jugadoresConectados < 2) {
        return (
            <View style={styles.centered}>
                <Text style={styles.esperando}>
                    Esperando jugadores... ({jugadoresConectados}/2)
                </Text>
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.titulo}>Jugador: {nombre}</Text>
            <Text style={styles.subtitulo}>Turno de: {jugadorEnTurno}</Text>
            <Text style={styles.contador}>
                ⏱️ {Math.floor(contador / 60)}:{String(contador % 60).padStart(2, '0')}
            </Text>

            <BalanzaAnimada
                pesoIzq={pesoIzq}
                pesoDer={pesoDer}
                bloquesIzq={bloquesIzq}
                bloquesDer={bloquesDer}
                setDropAreas={setDropAreas}
                allowRemove={false}
            />

            <View style={styles.bloquesContainer}>
                {bloques.map(renderBloque)}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flexGrow: 1, padding: 20, backgroundColor: '#fff' },
    titulo: { fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
    subtitulo: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
    contador: { fontSize: 16, color: 'red', marginBottom: 20 },
    esperando: { fontSize: 18, color: '#666' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    bloquesContainer: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 20 },
    bloque: { width: 60, height: 60, borderRadius: 8, margin: 8 },
});
