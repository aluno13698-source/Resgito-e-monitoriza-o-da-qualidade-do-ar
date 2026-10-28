#include <SPI.h>
#include <WiFiNINA.h>
#include <DHT.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1351.h>
#include "arduino_secrets.h"

// Credenciais e servidor (definidos em arduino_secrets.h)
const char* ssid     = "Domi";
const char* password = "pelomenosnao";
const char* servidor = "resgito-e-monitoriza-o-da-qualidade-do-ar.onrender.com";
const char* apiKey   = "53d9eac4dd9fad04445268d6cebe3ba8";

// Configuração do Display OLED (128x128 RGB SPI)
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 128

#define CS_PIN   10
#define DC_PIN   9
#define MOSI_PIN 11  // DIN
#define SCLK_PIN 13  // CLK
#define RST_PIN  8

// Cores RGB565 para o Display
#define BLACK           0x0000                                               
#define WHITE           0xFFFF
#define RED             0xF800
#define GREEN           0x07E0
#define BLUE            0x001F
#define YELLOW          0xFFE0
#define CYAN            0x07FF
#define ORANGE          0xFD20

// Construtor por Software SPI (Evita conflitos com o chip WiFiNINA)
Adafruit_SSD1351 tft = Adafruit_SSD1351(SCREEN_WIDTH, SCREEN_HEIGHT, CS_PIN, DC_PIN, MOSI_PIN, SCLK_PIN, RST_PIN);

// Configuração do DHT22 (Pino Digital 4)
#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// Configuração dos Sensores Analógicos
#define MQ2PIN A0   // MQ-2 no Pino A0
#define LDRPIN A1   // LDR no Pino A1
#define MQ4PIN A2   // MQ-4 no Pino A2

unsigned long ultimoEnvio = 0;
const unsigned long intervaloEnvio = 5000; // 5 segundos

// Cores do ecrã (alteráveis no site). Ordem: fundo, título, alerta, valor, temp, hum, gás, ldr, mq4
enum { C_FUNDO, C_TITULO, C_ALERTA, C_VALOR, C_TEMP, C_HUM, C_GAS, C_LDR, C_MQ4, N_CORES };
uint16_t cores[N_CORES] = { BLACK, BLUE, RED, WHITE, ORANGE, CYAN, YELLOW, GREEN, RED };

// Lê "x-cores: aaaa,bbbb,..." (valores RGB565 em hexadecimal) enviado pelo servidor
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

// Estado devolvido pelo servidor
bool alertaAtivo = false;
bool servidorOk  = false;

WiFiSSLClient client;

void ligarWiFi() {
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print("[WIFI] A ligar a "); Serial.println(ssid);
    WiFi.begin(ssid, password);
    delay(5000);
  }
  Serial.println("[WIFI] Ligado com sucesso!");
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 5000);

  // 1. Inicialização do Ecrã OLED RGB
  tft.begin();
  tft.fillScreen(BLACK);
  tft.setTextColor(WHITE);
  tft.setTextSize(1);
  tft.setCursor(10, 10);
  tft.println("A Iniciar...");

  // 2. Inicialização dos sensores
  dht.begin();
  pinMode(MQ2PIN, INPUT);
  pinMode(LDRPIN, INPUT);
  pinMode(MQ4PIN, INPUT);

  // 3. Ligação Wi-Fi com indicação no ecrã
  tft.setCursor(10, 30);
  tft.setTextColor(YELLOW);
  tft.println("A ligar ao Wi-Fi...");
  ligarWiFi();
  tft.fillScreen(BLACK);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) ligarWiFi();

  if (millis() - ultimoEnvio >= intervaloEnvio) {
    ultimoEnvio = millis();

    // 1. Leitura dos Sensores
    float tempDHT = dht.readTemperature();
    float hum = dht.readHumidity();
    int valorGas = analogRead(MQ2PIN);
    int valorLuz = analogRead(LDRPIN);

    // Converte a leitura do MQ-4 (0-1023) para percentagem (0-100%)
    int valorMq4Bruto = analogRead(MQ4PIN);
    int valorMq4 = map(valorMq4Bruto, 0, 1023, 0, 100);

    // 2. Envia os dados para o servidor (Render) se o DHT22 estiver OK
    if (!isnan(tempDHT) && !isnan(hum)) {
      servidorOk = enviarParaServidor(tempDHT, hum, valorGas, valorLuz, valorMq4);
    } else {
      Serial.println("[ERRO] Falha na leitura do DHT22.");
    }

    // 3. Atualiza o Ecrã OLED (mostra também o estado do alerta)
    atualizarOLED(tempDHT, hum, valorGas, valorLuz, valorMq4);
  }
}

void atualizarOLED(float t, float h, int g, int l, int mq4) {
  tft.fillScreen(cores[C_FUNDO]);

  // Barra de Título (cor de alerta se o servidor indicar alerta)
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

  // Temperatura
  tft.setTextColor(cores[C_TEMP]);
  tft.setCursor(5, 26);
  tft.print("Temp: ");
  tft.setTextColor(cores[C_VALOR]);
  tft.print(t, 1);
  tft.print(" C");

  // Humidade
  tft.setTextColor(cores[C_HUM]);
  tft.setCursor(5, 46);
  tft.print("Humidade: ");
  tft.setTextColor(cores[C_VALOR]);
  tft.print(h, 0);
  tft.print(" %");

  // MQ-2 (Gás/Fumo)
  tft.setTextColor(cores[C_GAS]);
  tft.setCursor(5, 66);
  tft.print("MQ-2 (Gas): ");
  tft.setTextColor(cores[C_VALOR]);
  tft.print(g);

  // LDR (Luminosidade)
  tft.setTextColor(cores[C_LDR]);
  tft.setCursor(5, 86);
  tft.print("Luz (LDR): ");
  tft.setTextColor(cores[C_VALOR]);
  tft.print(l);

  // MQ-4 (Metano em %)
  tft.setTextColor(cores[C_MQ4]);
  tft.setCursor(5, 106);
  tft.print("MQ-4: ");
  tft.setTextColor(cores[C_VALOR]);
  tft.print(mq4);
  tft.print(" %");

  // Estado da ligação ao servidor
  tft.setTextColor(servidorOk ? GREEN : RED);
  tft.setCursor(5, 119);
  tft.print(servidorOk ? "Servidor: OK" : "Servidor: ERRO");
}

// Envia uma leitura para o servidor no Render.
// O servidor responde com o cabeçalho "X-Alerta: 1" se houver algum alerta ativo.
bool enviarParaServidor(float t, float h, int g, int l, int mq4) {
  if (WiFi.status() != WL_CONNECTED) return false;

  client.stop();
  if (!client.connect(servidor, 443)) {
    Serial.println("[ERRO] Falha ao estabelecer ligacao SSL (certificado do dominio instalado?).");
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

  // O Render gratuito pode demorar ~50 s a acordar apos inatividade
  bool statusOk = false;
  bool alerta = false;
  unsigned long inicio = millis();
  while ((client.connected() || client.available()) && millis() - inicio < 60000) {
    if (!client.available()) continue;
    String linha = client.readStringUntil('\n');
    linha.trim();
    linha.toLowerCase();
    if (linha.startsWith("http/1.1 200")) statusOk = true;
    if (linha.startsWith("x-alerta:")) alerta = linha.endsWith("1");
    if (linha.startsWith("x-cores:")) { linha.remove(0, 8); linha.trim(); lerCores(linha); }
    if (linha.length() == 0) break;   // fim dos cabeçalhos
  }
  client.stop();

  if (statusOk) {
    alertaAtivo = alerta;
    Serial.print("[OK] Leitura enviada. Alerta: ");
    Serial.println(alerta ? "SIM" : "nao");
  } else {
    Serial.println("[ERRO] Resposta invalida do servidor (verifica a API_KEY).");
  }
  return statusOk;
}
