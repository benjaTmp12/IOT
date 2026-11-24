'use strict';

// =========================================================================
// CAPA DE LÓGICA DE DOMINIO (FSM Y REGLAS DE SEGURIDAD DE LA BODEGA)
// Consume eventos normalizados desde Blackbox.Bus, aplica reglas de negocio,
// actualiza el estado único de dominio y persiste en Blackbox.Repository.
// =========================================================================
window.Blackbox.Domain = (() => {
  const { Bus, Repository } = window.Blackbox;

  const state = {
    system: 'ARMADO',
    prevSystem: 'ARMADO',
    doorOpen: false,
    lockOpen: false,
    pirMotion: false,
    online: true,
    serialActive: false,
    selectedComp: 'overview',
    xrayWalls: false,
    roofOpen: true,
    showPirCone: true,
    cajaLidOpen: false,
    lastRfid: 'Sin lectura',
    lastHolder: 'Esperando tarjeta MIFARE',
    oled1: 'BLACKBOX',
    oled2: 'ESPERANDO TARJETA',
    lastNotice:
      'Recinto protegido. Acerca una credencial RFID MIFARE autorizada (Botón 1) para desarmar la bodega y liberar el pestillo SG90, o haz clic en cualquier pieza de la maqueta 3D para inspeccionar su cableado y código.'
  };

  let lockTimer = null;
  let pirTimer = null;
  let audioCtx = null;

  function beep(freq = 880, duration = 120, type = 'square') {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = 0.045;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration / 1000);
    } catch (e) {}
  }

  function record(category, sensor, uid, detail) {
    Repository.appendEvent({
      category,
      sensor,
      uid,
      resultState: state.system,
      doorOpen: state.doorOpen,
      detail
    });
  }

  function emitState(notice) {
    if (notice) state.lastNotice = notice;
    Bus.publish('state:changed', { state: { ...state } });
  }

  function onValidCard({ holder = 'Benjamin Tampier', uid = '04:A3:9B:12' } = {}) {
    clearTimeout(lockTimer);
    const wasIntrusion = state.system === 'INTRUSIÓN';
    state.system = 'DESARMADO';
    state.lockOpen = true;
    state.lastRfid = uid;
    state.lastHolder = `${holder} (Autorizado)`;
    state.oled1 = 'ACCESO OK';
    state.oled2 = `HOLA ${holder.split(' ')[0].toUpperCase()}`;

    beep(1046, 110, 'sine');
    setTimeout(() => beep(1318, 140, 'sine'), 120);

    Bus.publish('fx:rfid_card', { granted: true, color: '#22c993', ringHex: '#22e59b' });
    record(
      'ACCESO_OK',
      'RFID RC522',
      uid,
      wasIntrusion
        ? `Alarma reconocida y desactivada con credencial válida (${holder})`
        : `Tarjeta autorizada (${holder}) · Pestillo SG90 desbloqueado a 90°`
    );
    emitState('Acceso autorizado: El servo SG90 gira a 90° liberando el pestillo, se enciende el LED Verde (D5) y el recinto queda DESARMADO.');

    lockTimer = setTimeout(() => {
      // Regla de seguridad: nunca bajar el pestillo si la puerta sigue abierta
      if (!state.doorOpen && state.system === 'DESARMADO') {
        state.lockOpen = false;
        state.oled1 = 'DESARMADO';
        state.oled2 = 'PESTILLO CERRADO';
        emitState('Tiempo de apertura cumplido (8 s): El pestillo SG90 vuelve a 0°, manteniendo la bodega desarmada.');
      }
    }, 8000);
  }

  function onInvalidCard({ uid = 'FF:81:20:09' } = {}) {
    state.lastRfid = uid;
    state.lastHolder = 'Credencial NO registrada';
    state.oled1 = 'DENEGADO';
    state.oled2 = 'TARJETA NO REG';
    beep(300, 220, 'sawtooth');

    Bus.publish('fx:rfid_card', { granted: false, color: '#f24c58', ringHex: '#ff384c' });
    record(
      'ACCESO_DENEGADO',
      'RFID RC522',
      uid,
      'Tarjeta desconocida rechazada · Puerta permanece bloqueada (no activa intrusión por sí sola)'
    );
    emitState('Tarjeta desconocida rechazada: Da aviso sonoro corto y mantiene el pestillo bloqueado sin disparar falsa alarma de intrusión.');
  }

  function onDoorToggle({ forceOpen } = {}) {
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.doorOpen;
    if (nextOpen === state.doorOpen) return;
    state.doorOpen = nextOpen;

    if (state.doorOpen) {
      if (state.system === 'ARMADO') {
        state.system = 'INTRUSIÓN';
        state.oled1 = '!INTRUSION!';
        state.oled2 = 'PUERTA FORZADA';
        beep(440, 260, 'square');
        setTimeout(() => beep(330, 260, 'square'), 280);
        record('INTRUSIÓN', 'Sensor Puerta (D2)', '—', 'Apertura detectada sin autorización con el recinto ARMADO');
        emitState('¡INTRUSIÓN DETECTADA! El sensor de puerta (Pin D2) se abrió mientras el recinto estaba ARMADO.');
      } else {
        state.oled1 = 'PUERTA ABIERTA';
        state.oled2 = 'ACCESO PERMITIDO';
        record('SISTEMA', 'Sensor Puerta (D2)', state.lastRfid, 'Puerta abierta durante sesión autorizada');
        emitState('Puerta abierta con permiso válido. No se activa alarma.');
      }
    } else {
      if (state.system !== 'INTRUSIÓN') {
        state.lockOpen = false;
        state.oled1 = state.system === 'ARMADO' ? 'ARMADO' : 'PUERTA CERRADA';
        state.oled2 = state.system === 'ARMADO' ? 'ESPERANDO TARJETA' : 'LISTO PARA ARMAR';
      }
      record('SISTEMA', 'Sensor Puerta (D2)', '—', 'Puerta cerrada físicamente (Pin D2 en LOW)');
      emitState(
        state.system === 'INTRUSIÓN'
          ? 'Puerta cerrada, pero la alarma permanece enclavada hasta presentar una tarjeta RFID autorizada.'
          : 'Puerta cerrada correctamente.'
      );
    }
  }

  function onInteriorSensor() {
    clearTimeout(pirTimer);
    state.pirMotion = true;
    if (state.system === 'ARMADO') {
      state.system = 'INTRUSIÓN';
      state.oled1 = '!INTRUSION!';
      state.oled2 = 'SENSOR ACTIVO';
      beep(520, 250, 'square');
      setTimeout(() => beep(390, 280, 'square'), 260);
      record('INTRUSIÓN', 'Sensor Interior (D4)', '—', 'Activación detectada en el interior con el sistema ARMADO');
      emitState('¡ALERTA INTERIOR! El sensor en Pin D4 detectó actividad dentro del recinto mientras estaba ARMADO.');
    } else if (state.system === 'DESARMADO') {
      state.oled1 = 'INTERIOR OK';
      state.oled2 = 'OPERADOR ACTIVO';
      record('SISTEMA', 'Sensor Interior (D4)', '—', 'Actividad interior registrada durante sesión autorizada');
      emitState('El sensor interior detecta presencia, pero como la bodega está DESARMADA no genera alarma.');
    } else {
      emitState();
    }

    pirTimer = setTimeout(() => {
      state.pirMotion = false;
      emitState();
    }, 3200);
  }

  function onCommToggle() {
    state.online = !state.online;
    if (!state.online) {
      state.prevSystem = state.system;
      state.system = 'FALLA_COMUNICACIÓN';
      state.oled1 = 'MODO LOCAL';
      state.oled2 = 'SIN ENLACE REMOTO';
      beep(240, 300, 'triangle');
      record('FALLA_RED', 'Watchdog Enlace', '—', 'Pérdida de conexión con el controlador · Activado modo autónomo local');
      emitState('ALERTA DE ENLACE: Se interrumpió la comunicación con la placa. El controlador continúa protegiendo la bodega de forma autónoma.');
    } else {
      state.system = state.prevSystem || 'ARMADO';
      state.oled1 = 'ENLACE ACTIVO';
      state.oled2 = `ESTADO: ${state.system}`;
      beep(980, 120, 'sine');
      record('SISTEMA', 'Watchdog Enlace', '—', 'Comunicación restablecida con el controlador · Telemetría sincronizada');
      emitState('Enlace restablecido con el controlador. Eventos y estados sincronizados.');
    }
  }

  function onArm({ silentIfArmed = false } = {}) {
    if (silentIfArmed && state.system === 'ARMADO') return;
    if (state.system === 'INTRUSIÓN') {
      beep(260, 180, 'sawtooth');
      emitState('Para rearmar, primero reconoce y desactiva la alarma presentando una tarjeta RFID autorizada (Botón 1).');
      return;
    }
    if (state.doorOpen) {
      beep(260, 180, 'sawtooth');
      record('SISTEMA', 'Sensor Puerta (D2)', '—', 'Rearmado rechazado por puerta abierta');
      emitState('No se puede armar la bodega con la puerta abierta. Cierra primero la puerta (Botón 3).');
      return;
    }
    state.system = 'ARMADO';
    state.lockOpen = false;
    state.oled1 = 'ARMADO';
    state.oled2 = 'RECINTO PROTEGIDO';
    beep(784, 120, 'sine');
    record('SISTEMA', 'Controlador', state.lastRfid, 'Sistema rearmado · Cerradura SG90 bloqueada a 0°');
    emitState('Recinto ARMADO. El servo bloquea el pestillo a 0° y los sensores en D2 y D4 quedan en vigilancia activa.');
  }

  function onReset() {
    clearTimeout(lockTimer);
    clearTimeout(pirTimer);
    state.system = 'ARMADO';
    state.doorOpen = false;
    state.lockOpen = false;
    state.pirMotion = false;
    state.online = true;
    state.lastRfid = 'Sin lectura';
    state.lastHolder = 'Esperando tarjeta MIFARE';
    state.oled1 = 'BLACKBOX';
    state.oled2 = 'ESPERANDO TARJETA';
    Bus.publish('view:select_component', { compId: 'overview' });
    record('SISTEMA', 'Consola', '—', 'Reinicio de estado a condiciones iniciales');
    emitState('Sistema reiniciado a condiciones iniciales (ARMADO, puerta cerrada y vista panorámica 3D).');
  }

  // Suscripción a eventos del Bus (EDA)
  Bus.subscribe('input:rfid_valid', onValidCard);
  Bus.subscribe('input:rfid_invalid', onInvalidCard);
  Bus.subscribe('input:door_toggle', onDoorToggle);
  Bus.subscribe('input:interior_sensor', onInteriorSensor);
  Bus.subscribe('input:comm_toggle', onCommToggle);
  Bus.subscribe('input:arm', onArm);
  Bus.subscribe('input:reset', onReset);

  Bus.subscribe('serial:connected', () => {
    state.online = true;
    state.serialActive = true;
    record('SISTEMA', 'USB Serial', '—', 'Enlace serie establecido con el microcontrolador a 115200 bps');
    emitState('Placa vinculada por USB Serial a 115200 bps. Recibiendo eventos físicos en vivo.');
  });

  Bus.subscribe('view:select_component', ({ compId }) => {
    state.selectedComp = compId || 'overview';
    if (compId === 'esp32') {
      state.cajaLidOpen = true;
    }
    if (compId === 'pir' || compId === 'buzzer') {
      state.roofOpen = true;
    }
  });

  Bus.subscribe('view:lid_toggle', ({ force } = {}) => {
    state.cajaLidOpen = typeof force === 'boolean' ? force : !state.cajaLidOpen;
    Bus.publish('state:changed', { state: { ...state } });
  });

  Bus.subscribe('view:walls_toggle', () => {
    state.xrayWalls = !state.xrayWalls;
    Bus.publish('state:changed', { state: { ...state } });
  });

  Bus.subscribe('view:roof_toggle', () => {
    state.roofOpen = !state.roofOpen;
    Bus.publish('state:changed', { state: { ...state } });
  });

  Bus.subscribe('view:cone_toggle', () => {
    state.showPirCone = !state.showPirCone;
    Bus.publish('state:changed', { state: { ...state } });
  });

  return {
    getState: () => state,
    emitState
  };
})();
