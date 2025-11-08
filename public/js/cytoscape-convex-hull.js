(() => {
  function monotoneChain(points) {
    if (points.length <= 1) {
      return points.slice();
    }

    const sorted = points.slice().sort((a, b) => {
      if (a.x === b.x) {
        return a.y - b.y;
      }
      return a.x - b.x;
    });

    const cross = (o, a, b) => ((a.x - o.x) * (b.y - o.y)) - ((a.y - o.y) * (b.x - o.x));

    const lower = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }

    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const point = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }

    upper.pop();
    lower.pop();

    return lower.concat(upper);
  }

  function polygonOrientation(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      sum += (current.x * next.y) - (next.x * current.y);
    }
    return sum / 2;
  }

  function buildHullSegments(points, radius) {
    if (!Array.isArray(points) || points.length < 3 || !radius || radius <= 0) {
      return null;
    }

    const orientation = polygonOrientation(points);
    const clockwise = orientation < 0;
    const segments = [];
    const count = points.length;

    for (let i = 0; i < count; i += 1) {
      const prev = points[(i - 1 + count) % count];
      const current = points[i];
      const next = points[(i + 1) % count];

      const prevVec = {
        x: current.x - prev.x,
        y: current.y - prev.y
      };
      const nextVec = {
        x: next.x - current.x,
        y: next.y - current.y
      };

      const prevLen = Math.hypot(prevVec.x, prevVec.y) || 1;
      const nextLen = Math.hypot(nextVec.x, nextVec.y) || 1;

      const prevUnit = { x: prevVec.x / prevLen, y: prevVec.y / prevLen };
      const nextUnit = { x: nextVec.x / nextLen, y: nextVec.y / nextLen };

      const normalFor = ({ x, y }) => (clockwise ? { x: -y, y: x } : { x: y, y: -x });

      const prevNormal = normalFor(prevUnit);
      const nextNormal = normalFor(nextUnit);

      const prevNormalLen = Math.hypot(prevNormal.x, prevNormal.y) || 1;
      const nextNormalLen = Math.hypot(nextNormal.x, nextNormal.y) || 1;

      const normalizedPrevNormal = {
        x: prevNormal.x / prevNormalLen,
        y: prevNormal.y / prevNormalLen
      };
      const normalizedNextNormal = {
        x: nextNormal.x / nextNormalLen,
        y: nextNormal.y / nextNormalLen
      };

      const startPoint = {
        x: current.x + normalizedPrevNormal.x * radius,
        y: current.y + normalizedPrevNormal.y * radius
      };

      const endPoint = {
        x: current.x + normalizedNextNormal.x * radius,
        y: current.y + normalizedNextNormal.y * radius
      };

      segments.push({
        anchor: current.anchor ? { ...current.anchor } : { x: current.x, y: current.y },
        startPoint,
        endPoint
      });
    }

    return {
      radius,
      clockwise,
      segments
    };
  }

  function drawHullPath(ctx, hullData) {
    if (!hullData || !hullData.segments?.length || !hullData.radius) {
      return;
    }

    const { segments, radius, clockwise } = hullData;
    ctx.beginPath();

    const first = segments[0];
    ctx.moveTo(first.startPoint.x, first.startPoint.y);

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (i > 0) {
        ctx.lineTo(segment.startPoint.x, segment.startPoint.y);
      }

      const anchor = segment.anchor;
      let startAngle = Math.atan2(segment.startPoint.y - anchor.y, segment.startPoint.x - anchor.x);
      let endAngle = Math.atan2(segment.endPoint.y - anchor.y, segment.endPoint.x - anchor.x);

      if (clockwise) {
        while (endAngle >= startAngle) {
          endAngle -= Math.PI * 2;
        }
        ctx.arc(anchor.x, anchor.y, radius, startAngle, endAngle, true);
      } else {
        while (endAngle <= startAngle) {
          endAngle += Math.PI * 2;
        }
        ctx.arc(anchor.x, anchor.y, radius, startAngle, endAngle, false);
      }
    }

    ctx.closePath();
  }

  class ConvexHullPath {
    constructor(plugin, nodes, options = {}) {
      this.plugin = plugin;
      this.nodes = nodes;
      this.options = {
        padding: options.padding ?? plugin.options.padding,
        fill: options.fill ?? plugin.options.fill,
        stroke: options.stroke ?? plugin.options.stroke,
        lineWidth: options.lineWidth ?? plugin.options.lineWidth,
        minPoints: options.minPoints ?? plugin.options.minPoints,
        cornerRadius: options.cornerRadius ?? plugin.options.cornerRadius
      };
      this.boundUpdate = () => this.plugin.render();
      nodes.on('position', this.boundUpdate);
      nodes.on('add remove', this.boundUpdate);
    }

    getHullPoints() {
      const rawPoints = [];
      this.nodes.forEach(node => {
        if (!node || typeof node.position !== 'function') return;
        const pos = node.position(); // Use model coordinates
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          rawPoints.push({ x: pos.x, y: pos.y, anchor: { x: pos.x, y: pos.y } });
        }
      });

      if (rawPoints.length < Math.max(3, this.options.minPoints)) {
        return null;
      }

      const hull = monotoneChain(rawPoints);
      const effectiveRadius = Math.max(this.options.cornerRadius || 0, this.options.padding || 0);
      return buildHullSegments(hull, effectiveRadius);
    }

    destroy() {
      this.nodes.off('position', this.boundUpdate);
      this.nodes.off('add remove', this.boundUpdate);
    }
  }

  class ConvexHullPlugin {
    constructor(cy, options = {}) {
      this.cy = cy;
      this.options = {
        fill: 'rgba(56, 189, 248, 0.15)',
        stroke: '#38bdf8',
        lineWidth: 2,
        padding: 32,
        minPoints: 3,
        cornerRadius: 20,
        ...options
      };
      this.paths = new Set();
      this.pixelRatio = window.devicePixelRatio || 1;
      this.container = cy.container();

      this.canvas = document.createElement('canvas');
      this.canvas.classList.add('cy-convex-hull-layer');
      Object.assign(this.canvas.style, {
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 2
      });
      this.container.appendChild(this.canvas);

      this.ctx = this.canvas.getContext('2d');
      this.resizeHandler = () => this.resize();
      this.viewportHandler = () => this.render();
      cy.on('pan zoom', this.viewportHandler);
      cy.on('resize', this.resizeHandler);
      cy.one('destroy', () => this.destroy());

      this.resize();
    }

    addPath(nodes, options = {}) {
      const collection = this.cy.collection(nodes);
      if (!collection || collection.length === 0) {
        return null;
      }
      const path = new ConvexHullPath(this, collection, options);
      this.paths.add(path);
      this.render();
      return path;
    }

    removePath(path) {
      if (!path || !this.paths.has(path)) {
        return false;
      }
      path.destroy();
      this.paths.delete(path);
      this.render();
      return true;
    }

    clear() {
      for (const path of this.paths) {
        path.destroy();
      }
      this.paths.clear();
      this.render();
    }

    resize() {
      if (!this.canvas || !this.ctx) {
        return;
      }
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.pixelRatio = window.devicePixelRatio || 1;

      this.canvas.width = width * this.pixelRatio;
      this.canvas.height = height * this.pixelRatio;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;

      this.render();
    }

    render() {
      if (!this.ctx) return;

      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();

      ctx.save();
      ctx.scale(this.pixelRatio, this.pixelRatio);

      // Apply Cytoscape viewport transformation
      const zoom = this.cy.zoom();
      const pan = this.cy.pan();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (const path of this.paths) {
        const hullData = path.getHullPoints();
        if (!hullData?.segments || hullData.segments.length < 3) continue;

        drawHullPath(ctx, hullData);

        ctx.fillStyle = path.options.fill;
        ctx.strokeStyle = path.options.stroke;
        ctx.lineWidth = path.options.lineWidth;
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }

    destroy() {
      this.cy.off('pan zoom', this.viewportHandler);
      this.cy.off('resize', this.resizeHandler);
      this.clear();
      if (this.canvas?.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      this.ctx = null;
    }
  }

  function convexHulls(options = {}) {
    return new ConvexHullPlugin(this, options);
  }

  function register(cytoscape) {
    if (!cytoscape) {
      return;
    }
    cytoscape('core', 'convexHulls', convexHulls);
  }

  if (typeof window !== 'undefined' && window.cytoscape) {
    register(window.cytoscape);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = register;
  } else {
    window.CytoscapeConvexHulls = register;
  }
})();
