const path = require("path")
const fs = require("fs")
const http = require("http")
const express = require("express")
const { WebSocketServer } = require("ws")
const { AndroidRemote, RemoteKeyCode, RemoteDirection } = require("androidtv-remote")

const PORT = process.env.PORT || 3000
const CERT_DIR = process.env.CERT_DIR || path.join(__dirname, ".certs")

const app = express()
app.use(express.static(path.join(__dirname, "public")))

app.get("/health", (_req, res) => {
  res.json({ ok: true })
})

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

// ---- Persistência de certificado (evita re-parear a cada reinício) ----
function certPathFor(host) {
  const safe = host.replace(/[^a-zA-Z0-9.-]/g, "_")
  return path.join(CERT_DIR, `${safe}.json`)
}

function loadCert(host) {
  try {
    const raw = fs.readFileSync(certPathFor(host), "utf8")
    const cert = JSON.parse(raw)
    if (cert.key && cert.cert) return cert
  } catch {
    /* sem certificado salvo */
  }
  return null
}

function saveCert(host, cert) {
  try {
    fs.mkdirSync(CERT_DIR, { recursive: true })
    fs.writeFileSync(certPathFor(host), JSON.stringify(cert))
  } catch (err) {
    console.error("Falha ao salvar certificado:", err.message)
  }
}

// ---- Mapa de teclas permitidas ----
const KEY_MAP = {
  power: RemoteKeyCode.KEYCODE_POWER,
  up: RemoteKeyCode.KEYCODE_DPAD_UP,
  down: RemoteKeyCode.KEYCODE_DPAD_DOWN,
  left: RemoteKeyCode.KEYCODE_DPAD_LEFT,
  right: RemoteKeyCode.KEYCODE_DPAD_RIGHT,
  ok: RemoteKeyCode.KEYCODE_DPAD_CENTER,
  back: RemoteKeyCode.KEYCODE_BACK,
  home: RemoteKeyCode.KEYCODE_HOME,
  menu: RemoteKeyCode.KEYCODE_MENU,
  volume_up: RemoteKeyCode.KEYCODE_VOLUME_UP,
  volume_down: RemoteKeyCode.KEYCODE_VOLUME_DOWN,
  mute: RemoteKeyCode.KEYCODE_VOLUME_MUTE,
  play_pause: RemoteKeyCode.KEYCODE_MEDIA_PLAY_PAUSE,
  rewind: RemoteKeyCode.KEYCODE_MEDIA_REWIND,
  forward: RemoteKeyCode.KEYCODE_MEDIA_FAST_FORWARD,
  channel_up: RemoteKeyCode.KEYCODE_CHANNEL_UP,
  channel_down: RemoteKeyCode.KEYCODE_CHANNEL_DOWN,
  tv_input: RemoteKeyCode.KEYCODE_TV_INPUT,
}

// ---- Gerenciamento da conexão com a TV (uma sessão por cliente WS) ----
wss.on("connection", (ws) => {
  let remote = null
  let currentHost = null

  const send = (msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  const cleanup = () => {
    if (remote) {
      try {
        remote.stop()
      } catch {
        /* já parado */
      }
      remote = null
    }
  }

  ws.on("message", async (data) => {
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return send({ type: "error", message: "Mensagem inválida" })
    }

    try {
      switch (msg.type) {
        case "connect": {
          const host = String(msg.host || "").trim()
          if (!host) return send({ type: "error", message: "Informe o IP da TV" })

          cleanup()
          currentHost = host
          const savedCert = loadCert(host)

          remote = new AndroidRemote(host, {
            pairing_port: 6467,
            remote_port: 6466,
            service_name: "Controle Remoto Web",
            cert: savedCert || {},
          })

          remote.on("secret", () => {
            send({ type: "pairing" })
          })

          remote.on("ready", () => {
            saveCert(host, remote.getCertificate())
            send({ type: "ready" })
          })

          remote.on("powered", (powered) => send({ type: "powered", powered }))
          remote.on("volume", (volume) => send({ type: "volume", volume }))
          remote.on("current_app", (appName) => send({ type: "current_app", app: appName }))
          remote.on("unpaired", () => {
            try {
              fs.unlinkSync(certPathFor(host))
            } catch {
              /* sem arquivo */
            }
            send({ type: "unpaired" })
          })
          remote.on("error", (err) => send({ type: "error", message: String(err?.message || err) }))

          send({ type: "connecting", host })
          remote.start().catch((err) => {
            send({ type: "error", message: `Não foi possível conectar em ${host}: ${err?.message || err}` })
          })
          break
        }

        case "code": {
          if (!remote) return send({ type: "error", message: "Nenhuma conexão ativa" })
          const code = String(msg.code || "").trim()
          if (!code) return send({ type: "error", message: "Informe o código de pareamento" })
          remote.sendCode(code)
          break
        }

        case "key": {
          if (!remote) return send({ type: "error", message: "Conecte-se à TV primeiro" })
          const keyCode = KEY_MAP[msg.key]
          if (keyCode === undefined) return send({ type: "error", message: `Tecla desconhecida: ${msg.key}` })
          remote.sendKey(keyCode, RemoteDirection.SHORT)
          break
        }

        case "power": {
          if (!remote) return send({ type: "error", message: "Conecte-se à TV primeiro" })
          remote.sendPower()
          break
        }

        case "app_link": {
          if (!remote) return send({ type: "error", message: "Conecte-se à TV primeiro" })
          if (msg.link) remote.sendAppLink(String(msg.link))
          break
        }

        case "disconnect": {
          cleanup()
          send({ type: "disconnected" })
          break
        }

        default:
          send({ type: "error", message: `Tipo desconhecido: ${msg.type}` })
      }
    } catch (err) {
      console.error("Erro:", err)
      send({ type: "error", message: String(err?.message || err) })
    }
  })

  ws.on("close", cleanup)
  ws.on("error", cleanup)
})

server.listen(PORT, () => {
  console.log(`Controle remoto Android TV pronto na porta ${PORT}`)
})
