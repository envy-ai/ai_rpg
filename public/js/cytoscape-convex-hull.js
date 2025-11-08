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

  function inflateHull(points, padding) {
    if (!padding || padding <= 0 || !points.length) {
      return points.slice();
    }

    const centroid = points.reduce((acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    }, { x: 0, y: 0 });
    centroid.x /= points.length;
    centroid.y /= points.length;

    return points.map(point => {
      const dx = point.x - centroid.x;
      const dy = point.y - centroid.y;
      const len = Math.hypot(dx, dy) || 1;
      return {
        x: point.x + ((dx / len) * padding),
        y: point.y + ((dy / len) * padding)
      };
    });
  }

  function drawRoundedPolygon(ctx, points, radius) {
    if (!Array.isArray(points) || points.length === 0) {
      return;
    }
    if (!radius || radius <= 0 || points.length < 3) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      return;
    }

    const count = points.length;
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const prev = points[(i - 1 + count) % count];
      const current = points[i];
      const next = points[(i + 1) % count];

      const prevVector = { x: current.x - prev.x, y: current.y - prev.y };
      const nextVector = { x: next.x - current.x, y: next.y - current.y };

      const prevLength = Math.hypot(prevVector.x, prevVector.y) || 1;
      const nextLength = Math.hypot(nextVector.x, nextVector.y) || 1;

      const prevUnit = { x: prevVector.x / prevLength, y: prevVector.y / prevLength };
      const nextUnit = { x: nextVector.x / nextLength, y: nextVector.y / nextLength };

      const cornerRadius = Math.min(radius, prevLength / 2, nextLength / 2);

      const startPoint = {
        x: current.x - prevUnit.x * cornerRadius,
        y: current.y - prevUnit.y * cornerRadius
      };

      const endPoint = {
        x: current.x + nextUnit.x * cornerRadius,
        y: current.y + nextUnit.y * cornerRadius
      };

      if (i === 0) {
        ctx.moveTo(startPoint.x, startPoint.y);
      } else {
        ctx.lineTo(startPoint.x, startPoint.y);
      }

      ctx.quadraticCurveTo(current.x, current.y, endPoint.x, endPoint.y);
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
          rawPoints.push({ x: pos.x, y: pos.y });
        }
      });

      if (rawPoints.length < Math.max(3, this.options.minPoints)) {
        return null;
      }

      const hull = monotoneChain(rawPoints);
      return inflateHull(hull, this.options.padding);
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
        const hullPoints = path.getHullPoints();
        if (!hullPoints || hullPoints.length < 3) continue;

        drawRoundedPolygon(ctx, hullPoints, path.options.cornerRadius);

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
