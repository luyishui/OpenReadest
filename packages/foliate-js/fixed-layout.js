import 'construct-style-sheets-polyfill'

const parseViewport = str => str
    ?.split(/[,;\s]/) // NOTE: technically, only the comma is valid
    ?.filter(x => x)
    ?.map(x => x.split('=').map(x => x.trim()))

const getViewport = (doc, viewport) => {
    // use `viewBox` for SVG
    if (doc.documentElement.localName === 'svg') {
        const [, , width, height] = doc.documentElement
            .getAttribute('viewBox')?.split(/\s/) ?? []
        return { width, height }
    }

    // get `viewport` `meta` element
    const meta = parseViewport(doc.querySelector('meta[name="viewport"]')
        ?.getAttribute('content'))
    if (meta) return Object.fromEntries(meta)

    // fallback to book's viewport
    if (typeof viewport === 'string') return parseViewport(viewport)
    if (viewport?.width && viewport.height) return viewport

    // if no viewport (possibly with image directly in spine), get image size
    const img = doc.querySelector('img')
    if (img) return { width: img.naturalWidth, height: img.naturalHeight }

    // just show *something*, i guess...
    console.warn(new Error('Missing viewport properties'))
    return { width: 1000, height: 2000 }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const captureScrollModeAnchor = (pages, scrollTop, fallbackIndex = -1) => {
    const fallbackPage = pages.find(page => page.index === fallbackIndex)
    const currentPage = pages.find(page =>
        page.height > 0
        && scrollTop >= page.top
        && scrollTop < page.top + page.height)
        ?? fallbackPage
        ?? pages.find(page => page.height > 0)

    if (!currentPage) return null
    return {
        index: currentPage.index,
        fraction: currentPage.height > 0
            ? clamp((scrollTop - currentPage.top) / currentPage.height, 0, 1)
            : 0,
        scrollTop,
    }
}

export const restoreScrollModeAnchor = (pages, anchor, maxScrollTop) => {
    if (!anchor) return 0
    const page = pages.find(candidate => candidate.index === anchor.index)
    if (!page || page.height <= 0) return clamp(anchor.scrollTop, 0, maxScrollTop)
    return clamp(page.top + page.height * anchor.fraction, 0, maxScrollTop)
}

export const scrollGapToCss = (value) => {
    const n = parseFloat(value)
    return Number.isFinite(n) && n >= 0 ? `${n}px` : null
}

// Decide which scroll-mode pages to begin loading and which to evict, given the
// reader's current page and each page's load state. `visible` is set by the
// IntersectionObserver (true while the page sits within the widened preload
// margin). Visible idle pages closest to the reader load first, bounded by how
// many loads may run at once; loaded pages farthest from the reader are evicted
// once over the in-memory cap, but a visible page is never torn out from under
// the reader. Prioritising the nearest page and bounding concurrency keeps a
// fast fling from kicking off a full-resolution canvas render for every page it
// flies past — that thrashes the main thread and spikes WebView memory
// (readest#4795), the same pressure the PDF range-read throttle guards against
// (readest#3470).
export const planScrollModePages = ({
    pages, currentIndex, maxLoaded, maxConcurrent, loadingCount,
}) => {
    const dist = page => Math.abs(page.index - currentIndex)

    const budget = Math.max(0, maxConcurrent - loadingCount)
    const load = budget === 0 ? [] : pages
        .filter(page => page.visible && page.state === 'idle')
        .sort((a, b) => dist(a) - dist(b))
        .slice(0, budget)
        .map(page => page.index)

    const loaded = pages.filter(page => page.state === 'loaded')
    const evict = loaded.length <= maxLoaded ? [] : loaded
        .filter(page => !page.visible)
        .sort((a, b) => dist(b) - dist(a))
        .slice(0, loaded.length - maxLoaded)
        .map(page => page.index)

    return { load, evict }
}

// Live CSS transform for a scroll-mode pinch gesture. Scroll mode has no single
// spread frame to scale, so the whole scroll container is scaled for immediate
// visual feedback while the fingers move (instead of only re-rendering on
// release). The scale is anchored at the centre of the viewport (in the
// container's coordinate space); the post-pinch re-render then scrolls the
// centre page back to the rect it occupied in this preview (see
// #restorePinchAnchor), so the committed zoom lands without a jump.
export const computeScrollPinchTransform = ({
    ratio, scrollLeft, scrollTop, viewportWidth, viewportHeight,
}) => ({
    transform: `scale(${ratio})`,
    transformOrigin: `${scrollLeft + viewportWidth / 2}px ${scrollTop + viewportHeight / 2}px`,
})

// Scroll offsets to apply to the host (`overflow:auto`) after rendering a
// paginated page. Horizontal is always re-centered so the page sits in the
// middle of the viewport. Vertical is reset to the top only on a page turn:
// a tall fit-width page overflows the host vertically, and without the reset the
// freshly-shown page inherits the previous page's offset and opens scrolled to
// the bottom (#4683). Plain re-renders (resize, zoom, theme) keep the reader's
// current vertical position within the page.
export const computePaginatedScroll = ({ elementWidth, containerWidth, scrollTop, pageTurn }) => ({
    scrollLeft: (elementWidth - containerWidth) / 2,
    scrollTop: pageTurn ? 0 : scrollTop,
})

// Visual shift (CSS px) to apply to the right page of a two-page spread to hide
// the one-pixel white spine seam (#4857). The two page iframes are independent
// compositor layers, each scaled by a (usually non-integer) factor. At a
// fractional devicePixelRatio the spine between them lands on a fractional
// device pixel, so each layer's edge there is anti-aliased against transparency
// and the reader background bleeds through as a thin white seam. Pulling the
// top-most (right) page onto the left by exactly one device pixel makes each
// soft edge sit over the neighbour's opaque content instead of the background.
// Returns 0 for layouts with no touching spine (single/centred/portrait page or
// a blank-padded slot). The pages stay adjacent at every zoom, so the overlap
// applies at sub-100% zoom too.
export const computeSpreadSpineOverlap = ({
    center = false, portrait = false, leftBlank = false, rightBlank = false,
    devicePixelRatio = 1,
} = {}) => {
    if (center || portrait || leftBlank || rightBlank) return 0
    return -1 / (devicePixelRatio || 1)
}

// Inline margins for the two pages of a spread. In landscape both pages are
// shown and pushed together at the spine: the left page hugs the right edge
// (`margin-inline-start: auto`) and the right page hugs the left edge
// (`margin-inline-end: auto`), so the pair sits centred. In portrait only one
// page of the spread is shown; a one-sided auto margin would strand that lone
// page in one half of the viewport whenever it is narrower than the viewport
// (readest#4984), so both margins are auto to centre it. Both inline margins are
// always set explicitly (the opposite side cleared to '') so a re-render after
// an orientation change fully overwrites the previous layout's margins — frames
// are re-styled in place, not recreated, on rotation.
export const computeSpreadInlineMargins = (portrait) => portrait
    ? {
        left: { marginInlineStart: 'auto', marginInlineEnd: 'auto' },
        right: { marginInlineStart: 'auto', marginInlineEnd: 'auto' },
    }
    : {
        left: { marginInlineStart: 'auto', marginInlineEnd: '' },
        right: { marginInlineStart: '', marginInlineEnd: 'auto' },
    }

// Align the SVG overlayer's coord system with the iframe's unscaled content.
// When the iframe is visually scaled via CSS transform (non-PDF path),
// getClientRects() inside the iframe returns positions in the iframe's native
// coord system, so the SVG must use a matching viewBox to scale rects to the
// on-screen size. PDFs re-render their text layer at scale via onZoom, so
// rects are already in scaled coords and no viewBox is needed.
export const applyOverlayerViewBox = (frame, overlayer) => {
    if (!overlayer?.element) return
    const el = overlayer.element
    if (frame?.onZoom) {
        el.removeAttribute('viewBox')
        el.removeAttribute('preserveAspectRatio')
    } else {
        const w = frame?.width ?? frame?.vpWidth
        const h = frame?.height ?? frame?.vpHeight
        if (w && h) {
            el.setAttribute('viewBox', `0 0 ${w} ${h}`)
            el.setAttribute('preserveAspectRatio', 'none')
        }
    }
}

export class FixedLayout extends HTMLElement {
    static observedAttributes = ['zoom', 'scale-factor', 'spread', 'flow', 'scroll-gap']
    #root = this.attachShadow({ mode: 'open' })
    #observer = new ResizeObserver(() => this.#render())
    #spreads
    #index = -1
    defaultViewport
    spread
    #portrait = false
    #left
    #right
    #center
    #side
    #zoom
    #scaleFactor = 1.0
    #totalScaleFactor = 1.0
    #scrollLocked = false
    #isOverflowX = false
    #isOverflowY = false
    #preloadCache = new Map()
    #prerenderedSpreads = new Map()
    #spreadAccessTime = new Map()
    #maxConcurrentPreloads = 1
    #numPrerenderedSpreads = 1
    #maxCachedSpreads = 2
    #overlayers = new Map()
    #pageColors = {}
    #preloadQueue = []
    #activePreloads = 0
    // Scroll mode fields
    #scrollMode = false
    #scrollPages = []
    #scrollObserver = null
    #scrollContainer = null
    #scrollLoadGen = new Map()
    // Live rendered-canvas cap. Each PDF page canvas is sized to the on-screen
    // page box × devicePixelRatio (~7 MB at dpr 3), so this is the dominant
    // memory ceiling — keep it just above the visible window plus preload lead.
    #scrollMaxLoaded = 12
    // Cap on concurrent page loads. A fast fling crosses many pages; without a
    // bound it would start a full-resolution render for every one, thrashing the
    // main thread and spiking memory. Nearest-to-viewport pages load first.
    #scrollMaxConcurrent = 3
    #scrollLoadingCount = 0
    #scrollIdleTimer = null
    #scrollCurrentIndex = -1
    // True while the host is actively scrolling. Pages load interactive only
    // when idle so a page that finishes loading mid-scroll can't flip its iframe
    // interactive and let its own pointer handlers hijack the native scroll.
    #scrolling = false
    // True while a pinch gesture is live. Suppresses page load/eviction so the
    // placeholder layout (and thus scrollTop) can't drift mid-pinch, which would
    // make the live preview and the committed zoom land in different places.
    #pinching = false
    // On-screen rect of the page under the viewport centre, captured from the
    // live (still-transformed) preview at pinch end ({ index, top, left }). The
    // commit re-render scrolls that page back to this exact rect, so the zoom
    // lands where the preview showed it. Using the real getBoundingClientRect
    // (not fraction maths) sidesteps gap/page-boundary and header-offset errors.
    #pinchAnchor = null
    #captureCenterPageRect() {
        const cy = this.getBoundingClientRect().top + this.clientHeight / 2
        for (const page of this.#scrollPages) {
            const rect = page.el.getBoundingClientRect()
            if (rect.top <= cy && rect.bottom > cy) {
                return { index: page.index, top: rect.top, left: rect.left }
            }
        }
        return null
    }
    // Scroll so the captured page sits back at its pre-commit on-screen rect.
    #restorePinchAnchor(anchor) {
        const page = this.#scrollPages.find(p => p.index === anchor.index)
        if (!page) return
        const rect = page.el.getBoundingClientRect()
        const maxTop = Math.max(0, this.scrollHeight - this.clientHeight)
        const maxLeft = Math.max(0, this.scrollWidth - this.clientWidth)
        this.scrollTop = clamp(this.scrollTop + (rect.top - anchor.top), 0, maxTop)
        this.scrollLeft = clamp(this.scrollLeft + (rect.left - anchor.left), 0, maxLeft)
    }
    #getScrollModePageMetrics() {
        return this.#scrollPages.map(page => ({
            index: page.index,
            top: page.el.offsetTop,
            height: page.el.offsetHeight,
        }))
    }
    #captureScrollModeAnchor() {
        if (!this.#scrollPages.length) return null
        const fallbackIndex = this.#scrollCurrentIndex >= 0
            ? this.#scrollCurrentIndex : this.#getScrollIndex()
        return captureScrollModeAnchor(
            this.#getScrollModePageMetrics(),
            this.scrollTop,
            fallbackIndex,
        )
    }
    #restoreScrollModeAnchor(anchor) {
        if (!anchor || !this.#scrollPages.length) return
        const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight)
        this.scrollTop = restoreScrollModeAnchor(
            this.#getScrollModePageMetrics(),
            anchor,
            maxScrollTop,
        )
        this.#scrollCurrentIndex = anchor.index
    }
    constructor() {
        super()

        const sheet = new CSSStyleSheet()
        this.#root.adoptedStyleSheets = [sheet]
        sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: flex-start;
            align-items: center;
            overflow: auto;
        }
        @supports (justify-content: safe center) {
          :host {
            justify-content: safe center;
          }
        }
        :host([flow="scrolled"]) {
            display: block;
            overflow-y: auto;
            /* auto (not hidden) so a zoomed page wider than the viewport can be
               panned horizontally; collapses to no scrollbar when pages fit. */
            overflow-x: auto;
            /* Keep one-finger pan (native scroll) but reserve two-finger
               gestures for JS so a pinch is delivered instead of triggering the
               browser's own pinch-zoom or being swallowed by the scroller. */
            touch-action: pan-x pan-y;
        }
        :host([flow="scrolled"]) .scroll-page {
            touch-action: pan-x pan-y;
        }
        :host([flow="scrolled"]) .scroll-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100%;
            /* Grow to the widest (zoomed) page so the host can scroll across its
               full width, but stay at least viewport-wide so unzoomed pages stay
               centered. Without max-content the centered overflow is unreachable
               (the flexbox centered-overflow scroll trap). */
            width: max-content;
            min-width: 100%;
            background-color: var(--scroll-bg-color);
            background-opacity: var(--scroll-bg-opacity);
        }
        :host([flow="scrolled"]) .scroll-page {
            position: relative;
            flex-shrink: 0;
            overflow: hidden;
            /* Scale the gap with the zoom so the committed layout matches the
               pinch preview, whose transform scales the whole container (gaps
               included). Without this the gap snaps back to a fixed px on
               release and the pages shift. */
            margin: calc(var(--scroll-page-gap, 4px) * var(--scroll-zoom, 1)) 0;
        }
        :host([flow="scrolled"]) .scroll-page iframe {
            pointer-events: none;
        }`)

        this.#observer.observe(this)
    }
    attributeChangedCallback(name, _, value) {
        switch (name) {
            case 'zoom':
                this.#zoom = value !== 'fit-width' && value !== 'fit-page'
                    ? parseFloat(value) : value
                this.#render()
                break
            case 'scale-factor':
                this.#scaleFactor = parseFloat(value) / 100
                this.#render()
                break
            case 'spread':
                this.#respread(value)
                break
            case 'flow':
                if (value === 'scrolled' && !this.#scrollMode) {
                    // Capture index from paginated mode BEFORE setting scroll flag
                    const savedIndex = this.index
                    this.#scrollMode = true
                    if (this.book) this.#initScrollMode(savedIndex)
                } else if (value !== 'scrolled' && this.#scrollMode) {
                    this.#destroyScrollMode()
                    this.#scrollMode = false
                    this.#render()
                }
                break
            case 'scroll-gap': {
                const css = scrollGapToCss(value)
                const anchor = this.#scrollMode ? this.#captureScrollModeAnchor() : null
                if (css === null) this.style.removeProperty('--scroll-page-gap')
                else this.style.setProperty('--scroll-page-gap', css)
                if (anchor) this.#restoreScrollModeAnchor(anchor)
                break
            }
        }
    }
    async #createFrame({ index, src: srcOption, detached = false }) {
        const srcOptionIsString = typeof srcOption === 'string'
        const src = srcOptionIsString ? srcOption : srcOption?.src
        const data = srcOptionIsString ? null : srcOption?.data
        const onZoom = srcOptionIsString ? null : srcOption?.onZoom
        const element = document.createElement('div')
        element.setAttribute('dir', 'ltr')
        element.style.position = 'relative'
        const iframe = document.createElement('iframe')
        element.append(iframe)
        Object.assign(iframe.style, {
            border: '0',
            display: 'none',
            overflow: 'hidden',
        })
        // `allow-scripts` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        iframe.setAttribute('scrolling', 'no')
        iframe.setAttribute('part', 'filter')
        this.#root.append(element)

        if (detached) {
            Object.assign(element.style, {
                position: 'absolute',
                visibility: 'hidden',
                pointerEvents: 'none',
            })
        }

        if (!src) return { blank: true, element, iframe }
        return new Promise(resolve => {
            iframe.addEventListener('load', () => {
                const doc = iframe.contentDocument
                iframe.dataset.sectionIndex = index
                this.dispatchEvent(new CustomEvent('load', { detail: { doc, index } }))
                const { width, height } = getViewport(doc, this.defaultViewport)
                resolve({
                    element, iframe,
                    width: parseFloat(width),
                    height: parseFloat(height),
                    onZoom,
                    detached,
                })
            }, { once: true })
            if (data) {
                iframe.srcdoc = data
            } else {
                iframe.src = src
            }
        })
    }
    #render(side = this.#side, pageTurn = false) {
        if (this.#scrollMode) {
            this.#renderScrollMode()
            return []
        }
        if (!side) return []
        const left = this.#left ?? {}
        const right = this.#center ?? this.#right ?? {}
        const target = side === 'left' ? left : right
        const { width, height } = this.getBoundingClientRect()
        // for unfolded devices with slightly taller height than width also use landscape layout
        const portrait = this.spread !== 'both' && this.spread !== 'portrait'
            && height > width * 1.2
        this.#portrait = portrait
        const blankWidth = left.width ?? right.width ?? 0
        const blankHeight = left.height ?? right.height ?? 0

        let scale = typeof this.#zoom === 'number' && !isNaN(this.#zoom)
            ? this.#zoom
            : (this.#zoom === 'fit-width'
                ? (portrait || this.#center
                    ? width / (target.width ?? blankWidth)
                    : width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)))
                : (portrait || this.#center
                    ? Math.min(
                        width / (target.width ?? blankWidth),
                        height / (target.height ?? blankHeight))
                    : Math.min(
                        width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)),
                        height / Math.max(
                            left.height ?? blankHeight,
                            right.height ?? blankHeight)))
            ) || 1

        scale *= this.#scaleFactor
        this.#totalScaleFactor = scale

        const renderPromises = []
        const transform = ({frame, styles}) => {
            let { element, iframe, width, height, blank, onZoom } = frame
            if (!iframe) return
            if (onZoom) {
                const p = onZoom({ doc: frame.iframe.contentDocument, scale, pageColors: this.#pageColors })
                if (p?.then) {
                    // onZoom (e.g. pdf.js) may rebuild the text layer DOM,
                    // invalidating Range objects stored in the overlayer. After
                    // the rebuild, re-emit create-overlayer so listeners can
                    // re-anchor annotations against the fresh DOM.
                    const refreshed = p.then(() => this.#refreshOverlayerForFrame(frame))
                    renderPromises.push(refreshed)
                }
            }
            const iframeScale = onZoom ? scale : 1
            const zoomedOut = this.#scaleFactor < 1.0
            // Centering a zoomed-out page inside its box only works for the PDF
            // path, whose iframe is natively sized to the (scaled) box. Non-PDF
            // fixed layout keeps the iframe at its native size and shrinks it
            // with `transform: scale`, so flex-centering the un-scaled iframe
            // pushes it out of view and blanks the page (#4857). Keep those in
            // normal block flow at every zoom.
            const centerInBox = zoomedOut && onZoom
            Object.assign(iframe.style, {
                width: `${width * iframeScale}px`,
                height: `${height * iframeScale}px`,
                transform: onZoom ? 'none' : `scale(${scale})`,
                transformOrigin: 'top left',
                display: blank ? 'none' : 'block',
            })
            Object.assign(element.style, {
                width: `${(width ?? blankWidth) * scale}px`,
                height: `${(height ?? blankHeight) * scale}px`,
                flexShrink: '0',
                display: centerInBox ? 'flex' : 'block',
                marginBlock: centerInBox ? undefined : 'auto',
                alignItems: centerInBox ? 'center' : undefined,
                justifyContent: centerInBox ? 'center' : undefined,
                ...styles,
            })
            if (portrait && frame !== target) {
                element.style.display = 'none'
            }

            // position and redraw overlayer to match the scaled iframe
            const sectionIndex = iframe.dataset.sectionIndex != null
                ? parseInt(iframe.dataset.sectionIndex) : undefined
            if (sectionIndex != null) {
                const overlayer = this.#overlayers.get(sectionIndex)
                if (overlayer) {
                    Object.assign(overlayer.element.style, {
                        position: 'absolute',
                        top: '0',
                        left: '0',
                        width: `${(width ?? blankWidth) * scale}px`,
                        height: `${(height ?? blankHeight) * scale}px`,
                    })
                    applyOverlayerViewBox({
                        onZoom,
                        width: width ?? blankWidth,
                        height: height ?? blankHeight,
                    }, overlayer)
                    overlayer.redraw()
                }
            }

            const container= element.parentNode?.host
            if (!container) return
            const containerWidth = container.clientWidth
            const containerHeight = container.clientHeight
            const { scrollLeft, scrollTop } = computePaginatedScroll({
                elementWidth: element.clientWidth,
                containerWidth,
                scrollTop: container.scrollTop,
                pageTurn,
            })
            container.scrollLeft = scrollLeft
            container.scrollTop = scrollTop

            return {
                width: element.clientWidth,
                height: element.clientHeight,
                containerWidth,
                containerHeight,
            }
        }
        if (this.#center) {
            const dimensions = transform({frame: this.#center, styles: { marginInline: 'auto' }})
            if (!dimensions) return renderPromises
            const {width, height, containerWidth, containerHeight} = dimensions
            this.#isOverflowX = width > containerWidth
            this.#isOverflowY = height > containerHeight
        } else {
            // Hide the 1px white spine seam on a two-page spread by overlapping
            // the right page onto the left by one device pixel (#4857). Always
            // set `transform` (to 'none' when not overlapping) so a stale shift
            // from a previous render is cleared when the layout changes.
            const overlapX = computeSpreadSpineOverlap({
                portrait,
                leftBlank: Boolean(left.blank),
                rightBlank: Boolean(right.blank),
                devicePixelRatio: window.devicePixelRatio || 1,
            })
            // In portrait only the target page is shown; centre it instead of
            // hugging the spine, which would strand it in one half of the
            // viewport (#4984).
            const margins = computeSpreadInlineMargins(portrait)
            const leftDimensions = transform({frame: left, styles: margins.left})
            const rightDimensions = transform({frame: right, styles: {
                ...margins.right,
                transform: overlapX ? `translateX(${overlapX}px)` : 'none',
            }})
            if (!leftDimensions || !rightDimensions) return renderPromises
            const {width: leftWidth, height: leftHeight, containerWidth, containerHeight} = leftDimensions
            const {width: rightWidth, height: rightHeight} = rightDimensions
            this.#isOverflowX = leftWidth + rightWidth > containerWidth
            this.#isOverflowY = Math.max(leftHeight, rightHeight) > containerHeight
        }
        // A pinch commit overrides the default re-centring above: scroll the
        // spread back to the on-screen rect it occupied in the live preview so
        // the zoom doesn't jump (matters most when the page was scrolled within
        // an overflowing zoom). See pinchEnd.
        if (this.#pinchAnchor) {
            const frame = this.#center ?? this.#left ?? this.#right
            if (frame?.element) {
                const b = frame.element.getBoundingClientRect()
                const maxTop = Math.max(0, this.scrollHeight - this.clientHeight)
                const maxLeft = Math.max(0, this.scrollWidth - this.clientWidth)
                this.scrollTop = clamp(this.scrollTop + (b.top - this.#pinchAnchor.top), 0, maxTop)
                this.scrollLeft = clamp(this.scrollLeft + (b.left - this.#pinchAnchor.left), 0, maxLeft)
            }
            this.#pinchAnchor = null
        }
        return renderPromises
    }
    async #showSpread({ left, right, center, side, spreadIndex }) {
        this.#left = null
        this.#right = null
        this.#center = null

        const cacheKey = spreadIndex !== undefined ? `spread-${spreadIndex}` : null
        const prerendered = cacheKey ? this.#prerenderedSpreads.get(cacheKey) : null

        if (prerendered) {
            this.#spreadAccessTime.set(cacheKey, Date.now())
            if (prerendered.center) {
                this.#center = prerendered.center
            } else {
                this.#left = prerendered.left
                this.#right = prerendered.right
            }
        } else {
            if (center) {
                this.#center = await this.#createFrame(center)
                if (cacheKey) {
                    this.#prerenderedSpreads.set(cacheKey, { center: this.#center })
                    this.#spreadAccessTime.set(cacheKey, Date.now())
                }
            } else {
                this.#left = await this.#createFrame(left)
                this.#right = await this.#createFrame(right)
                if (cacheKey) {
                    this.#prerenderedSpreads.set(cacheKey, { left: this.#left, right: this.#right })
                    this.#spreadAccessTime.set(cacheKey, Date.now())
                }
            }
        }

        this.#side = center ? 'center' : this.#left?.blank ? 'right'
            : this.#right?.blank ? 'left' : side
        const visibleFrames = center
            ? [this.#center?.element]
            : [this.#left?.element, this.#right?.element]

        Array.from(this.#root.children).forEach(child => {
            const isVisible = visibleFrames.includes(child)
            Object.assign(child.style, {
                position: isVisible ? 'relative' : 'absolute',
                visibility: isVisible ? 'visible' : 'hidden',
                pointerEvents: isVisible ? 'auto' : 'none',
            })
        })

        // Render layout and await any async onZoom callbacks (e.g. PDF text
        // layer rendering) so the document is fully populated before overlayers
        // try to resolve CFIs against it. Pass pageTurn so a tall fit-width page
        // starts at the top instead of inheriting the previous page's scroll.
        const renderPromises = this.#render(this.#side, true)
        if (renderPromises.length) await Promise.all(renderPromises)

        const showingFrames = center
            ? [this.#center]
            : [this.#left, this.#right]
        for (const frame of showingFrames) {
            if (!frame?.iframe) continue
            const index = frame.iframe.dataset.sectionIndex != null
                ? parseInt(frame.iframe.dataset.sectionIndex) : undefined
            if (index != null && !this.#overlayers.has(index)) {
                const doc = frame.iframe.contentDocument
                if (doc) {
                    this.dispatchEvent(new CustomEvent('create-overlayer', {
                        detail: {
                            doc, index,
                            attach: overlayer => {
                                this.#overlayers.set(index, overlayer)
                                frame.element.append(overlayer.element)
                                applyOverlayerViewBox(frame, overlayer)
                            },
                        },
                    }))
                }
            }
        }
    }
    #initScrollMode(targetIndex = 0) {
        const currentIndex = targetIndex

        // Hide all paginated content
        for (const child of Array.from(this.#root.children)) {
            child.style.display = 'none'
        }

        this.#scrollContainer = document.createElement('div')
        this.#scrollContainer.className = 'scroll-container'
        this.#root.append(this.#scrollContainer)

        const sections = this.book.sections
        const viewport = this.defaultViewport
        const vw = viewport?.width ?? 1000
        const vh = viewport?.height ?? 1400
        this.#scrollPages = sections.map((section, i) => {
            const el = document.createElement('div')
            el.className = 'scroll-page'
            el.dataset.index = i
            this.#scrollContainer.append(el)
            return { el, index: i, section, state: 'idle', visible: false, frame: null, vpWidth: vw, vpHeight: vh }
        })

        this.#renderScrollMode()

        // Scroll to target position BEFORE setting up the observer
        // so only pages near the target are observed as intersecting
        if (currentIndex >= 0 && currentIndex < this.#scrollPages.length) {
            this.#scrollPages[currentIndex].el.scrollIntoView()
            this.#scrollCurrentIndex = currentIndex
        }

        this.addEventListener('scroll', this.#handleScrollEvent)

        // Set up IntersectionObserver after scroll position is established.
        // rootMargin '200%' marks pages within ~2 viewport heights above/below as
        // visible, giving the ~400 ms-per-page render enough lead time to finish
        // before the page scrolls into view. The observer only flags visibility;
        // #scheduleScrollPages decides what to actually load (nearest first,
        // bounded concurrency) and evict.
        this.#scrollObserver = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const index = parseInt(entry.target.dataset.index)
                const pageData = this.#scrollPages[index]
                if (pageData) pageData.visible = entry.isIntersecting
            }
            this.#scheduleScrollPages()
        }, { root: this, rootMargin: '200% 0px' })

        for (const page of this.#scrollPages) {
            this.#scrollObserver.observe(page.el)
        }
    }
    // Load the nearest visible idle pages and evict the farthest off-screen ones,
    // honouring the concurrency and in-memory caps. Re-run whenever visibility or
    // load state changes so a finished load immediately pulls in the next page.
    #scheduleScrollPages() {
        // While pinching, loading/evicting pages would resize placeholders and
        // drift the scroll position, breaking the preview-to-commit alignment.
        if (this.#pinching) return
        const currentIndex = this.#getScrollIndex()
        const { load, evict } = planScrollModePages({
            pages: this.#scrollPages,
            currentIndex,
            maxLoaded: this.#scrollMaxLoaded,
            maxConcurrent: this.#scrollMaxConcurrent,
            loadingCount: this.#scrollLoadingCount,
        })
        for (const index of evict) this.#teardownScrollPage(this.#scrollPages[index])
        for (const index of load) this.#loadScrollPage(this.#scrollPages[index])
    }
    #handleScrollEvent = () => {
        // Drop iframe interaction while the host is actively scrolling so the
        // scroll stays native-smooth (the iframe's own pointer handlers can't
        // hijack it), then restore it on settle so text selection, taps, and
        // same-page pinch work again. (Cross-page pinch is intentionally not
        // supported in this mode: a gesture spanning two page iframes can't be
        // owned by one document — keeping the iframes interactive is the
        // trade-off for native selection.)
        this.#scrolling = true
        this.#setScrollIframeInteraction(false)
        if (this.#scrollIdleTimer) clearTimeout(this.#scrollIdleTimer)
        this.#scrollIdleTimer = setTimeout(() => {
            this.#scrolling = false
            this.#setScrollIframeInteraction(true)
            // Report location only after scroll settles to avoid
            // expensive React re-renders on every frame
            this.#reportScrollLocation()
        }, 150)
    }
    #setScrollIframeInteraction(enabled) {
        const value = enabled ? 'auto' : ''
        for (const page of this.#scrollPages) {
            if (page.frame?.iframe) {
                page.frame.iframe.style.pointerEvents = value
            }
        }
    }
    #destroyScrollMode() {
        // Use the cached scroll index because by the time attributeChangedCallback
        // fires, the CSS has already switched from block/scroll to flex layout,
        // making #getScrollIndex() return incorrect positions
        const currentIndex = this.#scrollCurrentIndex >= 0
            ? this.#scrollCurrentIndex : this.#getScrollIndex()
        this.removeEventListener('scroll', this.#handleScrollEvent)
        if (this.#scrollObserver) {
            this.#scrollObserver.disconnect()
            this.#scrollObserver = null
        }
        if (this.#scrollIdleTimer) {
            clearTimeout(this.#scrollIdleTimer)
            this.#scrollIdleTimer = null
        }
        // Clean up all scroll page frames and overlayers
        for (const page of this.#scrollPages) {
            this.#teardownScrollPage(page)
        }
        this.#scrollPages = []
        this.#scrollLoadGen.clear()
        this.#scrollLoadingCount = 0
        this.#scrollCurrentIndex = -1
        if (this.#scrollContainer) {
            this.#scrollContainer.remove()
            this.#scrollContainer = null
        }

        // Reset scroll position left over from scroll mode
        this.scrollTop = 0
        this.scrollLeft = 0

        // Restore paginated content
        for (const child of Array.from(this.#root.children)) {
            child.style.display = ''
        }

        // Navigate to the page we were on
        if (currentIndex >= 0) {
            const section = this.book.sections[currentIndex]
            if (section) {
                const spread = this.getSpreadOf(section)
                if (spread) {
                    this.#index = -1
                    this.goToSpread(spread.index, spread.side, 'page')
                }
            }
        }
    }
    // Create an iframe directly inside the page placeholder (no reparenting)
    async #createScrollFrame(pageData, srcOption) {
        const srcOptionIsString = typeof srcOption === 'string'
        const src = srcOptionIsString ? srcOption : srcOption?.src
        const data = srcOptionIsString ? null : srcOption?.data
        const onZoom = srcOptionIsString ? null : srcOption?.onZoom

        const element = document.createElement('div')
        element.setAttribute('dir', 'ltr')
        element.style.position = 'relative'
        const iframe = document.createElement('iframe')
        element.append(iframe)
        Object.assign(iframe.style, {
            border: '0',
            display: 'none',
            overflow: 'hidden',
        })
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        iframe.setAttribute('scrolling', 'no')
        iframe.setAttribute('part', 'filter')
        // Place directly in the placeholder — no root append + reparent
        pageData.el.append(element)

        if (!src) return { blank: true, element, iframe }
        return new Promise(resolve => {
            iframe.addEventListener('load', () => {
                const doc = iframe.contentDocument
                iframe.dataset.sectionIndex = pageData.index
                this.dispatchEvent(new CustomEvent('load', { detail: { doc, index: pageData.index } }))
                const { width, height } = getViewport(doc, this.defaultViewport)
                resolve({
                    element, iframe,
                    width: parseFloat(width),
                    height: parseFloat(height),
                    onZoom,
                })
            }, { once: true })
            if (data) {
                iframe.srcdoc = data
            } else {
                iframe.src = src
            }
        })
    }
    async #loadScrollPage(pageData) {
        if (pageData.state !== 'idle') return
        pageData.state = 'loading'
        this.#scrollLoadingCount++

        // Generation counter to detect stale loads
        const gen = (this.#scrollLoadGen.get(pageData.index) || 0) + 1
        this.#scrollLoadGen.set(pageData.index, gen)

        try {
            const src = await pageData.section.load?.()
            // Bail if cancelled or mode changed
            if (this.#scrollLoadGen.get(pageData.index) !== gen || !this.#scrollMode) {
                pageData.state = 'idle'
                return
            }
            // No content for this page: mark terminal so the post-completion
            // reschedule does not re-pick it forever (a visible idle page is
            // always a load candidate).
            if (!src) { pageData.state = 'error'; return }

            const frame = await this.#createScrollFrame(pageData, src)
            // Bail if cancelled during frame creation
            if (this.#scrollLoadGen.get(pageData.index) !== gen || !this.#scrollMode) {
                frame.element?.remove()
                pageData.state = 'idle'
                return
            }

            pageData.frame = frame
            pageData.state = 'loaded'
            const scrollAnchor = this.#captureScrollModeAnchor()
            // Update dimensions from actual page viewport
            if (frame.width && frame.height) {
                pageData.vpWidth = frame.width
                pageData.vpHeight = frame.height
            }
            this.#renderScrollPage(pageData)
            this.#restoreScrollModeAnchor(scrollAnchor)

            // Make the page interactive right away when idle so text selection
            // and taps work without first scrolling. While scrolling, leave it
            // inert (the scroll-settle handler turns it back on) so its pointer
            // handlers can't hijack the native scroll.
            if (!this.#scrolling && !this.#pinching && frame.iframe) {
                frame.iframe.style.pointerEvents = 'auto'
            }

            // Create overlayer
            const doc = frame.iframe.contentDocument
            if (doc) {
                this.dispatchEvent(new CustomEvent('create-overlayer', {
                    detail: {
                        doc, index: pageData.index,
                        attach: overlayer => {
                            this.#overlayers.set(pageData.index, overlayer)
                            frame.element.append(overlayer.element)
                            applyOverlayerViewBox(frame, overlayer)
                        },
                    },
                }))
                // During the brief idle window after scrolling settles the
                // iframe is interactive (pointer-events: auto), so the first
                // wheel tick of a new gesture lands on it. The browser already
                // chains that tick to the host scroller natively (a single
                // smooth scroll, matching the page margins) — so we must NOT
                // scroll the host ourselves here, or the manual scroll stacks
                // on top of the native one and the page jumps twice as far in
                // an instant lurch (readest#4727). Just drop pointer-events so
                // the iframe stops intercepting and the rest of the gesture
                // scrolls the host natively too.
                doc.addEventListener('wheel', () => {
                    this.#setScrollIframeInteraction(false)
                }, { passive: true })
            }
        } catch (e) {
            console.warn('Failed to load scroll page', pageData.index, e)
            // Terminal state: leaving it 'idle' would let the post-completion
            // reschedule retry a persistently failing page in a tight async loop.
            pageData.state = 'error'
        } finally {
            this.#scrollLoadingCount = Math.max(0, this.#scrollLoadingCount - 1)
            // A concurrency slot freed up: pull in the next nearest page (and
            // apply any pending eviction now that this page's state has settled).
            if (this.#scrollMode) this.#scheduleScrollPages()
        }
    }
    // Remove a loaded scroll page's frame and overlayer
    #teardownScrollPage(pageData) {
        // Bump generation to cancel any in-progress load
        const gen = (this.#scrollLoadGen.get(pageData.index) || 0) + 1
        this.#scrollLoadGen.set(pageData.index, gen)

        if (pageData.frame) {
            const idx = pageData.index
            this.#overlayers.delete(idx)
            pageData.frame.element?.remove()
        }
        pageData.frame = null
        pageData.state = 'idle'
    }
    #renderScrollMode() {
        const { width: hostWidth } = this.getBoundingClientRect()
        if (!hostWidth) return
        // Scale the inter-page gap with the zoom so the committed layout matches
        // the pinch preview (which scales the whole container, gaps included).
        this.style.setProperty('--scroll-zoom', String(this.#scaleFactor))
        // A pinch commit restores the viewport-centre anchor (both axes) so the
        // zoom lands exactly where the live preview showed it; every other
        // re-render keeps the reader's vertical position via the top anchor.
        const pinchAnchor = this.#pinchAnchor
        const scrollAnchor = pinchAnchor ? null : this.#captureScrollModeAnchor()
        for (const page of this.#scrollPages) {
            const scale = (hostWidth / page.vpWidth) * this.#scaleFactor
            page.el.style.width = `${page.vpWidth * scale}px`
            page.el.style.height = `${page.vpHeight * scale}px`
            if (page.state === 'loaded' && page.frame) {
                this.#renderScrollPage(page)
            }
        }
        if (pinchAnchor) {
            this.#restorePinchAnchor(pinchAnchor)
            this.#pinchAnchor = null
        } else {
            this.#restoreScrollModeAnchor(scrollAnchor)
        }
    }
    #renderScrollPage(pageData) {
        const { width: hostWidth } = this.getBoundingClientRect()
        if (!hostWidth || !pageData.frame) return
        const { vpWidth: vw, vpHeight: vh, frame } = pageData
        const scale = (hostWidth / vw) * this.#scaleFactor

        if (frame.onZoom) {
            frame.onZoom({ doc: frame.iframe.contentDocument, scale, pageColors: this.#pageColors })
            Object.assign(frame.iframe.style, {
                width: `${vw * scale}px`,
                height: `${vh * scale}px`,
                transform: 'none',
                display: 'block',
            })
        } else {
            Object.assign(frame.iframe.style, {
                width: `${vw}px`,
                height: `${vh}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                display: 'block',
            })
        }
        Object.assign(frame.element.style, {
            width: `${vw * scale}px`,
            height: `${vh * scale}px`,
        })
        // Update placeholder to match actual page dimensions
        pageData.el.style.width = `${vw * scale}px`
        pageData.el.style.height = `${vh * scale}px`

        const overlayer = this.#overlayers.get(pageData.index)
        if (overlayer) {
            Object.assign(overlayer.element.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: `${vw * scale}px`,
                height: `${vh * scale}px`,
            })
            applyOverlayerViewBox(frame, overlayer)
            overlayer.redraw()
        }
    }
    #getScrollIndex() {
        if (!this.#scrollPages.length) return -1
        const hostRect = this.getBoundingClientRect()
        const midY = hostRect.top + hostRect.height / 2
        for (const page of this.#scrollPages) {
            const rect = page.el.getBoundingClientRect()
            if (rect.top <= midY && rect.bottom >= midY) return page.index
        }
        let closest = 0, minDist = Infinity
        for (const page of this.#scrollPages) {
            const rect = page.el.getBoundingClientRect()
            const dist = Math.abs(rect.top + rect.height / 2 - midY)
            if (dist < minDist) { minDist = dist; closest = page.index }
        }
        return closest
    }
    #reportScrollLocation() {
        const index = this.#getScrollIndex()
        if (index < 0) return
        this.#scrollCurrentIndex = index
        this.dispatchEvent(new CustomEvent('relocate', { detail:
            { reason: 'scroll', range: null, index, fraction: 0, size: 1 } }))
    }
    #goLeft() {
        if (this.#center || this.#left?.blank) return
        if (this.#portrait && this.#left?.element?.style?.display === 'none') {
            this.#side = 'left'
            this.#render(this.#side, true)
            this.#reportLocation('page')
            return true
        }
    }
    #goRight() {
        if (this.#center || this.#right?.blank) return
        if (this.#portrait && this.#right?.element?.style?.display === 'none') {
            this.#side = 'right'
            this.#render(this.#side, true)
            this.#reportLocation('page')
            return true
        }
    }
    open(book) {
        this.book = book
        this.defaultViewport = book.rendition?.viewport
        this.rtl = book.dir === 'rtl'

        this.#spread()
        if (this.#scrollMode) this.#initScrollMode()
    }
    #spread(mode) {
        const book = this.book
        const { rendition } = book
        const rtl = this.rtl
        const ltr = !rtl
        this.spread = mode || rendition?.spread

        if (this.spread === 'none')
            this.#spreads = book.sections.map(section => ({ center: section }))
        else this.#spreads = book.sections.reduce((arr, section, i) => {
            const last = arr[arr.length - 1]
            const { pageSpread } = section
            const newSpread = () => {
                const spread = {}
                arr.push(spread)
                return spread
            }
            if (pageSpread === 'center') {
                const spread = last.left || last.right ? newSpread() : last
                spread.center = section
            }
            else if (pageSpread === 'left') {
                const spread = last.center || last.left || ltr && i ? newSpread() : last
                spread.left = section
            }
            else if (pageSpread === 'right') {
                const spread = last.center || last.right || rtl && i ? newSpread() : last
                spread.right = section
            }
            else if (ltr) {
                if (last.center || last.right) newSpread().left = section
                else if (last.left || !i) last.right = section
                else last.left = section
            }
            else {
                if (last.center || last.left) newSpread().right = section
                else if (last.right || !i) last.left = section
                else last.right = section
            }
            return arr
        }, [{}])
    }
    #respread(spreadMode) {
        if (this.#index === -1) return
        const section = this.book.sections[this.index]
        this.#spread(spreadMode)
        const { index } = this.getSpreadOf(section)
        this.#index = -1
        this.#preloadCache.clear()
        for (const frames of this.#prerenderedSpreads.values()) {
            if (frames.center) {
                frames.center.element?.remove()
            } else {
                frames.left?.element?.remove()
                frames.right?.element?.remove()
            }
        }
        this.#prerenderedSpreads.clear()
        this.#spreadAccessTime.clear()
        this.#overlayers.clear()
        this.goToSpread(index, this.rtl ? 'right' : 'left', 'page')
    }
    get index() {
        if (this.#scrollMode) return this.#scrollCurrentIndex >= 0
            ? this.#scrollCurrentIndex : this.#getScrollIndex()
        if (this.#index < 0 || !this.#spreads) return -1
        const spread = this.#spreads[this.#index]
        if (!spread) return -1
        const section = spread.center ?? (this.#side === 'left'
            ? spread.left ?? spread.right : spread.right ?? spread.left)
        return this.book.sections.indexOf(section)
    }
    get pageColors() {
        return this.#pageColors
    }
    set pageColors(value) {
        this.#pageColors = value
        this.#render()
    }
    get scrolled() {
        return this.#scrollMode
    }
    get scrollLocked() {
        return this.#scrollLocked
    }
    set scrollLocked(value) {
        this.#scrollLocked = value
    }
    get isOverflowX() {
        return this.#isOverflowX
    }
    get isOverflowY() {
        return this.#isOverflowY
    }
    get atStart() {
        if (this.#scrollMode) return this.scrollTop <= 0
        return this.#index <= 0
    }
    get atEnd() {
        if (this.#scrollMode) return this.scrollTop + this.clientHeight >= this.scrollHeight - 2
        return this.#index >= this.#spreads.length - 1
    }
    #reportLocation(reason) {
        this.dispatchEvent(new CustomEvent('relocate', { detail:
            { reason, range: null, index: this.index, fraction: 0, size: 1 } }))
    }
    getSpreadOf(section) {
        const spreads = this.#spreads
        for (let index = 0; index < spreads.length; index++) {
            const { left, right, center } = spreads[index]
            if (left === section) return { index, side: 'left' }
            if (right === section) return { index, side: 'right' }
            if (center === section) return { index, side: 'center' }
        }
    }
    async goToSpread(index, side, reason) {
        if (index < 0 || index > this.#spreads.length - 1) return
        if (index === this.#index) {
            this.#render(side)
            return
        }
        this.#index = index
        const spread = this.#spreads[index]
        const cacheKey = `spread-${index}`
        const cached = this.#preloadCache.get(cacheKey)
        if (cached && cached !== 'loading') {
            if (cached.center) {
                const sectionIndex = this.book.sections.indexOf(spread.center)
                await this.#showSpread({ center: { index: sectionIndex, src: cached.center }, spreadIndex: index, side })
            } else {
                const indexL = this.book.sections.indexOf(spread.left)
                const indexR = this.book.sections.indexOf(spread.right)
                const left = { index: indexL, src: cached.left }
                const right = { index: indexR, src: cached.right }
                await this.#showSpread({ left, right, side, spreadIndex: index })
            }
        } else {
            if (spread.center) {
                const sectionIndex = this.book.sections.indexOf(spread.center)
                const src = await spread.center?.load?.()
                await this.#showSpread({ center: { index: sectionIndex, src }, spreadIndex: index, side })
            } else {
                const indexL = this.book.sections.indexOf(spread.left)
                const indexR = this.book.sections.indexOf(spread.right)
                const srcL = await spread.left?.load?.()
                const srcR = await spread.right?.load?.()
                const left = { index: indexL, src: srcL }
                const right = { index: indexR, src: srcR }
                await this.#showSpread({ left, right, side, spreadIndex: index })
            }
        }

        this.#reportLocation(reason)
        this.#preloadNextSpreads()
    }
    #preloadNextSpreads() {
        this.#cleanupPreloadCache()

        if (this.#numPrerenderedSpreads <= 0) return

        const toPreload = []
        const forwardPreloadCount = Math.max(1, this.#numPrerenderedSpreads - 1)
        const backwardPreloadCount = Math.max(0, this.#numPrerenderedSpreads - forwardPreloadCount)
        for (let distance = 1; distance <= forwardPreloadCount; distance++) {
            const forwardIndex = this.#index + distance
            if (forwardIndex >= 0 && forwardIndex < this.#spreads.length) {
                toPreload.push({ index: forwardIndex, direction: 'forward', distance })
            }
        }
        for (let distance = 1; distance <= backwardPreloadCount; distance++) {
            const backwardIndex = this.#index - distance
            if (backwardIndex >= 0 && backwardIndex < this.#spreads.length) {
                toPreload.push({ index: backwardIndex, direction: 'backward', distance })
            }
        }
        for (const { index: targetIndex, direction } of toPreload) {
            const cacheKey = `spread-${targetIndex}`
            if (this.#prerenderedSpreads.has(cacheKey)) continue
            const spread = this.#spreads[targetIndex]
            if (!spread) continue
            this.#preloadQueue.push({ targetIndex, direction, spread, cacheKey })
        }

        this.#processPreloadQueue()
    }

    async #processPreloadQueue() {
        while (this.#preloadQueue.length > 0 && this.#activePreloads < this.#maxConcurrentPreloads) {
            const task = this.#preloadQueue.shift()
            if (!task) break

            const { spread, cacheKey } = task
            this.#preloadCache.set(cacheKey, 'loading')
            this.#activePreloads++
            Promise.resolve().then(async () => {
                try {
                    if (spread.center) {
                        const src = await spread.center?.load?.()
                        this.#preloadCache.set(cacheKey, { center: src })

                        const sectionIndex = this.book.sections.indexOf(spread.center)
                        const frame = await this.#createFrame({ index: sectionIndex, src, detached: true })

                        this.#prerenderedSpreads.set(cacheKey, { center: frame })
                        this.#spreadAccessTime.set(cacheKey, Date.now())
                        if (frame.onZoom) {
                            const doc = frame.iframe.contentDocument
                            frame.onZoom({ doc, scale: this.#totalScaleFactor, pageColors: this.#pageColors })
                        }
                    } else {
                        const srcL = await spread.left?.load?.()
                        const srcR = await spread.right?.load?.()
                        this.#preloadCache.set(cacheKey, { left: srcL, right: srcR })

                        const indexL = this.book.sections.indexOf(spread.left)
                        const indexR = this.book.sections.indexOf(spread.right)
                        const leftFrame = await this.#createFrame({ index: indexL, src: srcL, detached: true })
                        const rightFrame = await this.#createFrame({ index: indexR, src: srcR, detached: true })

                        this.#prerenderedSpreads.set(cacheKey, { left: leftFrame, right: rightFrame })
                        this.#spreadAccessTime.set(cacheKey, Date.now())

                        if (leftFrame.onZoom) {
                            const docL = leftFrame.iframe.contentDocument
                            leftFrame.onZoom({ doc: docL, scale: this.#totalScaleFactor, pageColors: this.#pageColors })
                        }
                        if (rightFrame.onZoom) {
                            const docR = rightFrame.iframe.contentDocument
                            rightFrame.onZoom({ doc: docR, scale: this.#totalScaleFactor, pageColors: this.#pageColors })
                        }
                    }
                } catch {
                    this.#preloadCache.delete(cacheKey)
                    this.#prerenderedSpreads.delete(cacheKey)
                } finally {
                    this.#activePreloads--
                    this.#processPreloadQueue()
                }
            })
        }
    }
    #cleanupPreloadCache() {
        const maxSpreads = this.#maxCachedSpreads
        if (this.#prerenderedSpreads.size <= maxSpreads) {
            return
        }

        const framesByAge = Array.from(this.#prerenderedSpreads.keys())
            .map(key => ({
                key,
                accessTime: this.#spreadAccessTime.get(key) || 0,
            }))
            .sort((a, b) => a.accessTime - b.accessTime)

        const numToRemove = this.#prerenderedSpreads.size - maxSpreads
        const framesToDelete = framesByAge.slice(0, numToRemove).map(item => item.key)

        if (framesToDelete.length > 0) {
            framesToDelete.forEach(key => {
                const frames = this.#prerenderedSpreads.get(key)
                if (frames) {
                    if (frames.center) {
                        this.#removeOverlayerForFrame(frames.center)
                        frames.center.element?.remove()
                    } else {
                        this.#removeOverlayerForFrame(frames.left)
                        this.#removeOverlayerForFrame(frames.right)
                        frames.left?.element?.remove()
                        frames.right?.element?.remove()
                    }
                }

                this.#prerenderedSpreads.delete(key)
                this.#spreadAccessTime.delete(key)
                this.#preloadCache.delete(key)
            })
        }
    }
    #removeOverlayerForFrame(frame) {
        if (!frame?.iframe) return
        const idx = frame.iframe.dataset.sectionIndex != null
            ? parseInt(frame.iframe.dataset.sectionIndex) : undefined
        if (idx != null) this.#overlayers.delete(idx)
    }
    // Drop a frame's overlayer and re-emit create-overlayer so listeners can
    // re-add annotations. Called after a text layer rebuild (e.g. pdf.js
    // onZoom) which invalidates Range objects stored in the overlayer.
    #refreshOverlayerForFrame(frame) {
        if (!frame?.iframe) return
        const index = frame.iframe.dataset.sectionIndex != null
            ? parseInt(frame.iframe.dataset.sectionIndex) : undefined
        if (index == null) return
        const stale = this.#overlayers.get(index)
        if (!stale) return
        // Only refresh for frames currently visible; hidden frames keep their
        // overlayer untouched until they are shown again.
        const isVisible = frame.element?.parentNode
            && frame.element.style.visibility !== 'hidden'
        if (!isVisible) return
        stale.element?.remove()
        this.#overlayers.delete(index)
        const doc = frame.iframe.contentDocument
        if (!doc) return
        this.dispatchEvent(new CustomEvent('create-overlayer', {
            detail: {
                doc, index,
                attach: overlayer => {
                    this.#overlayers.set(index, overlayer)
                    frame.element.append(overlayer.element)
                },
            },
        }))
    }
    async select(target) {
        await this.goTo(target)
        // TODO
    }
    async goTo(target) {
        const resolved = await target
        if (this.#scrollMode) {
            const page = this.#scrollPages[resolved.index]
            if (page) {
                page.el.scrollIntoView()
                this.#scrollCurrentIndex = resolved.index
            }
            return
        }
        const { book } = this
        const section = book.sections[resolved.index]
        if (!section) return
        const { index, side } = this.getSpreadOf(section)
        await this.goToSpread(index, side)
    }
    async next(distance) {
        if (this.#scrollMode) {
            this.scrollBy({ top: distance || this.clientHeight, behavior: 'smooth' })
            return
        }
        const s = this.rtl ? this.#goLeft() : this.#goRight()
        if (!s) return this.goToSpread(this.#index + 1, this.rtl ? 'right' : 'left', 'page')
    }
    async prev(distance) {
        if (this.#scrollMode) {
            this.scrollBy({ top: -(distance || this.clientHeight), behavior: 'smooth' })
            return
        }
        const s = this.rtl ? this.#goRight() : this.#goLeft()
        if (!s) return this.goToSpread(this.#index - 1, this.rtl ? 'left' : 'right', 'page')
    }
    nextSection() {
        if (!this.#scrollMode) return
        const currentIndex = this.#getScrollIndex()
        const nextIndex = Math.min(currentIndex + 1, this.#scrollPages.length - 1)
        this.#scrollPages[nextIndex]?.el.scrollIntoView({ behavior: 'smooth' })
        this.#scrollCurrentIndex = nextIndex
    }
    prevSection() {
        if (!this.#scrollMode) return
        const currentIndex = this.#getScrollIndex()
        const prevIndex = Math.max(currentIndex - 1, 0)
        this.#scrollPages[prevIndex]?.el.scrollIntoView({ behavior: 'smooth' })
        this.#scrollCurrentIndex = prevIndex
    }
    async pan(dx, dy) {
        if (this.#scrollMode) {
            this.scrollBy({ top: dy, left: dx, behavior: 'auto' })
            return
        }
        if (this.#scrollLocked) return
        this.#scrollLocked = true

        const transform = frame => {
            let { element, iframe } = frame
            if (!iframe || !element) return

            const scrollableContainer = element.parentNode.host
            scrollableContainer.scrollLeft += dx
            scrollableContainer.scrollTop += dy
        }

        transform(this.#center ?? this.#right ?? {})
        this.#scrollLocked = false
    }
    getContents() {
        if (this.#scrollMode) {
            return this.#scrollPages
                .filter(p => p.state === 'loaded' && p.frame?.iframe)
                .map(p => ({
                    doc: p.frame.iframe.contentDocument,
                    index: p.index,
                    overlayer: this.#overlayers.get(p.index),
                }))
        }
        return Array.from(this.#root.querySelectorAll('iframe'))
            .filter(frame => {
                const parent = frame.parentElement
                return parent && parent.style.visibility !== 'hidden'
            })
            .map(frame => {
                const index = frame.dataset.sectionIndex != null
                    ? parseInt(frame.dataset.sectionIndex) : undefined
                return {
                    doc: frame.contentDocument,
                    index,
                    overlayer: index != null ? this.#overlayers.get(index) : undefined,
                }
            })
    }
    pinchZoom(ratio) {
        // Scroll mode: scale the whole scroll container so the zoom tracks the
        // fingers live, anchored at the viewport centre. Suppress paging and
        // snapshot the centre anchor on the first move so the layout stays still
        // and the commit lands exactly where the preview shows.
        if (this.#scrollMode) {
            if (this.#scrollContainer) {
                // Suppress paging so the layout can't drift mid-pinch.
                this.#pinching = true
                const { transform, transformOrigin } = computeScrollPinchTransform({
                    ratio,
                    scrollLeft: this.scrollLeft,
                    scrollTop: this.scrollTop,
                    viewportWidth: this.clientWidth,
                    viewportHeight: this.clientHeight,
                })
                this.#scrollContainer.style.transformOrigin = transformOrigin
                this.#scrollContainer.style.transform = transform
            }
            return
        }
        const frames = this.#center
            ? [this.#center]
            : [this.#left, this.#right]
        for (const frame of frames) {
            if (!frame?.element || frame.element.style.visibility === 'hidden') continue
            frame.element.style.transform = `scale(${ratio})`
            frame.element.style.transformOrigin = 'center'
        }
    }
    pinchEnd() {
        if (this.#scrollMode) {
            // Snapshot the centre page's on-screen rect from the still-scaled
            // preview, then drop the transform and resume paging. The committed
            // zoom (scale-factor) re-renders the pages and #renderScrollMode
            // scrolls that page back to this rect, so the zoom doesn't jump.
            this.#pinching = false
            if (this.#scrollContainer) {
                this.#pinchAnchor = this.#captureCenterPageRect()
                this.#scrollContainer.style.removeProperty('transform')
                this.#scrollContainer.style.removeProperty('transform-origin')
            }
            return
        }
        // Paginated: snapshot the spread's on-screen rect from the still-scaled
        // preview so the committed zoom (#render) can scroll it back to the same
        // spot instead of re-centring and jumping.
        const shown = this.#center ?? this.#left ?? this.#right
        if (shown?.element) {
            const b = shown.element.getBoundingClientRect()
            this.#pinchAnchor = { top: b.top, left: b.left }
        }
        for (const frame of [this.#center, this.#left, this.#right]) {
            if (!frame?.element) continue
            frame.element.style.removeProperty('transform')
            frame.element.style.removeProperty('transform-origin')
        }
    }
    get size() {
        return this.clientHeight
    }
    get viewSize() {
        return this.#scrollMode ? this.scrollHeight : this.clientHeight
    }
    get start() {
        return this.#scrollMode ? this.scrollTop : 0
    }
    get end() {
        return this.#scrollMode ? this.scrollTop + this.clientHeight : this.clientHeight
    }
    get page() {
        if (this.#scrollMode) return this.#scrollCurrentIndex >= 0
            ? this.#scrollCurrentIndex : this.#getScrollIndex()
        return this.#index
    }
    get pages() {
        if (this.#scrollMode) return this.#scrollPages.length
        return this.#spreads?.length ?? 0
    }
    get containerPosition() {
        // In scroll mode the element itself scrolls (see atEnd/start/viewSize,
        // which all read scrollTop). Paginated fixed layout pages via spreads and
        // has no meaningful scroll offset, so keep returning 0 there.
        return this.#scrollMode ? this.scrollTop : 0
    }
    set containerPosition(newVal) {
        // Mirror the paginator's read/write containerPosition contract so relative
        // scroll consumers (auto scroll, middle-click autoscroll) work on scrolled
        // fixed-layout books (PDF / CBZ / fixed EPUB) instead of throwing on a
        // getter-only property (READEST-11). No-op when paginated.
        if (this.#scrollMode) this.scrollTop = newVal
    }
    get sideProp() {
        return this.#scrollMode ? 'height' : 'width'
    }
    destroy() {
        this.#observer.unobserve(this)
        if (this.#scrollMode) {
            this.removeEventListener('scroll', this.#handleScrollEvent)
            if (this.#scrollObserver) {
                this.#scrollObserver.disconnect()
                this.#scrollObserver = null
            }
            if (this.#scrollIdleTimer) {
                clearTimeout(this.#scrollIdleTimer)
                this.#scrollIdleTimer = null
            }
            for (const page of this.#scrollPages) {
                this.#teardownScrollPage(page)
            }
            this.#scrollPages = []
            this.#scrollLoadGen.clear()
            this.#scrollLoadingCount = 0
            if (this.#scrollContainer) {
                this.#scrollContainer.remove()
                this.#scrollContainer = null
            }
        }
        for (const frames of this.#prerenderedSpreads.values()) {
            if (frames.center) {
                frames.center.element?.remove()
            } else {
                frames.left?.element?.remove()
                frames.right?.element?.remove()
            }
        }
        this.#prerenderedSpreads.clear()
        this.#preloadCache.clear()
        this.#spreadAccessTime.clear()
        this.#overlayers.clear()
    }
}

customElements.define('foliate-fxl', FixedLayout)
