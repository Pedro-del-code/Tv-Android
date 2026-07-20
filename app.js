;(() => {
  // ---- Elementos ----
  const screens = {
    connect: document.getElementById("screen-connect"),
    pairing: document.getElementById("screen-pairing"),
    remote: document.getElementById("screen-remote"),
  }
  const connectForm = document.getElementById("connect-form")
  const hostInput = document.getElementById("tv-host")
  const btnConnect = document.getElementById("btn-connect")
  const connectStatus = document.getElementById("connect-status")

  const pairingForm = document.getElementById("pairing-form")
  const codeInput = document.getElementById("pairing-code")
  const pairingStatus = document.getElementById("pairing-status")
  const btnCancelPairing = document.getElementById("btn-cancel-pairing")

  const tvLabel = document.getElementById("tv-label")
  const btnDisconnect = document.getElementById("btn-disconnect")
  const remoteStatus = document.getElementById("remote-status")
  const currentApp = document.getElementById("current-app")

  let ws = null
  let currentHost = ""

  // ---- Navegação entre telas ----
  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle("active", key === name)
    })
  }

  function setStatus(el, text, isError) {
    el.textContent = text || ""
    el.classList.toggle("error", Boolean(isError))
  }

  // ---- WebSocket ----
  function ensureSocket() {
    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === WebSocket.OPEN) return resolve(ws)

      const protocol = location.protocol === "https:" ? "wss:" : "ws:"
      ws = new WebSocket(`${protocol}//${location.host}`)

      ws.addEventListener("open", () => resolve(ws))
      ws.addEventListener("error", () => reject(new Error("Falha na conexão com o servidor")))
      ws.addEventListener("message", (event) => handleMessage(JSON.parse(event.data)))
      ws.addEventListener("close", () => {
        setStatus(remoteStatus, "Conexão com o servidor perdida", true)
      })
    })
  }

  function sendMsg(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  // ---- Mensagens do servidor ----
  function handleMessage(msg) {
    switch (msg.type) {
      case "connecting":
        setStatus(connectStatus, `Conectando em ${msg.host}...`)
        break
      case "pairing":
        showScreen("pairing")
        setStatus(pairingStatus, "Aguardando código da TV...")
        codeInput.focus()
        break
      case "ready":
        tvLabel.textContent = currentHost
        showScreen("remote")
        setStatus(remoteStatus, "")
        btnConnect.disabled = false
        break
      case "powered":
        setStatus(remoteStatus, msg.powered ? "" : "TV em espera")
        break
      case "volume":
        if (msg.volume && typeof msg.volume.level === "number") {
          setStatus(remoteStatus, `Volume: ${msg.volume.level}${msg.volume.muted ? " (mudo)" : ""}`)
        }
        break
      case "current_app":
        currentApp.textContent = msg.app ? `App atual: ${msg.app}` : ""
        break
      case "unpaired":
        setStatus(connectStatus, "Pareamento removido pela TV. Conecte novamente.", true)
        showScreen("connect")
        btnConnect.disabled = false
        break
      case "disconnected":
        showScreen("connect")
        setStatus(connectStatus, "Desconectado")
        btnConnect.disabled = false
        break
      case "error": {
        const active = screens.pairing.classList.contains("active")
          ? pairingStatus
          : screens.remote.classList.contains("active")
            ? remoteStatus
            : connectStatus
        setStatus(active, msg.message, true)
        btnConnect.disabled = false
        break
      }
    }
  }

  // ---- Conectar ----
  connectForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    const host = hostInput.value.trim()
    if (!host) return

    btnConnect.disabled = true
    setStatus(connectStatus, "Conectando ao servidor...")

    try {
      await ensureSocket()
      currentHost = host
      localStorage.setItem("tv_host", host)
      sendMsg({ type: "connect", host })
    } catch (err) {
      setStatus(connectStatus, err.message, true)
      btnConnect.disabled = false
    }
  })

  // ---- Pareamento ----
  pairingForm.addEventListener("submit", (event) => {
    event.preventDefault()
    const code = codeInput.value.trim().toUpperCase()
    if (!code) return
    setStatus(pairingStatus, "Validando código...")
    sendMsg({ type: "code", code })
  })

  btnCancelPairing.addEventListener("click", () => {
    sendMsg({ type: "disconnect" })
    showScreen("connect")
    setStatus(connectStatus, "")
    btnConnect.disabled = false
  })

  // ---- Controle ----
  document.querySelectorAll("[data-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendMsg({ type: "key", key: btn.dataset.key })
      if (navigator.vibrate) navigator.vibrate(15)
    })
  })

  document.querySelectorAll("[data-action='power']").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendMsg({ type: "power" })
      if (navigator.vibrate) navigator.vibrate(30)
    })
  })

  btnDisconnect.addEventListener("click", () => {
    sendMsg({ type: "disconnect" })
  })

  // ---- Restaurar último IP usado ----
  const savedHost = localStorage.getItem("tv_host")
  if (savedHost) hostInput.value = savedHost
})()
