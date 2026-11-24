'use strict';

// =========================================================================
// CAPA DE ACCESO A DATOS Y PERSISTENCIA (REPOSITORIO LOCALSTORAGE + EXPORT)
// Responsable únicamente de leer, guardar, filtrar y exportar registros.
// =========================================================================
window.Blackbox.Repository = (() => {
  const DB_KEY = 'blackbox_codesur_db_v1';
  const TESTS_KEY = 'blackbox_codesur_tests_v1';

  const defaultTests = [
    {
      id: 'sensor',
      name: 'Lectura de sensor',
      expected: 'Obtener un valor válido de credencial RFID (UID), sensor de puerta (D2) y sensor interior (D4).',
      obtained: 'Verificado: RC522 identifica UID autorizado (04:A3:9B:12) vs no registrado; sensor de puerta en D2 y sensor interior en D4 reportan cambios de estado en vivo.',
      status: 'Aprobada'
    },
    {
      id: 'comm',
      name: 'Comunicación',
      expected: 'Enviar y recibir tramas JSON entre el controlador y la plataforma web, detectando caídas de enlace.',
      obtained: 'Trama JSON a 115200 bps operativa + detección de desconexión con paso automático a modo de contingencia local autónomo.',
      status: 'Aprobada'
    },
    {
      id: 'db',
      name: 'Base de datos',
      expected: 'Guardar un registro consultable por cada evento de acceso, rechazo, intrusión o falla.',
      obtained: 'Tabla de eventos operativa con persistencia en repositorio local, buscador instantáneo y exportación directa a CSV/JSON.',
      status: 'Aprobada'
    },
    {
      id: 'vis',
      name: 'Visualización',
      expected: 'Mostrar datos en pantalla/dashboard y sincronizar con el Gemelo Digital 3D.',
      obtained: 'Centro de Control con réplica OLED/LEDs y maqueta 3D Three.js suscrita al Bus de Eventos en tiempo real.',
      status: 'Aprobada'
    },
    {
      id: 'struct',
      name: 'Estructura física',
      expected: 'Mantener componentes instalados en maqueta y soportes impresos en 3D.',
      obtained: 'Geometrías STL verificadas e integradas (Soporte SG90, caja compacta WROOM-32 y accesorios a escala).',
      status: 'Aprobada'
    }
  ];

  let events = [];
  let tests = [];

  function seedInitialEvents() {
    const now = Date.now();
    events = [
      {
        id: 1,
        timestamp: new Date(now - 360000).toISOString(),
        category: 'SISTEMA',
        sensor: 'Controlador',
        uid: '—',
        resultState: 'ARMADO',
        door: 'Cerrada',
        detail: 'Inicialización de BLACKBOX (SurCode) · Vigilancia perimetral e interior activa'
      },
      {
        id: 2,
        timestamp: new Date(now - 240000).toISOString(),
        category: 'ACCESO_OK',
        sensor: 'RFID RC522',
        uid: '04:A3:9B:12',
        resultState: 'DESARMADO',
        door: 'Cerrada',
        detail: 'Acceso autorizado a Benjamin Tampier · Pestillo SG90 liberado a 90°'
      },
      {
        id: 3,
        timestamp: new Date(now - 120000).toISOString(),
        category: 'SISTEMA',
        sensor: 'RFID RC522',
        uid: '04:A3:9B:12',
        resultState: 'ARMADO',
        door: 'Cerrada',
        detail: 'Rearmado de salida completado · Puerta verificada cerrada en Pin D2'
      }
    ];
    saveEvents();
  }

  function load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) events = JSON.parse(raw);
      else seedInitialEvents();
    } catch (e) {
      seedInitialEvents();
    }
    try {
      const rawT = localStorage.getItem(TESTS_KEY);
      tests = rawT ? JSON.parse(rawT) : structuredClone(defaultTests);
    } catch (e) {
      tests = structuredClone(defaultTests);
    }
  }

  function saveEvents() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(events)); } catch (e) {}
  }

  function saveTests() {
    try { localStorage.setItem(TESTS_KEY, JSON.stringify(tests)); } catch (e) {}
  }

  function appendEvent({ category, sensor, uid, resultState, doorOpen, detail }) {
    const nextId = events.length ? Math.max(...events.map(e => e.id)) + 1 : 1;
    events.unshift({
      id: nextId,
      timestamp: new Date().toISOString(),
      category,
      sensor,
      uid: uid || '—',
      resultState,
      door: doorOpen ? 'Abierta' : 'Cerrada',
      detail
    });
    saveEvents();
    window.Blackbox.Bus.publish('data:events_updated', { events });
  }

  function clearEvents() {
    events = [];
    saveEvents();
    window.Blackbox.Bus.publish('data:events_updated', { events });
  }

  function getEvents() {
    return events;
  }

  function getTests() {
    return tests;
  }

  function updateTest(idx, patch) {
    if (!tests[idx]) return;
    Object.assign(tests[idx], patch);
    saveTests();
  }

  function downloadBlob(content, filename, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportEventsCsv() {
    const headers = ['id', 'timestamp', 'categoria', 'sensor', 'uid', 'estado', 'puerta', 'detalle'];
    const rows = events.map(ev => [
      ev.id, ev.timestamp, ev.category, ev.sensor, ev.uid, ev.resultState, ev.door, ev.detail
    ]);
    const csv = '\ufeff' + [headers, ...rows].map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(';')).join('\r\n');
    downloadBlob(csv, 'blackbox_bd_eventos.csv', 'text/csv;charset=utf-8');
  }

  function exportEventsJson() {
    downloadBlob(JSON.stringify(events, null, 2), 'blackbox_bd_eventos.json', 'application/json');
  }

  function exportTestsCsv() {
    const headers = ['Prueba', 'Resultado esperado', 'Resultado obtenido', 'Estado'];
    const rows = tests.map(t => [t.name, t.expected, t.obtained, t.status]);
    const csv = '\ufeff' + [headers, ...rows].map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(';')).join('\r\n');
    downloadBlob(csv, 'matriz_pruebas_calidad_blackbox.csv', 'text/csv;charset=utf-8');
  }

  load();

  return {
    getEvents,
    getTests,
    appendEvent,
    clearEvents,
    updateTest,
    exportEventsCsv,
    exportEventsJson,
    exportTestsCsv
  };
})();
