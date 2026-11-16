# Registo e Monitorização da Qualidade do Ar (PAP)

Sistema IoT completo baseado em **Arduino Uno WiFi Rev2**, **Node.js / Express** e **Render** para monitorização ambiental em tempo real.

## Estrutura do Projeto

- `arduino/estacao_meteo/estacao_meteo.ino` — Código do microcontrolador Arduino (DHT22, MQ-2, MQ-4, LDR, Display OLED SSD1351, LED Verde/Vermelho e Buzzer).
- `server.js` — Servidor backend em Node.js/Express que recebe as leituras do Arduino, avalia limites de alerta e envia comandos via cabeçalhos HTTP (`X-Alerta`, `X-Cores`, `X-Buzzer`).
- `public/index.html` — Interface web em tempo real com gráficos, controlo de teste do buzzer/músicas e painel de definições.
- `package.json` & `render.yaml` — Configuração para deploy automático no Render.

## Ligações de Hardware (Arduino)

- **Display OLED SSD1351:** CS `10`, DC `9`, DIN/MOSI `11`, CLK/SCLK `13`, RST `8`
- **DHT22:** Pino Digital `4`
- **MQ-2 (Gás/Fumo):** Pino Analógico `A0`
- **LDR (Luminosidade):** Pino Analógico `A1`
- **MQ-4 (Metano):** Pino Analógico `A2`
- **LED (Verde/Vermelho):** Vermelho `5`, Verde `6`
- **Buzzer:** Pino Digital `3`

## Configuração no Render

- **Palavra-passe padrão das Definições:** `admin123` (alterável através da variável de ambiente `ADMIN_PASSWORD` no Render).
