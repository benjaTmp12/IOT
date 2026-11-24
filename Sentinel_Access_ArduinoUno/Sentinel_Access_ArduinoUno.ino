/*
 * PROYECTO: BLACKBOX (Grupo SurCode)
 * CONTROLADOR: Arduino Uno con Wi-Fi
 * DESCRIPCIÓN:
 * Firmware para Arduino Uno que gestiona:
 *  - RFID RC522 (SPI: D10, D11, D12, D13, D9)
 *  - Pantalla OLED SSD1306 (I2C: A4=SDA, A5=SCL)
 *  - Cerradura Microservo SG90 (PWM: D3)
 *  - Sensor Puerta Reed Switch / Microswitch (D2 con INPUT_PULLUP)
 *  - Sensor Intrusión / Fuego KY-026 (Digital: D4)
 *  - LEDs de estado: Verde (D5), Amarillo (D6), Rojo (D7)
 *  - Buzzer alarma (D8)
 *  - Comunicación Serial JSON con Dashboard a 115200 bps
 */

#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Servo.h>

// -------------------------------------------------------------
// ASIGNACIÓN DE PINES (ARDUINO UNO)
// -------------------------------------------------------------
#define PIN_DOOR_SWITCH  2   // Reed switch o Microswitch (con INPUT_PULLUP)
#define PIN_SERVO        3   // Señal PWM del Microservo SG90
#define PIN_INTRUSION    4   // Pin DO del sensor KY-026 (o PIR)
#define PIN_LED_VERDE    5   // LED Verde (Acceso / Desarmado)
#define PIN_LED_AMAR     6   // LED Amarillo (Armado)
#define PIN_LED_ROJO     7   // LED Rojo (Intrusión)
#define PIN_BUZZER       8   // Zumbador
#define PIN_RFID_RST     9   // Reset del RFID RC522
#define PIN_RFID_SS     10   // SDA / Slave Select del RC522
// Pines SPI fijos de Arduino Uno: MOSI=11, MISO=12, SCK=13
// Pines I2C fijos de Arduino Uno: SDA=A4, SCL=A5

// Objetos de hardware
MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Servo lockServo;

// Estados del sistema
enum Estado { ARMADO, DESARMADO, INTRUSION };
Estado estadoActual = ARMADO;

bool puertaAbierta = false;
bool cerraduraDesbloqueada = false;
bool alertaSensor = false;
unsigned long tiempoDesbloqueo = 0;
const unsigned long TIEMPO_APERTURA_MS = 8000;

// Lista de UIDs autorizados
const char* UIDS_AUTORIZADOS[] = {
  "04:A3:9B:12", // Benjamin Tampier
  "04:7C:41:8E", // Fabian Barroso
  "04:D1:55:3A", // Agustin Gomez
  "04:19:E0:77"  // Maximiliano Muñoz
};

// -------------------------------------------------------------
// FUNCIONES AUXILIARES DE PANTALLA Y COMUNICACIÓN
// -------------------------------------------------------------
void emitirJson(const char* evento, const char* sensor, const char* uid) {
  const char* nomEst = (estadoActual == ARMADO) ? "ARMADO" :
                       (estadoActual == DESARMADO) ? "DESARMADO" : "INTRUSION";

  Serial.print("{\"device_id\":\"ARDUINO-UNO-WIFI\",");
  Serial.print("\"event\":\""); Serial.print(evento); Serial.print("\",");
  Serial.print("\"sensor\":\""); Serial.print(sensor); Serial.print("\",");
  Serial.print("\"uid\":\""); Serial.print(uid); Serial.print("\",");
  Serial.print("\"state\":\""); Serial.print(nomEst); Serial.print("\",");
  Serial.print("\"reed_open\":"); Serial.print(puertaAbierta ? "true" : "false"); Serial.print(",");
  Serial.print("\"pir_motion\":"); Serial.print(alertaSensor ? "true" : "false");
  Serial.println("}");
}

void actualizarOled(const char* linea1, const char* linea2) {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
  oled.println(F("BLACKBOX"));
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 18);
  oled.setTextSize(2);
  oled.println(linea1);
  oled.setTextSize(1);
  oled.setCursor(0, 44);
  oled.println(linea2);
  oled.display();
}

void actualizarLucesYSalidas() {
  digitalWrite(PIN_LED_VERDE, estadoActual == DESARMADO ? HIGH : LOW);
  digitalWrite(PIN_LED_AMAR,  estadoActual == ARMADO    ? HIGH : LOW);
  digitalWrite(PIN_LED_ROJO,  estadoActual == INTRUSION ? HIGH : LOW);
  digitalWrite(PIN_BUZZER,    estadoActual == INTRUSION ? HIGH : LOW);
}

void setServoAngulo(int angulo) {
  lockServo.attach(PIN_SERVO);
  lockServo.write(angulo);
}

bool verificarUid(String uid) {
  for (int i = 0; i < 4; i++) {
    if (uid.equalsIgnoreCase(UIDS_AUTORIZADOS[i])) return true;
  }
  return false;
}

String obtenerUidString(MFRC522::Uid *uidObj) {
  String s = "";
  for (byte i = 0; i < uidObj->size; i++) {
    if (uidObj->uidByte[i] < 0x10) s += "0";
    s += String(uidObj->uidByte[i], HEX);
    if (i < uidObj->size - 1) s += ":";
  }
  s.toUpperCase();
  return s;
}

// -------------------------------------------------------------
// SETUP
// -------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  // Configurar Pines
  pinMode(PIN_DOOR_SWITCH, INPUT_PULLUP);
  pinMode(PIN_INTRUSION, INPUT);
  pinMode(PIN_LED_VERDE, OUTPUT);
  pinMode(PIN_LED_AMAR, OUTPUT);
  pinMode(PIN_LED_ROJO, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  // Iniciar buses
  SPI.begin();
  rfid.PCD_Init();

  // Iniciar OLED I2C (dirección 0x3C habitual)
  if (oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    actualizarOled("ARMADO", "ESPERANDO TARJETA");
  }

  // Servo a posición bloqueada (0 grados)
  setServoAngulo(0);

  actualizarLucesYSalidas();
  emitirJson("inicio_sistema", "ArduinoUno", "NONE");
}

// -------------------------------------------------------------
// LOOP PRINCIPAL
// -------------------------------------------------------------
void loop() {
  // 1. REED SWITCH / MICROSWITCH DE PUERTA
  // Con INPUT_PULLUP: LOW = cerrado (puerta cerrada), HIGH = abierto (puerta abierta)
  bool lecturaPuerta = (digitalRead(PIN_DOOR_SWITCH) == HIGH);
  if (lecturaPuerta != puertaAbierta) {
    puertaAbierta = lecturaPuerta;
    if (puertaAbierta && estadoActual == ARMADO) {
      estadoActual = INTRUSION;
      actualizarLucesYSalidas();
      actualizarOled("!INTRUSION!", "PUERTA FORZADA");
      emitirJson("intrusion_puerta", "ReedSwitch", "NONE");
    } else {
      actualizarOled(puertaAbierta ? "PUERTA ABIERTA" : "PUERTA CERRADA", 
                     estadoActual == ARMADO ? "SISTEMA ARMADO" : "ACCESO PERMITIDO");
      emitirJson(puertaAbierta ? "puerta_abierta" : "puerta_cerrada", "ReedSwitch", "NONE");
    }
  }

  // 2. SENSOR DE INTRUSIÓN / KY-026 (PIN D4)
  // Generalmente DO pasa a LOW cuando detecta la señal (o HIGH según potenciómetro)
  bool lecturaSensor = (digitalRead(PIN_INTRUSION) == LOW); 
  if (lecturaSensor && !alertaSensor) {
    alertaSensor = true;
    if (estadoActual == ARMADO) {
      estadoActual = INTRUSION;
      actualizarLucesYSalidas();
      actualizarOled("!INTRUSION!", "SENSOR ACTIVO");
      emitirJson("intrusion_movimiento", "KY026", "NONE");
    } else {
      emitirJson("movimiento_autorizado", "KY026", "NONE");
    }
  } else if (!lecturaSensor) {
    alertaSensor = false;
  }

  // 3. LECTOR RFID RC522
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    String uidLeido = obtenerUidString(&(rfid.uid));
    
    if (verificarUid(uidLeido)) {
      // Tarjeta autorizada: Desarma bodega y abre pestillo
      estadoActual = DESARMADO;
      cerraduraDesbloqueada = true;
      tiempoDesbloqueo = millis();
      setServoAngulo(90); // Gira pestillo a 90° (abierto)
      actualizarLucesYSalidas();
      actualizarOled("ACCESO OK", uidLeido.c_str());
      emitirJson("acceso_autorizado", "RC522", uidLeido.c_str());
    } else {
      // Tarjeta desconocida: Rechaza con beep corto, NO dispara alarma
      digitalWrite(PIN_BUZZER, HIGH);
      delay(150);
      digitalWrite(PIN_BUZZER, estadoActual == INTRUSION ? HIGH : LOW);
      actualizarOled("DENEGADO", "TARJETA NO REG");
      emitirJson("acceso_denegado", "RC522", uidLeido.c_str());
    }
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }

  // 4. CIERRE AUTOMÁTICO DE PESTILLO TRAS 8 SEGUNDOS
  if (cerraduraDesbloqueada && (millis() - tiempoDesbloqueo >= TIEMPO_APERTURA_MS) && !puertaAbierta) {
    cerraduraDesbloqueada = false;
    setServoAngulo(0); // Vuelve a 0° bloqueado
    actualizarOled(estadoActual == ARMADO ? "ARMADO" : "DESARMADO", "PESTILLO CERRADO");
    emitirJson("pestillo_bloqueado", "SG90", "NONE");
  }

  // 5. PARPADEO SI ESTÁ EN INTRUSIÓN
  if (estadoActual == INTRUSION) {
    bool parpadeo = ((millis() / 250) % 2 == 0);
    digitalWrite(PIN_LED_ROJO, parpadeo ? HIGH : LOW);
    digitalWrite(PIN_BUZZER, parpadeo ? HIGH : LOW);
  }

  delay(60);
}
