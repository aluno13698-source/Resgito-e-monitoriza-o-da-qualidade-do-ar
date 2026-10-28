# Estação Meteorológica – PAP

Arduino (DHT22, MQ-2, MQ-4, LDR, OLED) → servidor Node.js no **Render** → painel web com **alertas ajustáveis**.
O código fica no **GitHub** e cada `git push` faz **deploy automático** no Render.

```
estacao-meteo/
├── server.js                  # API + lógica de alertas
├── public/index.html          # Painel, histórico de alertas e definições
├── render.yaml                # Configuração do deploy no Render
├── package.json
└── arduino/estacao_meteo/     # Sketch do Arduino
    ├── estacao_meteo.ino
    └── arduino_secrets.h.example
```

## 1. Testar localmente (opcional)

```bash
npm install
API_KEY=teste ADMIN_PASSWORD=1234 npm start
# abrir http://localhost:3000
curl "http://localhost:3000/api/leitura?key=teste&temp=40&hum=50&gas=100&ldr=500&mq4=10"
```

## 2. Pôr no GitHub (com versões)

1. Cria um repositório vazio no GitHub (ex.: `estacao-meteo`).
2. Na pasta do projeto:

```bash
git init
git add .
git commit -m "Versão inicial da estação meteo"
git branch -M main
git remote add origin https://github.com/O_TEU_UTILIZADOR/estacao-meteo.git
git push -u origin main
```

O `.gitignore` já impede que `arduino_secrets.h` (Wi-Fi e chave) e `node_modules` sejam enviados.

**Versões:** a cada alteração faz um commit com mensagem clara. Para marcar versões importantes:

```bash
# aumentar "version" no package.json (ex.: 1.1.0), depois:
git commit -am "v1.1.0 - novo gráfico de humidade"
git tag v1.1.0
git push && git push --tags
```

A versão e o commit em produção aparecem no rodapé do painel.
Boa prática para a PAP: trabalhar em ramos (`git checkout -b nova-funcionalidade`), juntar ao `main` por Pull Request.

## 3. Deploy automático no Render

1. Em [render.com](https://render.com) → **New → Blueprint** → liga a tua conta GitHub e escolhe o repositório.
   O Render lê o `render.yaml` e cria o serviço sozinho.
   (Alternativa manual: **New → Web Service**, Build `npm install`, Start `npm start`.)
2. Quando pedir, define **ADMIN_PASSWORD** (a password para mudar os limites no painel).
3. Em **Environment**, copia o valor de **API_KEY** (foi gerado automaticamente).
4. Quando o deploy acabar tens o teu URL, tipo `https://estacao-meteo.onrender.com`.

A partir daqui, **todos os `git push` para `main` fazem deploy automático**.

> ⚠️ **Plano gratuito:** o serviço adormece após ~15 min sem pedidos (o Arduino envia de 5 em 5 s, por isso fica acordado) e o disco é temporário – os dados guardados em `data/` perdem-se em cada novo deploy/reinício. Para a PAP chega; para dados permanentes usa um *Render Disk* (pago) ou uma base de dados (ex.: Render Postgres).

## 4. Configurar o Arduino

1. Na pasta `arduino/estacao_meteo/`, copia `arduino_secrets.h.example` para `arduino_secrets.h` e preenche:
   `SECRET_SSID`, `SECRET_PASS`, `SECRET_HOST` (URL do Render **sem** `https://`) e `SECRET_API_KEY`.
2. **Certificado SSL (importante):** o módulo WiFiNINA só aceita HTTPS para domínios cujo certificado raiz esteja instalado.
   No Arduino IDE: **Ferramentas → WiFi101 / WiFiNINA Firmware Updater** → separador *Add domain* → adiciona `onrender.com:443` → *Upload certificates to WiFi module*.
3. Carrega o sketch. No Monitor Série deves ver `[OK] Leitura enviada`.

Se o servidor detetar um valor fora dos limites, a barra do OLED fica **vermelha com “! ALERTA !”**.

## 5. Alertas e definições

No separador **Definições** do site, para cada sensor podes ativar/desativar o alerta e definir **mínimo** e **máximo**
(campo vazio = sem limite). Também defines ao fim de quantos segundos sem dados a estação é considerada offline.
Os alertas aparecem num banner vermelho, tocam um aviso sonoro, podem gerar notificação do browser e ficam registados no **Histórico de alertas**.

Valores por defeito: temperatura 0–35 °C, humidade máx. 90 %, gás (MQ-2) máx. 400, metano (MQ-4) máx. 50 %, LDR desativado.
Os valores do MQ-2 e do LDR são leituras brutas (0–1023); ajusta-os depois de veres como se comportam os teus sensores.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/api/leitura?key=…&temp=&hum=&gas=&ldr=&mq4=` | Arduino envia uma leitura |
| GET | `/api/estado` | Última leitura, alertas ativos, definições |
| GET | `/api/leituras?minutos=60` | Histórico para o gráfico |
| GET | `/api/alertas` | Histórico de alertas |
| GET/PUT | `/api/definicoes` | Ler / alterar limites (PUT exige `x-admin-password`) |
| GET | `/api/saude` | Versão e commit (health check do Render) |
