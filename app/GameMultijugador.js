// GameMultijugador.js
import React, { useEffect, useState, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    Animated,
    PanResponder,
    Button,
    Alert,
} from 'react-native';
import { getSocket } from '../sockets/connection';
import BalanzaAnimada from '../components/BalanzaAnimada';

const COLORES = ['red', 'blue', 'green', 'orange', 'purple'];

export default function GameMultijugador() {
    const { nombre } = useLocalSearchParams();
    const router = useRouter();
    const [bloques, setBloques] = useState([]);
    const [pesoIzq1, setPesoIzq1] = useState(0);
    const [pesoDer1, setPesoDer1] = useState(0);
    const [pesoIzq2, setPesoIzq2] = useState(0);
    const [pesoDer2, setPesoDer2] = useState(0);
    const [bloquesIzq1, setBloquesIzq1] = useState([]);
    const [bloquesDer1, setBloquesDer1] = useState([]);
    const [bloquesIzq2, setBloquesIzq2] = useState([]);
    const [bloquesDer2, setBloquesDer2] = useState([]);
    const [miTurno, setMiTurno] = useState(false);
    const [jugadorEnTurno, setJugadorEnTurno] = useState('');
    const [dropAreas1, setDropAreas1] = useState({ izquierdo: null, derecho: null });
    const [dropAreas2, setDropAreas2] = useState({ izquierdo: null, derecho: null });
    const [contador, setContador] = useState(300);
    const [jugadoresConectados, setJugadoresConectados] = useState(0);
    const intervaloRef = useRef(null);

    useEffect(() => {
        const nuevos = [];
        COLORES.forEach(color => {
            nuevos.push({
                id: `${color}-1-${Math.random().toString(36).substring(2, 7)}`,
                color,
                peso: Math.floor(Math.random() * 19) + 2,
                pan: new Animated.ValueXY(),
                numero: 1, // 🔥 Aquí número fijo
            });
            nuevos.push({
                id: `${color}-2-${Math.random().toString(36).substring(2, 7)}`,
                color,
                peso: Math.floor(Math.random() * 19) + 2,
                pan: new Animated.ValueXY(),
                numero: 2, // 🔥 Aquí número fijo
            });
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
                        setContador(prev => {
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

    const enviarJugada = (bloque, lado, balanza) => {
        if (!miTurno || balanza !== 1) return;
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
            setPesoIzq1(p => p + bloque.peso);
            setBloquesIzq1(prev => [...prev, bloque]);
        } else {
            setPesoDer1(p => p + bloque.peso);
            setBloquesDer1(prev => [...prev, bloque]);
        }

        setBloques(prev => prev.filter(b => b.id !== bloque.id));
        setMiTurno(false);
        clearInterval(intervaloRef.current);
    };

    const colocarPrueba = (bloque, lado) => {
        if (lado === 'izquierdo') {
            setPesoIzq2(p => p + bloque.peso);
            setBloquesIzq2(prev => [...prev, bloque]);
        } else {
            setPesoDer2(p => p + bloque.peso);
            setBloquesDer2(prev => [...prev, bloque]);
        }
        setBloques(prev => prev.filter(b => b.id !== bloque.id));
    };

    const quitarUltimoBloque = (lado) => {
        let bloque;
        if (lado === 'izquierdo' && bloquesIzq2.length) {
            bloque = bloquesIzq2[bloquesIzq2.length - 1];
            setBloquesIzq2(prev => prev.slice(0, -1));
            setPesoIzq2(p => p - bloque.peso);
        } else if (lado === 'derecho' && bloquesDer2.length) {
            bloque = bloquesDer2[bloquesDer2.length - 1];
            setBloquesDer2(prev => prev.slice(0, -1));
            setPesoDer2(p => p - bloque.peso);
        } else {
            Alert.alert("Nada que quitar en ese lado");
            return;
        }
        setBloques(prev => [...prev, bloque]);
    };

    const isInDropArea = (gesture, area) => {
        if (!area) return false;
        const { moveX, moveY } = gesture;
        return moveX > area.x && moveX < area.x + area.width && moveY > area.y && moveY < area.y + area.height;
    };

    const renderBloque = (bloque) => {
        const panResponder = PanResponder.create({
            onStartShouldSetPanResponder: () => miTurno,
            onPanResponderGrant: () => bloque.pan.extractOffset(),
            onPanResponderMove: Animated.event([null, { dx: bloque.pan.x, dy: bloque.pan.y }], { useNativeDriver: false }),
            onPanResponderRelease: (_, gesture) => {
                bloque.pan.flattenOffset();
                if (isInDropArea(gesture, dropAreas2.izquierdo)) colocarPrueba(bloque, 'izquierdo');
                else if (isInDropArea(gesture, dropAreas2.derecho)) colocarPrueba(bloque, 'derecho');
                else if (isInDropArea(gesture, dropAreas1.izquierdo)) enviarJugada(bloque, 'izquierdo', 1);
                else if (isInDropArea(gesture, dropAreas1.derecho)) enviarJugada(bloque, 'derecho', 1);
                else Animated.spring(bloque.pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
            },
        });

        return (
            <Animated.View
                key={bloque.id}
                {...panResponder.panHandlers}
                style={[styles.bloque, { backgroundColor: bloque.color }, { transform: bloque.pan.getTranslateTransform() }]}
            />
        );
    };

    if (jugadoresConectados < 2) {
        return (
            <View style={styles.centered}>
                <Text style={styles.esperando} selectable={false}>
                    Esperando jugadores... ({jugadoresConectados}/2)
                </Text>
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.titulo} selectable={false}>Jugador: {nombre}</Text>
            <Text style={styles.subtitulo} selectable={false}>Turno de: {jugadorEnTurno}</Text>
            {miTurno && (
                <Text style={styles.contador} selectable={false}>
                    ⏱️ {Math.floor(contador / 60)}:{String(contador % 60).padStart(2, '0')}
                </Text>
            )}

            <Text style={styles.section} selectable={false}>Balanza 1 (finaliza turno):</Text>
            <BalanzaAnimada pesoIzq={pesoIzq1} pesoDer={pesoDer1} bloquesIzq={bloquesIzq1} bloquesDer={bloquesDer1} setDropAreas={setDropAreas1} allowRemove={false} />

            <Text style={styles.section} selectable={false}>Balanza 2 (prueba libre):</Text>
            <BalanzaAnimada pesoIzq={pesoIzq2} pesoDer={pesoDer2} bloquesIzq={bloquesIzq2} bloquesDer={bloquesDer2} setDropAreas={setDropAreas2} allowRemove={true} />

            <View style={styles.ra}>
                <View style={{ flex: 1, marginRight: 10 }}>
                    <Button title="Quitar izquierdo" onPress={() => quitarUltimoBloque('izquierdo')} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Button title="Quitar derecho" onPress={() => quitarUltimoBloque('derecho')} />
                </View>
            </View>

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
    contador: { fontSize: 16, color: 'red', marginBottom: 10 },
    esperando: { fontSize: 18, color: '#666' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    section: { fontSize: 16, fontWeight: 'bold', marginTop: 20 },
    bloquesContainer: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 20 },
    bloque: { width: 60, height: 60, borderRadius: 8, margin: 8 },
    botonera: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
});
