'use strict';

// =========================================================================
// CAPA DE ADAPTADORES DE ENTRADA (WEB SERIAL API + SIMULADOR LOCAL)
// Traduce tramas JSON desde el microcontrolador físico (115200 bps) y
// acciones de operador/teclado hacia eventos normalizados en Blackbox.Bus.
// =========================================================================
window.Blackbox.Adapters = (() => {
  const { Bus } = window.Blackbox;

  function dispatchSerialFrame(payload) {
    if (!payload || !payload.event) return;
    switch (payload.event) {
      case 'acceso_autorizado':
        Bus.publish('input:rfid_valid', { holder: 'Credencial Física', uid: payload.uid || '04:A3:9B:12' });
        break;
      case 'acceso_denegado':
        Bus.publish('input:rfid_invalid', { uid: payload.uid || 'FF:81:20:09' });
        break;
      case 'intrusion_puerta':
      case 'puerta_abierta':
        Bus.publish('input:door_toggle', { forceOpen: true });
        break;
      case 'puerta_cerrada':
        Bus.publish('input:door_toggle', { forceOpen: false });
        break;
      case 'intrusion_movimiento':
      case 'movimiento_autorizado':
        Bus.publish('input:interior_sensor', {});
        break;
      default:
        break;
    }
  }

  async function connectUsbSerial() {
    if (!('serial' in navigator)) {
      alert('Para conectar la placa por USB directo usa Chrome, Edge o Brave.');
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      Bus.publish('serial:connected', {});

      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              dispatchSerialFrame(JSON.parse(trimmed));
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      Bus.publish('ui:notice', {
        message: 'Conexión USB cancelada o sin placa detectada. Operando en modo interactivo.'
      });
    }
  }

  function bindSimulatorControls() {
    document.getElementById('actValidCard').onclick = () => Bus.publish('input:rfid_valid', {});
    document.getElementById('actInvalidCard').onclick = () => Bus.publish('input:rfid_invalid', {});
    document.getElementById('actToggleDoor').onclick = () => Bus.publish('input:door_toggle', {});
    document.getElementById('actPirMotion').onclick = () => Bus.publish('input:interior_sensor', {});
    document.getElementById('actCommFail').onclick = () => Bus.publish('input:comm_toggle', {});
    document.getElementById('actArmSystem').onclick = () => Bus.publish('input:arm', {});
    document.getElementById('btnReset').onclick = () => Bus.publish('input:reset', {});
    document.getElementById('serialBtn').onclick = connectUsbSerial;

    window.addEventListener('keydown', e => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.key === '1') Bus.publish('input:rfid_valid', {});
      else if (e.key === '2') Bus.publish('input:rfid_invalid', {});
      else if (e.key === '3') Bus.publish('input:door_toggle', {});
      else if (e.key === '4') Bus.publish('input:interior_sensor', {});
      else if (e.key === '5') Bus.publish('input:comm_toggle', {});
      else if (e.key === '6') Bus.publish('input:arm', {});
      else if (e.key.toLowerCase() === 'r') Bus.publish('input:reset', {});
    });
  }

  return {
    bindSimulatorControls,
    dispatchSerialFrame
  };
})();
