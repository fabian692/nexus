# Nexus - Chat & Video 

Aplicación web de **chat + videollamadas** optimizada y lista para correr 

## Características

- Chat en tiempo real por salas
- Lista de usuarios online
- Crear / unirse a salas
- Videollamadas 1 a 1 (WebRTC)
- Compartir pantalla
- Micrófono y cámara on/off
- Indicador de “está escribiendo…”
- Emojis
- Tema claro / oscuro
- Diseño responsive



## 1. Instalar Node.js 

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 20 (recomendado)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar
node -v
npm -v
```

## 2. Instalar y ejecutar Nexus

```bash
# Copia la carpeta nexus a tu Raspberry Pi (por USB, scp, git, etc.)
cd nexus

# Instalar dependencias
npm install

# Iniciar
npm start
```

Abre desde cualquier dispositivo en la misma red:
**http://IP:3000**

Para saber la IP de la Raspberry Pi:
```bash
hostname -I
```

## 3. Hacer que arranque automáticamente (recomendado)

Crea un servicio systemd:

```bash
sudo nano /etc/systemd/system/nexus.service
```

Pega este contenido (ajusta la ruta si es necesario):

```ini
[Unit]
Description=Nexus Chat & Video
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/nexus
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Luego activa el servicio:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nexus
sudo systemctl start nexus
sudo systemctl status nexus
```

## 4. Acceso desde fuera de la red local (opcional)

- Usa un túnel como **Cloudflare Tunnel**, **ngrok** o **Tailscale**
- O configura port forwarding en tu router (puerto 3000)

**Importante:** Para videollamadas desde internet es muy recomendable usar **HTTPS**.


## Estructura del proyecto

```
nexus/
├── server.js
├── package.json
├── README.md
├── nexus.service          ← archivo de ejemplo para systemd
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## Comandos útiles

```bash
# Ver logs del servicio
sudo journalctl -u nexus -f

# Reiniciar
sudo systemctl restart nexus

# Parar
sudo systemctl stop nexus
```

¡Listo para usar en tu Raspberry Pi!
