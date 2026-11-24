/*
 * PROYECTO: BLACKBOX (Grupo SurCode)
 * SISTEMA IOT INTELIGENTE DE CONTROL DE ACCESO Y SEGURIDAD
 * INTEGRANTES: Benjamin Tampier, Fabian Barroso, Agustin Gomez, Maximiliano Muñoz
 *
 * DESCRIPCIÓN:
 * Firmware para ESP32-S3 que controla:
 *  - Lector RFID RC522 (SPI)
 *  - Sensor magnético de puerta Reed Switch (GPIO 14, INPUT_PULLUP)
 *  - Sensor de movimiento PIR HC-SR501 (GPIO 27, INPUT)
 *  - Cerradura con Microservo SG90 (GPIO 13, PWM)
 *  - Pantalla OLED 0.96" SSD1306 (I2C: SDA=8, SCL=9)
 *  - Indicadores LED: Verde (GPIO 4), Amarillo (GPIO 5), Rojo (GPIO 6)
 *  - Buzzer activo/pasivo (GPIO 26)
 *  - Envío de telemetría JSON por Serial USB (115200 bps) y Wi-Fi HTTP
 */

#include <Arduino.h>

// Definición de Pines (Ajustables según cableado final en protoboard)
#define PIN_REED       14
#define PIN_PIR        27
#define PIN_SERVO      13
#define PIN_BUZZER     26
#define PIN_LED_VERDE   4
#define PIN_LED_AMAR    5
#define PIN_LED_ROJO    6

enum EstadoSistema {
  ARMADO,
  DESARMADO,
  INTRUSION
};

EstadoSistema estadoActual = ARMADO;
bool puertaAbierta = false;
bool cerraduraLibre = false;
bool movimientoPir = false;
unsigned long tiempoDesbloqueo = 0;
const unsigned long DURACION_APERTURA_MS = 8000;

// UIDs autorizados de prueba
const char* UIDS_AUTORIZADOS[] = {
  "04:A3:9B:12", // Benjamin Tampier
  "04:7C:41:8E", // Fabian Barroso
  "04:D1:55:3A", // Agustin Gomez
  "04:19:E0:77"  // Maximiliano Muñoz
};

void emitirJsonEvento(const char* evento, const char* sensor, const char* uid) {
  const char* nombreEstado = (estadoActual == ARMADO) ? "ARMADO" :
                             (estadoActual == DESARMADO) ? "DESARMADO" : "INTRUSION";

  Serial.print("{\"device_id\":\"ESP32S3-BODEGA-01\",");
  Serial.print("\"event\":\""); Serial.print(evento); Serial.print("\",");
  Serial.print("\"sensor\":\""); Serial.print(sensor); Serial.print("\",");
  Serial.print("\"uid\":\""); Serial.print(uid); Serial.print("\",");
  Serial.print("\"state\":\""); Serial.print(nombreEstado); Serial.print("\",");
  Serial.print("\"reed_open\":"); Serial.print(puertaAbierta ? "true" : "false"); Serial.print(",");
  Serial.print("\"pir_motion\":"); Serial.print(movimientoPir ? "true" : "false");
  Serial.println("}");
}

void actualizarSalidasFisicas() {
  digitalWrite(PIN_LED_VERDE, estadoActual == DESARMADO ? HIGH : LOW);
  digitalWrite(PIN_LED_AMAR,  estadoActual == ARMADO    ? HIGH : LOW);
  digitalWrite(PIN_LED_ROJO,  estadoActual == INTRUSION ? HIGH : LOW);
  digitalWrite(PIN_BUZZER,    estadoActual == INTRUSION ? HIGH : LOW);
}

bool esUidAutorizado(const String& uid) {
  for (int i = 0; i < 4; i++) {
    if (uid.equalsIgnoreCase(UIDS_AUTORIZADOS[i])) return true;
  }
  return false;
}

void procesarTarjetaRfid(const String& uid) {
  if (esUidAutorizado(uid)) {
    estadoActual = DESARMADO;
    cerraduraLibre = true;
    tiempoDesbloqueo = millis();
    actualizarSalidasFisicas();
    emitirJsonEvento("acceso_autorizado", "RC522", uid.c_str());
  } else {
    // Regla del proyecto: Tarjeta desconocida rechaza acceso pero NO activa intrusión por sí sola
    digitalWrite(PIN_BUZZER, HIGH);
    delay(150);
    digitalWrite(PIN_BUZZER, estadoActual == INTRUSION ? HIGH : LOW);
    emitirJsonEvento("acceso_denegado", "RC522", uid.c_str());
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_REED, INPUT_PULLUP);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_LED_VERDE, OUTPUT);
  pinMode(PIN_LED_AMAR, OUTPUT);
  pinMode(PIN_LED_ROJO, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  actualizarSalidasFisicas();
  emitirJsonEvento("inicio_sistema", "ESP32-S3", "NONE");
}

void loop() {
  // 1. Lectura de Reed Switch (HIGH = imán separado = puerta abierta)
  bool lecturaPuerta = (digitalRead(PIN_REED) == HIGH);
  if (lecturaPuerta != puertaAbierta) {
    puertaAbierta = lecturaPuerta;
    if (puertaAbierta && estadoActual == ARMADO) {
      estadoActual = INTRUSION;
      actualizarSalidasFisicas();
      emitirJsonEvento("intrusion_puerta", "ReedSwitch", "NONE");
    } else {
      emitirJsonEvento(puertaAbierta ? "puerta_abierta" : "puerta_cerrada", "ReedSwitch", "NONE");
    }
  }

  // 2. Lectura de Sensor PIR HC-SR501
  bool lecturaPir = (digitalRead(PIN_PIR) == HIGH);
  if (lecturaPir && !movimientoPir) {
    movimientoPir = true;
    if (estadoActual == ARMADO) {
      estadoActual = INTRUSION;
      actualizarSalidasFisicas();
      emitirJsonEvento("intrusion_movimiento", "PIR_HCSR501", "NONE");
    } else {
      emitirJsonEvento("movimiento_autorizado", "PIR_HCSR501", "NONE");
    }
  } else if (!lecturaPir) {
    movimientoPir = false;
  }

  // 3. Cierre automático del pestillo SG90 tras vencer los 8 segundos
  if (cerraduraLibre && (millis() - tiempoDesbloqueo >= DURACION_APERTURA_MS) && !puertaAbierta) {
    cerraduraLibre = false;
    emitirJsonEvento("pestillo_bloqueado", "SG90", "NONE");
  }

  delay(80);
}
