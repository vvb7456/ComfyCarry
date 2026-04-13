import { ref, computed, onBeforeUnmount, type Ref } from 'vue'

// ── Types ────────────────────────────────────────────────────────────────────

export type MaskTool = 'brush' | 'eraser'

export interface MaskEditorState {
  tool: Ref<MaskTool>
  brushSize: Ref<number>
  zoom: Ref<number>
  panX: Ref<number>
  panY: Ref<number>
  hasMaskContent: Ref<boolean>
}

export interface MaskEditorActions {
  /** Initialize canvases with the reference image */
  init: (imageUrl: string, containerEl: HTMLElement) => Promise<void>
  /** Clean up canvases and event listeners */
  destroy: () => void
  /** Clear all mask content */
  clearMask: () => void
  /** Invert mask (white ↔ black) */
  invertMask: () => void
  /** Export mask as PNG Blob */
  exportMask: () => Promise<Blob | null>
  /** Load existing mask data URL onto mask canvas */
  loadMask: (maskUrl: string) => Promise<void>
  /** Reset zoom and pan to fit view */
  resetView: () => void
}

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_BRUSH = 5
const MAX_BRUSH = 200
const DEFAULT_BRUSH = 30
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const BRUSH_STEP_RATIO = 0.3 // line interpolation density

// ── Composable ───────────────────────────────────────────────────────────────

/**
 * useMaskEditor — Canvas-based mask drawing logic.
 *
 * Creates a dual-canvas system:
 * - Background canvas: renders the reference image (read-only)
 * - Mask canvas: user draws white (brush) / black (eraser) regions
 *
 * Both are overlaid and rendered to a single display canvas for the user.
 */
export function useMaskEditor() {
  // ── State ──────────────────────────────────────────────────────────────
  const tool = ref<MaskTool>('brush')
  const brushSize = ref(DEFAULT_BRUSH)
  const zoom = ref(1)
  const panX = ref(0)
  const panY = ref(0)
  const hasMaskContent = ref(false)

  // ── Internal refs ──────────────────────────────────────────────────────
  let imgCanvas: HTMLCanvasElement | null = null
  let maskCanvas: HTMLCanvasElement | null = null
  let displayCanvas: HTMLCanvasElement | null = null
  let tintCanvas: HTMLCanvasElement | null = null
  let containerEl: HTMLElement | null = null

  let imgCtx: CanvasRenderingContext2D | null = null
  let maskCtx: CanvasRenderingContext2D | null = null
  let displayCtx: CanvasRenderingContext2D | null = null

  let imgWidth = 0
  let imgHeight = 0
  let drawing = false
  let lastX = -1
  let lastY = -1
  let panning = false
  let panStartX = 0
  let panStartY = 0
  let spaceHeld = false

  // ── Canvas setup ───────────────────────────────────────────────────────

  async function init(imageUrl: string, container: HTMLElement): Promise<void> {
    containerEl = container
    destroy()

    // Load image
    const img = await loadImage(imageUrl)
    imgWidth = img.naturalWidth
    imgHeight = img.naturalHeight

    // Create offscreen canvases
    imgCanvas = document.createElement('canvas')
    imgCanvas.width = imgWidth
    imgCanvas.height = imgHeight
    imgCtx = imgCanvas.getContext('2d')!
    imgCtx.drawImage(img, 0, 0)

    maskCanvas = document.createElement('canvas')
    maskCanvas.width = imgWidth
    maskCanvas.height = imgHeight
    maskCtx = maskCanvas.getContext('2d')!
    // Start with all black (no mask)
    maskCtx.fillStyle = '#000000'
    maskCtx.fillRect(0, 0, imgWidth, imgHeight)
    hasMaskContent.value = false

    // Create display canvas (visible to user)
    displayCanvas = document.createElement('canvas')
    displayCanvas.style.cssText = 'display:block;width:100%;height:100%;cursor:crosshair;'
    container.innerHTML = ''
    container.appendChild(displayCanvas)

    // Fit view
    resetView()

    // Bind events
    bindEvents()
    render()
  }

  function destroy() {
    unbindEvents()
    if (displayCanvas && containerEl?.contains(displayCanvas)) {
      containerEl.removeChild(displayCanvas)
    }
    imgCanvas = null
    maskCanvas = null
    displayCanvas = null
    tintCanvas = null
    imgCtx = null
    maskCtx = null
    displayCtx = null
    hasMaskContent.value = false
    drawing = false
    panning = false
  }

  // ── View ───────────────────────────────────────────────────────────────

  function resetView() {
    if (!containerEl || !imgWidth || !imgHeight) return
    const cw = containerEl.clientWidth
    const ch = containerEl.clientHeight
    const scale = Math.min(cw / imgWidth, ch / imgHeight, 1)
    zoom.value = scale
    panX.value = (cw - imgWidth * scale) / 2
    panY.value = (ch - imgHeight * scale) / 2
    resizeDisplayCanvas()
    render()
  }

  function resizeDisplayCanvas() {
    if (!displayCanvas || !containerEl) return
    const dpr = window.devicePixelRatio || 1
    const cw = containerEl.clientWidth
    const ch = containerEl.clientHeight
    displayCanvas.width = cw * dpr
    displayCanvas.height = ch * dpr
    displayCtx = displayCanvas.getContext('2d')!
    displayCtx.scale(dpr, dpr)
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  function render() {
    if (!displayCtx || !displayCanvas || !imgCanvas || !maskCanvas || !containerEl) return
    const dpr = window.devicePixelRatio || 1
    const cw = containerEl.clientWidth
    const ch = containerEl.clientHeight
    displayCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    displayCtx.clearRect(0, 0, cw, ch)

    // Checkerboard background
    displayCtx.fillStyle = '#1a1a2e'
    displayCtx.fillRect(0, 0, cw, ch)

    displayCtx.save()
    displayCtx.translate(panX.value, panY.value)
    displayCtx.scale(zoom.value, zoom.value)

    // Draw reference image
    displayCtx.drawImage(imgCanvas, 0, 0)

    // Draw mask overlay: tint white mask regions red
    // Step 1: Create tinted mask on a temp canvas
    if (!tintCanvas || tintCanvas.width !== imgWidth || tintCanvas.height !== imgHeight) {
      tintCanvas = document.createElement('canvas')
      tintCanvas.width = imgWidth
      tintCanvas.height = imgHeight
    }
    const tintCtx = tintCanvas.getContext('2d')!
    tintCtx.clearRect(0, 0, imgWidth, imgHeight)
    // Read mask pixel data and create a red overlay where mask is white
    const maskData = maskCtx!.getImageData(0, 0, imgWidth, imgHeight)
    const tintImageData = tintCtx.createImageData(imgWidth, imgHeight)
    const src = maskData.data
    const dst = tintImageData.data
    for (let i = 0; i < src.length; i += 4) {
      const brightness = src[i] // R channel (grayscale: R=G=B)
      if (brightness > 128) {
        dst[i] = 255     // R
        dst[i + 1] = 51  // G
        dst[i + 2] = 51  // B
        dst[i + 3] = 255 // A
      }
      // else: leave transparent (dst is already zeroed)
    }
    tintCtx.putImageData(tintImageData, 0, 0)

    // Step 2: Draw tinted mask over reference image with transparency
    displayCtx.globalAlpha = 0.45
    displayCtx.drawImage(tintCanvas, 0, 0)
    displayCtx.globalAlpha = 1

    displayCtx.restore()
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  function screenToImage(clientX: number, clientY: number): [number, number] {
    if (!displayCanvas) return [0, 0]
    const rect = displayCanvas.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const ix = (sx - panX.value) / zoom.value
    const iy = (sy - panY.value) / zoom.value
    return [ix, iy]
  }

  function drawStroke(x0: number, y0: number, x1: number, y1: number) {
    if (!maskCtx) return
    const radius = brushSize.value / 2
    const color = tool.value === 'brush' ? '#ffffff' : '#000000'
    maskCtx.fillStyle = color

    const dx = x1 - x0
    const dy = y1 - y0
    const dist = Math.sqrt(dx * dx + dy * dy)
    const steps = Math.max(1, Math.ceil(dist / (radius * BRUSH_STEP_RATIO)))

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = x0 + dx * t
      const y = y0 + dy * t
      maskCtx.beginPath()
      maskCtx.arc(x, y, radius, 0, Math.PI * 2)
      maskCtx.fill()
    }

    // Brush always adds white pixels → set true immediately. Eraser needs full scan.
    if (tool.value === 'brush') {
      hasMaskContent.value = true
    } else {
      hasMaskContent.value = checkMaskContent()
    }
  }

  function drawDot(x: number, y: number) {
    if (!maskCtx) return
    const radius = brushSize.value / 2
    maskCtx.fillStyle = tool.value === 'brush' ? '#ffffff' : '#000000'
    maskCtx.beginPath()
    maskCtx.arc(x, y, radius, 0, Math.PI * 2)
    maskCtx.fill()
    if (tool.value === 'brush') {
      hasMaskContent.value = true
    } else {
      hasMaskContent.value = checkMaskContent()
    }
  }

  // ── Mask operations ────────────────────────────────────────────────────

  function clearMask() {
    if (!maskCtx) return
    maskCtx.fillStyle = '#000000'
    maskCtx.fillRect(0, 0, imgWidth, imgHeight)
    hasMaskContent.value = false
    render()
  }

  function invertMask() {
    if (!maskCtx) return
    const imageData = maskCtx.getImageData(0, 0, imgWidth, imgHeight)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]       // R
      data[i + 1] = 255 - data[i + 1] // G
      data[i + 2] = 255 - data[i + 2] // B
      // Alpha stays 255
    }
    maskCtx.putImageData(imageData, 0, 0)
    hasMaskContent.value = checkMaskContent()
    render()
  }

  function checkMaskContent(): boolean {
    if (!maskCtx) return false
    const data = maskCtx.getImageData(0, 0, imgWidth, imgHeight).data
    // Full scan with early exit — check R channel of each pixel
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 128) return true
    }
    return false
  }

  async function exportMask(): Promise<Blob | null> {
    if (!maskCanvas) return null
    return new Promise((resolve) => {
      maskCanvas!.toBlob((blob) => resolve(blob), 'image/png')
    })
  }

  async function loadMask(maskUrl: string): Promise<void> {
    if (!maskCtx) return
    const img = await loadImage(maskUrl)
    maskCtx.drawImage(img, 0, 0, imgWidth, imgHeight)
    hasMaskContent.value = checkMaskContent()
    render()
  }

  // ── Event handlers ─────────────────────────────────────────────────────

  function onPointerDown(e: PointerEvent) {
    if (!displayCanvas) return
    if (spaceHeld || e.button === 1) {
      // Pan mode
      panning = true
      panStartX = e.clientX - panX.value
      panStartY = e.clientY - panY.value
      displayCanvas.style.cursor = 'grabbing'
      e.preventDefault()
      return
    }
    if (e.button !== 0) return

    drawing = true
    displayCanvas.setPointerCapture(e.pointerId)
    const [ix, iy] = screenToImage(e.clientX, e.clientY)
    lastX = ix
    lastY = iy
    drawDot(ix, iy)
    render()
  }

  function onPointerMove(e: PointerEvent) {
    if (panning) {
      panX.value = e.clientX - panStartX
      panY.value = e.clientY - panStartY
      render()
      return
    }
    if (!drawing) {
      // Update cursor preview
      renderCursor(e)
      return
    }
    const [ix, iy] = screenToImage(e.clientX, e.clientY)
    drawStroke(lastX, lastY, ix, iy)
    lastX = ix
    lastY = iy
    render()
    renderCursor(e)
  }

  function onPointerUp(e: PointerEvent) {
    if (panning) {
      panning = false
      if (displayCanvas) displayCanvas.style.cursor = 'crosshair'
      return
    }
    drawing = false
    lastX = -1
    lastY = -1
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    if (!displayCanvas) return
    const rect = displayCanvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const oldZoom = zoom.value
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor))

    // Zoom toward cursor
    panX.value = mx - (mx - panX.value) * (newZoom / oldZoom)
    panY.value = my - (my - panY.value) * (newZoom / oldZoom)
    zoom.value = newZoom
    render()
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === ' ') {
      spaceHeld = true
      if (displayCanvas) displayCanvas.style.cursor = 'grab'
      e.preventDefault()
    } else if (e.key === 'b' || e.key === 'B') {
      tool.value = 'brush'
    } else if (e.key === 'e' || e.key === 'E') {
      tool.value = 'eraser'
    } else if (e.key === '[') {
      brushSize.value = Math.max(MIN_BRUSH, brushSize.value - 5)
    } else if (e.key === ']') {
      brushSize.value = Math.min(MAX_BRUSH, brushSize.value + 5)
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === ' ') {
      spaceHeld = false
      if (displayCanvas && !panning) displayCanvas.style.cursor = 'crosshair'
    }
  }

  // ── Cursor ─────────────────────────────────────────────────────────────

  function renderCursor(e: PointerEvent) {
    if (!displayCtx || !displayCanvas || !containerEl) return
    // Re-render then draw cursor on top
    render()
    const rect = displayCanvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const radius = (brushSize.value / 2) * zoom.value
    const dpr = window.devicePixelRatio || 1
    displayCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    displayCtx.beginPath()
    displayCtx.arc(sx, sy, radius, 0, Math.PI * 2)
    displayCtx.strokeStyle = tool.value === 'brush'
      ? 'rgba(255, 255, 255, 0.7)'
      : 'rgba(0, 0, 0, 0.7)'
    displayCtx.lineWidth = 1.5
    displayCtx.stroke()
  }

  // ── Event binding ──────────────────────────────────────────────────────

  function bindEvents() {
    if (!displayCanvas) return
    displayCanvas.addEventListener('pointerdown', onPointerDown)
    displayCanvas.addEventListener('pointermove', onPointerMove)
    displayCanvas.addEventListener('pointerup', onPointerUp)
    displayCanvas.addEventListener('pointerleave', onPointerUp)
    displayCanvas.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
  }

  function unbindEvents() {
    if (displayCanvas) {
      displayCanvas.removeEventListener('pointerdown', onPointerDown)
      displayCanvas.removeEventListener('pointermove', onPointerMove)
      displayCanvas.removeEventListener('pointerup', onPointerUp)
      displayCanvas.removeEventListener('pointerleave', onPointerUp)
      displayCanvas.removeEventListener('wheel', onWheel)
    }
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keyup', onKeyUp)
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
      img.src = url
    })
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  onBeforeUnmount(() => {
    destroy()
  })

  return {
    // State
    tool,
    brushSize,
    zoom,
    panX,
    panY,
    hasMaskContent,
    // Actions
    init,
    destroy,
    clearMask,
    invertMask,
    exportMask,
    loadMask,
    resetView,
  }
}
