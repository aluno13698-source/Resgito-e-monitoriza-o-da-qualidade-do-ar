#include <SPI.h>
#include <WiFiNINA.h>
#include <DHT.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1351.h>
// #include "arduino_secrets.h"

// Credenciais e servidor
const char* ssid     = "Domi";
const char* password = "pelomenosnao";
const char* servidor = "resgito-e-monitoriza-o-da-qualidade-do-ar.onrender.com";
const char* apiKey   = "53d9eac4dd9fad04445268d6cebe3ba8";

// Configuração do Display OLED (128x128 RGB SPI)
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 128

#define CS_PIN   10
#define DC_PIN   9
#define MOSI_PIN 11 
#define SCLK_PIN 13 
#define RST_PIN  8

// Pinos do LED e do Buzzer
#define LED_R      5
#define LED_G      6
#define BUZZER_PIN 3

// Cores RGB565 para o Display
#define BLACK   0x0000 
#define WHITE   0xFFFF
#define RED     0xF800
#define GREEN   0x07E0
#define BLUE    0x001F
#define YELLOW  0xFFE0
#define CYAN    0x07FF
#define ORANGE  0xFD20

Adafruit_SSD1351 tft = Adafruit_SSD1351(SCREEN_WIDTH, SCREEN_HEIGHT, CS_PIN, DC_PIN, MOSI_PIN, SCLK_PIN, RST_PIN);

// Configuração do DHT22
#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// Sensores Analógicos
#define MQ2PIN A0 
#define LDRPIN A1 
#define MQ4PIN A2 

unsigned long ultimoEnvio = 0;
const unsigned long intervaloEnvio = 5000;

enum { C_FUNDO, C_TITULO, C_ALERTA, C_VALOR, C_TEMP, C_HUM, C_GAS, C_LDR, C_MQ4, N_CORES };
uint16_t cores[N_CORES] = { BLACK, BLUE, RED, WHITE, ORANGE, CYAN, YELLOW, GREEN, RED };

void lerCores(String v) {
  int ini = 0;
  for (int i = 0; i < N_CORES; i++) {
    int fim = v.indexOf(',', ini);
    if (fim < 0) fim = v.length();
    if (fim <= ini) return;
    cores[i] = (uint16_t) strtol(v.substring(ini, fim).c_str(), NULL, 16);
    ini = fim + 1;
  }
}

bool alertaAtivo = false;
bool servidorOk  = false;
String musicaPendente = "";

WiFiSSLClient client;

void ligarWiFi() {
  // LED fica Vermelho no arranque, mas o Buzzer mantém-se SILENCIOSO
  digitalWrite(LED_R, HIGH);
  digitalWrite(LED_G, LOW);
  noTone(BUZZER_PIN); 

  while (WiFi.status() != WL_CONNECTED) {
    Serial.print("[WIFI] A ligar a "); Serial.println(ssid);
    WiFi.begin(ssid, password);
    delay(5000);
  }
  Serial.println("[WIFI] Ligado com sucesso!");
}

void controlarAlerta(bool alerta) {
  if (alerta) {
    digitalWrite(LED_R, HIGH);
    digitalWrite(LED_G, LOW);
    tone(BUZZER_PIN, 1000);
  } else {
    digitalWrite(LED_R, LOW);
    digitalWrite(LED_G, HIGH);
    noTone(BUZZER_PIN);
  }
}

void tocarNota(int freq, int duracao) {
  if (freq > 0) {
    tone(BUZZER_PIN, freq, duracao);
  }
  delay(duracao * 1.3);
  noTone(BUZZER_PIN);
}

void tocarMusica(String nome) {
  Serial.print("[BUZZER] A tocar: ");
  Serial.println(nome);

  if (nome == "teste") {
    tocarNota(1000, 120);
    tocarNota(1500, 120);
    tocarNota(2000, 200);
  } 
  else if (nome == "mario") {
    tocarNota(659, 120); // E5
    tocarNota(659, 120); // E5
    delay(120);
    tocarNota(659, 120); // E5
    delay(120);
    tocarNota(523, 120); // C5
    tocarNota(659, 120); // E5
    delay(120);
    tocarNota(784, 240); // G5
    delay(240);
    tocarNota(392, 240); // G4
  } 
  else if (nome == "starwars") {
    tocarNota(440, 350); // A4
    tocarNota(440, 350); // A4
    tocarNota(440, 350); // A4
    tocarNota(349, 250); // F4
    tocarNota(523, 100); // C5
    tocarNota(440, 350); // A4
    tocarNota(349, 250); // F4
    tocarNota(523, 100); // C5
    tocarNota(440, 500); // A4
  } 
  else if (nome == "nokia") {
    tocarNota(659, 120); // E5
    tocarNota(587, 120); // D5
    tocarNota(370, 240); // F#4
    tocarNota(415, 240); // G#4
    tocarNota(554, 120); // C#5
    tocarNota(494, 120); // B4
    tocarNota(294, 240); // D4
    tocarNota(330, 240); // E4
    tocarNota(494, 120); // B4
    tocarNota(440, 120); // A4
    tocarNota(277, 240); // C#4
    tocarNota(330, 240); // E4
    tocarNota(440, 400); // A4
  } 
  else if (nome == "parabens") {
    tocarNota(262, 180); // C4
    tocarNota(262, 180); // C4
    tocarNota(294, 350); // D4
    tocarNota(262, 350); // C4
    tocarNota(349, 350); // F4
    tocarNota(330, 550); // E4
  }

  noTone(BUZZER_PIN);
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 5000);

  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  noTone(BUZZER_PIN);

  tft.begin();
  tft.fillScreen(BLACK);
  tft.setTextColor(WHITE);
  tft.setTextSize(1);
  tft.setCursor(10, 10);
  tft.println("A Iniciar...");

  dht.begin();
  pinMode(MQ2PIN, INPUT);
  pinMode(LDRPIN, INPUT);
  pinMode(MQ4PIN, INPUT);

  tft.setCursor(10, 30);
  tft.setTextColor(YELLOW);
  tft.println("A ligar ao Wi-Fi...");
  ligarWiFi();
  tft.fillScreen(BLACK);
  
  controlarAlerta(false);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) ligarWiFi();

  if (millis() - ultimoEnvio >= intervaloEnvio) {
    ultimoEnvio = millis();

    float tempDHT = dht.readTemperature();
    float hum = dht.readHumidity();
    int valorGas = analogRead(MQ2PIN);
    int valorLuz = analogRead(LDRPIN);
    int valorMq4Bruto = analogRead(MQ4PIN);
    int valorMq4 = map(valorMq4Bruto, 0, 1023, 0, 100);

    if (!isnan(tempDHT) && !isnan(hum)) {
      servidorOk = enviarParaServidor(tempDHT, hum, valorGas, valorLuz, valorMq4);
    } else {
      Serial.println("[ERRO] Falha na leitura do DHT22.");
    }

    atualizarOLED(tempDHT, hum, valorGas, valorLuz, valorMq4);

    if (musicaPendente.length() > 0) {
      tocarMusica(musicaPendente);
      musicaPendente = "";
    }
    
    controlarAlerta(alertaAtivo);
  }
}

void atualizarOLED(float t, float h, int g, int l, int mq4) {
  tft.fillScreen(cores[C_FUNDO]);

  tft.fillRect(0, 0, 128, 18, alertaAtivo ? cores[C_ALERTA] : cores[C_TITULO]);
  tft.setTextColor(WHITE);
  tft.setTextSize(1);
  tft.setCursor(alertaAtivo ? 30 : 12, 5);
  tft.print(alertaAtivo ? "! ALERTA !" : "ESTACAO METEO");

  if (isnan(t) || isnan(h)) {
    tft.setTextColor(RED);
    tft.setCursor(10, 30);
    tft.print("Erro no DHT22!");
    return;
  }

  tft.setTextColor(cores[C_TEMP]);   tft.setCursor(5, 26);  tft.print("Temp: ");     tft.setTextColor(cores[C_VALOR]); tft.print(t, 1); tft.print(" C");
  tft.setTextColor(cores[C_HUM]);    tft.setCursor(5, 46);  tft.print("Humidade: "); tft.setTextColor(cores[C_VALOR]); tft.print(h, 0); tft.print(" %");
  tft.setTextColor(cores[C_GAS]);    tft.setCursor(5, 66);  tft.print("MQ-2 (Gas): ");tft.setTextColor(cores[C_VALOR]); tft.print(g);
  tft.setTextColor(cores[C_LDR]);    tft.setCursor(5, 86);  tft.print("Luz (LDR): ");tft.setTextColor(cores[C_VALOR]); tft.print(l);
  tft.setTextColor(cores[C_MQ4]);    tft.setCursor(5, 106); tft.print("MQ-4: ");     tft.setTextColor(cores[C_VALOR]); tft.print(mq4); tft.print(" %");

  tft.setTextColor(servidorOk ? GREEN : RED);
  tft.setCursor(5, 119);
  tft.print(servidorOk ? "Servidor: OK" : "Servidor: ERRO");
}

bool enviarParaServidor(float t, float h, int g, int l, int mq4) {
  if (WiFi.status() != WL_CONNECTED) return false;

  client.stop();
  if (!client.connect(servidor, 443)) {
    Serial.println("[ERRO] Falha ao estabelecer ligacao SSL.");
    return false;
  }

  String url = String("/api/leitura?key=") + apiKey +
               "&temp=" + String(t, 2) +
               "&hum="  + String(h, 1) +
               "&gas="  + String(g) +
               "&ldr="  + String(l) +
               "&mq4="  + String(mq4);

  client.print(String("GET ") + url + " HTTP/1.1\r\n" +
               "Host: " + servidor + "\r\n" +
               "User-Agent: Arduino\r\n" +
               "Connection: close\r\n\r\n");

  bool statusOk = false;
  bool alerta = false;
  unsigned long inicio = millis();
  
  while ((client.connected() || client.available()) && (millis() - inicio < 60000)) {
    if (!client.available()) continue;
    String linha = client.readStringUntil('\n');
    linha.trim();
    linha.toLowerCase();
    if (linha.startsWith("http/1.1 200")) statusOk = true;
    if (linha.startsWith("x-alerta:")) alerta = linha.endsWith("1");
    if (linha.startsWith("x-cores:")) { linha.remove(0, 8); linha.trim(); lerCores(linha); }
    if (linha.startsWith("x-buzzer:")) { 
      linha.remove(0, 9); 
      linha.trim(); 
      musicaPendente = linha; 
    }
    if (linha.length() == 0) break;
  }
  client.stop();

  if (statusOk) {
    alertaAtivo = alerta;
    Serial.print("[OK] Leitura enviada. Alerta: ");
    Serial.println(alerta ? "SIM" : "nao");
  } else {
    Serial.println("[ERRO] Resposta invalida do servidor.");
  }
  return statusOk;
}
