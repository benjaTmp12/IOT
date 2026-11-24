'use strict';

// =========================================================================
// ARQUITECTURA 1 (EDA) · BUS DE EVENTOS CENTRAL Y BASE DE CONOCIMIENTO
// Desacopla los productores (Web Serial / Simulador) de los consumidores
// (Capa de Dominio, Render 3D Three.js, UI Web y Repositorio de Datos).
// =========================================================================
window.Blackbox = window.Blackbox || {};

window.Blackbox.Bus = (() => {
  const listeners = new Map();

  function subscribe(topic, handler) {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(handler);
    return () => listeners.get(topic)?.delete(handler);
  }

  function publish(topic, payload = {}) {
    const handlers = listeners.get(topic);
    if (!handlers) return;
    for (const fn of handlers) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[Blackbox.Bus] Error en suscriptor de "${topic}":`, err);
      }
    }
  }

  return { subscribe, publish };
})();

window.Blackbox.COMPONENT_DB = {
  overview: {
    title: 'Maqueta Completa — BLACKBOX (Bodega 01)',
    category: 'GEMELO DIGITAL DE MADERA · BASE 30 × 30 CM · ALTURA 20 CM',
    badges: ['Madera 30 × 30 cm · Alto: 20 cm', 'Puerta Central (~8 cm) + 2 Ventanas', 'Techo Abatible + Zona Trasera'],
    description:
      'Maqueta construida en madera con puerta frontal central (~8 cm), ventanas centradas en ambas paredes laterales y techo con bisagra superior abatible. La zona trasera aloja el controlador y la protoboard con cableado canalizado hacia los sensores.',
    specs: [
      '<b>Fachada Frontal:</b> Puerta central de madera (~8 cm) con sensor de apertura (D2), cerradura SG90 (D3), lector RFID RC522 y pantalla OLED con 3 LEDs.',
      '<b>Laterales y Techo:</b> Ventanas centradas en ambos costados con panel traslúcido y techo de madera con bisagra hacia arriba.',
      '<b>Zona Electrónica Trasera:</b> Placa controladora y protoboard ubicadas detrás de la bodega sobre la base de 30 × 30 cm.'
    ],
    codeFile: 'Sentinel_Access_ArduinoUno.ino · Ciclo Principal',
    code: `enum Estado { ARMADO, DESARMADO, INTRUSION };
Estado estadoActual = ARMADO;

void loop() {
  verificarPuerta();        // Pin D2 (INPUT_PULLUP)
  verificarSensorInterior();// Pin D4 (KY-026 / PIR)
  verificarTarjetaRFID();   // SPI (D9..D13)
  controlarCierreServo();   // PWM Pin D3 (SG90)
  actualizarIndicadores();  // OLED (A4/A5) + LEDs (D5..D7)
}`,
    camPos: [16.5, 28.0, 35.0],
    camTarget: [0.0, 7.5, 0.5],
    testAction: () => window.Blackbox.Bus.publish('input:rfid_valid', {})
  },

  esp32: {
    title: 'Controlador Central (Arduino Uno WiFi / ESP32) + Protoboard',
    category: 'NODO EDGE (EDA) · ZONA ELECTRÓNICA TRASERA',
    badges: ['Arduino Uno WiFi / ESP32-WROOM-32', 'Serial JSON: 115200 bps', 'Carcasa 3D PLA (Atrás)'],
    description:
      'Ubicados en la parte trasera de la base 30 × 30 cm detrás del muro posterior. Ejecuta la máquina de estados del recinto, lee sensores digitales/SPI, acciona el servo y transmite cada evento JSON hacia el Adaptador Web.',
    specs: [
      '<b>Distribución limpia atrás:</b> Controlador en caja ventilada 3D y protoboard de distribución de 5V, 3.3V y GND detrás de la bodega.',
      '<b>Respaldo autónomo:</b> Si se interrumpe el enlace con el computador o el Wi-Fi, continúa protegiendo la bodega localmente.'
    ],
    codeFile: 'Sentinel_Access_ArduinoUno.ino · Configuración de Pines y JSON',
    code: `void setup() {
  Serial.begin(115200);
  pinMode(PIN_DOOR_SWITCH, INPUT_PULLUP); // D2
  pinMode(PIN_INTRUSION, INPUT);          // D4
  pinMode(PIN_LED_VERDE, OUTPUT);         // D5
  pinMode(PIN_LED_AMAR, OUTPUT);          // D6
  pinMode(PIN_LED_ROJO, OUTPUT);          // D7
  pinMode(PIN_BUZZER, OUTPUT);            // D8
  SPI.begin();
  rfid.PCD_Init();                        // SS=D10, RST=D9
}`,
    camPos: [12.0, 17.5, -28.0],
    camTarget: [0.0, 2.2, -10.8],
    testAction: () => {
      window.Blackbox.Bus.publish('view:lid_toggle', { force: true });
      window.Blackbox.Bus.publish('ui:notice', {
        message: 'Inspeccionando zona trasera: Tapa 3D abierta para observar el controlador, la protoboard y el cableado posterior.'
      });
    }
  },

  rfid: {
    title: 'Lector RFID RC522 + Credencial MIFARE (13.56 MHz)',
    category: 'PRODUCTOR DE EVENTOS · IDENTIFICACIÓN SIN CONTACTO',
    badges: ['Bus SPI: D10 (SDA), D11 (MOSI), D12 (MISO), D13 (SCK)', 'RST: Pin D9', 'Alimentación: 3.3V'],
    description:
      'Lee el identificador único hexadecimal (UID) de la tarjeta o llavero acercado junto a la puerta central. Si la credencial está autorizada, desarma el recinto y abre el pestillo por 8 segundos.',
    specs: [
      '<b>Atención en el cableado:</b> El pin VCC del módulo RC522 se alimenta estrictamente a <b>3.3V</b>.',
      '<b>Doble función:</b> Una tarjeta autorizada también permite reconocer y silenciar una alarma activa.'
    ],
    codeFile: 'Sentinel_Access_ArduinoUno.ino · Lectura SPI RC522',
    code: `if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
  String uid = obtenerUidString(&(rfid.uid));
  if (verificarUid(uid)) {
    estadoActual = DESARMADO;
    setServoAngulo(90); // Libera el pestillo
    actualizarOled("ACCESO OK", uid.c_str());
    emitirJson("acceso_autorizado", "RC522", uid.c_str());
  } else {
    digitalWrite(PIN_BUZZER, HIGH); delay(150); digitalWrite(PIN_BUZZER, LOW);
    actualizarOled("DENEGADO", "TARJETA NO REG");
    emitirJson("acceso_denegado", "RC522", uid.c_str());
  }
}`,
    camPos: [7.8, 8.6, 25.5],
    camTarget: [7.6, 6.2, 13.8],
    testAction: () => window.Blackbox.Bus.publish('input:rfid_valid', {})
  },

  oled_leds: {
    title: 'Pantalla OLED 0.96" SSD1306 + 3 LEDs de Estado',
    category: 'SALIDA VISUAL LOCAL · PANEL FRONTAL',
    badges: ['OLED I2C: SDA = A4, SCL = A5', 'LED Verde: D5', 'LED Amarillo: D6 · Rojo: D7'],
    description:
      'Entrega retroalimentación inmediata al operador junto a la puerta central. Los tres LEDs de 5 mm muestran el estado general a distancia, mientras la pantalla OLED detalla el evento activo.',
    specs: [
      '<b>LED Verde (Pin D5 + 220Ω):</b> Acceso concedido / Recinto desarmado.',
      '<b>LED Amarillo (Pin D6 + 220Ω):</b> Sistema armado en vigilancia activa.',
      '<b>LED Rojo (Pin D7 + 220Ω):</b> Estado de intrusión (parpadeo sincronizado con sirena).'
    ],
    codeFile: 'Sentinel_Access_ArduinoUno.ino · Pantalla I2C y Salidas Ópticas',
    code: `void actualizarOled(const char* linea1, const char* linea2) {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0); oled.println(F("BLACKBOX · SURCODE"));
  oled.setTextSize(2);
  oled.setCursor(0, 18); oled.println(linea1);
  oled.setTextSize(1);
  oled.setCursor(0, 44); oled.println(linea2);
  oled.display();
}`,
    camPos: [-8.5, 9.0, 25.5],
    camTarget: [-8.4, 6.8, 13.8],
    testAction: () => window.Blackbox.Bus.publish('input:rfid_invalid', {})
  },

  servo: {
    title: 'Microservo SG90 + Soporte Impreso en 3D',
    category: 'ACTUADOR DE CERRADURA MECÁNICA · PUERTA CENTRAL',
    badges: ['Señal PWM: Pin D3', 'Alimentación: 5V y GND', 'Soporte 3D PLA'],
    description:
      'Controla físicamente el pestillo de la puerta central. En estado bloqueado mantiene el brazo a 0° impidiendo la apertura. Al validarse una tarjeta autorizada, gira a 90° liberando el paso.',
    specs: [
      '<b>Soporte 3D a medida:</b> Cuna rígida diseñada en OpenSCAD para evitar que el cuerpo del servo se desplace al girar.',
      '<b>Protección lógica:</b> Nunca baja el pestillo mientras la hoja de la puerta siga abierta.'
    ],
    codeFile: 'Sentinel_Access_ArduinoUno.ino · Control PWM SG90',
    code: `#include <Servo.h>
Servo lockServo;

void setServoAngulo(int angulo) {
  lockServo.attach(PIN_SERVO); // Pin D3
  lockServo.write(angulo);     // 0° = Bloqueado, 90° = Abierto
}`,
    camPos: [5.5, 14.2, 24.5],
    camTarget: [4.2, 11.4, 13.8],
    testAction: () => window.Blackbox.Bus.publish('input:rfid_valid', {})
  },

  reed: {
    title: 'Sensor de Puerta (Reed Switch / MC-38)',
    category: 'PRODUCTOR DE EVENTOS · PUERTA CENTRAL',
    badges: ['Pin Digital: D2', 'Configuración: INPUT_PULLUP', 'Cerrada = LOW (0) · Abierta = HIGH (1)'],
    description:
      'Detecta en tiempo real si la puerta central está cerrada o abierta. Al usar la resistencia pull-up interna del microcontrolador, se conecta entre el Pin D2 y GND.',
    specs: [
      '<b>Disparo inmediato:</b> Si la puerta se abre mientras el sistema está ARMADO, pasa a estado de INTRUSIÓN.',
      '<b>Verificación antes de armar:</b> El sistema impide rearmar la bodega si detecta que la puerta quedó abierta.'
    ],
    codeFile: 'Sentinel_Access_ArduinoUno.ino · Monitoreo de Puerta en D2',
    code: `#define PIN_DOOR_SWITCH 2 // Entre Pin D2 y GND

bool lecturaPuerta = (digitalRead(PIN_DOOR_SWITCH) == HIGH);
if (lecturaPuerta != puertaAbierta) {
  puertaAbierta = lecturaPuerta;
  if (puertaAbierta && estadoActual == ARMADO) {
    estadoActual = INTRUSION;
    emitirJson("intrusion_puerta", "ReedSwitch", "NONE");
  }
}`,
    camPos: [-5.5, 14.5, 24.5],
    camTarget: [-3.8, 12.2, 13.8],
    testAction: () => window.Blackbox.Bus.publish('input:door_toggle', {})
  },

  pir: {
    title: 'Sensor Interior de Intrusión / Llama (KY-026 / PIR)',
    category: 'PRODUCTOR DE EVENTOS · VIGILANCIA INTERIOR',
    badges: ['Salida Digital DO: Pin D4', 'Alimentación: 5V y GND', 'Rango IR / Volumétrico'],
    description:
      'Vigila el interior de la bodega frente a ingresos por las ventanas laterales o el techo abatible. Si el sistema está ARMADO y el sensor se activa, dispara la alarma general.',
    specs: [
      '<b>Filtro por estado:</b> Durante el acceso autorizado (DESARMADO), la actividad interior se registra sin activar la sirena.',
      '<b>Calibración en placa:</b> Incluye potenciómetro multivuelta para ajustar el umbral de disparo.'
    ],
    codeFile: 'Sentinel_Access_ArduinoUno.ino · Lectura Digital en Pin D4',
    code: `#define PIN_INTRUSION 4 // Conectado al pin DO del sensor

bool lecturaSensor = (digitalRead(PIN_INTRUSION) == LOW);
if (lecturaSensor && !alertaSensor) {
  alertaSensor = true;
  if (estadoActual == ARMADO) {
    estadoActual = INTRUSION;
    emitirJson("intrusion_movimiento", "SensorInterior", "NONE");
  }
}`,
    camPos: [9.0, 24.0, 17.5],
    camTarget: [-10.5, 11.5, -4.5],
    testAction: () => window.Blackbox.Bus.publish('input:interior_sensor', {})
  },

  buzzer: {
    title: 'Buzzer Activo + Baliza Luminosa Interior',
    category: 'DISUASIÓN ACÚSTICA Y ALERTA DE EMERGENCIA',
    badges: ['Pin Digital: D8', 'Sirena Pulsante: 250 ms', 'Aviso Rechazo: 150 ms'],
    description:
      'Proporciona alertas auditivas diferenciadas: emite un pitido breve cuando se rechaza una tarjeta desconocida y activa una sirena intermitente de alta intensidad cuando se detecta una intrusión.',
    specs: [
      '<b>Enclavamiento de seguridad:</b> Una vez disparada la intrusión, la sirena no se apaga aunque cierren la puerta; exige presentar una tarjeta RFID autorizada.'
    ],
    codeFile: 'Sentinel_Access_ArduinoUno.ino · Sirena Intermitente en D8',
    code: `#define PIN_BUZZER 8

if (estadoActual == INTRUSION) {
  bool pulso = ((millis() / 250) % 2 == 0);
  digitalWrite(PIN_LED_ROJO, pulso ? HIGH : LOW);
  digitalWrite(PIN_BUZZER, pulso ? HIGH : LOW);
}`,
    camPos: [-6.0, 23.0, 17.5],
    camTarget: [10.0, 11.5, -4.5],
    testAction: () => {
      window.Blackbox.Bus.publish('input:arm', { silentIfArmed: true });
      window.Blackbox.Bus.publish('input:interior_sensor', {});
    }
  }
};
