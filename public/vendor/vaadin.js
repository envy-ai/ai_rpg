// node_modules/@vaadin/component-base/src/define.js
window.Vaadin ||= {};
window.Vaadin.featureFlags ||= {};
function dashToCamelCase(dash) {
  return dash.replace(/-[a-z]/gu, (m2) => m2[1].toUpperCase());
}
var experimentalMap = {};
function defineCustomElement(CustomElement, version2 = "24.8.7") {
  Object.defineProperty(CustomElement, "version", {
    get() {
      return version2;
    }
  });
  if (CustomElement.experimental) {
    const featureFlagKey = typeof CustomElement.experimental === "string" ? CustomElement.experimental : `${dashToCamelCase(CustomElement.is.split("-").slice(1).join("-"))}Component`;
    if (!window.Vaadin.featureFlags[featureFlagKey] && !experimentalMap[featureFlagKey]) {
      experimentalMap[featureFlagKey] = /* @__PURE__ */ new Set();
      experimentalMap[featureFlagKey].add(CustomElement);
      Object.defineProperty(window.Vaadin.featureFlags, featureFlagKey, {
        get() {
          return experimentalMap[featureFlagKey].size === 0;
        },
        set(value) {
          if (!!value && experimentalMap[featureFlagKey].size > 0) {
            experimentalMap[featureFlagKey].forEach((elementClass) => {
              customElements.define(elementClass.is, elementClass);
            });
            experimentalMap[featureFlagKey].clear();
          }
        }
      });
      return;
    } else if (experimentalMap[featureFlagKey]) {
      experimentalMap[featureFlagKey].add(CustomElement);
      return;
    }
  }
  const defined = customElements.get(CustomElement.is);
  if (!defined) {
    customElements.define(CustomElement.is, CustomElement);
  } else {
    const definedVersion = defined.version;
    if (definedVersion && CustomElement.version && definedVersion === CustomElement.version) {
      console.warn(`The component ${CustomElement.is} has been loaded twice`);
    } else {
      console.error(
        `Tried to define ${CustomElement.is} version ${CustomElement.version} when version ${defined.version} is already in use. Something will probably break.`
      );
    }
  }
}

// node_modules/@vaadin/vaadin-lumo-styles/version.js
var Lumo = class extends HTMLElement {
  static get is() {
    return "vaadin-lumo-styles";
  }
};
defineCustomElement(Lumo);

// node_modules/@lit/reactive-element/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t3, e4, o5) {
    if (this._$cssResult$ = true, o5 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t3, this.t = e4;
  }
  get styleSheet() {
    let t3 = this.o;
    const s4 = this.t;
    if (e && void 0 === t3) {
      const e4 = void 0 !== s4 && 1 === s4.length;
      e4 && (t3 = o.get(s4)), void 0 === t3 && ((this.o = t3 = new CSSStyleSheet()).replaceSync(this.cssText), e4 && o.set(s4, t3));
    }
    return t3;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t3) => new n("string" == typeof t3 ? t3 : t3 + "", void 0, s);
var i = (t3, ...e4) => {
  const o5 = 1 === t3.length ? t3[0] : e4.reduce(((e5, s4, o6) => e5 + ((t4) => {
    if (true === t4._$cssResult$) return t4.cssText;
    if ("number" == typeof t4) return t4;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t4 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s4) + t3[o6 + 1]), t3[0]);
  return new n(o5, t3, s);
};
var S = (s4, o5) => {
  if (e) s4.adoptedStyleSheets = o5.map(((t3) => t3 instanceof CSSStyleSheet ? t3 : t3.styleSheet));
  else for (const e4 of o5) {
    const o6 = document.createElement("style"), n4 = t.litNonce;
    void 0 !== n4 && o6.setAttribute("nonce", n4), o6.textContent = e4.cssText, s4.appendChild(o6);
  }
};
var c = e ? (t3) => t3 : (t3) => t3 instanceof CSSStyleSheet ? ((t4) => {
  let e4 = "";
  for (const s4 of t4.cssRules) e4 += s4.cssText;
  return r(e4);
})(t3) : t3;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t3, s4) => t3;
var u = { toAttribute(t3, s4) {
  switch (s4) {
    case Boolean:
      t3 = t3 ? l : null;
      break;
    case Object:
    case Array:
      t3 = null == t3 ? t3 : JSON.stringify(t3);
  }
  return t3;
}, fromAttribute(t3, s4) {
  let i5 = t3;
  switch (s4) {
    case Boolean:
      i5 = null !== t3;
      break;
    case Number:
      i5 = null === t3 ? null : Number(t3);
      break;
    case Object:
    case Array:
      try {
        i5 = JSON.parse(t3);
      } catch (t4) {
        i5 = null;
      }
  }
  return i5;
} };
var f = (t3, s4) => !i2(t3, s4);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ??= Symbol("metadata"), a.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y = class extends HTMLElement {
  static addInitializer(t3) {
    this._$Ei(), (this.l ??= []).push(t3);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t3, s4 = b) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t3) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t3, s4), !s4.noAccessor) {
      const i5 = Symbol(), h3 = this.getPropertyDescriptor(t3, i5, s4);
      void 0 !== h3 && e2(this.prototype, t3, h3);
    }
  }
  static getPropertyDescriptor(t3, s4, i5) {
    const { get: e4, set: r4 } = h(this.prototype, t3) ?? { get() {
      return this[s4];
    }, set(t4) {
      this[s4] = t4;
    } };
    return { get: e4, set(s5) {
      const h3 = e4?.call(this);
      r4?.call(this, s5), this.requestUpdate(t3, h3, i5);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t3) {
    return this.elementProperties.get(t3) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t3 = n2(this);
    t3.finalize(), void 0 !== t3.l && (this.l = [...t3.l]), this.elementProperties = new Map(t3.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t4 = this.properties, s4 = [...r2(t4), ...o2(t4)];
      for (const i5 of s4) this.createProperty(i5, t4[i5]);
    }
    const t3 = this[Symbol.metadata];
    if (null !== t3) {
      const s4 = litPropertyMetadata.get(t3);
      if (void 0 !== s4) for (const [t4, i5] of s4) this.elementProperties.set(t4, i5);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t4, s4] of this.elementProperties) {
      const i5 = this._$Eu(t4, s4);
      void 0 !== i5 && this._$Eh.set(i5, t4);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i5 = [];
    if (Array.isArray(s4)) {
      const e4 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e4) i5.unshift(c(s5));
    } else void 0 !== s4 && i5.push(c(s4));
    return i5;
  }
  static _$Eu(t3, s4) {
    const i5 = s4.attribute;
    return false === i5 ? void 0 : "string" == typeof i5 ? i5 : "string" == typeof t3 ? t3.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise(((t3) => this.enableUpdating = t3)), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach(((t3) => t3(this)));
  }
  addController(t3) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t3), void 0 !== this.renderRoot && this.isConnected && t3.hostConnected?.();
  }
  removeController(t3) {
    this._$EO?.delete(t3);
  }
  _$E_() {
    const t3 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i5 of s4.keys()) this.hasOwnProperty(i5) && (t3.set(i5, this[i5]), delete this[i5]);
    t3.size > 0 && (this._$Ep = t3);
  }
  createRenderRoot() {
    const t3 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t3, this.constructor.elementStyles), t3;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach(((t3) => t3.hostConnected?.()));
  }
  enableUpdating(t3) {
  }
  disconnectedCallback() {
    this._$EO?.forEach(((t3) => t3.hostDisconnected?.()));
  }
  attributeChangedCallback(t3, s4, i5) {
    this._$AK(t3, i5);
  }
  _$ET(t3, s4) {
    const i5 = this.constructor.elementProperties.get(t3), e4 = this.constructor._$Eu(t3, i5);
    if (void 0 !== e4 && true === i5.reflect) {
      const h3 = (void 0 !== i5.converter?.toAttribute ? i5.converter : u).toAttribute(s4, i5.type);
      this._$Em = t3, null == h3 ? this.removeAttribute(e4) : this.setAttribute(e4, h3), this._$Em = null;
    }
  }
  _$AK(t3, s4) {
    const i5 = this.constructor, e4 = i5._$Eh.get(t3);
    if (void 0 !== e4 && this._$Em !== e4) {
      const t4 = i5.getPropertyOptions(e4), h3 = "function" == typeof t4.converter ? { fromAttribute: t4.converter } : void 0 !== t4.converter?.fromAttribute ? t4.converter : u;
      this._$Em = e4;
      const r4 = h3.fromAttribute(s4, t4.type);
      this[e4] = r4 ?? this._$Ej?.get(e4) ?? r4, this._$Em = null;
    }
  }
  requestUpdate(t3, s4, i5) {
    if (void 0 !== t3) {
      const e4 = this.constructor, h3 = this[t3];
      if (i5 ??= e4.getPropertyOptions(t3), !((i5.hasChanged ?? f)(h3, s4) || i5.useDefault && i5.reflect && h3 === this._$Ej?.get(t3) && !this.hasAttribute(e4._$Eu(t3, i5)))) return;
      this.C(t3, s4, i5);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t3, s4, { useDefault: i5, reflect: e4, wrapped: h3 }, r4) {
    i5 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t3) && (this._$Ej.set(t3, r4 ?? s4 ?? this[t3]), true !== h3 || void 0 !== r4) || (this._$AL.has(t3) || (this.hasUpdated || i5 || (s4 = void 0), this._$AL.set(t3, s4)), true === e4 && this._$Em !== t3 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t3));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t4) {
      Promise.reject(t4);
    }
    const t3 = this.scheduleUpdate();
    return null != t3 && await t3, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t5, s5] of this._$Ep) this[t5] = s5;
        this._$Ep = void 0;
      }
      const t4 = this.constructor.elementProperties;
      if (t4.size > 0) for (const [s5, i5] of t4) {
        const { wrapped: t5 } = i5, e4 = this[s5];
        true !== t5 || this._$AL.has(s5) || void 0 === e4 || this.C(s5, void 0, i5, e4);
      }
    }
    let t3 = false;
    const s4 = this._$AL;
    try {
      t3 = this.shouldUpdate(s4), t3 ? (this.willUpdate(s4), this._$EO?.forEach(((t4) => t4.hostUpdate?.())), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t3 = false, this._$EM(), s5;
    }
    t3 && this._$AE(s4);
  }
  willUpdate(t3) {
  }
  _$AE(t3) {
    this._$EO?.forEach(((t4) => t4.hostUpdated?.())), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t3)), this.updated(t3);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t3) {
    return true;
  }
  update(t3) {
    this._$Eq &&= this._$Eq.forEach(((t4) => this._$ET(t4, this[t4]))), this._$EM();
  }
  updated(t3) {
  }
  firstUpdated(t3) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ??= []).push("2.1.1");

// node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = t2.trustedTypes;
var s2 = i3 ? i3.createPolicy("lit-html", { createHTML: (t3) => t3 }) : void 0;
var e3 = "$lit$";
var h2 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var o3 = "?" + h2;
var n3 = `<${o3}>`;
var r3 = document;
var l2 = () => r3.createComment("");
var c3 = (t3) => null === t3 || "object" != typeof t3 && "function" != typeof t3;
var a2 = Array.isArray;
var u2 = (t3) => a2(t3) || "function" == typeof t3?.[Symbol.iterator];
var d2 = "[ 	\n\f\r]";
var f2 = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var v = /-->/g;
var _ = />/g;
var m = RegExp(`>|${d2}(?:([^\\s"'>=/]+)(${d2}*=${d2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var p2 = /'/g;
var g = /"/g;
var $ = /^(?:script|style|textarea|title)$/i;
var y2 = (t3) => (i5, ...s4) => ({ _$litType$: t3, strings: i5, values: s4 });
var x = y2(1);
var b2 = y2(2);
var w = y2(3);
var T = Symbol.for("lit-noChange");
var E = Symbol.for("lit-nothing");
var A = /* @__PURE__ */ new WeakMap();
var C = r3.createTreeWalker(r3, 129);
function P(t3, i5) {
  if (!a2(t3) || !t3.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== s2 ? s2.createHTML(i5) : i5;
}
var V = (t3, i5) => {
  const s4 = t3.length - 1, o5 = [];
  let r4, l3 = 2 === i5 ? "<svg>" : 3 === i5 ? "<math>" : "", c4 = f2;
  for (let i6 = 0; i6 < s4; i6++) {
    const s5 = t3[i6];
    let a3, u3, d3 = -1, y3 = 0;
    for (; y3 < s5.length && (c4.lastIndex = y3, u3 = c4.exec(s5), null !== u3); ) y3 = c4.lastIndex, c4 === f2 ? "!--" === u3[1] ? c4 = v : void 0 !== u3[1] ? c4 = _ : void 0 !== u3[2] ? ($.test(u3[2]) && (r4 = RegExp("</" + u3[2], "g")), c4 = m) : void 0 !== u3[3] && (c4 = m) : c4 === m ? ">" === u3[0] ? (c4 = r4 ?? f2, d3 = -1) : void 0 === u3[1] ? d3 = -2 : (d3 = c4.lastIndex - u3[2].length, a3 = u3[1], c4 = void 0 === u3[3] ? m : '"' === u3[3] ? g : p2) : c4 === g || c4 === p2 ? c4 = m : c4 === v || c4 === _ ? c4 = f2 : (c4 = m, r4 = void 0);
    const x2 = c4 === m && t3[i6 + 1].startsWith("/>") ? " " : "";
    l3 += c4 === f2 ? s5 + n3 : d3 >= 0 ? (o5.push(a3), s5.slice(0, d3) + e3 + s5.slice(d3) + h2 + x2) : s5 + h2 + (-2 === d3 ? i6 : x2);
  }
  return [P(t3, l3 + (t3[s4] || "<?>") + (2 === i5 ? "</svg>" : 3 === i5 ? "</math>" : "")), o5];
};
var N = class _N {
  constructor({ strings: t3, _$litType$: s4 }, n4) {
    let r4;
    this.parts = [];
    let c4 = 0, a3 = 0;
    const u3 = t3.length - 1, d3 = this.parts, [f3, v2] = V(t3, s4);
    if (this.el = _N.createElement(f3, n4), C.currentNode = this.el.content, 2 === s4 || 3 === s4) {
      const t4 = this.el.content.firstChild;
      t4.replaceWith(...t4.childNodes);
    }
    for (; null !== (r4 = C.nextNode()) && d3.length < u3; ) {
      if (1 === r4.nodeType) {
        if (r4.hasAttributes()) for (const t4 of r4.getAttributeNames()) if (t4.endsWith(e3)) {
          const i5 = v2[a3++], s5 = r4.getAttribute(t4).split(h2), e4 = /([.?@])?(.*)/.exec(i5);
          d3.push({ type: 1, index: c4, name: e4[2], strings: s5, ctor: "." === e4[1] ? H : "?" === e4[1] ? I : "@" === e4[1] ? L : k }), r4.removeAttribute(t4);
        } else t4.startsWith(h2) && (d3.push({ type: 6, index: c4 }), r4.removeAttribute(t4));
        if ($.test(r4.tagName)) {
          const t4 = r4.textContent.split(h2), s5 = t4.length - 1;
          if (s5 > 0) {
            r4.textContent = i3 ? i3.emptyScript : "";
            for (let i5 = 0; i5 < s5; i5++) r4.append(t4[i5], l2()), C.nextNode(), d3.push({ type: 2, index: ++c4 });
            r4.append(t4[s5], l2());
          }
        }
      } else if (8 === r4.nodeType) if (r4.data === o3) d3.push({ type: 2, index: c4 });
      else {
        let t4 = -1;
        for (; -1 !== (t4 = r4.data.indexOf(h2, t4 + 1)); ) d3.push({ type: 7, index: c4 }), t4 += h2.length - 1;
      }
      c4++;
    }
  }
  static createElement(t3, i5) {
    const s4 = r3.createElement("template");
    return s4.innerHTML = t3, s4;
  }
};
function S2(t3, i5, s4 = t3, e4) {
  if (i5 === T) return i5;
  let h3 = void 0 !== e4 ? s4._$Co?.[e4] : s4._$Cl;
  const o5 = c3(i5) ? void 0 : i5._$litDirective$;
  return h3?.constructor !== o5 && (h3?._$AO?.(false), void 0 === o5 ? h3 = void 0 : (h3 = new o5(t3), h3._$AT(t3, s4, e4)), void 0 !== e4 ? (s4._$Co ??= [])[e4] = h3 : s4._$Cl = h3), void 0 !== h3 && (i5 = S2(t3, h3._$AS(t3, i5.values), h3, e4)), i5;
}
var M = class {
  constructor(t3, i5) {
    this._$AV = [], this._$AN = void 0, this._$AD = t3, this._$AM = i5;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t3) {
    const { el: { content: i5 }, parts: s4 } = this._$AD, e4 = (t3?.creationScope ?? r3).importNode(i5, true);
    C.currentNode = e4;
    let h3 = C.nextNode(), o5 = 0, n4 = 0, l3 = s4[0];
    for (; void 0 !== l3; ) {
      if (o5 === l3.index) {
        let i6;
        2 === l3.type ? i6 = new R(h3, h3.nextSibling, this, t3) : 1 === l3.type ? i6 = new l3.ctor(h3, l3.name, l3.strings, this, t3) : 6 === l3.type && (i6 = new z(h3, this, t3)), this._$AV.push(i6), l3 = s4[++n4];
      }
      o5 !== l3?.index && (h3 = C.nextNode(), o5++);
    }
    return C.currentNode = r3, e4;
  }
  p(t3) {
    let i5 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t3, s4, i5), i5 += s4.strings.length - 2) : s4._$AI(t3[i5])), i5++;
  }
};
var R = class _R {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t3, i5, s4, e4) {
    this.type = 2, this._$AH = E, this._$AN = void 0, this._$AA = t3, this._$AB = i5, this._$AM = s4, this.options = e4, this._$Cv = e4?.isConnected ?? true;
  }
  get parentNode() {
    let t3 = this._$AA.parentNode;
    const i5 = this._$AM;
    return void 0 !== i5 && 11 === t3?.nodeType && (t3 = i5.parentNode), t3;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t3, i5 = this) {
    t3 = S2(this, t3, i5), c3(t3) ? t3 === E || null == t3 || "" === t3 ? (this._$AH !== E && this._$AR(), this._$AH = E) : t3 !== this._$AH && t3 !== T && this._(t3) : void 0 !== t3._$litType$ ? this.$(t3) : void 0 !== t3.nodeType ? this.T(t3) : u2(t3) ? this.k(t3) : this._(t3);
  }
  O(t3) {
    return this._$AA.parentNode.insertBefore(t3, this._$AB);
  }
  T(t3) {
    this._$AH !== t3 && (this._$AR(), this._$AH = this.O(t3));
  }
  _(t3) {
    this._$AH !== E && c3(this._$AH) ? this._$AA.nextSibling.data = t3 : this.T(r3.createTextNode(t3)), this._$AH = t3;
  }
  $(t3) {
    const { values: i5, _$litType$: s4 } = t3, e4 = "number" == typeof s4 ? this._$AC(t3) : (void 0 === s4.el && (s4.el = N.createElement(P(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e4) this._$AH.p(i5);
    else {
      const t4 = new M(e4, this), s5 = t4.u(this.options);
      t4.p(i5), this.T(s5), this._$AH = t4;
    }
  }
  _$AC(t3) {
    let i5 = A.get(t3.strings);
    return void 0 === i5 && A.set(t3.strings, i5 = new N(t3)), i5;
  }
  k(t3) {
    a2(this._$AH) || (this._$AH = [], this._$AR());
    const i5 = this._$AH;
    let s4, e4 = 0;
    for (const h3 of t3) e4 === i5.length ? i5.push(s4 = new _R(this.O(l2()), this.O(l2()), this, this.options)) : s4 = i5[e4], s4._$AI(h3), e4++;
    e4 < i5.length && (this._$AR(s4 && s4._$AB.nextSibling, e4), i5.length = e4);
  }
  _$AR(t3 = this._$AA.nextSibling, i5) {
    for (this._$AP?.(false, true, i5); t3 !== this._$AB; ) {
      const i6 = t3.nextSibling;
      t3.remove(), t3 = i6;
    }
  }
  setConnected(t3) {
    void 0 === this._$AM && (this._$Cv = t3, this._$AP?.(t3));
  }
};
var k = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t3, i5, s4, e4, h3) {
    this.type = 1, this._$AH = E, this._$AN = void 0, this.element = t3, this.name = i5, this._$AM = e4, this.options = h3, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = E;
  }
  _$AI(t3, i5 = this, s4, e4) {
    const h3 = this.strings;
    let o5 = false;
    if (void 0 === h3) t3 = S2(this, t3, i5, 0), o5 = !c3(t3) || t3 !== this._$AH && t3 !== T, o5 && (this._$AH = t3);
    else {
      const e5 = t3;
      let n4, r4;
      for (t3 = h3[0], n4 = 0; n4 < h3.length - 1; n4++) r4 = S2(this, e5[s4 + n4], i5, n4), r4 === T && (r4 = this._$AH[n4]), o5 ||= !c3(r4) || r4 !== this._$AH[n4], r4 === E ? t3 = E : t3 !== E && (t3 += (r4 ?? "") + h3[n4 + 1]), this._$AH[n4] = r4;
    }
    o5 && !e4 && this.j(t3);
  }
  j(t3) {
    t3 === E ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t3 ?? "");
  }
};
var H = class extends k {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t3) {
    this.element[this.name] = t3 === E ? void 0 : t3;
  }
};
var I = class extends k {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t3) {
    this.element.toggleAttribute(this.name, !!t3 && t3 !== E);
  }
};
var L = class extends k {
  constructor(t3, i5, s4, e4, h3) {
    super(t3, i5, s4, e4, h3), this.type = 5;
  }
  _$AI(t3, i5 = this) {
    if ((t3 = S2(this, t3, i5, 0) ?? E) === T) return;
    const s4 = this._$AH, e4 = t3 === E && s4 !== E || t3.capture !== s4.capture || t3.once !== s4.once || t3.passive !== s4.passive, h3 = t3 !== E && (s4 === E || e4);
    e4 && this.element.removeEventListener(this.name, this, s4), h3 && this.element.addEventListener(this.name, this, t3), this._$AH = t3;
  }
  handleEvent(t3) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t3) : this._$AH.handleEvent(t3);
  }
};
var z = class {
  constructor(t3, i5, s4) {
    this.element = t3, this.type = 6, this._$AN = void 0, this._$AM = i5, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t3) {
    S2(this, t3);
  }
};
var j = t2.litHtmlPolyfillSupport;
j?.(N, R), (t2.litHtmlVersions ??= []).push("3.3.1");
var B = (t3, i5, s4) => {
  const e4 = s4?.renderBefore ?? i5;
  let h3 = e4._$litPart$;
  if (void 0 === h3) {
    const t4 = s4?.renderBefore ?? null;
    e4._$litPart$ = h3 = new R(i5.insertBefore(l2(), t4), t4, void 0, s4 ?? {});
  }
  return h3._$AI(t3), h3;
};

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t3 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t3.firstChild, t3;
  }
  update(t3) {
    const r4 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t3), this._$Do = B(r4, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return T;
  }
};
i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i4 });
(s3.litElementVersions ??= []).push("4.2.1");

// node_modules/@vaadin/vaadin-themable-mixin/src/css-utils.js
function getEffectiveStyles(component) {
  const componentClass = component.constructor;
  const styleSheet = component.__cssInjectorStyleSheet;
  if (styleSheet) {
    return [...componentClass.baseStyles, styleSheet, ...componentClass.themeStyles];
  }
  return componentClass.elementStyles;
}
function applyInstanceStyles(component) {
  [...component.shadowRoot.querySelectorAll("style")].forEach((style2) => style2.remove());
  S(component.shadowRoot, getEffectiveStyles(component));
}

// node_modules/@vaadin/vaadin-themable-mixin/vaadin-theme-property-mixin.js
var ThemePropertyMixin = (superClass) => class VaadinThemePropertyMixin extends superClass {
  static get properties() {
    return {
      /**
       * Helper property with theme attribute value facilitating propagation
       * in shadow DOM.
       *
       * Enables the component implementation to propagate the `theme`
       * attribute value to the sub-components in Shadow DOM by binding
       * the sub-component's "theme" attribute to the `theme` property of
       * the host.
       *
       * **NOTE:** Extending the mixin only provides the property for binding,
       * and does not make the propagation alone.
       *
       * See [Styling Components: Sub-components](https://vaadin.com/docs/latest/styling/styling-components/#sub-components).
       * page for more information.
       *
       * @protected
       */
      _theme: {
        type: String,
        readOnly: true
      }
    };
  }
  static get observedAttributes() {
    return [...super.observedAttributes, "theme"];
  }
  /** @protected */
  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name === "theme") {
      this._set_theme(newValue);
    }
  }
};

// node_modules/@vaadin/vaadin-themable-mixin/vaadin-themable-mixin.js
var themeRegistry = [];
var themableInstances = /* @__PURE__ */ new Set();
var themableTagNames = /* @__PURE__ */ new Set();
function classHasThemes(elementClass) {
  return elementClass && Object.prototype.hasOwnProperty.call(elementClass, "__themes");
}
function hasThemes(tagName) {
  return classHasThemes(customElements.get(tagName));
}
function flattenStyles(styles = []) {
  return [styles].flat(Infinity).filter((style2) => {
    if (style2 instanceof n) {
      return true;
    }
    console.warn("An item in styles is not of type CSSResult. Use `unsafeCSS` or `css`.");
    return false;
  });
}
function matchesThemeFor(themeFor, tagName) {
  return (themeFor || "").split(" ").some((themeForToken) => {
    return new RegExp(`^${themeForToken.split("*").join(".*")}$`, "u").test(tagName);
  });
}
function getCssText(styles) {
  return styles.map((style2) => style2.cssText).join("\n");
}
var STYLE_ID = "vaadin-themable-mixin-style";
function addStylesToTemplate(styles, template) {
  const styleEl = document.createElement("style");
  styleEl.id = STYLE_ID;
  styleEl.textContent = getCssText(styles);
  template.content.appendChild(styleEl);
}
function updateInstanceStyles(instance) {
  if (!instance.shadowRoot) {
    return;
  }
  const componentClass = instance.constructor;
  if (instance instanceof i4) {
    applyInstanceStyles(instance);
  } else {
    const style2 = instance.shadowRoot.getElementById(STYLE_ID);
    const template = componentClass.prototype._template;
    style2.textContent = template.content.getElementById(STYLE_ID).textContent;
  }
}
function updateInstanceStylesOfType(componentClass) {
  themableInstances.forEach((ref) => {
    const instance = ref.deref();
    if (instance instanceof componentClass) {
      updateInstanceStyles(instance);
    } else if (!instance) {
      themableInstances.delete(ref);
    }
  });
}
function updateComponentStyles(componentClass) {
  if (componentClass.prototype instanceof i4) {
    componentClass.elementStyles = componentClass.finalizeStyles(componentClass.styles);
  } else {
    const template = componentClass.prototype._template;
    template.content.getElementById(STYLE_ID).textContent = getCssText(componentClass.getStylesForThis());
  }
  themableTagNames.forEach((inheritingTagName) => {
    const inheritingClass = customElements.get(inheritingTagName);
    if (inheritingClass !== componentClass && inheritingClass.prototype instanceof componentClass) {
      updateComponentStyles(inheritingClass);
    }
  });
}
function hasMatchingStyle(componentClass, styles) {
  const themes = componentClass.__themes;
  if (!themes || !styles) {
    return false;
  }
  return themes.some(
    (theme) => theme.styles.some((themeStyle) => styles.some((style2) => style2.cssText === themeStyle.cssText))
  );
}
function registerStyles(themeFor, styles, options = {}) {
  styles = flattenStyles(styles);
  if (window.Vaadin && window.Vaadin.styleModules) {
    window.Vaadin.styleModules.registerStyles(themeFor, styles, options);
  } else {
    themeRegistry.push({
      themeFor,
      styles,
      include: options.include,
      moduleId: options.moduleId
    });
  }
  if (themeFor) {
    themableTagNames.forEach((tagName) => {
      if (matchesThemeFor(themeFor, tagName) && hasThemes(tagName)) {
        const componentClass = customElements.get(tagName);
        if (hasMatchingStyle(componentClass, styles)) {
          console.warn(`Registering styles that already exist for ${tagName}`);
        } else if (!window.Vaadin || !window.Vaadin.suppressPostFinalizeStylesWarning) {
          console.warn(
            `The custom element definition for "${tagName}" was finalized before a style module was registered. Ideally, import component specific style modules before importing the corresponding custom element. This warning can be suppressed by setting "window.Vaadin.suppressPostFinalizeStylesWarning = true".`
          );
        }
        updateComponentStyles(componentClass);
        updateInstanceStylesOfType(componentClass);
      }
    });
  }
}
function getAllThemes() {
  if (window.Vaadin && window.Vaadin.styleModules) {
    return window.Vaadin.styleModules.getAllThemes();
  }
  return themeRegistry;
}
function getIncludePriority(moduleName = "") {
  let includePriority = 0;
  if (moduleName.startsWith("lumo-") || moduleName.startsWith("material-")) {
    includePriority = 1;
  } else if (moduleName.startsWith("vaadin-")) {
    includePriority = 2;
  }
  return includePriority;
}
function getIncludedStyles(theme) {
  const includedStyles = [];
  if (theme.include) {
    [].concat(theme.include).forEach((includeModuleId) => {
      const includedTheme = getAllThemes().find((s4) => s4.moduleId === includeModuleId);
      if (includedTheme) {
        includedStyles.push(...getIncludedStyles(includedTheme), ...includedTheme.styles);
      } else {
        console.warn(`Included moduleId ${includeModuleId} not found in style registry`);
      }
    }, theme.styles);
  }
  return includedStyles;
}
function getThemes(tagName) {
  const defaultModuleName = `${tagName}-default-theme`;
  const themes = getAllThemes().filter((theme) => theme.moduleId !== defaultModuleName && matchesThemeFor(theme.themeFor, tagName)).map((theme) => ({
    ...theme,
    // Prepend styles from included themes
    styles: [...getIncludedStyles(theme), ...theme.styles],
    // Map moduleId to includePriority
    includePriority: getIncludePriority(theme.moduleId)
  })).sort((themeA, themeB) => themeB.includePriority - themeA.includePriority);
  if (themes.length > 0) {
    return themes;
  }
  return getAllThemes().filter((theme) => theme.moduleId === defaultModuleName);
}
var ThemableMixin = (superClass) => class VaadinThemableMixin extends ThemePropertyMixin(superClass) {
  constructor() {
    super();
    themableInstances.add(new WeakRef(this));
  }
  /**
   * Covers PolymerElement based component styling
   * @protected
   */
  static finalize() {
    super.finalize();
    if (this.is) {
      themableTagNames.add(this.is);
    }
    if (this.elementStyles) {
      return;
    }
    const template = this.prototype._template;
    if (!template || classHasThemes(this)) {
      return;
    }
    addStylesToTemplate(this.getStylesForThis(), template);
  }
  /**
   * Covers LitElement based component styling
   *
   * @protected
   */
  static finalizeStyles(styles) {
    this.baseStyles = styles ? [styles].flat(Infinity) : [];
    this.themeStyles = this.getStylesForThis();
    return [...this.baseStyles, ...this.themeStyles];
  }
  /**
   * Get styles for the component type
   *
   * @private
   */
  static getStylesForThis() {
    const superClassThemes = superClass.__themes || [];
    const parent = Object.getPrototypeOf(this.prototype);
    const inheritedThemes = (parent ? parent.constructor.__themes : []) || [];
    this.__themes = [...superClassThemes, ...inheritedThemes, ...getThemes(this.is)];
    const themeStyles = this.__themes.flatMap((theme) => theme.styles);
    return themeStyles.filter((style2, index) => index === themeStyles.lastIndexOf(style2));
  }
};

// node_modules/@vaadin/vaadin-themable-mixin/register-styles.js
var addGlobalThemeStyles = (id, ...styles) => {
  const styleTag = document.createElement("style");
  styleTag.id = id;
  styleTag.textContent = styles.map((style2) => style2.toString()).join("\n").replace(":host", "html");
  document.head.insertAdjacentElement("afterbegin", styleTag);
};

// node_modules/@vaadin/vaadin-lumo-styles/global.js
var addLumoGlobalStyles = (id, ...styles) => {
  addGlobalThemeStyles(`lumo-${id}`, styles);
};

// node_modules/@vaadin/vaadin-lumo-styles/color.js
var colorBase = i`
  :host {
    /* Base (background) */
    --lumo-base-color: #fff;

    /* Tint */
    --lumo-tint-5pct: hsla(0, 0%, 100%, 0.3);
    --lumo-tint-10pct: hsla(0, 0%, 100%, 0.37);
    --lumo-tint-20pct: hsla(0, 0%, 100%, 0.44);
    --lumo-tint-30pct: hsla(0, 0%, 100%, 0.5);
    --lumo-tint-40pct: hsla(0, 0%, 100%, 0.57);
    --lumo-tint-50pct: hsla(0, 0%, 100%, 0.64);
    --lumo-tint-60pct: hsla(0, 0%, 100%, 0.7);
    --lumo-tint-70pct: hsla(0, 0%, 100%, 0.77);
    --lumo-tint-80pct: hsla(0, 0%, 100%, 0.84);
    --lumo-tint-90pct: hsla(0, 0%, 100%, 0.9);
    --lumo-tint: #fff;

    /* Shade */
    --lumo-shade-5pct: hsla(214, 61%, 25%, 0.05);
    --lumo-shade-10pct: hsla(214, 57%, 24%, 0.1);
    --lumo-shade-20pct: hsla(214, 53%, 23%, 0.16);
    --lumo-shade-30pct: hsla(214, 50%, 22%, 0.26);
    --lumo-shade-40pct: hsla(214, 47%, 21%, 0.38);
    --lumo-shade-50pct: hsla(214, 45%, 20%, 0.52);
    --lumo-shade-60pct: hsla(214, 43%, 19%, 0.6);
    --lumo-shade-70pct: hsla(214, 42%, 18%, 0.69);
    --lumo-shade-80pct: hsla(214, 41%, 17%, 0.83);
    --lumo-shade-90pct: hsla(214, 40%, 16%, 0.94);
    --lumo-shade: hsl(214, 35%, 15%);

    /* Contrast */
    --lumo-contrast-5pct: var(--lumo-shade-5pct);
    --lumo-contrast-10pct: var(--lumo-shade-10pct);
    --lumo-contrast-20pct: var(--lumo-shade-20pct);
    --lumo-contrast-30pct: var(--lumo-shade-30pct);
    --lumo-contrast-40pct: var(--lumo-shade-40pct);
    --lumo-contrast-50pct: var(--lumo-shade-50pct);
    --lumo-contrast-60pct: var(--lumo-shade-60pct);
    --lumo-contrast-70pct: var(--lumo-shade-70pct);
    --lumo-contrast-80pct: var(--lumo-shade-80pct);
    --lumo-contrast-90pct: var(--lumo-shade-90pct);
    --lumo-contrast: var(--lumo-shade);

    /* Text */
    --lumo-header-text-color: var(--lumo-contrast);
    --lumo-body-text-color: var(--lumo-contrast-90pct);
    --lumo-secondary-text-color: var(--lumo-contrast-70pct);
    --lumo-tertiary-text-color: var(--lumo-contrast-50pct);
    --lumo-disabled-text-color: var(--lumo-contrast-30pct);

    /* Primary */
    --lumo-primary-color: hsl(214, 100%, 48%);
    --lumo-primary-color-50pct: hsla(214, 100%, 49%, 0.76);
    --lumo-primary-color-10pct: hsla(214, 100%, 60%, 0.13);
    --lumo-primary-text-color: hsl(214, 100%, 43%);
    --lumo-primary-contrast-color: #fff;

    /* Error */
    --lumo-error-color: hsl(3, 85%, 48%);
    --lumo-error-color-50pct: hsla(3, 85%, 49%, 0.5);
    --lumo-error-color-10pct: hsla(3, 85%, 49%, 0.1);
    --lumo-error-text-color: hsl(3, 89%, 42%);
    --lumo-error-contrast-color: #fff;

    /* Success */
    --lumo-success-color: hsl(145, 72%, 30%);
    --lumo-success-color-50pct: hsla(145, 72%, 31%, 0.5);
    --lumo-success-color-10pct: hsla(145, 72%, 31%, 0.1);
    --lumo-success-text-color: hsl(145, 85%, 25%);
    --lumo-success-contrast-color: #fff;

    /* Warning */
    --lumo-warning-color: hsl(48, 100%, 50%);
    --lumo-warning-color-10pct: hsla(48, 100%, 50%, 0.25);
    --lumo-warning-text-color: hsl(32, 100%, 30%);
    --lumo-warning-contrast-color: var(--lumo-shade-90pct);
  }

  /* forced-colors mode adjustments */
  @media (forced-colors: active) {
    html {
      --lumo-disabled-text-color: GrayText;
    }
  }
`;
addLumoGlobalStyles("color-props", colorBase);
var color = i`
  [theme~='dark'] {
    /* Base (background) */
    --lumo-base-color: hsl(214, 35%, 21%);

    /* Tint */
    --lumo-tint-5pct: hsla(214, 65%, 85%, 0.06);
    --lumo-tint-10pct: hsla(214, 60%, 80%, 0.14);
    --lumo-tint-20pct: hsla(214, 64%, 82%, 0.23);
    --lumo-tint-30pct: hsla(214, 69%, 84%, 0.32);
    --lumo-tint-40pct: hsla(214, 73%, 86%, 0.41);
    --lumo-tint-50pct: hsla(214, 78%, 88%, 0.5);
    --lumo-tint-60pct: hsla(214, 82%, 90%, 0.58);
    --lumo-tint-70pct: hsla(214, 87%, 92%, 0.69);
    --lumo-tint-80pct: hsla(214, 91%, 94%, 0.8);
    --lumo-tint-90pct: hsla(214, 96%, 96%, 0.9);
    --lumo-tint: hsl(214, 100%, 98%);

    /* Shade */
    --lumo-shade-5pct: hsla(214, 0%, 0%, 0.07);
    --lumo-shade-10pct: hsla(214, 4%, 2%, 0.15);
    --lumo-shade-20pct: hsla(214, 8%, 4%, 0.23);
    --lumo-shade-30pct: hsla(214, 12%, 6%, 0.32);
    --lumo-shade-40pct: hsla(214, 16%, 8%, 0.41);
    --lumo-shade-50pct: hsla(214, 20%, 10%, 0.5);
    --lumo-shade-60pct: hsla(214, 24%, 12%, 0.6);
    --lumo-shade-70pct: hsla(214, 28%, 13%, 0.7);
    --lumo-shade-80pct: hsla(214, 32%, 13%, 0.8);
    --lumo-shade-90pct: hsla(214, 33%, 13%, 0.9);
    --lumo-shade: hsl(214, 33%, 13%);

    /* Contrast */
    --lumo-contrast-5pct: var(--lumo-tint-5pct);
    --lumo-contrast-10pct: var(--lumo-tint-10pct);
    --lumo-contrast-20pct: var(--lumo-tint-20pct);
    --lumo-contrast-30pct: var(--lumo-tint-30pct);
    --lumo-contrast-40pct: var(--lumo-tint-40pct);
    --lumo-contrast-50pct: var(--lumo-tint-50pct);
    --lumo-contrast-60pct: var(--lumo-tint-60pct);
    --lumo-contrast-70pct: var(--lumo-tint-70pct);
    --lumo-contrast-80pct: var(--lumo-tint-80pct);
    --lumo-contrast-90pct: var(--lumo-tint-90pct);
    --lumo-contrast: var(--lumo-tint);

    /* Text */
    --lumo-header-text-color: var(--lumo-contrast);
    --lumo-body-text-color: var(--lumo-contrast-90pct);
    --lumo-secondary-text-color: var(--lumo-contrast-70pct);
    --lumo-tertiary-text-color: var(--lumo-contrast-50pct);
    --lumo-disabled-text-color: var(--lumo-contrast-30pct);

    /* Primary */
    --lumo-primary-color: hsl(214, 90%, 48%);
    --lumo-primary-color-50pct: hsla(214, 90%, 70%, 0.69);
    --lumo-primary-color-10pct: hsla(214, 90%, 55%, 0.13);
    --lumo-primary-text-color: hsl(214, 90%, 77%);
    --lumo-primary-contrast-color: #fff;

    /* Error */
    --lumo-error-color: hsl(3, 79%, 49%);
    --lumo-error-color-50pct: hsla(3, 75%, 62%, 0.5);
    --lumo-error-color-10pct: hsla(3, 75%, 62%, 0.14);
    --lumo-error-text-color: hsl(3, 100%, 80%);

    /* Success */
    --lumo-success-color: hsl(145, 72%, 30%);
    --lumo-success-color-50pct: hsla(145, 92%, 51%, 0.5);
    --lumo-success-color-10pct: hsla(145, 92%, 51%, 0.1);
    --lumo-success-text-color: hsl(145, 85%, 46%);

    /* Warning */
    --lumo-warning-color: hsl(43, 100%, 48%);
    --lumo-warning-color-10pct: hsla(40, 100%, 50%, 0.2);
    --lumo-warning-text-color: hsl(45, 100%, 60%);
    --lumo-warning-contrast-color: var(--lumo-shade-90pct);
  }

  html {
    color: var(--lumo-body-text-color);
    background-color: var(--lumo-base-color);
    color-scheme: light;
  }

  [theme~='dark'] {
    color: var(--lumo-body-text-color);
    background-color: var(--lumo-base-color);
    color-scheme: dark;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    color: var(--lumo-header-text-color);
  }

  a:where(:any-link) {
    color: var(--lumo-primary-text-color);
  }

  a:not(:any-link) {
    color: var(--lumo-disabled-text-color);
  }

  blockquote {
    color: var(--lumo-secondary-text-color);
  }

  code,
  pre {
    background-color: var(--lumo-contrast-10pct);
    border-radius: var(--lumo-border-radius-m);
  }
  pre code {
    background: transparent;
  }
`;
registerStyles("", color, { moduleId: "lumo-color" });

// node_modules/@vaadin/vaadin-lumo-styles/spacing.js
var spacing = i`
  :host {
    /* Square */
    --lumo-space-xs: 0.25rem;
    --lumo-space-s: 0.5rem;
    --lumo-space-m: 1rem;
    --lumo-space-l: 1.5rem;
    --lumo-space-xl: 2.5rem;

    /* Wide */
    --lumo-space-wide-xs: calc(var(--lumo-space-xs) / 2) var(--lumo-space-xs);
    --lumo-space-wide-s: calc(var(--lumo-space-s) / 2) var(--lumo-space-s);
    --lumo-space-wide-m: calc(var(--lumo-space-m) / 2) var(--lumo-space-m);
    --lumo-space-wide-l: calc(var(--lumo-space-l) / 2) var(--lumo-space-l);
    --lumo-space-wide-xl: calc(var(--lumo-space-xl) / 2) var(--lumo-space-xl);

    /* Tall */
    --lumo-space-tall-xs: var(--lumo-space-xs) calc(var(--lumo-space-xs) / 2);
    --lumo-space-tall-s: var(--lumo-space-s) calc(var(--lumo-space-s) / 2);
    --lumo-space-tall-m: var(--lumo-space-m) calc(var(--lumo-space-m) / 2);
    --lumo-space-tall-l: var(--lumo-space-l) calc(var(--lumo-space-l) / 2);
    --lumo-space-tall-xl: var(--lumo-space-xl) calc(var(--lumo-space-xl) / 2);
  }
`;
addLumoGlobalStyles("spacing-props", spacing);

// node_modules/@vaadin/vaadin-lumo-styles/style.js
var style = i`
  :host {
    /* Border radius */
    --lumo-border-radius-s: 0.25em; /* Checkbox, badge, date-picker year indicator, etc */
    --lumo-border-radius-m: var(--lumo-border-radius, 0.25em); /* Button, text field, menu overlay, etc */
    --lumo-border-radius-l: 0.5em; /* Dialog, notification, etc */

    /* Shadow */
    --lumo-box-shadow-xs: 0 1px 4px -1px var(--lumo-shade-50pct);
    --lumo-box-shadow-s: 0 2px 4px -1px var(--lumo-shade-20pct), 0 3px 12px -1px var(--lumo-shade-30pct);
    --lumo-box-shadow-m: 0 2px 6px -1px var(--lumo-shade-20pct), 0 8px 24px -4px var(--lumo-shade-40pct);
    --lumo-box-shadow-l: 0 3px 18px -2px var(--lumo-shade-20pct), 0 12px 48px -6px var(--lumo-shade-40pct);
    --lumo-box-shadow-xl: 0 4px 24px -3px var(--lumo-shade-20pct), 0 18px 64px -8px var(--lumo-shade-40pct);

    /* Clickable element cursor */
    --lumo-clickable-cursor: default;
  }
`;
var globals = i`
  html {
    /* Button */
    --vaadin-button-background: var(--lumo-contrast-5pct);
    --vaadin-button-border: none;
    --vaadin-button-border-radius: var(--lumo-border-radius-m);
    --vaadin-button-font-size: var(--lumo-font-size-m);
    --vaadin-button-font-weight: 500;
    --vaadin-button-height: var(--lumo-size-m);
    --vaadin-button-margin: var(--lumo-space-xs) 0;
    --vaadin-button-min-width: calc(var(--vaadin-button-height) * 2);
    --vaadin-button-padding: 0 calc(var(--vaadin-button-height) / 3 + var(--lumo-border-radius-m) / 2);
    --vaadin-button-text-color: var(--lumo-primary-text-color);
    --vaadin-button-primary-background: var(--lumo-primary-color);
    --vaadin-button-primary-border: none;
    --vaadin-button-primary-font-weight: 600;
    --vaadin-button-primary-text-color: var(--lumo-primary-contrast-color);
    --vaadin-button-tertiary-background: transparent !important;
    --vaadin-button-tertiary-text-color: var(--lumo-primary-text-color);
    --vaadin-button-tertiary-font-weight: 500;
    --vaadin-button-tertiary-padding: 0 calc(var(--vaadin-button-height) / 6);
    /* Checkbox */
    --vaadin-checkbox-background: var(--lumo-contrast-20pct);
    --vaadin-checkbox-background-hover: var(--lumo-contrast-30pct);
    --vaadin-checkbox-border-radius: var(--lumo-border-radius-s);
    --vaadin-checkbox-checkmark-char: var(--lumo-icons-checkmark);
    --vaadin-checkbox-checkmark-char-indeterminate: '';
    --vaadin-checkbox-checkmark-color: var(--lumo-primary-contrast-color);
    --vaadin-checkbox-checkmark-size: calc(var(--vaadin-checkbox-size) + 2px);
    --vaadin-checkbox-label-color: var(--lumo-body-text-color);
    --vaadin-checkbox-label-font-size: var(--lumo-font-size-m);
    --vaadin-checkbox-label-padding: var(--lumo-space-xs) var(--lumo-space-s) var(--lumo-space-xs) var(--lumo-space-xs);
    --vaadin-checkbox-size: calc(var(--lumo-size-m) / 2);
    --vaadin-checkbox-disabled-checkmark-color: var(--lumo-contrast-30pct);
    --vaadin-checkbox-disabled-background: var(--lumo-contrast-10pct);
    /* Radio button */
    --vaadin-radio-button-background: var(--lumo-contrast-20pct);
    --vaadin-radio-button-background-hover: var(--lumo-contrast-30pct);
    --vaadin-radio-button-dot-color: var(--lumo-primary-contrast-color);
    --vaadin-radio-button-dot-size: 3px;
    --vaadin-radio-button-label-color: var(--lumo-body-text-color);
    --vaadin-radio-button-label-font-size: var(--lumo-font-size-m);
    --vaadin-radio-button-label-padding: var(--lumo-space-xs) var(--lumo-space-s) var(--lumo-space-xs)
      var(--lumo-space-xs);
    --vaadin-radio-button-size: calc(var(--lumo-size-m) / 2);
    --vaadin-radio-button-disabled-background: var(--lumo-contrast-10pct);
    --vaadin-radio-button-disabled-dot-color: var(--lumo-contrast-30pct);
    --vaadin-selection-color: var(--lumo-primary-color);
    --vaadin-selection-color-text: var(--lumo-primary-text-color);
    --vaadin-input-field-border-radius: var(--lumo-border-radius-m);
    --vaadin-focus-ring-color: var(--lumo-primary-color-50pct);
    --vaadin-focus-ring-width: 2px;
    /* Label */
    --vaadin-input-field-label-color: var(--lumo-secondary-text-color);
    --vaadin-input-field-focused-label-color: var(--lumo-primary-text-color);
    --vaadin-input-field-hovered-label-color: var(--lumo-body-text-color);
    --vaadin-input-field-label-font-size: var(--lumo-font-size-s);
    --vaadin-input-field-label-font-weight: 500;
    /* Helper */
    --vaadin-input-field-helper-color: var(--lumo-secondary-text-color);
    --vaadin-input-field-helper-font-size: var(--lumo-font-size-xs);
    --vaadin-input-field-helper-font-weight: 400;
    --vaadin-input-field-helper-spacing: 0.4em;
    /* Error message */
    --vaadin-input-field-error-color: var(--lumo-error-text-color);
    --vaadin-input-field-error-font-size: var(--lumo-font-size-xs);
    --vaadin-input-field-error-font-weight: 400;
    /* Input field */
    --vaadin-input-field-background: var(--lumo-contrast-10pct);
    --vaadin-input-field-icon-color: var(--lumo-contrast-60pct);
    --vaadin-input-field-icon-size: var(--lumo-icon-size-m);
    --vaadin-input-field-invalid-background: var(--lumo-error-color-10pct);
    --vaadin-input-field-invalid-hover-highlight: var(--lumo-error-color-50pct);
    --vaadin-input-field-disabled-background: var(--lumo-contrast-5pct);
    --vaadin-input-field-disabled-value-color: var(--lumo-disabled-text-color);
    --vaadin-input-field-height: var(--lumo-size-m);
    --vaadin-input-field-hover-highlight: var(--lumo-contrast-50pct);
    --vaadin-input-field-placeholder-color: var(--lumo-secondary-text-color);
    --vaadin-input-field-readonly-border: 1px dashed var(--lumo-contrast-30pct);
    --vaadin-input-field-value-color: var(--lumo-body-text-color);
    --vaadin-input-field-value-font-size: var(--lumo-font-size-m);
    --vaadin-input-field-value-font-weight: 500;
  }
`;
addLumoGlobalStyles("style-props", style);

// node_modules/@vaadin/vaadin-lumo-styles/font-icons.js
var fontIcons = i`
  @font-face {
    font-family: 'lumo-icons';
    src: url(data:application/font-woff;charset=utf-8;base64,d09GRgABAAAAABHAAAsAAAAAI6AAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABHU1VCAAABCAAAADsAAABUIIslek9TLzIAAAFEAAAAQwAAAFZAIUuNY21hcAAAAYgAAAD+AAADymne8hxnbHlmAAACiAAAC+gAABioIzlOlWhlYWQAAA5wAAAAMAAAADZa/6SsaGhlYQAADqAAAAAdAAAAJAbpA4BobXR4AAAOwAAAABAAAAC0q+AAAGxvY2EAAA7QAAAAXAAAAFyF7o1GbWF4cAAADywAAAAfAAAAIAFMAXBuYW1lAAAPTAAAATEAAAIuUUJZCHBvc3QAABCAAAABPQAAAgfdkltveJxjYGRgYOBiMGCwY2BycfMJYeDLSSzJY5BiYGGAAJA8MpsxJzM9kYEDxgPKsYBpDiBmg4gCACY7BUgAeJxjYGS+xDiBgZWBgamKaQ8DA0MPhGZ8wGDIyAQUZWBlZsAKAtJcUxgcXjG+0mEO+p/FEMUcxDANKMwIkgMABvgMMAB4nO3SV26EMABF0UsZpjG9d6Y3FpgF5StLYxMTP16WEUvHV1gGIQzQAJKgDFKIfojQ+A6rUb2e0KnXU77qPanWq/LzCXOkOVyn9RyHvWl4YkaTFu1wX5ecHn0GDBkxZsKUGXMWLFmxZsOWHXsOFBw5cebClRt3Hjx58dZ7RRn/I9cUF39Xpb691acRG2piOtUqNZ1P1TCdeJUZatNQW4baNtSO6U+ouoaam96u6hlq31AHhjo01JGhjg11YqhTQ50Z6txQF4a6NNSVoa4NdWOoW0PdGereUA+GWhjq0VBPhno21IuhXg31Zqh3Q30Y6tNQX4b6NtTSKH8BOIRpQQAAeJy1WH1sW9UVv+fG9vPz+7Bf/N6zHcd2/J04jbP6s0lap4kDpB9JWzUUCqxNgaHxpTI6hNhUNLVr17HSISb2D2iAJrWb6FTWahNQdQxRvmHamAR0qibE1E18CG3QaVNFvJ17n+3YIf1AiMQ679x77j3v3HPPPed3H7ER/OsYpw8TmQRIiuQJ8RZK+WjO1B3xaCzla21orY10a+OQ6aHTHtP0zB31mBs1GZ6RNU2uXc7oPL+xdRS9R9X1oK4fVfijdsBqvqF6vd1eLzPrYrYZ57WteF7bPDIc5+ZcJnta+S9i2Vfhs4MaMwZNQmO0Vv7gF/MZcNsCcJp4sJFSwYyAmRuFCmTBDRBUkwGqnlViyjmVBpLqaXhNpt0J5V1JOqMkuqn8WkMHvZX+iOlImiqkBiFVYDrCqINulmkwKb8ry2fkZBBn7FcTlk4ZdfpRZ9MOesLSAakKt0N3g4p2jAL8eIEOOqom/U0lgQRXUl8LtXM7HFkojUIpF0ErVBhcZC1vtyjtpsqr83a8RVcSH+ool8LgcIMjNohmVCACuDs506BdO6WIQeXjUsh1XKZGRNpp9piv3+Givoh00OU6KEV81HUHTLtN093Q+YGlE3wLHWRtMNy9XWqdLm2HKbaNsGzhu+41eswFOjE6WKSk2/1Wpt+qHeM6phbohmVmj3GvpdcVkiy9zbXfzHVqKuDB0IR2P6ZpF+D7dy6YC/9svGmBE5hKB9+X2+hh4iYRMkhGyTqyFc9APmeGQHf043tWQKHkizmwaY5AroTNVJzJDc2SFzUu92kOLsdmKu77vByb8/IjtxmhkMFISRBFISO4XMLJlj4XgGuRXtaHw2FLyHifdSOpisIhJjgkiPBAyJh7lfXTkhEadwk1mUngrOC6MazX7mASeEAPV1FyjEumBOaEDu4DP/ogRDKkiLEV1woVyMeLLKJCEM+FwdCwL4XLcRgdbfkhbzS8BNvXDKzNQiAWgOzagTXF1Eyq+Ci6/TPm/JrNY/59p1epKN4jQFGe0fx+LTMwNVCrAU2VSqnaKYzIiGmWe2Rvp9KDJhncrjLaFce8VCUbyQ1kB9lNfkJ+To6R58mfyd/Ip9ABXohDHqqwEW7A2Mij1ehntLu+h8xMtocjUJcYwoLdtYafv/1Vjy8vjLaLtBfOt3/B931Rexa24e5zstgnyqvZHs69zuhq3vFgRpQVJyN7FuE++RLSeW4xMi+t6Zeo5sIK6S5dlGVRD2hWnGoB3j7OV3lesvNLic8tOnLRSRfRdOna63VJp/1WbYs5dFZjy1AqpGICQEWKmNI+CZNoVTJ7pNop+IZkRrBHgnEmqr3TrEsfw1Gi8LqE+S1aV0SNNwXVVVvuUoU3ld6TLwmditIpvKTU50zSzWwO1h0rL8awnulwTXMYrGDT4aQ1fb4GPkyv5vMEh5Vec6yw0AMXnfcx1l/rfVZaKLDi0W4j/HfeyGZuHOf1IUGW1udizU2leXY0OmLpVDpVKJfKpZzPRKHgEBzpXAUKWYipoIeBdl3JfLZVBizEqWun1i4ZGFiyduq3DebayXsmJ+95gBG4+Urm1a2SdpKV57lP2wZyZqI+FAlfUtO+NCmgdWhMOS1gDY+jHWnBhwjBQLMEXxmLbx6t9JXTWDLtsSxgisfErqvQMbbBoywZmeyLeWe8OWNydFDxzMx4lMGRtX0xN3YFJkeW+O0bascGNwwObtjCCOzrzAVWjSwN2K9cpyn9o5cZOXMmkAuM85EbNHnJyHhfLLCnPhxJYw9eoIMkyC3l+4ZuY5ig7lW2oYUynDgg+Xrk+++Xe3zSgRYetnyuy+KbfjiB+GAAtZ8HHXmtijZfFFgrujhmOs2qkXvuSV6WqA1WLYqhPHOfsa26rklKFqbAGL2dOIlGurB6LWFVFd/KoBBaYTFYVBs93hZRFlrG5Ex4NVFIJguJVvqnBW2kNNvFGx90YUcSEvyZSMDeZjc0xYlEYy8+hHcWx9YrZOaPPyCGepP5Q34aXnGBr8d1QhSf4yjtiebZqNJfEYl4SY6dDRb8WSguLZW9ZQtBpoW4hX0QMyB2KmsYcOh8HMQxBn288oZ6BXV0GOq/ClKsC6T8g9X3OFKZNkJrYkOx2lEk+KNDy953+wGHXuGGzhGZ+uLK8FVrQkbtKBv+9EztU2sgTCNpvXMdJjqJ4tkdw+x00dPKkZ1QR254x7GQoFmvfakSnL3gCc5nREly2mN2pyTLMacMipNT7YInGU7JzlN2p9N+yinXTirOKEvPUafSWMNDmCf9pIQYaG19DSxKGqvAQ+xg60iabEm5MheUU2n+HxO4TDDbjnw6xxK8QzfhbHXq8pWVqanKysun9s6ztdt7sivGqruqYyuyPS6Hw9XehGt6q+l0dT0jvaFMZjiTuTHo7+vdtHJTb58/2ML+IxHt9/n9vv5owiWKrrbWD+sakKxhKoYzxF5f7y9INxki42QNuYrVFDPfvqxyY83xWNMV+ZxPSMWb62W+wPSCJwkDDl1WZOGW84nAEo4A7HjB/uWmOdayRFnKjazi668u/ajJlUd87aPk048Crlu4j1Oh9gxdL3Z1inNPIt2xvKNlsU4hn54Z5Y6YbTDu9hHOvkcFAb35fU6hNovKOrtQmcvbNV9/Ntfv5xf4atDWOOTX6CSHZ08xujhPs51+f9zvf1YLIGoPPKvxVh0TSLAXzzUBFiXs7GJVB7vH5/PAXznd4+vx4a95h3qI/oYIpIdMkA1kC7kVLS3GhWI5bwj1fIaVKG/Ei5gXWOjhtcJbzFthaMQrwIcIRj0ppvO6yV95icu9j/YPDNySWp7w+kOr95R1RfGpfVlDVhS/2geJ5Umv2mn0rkxBvzvgdisndJXaVF1X5z5jdHGe2n/QnYo8+b2uaMivhowgjYcLnVqnrEpQezsieyVZ6ooETbdJO6ip+cORLpes6BL82/qg8VHbo45B/vch/YQeJX28QvEANR3sQhxh+TcMCEd4l8BKF7uID7KM05tRYlIHHXY63YIi2fXQyj5XSBbcMeewKLpttkJ2Syz33YJfDdJdSYkqHbYb3VHRJgTV8c0TAy67YHeK7htwOKWax5co7Do8Pfh1tKdx1g5j9o6TZeQyMo27FuW3vbYsbY/Op3AG06DMKionRlpgHzCEeMmLU5opRrCyS670RzppZeW5p/iT3jL3lB4O63QS6dzzh8SAtOqwGJK3bv+lGJTWbr++471wsVKMRJCEK5H+cLg/Qp+IDsdqs7HhKD7hMXyyrD/Li8RjRqimHhI7HP2vSDZn9brplySb0L9dgpURSwmSiBFhilrwB8OA9gZ29NkRO/669parW9e7XZDxwvgRu+SE7zgl+xG5p/HtRqJ3cdwSZwsbwTA1WT3jEdyPN0sWxvDGy+xovIzHosnwc9LePf9tywun0fMkWaFYZbB4oovRq8VyKYUBkMVXqVhBHSylQ0wanvla3+rQ1XbR8ZzstYOo2Mf7vjk8ftcGDWxdSdXx0cAVveHg1TZFtEOn8ntBBFs11V++vuLUQ5qz+U6d/oUjpGIdNjOQhJXNqn5YCS1Yy5PofLGEs6Js2yOKe2yyOLxtaGjbt7cNIURCEDdWfaQ6lurtRYbePCuItv1iUNxvE4Vdw2zQ0LZhdv2fxjHp5uAmdlBpopHXoJGU8e6BRc0yi+PztkaHTRRrW1m2hcfFLlEUzzD+DGczjEVCg9jEQZhFcdAL2DjD+DPiSWQzjM2I89g5RXdxfECS+CIWy1hTGmFs6EIbkv/pbtkfU3aPrZ+4c2Lizn07qufym/L5TTdtyuU2/We3HPeDsjtb3bGPSSfW31aX3LQpX/d9sL7fWYpRJPBbCJavYjrFjj0rT2GWCZjf6Ytffr8beXl/HYeyGwJiIK8FLDHbfo65xGz7YCSRqCQSkbbHI5eUU5X4sjj+zrU9aHnRlEnrd7YGptd0x2Jf/RbH9PAiovadckSnEsJ661OgPFuH9B4O6e202vIN0h9xHXSJh1wRP5Vqv1uI6Wn9Gxmrwzqrii1gqhEscJanuAlGas+s2/uzvetgS72NpHZ6aHbZstmh/wPq1seEeJxjYGRgYADi31ySEvH8Nl8ZuJlfAEUYalQ3NCLo/6+ZpzLdAnI5GJhAogAiBgraeJxjYGRgYA76nwUkXzAAAfNUBkYGVKALAFb4A3EAAAB4nGNgYGBgfjG0MAAMzihlAAAAAABOAJoA6AEKASwBTgFwAZoBxAHuAhoCnALoBJoEvATWBPIFDgUqBXoF0AX+BkQGlga4BwgHagfiCGoIpAi8CVAJmAoQCiwKVgqQCtYLGAtOC4gL6AwuDFR4nGNgZGBg0GVMYRBlAAEmIOYCQgaG/2A+AwAYygG+AHicbZE9TsMwGIbf9A/RSggEYmHxAgtq+jN2ZGj3Dt3T1GlTOXHkuBW9AyfgEByCgTNwCA7BW/NJlVBtyd/jx+8XKwmAa3whwnFE6Ib1OBq44O6Pm6Qb4Rb5QbiNHh6FO/RD4S6eMRHu4RaaT4halzR3eBVu4Apvwk36d+EW+UO4jXt8Cnfov4W7WOBHuIen6MXsCtvPU1vWc73emcSdxIkW2tW5LdUoHp7kTJfaJV6v1PKg6v167H2mMmcLNbWl18ZYVTm71amPN95Xk8EgEx+ntoDBDgUs+siRspaoMef7rukNEriziXNuwS7Hmoe9wggxv+e55IzJMqQTeNYV00scuNbY8+YxrUfGfcaMZb/CNPQe04bT0lThbEuT0sfYhK6K/23Amf3Lx+H24hcj4GScAAAAeJxtjuduwzAMhH2NnTqOk+6993TfSZFY24giGZTVon36eiRFf5SAiO/A05HBWtBXEvxfGdYwQIgIQ6wjxggJxkgxwRQb2MQWtrGDXexhHwc4xBGOcYJTnOEcF7jEFa5xg1vc4R4PeMQTnvGCV2R4C1Khy9xkkkxNnPRC03s97pHLvKgTYXJNmbKfZom9o8POEffsq0Qw28+ltcPe2uHS2rGvRjPBmSwE1+GMtI6l0GSU4JEsSM4XgudpQx9sTRf3K9rAyUr0962UryKprZwPpM0jyda5uP2qrVBjxSLPCmGUplixrdpBSKqsI2oO4gF9Udq8TJVOzDSpcEHGR4vSeJdaVsSkMl26OqoKa6jttQ0rLb6a5l3YjO2QqV01YXLlNy2XDR0JlkXojbJTb/5GDX3V+kPviIPgB9AUks0AAAA=)
      format('woff');
    font-weight: normal;
    font-style: normal;
  }

  html {
    --lumo-icons-align-center: '\\ea01';
    --lumo-icons-align-left: '\\ea02';
    --lumo-icons-align-right: '\\ea03';
    --lumo-icons-angle-down: '\\ea04';
    --lumo-icons-angle-left: '\\ea05';
    --lumo-icons-angle-right: '\\ea06';
    --lumo-icons-angle-up: '\\ea07';
    --lumo-icons-arrow-down: '\\ea08';
    --lumo-icons-arrow-left: '\\ea09';
    --lumo-icons-arrow-right: '\\ea0a';
    --lumo-icons-arrow-up: '\\ea0b';
    --lumo-icons-bar-chart: '\\ea0c';
    --lumo-icons-bell: '\\ea0d';
    --lumo-icons-calendar: '\\ea0e';
    --lumo-icons-checkmark: '\\ea0f';
    --lumo-icons-chevron-down: '\\ea10';
    --lumo-icons-chevron-left: '\\ea11';
    --lumo-icons-chevron-right: '\\ea12';
    --lumo-icons-chevron-up: '\\ea13';
    --lumo-icons-clock: '\\ea14';
    --lumo-icons-cog: '\\ea15';
    --lumo-icons-cross: '\\ea16';
    --lumo-icons-download: '\\ea17';
    --lumo-icons-drag-handle: '\\ea18';
    --lumo-icons-dropdown: '\\ea19';
    --lumo-icons-edit: '\\ea1a';
    --lumo-icons-error: '\\ea1b';
    --lumo-icons-eye: '\\ea1c';
    --lumo-icons-eye-disabled: '\\ea1d';
    --lumo-icons-menu: '\\ea1e';
    --lumo-icons-minus: '\\ea1f';
    --lumo-icons-ordered-list: '\\ea20';
    --lumo-icons-phone: '\\ea21';
    --lumo-icons-photo: '\\ea22';
    --lumo-icons-play: '\\ea23';
    --lumo-icons-plus: '\\ea24';
    --lumo-icons-redo: '\\ea25';
    --lumo-icons-reload: '\\ea26';
    --lumo-icons-resize-handle: '\\ea27';
    --lumo-icons-search: '\\ea28';
    --lumo-icons-undo: '\\ea29';
    --lumo-icons-unordered-list: '\\ea2a';
    --lumo-icons-upload: '\\ea2b';
    --lumo-icons-user: '\\ea2c';
  }
`;
addLumoGlobalStyles("font-icons", fontIcons);

// node_modules/@vaadin/vaadin-lumo-styles/sizing.js
var sizing = i`
  :host {
    --lumo-size-xs: 1.625rem;
    --lumo-size-s: 1.875rem;
    --lumo-size-m: 2.25rem;
    --lumo-size-l: 2.75rem;
    --lumo-size-xl: 3.5rem;

    /* Icons */
    --lumo-icon-size-s: 1.25em;
    --lumo-icon-size-m: 1.5em;
    --lumo-icon-size-l: 2.25em;
    /* For backwards compatibility */
    --lumo-icon-size: var(--lumo-icon-size-m);
  }
`;
addLumoGlobalStyles("sizing-props", sizing);

// node_modules/@vaadin/vaadin-lumo-styles/typography.js
var font = i`
  :host {
    /* prettier-ignore */
    --lumo-font-family: -apple-system, BlinkMacSystemFont, 'Roboto', 'Segoe UI', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';

    /* Font sizes */
    --lumo-font-size-xxs: 0.75rem;
    --lumo-font-size-xs: 0.8125rem;
    --lumo-font-size-s: 0.875rem;
    --lumo-font-size-m: 1rem;
    --lumo-font-size-l: 1.125rem;
    --lumo-font-size-xl: 1.375rem;
    --lumo-font-size-xxl: 1.75rem;
    --lumo-font-size-xxxl: 2.5rem;

    /* Line heights */
    --lumo-line-height-xs: 1.25;
    --lumo-line-height-s: 1.375;
    --lumo-line-height-m: 1.625;
  }
`;
var typography = i`
  body,
  :host {
    font-family: var(--lumo-font-family);
    font-size: var(--lumo-font-size-m);
    line-height: var(--lumo-line-height-m);
    -webkit-text-size-adjust: 100%;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  small,
  [theme~='font-size-s'] {
    font-size: var(--lumo-font-size-s);
    line-height: var(--lumo-line-height-s);
  }

  [theme~='font-size-xs'] {
    font-size: var(--lumo-font-size-xs);
    line-height: var(--lumo-line-height-xs);
  }

  :where(h1, h2, h3, h4, h5, h6) {
    font-weight: 600;
    line-height: var(--lumo-line-height-xs);
    margin-block: 0;
  }

  :where(h1) {
    font-size: var(--lumo-font-size-xxxl);
  }

  :where(h2) {
    font-size: var(--lumo-font-size-xxl);
  }

  :where(h3) {
    font-size: var(--lumo-font-size-xl);
  }

  :where(h4) {
    font-size: var(--lumo-font-size-l);
  }

  :where(h5) {
    font-size: var(--lumo-font-size-m);
  }

  :where(h6) {
    font-size: var(--lumo-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  p,
  blockquote {
    margin-top: 0.5em;
    margin-bottom: 0.75em;
  }

  a {
    text-decoration: none;
  }

  a:where(:any-link):hover {
    text-decoration: underline;
  }

  hr {
    display: block;
    align-self: stretch;
    height: 1px;
    border: 0;
    padding: 0;
    margin: var(--lumo-space-s) calc(var(--lumo-border-radius-m) / 2);
    background-color: var(--lumo-contrast-10pct);
  }

  blockquote {
    border-left: 2px solid var(--lumo-contrast-30pct);
  }

  b,
  strong {
    font-weight: 600;
  }

  /* RTL specific styles */
  blockquote[dir='rtl'] {
    border-left: none;
    border-right: 2px solid var(--lumo-contrast-30pct);
  }
`;
registerStyles("", typography, { moduleId: "lumo-typography" });
addLumoGlobalStyles("typography-props", font);

// node_modules/@vaadin/item/theme/lumo/vaadin-item-styles.js
var item = i`
  :host {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    font-family: var(--lumo-font-family);
    font-size: var(--lumo-font-size-m);
    line-height: var(--lumo-line-height-xs);
    padding: 0.5em calc(var(--lumo-space-l) + var(--lumo-border-radius-m) / 4) 0.5em
      var(--_lumo-list-box-item-padding-left, calc(var(--lumo-border-radius-m) / 4));
    min-height: var(--lumo-size-m);
    outline: none;
    border-radius: var(--lumo-border-radius-m);
    cursor: var(--lumo-clickable-cursor);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-tap-highlight-color: var(--lumo-primary-color-10pct);
    --_focus-ring-color: var(--vaadin-focus-ring-color, var(--lumo-primary-color-50pct));
    --_focus-ring-width: var(--vaadin-focus-ring-width, 2px);
    --_selection-color-text: var(--vaadin-selection-color-text, var(--lumo-primary-text-color));
  }

  /* Checkmark */
  [part='checkmark']::before {
    display: var(--_lumo-item-selected-icon-display, none);
    content: var(--lumo-icons-checkmark);
    font-family: lumo-icons;
    font-size: var(--lumo-icon-size-m);
    line-height: 1;
    font-weight: normal;
    width: 1em;
    height: 1em;
    margin: calc((1 - var(--lumo-line-height-xs)) * var(--lumo-font-size-m) / 2) 0;
    color: var(--_selection-color-text);
    flex: none;
    opacity: 0;
    transition:
      transform 0.2s cubic-bezier(0.12, 0.32, 0.54, 2),
      opacity 0.1s;
  }

  :host([selected]) [part='checkmark']::before {
    opacity: 1;
  }

  :host([active]:not([selected])) [part='checkmark']::before {
    transform: scale(0.8);
    opacity: 0;
    transition-duration: 0s;
  }

  [part='content'] {
    flex: auto;
  }

  /* Disabled */
  :host([disabled]) {
    color: var(--lumo-disabled-text-color);
    cursor: default;
    pointer-events: none;
  }

  /* TODO a workaround until we have "focus-follows-mouse". After that, use the hover style for focus-ring as well */
  @media (any-hover: hover) {
    :host(:hover:not([disabled])) {
      background-color: var(--lumo-primary-color-10pct);
    }
  }

  :host([focus-ring]:not([disabled])) {
    box-shadow: inset 0 0 0 var(--_focus-ring-width) var(--_focus-ring-color);
  }

  /* RTL specific styles */
  :host([dir='rtl']) {
    padding-left: calc(var(--lumo-space-l) + var(--lumo-border-radius-m) / 4);
    padding-right: var(--_lumo-list-box-item-padding-left, calc(var(--lumo-border-radius-m) / 4));
  }

  /* Slotted icons */
  :host ::slotted(vaadin-icon) {
    width: var(--lumo-icon-size-m);
    height: var(--lumo-icon-size-m);
  }
`;
registerStyles("vaadin-item", item, { moduleId: "lumo-item" });

// node_modules/@vaadin/combo-box/theme/lumo/vaadin-combo-box-item-styles.js
var comboBoxItem = i`
  :host {
    transition: background-color 100ms;
    overflow: hidden;
    --_lumo-item-selected-icon-display: block;
    --_focus-ring-color: var(--vaadin-focus-ring-color, var(--lumo-primary-color-50pct));
    --_focus-ring-width: var(--vaadin-focus-ring-width, 2px);
  }

  :host([focused]:not([disabled])) {
    box-shadow: inset 0 0 0 var(--_focus-ring-width) var(--_focus-ring-color);
  }
`;
registerStyles("vaadin-combo-box-item", [item, comboBoxItem], {
  moduleId: "lumo-combo-box-item"
});

// node_modules/@vaadin/vaadin-lumo-styles/mixins/loader.js
var loader = i`
  [part~='loader'] {
    box-sizing: border-box;
    width: var(--lumo-icon-size-s);
    height: var(--lumo-icon-size-s);
    border: 2px solid transparent;
    border-color: var(--lumo-primary-color-10pct) var(--lumo-primary-color-10pct) var(--lumo-primary-color)
      var(--lumo-primary-color);
    border-radius: calc(0.5 * var(--lumo-icon-size-s));
    opacity: 0;
    pointer-events: none;
  }

  :host(:not([loading])) [part~='loader'] {
    display: none;
  }

  :host([loading]) [part~='loader'] {
    animation:
      1s linear infinite lumo-loader-rotate,
      0.3s 0.1s lumo-loader-fade-in both;
  }

  @keyframes lumo-loader-fade-in {
    0% {
      opacity: 0;
    }

    100% {
      opacity: 1;
    }
  }

  @keyframes lumo-loader-rotate {
    0% {
      transform: rotate(0deg);
    }

    100% {
      transform: rotate(360deg);
    }
  }
`;

// node_modules/@vaadin/vaadin-lumo-styles/mixins/overlay.js
var overlay = i`
  :host {
    top: var(--lumo-space-m);
    right: var(--lumo-space-m);
    bottom: var(--lumo-space-m);
    left: var(--lumo-space-m);
    /* Workaround for Edge issue (only on Surface), where an overflowing vaadin-list-box inside vaadin-select-overlay makes the overlay transparent */
    /* stylelint-disable-next-line */
    outline: 0px solid transparent;
  }

  [part='overlay'] {
    background-color: var(--lumo-base-color);
    background-image: linear-gradient(var(--lumo-tint-5pct), var(--lumo-tint-5pct));
    border-radius: var(--lumo-border-radius-m);
    box-shadow:
      0 0 0 1px var(--lumo-shade-5pct),
      var(--lumo-box-shadow-m);
    color: var(--lumo-body-text-color);
    font-family: var(--lumo-font-family);
    font-size: var(--lumo-font-size-m);
    font-weight: 400;
    line-height: var(--lumo-line-height-m);
    letter-spacing: 0;
    text-transform: none;
    -webkit-text-size-adjust: 100%;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  [part='content'] {
    padding: var(--lumo-space-xs);
  }

  [part='backdrop'] {
    background-color: var(--lumo-shade-20pct);
    animation: 0.2s lumo-overlay-backdrop-enter both;
    will-change: opacity;
  }

  @keyframes lumo-overlay-backdrop-enter {
    0% {
      opacity: 0;
    }
  }

  :host([closing]) [part='backdrop'] {
    animation: 0.2s lumo-overlay-backdrop-exit both;
  }

  @keyframes lumo-overlay-backdrop-exit {
    100% {
      opacity: 0;
    }
  }

  @keyframes lumo-overlay-dummy-animation {
    0% {
      opacity: 1;
    }

    100% {
      opacity: 1;
    }
  }
`;
registerStyles("", overlay, { moduleId: "lumo-overlay" });

// node_modules/@vaadin/vaadin-lumo-styles/mixins/menu-overlay.js
var menuOverlayCore = i`
  :host([opening]),
  :host([closing]) {
    animation: 0.14s lumo-overlay-dummy-animation;
  }

  [part='overlay'] {
    will-change: opacity, transform;
  }

  :host([opening]) [part='overlay'] {
    animation: 0.1s lumo-menu-overlay-enter ease-out both;
  }

  @keyframes lumo-menu-overlay-enter {
    0% {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  :host([closing]) [part='overlay'] {
    animation: 0.1s lumo-menu-overlay-exit both;
  }

  @keyframes lumo-menu-overlay-exit {
    100% {
      opacity: 0;
    }
  }
`;
registerStyles("", menuOverlayCore, { moduleId: "lumo-menu-overlay-core" });
var menuOverlayExt = i`
  /* Small viewport (bottom sheet) styles */
  /* Use direct media queries instead of the state attributes ([phone] and [fullscreen]) provided by the elements */
  @media (max-width: 450px), (max-height: 450px) {
    :host {
      top: 0 !important;
      right: 0 !important;
      bottom: var(--vaadin-overlay-viewport-bottom, 0) !important;
      left: 0 !important;
      align-items: stretch !important;
      justify-content: flex-end !important;
    }

    [part='overlay'] {
      max-height: 50vh;
      width: 100vw;
      border-radius: 0;
      box-shadow: var(--lumo-box-shadow-xl);
    }

    /* The content part scrolls instead of the overlay part, because of the gradient fade-out */
    [part='content'] {
      padding: 30px var(--lumo-space-m);
      max-height: inherit;
      box-sizing: border-box;
      -webkit-overflow-scrolling: touch;
      overflow: auto;
      -webkit-mask-image: linear-gradient(transparent, #000 40px, #000 calc(100% - 40px), transparent);
      mask-image: linear-gradient(transparent, #000 40px, #000 calc(100% - 40px), transparent);
    }

    [part='backdrop'] {
      display: block;
    }

    /* Animations */

    :host([opening]) [part='overlay'] {
      animation: 0.2s lumo-mobile-menu-overlay-enter cubic-bezier(0.215, 0.61, 0.355, 1) both;
    }

    :host([closing]),
    :host([closing]) [part='backdrop'] {
      animation-delay: 0.14s;
    }

    :host([closing]) [part='overlay'] {
      animation: 0.14s 0.14s lumo-mobile-menu-overlay-exit cubic-bezier(0.55, 0.055, 0.675, 0.19) both;
    }
  }

  @keyframes lumo-mobile-menu-overlay-enter {
    0% {
      transform: translateY(150%);
    }
  }

  @keyframes lumo-mobile-menu-overlay-exit {
    100% {
      transform: translateY(150%);
    }
  }
`;
var menuOverlay = [overlay, menuOverlayCore, menuOverlayExt];
registerStyles("", menuOverlay, { moduleId: "lumo-menu-overlay" });

// node_modules/@vaadin/combo-box/theme/lumo/vaadin-combo-box-overlay-styles.js
var comboBoxOverlay = i`
  [part='content'] {
    padding: 0;
  }

  /* When items are empty, the spinner needs some room */
  :host(:not([closing])) [part~='content'] {
    min-height: calc(2 * var(--lumo-space-s) + var(--lumo-icon-size-s));
  }

  [part~='overlay'] {
    position: relative;
  }

  :host([top-aligned]) [part~='overlay'] {
    margin-top: var(--lumo-space-xs);
  }

  :host([bottom-aligned]) [part~='overlay'] {
    margin-bottom: var(--lumo-space-xs);
  }
`;
var comboBoxLoader = i`
  [part~='loader'] {
    position: absolute;
    z-index: 1;
    inset-inline: var(--lumo-space-s);
    top: var(--lumo-space-s);
    margin-inline: auto 0;
  }
`;
registerStyles(
  "vaadin-combo-box-overlay",
  [
    overlay,
    menuOverlayCore,
    comboBoxOverlay,
    loader,
    comboBoxLoader,
    i`
      :host {
        --_vaadin-combo-box-items-container-border-width: var(--lumo-space-xs);
        --_vaadin-combo-box-items-container-border-style: solid;
      }
    `
  ],
  { moduleId: "lumo-combo-box-overlay" }
);

// node_modules/@vaadin/input-container/theme/lumo/vaadin-input-container-styles.js
registerStyles(
  "vaadin-input-container",
  i`
    :host {
      background: var(--_background);
      padding: 0 calc(0.375em + var(--_input-container-radius) / 4 - 1px);
      font-weight: var(--vaadin-input-field-value-font-weight, 500);
      line-height: 1;
      position: relative;
      cursor: text;
      box-sizing: border-box;
      border-radius:
        /* See https://developer.mozilla.org/en-US/docs/Web/CSS/border-radius#syntax */
        var(--vaadin-input-field-top-start-radius, var(--_input-container-radius))
        var(--vaadin-input-field-top-end-radius, var(--_input-container-radius))
        var(--vaadin-input-field-bottom-end-radius, var(--_input-container-radius))
        var(--vaadin-input-field-bottom-start-radius, var(--_input-container-radius));
      /* Fallback */
      --_input-container-radius: var(--vaadin-input-field-border-radius, var(--lumo-border-radius-m));
      --_input-height: var(--lumo-text-field-size, var(--lumo-size-m));
      /* Default values */
      --_background: var(--vaadin-input-field-background, var(--lumo-contrast-10pct));
      --_hover-highlight: var(--vaadin-input-field-hover-highlight, var(--lumo-contrast-50pct));
      --_input-border-color: var(--vaadin-input-field-border-color, var(--lumo-contrast-50pct));
      --_icon-color: var(--vaadin-input-field-icon-color, var(--lumo-contrast-60pct));
      --_icon-size: var(--vaadin-input-field-icon-size, var(--lumo-icon-size-m));
      --_invalid-background: var(--vaadin-input-field-invalid-background, var(--lumo-error-color-10pct));
      --_invalid-hover-highlight: var(--vaadin-input-field-invalid-hover-highlight, var(--lumo-error-color-50pct));
      --_disabled-background: var(--vaadin-input-field-disabled-background, var(--lumo-contrast-5pct));
      --_disabled-value-color: var(--vaadin-input-field-disabled-value-color, var(--lumo-disabled-text-color));
    }

    :host([dir='rtl']) {
      border-radius:
        /* Don't use logical props, see https://github.com/vaadin/vaadin-time-picker/issues/145 */
        var(--vaadin-input-field-top-end-radius, var(--_input-container-radius))
        var(--vaadin-input-field-top-start-radius, var(--_input-container-radius))
        var(--vaadin-input-field-bottom-start-radius, var(--_input-container-radius))
        var(--vaadin-input-field-bottom-end-radius, var(--_input-container-radius));
    }

    /* Used for hover and activation effects */
    :host::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
      background: var(--_hover-highlight);
      opacity: 0;
      transition:
        transform 0.15s,
        opacity 0.2s;
      transform-origin: 100% 0;
    }

    ::slotted(:not([slot$='fix'])) {
      cursor: inherit;
      min-height: var(--vaadin-input-field-height, var(--_input-height));
      padding: 0 0.25em;
      --_lumo-text-field-overflow-mask-image: linear-gradient(to left, transparent, #000 1.25em);
      -webkit-mask-image: var(--_lumo-text-field-overflow-mask-image);
      mask-image: var(--_lumo-text-field-overflow-mask-image);
    }

    /* Read-only */
    :host([readonly]) {
      color: var(--lumo-secondary-text-color);
      background-color: transparent;
      cursor: default;
    }

    :host([readonly])::after {
      background-color: transparent;
      opacity: 1;
      border: var(--vaadin-input-field-readonly-border, 1px dashed var(--lumo-contrast-30pct));
    }

    /* Disabled */
    :host([disabled]) {
      background: var(--_disabled-background);
    }

    :host([disabled]) ::slotted(:not([slot$='fix'])) {
      -webkit-text-fill-color: var(--_disabled-value-color);
      color: var(--_disabled-value-color);
    }

    /* Invalid */
    :host([invalid]) {
      background: var(--_invalid-background);
    }

    :host([invalid]:not([readonly]))::after {
      background: var(--_invalid-hover-highlight);
    }

    /* Slotted icons */
    ::slotted(vaadin-icon) {
      color: var(--_icon-color);
      width: var(--_icon-size);
      height: var(--_icon-size);
    }

    /* Vaadin icons are based on a 16x16 grid (unlike Lumo and Material icons with 24x24), so they look too big by default */
    ::slotted(vaadin-icon[icon^='vaadin:']) {
      padding: 0.25em;
      box-sizing: border-box !important;
    }

    /* Text align */
    :host([dir='rtl']) ::slotted(:not([slot$='fix'])) {
      --_lumo-text-field-overflow-mask-image: linear-gradient(to right, transparent, #000 1.25em);
    }

    @-moz-document url-prefix() {
      :host([dir='rtl']) ::slotted(:not([slot$='fix'])) {
        mask-image: var(--_lumo-text-field-overflow-mask-image);
      }
    }

    :host([theme~='align-left']) ::slotted(:not([slot$='fix'])) {
      text-align: start;
      --_lumo-text-field-overflow-mask-image: none;
    }

    :host([theme~='align-center']) ::slotted(:not([slot$='fix'])) {
      text-align: center;
      --_lumo-text-field-overflow-mask-image: none;
    }

    :host([theme~='align-right']) ::slotted(:not([slot$='fix'])) {
      text-align: end;
      --_lumo-text-field-overflow-mask-image: none;
    }

    @-moz-document url-prefix() {
      /* Firefox is smart enough to align overflowing text to right */
      :host([theme~='align-right']) ::slotted(:not([slot$='fix'])) {
        --_lumo-text-field-overflow-mask-image: linear-gradient(to right, transparent 0.25em, #000 1.5em);
      }
    }

    @-moz-document url-prefix() {
      /* Firefox is smart enough to align overflowing text to right */
      :host([theme~='align-left']) ::slotted(:not([slot$='fix'])) {
        --_lumo-text-field-overflow-mask-image: linear-gradient(to left, transparent 0.25em, #000 1.5em);
      }
    }

    /* RTL specific styles */
    :host([dir='rtl'])::after {
      transform-origin: 0% 0;
    }

    :host([theme~='align-left'][dir='rtl']) ::slotted(:not([slot$='fix'])) {
      --_lumo-text-field-overflow-mask-image: none;
    }

    :host([theme~='align-center'][dir='rtl']) ::slotted(:not([slot$='fix'])) {
      --_lumo-text-field-overflow-mask-image: none;
    }

    :host([theme~='align-right'][dir='rtl']) ::slotted(:not([slot$='fix'])) {
      --_lumo-text-field-overflow-mask-image: none;
    }

    @-moz-document url-prefix() {
      /* Firefox is smart enough to align overflowing text to right */
      :host([theme~='align-right'][dir='rtl']) ::slotted(:not([slot$='fix'])) {
        --_lumo-text-field-overflow-mask-image: linear-gradient(to right, transparent 0.25em, #000 1.5em);
      }
    }

    @-moz-document url-prefix() {
      /* Firefox is smart enough to align overflowing text to right */
      :host([theme~='align-left'][dir='rtl']) ::slotted(:not([slot$='fix'])) {
        --_lumo-text-field-overflow-mask-image: linear-gradient(to left, transparent 0.25em, #000 1.5em);
      }
    }
  `,
  { moduleId: "lumo-input-container" }
);

// node_modules/@vaadin/vaadin-lumo-styles/mixins/field-button.js
var fieldButton = i`
  [part$='button'] {
    flex: none;
    width: 1em;
    height: 1em;
    line-height: 1;
    font-size: var(--lumo-icon-size-m);
    text-align: center;
    color: var(--lumo-contrast-60pct);
    transition: 0.2s color;
    cursor: var(--lumo-clickable-cursor);
  }

  [part$='button']:hover {
    color: var(--lumo-contrast-90pct);
  }

  :host([disabled]) [part$='button'],
  :host([readonly]) [part$='button'] {
    color: var(--lumo-contrast-20pct);
    cursor: default;
  }

  [part$='button']::before {
    font-family: 'lumo-icons';
    display: block;
  }
`;
registerStyles("", fieldButton, { moduleId: "lumo-field-button" });

// node_modules/@vaadin/vaadin-lumo-styles/mixins/helper.js
var helper = i`
  :host {
    --_helper-spacing: var(--vaadin-input-field-helper-spacing, 0.4em);
  }

  :host([has-helper]) [part='helper-text']::before {
    content: '';
    display: block;
    height: var(--_helper-spacing);
  }

  [part='helper-text'] {
    display: block;
    color: var(--vaadin-input-field-helper-color, var(--lumo-secondary-text-color));
    font-size: var(--vaadin-input-field-helper-font-size, var(--lumo-font-size-xs));
    line-height: var(--lumo-line-height-xs);
    font-weight: var(--vaadin-input-field-helper-font-weight, 400);
    margin-left: calc(var(--lumo-border-radius-m) / 4);
    transition: color 0.2s;
  }

  :host(:hover:not([readonly])) [part='helper-text'] {
    color: var(--lumo-body-text-color);
  }

  :host([disabled]) [part='helper-text'] {
    color: var(--lumo-disabled-text-color);
    -webkit-text-fill-color: var(--lumo-disabled-text-color);
  }

  :host([has-helper][theme~='helper-above-field']) [part='helper-text']::before {
    display: none;
  }

  :host([has-helper][theme~='helper-above-field']) [part='helper-text']::after {
    content: '';
    display: block;
    height: var(--_helper-spacing);
  }

  :host([has-helper][theme~='helper-above-field']) [part='label'] {
    order: 0;
    padding-bottom: var(--_helper-spacing);
  }

  :host([has-helper][theme~='helper-above-field']) [part='helper-text'] {
    order: 1;
  }

  :host([has-helper][theme~='helper-above-field']) [part='label'] + * {
    order: 2;
  }

  :host([has-helper][theme~='helper-above-field']) [part='error-message'] {
    order: 3;
  }
`;

// node_modules/@vaadin/vaadin-lumo-styles/mixins/required-field.js
var requiredField = i`
  [part='label'] {
    align-self: flex-start;
    color: var(--vaadin-input-field-label-color, var(--lumo-secondary-text-color));
    font-weight: var(--vaadin-input-field-label-font-weight, 500);
    font-size: var(--vaadin-input-field-label-font-size, var(--lumo-font-size-s));
    transition: color 0.2s;
    line-height: 1;
    padding-inline-start: calc(var(--lumo-border-radius-m) / 4);
    padding-inline-end: 1em;
    padding-bottom: 0.5em;
    /* As a workaround for diacritics being cut off, add a top padding and a
    negative margin to compensate */
    padding-top: 0.25em;
    margin-top: -0.25em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    position: relative;
    max-width: 100%;
    box-sizing: border-box;
  }

  :host([focused]:not([readonly])) [part='label'] {
    color: var(--vaadin-input-field-focused-label-color, var(--lumo-primary-text-color));
  }

  :host(:hover:not([readonly]):not([focused])) [part='label'] {
    color: var(--vaadin-input-field-hovered-label-color, var(--lumo-body-text-color));
  }

  /* Touch device adjustment */
  @media (pointer: coarse) {
    :host(:hover:not([readonly]):not([focused])) [part='label'] {
      color: var(--vaadin-input-field-label-color, var(--lumo-secondary-text-color));
    }
  }

  :host([has-label])::before {
    margin-top: calc(var(--lumo-font-size-s) * 1.5);
  }

  :host([has-label][theme~='small'])::before {
    margin-top: calc(var(--lumo-font-size-xs) * 1.5);
  }

  :host([has-label]) {
    padding-top: var(--lumo-space-m);
  }

  :host([has-label]) ::slotted([slot='tooltip']) {
    --vaadin-tooltip-offset-bottom: calc((var(--lumo-space-m) - var(--lumo-space-xs)) * -1);
  }

  :host([required]) [part='required-indicator']::after {
    content: var(--lumo-required-field-indicator, '\\2022');
    transition: opacity 0.2s;
    color: var(--lumo-required-field-indicator-color, var(--lumo-primary-text-color));
    position: absolute;
    right: 0;
    width: 1em;
    text-align: center;
  }

  :host([invalid]) [part='required-indicator']::after {
    color: var(--lumo-required-field-indicator-color, var(--lumo-error-text-color));
  }

  [part='error-message'] {
    margin-left: calc(var(--lumo-border-radius-m) / 4);
    font-size: var(--vaadin-input-field-error-font-size, var(--lumo-font-size-xs));
    line-height: var(--lumo-line-height-xs);
    font-weight: var(--vaadin-input-field-error-font-weight, 400);
    color: var(--vaadin-input-field-error-color, var(--lumo-error-text-color));
    will-change: max-height;
    transition: 0.4s max-height;
    max-height: 5em;
  }

  :host([has-error-message]) [part='error-message']::before,
  :host([has-error-message]) [part='error-message']::after {
    content: '';
    display: block;
    height: 0.4em;
  }

  :host(:not([invalid])) [part='error-message'] {
    max-height: 0;
    overflow: hidden;
  }

  /* RTL specific styles */

  :host([dir='rtl']) [part='required-indicator']::after {
    right: auto;
    left: 0;
  }

  :host([dir='rtl']) [part='error-message'] {
    margin-left: 0;
    margin-right: calc(var(--lumo-border-radius-m) / 4);
  }
`;
registerStyles("", requiredField, { moduleId: "lumo-required-field" });

// node_modules/@vaadin/vaadin-lumo-styles/mixins/input-field-shared.js
var inputField = i`
  :host {
    --lumo-text-field-size: var(--lumo-size-m);
    color: var(--vaadin-input-field-value-color, var(--lumo-body-text-color));
    font-size: var(--vaadin-input-field-value-font-size, var(--lumo-font-size-m));
    font-family: var(--lumo-font-family);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-tap-highlight-color: transparent;
    padding: var(--lumo-space-xs) 0;
    --_focus-ring-color: var(--vaadin-focus-ring-color, var(--lumo-primary-color-50pct));
    --_focus-ring-width: var(--vaadin-focus-ring-width, 2px);
    --_input-height: var(--vaadin-input-field-height, var(--lumo-text-field-size));
    --_disabled-value-color: var(--vaadin-input-field-disabled-value-color, var(--lumo-disabled-text-color));
  }

  :host::before {
    height: var(--_input-height);
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
  }

  :host([focused]) [part='input-field'] ::slotted(:is(input, textarea)) {
    -webkit-mask-image: none;
    mask-image: none;
  }

  ::slotted(:is(input, textarea):placeholder-shown) {
    color: var(--vaadin-input-field-placeholder-color, var(--lumo-secondary-text-color));
  }

  /* Hover */
  :host(:hover:not([readonly]):not([focused]):not([disabled])) [part='input-field']::after {
    opacity: var(--vaadin-input-field-hover-highlight-opacity, 0.1);
  }

  /* Touch device adjustment */
  @media (pointer: coarse) {
    :host(:hover:not([readonly]):not([focused]):not([disabled])) [part='input-field']::after {
      opacity: 0;
    }

    :host(:active:not([readonly]):not([focused]):not([disabled])) [part='input-field']::after {
      opacity: 0.2;
    }
  }

  /* Trigger when not focusing using the keyboard */
  :host([focused]:not([focus-ring]):not([readonly])) [part='input-field']::after {
    transform: scaleX(0);
    transition-duration: 0.15s, 1s;
  }

  /* Opt-in focus-ring when using pointer devices */
  /* This applies a focus-ring as box-shadow when the element is focused, but
     the ring is only visible / has a width when the respective CSS property is
     "enabled" using a value of 1 */
  :host([focused]) [part='input-field'] {
    /* Borders are implemented using box-shadows as well. To avoid overriding 
       the border on focus, even if the pointer focus-ring is disabled, we need to:
       - Duplicate the border box shadow for this rule
       - Remove the border (by using width of 0) when the focus-ring is visible,
         which is the same behavior as for the keyboard focus-ring below
       - Apply the border when the focus ring is not visible
    */
    --_pointer-focus-visible: clamp(0, var(--lumo-input-field-pointer-focus-visible, 0), 1);
    --_conditional-border-width: calc(calc(1 - var(--_pointer-focus-visible)) * var(--_input-border-width));
    --_conditional-focus-ring-width: calc(var(--_pointer-focus-visible) * var(--_focus-ring-width));
    box-shadow:
      inset 0 0 0 var(--_conditional-border-width) var(--_input-border-color),
      0 0 0 var(--_conditional-focus-ring-width) var(--_focus-ring-color);
  }

  /* Focus-ring when using keyboard navigation */
  :host([focus-ring]) [part='input-field'] {
    box-shadow: 0 0 0 var(--_focus-ring-width) var(--_focus-ring-color);
  }

  /* Read-only and disabled */
  :host(:is([readonly], [disabled])) ::slotted(:is(input, textarea):placeholder-shown) {
    opacity: 0;
  }

  /* Read-only style */
  :host([readonly]) {
    --vaadin-input-field-border-color: transparent;
  }

  /* Disabled style */
  :host([disabled]) {
    pointer-events: none;
    --vaadin-input-field-border-color: var(--lumo-contrast-20pct);
  }

  :host([disabled]) [part='label'],
  :host([disabled]) [part='input-field'] ::slotted([slot$='fix']) {
    color: var(--lumo-disabled-text-color);
    -webkit-text-fill-color: var(--lumo-disabled-text-color);
  }

  :host([disabled]) [part='input-field'] ::slotted(:not([slot$='fix'])) {
    color: var(--_disabled-value-color);
    -webkit-text-fill-color: var(--_disabled-value-color);
  }

  /* Invalid style */
  :host([invalid]) {
    --vaadin-input-field-border-color: var(--lumo-error-color);
    --_focus-ring-color: var(--lumo-error-color-50pct);
  }

  :host([input-prevented]) [part='input-field'] {
    animation: shake 0.15s infinite;
  }

  @keyframes shake {
    25% {
      transform: translateX(4px);
    }
    75% {
      transform: translateX(-4px);
    }
  }

  /* Small theme */
  :host([theme~='small']) {
    font-size: var(--lumo-font-size-s);
    --lumo-text-field-size: var(--lumo-size-s);
  }

  :host([theme~='small']) [part='label'] {
    font-size: var(--lumo-font-size-xs);
  }

  :host([theme~='small']) [part='error-message'] {
    font-size: var(--lumo-font-size-xxs);
  }

  /* Slotted content */
  [part='input-field'] ::slotted(:not(vaadin-icon):not(input):not(textarea)) {
    color: var(--lumo-secondary-text-color);
    font-weight: 400;
  }

  [part='clear-button']::before {
    content: var(--lumo-icons-cross);
  }
`;
var inputFieldShared = [requiredField, fieldButton, helper, inputField];
registerStyles("", inputFieldShared, {
  moduleId: "lumo-input-field-shared-styles"
});

// node_modules/@vaadin/combo-box/theme/lumo/vaadin-combo-box-styles.js
var comboBox = i`
  [part='toggle-button']::before {
    content: var(--lumo-icons-dropdown);
  }
`;
registerStyles("vaadin-combo-box", [inputFieldShared, comboBox], { moduleId: "lumo-combo-box" });

// node_modules/@polymer/polymer/lib/utils/boot.js
window.JSCompiler_renameProperty = function(prop, obj) {
  return prop;
};

// node_modules/@polymer/polymer/lib/utils/resolve-url.js
var CSS_URL_RX = /(url\()([^)]*)(\))/g;
var ABS_URL = /(^\/[^\/])|(^#)|(^[\w-\d]*:)/;
var workingURL;
var resolveDoc;
function resolveUrl(url, baseURI) {
  if (url && ABS_URL.test(url)) {
    return url;
  }
  if (url === "//") {
    return url;
  }
  if (workingURL === void 0) {
    workingURL = false;
    try {
      const u3 = new URL("b", "http://a");
      u3.pathname = "c%20d";
      workingURL = u3.href === "http://a/c%20d";
    } catch (e4) {
    }
  }
  if (!baseURI) {
    baseURI = document.baseURI || window.location.href;
  }
  if (workingURL) {
    try {
      return new URL(url, baseURI).href;
    } catch (e4) {
      return url;
    }
  }
  if (!resolveDoc) {
    resolveDoc = document.implementation.createHTMLDocument("temp");
    resolveDoc.base = resolveDoc.createElement("base");
    resolveDoc.head.appendChild(resolveDoc.base);
    resolveDoc.anchor = resolveDoc.createElement("a");
    resolveDoc.body.appendChild(resolveDoc.anchor);
  }
  resolveDoc.base.href = baseURI;
  resolveDoc.anchor.href = url;
  return resolveDoc.anchor.href || url;
}
function resolveCss(cssText, baseURI) {
  return cssText.replace(CSS_URL_RX, function(m2, pre, url, post) {
    return pre + "'" + resolveUrl(url.replace(/["']/g, ""), baseURI) + "'" + post;
  });
}
function pathFromUrl(url) {
  return url.substring(0, url.lastIndexOf("/") + 1);
}

// node_modules/@polymer/polymer/lib/utils/settings.js
var useShadow = !window.ShadyDOM || !window.ShadyDOM.inUse;
var useNativeCSSProperties = Boolean(!window.ShadyCSS || window.ShadyCSS.nativeCss);
var useNativeCustomElements = !window.customElements.polyfillWrapFlushCallback;
var supportsAdoptingStyleSheets = useShadow && "adoptedStyleSheets" in Document.prototype && "replaceSync" in CSSStyleSheet.prototype && // Since spec may change, feature detect exact API we need
(() => {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("");
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" });
    host.shadowRoot.adoptedStyleSheets = [sheet];
    return host.shadowRoot.adoptedStyleSheets[0] === sheet;
  } catch (e4) {
    return false;
  }
})();
var rootPath = window.Polymer && window.Polymer.rootPath || pathFromUrl(document.baseURI || window.location.href);
var sanitizeDOMValue = window.Polymer && window.Polymer.sanitizeDOMValue || void 0;
var passiveTouchGestures = window.Polymer && window.Polymer.setPassiveTouchGestures || false;
var strictTemplatePolicy = window.Polymer && window.Polymer.strictTemplatePolicy || false;
var allowTemplateFromDomModule = window.Polymer && window.Polymer.allowTemplateFromDomModule || false;
var legacyOptimizations = window.Polymer && window.Polymer.legacyOptimizations || false;
var legacyWarnings = window.Polymer && window.Polymer.legacyWarnings || false;
var syncInitialRender = window.Polymer && window.Polymer.syncInitialRender || false;
var legacyUndefined = window.Polymer && window.Polymer.legacyUndefined || false;
var orderedComputed = window.Polymer && window.Polymer.orderedComputed || false;
var cancelSyntheticClickEvents = true;
var setCancelSyntheticClickEvents = function(useCancelSyntheticClickEvents) {
  cancelSyntheticClickEvents = useCancelSyntheticClickEvents;
};
var removeNestedTemplates = window.Polymer && window.Polymer.removeNestedTemplates || false;
var fastDomIf = window.Polymer && window.Polymer.fastDomIf || false;
var suppressTemplateNotifications = window.Polymer && window.Polymer.suppressTemplateNotifications || false;
var legacyNoObservedAttributes = window.Polymer && window.Polymer.legacyNoObservedAttributes || false;
var useAdoptedStyleSheetsWithBuiltCSS = window.Polymer && window.Polymer.useAdoptedStyleSheetsWithBuiltCSS || false;

// node_modules/@polymer/polymer/lib/utils/mixin.js
var dedupeId = 0;
function MixinFunction() {
}
MixinFunction.prototype.__mixinApplications;
MixinFunction.prototype.__mixinSet;
var dedupingMixin = function(mixin) {
  let mixinApplications = (
    /** @type {!MixinFunction} */
    mixin.__mixinApplications
  );
  if (!mixinApplications) {
    mixinApplications = /* @__PURE__ */ new WeakMap();
    mixin.__mixinApplications = mixinApplications;
  }
  let mixinDedupeId = dedupeId++;
  function dedupingMixin2(base) {
    let baseSet = (
      /** @type {!MixinFunction} */
      base.__mixinSet
    );
    if (baseSet && baseSet[mixinDedupeId]) {
      return base;
    }
    let map = mixinApplications;
    let extended = map.get(base);
    if (!extended) {
      extended = /** @type {!Function} */
      mixin(base);
      map.set(base, extended);
      let mixinSet = Object.create(
        /** @type {!MixinFunction} */
        extended.__mixinSet || baseSet || null
      );
      mixinSet[mixinDedupeId] = true;
      extended.__mixinSet = mixinSet;
    }
    return extended;
  }
  return dedupingMixin2;
};

// node_modules/@polymer/polymer/lib/elements/dom-module.js
var modules = {};
var lcModules = {};
function setModule(id, module) {
  modules[id] = lcModules[id.toLowerCase()] = module;
}
function findModule(id) {
  return modules[id] || lcModules[id.toLowerCase()];
}
function styleOutsideTemplateCheck(inst) {
  if (inst.querySelector("style")) {
    console.warn("dom-module %s has style outside template", inst.id);
  }
}
var DomModule = class extends HTMLElement {
  /** @override */
  static get observedAttributes() {
    return ["id"];
  }
  /**
   * Retrieves the element specified by the css `selector` in the module
   * registered by `id`. For example, this.import('foo', 'img');
   * @param {string} id The id of the dom-module in which to search.
   * @param {string=} selector The css selector by which to find the element.
   * @return {Element} Returns the element which matches `selector` in the
   * module registered at the specified `id`.
   *
   * @export
   * @nocollapse Referred to indirectly in style-gather.js
   */
  static import(id, selector) {
    if (id) {
      let m2 = findModule(id);
      if (m2 && selector) {
        return m2.querySelector(selector);
      }
      return m2;
    }
    return null;
  }
  /* eslint-disable no-unused-vars */
  /**
   * @param {string} name Name of attribute.
   * @param {?string} old Old value of attribute.
   * @param {?string} value Current value of attribute.
   * @param {?string} namespace Attribute namespace.
   * @return {void}
   * @override
   */
  attributeChangedCallback(name, old, value, namespace) {
    if (old !== value) {
      this.register();
    }
  }
  /* eslint-enable no-unused-args */
  /**
   * The absolute URL of the original location of this `dom-module`.
   *
   * This value will differ from this element's `ownerDocument` in the
   * following ways:
   * - Takes into account any `assetpath` attribute added during bundling
   *   to indicate the original location relative to the bundled location
   * - Uses the HTMLImports polyfill's `importForElement` API to ensure
   *   the path is relative to the import document's location since
   *   `ownerDocument` is not currently polyfilled
   */
  get assetpath() {
    if (!this.__assetpath) {
      const owner = window.HTMLImports && HTMLImports.importForElement ? HTMLImports.importForElement(this) || document : this.ownerDocument;
      const url = resolveUrl(
        this.getAttribute("assetpath") || "",
        owner.baseURI
      );
      this.__assetpath = pathFromUrl(url);
    }
    return this.__assetpath;
  }
  /**
   * Registers the dom-module at a given id. This method should only be called
   * when a dom-module is imperatively created. For
   * example, `document.createElement('dom-module').register('foo')`.
   * @param {string=} id The id at which to register the dom-module.
   * @return {void}
   */
  register(id) {
    id = id || this.id;
    if (id) {
      if (strictTemplatePolicy && findModule(id) !== void 0) {
        setModule(id, null);
        throw new Error(`strictTemplatePolicy: dom-module ${id} re-registered`);
      }
      this.id = id;
      setModule(id, this);
      styleOutsideTemplateCheck(this);
    }
  }
};
DomModule.prototype["modules"] = modules;
customElements.define("dom-module", DomModule);

// node_modules/@polymer/polymer/lib/utils/style-gather.js
var MODULE_STYLE_LINK_SELECTOR = "link[rel=import][type~=css]";
var INCLUDE_ATTR = "include";
var SHADY_UNSCOPED_ATTR = "shady-unscoped";
function importModule(moduleId) {
  return (
    /** @type {?DomModule} */
    DomModule.import(moduleId)
  );
}
function styleForImport(importDoc) {
  let container2 = importDoc.body ? importDoc.body : importDoc;
  const importCss = resolveCss(
    container2.textContent,
    importDoc.baseURI
  );
  const style2 = document.createElement("style");
  style2.textContent = importCss;
  return style2;
}
function stylesFromModules(moduleIds) {
  const modules2 = moduleIds.trim().split(/\s+/);
  const styles = [];
  for (let i5 = 0; i5 < modules2.length; i5++) {
    styles.push(...stylesFromModule(modules2[i5]));
  }
  return styles;
}
function stylesFromModule(moduleId) {
  const m2 = importModule(moduleId);
  if (!m2) {
    console.warn("Could not find style data in module named", moduleId);
    return [];
  }
  if (m2._styles === void 0) {
    const styles = [];
    styles.push(..._stylesFromModuleImports(m2));
    const template = (
      /** @type {?HTMLTemplateElement} */
      m2.querySelector("template")
    );
    if (template) {
      styles.push(...stylesFromTemplate(
        template,
        /** @type {templateWithAssetPath} */
        m2.assetpath
      ));
    }
    m2._styles = styles;
  }
  return m2._styles;
}
function stylesFromTemplate(template, baseURI) {
  if (!template._styles) {
    const styles = [];
    const e$ = template.content.querySelectorAll("style");
    for (let i5 = 0; i5 < e$.length; i5++) {
      let e4 = e$[i5];
      let include = e4.getAttribute(INCLUDE_ATTR);
      if (include) {
        styles.push(...stylesFromModules(include).filter(function(item2, index, self) {
          return self.indexOf(item2) === index;
        }));
      }
      if (baseURI) {
        e4.textContent = resolveCss(
          e4.textContent,
          /** @type {string} */
          baseURI
        );
      }
      styles.push(e4);
    }
    template._styles = styles;
  }
  return template._styles;
}
function stylesFromModuleImports(moduleId) {
  let m2 = importModule(moduleId);
  return m2 ? _stylesFromModuleImports(m2) : [];
}
function _stylesFromModuleImports(module) {
  const styles = [];
  const p$ = module.querySelectorAll(MODULE_STYLE_LINK_SELECTOR);
  for (let i5 = 0; i5 < p$.length; i5++) {
    let p3 = p$[i5];
    if (p3.import) {
      const importDoc = p3.import;
      const unscoped = p3.hasAttribute(SHADY_UNSCOPED_ATTR);
      if (unscoped && !importDoc._unscopedStyle) {
        const style2 = styleForImport(importDoc);
        style2.setAttribute(SHADY_UNSCOPED_ATTR, "");
        importDoc._unscopedStyle = style2;
      } else if (!importDoc._style) {
        importDoc._style = styleForImport(importDoc);
      }
      styles.push(unscoped ? importDoc._unscopedStyle : importDoc._style);
    }
  }
  return styles;
}

// node_modules/@polymer/polymer/lib/utils/wrap.js
var wrap = window["ShadyDOM"] && window["ShadyDOM"]["noPatch"] && window["ShadyDOM"]["wrap"] ? window["ShadyDOM"]["wrap"] : window["ShadyDOM"] ? (n4) => ShadyDOM["patch"](n4) : (n4) => n4;

// node_modules/@polymer/polymer/lib/utils/path.js
function isPath(path) {
  return path.indexOf(".") >= 0;
}
function root(path) {
  let dotIndex = path.indexOf(".");
  if (dotIndex === -1) {
    return path;
  }
  return path.slice(0, dotIndex);
}
function isAncestor(base, path) {
  return base.indexOf(path + ".") === 0;
}
function isDescendant(base, path) {
  return path.indexOf(base + ".") === 0;
}
function translate(base, newBase, path) {
  return newBase + path.slice(base.length);
}
function normalize(path) {
  if (Array.isArray(path)) {
    let parts = [];
    for (let i5 = 0; i5 < path.length; i5++) {
      let args = path[i5].toString().split(".");
      for (let j2 = 0; j2 < args.length; j2++) {
        parts.push(args[j2]);
      }
    }
    return parts.join(".");
  } else {
    return path;
  }
}
function split(path) {
  if (Array.isArray(path)) {
    return normalize(path).split(".");
  }
  return path.toString().split(".");
}
function get(root2, path, info) {
  let prop = root2;
  let parts = split(path);
  for (let i5 = 0; i5 < parts.length; i5++) {
    if (!prop) {
      return;
    }
    let part = parts[i5];
    prop = prop[part];
  }
  if (info) {
    info.path = parts.join(".");
  }
  return prop;
}
function set(root2, path, value) {
  let prop = root2;
  let parts = split(path);
  let last = parts[parts.length - 1];
  if (parts.length > 1) {
    for (let i5 = 0; i5 < parts.length - 1; i5++) {
      let part = parts[i5];
      prop = prop[part];
      if (!prop) {
        return;
      }
    }
    prop[last] = value;
  } else {
    prop[path] = value;
  }
  return parts.join(".");
}

// node_modules/@polymer/polymer/lib/utils/case-map.js
var caseMap = {};
var DASH_TO_CAMEL = /-[a-z]/g;
var CAMEL_TO_DASH = /([A-Z])/g;
function dashToCamelCase2(dash) {
  return caseMap[dash] || (caseMap[dash] = dash.indexOf("-") < 0 ? dash : dash.replace(
    DASH_TO_CAMEL,
    (m2) => m2[1].toUpperCase()
  ));
}
function camelToDashCase(camel) {
  return caseMap[camel] || (caseMap[camel] = camel.replace(CAMEL_TO_DASH, "-$1").toLowerCase());
}

// node_modules/@polymer/polymer/lib/utils/async.js
var microtaskCurrHandle = 0;
var microtaskLastHandle = 0;
var microtaskCallbacks = [];
var microtaskNodeContent = 0;
var microtaskScheduled = false;
var microtaskNode = document.createTextNode("");
new window.MutationObserver(microtaskFlush).observe(microtaskNode, { characterData: true });
function microtaskFlush() {
  microtaskScheduled = false;
  const len = microtaskCallbacks.length;
  for (let i5 = 0; i5 < len; i5++) {
    let cb = microtaskCallbacks[i5];
    if (cb) {
      try {
        cb();
      } catch (e4) {
        setTimeout(() => {
          throw e4;
        });
      }
    }
  }
  microtaskCallbacks.splice(0, len);
  microtaskLastHandle += len;
}
var microTask = {
  /**
   * Enqueues a function called at microtask timing.
   *
   * @memberof microTask
   * @param {!Function=} callback Callback to run
   * @return {number} Handle used for canceling task
   */
  run(callback) {
    if (!microtaskScheduled) {
      microtaskScheduled = true;
      microtaskNode.textContent = microtaskNodeContent++;
    }
    microtaskCallbacks.push(callback);
    return microtaskCurrHandle++;
  },
  /**
   * Cancels a previously enqueued `microTask` callback.
   *
   * @memberof microTask
   * @param {number} handle Handle returned from `run` of callback to cancel
   * @return {void}
   */
  cancel(handle) {
    const idx = handle - microtaskLastHandle;
    if (idx >= 0) {
      if (!microtaskCallbacks[idx]) {
        throw new Error("invalid async handle: " + handle);
      }
      microtaskCallbacks[idx] = null;
    }
  }
};

// node_modules/@polymer/polymer/lib/mixins/properties-changed.js
var microtask = microTask;
var PropertiesChanged = dedupingMixin(
  /**
   * @template T
   * @param {function(new:T)} superClass Class to apply mixin to.
   * @return {function(new:T)} superClass with mixin applied.
   */
  (superClass) => {
    class PropertiesChanged2 extends superClass {
      /**
       * Creates property accessors for the given property names.
       * @param {!Object} props Object whose keys are names of accessors.
       * @return {void}
       * @protected
       * @nocollapse
       */
      static createProperties(props) {
        const proto2 = this.prototype;
        for (let prop in props) {
          if (!(prop in proto2)) {
            proto2._createPropertyAccessor(prop);
          }
        }
      }
      /**
       * Returns an attribute name that corresponds to the given property.
       * The attribute name is the lowercased property name. Override to
       * customize this mapping.
       * @param {string} property Property to convert
       * @return {string} Attribute name corresponding to the given property.
       *
       * @protected
       * @nocollapse
       */
      static attributeNameForProperty(property) {
        return property.toLowerCase();
      }
      /**
       * Override point to provide a type to which to deserialize a value to
       * a given property.
       * @param {string} name Name of property
       *
       * @protected
       * @nocollapse
       */
      static typeForProperty(name) {
      }
      //eslint-disable-line no-unused-vars
      /**
       * Creates a setter/getter pair for the named property with its own
       * local storage.  The getter returns the value in the local storage,
       * and the setter calls `_setProperty`, which updates the local storage
       * for the property and enqueues a `_propertiesChanged` callback.
       *
       * This method may be called on a prototype or an instance.  Calling
       * this method may overwrite a property value that already exists on
       * the prototype/instance by creating the accessor.
       *
       * @param {string} property Name of the property
       * @param {boolean=} readOnly When true, no setter is created; the
       *   protected `_setProperty` function must be used to set the property
       * @return {void}
       * @protected
       * @override
       */
      _createPropertyAccessor(property, readOnly) {
        this._addPropertyToAttributeMap(property);
        if (!this.hasOwnProperty(JSCompiler_renameProperty("__dataHasAccessor", this))) {
          this.__dataHasAccessor = Object.assign({}, this.__dataHasAccessor);
        }
        if (!this.__dataHasAccessor[property]) {
          this.__dataHasAccessor[property] = true;
          this._definePropertyAccessor(property, readOnly);
        }
      }
      /**
       * Adds the given `property` to a map matching attribute names
       * to property names, using `attributeNameForProperty`. This map is
       * used when deserializing attribute values to properties.
       *
       * @param {string} property Name of the property
       * @override
       */
      _addPropertyToAttributeMap(property) {
        if (!this.hasOwnProperty(JSCompiler_renameProperty("__dataAttributes", this))) {
          this.__dataAttributes = Object.assign({}, this.__dataAttributes);
        }
        let attr = this.__dataAttributes[property];
        if (!attr) {
          attr = this.constructor.attributeNameForProperty(property);
          this.__dataAttributes[attr] = property;
        }
        return attr;
      }
      /**
       * Defines a property accessor for the given property.
       * @param {string} property Name of the property
       * @param {boolean=} readOnly When true, no setter is created
       * @return {void}
       * @override
       */
      _definePropertyAccessor(property, readOnly) {
        Object.defineProperty(this, property, {
          /* eslint-disable valid-jsdoc */
          /** @this {PropertiesChanged} */
          get() {
            return this.__data[property];
          },
          /** @this {PropertiesChanged} */
          set: readOnly ? function() {
          } : function(value) {
            if (this._setPendingProperty(property, value, true)) {
              this._invalidateProperties();
            }
          }
          /* eslint-enable */
        });
      }
      constructor() {
        super();
        this.__dataEnabled = false;
        this.__dataReady = false;
        this.__dataInvalid = false;
        this.__data = {};
        this.__dataPending = null;
        this.__dataOld = null;
        this.__dataInstanceProps = null;
        this.__dataCounter = 0;
        this.__serializing = false;
        this._initializeProperties();
      }
      /**
       * Lifecycle callback called when properties are enabled via
       * `_enableProperties`.
       *
       * Users may override this function to implement behavior that is
       * dependent on the element having its property data initialized, e.g.
       * from defaults (initialized from `constructor`, `_initializeProperties`),
       * `attributeChangedCallback`, or values propagated from host e.g. via
       * bindings.  `super.ready()` must be called to ensure the data system
       * becomes enabled.
       *
       * @return {void}
       * @public
       * @override
       */
      ready() {
        this.__dataReady = true;
        this._flushProperties();
      }
      /**
       * Initializes the local storage for property accessors.
       *
       * Provided as an override point for performing any setup work prior
       * to initializing the property accessor system.
       *
       * @return {void}
       * @protected
       * @override
       */
      _initializeProperties() {
        for (let p3 in this.__dataHasAccessor) {
          if (this.hasOwnProperty(p3)) {
            this.__dataInstanceProps = this.__dataInstanceProps || {};
            this.__dataInstanceProps[p3] = this[p3];
            delete this[p3];
          }
        }
      }
      /**
       * Called at ready time with bag of instance properties that overwrote
       * accessors when the element upgraded.
       *
       * The default implementation sets these properties back into the
       * setter at ready time.  This method is provided as an override
       * point for customizing or providing more efficient initialization.
       *
       * @param {Object} props Bag of property values that were overwritten
       *   when creating property accessors.
       * @return {void}
       * @protected
       * @override
       */
      _initializeInstanceProperties(props) {
        Object.assign(this, props);
      }
      /**
       * Updates the local storage for a property (via `_setPendingProperty`)
       * and enqueues a `_proeprtiesChanged` callback.
       *
       * @param {string} property Name of the property
       * @param {*} value Value to set
       * @return {void}
       * @protected
       * @override
       */
      _setProperty(property, value) {
        if (this._setPendingProperty(property, value)) {
          this._invalidateProperties();
        }
      }
      /**
       * Returns the value for the given property.
       * @param {string} property Name of property
       * @return {*} Value for the given property
       * @protected
       * @override
       */
      _getProperty(property) {
        return this.__data[property];
      }
      /* eslint-disable no-unused-vars */
      /**
       * Updates the local storage for a property, records the previous value,
       * and adds it to the set of "pending changes" that will be passed to the
       * `_propertiesChanged` callback.  This method does not enqueue the
       * `_propertiesChanged` callback.
       *
       * @param {string} property Name of the property
       * @param {*} value Value to set
       * @param {boolean=} ext Not used here; affordance for closure
       * @return {boolean} Returns true if the property changed
       * @protected
       * @override
       */
      _setPendingProperty(property, value, ext) {
        let old = this.__data[property];
        let changed = this._shouldPropertyChange(property, value, old);
        if (changed) {
          if (!this.__dataPending) {
            this.__dataPending = {};
            this.__dataOld = {};
          }
          if (this.__dataOld && !(property in this.__dataOld)) {
            this.__dataOld[property] = old;
          }
          this.__data[property] = value;
          this.__dataPending[property] = value;
        }
        return changed;
      }
      /* eslint-enable */
      /**
       * @param {string} property Name of the property
       * @return {boolean} Returns true if the property is pending.
       */
      _isPropertyPending(property) {
        return !!(this.__dataPending && this.__dataPending.hasOwnProperty(property));
      }
      /**
       * Marks the properties as invalid, and enqueues an async
       * `_propertiesChanged` callback.
       *
       * @return {void}
       * @protected
       * @override
       */
      _invalidateProperties() {
        if (!this.__dataInvalid && this.__dataReady) {
          this.__dataInvalid = true;
          microtask.run(() => {
            if (this.__dataInvalid) {
              this.__dataInvalid = false;
              this._flushProperties();
            }
          });
        }
      }
      /**
       * Call to enable property accessor processing. Before this method is
       * called accessor values will be set but side effects are
       * queued. When called, any pending side effects occur immediately.
       * For elements, generally `connectedCallback` is a normal spot to do so.
       * It is safe to call this method multiple times as it only turns on
       * property accessors once.
       *
       * @return {void}
       * @protected
       * @override
       */
      _enableProperties() {
        if (!this.__dataEnabled) {
          this.__dataEnabled = true;
          if (this.__dataInstanceProps) {
            this._initializeInstanceProperties(this.__dataInstanceProps);
            this.__dataInstanceProps = null;
          }
          this.ready();
        }
      }
      /**
       * Calls the `_propertiesChanged` callback with the current set of
       * pending changes (and old values recorded when pending changes were
       * set), and resets the pending set of changes. Generally, this method
       * should not be called in user code.
       *
       * @return {void}
       * @protected
       * @override
       */
      _flushProperties() {
        this.__dataCounter++;
        const props = this.__data;
        const changedProps = this.__dataPending;
        const old = this.__dataOld;
        if (this._shouldPropertiesChange(props, changedProps, old)) {
          this.__dataPending = null;
          this.__dataOld = null;
          this._propertiesChanged(props, changedProps, old);
        }
        this.__dataCounter--;
      }
      /**
       * Called in `_flushProperties` to determine if `_propertiesChanged`
       * should be called. The default implementation returns true if
       * properties are pending. Override to customize when
       * `_propertiesChanged` is called.
       * @param {!Object} currentProps Bag of all current accessor values
       * @param {?Object} changedProps Bag of properties changed since the last
       *   call to `_propertiesChanged`
       * @param {?Object} oldProps Bag of previous values for each property
       *   in `changedProps`
       * @return {boolean} true if changedProps is truthy
       * @override
       */
      _shouldPropertiesChange(currentProps, changedProps, oldProps) {
        return Boolean(changedProps);
      }
      /**
       * Callback called when any properties with accessors created via
       * `_createPropertyAccessor` have been set.
       *
       * @param {!Object} currentProps Bag of all current accessor values
       * @param {?Object} changedProps Bag of properties changed since the last
       *   call to `_propertiesChanged`
       * @param {?Object} oldProps Bag of previous values for each property
       *   in `changedProps`
       * @return {void}
       * @protected
       * @override
       */
      _propertiesChanged(currentProps, changedProps, oldProps) {
      }
      /**
       * Method called to determine whether a property value should be
       * considered as a change and cause the `_propertiesChanged` callback
       * to be enqueued.
       *
       * The default implementation returns `true` if a strict equality
       * check fails. The method always returns false for `NaN`.
       *
       * Override this method to e.g. provide stricter checking for
       * Objects/Arrays when using immutable patterns.
       *
       * @param {string} property Property name
       * @param {*} value New property value
       * @param {*} old Previous property value
       * @return {boolean} Whether the property should be considered a change
       *   and enqueue a `_proeprtiesChanged` callback
       * @protected
       * @override
       */
      _shouldPropertyChange(property, value, old) {
        return (
          // Strict equality check
          old !== value && // This ensures (old==NaN, value==NaN) always returns false
          (old === old || value === value)
        );
      }
      /**
       * Implements native Custom Elements `attributeChangedCallback` to
       * set an attribute value to a property via `_attributeToProperty`.
       *
       * @param {string} name Name of attribute that changed
       * @param {?string} old Old attribute value
       * @param {?string} value New attribute value
       * @param {?string} namespace Attribute namespace.
       * @return {void}
       * @suppress {missingProperties} Super may or may not implement the callback
       * @override
       */
      attributeChangedCallback(name, old, value, namespace) {
        if (old !== value) {
          this._attributeToProperty(name, value);
        }
        if (super.attributeChangedCallback) {
          super.attributeChangedCallback(name, old, value, namespace);
        }
      }
      /**
       * Deserializes an attribute to its associated property.
       *
       * This method calls the `_deserializeValue` method to convert the string to
       * a typed value.
       *
       * @param {string} attribute Name of attribute to deserialize.
       * @param {?string} value of the attribute.
       * @param {*=} type type to deserialize to, defaults to the value
       * returned from `typeForProperty`
       * @return {void}
       * @override
       */
      _attributeToProperty(attribute, value, type) {
        if (!this.__serializing) {
          const map = this.__dataAttributes;
          const property = map && map[attribute] || attribute;
          this[property] = this._deserializeValue(value, type || this.constructor.typeForProperty(property));
        }
      }
      /**
       * Serializes a property to its associated attribute.
       *
       * @suppress {invalidCasts} Closure can't figure out `this` is an element.
       *
       * @param {string} property Property name to reflect.
       * @param {string=} attribute Attribute name to reflect to.
       * @param {*=} value Property value to refect.
       * @return {void}
       * @override
       */
      _propertyToAttribute(property, attribute, value) {
        this.__serializing = true;
        value = arguments.length < 3 ? this[property] : value;
        this._valueToNodeAttribute(
          /** @type {!HTMLElement} */
          this,
          value,
          attribute || this.constructor.attributeNameForProperty(property)
        );
        this.__serializing = false;
      }
      /**
       * Sets a typed value to an HTML attribute on a node.
       *
       * This method calls the `_serializeValue` method to convert the typed
       * value to a string.  If the `_serializeValue` method returns `undefined`,
       * the attribute will be removed (this is the default for boolean
       * type `false`).
       *
       * @param {Element} node Element to set attribute to.
       * @param {*} value Value to serialize.
       * @param {string} attribute Attribute name to serialize to.
       * @return {void}
       * @override
       */
      _valueToNodeAttribute(node, value, attribute) {
        const str = this._serializeValue(value);
        if (attribute === "class" || attribute === "name" || attribute === "slot") {
          node = /** @type {?Element} */
          wrap(node);
        }
        if (str === void 0) {
          node.removeAttribute(attribute);
        } else {
          node.setAttribute(
            attribute,
            // Closure's type for `setAttribute`'s second parameter incorrectly
            // excludes `TrustedScript`.
            str === "" && window.trustedTypes ? (
              /** @type {?} */
              window.trustedTypes.emptyScript
            ) : str
          );
        }
      }
      /**
       * Converts a typed JavaScript value to a string.
       *
       * This method is called when setting JS property values to
       * HTML attributes.  Users may override this method to provide
       * serialization for custom types.
       *
       * @param {*} value Property value to serialize.
       * @return {string | undefined} String serialized from the provided
       * property  value.
       * @override
       */
      _serializeValue(value) {
        switch (typeof value) {
          case "boolean":
            return value ? "" : void 0;
          default:
            return value != null ? value.toString() : void 0;
        }
      }
      /**
       * Converts a string to a typed JavaScript value.
       *
       * This method is called when reading HTML attribute values to
       * JS properties.  Users may override this method to provide
       * deserialization for custom `type`s. Types for `Boolean`, `String`,
       * and `Number` convert attributes to the expected types.
       *
       * @param {?string} value Value to deserialize.
       * @param {*=} type Type to deserialize the string to.
       * @return {*} Typed value deserialized from the provided string.
       * @override
       */
      _deserializeValue(value, type) {
        switch (type) {
          case Boolean:
            return value !== null;
          case Number:
            return Number(value);
          default:
            return value;
        }
      }
    }
    return PropertiesChanged2;
  }
);

// node_modules/@polymer/polymer/lib/mixins/property-accessors.js
var nativeProperties = {};
var proto = HTMLElement.prototype;
while (proto) {
  let props = Object.getOwnPropertyNames(proto);
  for (let i5 = 0; i5 < props.length; i5++) {
    nativeProperties[props[i5]] = true;
  }
  proto = Object.getPrototypeOf(proto);
}
var isTrustedType = (() => {
  if (!window.trustedTypes) {
    return () => false;
  }
  return (val) => trustedTypes.isHTML(val) || trustedTypes.isScript(val) || trustedTypes.isScriptURL(val);
})();
function saveAccessorValue(model, property) {
  if (!nativeProperties[property]) {
    let value = model[property];
    if (value !== void 0) {
      if (model.__data) {
        model._setPendingProperty(property, value);
      } else {
        if (!model.__dataProto) {
          model.__dataProto = {};
        } else if (!model.hasOwnProperty(JSCompiler_renameProperty("__dataProto", model))) {
          model.__dataProto = Object.create(model.__dataProto);
        }
        model.__dataProto[property] = value;
      }
    }
  }
}
var PropertyAccessors = dedupingMixin((superClass) => {
  const base = PropertiesChanged(superClass);
  class PropertyAccessors2 extends base {
    /**
     * Generates property accessors for all attributes in the standard
     * static `observedAttributes` array.
     *
     * Attribute names are mapped to property names using the `dash-case` to
     * `camelCase` convention
     *
     * @return {void}
     * @nocollapse
     */
    static createPropertiesForAttributes() {
      let a$ = (
        /** @type {?} */
        this.observedAttributes
      );
      for (let i5 = 0; i5 < a$.length; i5++) {
        this.prototype._createPropertyAccessor(dashToCamelCase2(a$[i5]));
      }
    }
    /**
     * Returns an attribute name that corresponds to the given property.
     * By default, converts camel to dash case, e.g. `fooBar` to `foo-bar`.
     * @param {string} property Property to convert
     * @return {string} Attribute name corresponding to the given property.
     *
     * @protected
     * @nocollapse
     */
    static attributeNameForProperty(property) {
      return camelToDashCase(property);
    }
    /**
     * Overrides PropertiesChanged implementation to initialize values for
     * accessors created for values that already existed on the element
     * prototype.
     *
     * @return {void}
     * @protected
     * @override
     */
    _initializeProperties() {
      if (this.__dataProto) {
        this._initializeProtoProperties(this.__dataProto);
        this.__dataProto = null;
      }
      super._initializeProperties();
    }
    /**
     * Called at instance time with bag of properties that were overwritten
     * by accessors on the prototype when accessors were created.
     *
     * The default implementation sets these properties back into the
     * setter at instance time.  This method is provided as an override
     * point for customizing or providing more efficient initialization.
     *
     * @param {Object} props Bag of property values that were overwritten
     *   when creating property accessors.
     * @return {void}
     * @protected
     * @override
     */
    _initializeProtoProperties(props) {
      for (let p3 in props) {
        this._setProperty(p3, props[p3]);
      }
    }
    /**
     * Ensures the element has the given attribute. If it does not,
     * assigns the given value to the attribute.
     *
     * @suppress {invalidCasts} Closure can't figure out `this` is infact an
     *     element
     *
     * @param {string} attribute Name of attribute to ensure is set.
     * @param {string} value of the attribute.
     * @return {void}
     * @override
     */
    _ensureAttribute(attribute, value) {
      const el = (
        /** @type {!HTMLElement} */
        this
      );
      if (!el.hasAttribute(attribute)) {
        this._valueToNodeAttribute(el, value, attribute);
      }
    }
    /**
     * Overrides PropertiesChanged implemention to serialize objects as JSON.
     *
     * @param {*} value Property value to serialize.
     * @return {string | undefined} String serialized from the provided property
     *     value.
     * @override
     */
    _serializeValue(value) {
      switch (typeof value) {
        case "object":
          if (value instanceof Date) {
            return value.toString();
          } else if (value) {
            if (isTrustedType(value)) {
              return (
                /** @type {?} */
                value
              );
            }
            try {
              return JSON.stringify(value);
            } catch (x2) {
              return "";
            }
          }
        default:
          return super._serializeValue(value);
      }
    }
    /**
     * Converts a string to a typed JavaScript value.
     *
     * This method is called by Polymer when reading HTML attribute values to
     * JS properties.  Users may override this method on Polymer element
     * prototypes to provide deserialization for custom `type`s.  Note,
     * the `type` argument is the value of the `type` field provided in the
     * `properties` configuration object for a given property, and is
     * by convention the constructor for the type to deserialize.
     *
     *
     * @param {?string} value Attribute value to deserialize.
     * @param {*=} type Type to deserialize the string to.
     * @return {*} Typed value deserialized from the provided string.
     * @override
     */
    _deserializeValue(value, type) {
      let outValue;
      switch (type) {
        case Object:
          try {
            outValue = JSON.parse(
              /** @type {string} */
              value
            );
          } catch (x2) {
            outValue = value;
          }
          break;
        case Array:
          try {
            outValue = JSON.parse(
              /** @type {string} */
              value
            );
          } catch (x2) {
            outValue = null;
            console.warn(`Polymer::Attributes: couldn't decode Array as JSON: ${value}`);
          }
          break;
        case Date:
          outValue = isNaN(value) ? String(value) : Number(value);
          outValue = new Date(outValue);
          break;
        default:
          outValue = super._deserializeValue(value, type);
          break;
      }
      return outValue;
    }
    /* eslint-enable no-fallthrough */
    /**
     * Overrides PropertiesChanged implementation to save existing prototype
     * property value so that it can be reset.
     * @param {string} property Name of the property
     * @param {boolean=} readOnly When true, no setter is created
     *
     * When calling on a prototype, any overwritten values are saved in
     * `__dataProto`, and it is up to the subclasser to decide how/when
     * to set those properties back into the accessor.  When calling on an
     * instance, the overwritten value is set via `_setPendingProperty`,
     * and the user should call `_invalidateProperties` or `_flushProperties`
     * for the values to take effect.
     * @protected
     * @return {void}
     * @override
     */
    _definePropertyAccessor(property, readOnly) {
      saveAccessorValue(this, property);
      super._definePropertyAccessor(property, readOnly);
    }
    /**
     * Returns true if this library created an accessor for the given property.
     *
     * @param {string} property Property name
     * @return {boolean} True if an accessor was created
     * @override
     */
    _hasAccessor(property) {
      return this.__dataHasAccessor && this.__dataHasAccessor[property];
    }
    /**
     * Returns true if the specified property has a pending change.
     *
     * @param {string} prop Property name
     * @return {boolean} True if property has a pending change
     * @protected
     * @override
     */
    _isPropertyPending(prop) {
      return Boolean(this.__dataPending && prop in this.__dataPending);
    }
  }
  return PropertyAccessors2;
});

// node_modules/@polymer/polymer/lib/mixins/template-stamp.js
var templateExtensions = {
  "dom-if": true,
  "dom-repeat": true
};
var placeholderBugDetect = false;
var placeholderBug = false;
function hasPlaceholderBug() {
  if (!placeholderBugDetect) {
    placeholderBugDetect = true;
    const t3 = document.createElement("textarea");
    t3.placeholder = "a";
    placeholderBug = t3.placeholder === t3.textContent;
  }
  return placeholderBug;
}
function fixPlaceholder(node) {
  if (hasPlaceholderBug() && node.localName === "textarea" && node.placeholder && node.placeholder === node.textContent) {
    node.textContent = null;
  }
}
var copyAttributeWithTemplateEventPolicy = (() => {
  const polymerTemplateEventAttributePolicy = window.trustedTypes && window.trustedTypes.createPolicy(
    "polymer-template-event-attribute-policy",
    {
      createScript: (x2) => x2
    }
  );
  return (dest, src, name) => {
    const value = src.getAttribute(name);
    if (polymerTemplateEventAttributePolicy && name.startsWith("on-")) {
      dest.setAttribute(
        name,
        polymerTemplateEventAttributePolicy.createScript(value, name)
      );
      return;
    }
    dest.setAttribute(name, value);
  };
})();
function wrapTemplateExtension(node) {
  let is = node.getAttribute("is");
  if (is && templateExtensions[is]) {
    let t3 = node;
    t3.removeAttribute("is");
    node = t3.ownerDocument.createElement(is);
    t3.parentNode.replaceChild(node, t3);
    node.appendChild(t3);
    while (t3.attributes.length) {
      const { name } = t3.attributes[0];
      copyAttributeWithTemplateEventPolicy(node, t3, name);
      t3.removeAttribute(name);
    }
  }
  return node;
}
function findTemplateNode(root2, nodeInfo) {
  let parent = nodeInfo.parentInfo && findTemplateNode(root2, nodeInfo.parentInfo);
  if (parent) {
    for (let n4 = parent.firstChild, i5 = 0; n4; n4 = n4.nextSibling) {
      if (nodeInfo.parentIndex === i5++) {
        return n4;
      }
    }
  } else {
    return root2;
  }
}
function applyIdToMap(inst, map, node, nodeInfo) {
  if (nodeInfo.id) {
    map[nodeInfo.id] = node;
  }
}
function applyEventListener(inst, node, nodeInfo) {
  if (nodeInfo.events && nodeInfo.events.length) {
    for (let j2 = 0, e$ = nodeInfo.events, e4; j2 < e$.length && (e4 = e$[j2]); j2++) {
      inst._addMethodEventListenerToNode(node, e4.name, e4.value, inst);
    }
  }
}
function applyTemplateInfo(inst, node, nodeInfo, parentTemplateInfo) {
  if (nodeInfo.templateInfo) {
    node._templateInfo = nodeInfo.templateInfo;
    node._parentTemplateInfo = parentTemplateInfo;
  }
}
function createNodeEventHandler(context, eventName, methodName) {
  context = context._methodHost || context;
  let handler = function(e4) {
    if (context[methodName]) {
      context[methodName](e4, e4.detail);
    } else {
      console.warn("listener method `" + methodName + "` not defined");
    }
  };
  return handler;
}
var TemplateStamp = dedupingMixin(
  /**
   * @template T
   * @param {function(new:T)} superClass Class to apply mixin to.
   * @return {function(new:T)} superClass with mixin applied.
   */
  (superClass) => {
    class TemplateStamp2 extends superClass {
      /**
       * Scans a template to produce template metadata.
       *
       * Template-specific metadata are stored in the object returned, and node-
       * specific metadata are stored in objects in its flattened `nodeInfoList`
       * array.  Only nodes in the template that were parsed as nodes of
       * interest contain an object in `nodeInfoList`.  Each `nodeInfo` object
       * contains an `index` (`childNodes` index in parent) and optionally
       * `parent`, which points to node info of its parent (including its index).
       *
       * The template metadata object returned from this method has the following
       * structure (many fields optional):
       *
       * ```js
       *   {
       *     // Flattened list of node metadata (for nodes that generated metadata)
       *     nodeInfoList: [
       *       {
       *         // `id` attribute for any nodes with id's for generating `$` map
       *         id: {string},
       *         // `on-event="handler"` metadata
       *         events: [
       *           {
       *             name: {string},   // event name
       *             value: {string},  // handler method name
       *           }, ...
       *         ],
       *         // Notes when the template contained a `<slot>` for shady DOM
       *         // optimization purposes
       *         hasInsertionPoint: {boolean},
       *         // For nested `<template>`` nodes, nested template metadata
       *         templateInfo: {object}, // nested template metadata
       *         // Metadata to allow efficient retrieval of instanced node
       *         // corresponding to this metadata
       *         parentInfo: {number},   // reference to parent nodeInfo>
       *         parentIndex: {number},  // index in parent's `childNodes` collection
       *         infoIndex: {number},    // index of this `nodeInfo` in `templateInfo.nodeInfoList`
       *       },
       *       ...
       *     ],
       *     // When true, the template had the `strip-whitespace` attribute
       *     // or was nested in a template with that setting
       *     stripWhitespace: {boolean},
       *     // For nested templates, nested template content is moved into
       *     // a document fragment stored here; this is an optimization to
       *     // avoid the cost of nested template cloning
       *     content: {DocumentFragment}
       *   }
       * ```
       *
       * This method kicks off a recursive treewalk as follows:
       *
       * ```
       *    _parseTemplate <---------------------+
       *      _parseTemplateContent              |
       *        _parseTemplateNode  <------------|--+
       *          _parseTemplateNestedTemplate --+  |
       *          _parseTemplateChildNodes ---------+
       *          _parseTemplateNodeAttributes
       *            _parseTemplateNodeAttribute
       *
       * ```
       *
       * These methods may be overridden to add custom metadata about templates
       * to either `templateInfo` or `nodeInfo`.
       *
       * Note that this method may be destructive to the template, in that
       * e.g. event annotations may be removed after being noted in the
       * template metadata.
       *
       * @param {!HTMLTemplateElement} template Template to parse
       * @param {TemplateInfo=} outerTemplateInfo Template metadata from the outer
       *   template, for parsing nested templates
       * @return {!TemplateInfo} Parsed template metadata
       * @nocollapse
       */
      static _parseTemplate(template, outerTemplateInfo) {
        if (!template._templateInfo) {
          let templateInfo = template._templateInfo = {};
          templateInfo.nodeInfoList = [];
          templateInfo.nestedTemplate = Boolean(outerTemplateInfo);
          templateInfo.stripWhiteSpace = outerTemplateInfo && outerTemplateInfo.stripWhiteSpace || template.hasAttribute && template.hasAttribute("strip-whitespace");
          this._parseTemplateContent(
            template,
            templateInfo,
            /** @type {?} */
            { parent: null }
          );
        }
        return template._templateInfo;
      }
      /**
       * See docs for _parseTemplateNode.
       *
       * @param {!HTMLTemplateElement} template .
       * @param {!TemplateInfo} templateInfo .
       * @param {!NodeInfo} nodeInfo .
       * @return {boolean} .
       * @nocollapse
       */
      static _parseTemplateContent(template, templateInfo, nodeInfo) {
        return this._parseTemplateNode(template.content, templateInfo, nodeInfo);
      }
      /**
       * Parses template node and adds template and node metadata based on
       * the current node, and its `childNodes` and `attributes`.
       *
       * This method may be overridden to add custom node or template specific
       * metadata based on this node.
       *
       * @param {Node} node Node to parse
       * @param {!TemplateInfo} templateInfo Template metadata for current template
       * @param {!NodeInfo} nodeInfo Node metadata for current template.
       * @return {boolean} `true` if the visited node added node-specific
       *   metadata to `nodeInfo`
       * @nocollapse
       */
      static _parseTemplateNode(node, templateInfo, nodeInfo) {
        let noted = false;
        let element = (
          /** @type {!HTMLTemplateElement} */
          node
        );
        if (element.localName == "template" && !element.hasAttribute("preserve-content")) {
          noted = this._parseTemplateNestedTemplate(element, templateInfo, nodeInfo) || noted;
        } else if (element.localName === "slot") {
          templateInfo.hasInsertionPoint = true;
        }
        fixPlaceholder(element);
        if (element.firstChild) {
          this._parseTemplateChildNodes(element, templateInfo, nodeInfo);
        }
        if (element.hasAttributes && element.hasAttributes()) {
          noted = this._parseTemplateNodeAttributes(element, templateInfo, nodeInfo) || noted;
        }
        return noted || nodeInfo.noted;
      }
      /**
       * Parses template child nodes for the given root node.
       *
       * This method also wraps whitelisted legacy template extensions
       * (`is="dom-if"` and `is="dom-repeat"`) with their equivalent element
       * wrappers, collapses text nodes, and strips whitespace from the template
       * if the `templateInfo.stripWhitespace` setting was provided.
       *
       * @param {Node} root Root node whose `childNodes` will be parsed
       * @param {!TemplateInfo} templateInfo Template metadata for current template
       * @param {!NodeInfo} nodeInfo Node metadata for current template.
       * @return {void}
       */
      static _parseTemplateChildNodes(root2, templateInfo, nodeInfo) {
        if (root2.localName === "script" || root2.localName === "style") {
          return;
        }
        for (let node = root2.firstChild, parentIndex = 0, next; node; node = next) {
          if (node.localName == "template") {
            node = wrapTemplateExtension(node);
          }
          next = node.nextSibling;
          if (node.nodeType === Node.TEXT_NODE) {
            let n4 = next;
            while (n4 && n4.nodeType === Node.TEXT_NODE) {
              node.textContent += n4.textContent;
              next = n4.nextSibling;
              root2.removeChild(n4);
              n4 = next;
            }
            if (templateInfo.stripWhiteSpace && !node.textContent.trim()) {
              root2.removeChild(node);
              continue;
            }
          }
          let childInfo = (
            /** @type {!NodeInfo} */
            { parentIndex, parentInfo: nodeInfo }
          );
          if (this._parseTemplateNode(node, templateInfo, childInfo)) {
            childInfo.infoIndex = templateInfo.nodeInfoList.push(childInfo) - 1;
          }
          if (node.parentNode) {
            parentIndex++;
          }
        }
      }
      /**
       * Parses template content for the given nested `<template>`.
       *
       * Nested template info is stored as `templateInfo` in the current node's
       * `nodeInfo`. `template.content` is removed and stored in `templateInfo`.
       * It will then be the responsibility of the host to set it back to the
       * template and for users stamping nested templates to use the
       * `_contentForTemplate` method to retrieve the content for this template
       * (an optimization to avoid the cost of cloning nested template content).
       *
       * @param {HTMLTemplateElement} node Node to parse (a <template>)
       * @param {TemplateInfo} outerTemplateInfo Template metadata for current template
       *   that includes the template `node`
       * @param {!NodeInfo} nodeInfo Node metadata for current template.
       * @return {boolean} `true` if the visited node added node-specific
       *   metadata to `nodeInfo`
       * @nocollapse
       */
      static _parseTemplateNestedTemplate(node, outerTemplateInfo, nodeInfo) {
        let element = (
          /** @type {!HTMLTemplateElement} */
          node
        );
        let templateInfo = this._parseTemplate(element, outerTemplateInfo);
        let content = templateInfo.content = element.content.ownerDocument.createDocumentFragment();
        content.appendChild(element.content);
        nodeInfo.templateInfo = templateInfo;
        return true;
      }
      /**
       * Parses template node attributes and adds node metadata to `nodeInfo`
       * for nodes of interest.
       *
       * @param {Element} node Node to parse
       * @param {!TemplateInfo} templateInfo Template metadata for current
       *     template
       * @param {!NodeInfo} nodeInfo Node metadata for current template.
       * @return {boolean} `true` if the visited node added node-specific
       *   metadata to `nodeInfo`
       * @nocollapse
       */
      static _parseTemplateNodeAttributes(node, templateInfo, nodeInfo) {
        let noted = false;
        let attrs = Array.from(node.attributes);
        for (let i5 = attrs.length - 1, a3; a3 = attrs[i5]; i5--) {
          noted = this._parseTemplateNodeAttribute(node, templateInfo, nodeInfo, a3.name, a3.value) || noted;
        }
        return noted;
      }
      /**
       * Parses a single template node attribute and adds node metadata to
       * `nodeInfo` for attributes of interest.
       *
       * This implementation adds metadata for `on-event="handler"` attributes
       * and `id` attributes.
       *
       * @param {Element} node Node to parse
       * @param {!TemplateInfo} templateInfo Template metadata for current template
       * @param {!NodeInfo} nodeInfo Node metadata for current template.
       * @param {string} name Attribute name
       * @param {string} value Attribute value
       * @return {boolean} `true` if the visited node added node-specific
       *   metadata to `nodeInfo`
       * @nocollapse
       */
      static _parseTemplateNodeAttribute(node, templateInfo, nodeInfo, name, value) {
        if (name.slice(0, 3) === "on-") {
          node.removeAttribute(name);
          nodeInfo.events = nodeInfo.events || [];
          nodeInfo.events.push({
            name: name.slice(3),
            value
          });
          return true;
        } else if (name === "id") {
          nodeInfo.id = value;
          return true;
        }
        return false;
      }
      /**
       * Returns the `content` document fragment for a given template.
       *
       * For nested templates, Polymer performs an optimization to cache nested
       * template content to avoid the cost of cloning deeply nested templates.
       * This method retrieves the cached content for a given template.
       *
       * @param {HTMLTemplateElement} template Template to retrieve `content` for
       * @return {DocumentFragment} Content fragment
       * @nocollapse
       */
      static _contentForTemplate(template) {
        let templateInfo = (
          /** @type {HTMLTemplateElementWithInfo} */
          template._templateInfo
        );
        return templateInfo && templateInfo.content || template.content;
      }
      /**
       * Clones the provided template content and returns a document fragment
       * containing the cloned dom.
       *
       * The template is parsed (once and memoized) using this library's
       * template parsing features, and provides the following value-added
       * features:
       * * Adds declarative event listeners for `on-event="handler"` attributes
       * * Generates an "id map" for all nodes with id's under `$` on returned
       *   document fragment
       * * Passes template info including `content` back to templates as
       *   `_templateInfo` (a performance optimization to avoid deep template
       *   cloning)
       *
       * Note that the memoized template parsing process is destructive to the
       * template: attributes for bindings and declarative event listeners are
       * removed after being noted in notes, and any nested `<template>.content`
       * is removed and stored in notes as well.
       *
       * @param {!HTMLTemplateElement} template Template to stamp
       * @param {TemplateInfo=} templateInfo Optional template info associated
       *   with the template to be stamped; if omitted the template will be
       *   automatically parsed.
       * @return {!StampedTemplate} Cloned template content
       * @override
       */
      _stampTemplate(template, templateInfo) {
        if (template && !template.content && window.HTMLTemplateElement && HTMLTemplateElement.decorate) {
          HTMLTemplateElement.decorate(template);
        }
        templateInfo = templateInfo || this.constructor._parseTemplate(template);
        let nodeInfo = templateInfo.nodeInfoList;
        let content = templateInfo.content || template.content;
        let dom = (
          /** @type {DocumentFragment} */
          document.importNode(content, true)
        );
        dom.__noInsertionPoint = !templateInfo.hasInsertionPoint;
        let nodes = dom.nodeList = new Array(nodeInfo.length);
        dom.$ = {};
        for (let i5 = 0, l3 = nodeInfo.length, info; i5 < l3 && (info = nodeInfo[i5]); i5++) {
          let node = nodes[i5] = findTemplateNode(dom, info);
          applyIdToMap(this, dom.$, node, info);
          applyTemplateInfo(this, node, info, templateInfo);
          applyEventListener(this, node, info);
        }
        dom = /** @type {!StampedTemplate} */
        dom;
        return dom;
      }
      /**
       * Adds an event listener by method name for the event provided.
       *
       * This method generates a handler function that looks up the method
       * name at handling time.
       *
       * @param {!EventTarget} node Node to add listener on
       * @param {string} eventName Name of event
       * @param {string} methodName Name of method
       * @param {*=} context Context the method will be called on (defaults
       *   to `node`)
       * @return {Function} Generated handler function
       * @override
       */
      _addMethodEventListenerToNode(node, eventName, methodName, context) {
        context = context || node;
        let handler = createNodeEventHandler(context, eventName, methodName);
        this._addEventListenerToNode(node, eventName, handler);
        return handler;
      }
      /**
       * Override point for adding custom or simulated event handling.
       *
       * @param {!EventTarget} node Node to add event listener to
       * @param {string} eventName Name of event
       * @param {function(!Event):void} handler Listener function to add
       * @return {void}
       * @override
       */
      _addEventListenerToNode(node, eventName, handler) {
        node.addEventListener(eventName, handler);
      }
      /**
       * Override point for adding custom or simulated event handling.
       *
       * @param {!EventTarget} node Node to remove event listener from
       * @param {string} eventName Name of event
       * @param {function(!Event):void} handler Listener function to remove
       * @return {void}
       * @override
       */
      _removeEventListenerFromNode(node, eventName, handler) {
        node.removeEventListener(eventName, handler);
      }
    }
    return TemplateStamp2;
  }
);

// node_modules/@polymer/polymer/lib/mixins/property-effects.js
var dedupeId2 = 0;
var NOOP = [];
var TYPES = {
  COMPUTE: "__computeEffects",
  REFLECT: "__reflectEffects",
  NOTIFY: "__notifyEffects",
  PROPAGATE: "__propagateEffects",
  OBSERVE: "__observeEffects",
  READ_ONLY: "__readOnly"
};
var COMPUTE_INFO = "__computeInfo";
var capitalAttributeRegex = /[A-Z]/;
function ensureOwnEffectMap(model, type, cloneArrays) {
  let effects = model[type];
  if (!effects) {
    effects = model[type] = {};
  } else if (!model.hasOwnProperty(type)) {
    effects = model[type] = Object.create(model[type]);
    if (cloneArrays) {
      for (let p3 in effects) {
        let protoFx = effects[p3];
        let instFx = effects[p3] = Array(protoFx.length);
        for (let i5 = 0; i5 < protoFx.length; i5++) {
          instFx[i5] = protoFx[i5];
        }
      }
    }
  }
  return effects;
}
function runEffects(inst, effects, props, oldProps, hasPaths, extraArgs) {
  if (effects) {
    let ran = false;
    const id = dedupeId2++;
    for (let prop in props) {
      let rootProperty = hasPaths ? root(prop) : prop;
      let fxs = effects[rootProperty];
      if (fxs) {
        for (let i5 = 0, l3 = fxs.length, fx; i5 < l3 && (fx = fxs[i5]); i5++) {
          if ((!fx.info || fx.info.lastRun !== id) && (!hasPaths || pathMatchesTrigger(prop, fx.trigger))) {
            if (fx.info) {
              fx.info.lastRun = id;
            }
            fx.fn(inst, prop, props, oldProps, fx.info, hasPaths, extraArgs);
            ran = true;
          }
        }
      }
    }
    return ran;
  }
  return false;
}
function runEffectsForProperty(inst, effects, dedupeId3, prop, props, oldProps, hasPaths, extraArgs) {
  let ran = false;
  let rootProperty = hasPaths ? root(prop) : prop;
  let fxs = effects[rootProperty];
  if (fxs) {
    for (let i5 = 0, l3 = fxs.length, fx; i5 < l3 && (fx = fxs[i5]); i5++) {
      if ((!fx.info || fx.info.lastRun !== dedupeId3) && (!hasPaths || pathMatchesTrigger(prop, fx.trigger))) {
        if (fx.info) {
          fx.info.lastRun = dedupeId3;
        }
        fx.fn(inst, prop, props, oldProps, fx.info, hasPaths, extraArgs);
        ran = true;
      }
    }
  }
  return ran;
}
function pathMatchesTrigger(path, trigger) {
  if (trigger) {
    let triggerPath = (
      /** @type {string} */
      trigger.name
    );
    return triggerPath == path || !!(trigger.structured && isAncestor(triggerPath, path)) || !!(trigger.wildcard && isDescendant(triggerPath, path));
  } else {
    return true;
  }
}
function runObserverEffect(inst, property, props, oldProps, info) {
  let fn = typeof info.method === "string" ? inst[info.method] : info.method;
  let changedProp = info.property;
  if (fn) {
    fn.call(inst, inst.__data[changedProp], oldProps[changedProp]);
  } else if (!info.dynamicFn) {
    console.warn("observer method `" + info.method + "` not defined");
  }
}
function runNotifyEffects(inst, notifyProps, props, oldProps, hasPaths) {
  let fxs = inst[TYPES.NOTIFY];
  let notified;
  let id = dedupeId2++;
  for (let prop in notifyProps) {
    if (notifyProps[prop]) {
      if (fxs && runEffectsForProperty(inst, fxs, id, prop, props, oldProps, hasPaths)) {
        notified = true;
      } else if (hasPaths && notifyPath(inst, prop, props)) {
        notified = true;
      }
    }
  }
  let host;
  if (notified && (host = inst.__dataHost) && host._invalidateProperties) {
    host._invalidateProperties();
  }
}
function notifyPath(inst, path, props) {
  let rootProperty = root(path);
  if (rootProperty !== path) {
    let eventName = camelToDashCase(rootProperty) + "-changed";
    dispatchNotifyEvent(inst, eventName, props[path], path);
    return true;
  }
  return false;
}
function dispatchNotifyEvent(inst, eventName, value, path) {
  let detail = {
    value,
    queueProperty: true
  };
  if (path) {
    detail.path = path;
  }
  wrap(
    /** @type {!HTMLElement} */
    inst
  ).dispatchEvent(new CustomEvent(eventName, { detail }));
}
function runNotifyEffect(inst, property, props, oldProps, info, hasPaths) {
  let rootProperty = hasPaths ? root(property) : property;
  let path = rootProperty != property ? property : null;
  let value = path ? get(inst, path) : inst.__data[property];
  if (path && value === void 0) {
    value = props[property];
  }
  dispatchNotifyEvent(inst, info.eventName, value, path);
}
function handleNotification(event, inst, fromProp, toPath, negate) {
  let value;
  let detail = (
    /** @type {Object} */
    event.detail
  );
  let fromPath = detail && detail.path;
  if (fromPath) {
    toPath = translate(fromProp, toPath, fromPath);
    value = detail && detail.value;
  } else {
    value = event.currentTarget[fromProp];
  }
  value = negate ? !value : value;
  if (!inst[TYPES.READ_ONLY] || !inst[TYPES.READ_ONLY][toPath]) {
    if (inst._setPendingPropertyOrPath(toPath, value, true, Boolean(fromPath)) && (!detail || !detail.queueProperty)) {
      inst._invalidateProperties();
    }
  }
}
function runReflectEffect(inst, property, props, oldProps, info) {
  let value = inst.__data[property];
  if (sanitizeDOMValue) {
    value = sanitizeDOMValue(
      value,
      info.attrName,
      "attribute",
      /** @type {Node} */
      inst
    );
  }
  inst._propertyToAttribute(property, info.attrName, value);
}
function runComputedEffects(inst, changedProps, oldProps, hasPaths) {
  let computeEffects = inst[TYPES.COMPUTE];
  if (computeEffects) {
    if (orderedComputed) {
      dedupeId2++;
      const order = getComputedOrder(inst);
      const queue = [];
      for (let p3 in changedProps) {
        enqueueEffectsFor(p3, computeEffects, queue, order, hasPaths);
      }
      let info;
      while (info = queue.shift()) {
        if (runComputedEffect(inst, "", changedProps, oldProps, info)) {
          enqueueEffectsFor(info.methodInfo, computeEffects, queue, order, hasPaths);
        }
      }
      Object.assign(
        /** @type {!Object} */
        oldProps,
        inst.__dataOld
      );
      Object.assign(
        /** @type {!Object} */
        changedProps,
        inst.__dataPending
      );
      inst.__dataPending = null;
    } else {
      let inputProps = changedProps;
      while (runEffects(inst, computeEffects, inputProps, oldProps, hasPaths)) {
        Object.assign(
          /** @type {!Object} */
          oldProps,
          inst.__dataOld
        );
        Object.assign(
          /** @type {!Object} */
          changedProps,
          inst.__dataPending
        );
        inputProps = inst.__dataPending;
        inst.__dataPending = null;
      }
    }
  }
}
var insertEffect = (info, queue, order) => {
  let start = 0;
  let end = queue.length - 1;
  let idx = -1;
  while (start <= end) {
    const mid = start + end >> 1;
    const cmp = order.get(queue[mid].methodInfo) - order.get(info.methodInfo);
    if (cmp < 0) {
      start = mid + 1;
    } else if (cmp > 0) {
      end = mid - 1;
    } else {
      idx = mid;
      break;
    }
  }
  if (idx < 0) {
    idx = end + 1;
  }
  queue.splice(idx, 0, info);
};
var enqueueEffectsFor = (prop, computeEffects, queue, order, hasPaths) => {
  const rootProperty = hasPaths ? root(prop) : prop;
  const fxs = computeEffects[rootProperty];
  if (fxs) {
    for (let i5 = 0; i5 < fxs.length; i5++) {
      const fx = fxs[i5];
      if (fx.info.lastRun !== dedupeId2 && (!hasPaths || pathMatchesTrigger(prop, fx.trigger))) {
        fx.info.lastRun = dedupeId2;
        insertEffect(fx.info, queue, order);
      }
    }
  }
};
function getComputedOrder(inst) {
  let ordered = inst.constructor.__orderedComputedDeps;
  if (!ordered) {
    ordered = /* @__PURE__ */ new Map();
    const effects = inst[TYPES.COMPUTE];
    let { counts, ready, total } = dependencyCounts(inst);
    let curr;
    while (curr = ready.shift()) {
      ordered.set(curr, ordered.size);
      const computedByCurr = effects[curr];
      if (computedByCurr) {
        computedByCurr.forEach((fx) => {
          const computedProp = fx.info.methodInfo;
          --total;
          if (--counts[computedProp] === 0) {
            ready.push(computedProp);
          }
        });
      }
    }
    if (total !== 0) {
      const el = (
        /** @type {HTMLElement} */
        inst
      );
      console.warn(`Computed graph for ${el.localName} incomplete; circular?`);
    }
    inst.constructor.__orderedComputedDeps = ordered;
  }
  return ordered;
}
function dependencyCounts(inst) {
  const infoForComputed = inst[COMPUTE_INFO];
  const counts = {};
  const computedDeps = inst[TYPES.COMPUTE];
  const ready = [];
  let total = 0;
  for (let p3 in infoForComputed) {
    const info = infoForComputed[p3];
    total += counts[p3] = info.args.filter((a3) => !a3.literal).length + (info.dynamicFn ? 1 : 0);
  }
  for (let p3 in computedDeps) {
    if (!infoForComputed[p3]) {
      ready.push(p3);
    }
  }
  return { counts, ready, total };
}
function runComputedEffect(inst, property, changedProps, oldProps, info) {
  let result = runMethodEffect(inst, property, changedProps, oldProps, info);
  if (result === NOOP) {
    return false;
  }
  let computedProp = info.methodInfo;
  if (inst.__dataHasAccessor && inst.__dataHasAccessor[computedProp]) {
    return inst._setPendingProperty(computedProp, result, true);
  } else {
    inst[computedProp] = result;
    return false;
  }
}
function computeLinkedPaths(inst, path, value) {
  let links = inst.__dataLinkedPaths;
  if (links) {
    let link;
    for (let a3 in links) {
      let b3 = links[a3];
      if (isDescendant(a3, path)) {
        link = translate(a3, b3, path);
        inst._setPendingPropertyOrPath(link, value, true, true);
      } else if (isDescendant(b3, path)) {
        link = translate(b3, a3, path);
        inst._setPendingPropertyOrPath(link, value, true, true);
      }
    }
  }
}
function addBinding(constructor, templateInfo, nodeInfo, kind, target, parts, literal) {
  nodeInfo.bindings = nodeInfo.bindings || [];
  let binding = { kind, target, parts, literal, isCompound: parts.length !== 1 };
  nodeInfo.bindings.push(binding);
  if (shouldAddListener(binding)) {
    let { event, negate } = binding.parts[0];
    binding.listenerEvent = event || camelToDashCase(target) + "-changed";
    binding.listenerNegate = negate;
  }
  let index = templateInfo.nodeInfoList.length;
  for (let i5 = 0; i5 < binding.parts.length; i5++) {
    let part = binding.parts[i5];
    part.compoundIndex = i5;
    addEffectForBindingPart(constructor, templateInfo, binding, part, index);
  }
}
function addEffectForBindingPart(constructor, templateInfo, binding, part, index) {
  if (!part.literal) {
    if (binding.kind === "attribute" && binding.target[0] === "-") {
      console.warn("Cannot set attribute " + binding.target + ' because "-" is not a valid attribute starting character');
    } else {
      let dependencies = part.dependencies;
      let info = { index, binding, part, evaluator: constructor };
      for (let j2 = 0; j2 < dependencies.length; j2++) {
        let trigger = dependencies[j2];
        if (typeof trigger == "string") {
          trigger = parseArg(trigger);
          trigger.wildcard = true;
        }
        constructor._addTemplatePropertyEffect(templateInfo, trigger.rootProperty, {
          fn: runBindingEffect,
          info,
          trigger
        });
      }
    }
  }
}
function runBindingEffect(inst, path, props, oldProps, info, hasPaths, nodeList) {
  let node = nodeList[info.index];
  let binding = info.binding;
  let part = info.part;
  if (hasPaths && part.source && path.length > part.source.length && binding.kind == "property" && !binding.isCompound && node.__isPropertyEffectsClient && node.__dataHasAccessor && node.__dataHasAccessor[binding.target]) {
    let value = props[path];
    path = translate(part.source, binding.target, path);
    if (node._setPendingPropertyOrPath(path, value, false, true)) {
      inst._enqueueClient(node);
    }
  } else {
    let value = info.evaluator._evaluateBinding(inst, part, path, props, oldProps, hasPaths);
    if (value !== NOOP) {
      applyBindingValue(inst, node, binding, part, value);
    }
  }
}
function applyBindingValue(inst, node, binding, part, value) {
  value = computeBindingValue(node, value, binding, part);
  if (sanitizeDOMValue) {
    value = sanitizeDOMValue(value, binding.target, binding.kind, node);
  }
  if (binding.kind == "attribute") {
    inst._valueToNodeAttribute(
      /** @type {Element} */
      node,
      value,
      binding.target
    );
  } else {
    let prop = binding.target;
    if (node.__isPropertyEffectsClient && node.__dataHasAccessor && node.__dataHasAccessor[prop]) {
      if (!node[TYPES.READ_ONLY] || !node[TYPES.READ_ONLY][prop]) {
        if (node._setPendingProperty(prop, value)) {
          inst._enqueueClient(node);
        }
      }
    } else {
      inst._setUnmanagedPropertyToNode(node, prop, value);
    }
  }
}
function computeBindingValue(node, value, binding, part) {
  if (binding.isCompound) {
    let storage = node.__dataCompoundStorage[binding.target];
    storage[part.compoundIndex] = value;
    value = storage.join("");
  }
  if (binding.kind !== "attribute") {
    if (binding.target === "textContent" || binding.target === "value" && (node.localName === "input" || node.localName === "textarea")) {
      value = value == void 0 ? "" : value;
    }
  }
  return value;
}
function shouldAddListener(binding) {
  return Boolean(binding.target) && binding.kind != "attribute" && binding.kind != "text" && !binding.isCompound && binding.parts[0].mode === "{";
}
function setupBindings(inst, templateInfo) {
  let { nodeList, nodeInfoList } = templateInfo;
  if (nodeInfoList.length) {
    for (let i5 = 0; i5 < nodeInfoList.length; i5++) {
      let info = nodeInfoList[i5];
      let node = nodeList[i5];
      let bindings = info.bindings;
      if (bindings) {
        for (let i6 = 0; i6 < bindings.length; i6++) {
          let binding = bindings[i6];
          setupCompoundStorage(node, binding);
          addNotifyListener(node, inst, binding);
        }
      }
      node.__dataHost = inst;
    }
  }
}
function setupCompoundStorage(node, binding) {
  if (binding.isCompound) {
    let storage = node.__dataCompoundStorage || (node.__dataCompoundStorage = {});
    let parts = binding.parts;
    let literals = new Array(parts.length);
    for (let j2 = 0; j2 < parts.length; j2++) {
      literals[j2] = parts[j2].literal;
    }
    let target = binding.target;
    storage[target] = literals;
    if (binding.literal && binding.kind == "property") {
      if (target === "className") {
        node = wrap(node);
      }
      node[target] = binding.literal;
    }
  }
}
function addNotifyListener(node, inst, binding) {
  if (binding.listenerEvent) {
    let part = binding.parts[0];
    node.addEventListener(binding.listenerEvent, function(e4) {
      handleNotification(e4, inst, binding.target, part.source, part.negate);
    });
  }
}
function createMethodEffect(model, sig, type, effectFn, methodInfo, dynamicFn) {
  dynamicFn = sig.static || dynamicFn && (typeof dynamicFn !== "object" || dynamicFn[sig.methodName]);
  let info = {
    methodName: sig.methodName,
    args: sig.args,
    methodInfo,
    dynamicFn
  };
  for (let i5 = 0, arg; i5 < sig.args.length && (arg = sig.args[i5]); i5++) {
    if (!arg.literal) {
      model._addPropertyEffect(arg.rootProperty, type, {
        fn: effectFn,
        info,
        trigger: arg
      });
    }
  }
  if (dynamicFn) {
    model._addPropertyEffect(sig.methodName, type, {
      fn: effectFn,
      info
    });
  }
  return info;
}
function runMethodEffect(inst, property, props, oldProps, info) {
  let context = inst._methodHost || inst;
  let fn = context[info.methodName];
  if (fn) {
    let args = inst._marshalArgs(info.args, property, props);
    return args === NOOP ? NOOP : fn.apply(context, args);
  } else if (!info.dynamicFn) {
    console.warn("method `" + info.methodName + "` not defined");
  }
}
var emptyArray = [];
var IDENT = "(?:[a-zA-Z_$][\\w.:$\\-*]*)";
var NUMBER = "(?:[-+]?[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?)";
var SQUOTE_STRING = "(?:'(?:[^'\\\\]|\\\\.)*')";
var DQUOTE_STRING = '(?:"(?:[^"\\\\]|\\\\.)*")';
var STRING = "(?:" + SQUOTE_STRING + "|" + DQUOTE_STRING + ")";
var ARGUMENT = "(?:(" + IDENT + "|" + NUMBER + "|" + STRING + ")\\s*)";
var ARGUMENTS = "(?:" + ARGUMENT + "(?:,\\s*" + ARGUMENT + ")*)";
var ARGUMENT_LIST = "(?:\\(\\s*(?:" + ARGUMENTS + "?)\\)\\s*)";
var BINDING = "(" + IDENT + "\\s*" + ARGUMENT_LIST + "?)";
var OPEN_BRACKET = "(\\[\\[|{{)\\s*";
var CLOSE_BRACKET = "(?:]]|}})";
var NEGATE = "(?:(!)\\s*)?";
var EXPRESSION = OPEN_BRACKET + NEGATE + BINDING + CLOSE_BRACKET;
var bindingRegex = new RegExp(EXPRESSION, "g");
function literalFromParts(parts) {
  let s4 = "";
  for (let i5 = 0; i5 < parts.length; i5++) {
    let literal = parts[i5].literal;
    s4 += literal || "";
  }
  return s4;
}
function parseMethod(expression) {
  let m2 = expression.match(/([^\s]+?)\(([\s\S]*)\)/);
  if (m2) {
    let methodName = m2[1];
    let sig = { methodName, static: true, args: emptyArray };
    if (m2[2].trim()) {
      let args = m2[2].replace(/\\,/g, "&comma;").split(",");
      return parseArgs(args, sig);
    } else {
      return sig;
    }
  }
  return null;
}
function parseArgs(argList, sig) {
  sig.args = argList.map(function(rawArg) {
    let arg = parseArg(rawArg);
    if (!arg.literal) {
      sig.static = false;
    }
    return arg;
  }, this);
  return sig;
}
function parseArg(rawArg) {
  let arg = rawArg.trim().replace(/&comma;/g, ",").replace(/\\(.)/g, "$1");
  let a3 = {
    name: arg,
    value: "",
    literal: false
  };
  let fc = arg[0];
  if (fc === "-") {
    fc = arg[1];
  }
  if (fc >= "0" && fc <= "9") {
    fc = "#";
  }
  switch (fc) {
    case "'":
    case '"':
      a3.value = arg.slice(1, -1);
      a3.literal = true;
      break;
    case "#":
      a3.value = Number(arg);
      a3.literal = true;
      break;
  }
  if (!a3.literal) {
    a3.rootProperty = root(arg);
    a3.structured = isPath(arg);
    if (a3.structured) {
      a3.wildcard = arg.slice(-2) == ".*";
      if (a3.wildcard) {
        a3.name = arg.slice(0, -2);
      }
    }
  }
  return a3;
}
function getArgValue(data, props, path) {
  let value = get(data, path);
  if (value === void 0) {
    value = props[path];
  }
  return value;
}
function notifySplices(inst, array, path, splices) {
  const splicesData = { indexSplices: splices };
  if (legacyUndefined && !inst._overrideLegacyUndefined) {
    array.splices = splicesData;
  }
  inst.notifyPath(path + ".splices", splicesData);
  inst.notifyPath(path + ".length", array.length);
  if (legacyUndefined && !inst._overrideLegacyUndefined) {
    splicesData.indexSplices = [];
  }
}
function notifySplice(inst, array, path, index, addedCount, removed) {
  notifySplices(inst, array, path, [{
    index,
    addedCount,
    removed,
    object: array,
    type: "splice"
  }]);
}
function upper(name) {
  return name[0].toUpperCase() + name.substring(1);
}
var PropertyEffects = dedupingMixin((superClass) => {
  const propertyEffectsBase = TemplateStamp(PropertyAccessors(superClass));
  class PropertyEffects2 extends propertyEffectsBase {
    constructor() {
      super();
      this.__isPropertyEffectsClient = true;
      this.__dataClientsReady;
      this.__dataPendingClients;
      this.__dataToNotify;
      this.__dataLinkedPaths;
      this.__dataHasPaths;
      this.__dataCompoundStorage;
      this.__dataHost;
      this.__dataTemp;
      this.__dataClientsInitialized;
      this.__data;
      this.__dataPending;
      this.__dataOld;
      this.__computeEffects;
      this.__computeInfo;
      this.__reflectEffects;
      this.__notifyEffects;
      this.__propagateEffects;
      this.__observeEffects;
      this.__readOnly;
      this.__templateInfo;
      this._overrideLegacyUndefined;
    }
    get PROPERTY_EFFECT_TYPES() {
      return TYPES;
    }
    /**
     * @override
     * @return {void}
     */
    _initializeProperties() {
      super._initializeProperties();
      this._registerHost();
      this.__dataClientsReady = false;
      this.__dataPendingClients = null;
      this.__dataToNotify = null;
      this.__dataLinkedPaths = null;
      this.__dataHasPaths = false;
      this.__dataCompoundStorage = this.__dataCompoundStorage || null;
      this.__dataHost = this.__dataHost || null;
      this.__dataTemp = {};
      this.__dataClientsInitialized = false;
    }
    _registerHost() {
      if (hostStack.length) {
        let host = hostStack[hostStack.length - 1];
        host._enqueueClient(this);
        this.__dataHost = host;
      }
    }
    /**
     * Overrides `PropertyAccessors` implementation to provide a
     * more efficient implementation of initializing properties from
     * the prototype on the instance.
     *
     * @override
     * @param {Object} props Properties to initialize on the prototype
     * @return {void}
     */
    _initializeProtoProperties(props) {
      this.__data = Object.create(props);
      this.__dataPending = Object.create(props);
      this.__dataOld = {};
    }
    /**
     * Overrides `PropertyAccessors` implementation to avoid setting
     * `_setProperty`'s `shouldNotify: true`.
     *
     * @override
     * @param {Object} props Properties to initialize on the instance
     * @return {void}
     */
    _initializeInstanceProperties(props) {
      let readOnly = this[TYPES.READ_ONLY];
      for (let prop in props) {
        if (!readOnly || !readOnly[prop]) {
          this.__dataPending = this.__dataPending || {};
          this.__dataOld = this.__dataOld || {};
          this.__data[prop] = this.__dataPending[prop] = props[prop];
        }
      }
    }
    // Prototype setup ----------------------------------------
    /**
     * Equivalent to static `addPropertyEffect` API but can be called on
     * an instance to add effects at runtime.  See that method for
     * full API docs.
     *
     * @override
     * @param {string} property Property that should trigger the effect
     * @param {string} type Effect type, from this.PROPERTY_EFFECT_TYPES
     * @param {Object=} effect Effect metadata object
     * @return {void}
     * @protected
     */
    _addPropertyEffect(property, type, effect) {
      this._createPropertyAccessor(property, type == TYPES.READ_ONLY);
      let effects = ensureOwnEffectMap(this, type, true)[property];
      if (!effects) {
        effects = this[type][property] = [];
      }
      effects.push(effect);
    }
    /**
     * Removes the given property effect.
     *
     * @override
     * @param {string} property Property the effect was associated with
     * @param {string} type Effect type, from this.PROPERTY_EFFECT_TYPES
     * @param {Object=} effect Effect metadata object to remove
     * @return {void}
     */
    _removePropertyEffect(property, type, effect) {
      let effects = ensureOwnEffectMap(this, type, true)[property];
      let idx = effects.indexOf(effect);
      if (idx >= 0) {
        effects.splice(idx, 1);
      }
    }
    /**
     * Returns whether the current prototype/instance has a property effect
     * of a certain type.
     *
     * @override
     * @param {string} property Property name
     * @param {string=} type Effect type, from this.PROPERTY_EFFECT_TYPES
     * @return {boolean} True if the prototype/instance has an effect of this
     *     type
     * @protected
     */
    _hasPropertyEffect(property, type) {
      let effects = this[type];
      return Boolean(effects && effects[property]);
    }
    /**
     * Returns whether the current prototype/instance has a "read only"
     * accessor for the given property.
     *
     * @override
     * @param {string} property Property name
     * @return {boolean} True if the prototype/instance has an effect of this
     *     type
     * @protected
     */
    _hasReadOnlyEffect(property) {
      return this._hasPropertyEffect(property, TYPES.READ_ONLY);
    }
    /**
     * Returns whether the current prototype/instance has a "notify"
     * property effect for the given property.
     *
     * @override
     * @param {string} property Property name
     * @return {boolean} True if the prototype/instance has an effect of this
     *     type
     * @protected
     */
    _hasNotifyEffect(property) {
      return this._hasPropertyEffect(property, TYPES.NOTIFY);
    }
    /**
     * Returns whether the current prototype/instance has a "reflect to
     * attribute" property effect for the given property.
     *
     * @override
     * @param {string} property Property name
     * @return {boolean} True if the prototype/instance has an effect of this
     *     type
     * @protected
     */
    _hasReflectEffect(property) {
      return this._hasPropertyEffect(property, TYPES.REFLECT);
    }
    /**
     * Returns whether the current prototype/instance has a "computed"
     * property effect for the given property.
     *
     * @override
     * @param {string} property Property name
     * @return {boolean} True if the prototype/instance has an effect of this
     *     type
     * @protected
     */
    _hasComputedEffect(property) {
      return this._hasPropertyEffect(property, TYPES.COMPUTE);
    }
    // Runtime ----------------------------------------
    /**
     * Sets a pending property or path.  If the root property of the path in
     * question had no accessor, the path is set, otherwise it is enqueued
     * via `_setPendingProperty`.
     *
     * This function isolates relatively expensive functionality necessary
     * for the public API (`set`, `setProperties`, `notifyPath`, and property
     * change listeners via {{...}} bindings), such that it is only done
     * when paths enter the system, and not at every propagation step.  It
     * also sets a `__dataHasPaths` flag on the instance which is used to
     * fast-path slower path-matching code in the property effects host paths.
     *
     * `path` can be a path string or array of path parts as accepted by the
     * public API.
     *
     * @override
     * @param {string | !Array<number|string>} path Path to set
     * @param {*} value Value to set
     * @param {boolean=} shouldNotify Set to true if this change should
     *  cause a property notification event dispatch
     * @param {boolean=} isPathNotification If the path being set is a path
     *   notification of an already changed value, as opposed to a request
     *   to set and notify the change.  In the latter `false` case, a dirty
     *   check is performed and then the value is set to the path before
     *   enqueuing the pending property change.
     * @return {boolean} Returns true if the property/path was enqueued in
     *   the pending changes bag.
     * @protected
     */
    _setPendingPropertyOrPath(path, value, shouldNotify, isPathNotification) {
      if (isPathNotification || root(Array.isArray(path) ? path[0] : path) !== path) {
        if (!isPathNotification) {
          let old = get(this, path);
          path = /** @type {string} */
          set(this, path, value);
          if (!path || !super._shouldPropertyChange(path, value, old)) {
            return false;
          }
        }
        this.__dataHasPaths = true;
        if (this._setPendingProperty(
          /**@type{string}*/
          path,
          value,
          shouldNotify
        )) {
          computeLinkedPaths(
            this,
            /**@type{string}*/
            path,
            value
          );
          return true;
        }
      } else {
        if (this.__dataHasAccessor && this.__dataHasAccessor[path]) {
          return this._setPendingProperty(
            /**@type{string}*/
            path,
            value,
            shouldNotify
          );
        } else {
          this[path] = value;
        }
      }
      return false;
    }
    /**
     * Applies a value to a non-Polymer element/node's property.
     *
     * The implementation makes a best-effort at binding interop:
     * Some native element properties have side-effects when
     * re-setting the same value (e.g. setting `<input>.value` resets the
     * cursor position), so we do a dirty-check before setting the value.
     * However, for better interop with non-Polymer custom elements that
     * accept objects, we explicitly re-set object changes coming from the
     * Polymer world (which may include deep object changes without the
     * top reference changing), erring on the side of providing more
     * information.
     *
     * Users may override this method to provide alternate approaches.
     *
     * @override
     * @param {!Node} node The node to set a property on
     * @param {string} prop The property to set
     * @param {*} value The value to set
     * @return {void}
     * @protected
     */
    _setUnmanagedPropertyToNode(node, prop, value) {
      if (value !== node[prop] || typeof value == "object") {
        if (prop === "className") {
          node = /** @type {!Node} */
          wrap(node);
        }
        node[prop] = value;
      }
    }
    /**
     * Overrides the `PropertiesChanged` implementation to introduce special
     * dirty check logic depending on the property & value being set:
     *
     * 1. Any value set to a path (e.g. 'obj.prop': 42 or 'obj.prop': {...})
     *    Stored in `__dataTemp`, dirty checked against `__dataTemp`
     * 2. Object set to simple property (e.g. 'prop': {...})
     *    Stored in `__dataTemp` and `__data`, dirty checked against
     *    `__dataTemp` by default implementation of `_shouldPropertyChange`
     * 3. Primitive value set to simple property (e.g. 'prop': 42)
     *    Stored in `__data`, dirty checked against `__data`
     *
     * The dirty-check is important to prevent cycles due to two-way
     * notification, but paths and objects are only dirty checked against any
     * previous value set during this turn via a "temporary cache" that is
     * cleared when the last `_propertiesChanged` exits. This is so:
     * a. any cached array paths (e.g. 'array.3.prop') may be invalidated
     *    due to array mutations like shift/unshift/splice; this is fine
     *    since path changes are dirty-checked at user entry points like `set`
     * b. dirty-checking for objects only lasts one turn to allow the user
     *    to mutate the object in-place and re-set it with the same identity
     *    and have all sub-properties re-propagated in a subsequent turn.
     *
     * The temp cache is not necessarily sufficient to prevent invalid array
     * paths, since a splice can happen during the same turn (with pathological
     * user code); we could introduce a "fixup" for temporarily cached array
     * paths if needed: https://github.com/Polymer/polymer/issues/4227
     *
     * @override
     * @param {string} property Name of the property
     * @param {*} value Value to set
     * @param {boolean=} shouldNotify True if property should fire notification
     *   event (applies only for `notify: true` properties)
     * @return {boolean} Returns true if the property changed
     */
    _setPendingProperty(property, value, shouldNotify) {
      let propIsPath = this.__dataHasPaths && isPath(property);
      let prevProps = propIsPath ? this.__dataTemp : this.__data;
      if (this._shouldPropertyChange(property, value, prevProps[property])) {
        if (!this.__dataPending) {
          this.__dataPending = {};
          this.__dataOld = {};
        }
        if (!(property in this.__dataOld)) {
          this.__dataOld[property] = this.__data[property];
        }
        if (propIsPath) {
          this.__dataTemp[property] = value;
        } else {
          this.__data[property] = value;
        }
        this.__dataPending[property] = value;
        if (propIsPath || this[TYPES.NOTIFY] && this[TYPES.NOTIFY][property]) {
          this.__dataToNotify = this.__dataToNotify || {};
          this.__dataToNotify[property] = shouldNotify;
        }
        return true;
      }
      return false;
    }
    /**
     * Overrides base implementation to ensure all accessors set `shouldNotify`
     * to true, for per-property notification tracking.
     *
     * @override
     * @param {string} property Name of the property
     * @param {*} value Value to set
     * @return {void}
     */
    _setProperty(property, value) {
      if (this._setPendingProperty(property, value, true)) {
        this._invalidateProperties();
      }
    }
    /**
     * Overrides `PropertyAccessor`'s default async queuing of
     * `_propertiesChanged`: if `__dataReady` is false (has not yet been
     * manually flushed), the function no-ops; otherwise flushes
     * `_propertiesChanged` synchronously.
     *
     * @override
     * @return {void}
     */
    _invalidateProperties() {
      if (this.__dataReady) {
        this._flushProperties();
      }
    }
    /**
     * Enqueues the given client on a list of pending clients, whose
     * pending property changes can later be flushed via a call to
     * `_flushClients`.
     *
     * @override
     * @param {Object} client PropertyEffects client to enqueue
     * @return {void}
     * @protected
     */
    _enqueueClient(client) {
      this.__dataPendingClients = this.__dataPendingClients || [];
      if (client !== this) {
        this.__dataPendingClients.push(client);
      }
    }
    /**
     * Flushes any clients previously enqueued via `_enqueueClient`, causing
     * their `_flushProperties` method to run.
     *
     * @override
     * @return {void}
     * @protected
     */
    _flushClients() {
      if (!this.__dataClientsReady) {
        this.__dataClientsReady = true;
        this._readyClients();
        this.__dataReady = true;
      } else {
        this.__enableOrFlushClients();
      }
    }
    // NOTE: We ensure clients either enable or flush as appropriate. This
    // handles two corner cases:
    // (1) clients flush properly when connected/enabled before the host
    // enables; e.g.
    //   (a) Templatize stamps with no properties and does not flush and
    //   (b) the instance is inserted into dom and
    //   (c) then the instance flushes.
    // (2) clients enable properly when not connected/enabled when the host
    // flushes; e.g.
    //   (a) a template is runtime stamped and not yet connected/enabled
    //   (b) a host sets a property, causing stamped dom to flush
    //   (c) the stamped dom enables.
    __enableOrFlushClients() {
      let clients = this.__dataPendingClients;
      if (clients) {
        this.__dataPendingClients = null;
        for (let i5 = 0; i5 < clients.length; i5++) {
          let client = clients[i5];
          if (!client.__dataEnabled) {
            client._enableProperties();
          } else if (client.__dataPending) {
            client._flushProperties();
          }
        }
      }
    }
    /**
     * Perform any initial setup on client dom. Called before the first
     * `_flushProperties` call on client dom and before any element
     * observers are called.
     *
     * @override
     * @return {void}
     * @protected
     */
    _readyClients() {
      this.__enableOrFlushClients();
    }
    /**
     * Sets a bag of property changes to this instance, and
     * synchronously processes all effects of the properties as a batch.
     *
     * Property names must be simple properties, not paths.  Batched
     * path propagation is not supported.
     *
     * @override
     * @param {Object} props Bag of one or more key-value pairs whose key is
     *   a property and value is the new value to set for that property.
     * @param {boolean=} setReadOnly When true, any private values set in
     *   `props` will be set. By default, `setProperties` will not set
     *   `readOnly: true` root properties.
     * @return {void}
     * @public
     */
    setProperties(props, setReadOnly) {
      for (let path in props) {
        if (setReadOnly || !this[TYPES.READ_ONLY] || !this[TYPES.READ_ONLY][path]) {
          this._setPendingPropertyOrPath(path, props[path], true);
        }
      }
      this._invalidateProperties();
    }
    /**
     * Overrides `PropertyAccessors` so that property accessor
     * side effects are not enabled until after client dom is fully ready.
     * Also calls `_flushClients` callback to ensure client dom is enabled
     * that was not enabled as a result of flushing properties.
     *
     * @override
     * @return {void}
     */
    ready() {
      this._flushProperties();
      if (!this.__dataClientsReady) {
        this._flushClients();
      }
      if (this.__dataPending) {
        this._flushProperties();
      }
    }
    /**
     * Implements `PropertyAccessors`'s properties changed callback.
     *
     * Runs each class of effects for the batch of changed properties in
     * a specific order (compute, propagate, reflect, observe, notify).
     *
     * @override
     * @param {!Object} currentProps Bag of all current accessor values
     * @param {?Object} changedProps Bag of properties changed since the last
     *   call to `_propertiesChanged`
     * @param {?Object} oldProps Bag of previous values for each property
     *   in `changedProps`
     * @return {void}
     */
    _propertiesChanged(currentProps, changedProps, oldProps) {
      let hasPaths = this.__dataHasPaths;
      this.__dataHasPaths = false;
      let notifyProps;
      runComputedEffects(this, changedProps, oldProps, hasPaths);
      notifyProps = this.__dataToNotify;
      this.__dataToNotify = null;
      this._propagatePropertyChanges(changedProps, oldProps, hasPaths);
      this._flushClients();
      runEffects(this, this[TYPES.REFLECT], changedProps, oldProps, hasPaths);
      runEffects(this, this[TYPES.OBSERVE], changedProps, oldProps, hasPaths);
      if (notifyProps) {
        runNotifyEffects(this, notifyProps, changedProps, oldProps, hasPaths);
      }
      if (this.__dataCounter == 1) {
        this.__dataTemp = {};
      }
    }
    /**
     * Called to propagate any property changes to stamped template nodes
     * managed by this element.
     *
     * @override
     * @param {Object} changedProps Bag of changed properties
     * @param {Object} oldProps Bag of previous values for changed properties
     * @param {boolean} hasPaths True with `props` contains one or more paths
     * @return {void}
     * @protected
     */
    _propagatePropertyChanges(changedProps, oldProps, hasPaths) {
      if (this[TYPES.PROPAGATE]) {
        runEffects(this, this[TYPES.PROPAGATE], changedProps, oldProps, hasPaths);
      }
      if (this.__templateInfo) {
        this._runEffectsForTemplate(this.__templateInfo, changedProps, oldProps, hasPaths);
      }
    }
    _runEffectsForTemplate(templateInfo, changedProps, oldProps, hasPaths) {
      const baseRunEffects = (changedProps2, hasPaths2) => {
        runEffects(
          this,
          templateInfo.propertyEffects,
          changedProps2,
          oldProps,
          hasPaths2,
          templateInfo.nodeList
        );
        for (let info = templateInfo.firstChild; info; info = info.nextSibling) {
          this._runEffectsForTemplate(info, changedProps2, oldProps, hasPaths2);
        }
      };
      if (templateInfo.runEffects) {
        templateInfo.runEffects(baseRunEffects, changedProps, hasPaths);
      } else {
        baseRunEffects(changedProps, hasPaths);
      }
    }
    /**
     * Aliases one data path as another, such that path notifications from one
     * are routed to the other.
     *
     * @override
     * @param {string | !Array<string|number>} to Target path to link.
     * @param {string | !Array<string|number>} from Source path to link.
     * @return {void}
     * @public
     */
    linkPaths(to, from) {
      to = normalize(to);
      from = normalize(from);
      this.__dataLinkedPaths = this.__dataLinkedPaths || {};
      this.__dataLinkedPaths[to] = from;
    }
    /**
     * Removes a data path alias previously established with `_linkPaths`.
     *
     * Note, the path to unlink should be the target (`to`) used when
     * linking the paths.
     *
     * @override
     * @param {string | !Array<string|number>} path Target path to unlink.
     * @return {void}
     * @public
     */
    unlinkPaths(path) {
      path = normalize(path);
      if (this.__dataLinkedPaths) {
        delete this.__dataLinkedPaths[path];
      }
    }
    /**
     * Notify that an array has changed.
     *
     * Example:
     *
     *     this.items = [ {name: 'Jim'}, {name: 'Todd'}, {name: 'Bill'} ];
     *     ...
     *     this.items.splice(1, 1, {name: 'Sam'});
     *     this.items.push({name: 'Bob'});
     *     this.notifySplices('items', [
     *       { index: 1, removed: [{name: 'Todd'}], addedCount: 1,
     *         object: this.items, type: 'splice' },
     *       { index: 3, removed: [], addedCount: 1,
     *         object: this.items, type: 'splice'}
     *     ]);
     *
     * @param {string} path Path that should be notified.
     * @param {Array} splices Array of splice records indicating ordered
     *   changes that occurred to the array. Each record should have the
     *   following fields:
     *    * index: index at which the change occurred
     *    * removed: array of items that were removed from this index
     *    * addedCount: number of new items added at this index
     *    * object: a reference to the array in question
     *    * type: the string literal 'splice'
     *
     *   Note that splice records _must_ be normalized such that they are
     *   reported in index order (raw results from `Object.observe` are not
     *   ordered and must be normalized/merged before notifying).
     *
     * @override
     * @return {void}
     * @public
     */
    notifySplices(path, splices) {
      let info = { path: "" };
      let array = (
        /** @type {Array} */
        get(this, path, info)
      );
      notifySplices(this, array, info.path, splices);
    }
    /**
     * Convenience method for reading a value from a path.
     *
     * Note, if any part in the path is undefined, this method returns
     * `undefined` (this method does not throw when dereferencing undefined
     * paths).
     *
     * @override
     * @param {(string|!Array<(string|number)>)} path Path to the value
     *   to read.  The path may be specified as a string (e.g. `foo.bar.baz`)
     *   or an array of path parts (e.g. `['foo.bar', 'baz']`).  Note that
     *   bracketed expressions are not supported; string-based path parts
     *   *must* be separated by dots.  Note that when dereferencing array
     *   indices, the index may be used as a dotted part directly
     *   (e.g. `users.12.name` or `['users', 12, 'name']`).
     * @param {Object=} root Root object from which the path is evaluated.
     * @return {*} Value at the path, or `undefined` if any part of the path
     *   is undefined.
     * @public
     */
    get(path, root2) {
      return get(root2 || this, path);
    }
    /**
     * Convenience method for setting a value to a path and notifying any
     * elements bound to the same path.
     *
     * Note, if any part in the path except for the last is undefined,
     * this method does nothing (this method does not throw when
     * dereferencing undefined paths).
     *
     * @override
     * @param {(string|!Array<(string|number)>)} path Path to the value
     *   to write.  The path may be specified as a string (e.g. `'foo.bar.baz'`)
     *   or an array of path parts (e.g. `['foo.bar', 'baz']`).  Note that
     *   bracketed expressions are not supported; string-based path parts
     *   *must* be separated by dots.  Note that when dereferencing array
     *   indices, the index may be used as a dotted part directly
     *   (e.g. `'users.12.name'` or `['users', 12, 'name']`).
     * @param {*} value Value to set at the specified path.
     * @param {Object=} root Root object from which the path is evaluated.
     *   When specified, no notification will occur.
     * @return {void}
     * @public
     */
    set(path, value, root2) {
      if (root2) {
        set(root2, path, value);
      } else {
        if (!this[TYPES.READ_ONLY] || !this[TYPES.READ_ONLY][
          /** @type {string} */
          path
        ]) {
          if (this._setPendingPropertyOrPath(path, value, true)) {
            this._invalidateProperties();
          }
        }
      }
    }
    /**
     * Adds items onto the end of the array at the path specified.
     *
     * The arguments after `path` and return value match that of
     * `Array.prototype.push`.
     *
     * This method notifies other paths to the same array that a
     * splice occurred to the array.
     *
     * @override
     * @param {string | !Array<string|number>} path Path to array.
     * @param {...*} items Items to push onto array
     * @return {number} New length of the array.
     * @public
     */
    push(path, ...items) {
      let info = { path: "" };
      let array = (
        /** @type {Array}*/
        get(this, path, info)
      );
      let len = array.length;
      let ret = array.push(...items);
      if (items.length) {
        notifySplice(this, array, info.path, len, items.length, []);
      }
      return ret;
    }
    /**
     * Removes an item from the end of array at the path specified.
     *
     * The arguments after `path` and return value match that of
     * `Array.prototype.pop`.
     *
     * This method notifies other paths to the same array that a
     * splice occurred to the array.
     *
     * @override
     * @param {string | !Array<string|number>} path Path to array.
     * @return {*} Item that was removed.
     * @public
     */
    pop(path) {
      let info = { path: "" };
      let array = (
        /** @type {Array} */
        get(this, path, info)
      );
      let hadLength = Boolean(array.length);
      let ret = array.pop();
      if (hadLength) {
        notifySplice(this, array, info.path, array.length, 0, [ret]);
      }
      return ret;
    }
    /**
     * Starting from the start index specified, removes 0 or more items
     * from the array and inserts 0 or more new items in their place.
     *
     * The arguments after `path` and return value match that of
     * `Array.prototype.splice`.
     *
     * This method notifies other paths to the same array that a
     * splice occurred to the array.
     *
     * @override
     * @param {string | !Array<string|number>} path Path to array.
     * @param {number} start Index from which to start removing/inserting.
     * @param {number=} deleteCount Number of items to remove.
     * @param {...*} items Items to insert into array.
     * @return {!Array} Array of removed items.
     * @public
     */
    splice(path, start, deleteCount, ...items) {
      let info = { path: "" };
      let array = (
        /** @type {Array} */
        get(this, path, info)
      );
      if (start < 0) {
        start = array.length - Math.floor(-start);
      } else if (start) {
        start = Math.floor(start);
      }
      let ret;
      if (arguments.length === 2) {
        ret = array.splice(start);
      } else {
        ret = array.splice(start, deleteCount, ...items);
      }
      if (items.length || ret.length) {
        notifySplice(this, array, info.path, start, items.length, ret);
      }
      return ret;
    }
    /**
     * Removes an item from the beginning of array at the path specified.
     *
     * The arguments after `path` and return value match that of
     * `Array.prototype.pop`.
     *
     * This method notifies other paths to the same array that a
     * splice occurred to the array.
     *
     * @override
     * @param {string | !Array<string|number>} path Path to array.
     * @return {*} Item that was removed.
     * @public
     */
    shift(path) {
      let info = { path: "" };
      let array = (
        /** @type {Array} */
        get(this, path, info)
      );
      let hadLength = Boolean(array.length);
      let ret = array.shift();
      if (hadLength) {
        notifySplice(this, array, info.path, 0, 0, [ret]);
      }
      return ret;
    }
    /**
     * Adds items onto the beginning of the array at the path specified.
     *
     * The arguments after `path` and return value match that of
     * `Array.prototype.push`.
     *
     * This method notifies other paths to the same array that a
     * splice occurred to the array.
     *
     * @override
     * @param {string | !Array<string|number>} path Path to array.
     * @param {...*} items Items to insert info array
     * @return {number} New length of the array.
     * @public
     */
    unshift(path, ...items) {
      let info = { path: "" };
      let array = (
        /** @type {Array} */
        get(this, path, info)
      );
      let ret = array.unshift(...items);
      if (items.length) {
        notifySplice(this, array, info.path, 0, items.length, []);
      }
      return ret;
    }
    /**
     * Notify that a path has changed.
     *
     * Example:
     *
     *     this.item.user.name = 'Bob';
     *     this.notifyPath('item.user.name');
     *
     * @override
     * @param {string} path Path that should be notified.
     * @param {*=} value Value at the path (optional).
     * @return {void}
     * @public
     */
    notifyPath(path, value) {
      let propPath;
      if (arguments.length == 1) {
        let info = { path: "" };
        value = get(this, path, info);
        propPath = info.path;
      } else if (Array.isArray(path)) {
        propPath = normalize(path);
      } else {
        propPath = /** @type{string} */
        path;
      }
      if (this._setPendingPropertyOrPath(propPath, value, true, true)) {
        this._invalidateProperties();
      }
    }
    /**
     * Equivalent to static `createReadOnlyProperty` API but can be called on
     * an instance to add effects at runtime.  See that method for
     * full API docs.
     *
     * @override
     * @param {string} property Property name
     * @param {boolean=} protectedSetter Creates a custom protected setter
     *   when `true`.
     * @return {void}
     * @protected
     */
    _createReadOnlyProperty(property, protectedSetter) {
      this._addPropertyEffect(property, TYPES.READ_ONLY);
      if (protectedSetter) {
        this["_set" + upper(property)] = /** @this {PropertyEffects} */
        function(value) {
          this._setProperty(property, value);
        };
      }
    }
    /**
     * Equivalent to static `createPropertyObserver` API but can be called on
     * an instance to add effects at runtime.  See that method for
     * full API docs.
     *
     * @override
     * @param {string} property Property name
     * @param {string|function(*,*)} method Function or name of observer method
     *     to call
     * @param {boolean=} dynamicFn Whether the method name should be included as
     *   a dependency to the effect.
     * @return {void}
     * @protected
     */
    _createPropertyObserver(property, method, dynamicFn) {
      let info = { property, method, dynamicFn: Boolean(dynamicFn) };
      this._addPropertyEffect(property, TYPES.OBSERVE, {
        fn: runObserverEffect,
        info,
        trigger: { name: property }
      });
      if (dynamicFn) {
        this._addPropertyEffect(
          /** @type {string} */
          method,
          TYPES.OBSERVE,
          {
            fn: runObserverEffect,
            info,
            trigger: { name: method }
          }
        );
      }
    }
    /**
     * Equivalent to static `createMethodObserver` API but can be called on
     * an instance to add effects at runtime.  See that method for
     * full API docs.
     *
     * @override
     * @param {string} expression Method expression
     * @param {boolean|Object=} dynamicFn Boolean or object map indicating
     *   whether method names should be included as a dependency to the effect.
     * @return {void}
     * @protected
     */
    _createMethodObserver(expression, dynamicFn) {
      let sig = parseMethod(expression);
      if (!sig) {
        throw new Error("Malformed observer expression '" + expression + "'");
      }
      createMethodEffect(this, sig, TYPES.OBSERVE, runMethodEffect, null, dynamicFn);
    }
    /**
     * Equivalent to static `createNotifyingProperty` API but can be called on
     * an instance to add effects at runtime.  See that method for
     * full API docs.
     *
     * @override
     * @param {string} property Property name
     * @return {void}
     * @protected
     */
    _createNotifyingProperty(property) {
      this._addPropertyEffect(property, TYPES.NOTIFY, {
        fn: runNotifyEffect,
        info: {
          eventName: camelToDashCase(property) + "-changed",
          property
        }
      });
    }
    /**
     * Equivalent to static `createReflectedProperty` API but can be called on
     * an instance to add effects at runtime.  See that method for
     * full API docs.
     *
     * @override
     * @param {string} property Property name
     * @return {void}
     * @protected
     * @suppress {missingProperties} go/missingfnprops
     */
    _createReflectedProperty(property) {
      let attr = this.constructor.attributeNameForProperty(property);
      if (attr[0] === "-") {
        console.warn("Property " + property + " cannot be reflected to attribute " + attr + ' because "-" is not a valid starting attribute name. Use a lowercase first letter for the property instead.');
      } else {
        this._addPropertyEffect(property, TYPES.REFLECT, {
          fn: runReflectEffect,
          info: {
            attrName: attr
          }
        });
      }
    }
    /**
     * Equivalent to static `createComputedProperty` API but can be called on
     * an instance to add effects at runtime.  See that method for
     * full API docs.
     *
     * @override
     * @param {string} property Name of computed property to set
     * @param {string} expression Method expression
     * @param {boolean|Object=} dynamicFn Boolean or object map indicating
     *   whether method names should be included as a dependency to the effect.
     * @return {void}
     * @protected
     */
    _createComputedProperty(property, expression, dynamicFn) {
      let sig = parseMethod(expression);
      if (!sig) {
        throw new Error("Malformed computed expression '" + expression + "'");
      }
      const info = createMethodEffect(this, sig, TYPES.COMPUTE, runComputedEffect, property, dynamicFn);
      ensureOwnEffectMap(this, COMPUTE_INFO)[property] = info;
    }
    /**
     * Gather the argument values for a method specified in the provided array
     * of argument metadata.
     *
     * The `path` and `value` arguments are used to fill in wildcard descriptor
     * when the method is being called as a result of a path notification.
     *
     * @param {!Array<!MethodArg>} args Array of argument metadata
     * @param {string} path Property/path name that triggered the method effect
     * @param {Object} props Bag of current property changes
     * @return {!Array<*>} Array of argument values
     * @private
     */
    _marshalArgs(args, path, props) {
      const data = this.__data;
      const values = [];
      for (let i5 = 0, l3 = args.length; i5 < l3; i5++) {
        let { name, structured, wildcard, value, literal } = args[i5];
        if (!literal) {
          if (wildcard) {
            const matches = isDescendant(name, path);
            const pathValue = getArgValue(data, props, matches ? path : name);
            value = {
              path: matches ? path : name,
              value: pathValue,
              base: matches ? get(data, name) : pathValue
            };
          } else {
            value = structured ? getArgValue(data, props, name) : data[name];
          }
        }
        if (legacyUndefined && !this._overrideLegacyUndefined && value === void 0 && args.length > 1) {
          return NOOP;
        }
        values[i5] = value;
      }
      return values;
    }
    // -- static class methods ------------
    /**
     * Ensures an accessor exists for the specified property, and adds
     * to a list of "property effects" that will run when the accessor for
     * the specified property is set.  Effects are grouped by "type", which
     * roughly corresponds to a phase in effect processing.  The effect
     * metadata should be in the following form:
     *
     *     {
     *       fn: effectFunction, // Reference to function to call to perform effect
     *       info: { ... }       // Effect metadata passed to function
     *       trigger: {          // Optional triggering metadata; if not provided
     *         name: string      // the property is treated as a wildcard
     *         structured: boolean
     *         wildcard: boolean
     *       }
     *     }
     *
     * Effects are called from `_propertiesChanged` in the following order by
     * type:
     *
     * 1. COMPUTE
     * 2. PROPAGATE
     * 3. REFLECT
     * 4. OBSERVE
     * 5. NOTIFY
     *
     * Effect functions are called with the following signature:
     *
     *     effectFunction(inst, path, props, oldProps, info, hasPaths)
     *
     * @param {string} property Property that should trigger the effect
     * @param {string} type Effect type, from this.PROPERTY_EFFECT_TYPES
     * @param {Object=} effect Effect metadata object
     * @return {void}
     * @protected
     * @nocollapse
     */
    static addPropertyEffect(property, type, effect) {
      this.prototype._addPropertyEffect(property, type, effect);
    }
    /**
     * Creates a single-property observer for the given property.
     *
     * @param {string} property Property name
     * @param {string|function(*,*)} method Function or name of observer method to call
     * @param {boolean=} dynamicFn Whether the method name should be included as
     *   a dependency to the effect.
     * @return {void}
     * @protected
     * @nocollapse
     */
    static createPropertyObserver(property, method, dynamicFn) {
      this.prototype._createPropertyObserver(property, method, dynamicFn);
    }
    /**
     * Creates a multi-property "method observer" based on the provided
     * expression, which should be a string in the form of a normal JavaScript
     * function signature: `'methodName(arg1, [..., argn])'`.  Each argument
     * should correspond to a property or path in the context of this
     * prototype (or instance), or may be a literal string or number.
     *
     * @param {string} expression Method expression
     * @param {boolean|Object=} dynamicFn Boolean or object map indicating
     * @return {void}
     *   whether method names should be included as a dependency to the effect.
     * @protected
     * @nocollapse
     */
    static createMethodObserver(expression, dynamicFn) {
      this.prototype._createMethodObserver(expression, dynamicFn);
    }
    /**
     * Causes the setter for the given property to dispatch `<property>-changed`
     * events to notify of changes to the property.
     *
     * @param {string} property Property name
     * @return {void}
     * @protected
     * @nocollapse
     */
    static createNotifyingProperty(property) {
      this.prototype._createNotifyingProperty(property);
    }
    /**
     * Creates a read-only accessor for the given property.
     *
     * To set the property, use the protected `_setProperty` API.
     * To create a custom protected setter (e.g. `_setMyProp()` for
     * property `myProp`), pass `true` for `protectedSetter`.
     *
     * Note, if the property will have other property effects, this method
     * should be called first, before adding other effects.
     *
     * @param {string} property Property name
     * @param {boolean=} protectedSetter Creates a custom protected setter
     *   when `true`.
     * @return {void}
     * @protected
     * @nocollapse
     */
    static createReadOnlyProperty(property, protectedSetter) {
      this.prototype._createReadOnlyProperty(property, protectedSetter);
    }
    /**
     * Causes the setter for the given property to reflect the property value
     * to a (dash-cased) attribute of the same name.
     *
     * @param {string} property Property name
     * @return {void}
     * @protected
     * @nocollapse
     */
    static createReflectedProperty(property) {
      this.prototype._createReflectedProperty(property);
    }
    /**
     * Creates a computed property whose value is set to the result of the
     * method described by the given `expression` each time one or more
     * arguments to the method changes.  The expression should be a string
     * in the form of a normal JavaScript function signature:
     * `'methodName(arg1, [..., argn])'`
     *
     * @param {string} property Name of computed property to set
     * @param {string} expression Method expression
     * @param {boolean|Object=} dynamicFn Boolean or object map indicating whether
     *   method names should be included as a dependency to the effect.
     * @return {void}
     * @protected
     * @nocollapse
     */
    static createComputedProperty(property, expression, dynamicFn) {
      this.prototype._createComputedProperty(property, expression, dynamicFn);
    }
    /**
     * Parses the provided template to ensure binding effects are created
     * for them, and then ensures property accessors are created for any
     * dependent properties in the template.  Binding effects for bound
     * templates are stored in a linked list on the instance so that
     * templates can be efficiently stamped and unstamped.
     *
     * @param {!HTMLTemplateElement} template Template containing binding
     *   bindings
     * @return {!TemplateInfo} Template metadata object
     * @protected
     * @nocollapse
     */
    static bindTemplate(template) {
      return this.prototype._bindTemplate(template);
    }
    // -- binding ----------------------------------------------
    /*
     * Overview of binding flow:
     *
     * During finalization (`instanceBinding==false`, `wasPreBound==false`):
     *  `_bindTemplate(t, false)` called directly during finalization - parses
     *  the template (for the first time), and then assigns that _prototypical_
     *  template info to `__preboundTemplateInfo` _on the prototype_; note in
     *  this case `wasPreBound` is false; this is the first time we're binding
     *  it, thus we create accessors.
     *
     * During first stamping (`instanceBinding==true`, `wasPreBound==true`):
     *   `_stampTemplate` calls `_bindTemplate(t, true)`: the `templateInfo`
     *   returned matches the prebound one, and so this is `wasPreBound == true`
     *   state; thus we _skip_ creating accessors, but _do_ create an instance
     *   of the template info to serve as the start of our linked list (needs to
     *   be an instance, not the prototypical one, so that we can add `nodeList`
     *   to it to contain the `nodeInfo`-ordered list of instance nodes for
     *   bindings, and so we can chain runtime-stamped template infos off of
     *   it). At this point, the call to `_stampTemplate` calls
     *   `applyTemplateInfo` for each nested `<template>` found during parsing
     *   to hand prototypical `_templateInfo` to them; we also pass the _parent_
     *   `templateInfo` to the `<template>` so that we have the instance-time
     *   parent to link the `templateInfo` under in the case it was
     *   runtime-stamped.
     *
     * During subsequent runtime stamping (`instanceBinding==true`,
     *   `wasPreBound==false`): `_stampTemplate` calls `_bindTemplate(t, true)`
     *   - here `templateInfo` is guaranteed to _not_ match the prebound one,
     *   because it was either a different template altogether, or even if it
     *   was the same template, the step above created a instance of the info;
     *   in this case `wasPreBound == false`, so we _do_ create accessors, _and_
     *   link a instance into the linked list.
     */
    /**
     * Equivalent to static `bindTemplate` API but can be called on an instance
     * to add effects at runtime.  See that method for full API docs.
     *
     * This method may be called on the prototype (for prototypical template
     * binding, to avoid creating accessors every instance) once per prototype,
     * and will be called with `runtimeBinding: true` by `_stampTemplate` to
     * create and link an instance of the template metadata associated with a
     * particular stamping.
     *
     * @override
     * @param {!HTMLTemplateElement} template Template containing binding
     * bindings
     * @param {boolean=} instanceBinding When false (default), performs
     * "prototypical" binding of the template and overwrites any previously
     * bound template for the class. When true (as passed from
     * `_stampTemplate`), the template info is instanced and linked into the
     * list of bound templates.
     * @return {!TemplateInfo} Template metadata object; for `runtimeBinding`,
     * this is an instance of the prototypical template info
     * @protected
     * @suppress {missingProperties} go/missingfnprops
     */
    _bindTemplate(template, instanceBinding) {
      let templateInfo = this.constructor._parseTemplate(template);
      let wasPreBound = this.__preBoundTemplateInfo == templateInfo;
      if (!wasPreBound) {
        for (let prop in templateInfo.propertyEffects) {
          this._createPropertyAccessor(prop);
        }
      }
      if (instanceBinding) {
        templateInfo = /** @type {!TemplateInfo} */
        Object.create(templateInfo);
        templateInfo.wasPreBound = wasPreBound;
        if (!this.__templateInfo) {
          this.__templateInfo = templateInfo;
        } else {
          const parent = template._parentTemplateInfo || this.__templateInfo;
          const previous = parent.lastChild;
          templateInfo.parent = parent;
          parent.lastChild = templateInfo;
          templateInfo.previousSibling = previous;
          if (previous) {
            previous.nextSibling = templateInfo;
          } else {
            parent.firstChild = templateInfo;
          }
        }
      } else {
        this.__preBoundTemplateInfo = templateInfo;
      }
      return templateInfo;
    }
    /**
     * Adds a property effect to the given template metadata, which is run
     * at the "propagate" stage of `_propertiesChanged` when the template
     * has been bound to the element via `_bindTemplate`.
     *
     * The `effect` object should match the format in `_addPropertyEffect`.
     *
     * @param {Object} templateInfo Template metadata to add effect to
     * @param {string} prop Property that should trigger the effect
     * @param {Object=} effect Effect metadata object
     * @return {void}
     * @protected
     * @nocollapse
     */
    static _addTemplatePropertyEffect(templateInfo, prop, effect) {
      let hostProps = templateInfo.hostProps = templateInfo.hostProps || {};
      hostProps[prop] = true;
      let effects = templateInfo.propertyEffects = templateInfo.propertyEffects || {};
      let propEffects = effects[prop] = effects[prop] || [];
      propEffects.push(effect);
    }
    /**
     * Stamps the provided template and performs instance-time setup for
     * Polymer template features, including data bindings, declarative event
     * listeners, and the `this.$` map of `id`'s to nodes.  A document fragment
     * is returned containing the stamped DOM, ready for insertion into the
     * DOM.
     *
     * This method may be called more than once; however note that due to
     * `shadycss` polyfill limitations, only styles from templates prepared
     * using `ShadyCSS.prepareTemplate` will be correctly polyfilled (scoped
     * to the shadow root and support CSS custom properties), and note that
     * `ShadyCSS.prepareTemplate` may only be called once per element. As such,
     * any styles required by in runtime-stamped templates must be included
     * in the main element template.
     *
     * @param {!HTMLTemplateElement} template Template to stamp
     * @param {TemplateInfo=} templateInfo Optional bound template info associated
     *   with the template to be stamped; if omitted the template will be
     *   automatically bound.
     * @return {!StampedTemplate} Cloned template content
     * @override
     * @protected
     */
    _stampTemplate(template, templateInfo) {
      templateInfo = templateInfo || /** @type {!TemplateInfo} */
      this._bindTemplate(template, true);
      hostStack.push(this);
      let dom = super._stampTemplate(template, templateInfo);
      hostStack.pop();
      templateInfo.nodeList = dom.nodeList;
      if (!templateInfo.wasPreBound) {
        let nodes = templateInfo.childNodes = [];
        for (let n4 = dom.firstChild; n4; n4 = n4.nextSibling) {
          nodes.push(n4);
        }
      }
      dom.templateInfo = templateInfo;
      setupBindings(this, templateInfo);
      if (this.__dataClientsReady) {
        this._runEffectsForTemplate(templateInfo, this.__data, null, false);
        this._flushClients();
      }
      return dom;
    }
    /**
     * Removes and unbinds the nodes previously contained in the provided
     * DocumentFragment returned from `_stampTemplate`.
     *
     * @override
     * @param {!StampedTemplate} dom DocumentFragment previously returned
     *   from `_stampTemplate` associated with the nodes to be removed
     * @return {void}
     * @protected
     */
    _removeBoundDom(dom) {
      const templateInfo = dom.templateInfo;
      const { previousSibling, nextSibling, parent } = templateInfo;
      if (previousSibling) {
        previousSibling.nextSibling = nextSibling;
      } else if (parent) {
        parent.firstChild = nextSibling;
      }
      if (nextSibling) {
        nextSibling.previousSibling = previousSibling;
      } else if (parent) {
        parent.lastChild = previousSibling;
      }
      templateInfo.nextSibling = templateInfo.previousSibling = null;
      let nodes = templateInfo.childNodes;
      for (let i5 = 0; i5 < nodes.length; i5++) {
        let node = nodes[i5];
        wrap(wrap(node).parentNode).removeChild(node);
      }
    }
    /**
     * Overrides default `TemplateStamp` implementation to add support for
     * parsing bindings from `TextNode`'s' `textContent`.  A `bindings`
     * array is added to `nodeInfo` and populated with binding metadata
     * with information capturing the binding target, and a `parts` array
     * with one or more metadata objects capturing the source(s) of the
     * binding.
     *
     * @param {Node} node Node to parse
     * @param {TemplateInfo} templateInfo Template metadata for current template
     * @param {NodeInfo} nodeInfo Node metadata for current template node
     * @return {boolean} `true` if the visited node added node-specific
     *   metadata to `nodeInfo`
     * @protected
     * @suppress {missingProperties} Interfaces in closure do not inherit statics, but classes do
     * @nocollapse
     */
    static _parseTemplateNode(node, templateInfo, nodeInfo) {
      let noted = propertyEffectsBase._parseTemplateNode.call(
        this,
        node,
        templateInfo,
        nodeInfo
      );
      if (node.nodeType === Node.TEXT_NODE) {
        let parts = this._parseBindings(node.textContent, templateInfo);
        if (parts) {
          node.textContent = literalFromParts(parts) || " ";
          addBinding(this, templateInfo, nodeInfo, "text", "textContent", parts);
          noted = true;
        }
      }
      return noted;
    }
    /**
     * Overrides default `TemplateStamp` implementation to add support for
     * parsing bindings from attributes.  A `bindings`
     * array is added to `nodeInfo` and populated with binding metadata
     * with information capturing the binding target, and a `parts` array
     * with one or more metadata objects capturing the source(s) of the
     * binding.
     *
     * @param {Element} node Node to parse
     * @param {TemplateInfo} templateInfo Template metadata for current template
     * @param {NodeInfo} nodeInfo Node metadata for current template node
     * @param {string} name Attribute name
     * @param {string} value Attribute value
     * @return {boolean} `true` if the visited node added node-specific
     *   metadata to `nodeInfo`
     * @protected
     * @suppress {missingProperties} Interfaces in closure do not inherit statics, but classes do
     * @nocollapse
     */
    static _parseTemplateNodeAttribute(node, templateInfo, nodeInfo, name, value) {
      let parts = this._parseBindings(value, templateInfo);
      if (parts) {
        let origName = name;
        let kind = "property";
        if (capitalAttributeRegex.test(name)) {
          kind = "attribute";
        } else if (name[name.length - 1] == "$") {
          name = name.slice(0, -1);
          kind = "attribute";
        }
        let literal = literalFromParts(parts);
        if (literal && kind == "attribute") {
          if (name == "class" && node.hasAttribute("class")) {
            literal += " " + node.getAttribute(name);
          }
          node.setAttribute(name, literal);
        }
        if (kind == "attribute" && origName == "disable-upgrade$") {
          node.setAttribute(name, "");
        }
        if (node.localName === "input" && origName === "value") {
          node.setAttribute(origName, "");
        }
        node.removeAttribute(origName);
        if (kind === "property") {
          name = dashToCamelCase2(name);
        }
        addBinding(this, templateInfo, nodeInfo, kind, name, parts, literal);
        return true;
      } else {
        return propertyEffectsBase._parseTemplateNodeAttribute.call(
          this,
          node,
          templateInfo,
          nodeInfo,
          name,
          value
        );
      }
    }
    /**
     * Overrides default `TemplateStamp` implementation to add support for
     * binding the properties that a nested template depends on to the template
     * as `_host_<property>`.
     *
     * @param {Node} node Node to parse
     * @param {TemplateInfo} templateInfo Template metadata for current template
     * @param {NodeInfo} nodeInfo Node metadata for current template node
     * @return {boolean} `true` if the visited node added node-specific
     *   metadata to `nodeInfo`
     * @protected
     * @suppress {missingProperties} Interfaces in closure do not inherit statics, but classes do
     * @nocollapse
     */
    static _parseTemplateNestedTemplate(node, templateInfo, nodeInfo) {
      let noted = propertyEffectsBase._parseTemplateNestedTemplate.call(
        this,
        node,
        templateInfo,
        nodeInfo
      );
      const parent = node.parentNode;
      const nestedTemplateInfo = nodeInfo.templateInfo;
      const isDomIf = parent.localName === "dom-if";
      const isDomRepeat = parent.localName === "dom-repeat";
      if (removeNestedTemplates && (isDomIf || isDomRepeat)) {
        parent.removeChild(node);
        nodeInfo = nodeInfo.parentInfo;
        nodeInfo.templateInfo = nestedTemplateInfo;
        nodeInfo.noted = true;
        noted = false;
      }
      let hostProps = nestedTemplateInfo.hostProps;
      if (fastDomIf && isDomIf) {
        if (hostProps) {
          templateInfo.hostProps = Object.assign(templateInfo.hostProps || {}, hostProps);
          if (!removeNestedTemplates) {
            nodeInfo.parentInfo.noted = true;
          }
        }
      } else {
        let mode = "{";
        for (let source in hostProps) {
          let parts = [{ mode, source, dependencies: [source], hostProp: true }];
          addBinding(this, templateInfo, nodeInfo, "property", "_host_" + source, parts);
        }
      }
      return noted;
    }
    /**
     * Called to parse text in a template (either attribute values or
     * textContent) into binding metadata.
     *
     * Any overrides of this method should return an array of binding part
     * metadata  representing one or more bindings found in the provided text
     * and any "literal" text in between.  Any non-literal parts will be passed
     * to `_evaluateBinding` when any dependencies change.  The only required
     * fields of each "part" in the returned array are as follows:
     *
     * - `dependencies` - Array containing trigger metadata for each property
     *   that should trigger the binding to update
     * - `literal` - String containing text if the part represents a literal;
     *   in this case no `dependencies` are needed
     *
     * Additional metadata for use by `_evaluateBinding` may be provided in
     * each part object as needed.
     *
     * The default implementation handles the following types of bindings
     * (one or more may be intermixed with literal strings):
     * - Property binding: `[[prop]]`
     * - Path binding: `[[object.prop]]`
     * - Negated property or path bindings: `[[!prop]]` or `[[!object.prop]]`
     * - Two-way property or path bindings (supports negation):
     *   `{{prop}}`, `{{object.prop}}`, `{{!prop}}` or `{{!object.prop}}`
     * - Inline computed method (supports negation):
     *   `[[compute(a, 'literal', b)]]`, `[[!compute(a, 'literal', b)]]`
     *
     * The default implementation uses a regular expression for best
     * performance. However, the regular expression uses a white-list of
     * allowed characters in a data-binding, which causes problems for
     * data-bindings that do use characters not in this white-list.
     *
     * Instead of updating the white-list with all allowed characters,
     * there is a StrictBindingParser (see lib/mixins/strict-binding-parser)
     * that uses a state machine instead. This state machine is able to handle
     * all characters. However, it is slightly less performant, therefore we
     * extracted it into a separate optional mixin.
     *
     * @param {string} text Text to parse from attribute or textContent
     * @param {Object} templateInfo Current template metadata
     * @return {Array<!BindingPart>} Array of binding part metadata
     * @protected
     * @nocollapse
     */
    static _parseBindings(text, templateInfo) {
      let parts = [];
      let lastIndex = 0;
      let m2;
      while ((m2 = bindingRegex.exec(text)) !== null) {
        if (m2.index > lastIndex) {
          parts.push({ literal: text.slice(lastIndex, m2.index) });
        }
        let mode = m2[1][0];
        let negate = Boolean(m2[2]);
        let source = m2[3].trim();
        let customEvent = false, notifyEvent = "", colon = -1;
        if (mode == "{" && (colon = source.indexOf("::")) > 0) {
          notifyEvent = source.substring(colon + 2);
          source = source.substring(0, colon);
          customEvent = true;
        }
        let signature = parseMethod(source);
        let dependencies = [];
        if (signature) {
          let { args, methodName } = signature;
          for (let i5 = 0; i5 < args.length; i5++) {
            let arg = args[i5];
            if (!arg.literal) {
              dependencies.push(arg);
            }
          }
          let dynamicFns = templateInfo.dynamicFns;
          if (dynamicFns && dynamicFns[methodName] || signature.static) {
            dependencies.push(methodName);
            signature.dynamicFn = true;
          }
        } else {
          dependencies.push(source);
        }
        parts.push({
          source,
          mode,
          negate,
          customEvent,
          signature,
          dependencies,
          event: notifyEvent
        });
        lastIndex = bindingRegex.lastIndex;
      }
      if (lastIndex && lastIndex < text.length) {
        let literal = text.substring(lastIndex);
        if (literal) {
          parts.push({
            literal
          });
        }
      }
      if (parts.length) {
        return parts;
      } else {
        return null;
      }
    }
    /**
     * Called to evaluate a previously parsed binding part based on a set of
     * one or more changed dependencies.
     *
     * @param {!Polymer_PropertyEffects} inst Element that should be used as
     *     scope for binding dependencies
     * @param {BindingPart} part Binding part metadata
     * @param {string} path Property/path that triggered this effect
     * @param {Object} props Bag of current property changes
     * @param {Object} oldProps Bag of previous values for changed properties
     * @param {boolean} hasPaths True with `props` contains one or more paths
     * @return {*} Value the binding part evaluated to
     * @protected
     * @nocollapse
     */
    static _evaluateBinding(inst, part, path, props, oldProps, hasPaths) {
      let value;
      if (part.signature) {
        value = runMethodEffect(inst, path, props, oldProps, part.signature);
      } else if (path != part.source) {
        value = get(inst, part.source);
      } else {
        if (hasPaths && isPath(path)) {
          value = get(inst, path);
        } else {
          value = inst.__data[path];
        }
      }
      if (part.negate) {
        value = !value;
      }
      return value;
    }
  }
  return PropertyEffects2;
});
var hostStack = [];

// node_modules/@polymer/polymer/lib/utils/telemetry.js
var instanceCount = 0;
function incrementInstanceCount() {
  instanceCount++;
}
var registrations = [];
function register(prototype) {
  registrations.push(prototype);
}

// node_modules/@polymer/polymer/lib/mixins/properties-mixin.js
function normalizeProperties(props) {
  const output = {};
  for (let p3 in props) {
    const o5 = props[p3];
    output[p3] = typeof o5 === "function" ? { type: o5 } : o5;
  }
  return output;
}
var PropertiesMixin = dedupingMixin((superClass) => {
  const base = PropertiesChanged(superClass);
  function superPropertiesClass(constructor) {
    const superCtor = Object.getPrototypeOf(constructor);
    return superCtor.prototype instanceof PropertiesMixin2 ? (
      /** @type {!PropertiesMixinConstructor} */
      superCtor
    ) : null;
  }
  function ownProperties(constructor) {
    if (!constructor.hasOwnProperty(JSCompiler_renameProperty("__ownProperties", constructor))) {
      let props = null;
      if (constructor.hasOwnProperty(JSCompiler_renameProperty("properties", constructor))) {
        const properties = constructor.properties;
        if (properties) {
          props = normalizeProperties(properties);
        }
      }
      constructor.__ownProperties = props;
    }
    return constructor.__ownProperties;
  }
  class PropertiesMixin2 extends base {
    /**
     * Implements standard custom elements getter to observes the attributes
     * listed in `properties`.
     * @suppress {missingProperties} Interfaces in closure do not inherit statics, but classes do
     * @nocollapse
     */
    static get observedAttributes() {
      if (!this.hasOwnProperty(JSCompiler_renameProperty("__observedAttributes", this))) {
        register(this.prototype);
        const props = this._properties;
        this.__observedAttributes = props ? Object.keys(props).map((p3) => this.prototype._addPropertyToAttributeMap(p3)) : [];
      }
      return this.__observedAttributes;
    }
    /**
     * Finalizes an element definition, including ensuring any super classes
     * are also finalized. This includes ensuring property
     * accessors exist on the element prototype. This method calls
     * `_finalizeClass` to finalize each constructor in the prototype chain.
     * @return {void}
     * @nocollapse
     */
    static finalize() {
      if (!this.hasOwnProperty(JSCompiler_renameProperty("__finalized", this))) {
        const superCtor = superPropertiesClass(
          /** @type {!PropertiesMixinConstructor} */
          this
        );
        if (superCtor) {
          superCtor.finalize();
        }
        this.__finalized = true;
        this._finalizeClass();
      }
    }
    /**
     * Finalize an element class. This includes ensuring property
     * accessors exist on the element prototype. This method is called by
     * `finalize` and finalizes the class constructor.
     *
     * @protected
     * @nocollapse
     */
    static _finalizeClass() {
      const props = ownProperties(
        /** @type {!PropertiesMixinConstructor} */
        this
      );
      if (props) {
        this.createProperties(props);
      }
    }
    /**
     * Returns a memoized version of all properties, including those inherited
     * from super classes. Properties not in object format are converted to
     * at least {type}.
     *
     * @return {Object} Object containing properties for this class
     * @protected
     * @nocollapse
     */
    static get _properties() {
      if (!this.hasOwnProperty(
        JSCompiler_renameProperty("__properties", this)
      )) {
        const superCtor = superPropertiesClass(
          /** @type {!PropertiesMixinConstructor} */
          this
        );
        this.__properties = Object.assign(
          {},
          superCtor && superCtor._properties,
          ownProperties(
            /** @type {PropertiesMixinConstructor} */
            this
          )
        );
      }
      return this.__properties;
    }
    /**
     * Overrides `PropertiesChanged` method to return type specified in the
     * static `properties` object for the given property.
     * @param {string} name Name of property
     * @return {*} Type to which to deserialize attribute
     *
     * @protected
     * @nocollapse
     */
    static typeForProperty(name) {
      const info = this._properties[name];
      return info && info.type;
    }
    /**
     * Overrides `PropertiesChanged` method and adds a call to
     * `finalize` which lazily configures the element's property accessors.
     * @override
     * @return {void}
     */
    _initializeProperties() {
      incrementInstanceCount();
      this.constructor.finalize();
      super._initializeProperties();
    }
    /**
     * Called when the element is added to a document.
     * Calls `_enableProperties` to turn on property system from
     * `PropertiesChanged`.
     * @suppress {missingProperties} Super may or may not implement the callback
     * @return {void}
     * @override
     */
    connectedCallback() {
      if (super.connectedCallback) {
        super.connectedCallback();
      }
      this._enableProperties();
    }
    /**
     * Called when the element is removed from a document
     * @suppress {missingProperties} Super may or may not implement the callback
     * @return {void}
     * @override
     */
    disconnectedCallback() {
      if (super.disconnectedCallback) {
        super.disconnectedCallback();
      }
    }
  }
  return PropertiesMixin2;
});

// node_modules/@polymer/polymer/lib/mixins/element-mixin.js
var version = "3.5.2";
var builtCSS = window.ShadyCSS && window.ShadyCSS["cssBuild"];
var ElementMixin = dedupingMixin((base) => {
  const polymerElementBase = PropertiesMixin(PropertyEffects(base));
  function propertyDefaults(constructor) {
    if (!constructor.hasOwnProperty(
      JSCompiler_renameProperty("__propertyDefaults", constructor)
    )) {
      constructor.__propertyDefaults = null;
      let props = constructor._properties;
      for (let p3 in props) {
        let info = props[p3];
        if ("value" in info) {
          constructor.__propertyDefaults = constructor.__propertyDefaults || {};
          constructor.__propertyDefaults[p3] = info;
        }
      }
    }
    return constructor.__propertyDefaults;
  }
  function ownObservers(constructor) {
    if (!constructor.hasOwnProperty(
      JSCompiler_renameProperty("__ownObservers", constructor)
    )) {
      constructor.__ownObservers = constructor.hasOwnProperty(
        JSCompiler_renameProperty("observers", constructor)
      ) ? (
        /** @type {PolymerElementConstructor} */
        constructor.observers
      ) : null;
    }
    return constructor.__ownObservers;
  }
  function createPropertyFromConfig(proto2, name, info, allProps) {
    if (info.computed) {
      info.readOnly = true;
    }
    if (info.computed) {
      if (proto2._hasReadOnlyEffect(name)) {
        console.warn(`Cannot redefine computed property '${name}'.`);
      } else {
        proto2._createComputedProperty(name, info.computed, allProps);
      }
    }
    if (info.readOnly && !proto2._hasReadOnlyEffect(name)) {
      proto2._createReadOnlyProperty(name, !info.computed);
    } else if (info.readOnly === false && proto2._hasReadOnlyEffect(name)) {
      console.warn(`Cannot make readOnly property '${name}' non-readOnly.`);
    }
    if (info.reflectToAttribute && !proto2._hasReflectEffect(name)) {
      proto2._createReflectedProperty(name);
    } else if (info.reflectToAttribute === false && proto2._hasReflectEffect(name)) {
      console.warn(`Cannot make reflected property '${name}' non-reflected.`);
    }
    if (info.notify && !proto2._hasNotifyEffect(name)) {
      proto2._createNotifyingProperty(name);
    } else if (info.notify === false && proto2._hasNotifyEffect(name)) {
      console.warn(`Cannot make notify property '${name}' non-notify.`);
    }
    if (info.observer) {
      proto2._createPropertyObserver(name, info.observer, allProps[info.observer]);
    }
    proto2._addPropertyToAttributeMap(name);
  }
  function processElementStyles(klass, template, is, baseURI) {
    if (!builtCSS) {
      const templateStyles = template.content.querySelectorAll("style");
      const stylesWithImports = stylesFromTemplate(template);
      const linkedStyles = stylesFromModuleImports(is);
      const firstTemplateChild = template.content.firstElementChild;
      for (let idx = 0; idx < linkedStyles.length; idx++) {
        let s4 = linkedStyles[idx];
        s4.textContent = klass._processStyleText(s4.textContent, baseURI);
        template.content.insertBefore(s4, firstTemplateChild);
      }
      let templateStyleIndex = 0;
      for (let i5 = 0; i5 < stylesWithImports.length; i5++) {
        let s4 = stylesWithImports[i5];
        let templateStyle = templateStyles[templateStyleIndex];
        if (templateStyle !== s4) {
          s4 = s4.cloneNode(true);
          templateStyle.parentNode.insertBefore(s4, templateStyle);
        } else {
          templateStyleIndex++;
        }
        s4.textContent = klass._processStyleText(s4.textContent, baseURI);
      }
    }
    if (window.ShadyCSS) {
      window.ShadyCSS.prepareTemplate(template, is);
    }
    if (useAdoptedStyleSheetsWithBuiltCSS && builtCSS && supportsAdoptingStyleSheets) {
      const styles = template.content.querySelectorAll("style");
      if (styles) {
        let css = "";
        Array.from(styles).forEach((s4) => {
          css += s4.textContent;
          s4.parentNode.removeChild(s4);
        });
        klass._styleSheet = new CSSStyleSheet();
        klass._styleSheet.replaceSync(css);
      }
    }
  }
  function getTemplateFromDomModule(is) {
    let template = null;
    if (is && (!strictTemplatePolicy || allowTemplateFromDomModule)) {
      template = /** @type {?HTMLTemplateElement} */
      DomModule.import(is, "template");
      if (strictTemplatePolicy && !template) {
        throw new Error(`strictTemplatePolicy: expecting dom-module or null template for ${is}`);
      }
    }
    return template;
  }
  class PolymerElement2 extends polymerElementBase {
    /**
     * Current Polymer version in Semver notation.
     * @type {string} Semver notation of the current version of Polymer.
     * @nocollapse
     */
    static get polymerElementVersion() {
      return version;
    }
    /**
     * Override of PropertiesMixin _finalizeClass to create observers and
     * find the template.
     * @return {void}
     * @protected
     * @suppress {missingProperties} Interfaces in closure do not inherit statics, but classes do
     * @nocollapse
     */
    static _finalizeClass() {
      polymerElementBase._finalizeClass.call(this);
      const observers = ownObservers(this);
      if (observers) {
        this.createObservers(observers, this._properties);
      }
      this._prepareTemplate();
    }
    /** @nocollapse */
    static _prepareTemplate() {
      let template = (
        /** @type {PolymerElementConstructor} */
        this.template
      );
      if (template) {
        if (typeof template === "string") {
          console.error("template getter must return HTMLTemplateElement");
          template = null;
        } else if (!legacyOptimizations) {
          template = template.cloneNode(true);
        }
      }
      this.prototype._template = template;
    }
    /**
     * Override of PropertiesChanged createProperties to create accessors
     * and property effects for all of the properties.
     * @param {!Object} props .
     * @return {void}
     * @protected
     * @nocollapse
     */
    static createProperties(props) {
      for (let p3 in props) {
        createPropertyFromConfig(
          /** @type {?} */
          this.prototype,
          p3,
          props[p3],
          props
        );
      }
    }
    /**
     * Creates observers for the given `observers` array.
     * Leverages `PropertyEffects` to create observers.
     * @param {Object} observers Array of observer descriptors for
     *   this class
     * @param {Object} dynamicFns Object containing keys for any properties
     *   that are functions and should trigger the effect when the function
     *   reference is changed
     * @return {void}
     * @protected
     * @nocollapse
     */
    static createObservers(observers, dynamicFns) {
      const proto2 = this.prototype;
      for (let i5 = 0; i5 < observers.length; i5++) {
        proto2._createMethodObserver(observers[i5], dynamicFns);
      }
    }
    /**
     * Returns the template that will be stamped into this element's shadow root.
     *
     * If a `static get is()` getter is defined, the default implementation will
     * return the first `<template>` in a `dom-module` whose `id` matches this
     * element's `is` (note that a `_template` property on the class prototype
     * takes precedence over the `dom-module` template, to maintain legacy
     * element semantics; a subclass will subsequently fall back to its super
     * class template if neither a `prototype._template` or a `dom-module` for
     * the class's `is` was found).
     *
     * Users may override this getter to return an arbitrary template
     * (in which case the `is` getter is unnecessary). The template returned
     * must be an `HTMLTemplateElement`.
     *
     * Note that when subclassing, if the super class overrode the default
     * implementation and the subclass would like to provide an alternate
     * template via a `dom-module`, it should override this getter and
     * return `DomModule.import(this.is, 'template')`.
     *
     * If a subclass would like to modify the super class template, it should
     * clone it rather than modify it in place.  If the getter does expensive
     * work such as cloning/modifying a template, it should memoize the
     * template for maximum performance:
     *
     *   let memoizedTemplate;
     *   class MySubClass extends MySuperClass {
     *     static get template() {
     *       if (!memoizedTemplate) {
     *         memoizedTemplate = super.template.cloneNode(true);
     *         let subContent = document.createElement('div');
     *         subContent.textContent = 'This came from MySubClass';
     *         memoizedTemplate.content.appendChild(subContent);
     *       }
     *       return memoizedTemplate;
     *     }
     *   }
     *
     * @return {!HTMLTemplateElement|string} Template to be stamped
     * @nocollapse
     */
    static get template() {
      if (!this.hasOwnProperty(JSCompiler_renameProperty("_template", this))) {
        let protoTemplate = this.prototype.hasOwnProperty(
          JSCompiler_renameProperty("_template", this.prototype)
        ) ? this.prototype._template : void 0;
        if (typeof protoTemplate === "function") {
          protoTemplate = protoTemplate();
        }
        this._template = // If user has put template on prototype (e.g. in legacy via registered
        // callback or info object), prefer that first. Note that `null` is
        // used as a sentinel to indicate "no template" and can be used to
        // override a super template, whereas `undefined` is used as a
        // sentinel to mean "fall-back to default template lookup" via
        // dom-module and/or super.template.
        protoTemplate !== void 0 ? protoTemplate : (
          // Look in dom-module associated with this element's is
          this.hasOwnProperty(JSCompiler_renameProperty("is", this)) && getTemplateFromDomModule(
            /** @type {PolymerElementConstructor}*/
            this.is
          ) || // Next look for superclass template (call the super impl this
          // way so that `this` points to the superclass)
          Object.getPrototypeOf(
            /** @type {PolymerElementConstructor}*/
            this.prototype
          ).constructor.template
        );
      }
      return this._template;
    }
    /**
     * Set the template.
     *
     * @param {!HTMLTemplateElement|string} value Template to set.
     * @nocollapse
     */
    static set template(value) {
      this._template = value;
    }
    /**
     * Path matching the url from which the element was imported.
     *
     * This path is used to resolve url's in template style cssText.
     * The `importPath` property is also set on element instances and can be
     * used to create bindings relative to the import path.
     *
     * For elements defined in ES modules, users should implement
     * `static get importMeta() { return import.meta; }`, and the default
     * implementation of `importPath` will  return `import.meta.url`'s path.
     * For elements defined in HTML imports, this getter will return the path
     * to the document containing a `dom-module` element matching this
     * element's static `is` property.
     *
     * Note, this path should contain a trailing `/`.
     *
     * @return {string} The import path for this element class
     * @suppress {missingProperties}
     * @nocollapse
     */
    static get importPath() {
      if (!this.hasOwnProperty(JSCompiler_renameProperty("_importPath", this))) {
        const meta = this.importMeta;
        if (meta) {
          this._importPath = pathFromUrl(meta.url);
        } else {
          const module = DomModule.import(
            /** @type {PolymerElementConstructor} */
            this.is
          );
          this._importPath = module && module.assetpath || Object.getPrototypeOf(
            /** @type {PolymerElementConstructor}*/
            this.prototype
          ).constructor.importPath;
        }
      }
      return this._importPath;
    }
    constructor() {
      super();
      this._template;
      this._importPath;
      this.rootPath;
      this.importPath;
      this.root;
      this.$;
    }
    /**
     * Overrides the default `PropertyAccessors` to ensure class
     * metaprogramming related to property accessors and effects has
     * completed (calls `finalize`).
     *
     * It also initializes any property defaults provided via `value` in
     * `properties` metadata.
     *
     * @return {void}
     * @override
     * @suppress {invalidCasts,missingProperties} go/missingfnprops
     */
    _initializeProperties() {
      this.constructor.finalize();
      this.constructor._finalizeTemplate(
        /** @type {!HTMLElement} */
        this.localName
      );
      super._initializeProperties();
      this.rootPath = rootPath;
      this.importPath = this.constructor.importPath;
      let p$ = propertyDefaults(this.constructor);
      if (!p$) {
        return;
      }
      for (let p3 in p$) {
        let info = p$[p3];
        if (this._canApplyPropertyDefault(p3)) {
          let value = typeof info.value == "function" ? info.value.call(this) : info.value;
          if (this._hasAccessor(p3)) {
            this._setPendingProperty(p3, value, true);
          } else {
            this[p3] = value;
          }
        }
      }
    }
    /**
     * Determines if a property dfeault can be applied. For example, this
     * prevents a default from being applied when a property that has no
     * accessor is overridden by its host before upgrade (e.g. via a binding).
     * @override
     * @param {string} property Name of the property
     * @return {boolean} Returns true if the property default can be applied.
     */
    _canApplyPropertyDefault(property) {
      return !this.hasOwnProperty(property);
    }
    /**
     * Gather style text for a style element in the template.
     *
     * @param {string} cssText Text containing styling to process
     * @param {string} baseURI Base URI to rebase CSS paths against
     * @return {string} The processed CSS text
     * @protected
     * @nocollapse
     */
    static _processStyleText(cssText, baseURI) {
      return resolveCss(cssText, baseURI);
    }
    /**
    * Configures an element `proto` to function with a given `template`.
    * The element name `is` and extends `ext` must be specified for ShadyCSS
    * style scoping.
    *
    * @param {string} is Tag name (or type extension name) for this element
    * @return {void}
    * @protected
    * @nocollapse
    */
    static _finalizeTemplate(is) {
      const template = this.prototype._template;
      if (template && !template.__polymerFinalized) {
        template.__polymerFinalized = true;
        const importPath = this.importPath;
        const baseURI = importPath ? resolveUrl(importPath) : "";
        processElementStyles(this, template, is, baseURI);
        this.prototype._bindTemplate(template);
      }
    }
    /**
     * Provides a default implementation of the standard Custom Elements
     * `connectedCallback`.
     *
     * The default implementation enables the property effects system and
     * flushes any pending properties, and updates shimmed CSS properties
     * when using the ShadyCSS scoping/custom properties polyfill.
     *
     * @override
     * @suppress {missingProperties, invalidCasts} Super may or may not
     *     implement the callback
     * @return {void}
     */
    connectedCallback() {
      if (window.ShadyCSS && this._template) {
        window.ShadyCSS.styleElement(
          /** @type {!HTMLElement} */
          this
        );
      }
      super.connectedCallback();
    }
    /**
     * Stamps the element template.
     *
     * @return {void}
     * @override
     */
    ready() {
      if (this._template) {
        this.root = this._stampTemplate(this._template);
        this.$ = this.root.$;
      }
      super.ready();
    }
    /**
     * Implements `PropertyEffects`'s `_readyClients` call. Attaches
     * element dom by calling `_attachDom` with the dom stamped from the
     * element's template via `_stampTemplate`. Note that this allows
     * client dom to be attached to the element prior to any observers
     * running.
     *
     * @return {void}
     * @override
     */
    _readyClients() {
      if (this._template) {
        this.root = this._attachDom(
          /** @type {StampedTemplate} */
          this.root
        );
      }
      super._readyClients();
    }
    /**
     * Attaches an element's stamped dom to itself. By default,
     * this method creates a `shadowRoot` and adds the dom to it.
     * However, this method may be overridden to allow an element
     * to put its dom in another location.
     *
     * @override
     * @throws {Error}
     * @suppress {missingReturn}
     * @param {StampedTemplate} dom to attach to the element.
     * @return {ShadowRoot} node to which the dom has been attached.
     */
    _attachDom(dom) {
      const n4 = wrap(this);
      if (n4.attachShadow) {
        if (dom) {
          if (!n4.shadowRoot) {
            n4.attachShadow({ mode: "open", shadyUpgradeFragment: dom });
            n4.shadowRoot.appendChild(dom);
            if (this.constructor._styleSheet) {
              n4.shadowRoot.adoptedStyleSheets = [this.constructor._styleSheet];
            }
          }
          if (syncInitialRender && window.ShadyDOM) {
            window.ShadyDOM.flushInitial(n4.shadowRoot);
          }
          return n4.shadowRoot;
        }
        return null;
      } else {
        throw new Error("ShadowDOM not available. PolymerElement can create dom as children instead of in ShadowDOM by setting `this.root = this;` before `ready`.");
      }
    }
    /**
     * When using the ShadyCSS scoping and custom property shim, causes all
     * shimmed styles in this element (and its subtree) to be updated
     * based on current custom property values.
     *
     * The optional parameter overrides inline custom property styles with an
     * object of properties where the keys are CSS properties, and the values
     * are strings.
     *
     * Example: `this.updateStyles({'--color': 'blue'})`
     *
     * These properties are retained unless a value of `null` is set.
     *
     * Note: This function does not support updating CSS mixins.
     * You can not dynamically change the value of an `@apply`.
     *
     * @override
     * @param {Object=} properties Bag of custom property key/values to
     *   apply to this element.
     * @return {void}
     * @suppress {invalidCasts}
     */
    updateStyles(properties) {
      if (window.ShadyCSS) {
        window.ShadyCSS.styleSubtree(
          /** @type {!HTMLElement} */
          this,
          properties
        );
      }
    }
    /**
     * Rewrites a given URL relative to a base URL. The base URL defaults to
     * the original location of the document containing the `dom-module` for
     * this element. This method will return the same URL before and after
     * bundling.
     *
     * Note that this function performs no resolution for URLs that start
     * with `/` (absolute URLs) or `#` (hash identifiers).  For general purpose
     * URL resolution, use `window.URL`.
     *
     * @override
     * @param {string} url URL to resolve.
     * @param {string=} base Optional base URL to resolve against, defaults
     * to the element's `importPath`
     * @return {string} Rewritten URL relative to base
     */
    resolveUrl(url, base2) {
      if (!base2 && this.importPath) {
        base2 = resolveUrl(this.importPath);
      }
      return resolveUrl(url, base2);
    }
    /**
     * Overrides `PropertyEffects` to add map of dynamic functions on
     * template info, for consumption by `PropertyEffects` template binding
     * code. This map determines which method templates should have accessors
     * created for them.
     *
     * @param {!HTMLTemplateElement} template Template
     * @param {!TemplateInfo} templateInfo Template metadata for current template
     * @param {!NodeInfo} nodeInfo Node metadata for current template.
     * @return {boolean} .
     * @suppress {missingProperties} Interfaces in closure do not inherit statics, but classes do
     * @nocollapse
     */
    static _parseTemplateContent(template, templateInfo, nodeInfo) {
      templateInfo.dynamicFns = templateInfo.dynamicFns || this._properties;
      return polymerElementBase._parseTemplateContent.call(
        this,
        template,
        templateInfo,
        nodeInfo
      );
    }
    /**
     * Overrides `PropertyEffects` to warn on use of undeclared properties in
     * template.
     *
     * @param {Object} templateInfo Template metadata to add effect to
     * @param {string} prop Property that should trigger the effect
     * @param {Object=} effect Effect metadata object
     * @return {void}
     * @protected
     * @suppress {missingProperties} Interfaces in closure do not inherit statics, but classes do
     * @nocollapse
     */
    static _addTemplatePropertyEffect(templateInfo, prop, effect) {
      if (legacyWarnings && !(prop in this._properties) && // Methods used in templates with no dependencies (or only literal
      // dependencies) become accessors with template effects; ignore these
      !(effect.info.part.signature && effect.info.part.signature.static) && // Warnings for bindings added to nested templates are handled by
      // templatizer so ignore both the host-to-template bindings
      // (`hostProp`) and TemplateInstance-to-child bindings
      // (`nestedTemplate`)
      !effect.info.part.hostProp && !templateInfo.nestedTemplate) {
        console.warn(`Property '${prop}' used in template but not declared in 'properties'; attribute will not be observed.`);
      }
      return polymerElementBase._addTemplatePropertyEffect.call(
        this,
        templateInfo,
        prop,
        effect
      );
    }
  }
  return PolymerElement2;
});

// node_modules/@polymer/polymer/lib/utils/html-tag.js
var policy = window.trustedTypes && trustedTypes.createPolicy("polymer-html-literal", { createHTML: (s4) => s4 });
var LiteralString = class {
  /**
   * @param {!ITemplateArray} strings Constant parts of tagged template literal
   * @param {!Array<*>} values Variable parts of tagged template literal
   */
  constructor(strings, values) {
    assertValidTemplateStringParameters(strings, values);
    const string = values.reduce(
      (acc, v2, idx) => acc + literalValue(v2) + strings[idx + 1],
      strings[0]
    );
    this.value = string.toString();
  }
  /**
   * @return {string} LiteralString string value
   * @override
   */
  toString() {
    return this.value;
  }
};
function literalValue(value) {
  if (value instanceof LiteralString) {
    return (
      /** @type {!LiteralString} */
      value.value
    );
  } else {
    throw new Error(
      `non-literal value passed to Polymer's htmlLiteral function: ${value}`
    );
  }
}
function htmlValue(value) {
  if (value instanceof HTMLTemplateElement) {
    return (
      /** @type {!HTMLTemplateElement } */
      value.innerHTML
    );
  } else if (value instanceof LiteralString) {
    return literalValue(value);
  } else {
    throw new Error(
      `non-template value passed to Polymer's html function: ${value}`
    );
  }
}
var html = function html2(strings, ...values) {
  assertValidTemplateStringParameters(strings, values);
  const template = (
    /** @type {!HTMLTemplateElement} */
    document.createElement("template")
  );
  let value = values.reduce(
    (acc, v2, idx) => acc + htmlValue(v2) + strings[idx + 1],
    strings[0]
  );
  if (policy) {
    value = policy.createHTML(value);
  }
  template.innerHTML = value;
  return template;
};
var assertValidTemplateStringParameters = (strings, values) => {
  if (!Array.isArray(strings) || !Array.isArray(strings.raw) || values.length !== strings.length - 1) {
    throw new TypeError("Invalid call to the html template tag");
  }
};

// node_modules/@polymer/polymer/polymer-element.js
var PolymerElement = ElementMixin(HTMLElement);

// node_modules/@vaadin/component-base/src/dir-mixin.js
var directionSubscribers = [];
function alignDirs(element, documentDir, elementDir = element.getAttribute("dir")) {
  if (documentDir) {
    element.setAttribute("dir", documentDir);
  } else if (elementDir != null) {
    element.removeAttribute("dir");
  }
}
function getDocumentDir() {
  return document.documentElement.getAttribute("dir");
}
function directionUpdater() {
  const documentDir = getDocumentDir();
  directionSubscribers.forEach((element) => {
    alignDirs(element, documentDir);
  });
}
var directionObserver = new MutationObserver(directionUpdater);
directionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] });
var DirMixin = (superClass) => class VaadinDirMixin extends superClass {
  static get properties() {
    return {
      /**
       * @protected
       */
      dir: {
        type: String,
        value: "",
        reflectToAttribute: true,
        converter: {
          fromAttribute: (attr) => {
            return !attr ? "" : attr;
          },
          toAttribute: (prop) => {
            return prop === "" ? null : prop;
          }
        }
      }
    };
  }
  /**
   * @return {boolean}
   * @protected
   */
  get __isRTL() {
    return this.getAttribute("dir") === "rtl";
  }
  /** @protected */
  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute("dir") || this.__restoreSubscription) {
      this.__subscribe();
      alignDirs(this, getDocumentDir(), null);
    }
  }
  /** @protected */
  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name !== "dir") {
      return;
    }
    const documentDir = getDocumentDir();
    const newValueEqlDocDir = newValue === documentDir && directionSubscribers.indexOf(this) === -1;
    const newValueEmptied = !newValue && oldValue && directionSubscribers.indexOf(this) === -1;
    const newDiffValue = newValue !== documentDir && oldValue === documentDir;
    if (newValueEqlDocDir || newValueEmptied) {
      this.__subscribe();
      alignDirs(this, documentDir, newValue);
    } else if (newDiffValue) {
      this.__unsubscribe();
    }
  }
  /** @protected */
  disconnectedCallback() {
    super.disconnectedCallback();
    this.__restoreSubscription = directionSubscribers.includes(this);
    this.__unsubscribe();
  }
  /** @protected */
  _valueToNodeAttribute(node, value, attribute) {
    if (attribute === "dir" && value === "" && !node.hasAttribute("dir")) {
      return;
    }
    super._valueToNodeAttribute(node, value, attribute);
  }
  /** @protected */
  _attributeToProperty(attribute, value, type) {
    if (attribute === "dir" && !value) {
      this.dir = "";
    } else {
      super._attributeToProperty(attribute, value, type);
    }
  }
  /** @private */
  __subscribe() {
    if (!directionSubscribers.includes(this)) {
      directionSubscribers.push(this);
    }
  }
  /** @private */
  __unsubscribe() {
    if (directionSubscribers.includes(this)) {
      directionSubscribers.splice(directionSubscribers.indexOf(this), 1);
    }
  }
};

// node_modules/@vaadin/input-container/src/vaadin-input-container-core-styles.js
var inputContainerStyles = i`
  :host {
    display: flex;
    align-items: center;
    flex: 0 1 auto;
    border-radius:
            /* See https://developer.mozilla.org/en-US/docs/Web/CSS/border-radius */
      var(--vaadin-input-field-top-start-radius, var(--__border-radius))
      var(--vaadin-input-field-top-end-radius, var(--__border-radius))
      var(--vaadin-input-field-bottom-end-radius, var(--__border-radius))
      var(--vaadin-input-field-bottom-start-radius, var(--__border-radius));
    --_border-radius: var(--vaadin-input-field-border-radius, 0);
    --_input-border-width: var(--vaadin-input-field-border-width, 0px);
    --_input-border-color: var(--vaadin-input-field-border-color, transparent);
    /* stylelint-disable-next-line length-zero-no-unit */
    box-shadow: inset 0 0 0 var(--_input-border-width, 0) var(--_input-border-color);
  }

  :host([dir='rtl']) {
    border-radius:
            /* Don't use logical props, see https://github.com/vaadin/vaadin-time-picker/issues/145 */
      var(--vaadin-input-field-top-end-radius, var(--_border-radius))
      var(--vaadin-input-field-top-start-radius, var(--_border-radius))
      var(--vaadin-input-field-bottom-start-radius, var(--_border-radius))
      var(--vaadin-input-field-bottom-end-radius, var(--_border-radius));
  }

  :host([hidden]) {
    display: none !important;
  }

  /* Reset the native input styles */
  ::slotted(input) {
    -webkit-appearance: none;
    -moz-appearance: none;
    flex: auto;
    white-space: nowrap;
    overflow: hidden;
    width: 100%;
    height: 100%;
    outline: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    min-width: 0;
    font: inherit;
    line-height: normal;
    color: inherit;
    background-color: transparent;
    /* Disable default invalid style in Firefox */
    box-shadow: none;
  }

  ::slotted(*) {
    flex: none;
  }

  ::slotted(:is(input, textarea))::placeholder {
    /* Use ::slotted(input:placeholder-shown) in themes to style the placeholder. */
    /* because ::slotted(...)::placeholder does not work in Safari. */
    font: inherit;
    color: inherit;
    /* Override default opacity in Firefox */
    opacity: 1;
  }
`;

// node_modules/@vaadin/input-container/src/vaadin-input-container-mixin.js
var InputContainerMixin = (superClass) => class InputContainerMixinClass extends superClass {
  static get properties() {
    return {
      /**
       * If true, the user cannot interact with this element.
       */
      disabled: {
        type: Boolean,
        reflectToAttribute: true
      },
      /**
       * Set to true to make this element read-only.
       */
      readonly: {
        type: Boolean,
        reflectToAttribute: true
      },
      /**
       * Set to true when the element is invalid.
       */
      invalid: {
        type: Boolean,
        reflectToAttribute: true
      }
    };
  }
  /** @protected */
  ready() {
    super.ready();
    this.addEventListener("pointerdown", (event) => {
      if (event.target === this) {
        event.preventDefault();
      }
    });
    this.addEventListener("click", (event) => {
      if (event.target === this) {
        this.shadowRoot.querySelector("slot:not([name])").assignedNodes({ flatten: true }).forEach((node) => node.focus && node.focus());
      }
    });
  }
};

// node_modules/@vaadin/input-container/src/vaadin-input-container.js
registerStyles("vaadin-input-container", inputContainerStyles, { moduleId: "vaadin-input-container-styles" });
var InputContainer = class extends InputContainerMixin(ThemableMixin(DirMixin(PolymerElement))) {
  static get is() {
    return "vaadin-input-container";
  }
  static get template() {
    return html`
      <slot name="prefix"></slot>
      <slot></slot>
      <slot name="suffix"></slot>
    `;
  }
};
defineCustomElement(InputContainer);

// node_modules/@vaadin/combo-box/src/vaadin-combo-box-item-mixin.js
var ComboBoxItemMixin = (superClass) => class ComboBoxItemMixinClass extends superClass {
  static get properties() {
    return {
      /**
       * The index of the item.
       */
      index: {
        type: Number
      },
      /**
       * The item to render.
       */
      item: {
        type: Object
      },
      /**
       * The text to render in the item.
       */
      label: {
        type: String
      },
      /**
       * True when item is selected.
       */
      selected: {
        type: Boolean,
        value: false,
        reflectToAttribute: true
      },
      /**
       * True when item is focused.
       */
      focused: {
        type: Boolean,
        value: false,
        reflectToAttribute: true
      },
      /**
       * Custom function for rendering the item content.
       */
      renderer: {
        type: Function
      }
    };
  }
  static get observers() {
    return ["__rendererOrItemChanged(renderer, index, item, selected, focused)", "__updateLabel(label, renderer)"];
  }
  static get observedAttributes() {
    return [...super.observedAttributes, "hidden"];
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "hidden" && newValue !== null) {
      this.index = void 0;
    } else {
      super.attributeChangedCallback(name, oldValue, newValue);
    }
  }
  /** @protected */
  connectedCallback() {
    super.connectedCallback();
    this._owner = this.parentNode.owner;
    const hostDir = this._owner.getAttribute("dir");
    if (hostDir) {
      this.setAttribute("dir", hostDir);
    }
  }
  /**
   * Requests an update for the content of the item.
   * While performing the update, it invokes the renderer passed in the `renderer` property.
   *
   * It is not guaranteed that the update happens immediately (synchronously) after it is requested.
   */
  requestContentUpdate() {
    if (!this.renderer || this.hidden) {
      return;
    }
    const model = {
      index: this.index,
      item: this.item,
      focused: this.focused,
      selected: this.selected
    };
    this.renderer(this, this._owner, model);
  }
  /** @private */
  __rendererOrItemChanged(renderer, index, item2) {
    if (item2 === void 0 || index === void 0) {
      return;
    }
    if (this._oldRenderer !== renderer) {
      this.innerHTML = "";
      delete this._$litPart$;
    }
    if (renderer) {
      this._oldRenderer = renderer;
      this.requestContentUpdate();
    }
  }
  /** @private */
  __updateLabel(label, renderer) {
    if (renderer) {
      return;
    }
    this.textContent = label;
  }
};

// node_modules/@vaadin/combo-box/src/vaadin-combo-box-item.js
var ComboBoxItem = class extends ComboBoxItemMixin(ThemableMixin(DirMixin(PolymerElement))) {
  static get template() {
    return html`
      <style>
        :host {
          display: block;
        }

        :host([hidden]) {
          display: none;
        }
      </style>
      <span part="checkmark" aria-hidden="true"></span>
      <div part="content">
        <slot></slot>
      </div>
    `;
  }
  static get is() {
    return "vaadin-combo-box-item";
  }
};
defineCustomElement(ComboBoxItem);

// node_modules/@vaadin/component-base/src/browser-utils.js
var testUserAgent = (regexp) => regexp.test(navigator.userAgent);
var testPlatform = (regexp) => regexp.test(navigator.platform);
var testVendor = (regexp) => regexp.test(navigator.vendor);
var isAndroid = testUserAgent(/Android/u);
var isChrome = testUserAgent(/Chrome/u) && testVendor(/Google Inc/u);
var isFirefox = testUserAgent(/Firefox/u);
var isIPad = testPlatform(/^iPad/u) || testPlatform(/^Mac/u) && navigator.maxTouchPoints > 1;
var isIPhone = testPlatform(/^iPhone/u);
var isIOS = isIPhone || isIPad;
var isSafari = testUserAgent(/^((?!chrome|android).)*safari/iu);
var isTouch = (() => {
  try {
    document.createEvent("TouchEvent");
    return true;
  } catch (_2) {
    return false;
  }
})();
var supportsAdoptingStyleSheets2 = window.ShadowRoot && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;

// node_modules/@vaadin/a11y-base/src/aria-hidden.js
var counterMap = /* @__PURE__ */ new WeakMap();
var uncontrolledNodes = /* @__PURE__ */ new WeakMap();
var markerMap = {};
var lockCount = 0;
var isElement = (node) => node && node.nodeType === Node.ELEMENT_NODE;
var logError = (...args) => {
  console.error(`Error: ${args.join(" ")}. Skip setting aria-hidden.`);
};
var correctTargets = (parent, targets) => {
  if (!isElement(parent)) {
    logError(parent, "is not a valid element");
    return [];
  }
  return targets.map((target) => {
    if (!isElement(target)) {
      logError(target, "is not a valid element");
      return null;
    }
    let node = target;
    while (node && node !== parent) {
      if (parent.contains(node)) {
        return target;
      }
      node = node.getRootNode().host;
    }
    logError(target, "is not contained inside", parent);
    return null;
  }).filter((x2) => Boolean(x2));
};
var applyAttributeToOthers = (originalTarget, parentNode, markerName, controlAttribute) => {
  const targets = correctTargets(parentNode, Array.isArray(originalTarget) ? originalTarget : [originalTarget]);
  if (!markerMap[markerName]) {
    markerMap[markerName] = /* @__PURE__ */ new WeakMap();
  }
  const markerCounter = markerMap[markerName];
  const hiddenNodes = [];
  const elementsToKeep = /* @__PURE__ */ new Set();
  const elementsToStop = new Set(targets);
  const keep = (el) => {
    if (!el || elementsToKeep.has(el)) {
      return;
    }
    elementsToKeep.add(el);
    const slot = el.assignedSlot;
    if (slot) {
      keep(slot);
    }
    keep(el.parentNode || el.host);
  };
  targets.forEach(keep);
  const deep = (parent) => {
    if (!parent || elementsToStop.has(parent)) {
      return;
    }
    const root2 = parent.shadowRoot;
    const children = root2 ? [...parent.children, ...root2.children] : [...parent.children];
    children.forEach((node) => {
      if (["template", "script", "style"].includes(node.localName)) {
        return;
      }
      if (elementsToKeep.has(node)) {
        deep(node);
      } else {
        const attr = node.getAttribute(controlAttribute);
        const alreadyHidden = attr !== null && attr !== "false";
        const counterValue = (counterMap.get(node) || 0) + 1;
        const markerValue = (markerCounter.get(node) || 0) + 1;
        counterMap.set(node, counterValue);
        markerCounter.set(node, markerValue);
        hiddenNodes.push(node);
        if (counterValue === 1 && alreadyHidden) {
          uncontrolledNodes.set(node, true);
        }
        if (markerValue === 1) {
          node.setAttribute(markerName, "true");
        }
        if (!alreadyHidden) {
          node.setAttribute(controlAttribute, "true");
        }
      }
    });
  };
  deep(parentNode);
  elementsToKeep.clear();
  lockCount += 1;
  return () => {
    hiddenNodes.forEach((node) => {
      const counterValue = counterMap.get(node) - 1;
      const markerValue = markerCounter.get(node) - 1;
      counterMap.set(node, counterValue);
      markerCounter.set(node, markerValue);
      if (!counterValue) {
        if (uncontrolledNodes.has(node)) {
          uncontrolledNodes.delete(node);
        } else {
          node.removeAttribute(controlAttribute);
        }
      }
      if (!markerValue) {
        node.removeAttribute(markerName);
      }
    });
    lockCount -= 1;
    if (!lockCount) {
      counterMap = /* @__PURE__ */ new WeakMap();
      counterMap = /* @__PURE__ */ new WeakMap();
      uncontrolledNodes = /* @__PURE__ */ new WeakMap();
      markerMap = {};
    }
  };
};
var hideOthers = (originalTarget, parentNode = document.body, markerName = "data-aria-hidden") => {
  const targets = Array.from(Array.isArray(originalTarget) ? originalTarget : [originalTarget]);
  if (parentNode) {
    targets.push(...Array.from(parentNode.querySelectorAll("[aria-live]")));
  }
  return applyAttributeToOthers(targets, parentNode, markerName, "aria-hidden");
};
var supportsInert = "inert" in HTMLElement.prototype;

// node_modules/@vaadin/a11y-base/src/aria-modal-controller.js
var AriaModalController = class {
  /**
   * @param {HTMLElement} host
   */
  constructor(host, callback) {
    this.host = host;
    this.callback = typeof callback === "function" ? callback : () => host;
  }
  /**
   * Make the controller host modal by hiding other elements from screen readers
   * using `aria-hidden` attribute (can be replaced with `inert` in the future).
   *
   * The method name is chosen to align with the one provided by native `<dialog>`:
   * https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal
   */
  showModal() {
    const targets = this.callback();
    this.__showOthers = hideOthers(targets);
  }
  /**
   * Remove `aria-hidden` from other elements unless there are any other
   * controller hosts on the page activated by using `showModal()` call.
   */
  close() {
    if (this.__showOthers) {
      this.__showOthers();
      this.__showOthers = null;
    }
  }
};

// node_modules/@vaadin/a11y-base/src/focus-utils.js
var keyboardActive = false;
window.addEventListener(
  "keydown",
  () => {
    keyboardActive = true;
  },
  { capture: true }
);
window.addEventListener(
  "mousedown",
  () => {
    keyboardActive = false;
  },
  { capture: true }
);
function getDeepActiveElement() {
  let host = document.activeElement || document.body;
  while (host.shadowRoot && host.shadowRoot.activeElement) {
    host = host.shadowRoot.activeElement;
  }
  return host;
}
function isKeyboardActive() {
  return keyboardActive;
}
function isElementHiddenDirectly(element) {
  const style2 = element.style;
  if (style2.visibility === "hidden" || style2.display === "none") {
    return true;
  }
  const computedStyle = window.getComputedStyle(element);
  if (computedStyle.visibility === "hidden" || computedStyle.display === "none") {
    return true;
  }
  return false;
}
function hasLowerTabOrder(a3, b3) {
  const ati = Math.max(a3.tabIndex, 0);
  const bti = Math.max(b3.tabIndex, 0);
  return ati === 0 || bti === 0 ? bti > ati : ati > bti;
}
function mergeSortByTabIndex(left, right) {
  const result = [];
  while (left.length > 0 && right.length > 0) {
    if (hasLowerTabOrder(left[0], right[0])) {
      result.push(right.shift());
    } else {
      result.push(left.shift());
    }
  }
  return result.concat(left, right);
}
function sortElementsByTabIndex(elements) {
  const len = elements.length;
  if (len < 2) {
    return elements;
  }
  const pivot = Math.ceil(len / 2);
  const left = sortElementsByTabIndex(elements.slice(0, pivot));
  const right = sortElementsByTabIndex(elements.slice(pivot));
  return mergeSortByTabIndex(left, right);
}
function isElementFocusable(element) {
  if (element.matches('[tabindex="-1"]')) {
    return false;
  }
  if (element.matches("input, select, textarea, button, object")) {
    return element.matches(":not([disabled])");
  }
  return element.matches("a[href], area[href], iframe, [tabindex], [contentEditable]");
}
function isElementFocused(element) {
  return element.getRootNode().activeElement === element;
}
function normalizeTabIndex(element) {
  if (!isElementFocusable(element)) {
    return -1;
  }
  const tabIndex = element.getAttribute("tabindex") || 0;
  return Number(tabIndex);
}
function collectFocusableNodes(node, result) {
  if (node.nodeType !== Node.ELEMENT_NODE || isElementHiddenDirectly(node)) {
    return false;
  }
  const element = (
    /** @type {HTMLElement} */
    node
  );
  const tabIndex = normalizeTabIndex(element);
  let needsSort = tabIndex > 0;
  if (tabIndex >= 0) {
    result.push(element);
  }
  let children = [];
  if (element.localName === "slot") {
    children = element.assignedNodes({ flatten: true });
  } else {
    children = (element.shadowRoot || element).children;
  }
  [...children].forEach((child) => {
    needsSort = collectFocusableNodes(child, result) || needsSort;
  });
  return needsSort;
}
function getFocusableElements(element) {
  const focusableElements = [];
  const needsSortByTabIndex = collectFocusableNodes(element, focusableElements);
  if (needsSortByTabIndex) {
    return sortElementsByTabIndex(focusableElements);
  }
  return focusableElements;
}

// node_modules/@vaadin/a11y-base/src/focus-restoration-controller.js
var FocusRestorationController = class {
  /**
   * Saves the given node as a target for restoring focus to
   * when `restoreFocus()` is called. If no node is provided,
   * the currently focused node in the DOM is saved as a target.
   *
   * @param {Node | null | undefined} focusNode
   */
  saveFocus(focusNode) {
    this.focusNode = focusNode || getDeepActiveElement();
  }
  /**
   * Restores focus to the target node that was saved previously with `saveFocus()`.
   */
  restoreFocus(options) {
    const focusNode = this.focusNode;
    if (!focusNode) {
      return;
    }
    const preventScroll = options ? options.preventScroll : false;
    if (getDeepActiveElement() === document.body) {
      setTimeout(() => focusNode.focus({ preventScroll }));
    } else {
      focusNode.focus({ preventScroll });
    }
    this.focusNode = null;
  }
};

// node_modules/@vaadin/a11y-base/src/focus-trap-controller.js
var instances = [];
var FocusTrapController = class {
  /**
   * @param {HTMLElement} host
   */
  constructor(host) {
    this.host = host;
    this.__trapNode = null;
    this.__onKeyDown = this.__onKeyDown.bind(this);
  }
  /**
   * An array of tab-ordered focusable elements inside the trap node.
   *
   * @return {HTMLElement[]}
   * @private
   */
  get __focusableElements() {
    return getFocusableElements(this.__trapNode);
  }
  /**
   * The index of the element inside the trap node that currently has focus.
   *
   * @return {HTMLElement | undefined}
   * @private
   */
  get __focusedElementIndex() {
    const focusableElements = this.__focusableElements;
    return focusableElements.indexOf(focusableElements.filter(isElementFocused).pop());
  }
  hostConnected() {
    document.addEventListener("keydown", this.__onKeyDown);
  }
  hostDisconnected() {
    document.removeEventListener("keydown", this.__onKeyDown);
  }
  /**
   * Activates a focus trap for a DOM node that will prevent focus from escaping the node.
   * The trap can be deactivated with the `.releaseFocus()` method.
   *
   * If focus is initially outside the trap, the method will move focus inside,
   * on the first focusable element of the trap in the tab order.
   * The first focusable element can be the trap node itself if it is focusable
   * and comes first in the tab order.
   *
   * If there are no focusable elements, the method will throw an exception
   * and the trap will not be set.
   *
   * @param {HTMLElement} trapNode
   */
  trapFocus(trapNode) {
    this.__trapNode = trapNode;
    if (this.__focusableElements.length === 0) {
      this.__trapNode = null;
      throw new Error("The trap node should have at least one focusable descendant or be focusable itself.");
    }
    instances.push(this);
    if (this.__focusedElementIndex === -1) {
      this.__focusableElements[0].focus();
    }
  }
  /**
   * Deactivates the focus trap set with the `.trapFocus()` method
   * so that it becomes possible to tab outside the trap node.
   */
  releaseFocus() {
    this.__trapNode = null;
    instances.pop();
  }
  /**
   * A `keydown` event handler that manages tabbing navigation when the trap is enabled.
   *
   * - Moves focus to the next focusable element of the trap on `Tab` press.
   * When no next element to focus, the method moves focus to the first focusable element.
   * - Moves focus to the prev focusable element of the trap on `Shift+Tab` press.
   * When no prev element to focus, the method moves focus to the last focusable element.
   *
   * @param {KeyboardEvent} event
   * @private
   */
  __onKeyDown(event) {
    if (!this.__trapNode) {
      return;
    }
    if (this !== Array.from(instances).pop()) {
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const backward = event.shiftKey;
      this.__focusNextElement(backward);
    }
  }
  /**
   * - Moves focus to the next focusable element if `backward === false`.
   * When no next element to focus, the method moves focus to the first focusable element.
   * - Moves focus to the prev focusable element if `backward === true`.
   * When no prev element to focus the method moves focus to the last focusable element.
   *
   * If no focusable elements, the method returns immediately.
   *
   * @param {boolean} backward
   * @private
   */
  __focusNextElement(backward = false) {
    const focusableElements = this.__focusableElements;
    const step = backward ? -1 : 1;
    const currentIndex = this.__focusedElementIndex;
    const nextIndex = (focusableElements.length + currentIndex + step) % focusableElements.length;
    const element = focusableElements[nextIndex];
    element.focus();
    if (element.localName === "input") {
      element.select();
    }
  }
};

// node_modules/@open-wc/dedupe-mixin/src/dedupeMixin.js
var appliedClassMixins = /* @__PURE__ */ new WeakMap();
function wasMixinPreviouslyApplied(mixin, superClass) {
  let klass = superClass;
  while (klass) {
    if (appliedClassMixins.get(klass) === mixin) {
      return true;
    }
    klass = Object.getPrototypeOf(klass);
  }
  return false;
}
function dedupeMixin(mixin) {
  return (superClass) => {
    if (wasMixinPreviouslyApplied(mixin, superClass)) {
      return superClass;
    }
    const mixedClass = mixin(superClass);
    appliedClassMixins.set(mixedClass, mixin);
    return mixedClass;
  };
}

// node_modules/@vaadin/component-base/src/controller-mixin.js
var ControllerMixin = dedupeMixin((superClass) => {
  if (typeof superClass.prototype.addController === "function") {
    return superClass;
  }
  return class ControllerMixinClass extends superClass {
    constructor() {
      super();
      this.__controllers = /* @__PURE__ */ new Set();
    }
    /** @protected */
    connectedCallback() {
      super.connectedCallback();
      this.__controllers.forEach((c4) => {
        if (c4.hostConnected) {
          c4.hostConnected();
        }
      });
    }
    /** @protected */
    disconnectedCallback() {
      super.disconnectedCallback();
      this.__controllers.forEach((c4) => {
        if (c4.hostDisconnected) {
          c4.hostDisconnected();
        }
      });
    }
    /**
     * Registers a controller to participate in the element update cycle.
     *
     * @param {ReactiveController} controller
     * @protected
     */
    addController(controller) {
      this.__controllers.add(controller);
      if (this.$ !== void 0 && this.isConnected && controller.hostConnected) {
        controller.hostConnected();
      }
    }
    /**
     * Removes a controller from the element.
     *
     * @param {ReactiveController} controller
     * @protected
     */
    removeController(controller) {
      this.__controllers.delete(controller);
    }
  };
});

// node_modules/@vaadin/overlay/src/vaadin-overlay-focus-mixin.js
var OverlayFocusMixin = (superClass) => class OverlayFocusMixin extends ControllerMixin(superClass) {
  static get properties() {
    return {
      /**
       * When true, opening the overlay moves focus to the first focusable child,
       * or to the overlay part with tabindex if there are no focusable children.
       * @attr {boolean} focus-trap
       */
      focusTrap: {
        type: Boolean,
        value: false
      },
      /**
       * Set to true to enable restoring of focus when overlay is closed.
       * @attr {boolean} restore-focus-on-close
       */
      restoreFocusOnClose: {
        type: Boolean,
        value: false
      },
      /**
       * Set to specify the element which should be focused on overlay close,
       * if `restoreFocusOnClose` is set to true.
       * @type {HTMLElement}
       */
      restoreFocusNode: {
        type: HTMLElement
      }
    };
  }
  constructor() {
    super();
    this.__ariaModalController = new AriaModalController(this);
    this.__focusTrapController = new FocusTrapController(this);
    this.__focusRestorationController = new FocusRestorationController();
  }
  /** @protected */
  ready() {
    super.ready();
    this.addController(this.__ariaModalController);
    this.addController(this.__focusTrapController);
    this.addController(this.__focusRestorationController);
  }
  /**
   * Release focus and restore focus after the overlay is closed.
   *
   * @protected
   */
  _resetFocus() {
    if (this.focusTrap) {
      this.__ariaModalController.close();
      this.__focusTrapController.releaseFocus();
    }
    if (this.restoreFocusOnClose && this._shouldRestoreFocus()) {
      const preventScroll = !isKeyboardActive();
      this.__focusRestorationController.restoreFocus({ preventScroll });
    }
  }
  /**
   * Save the previously focused node when the overlay starts to open.
   *
   * @protected
   */
  _saveFocus() {
    if (this.restoreFocusOnClose) {
      this.__focusRestorationController.saveFocus(this.restoreFocusNode);
    }
  }
  /**
   * Trap focus within the overlay after opening has completed.
   *
   * @protected
   */
  _trapFocus() {
    if (this.focusTrap) {
      this.__ariaModalController.showModal();
      this.__focusTrapController.trapFocus(this.$.overlay);
    }
  }
  /**
   * Returns true if focus is still inside the overlay or on the body element,
   * otherwise false.
   *
   * Focus shouldn't be restored if it's been moved elsewhere by another
   * component or as a result of a user interaction e.g. the user clicked
   * on a button outside the overlay while the overlay was open.
   *
   * @protected
   * @return {boolean}
   */
  _shouldRestoreFocus() {
    const activeElement = getDeepActiveElement();
    return activeElement === document.body || this._deepContains(activeElement);
  }
  /**
   * Returns true if the overlay contains the given node,
   * including those within shadow DOM trees.
   *
   * @param {Node} node
   * @return {boolean}
   * @protected
   */
  _deepContains(node) {
    if (this.contains(node)) {
      return true;
    }
    let n4 = node;
    const doc = node.ownerDocument;
    while (n4 && n4 !== doc && n4 !== this) {
      n4 = n4.parentNode || n4.host;
    }
    return n4 === this;
  }
};

// node_modules/@vaadin/overlay/src/vaadin-overlay-stack-mixin.js
var getAttachedInstances = () => Array.from(document.body.children).filter((el) => el instanceof HTMLElement && el._hasOverlayStackMixin && !el.hasAttribute("closing")).sort((a3, b3) => a3.__zIndex - b3.__zIndex || 0);
var getOverlayInstances = () => getAttachedInstances().filter((el) => el.$.overlay);
var isLastOverlay = (overlay2, filter = (_overlay) => true) => {
  const filteredOverlays = getOverlayInstances().filter(filter);
  return overlay2 === filteredOverlays.pop();
};
var overlayMap = /* @__PURE__ */ new WeakMap();
var OverlayStackMixin = (superClass) => class OverlayStackMixin extends superClass {
  constructor() {
    super();
    this._hasOverlayStackMixin = true;
  }
  /**
   * Returns true if this is the last one in the opened overlays stack.
   *
   * @return {boolean}
   * @protected
   */
  get _last() {
    return isLastOverlay(this);
  }
  /**
   * Brings the overlay as visually the frontmost one.
   */
  bringToFront() {
    let zIndex = "";
    const frontmost = getAttachedInstances().filter((o5) => o5 !== this).pop();
    if (frontmost) {
      const frontmostZIndex = frontmost.__zIndex;
      zIndex = frontmostZIndex + 1;
    }
    this.style.zIndex = zIndex;
    this.__zIndex = zIndex || parseFloat(getComputedStyle(this).zIndex);
    if (overlayMap.has(this)) {
      overlayMap.get(this).bringToFront();
    }
  }
  /** @protected */
  _enterModalState() {
    if (document.body.style.pointerEvents !== "none") {
      this._previousDocumentPointerEvents = document.body.style.pointerEvents;
      document.body.style.pointerEvents = "none";
    }
    getOverlayInstances().forEach((el) => {
      if (el !== this) {
        el.$.overlay.style.pointerEvents = "none";
      }
    });
  }
  /** @protected */
  _exitModalState() {
    if (this._previousDocumentPointerEvents !== void 0) {
      document.body.style.pointerEvents = this._previousDocumentPointerEvents;
      delete this._previousDocumentPointerEvents;
    }
    const instances2 = getOverlayInstances();
    let el;
    while (el = instances2.pop()) {
      if (el === this) {
        continue;
      }
      el.$.overlay.style.removeProperty("pointer-events");
      if (!el.modeless) {
        break;
      }
    }
  }
};

// node_modules/@vaadin/overlay/src/vaadin-overlay-mixin.js
var OverlayMixin = (superClass) => class OverlayMixin extends OverlayFocusMixin(OverlayStackMixin(superClass)) {
  static get properties() {
    return {
      /**
       * When true, the overlay is visible and attached to body.
       */
      opened: {
        type: Boolean,
        notify: true,
        observer: "_openedChanged",
        reflectToAttribute: true,
        sync: true
      },
      /**
       * Owner element passed with renderer function
       * @type {HTMLElement}
       */
      owner: {
        type: Object,
        sync: true
      },
      /**
       * Object with properties that is passed to `renderer` function
       */
      model: {
        type: Object,
        sync: true
      },
      /**
       * Custom function for rendering the content of the overlay.
       * Receives three arguments:
       *
       * - `root` The root container DOM element. Append your content to it.
       * - `owner` The host element of the renderer function.
       * - `model` The object with the properties related with rendering.
       * @type {OverlayRenderer | null | undefined}
       */
      renderer: {
        type: Object,
        sync: true
      },
      /**
       * When true the overlay won't disable the main content, showing
       * it doesn't change the functionality of the user interface.
       * @type {boolean}
       */
      modeless: {
        type: Boolean,
        value: false,
        reflectToAttribute: true,
        observer: "_modelessChanged",
        sync: true
      },
      /**
       * When set to true, the overlay is hidden. This also closes the overlay
       * immediately in case there is a closing animation in progress.
       * @type {boolean}
       */
      hidden: {
        type: Boolean,
        reflectToAttribute: true,
        observer: "_hiddenChanged",
        sync: true
      },
      /**
       * When true the overlay has backdrop on top of content when opened.
       * @type {boolean}
       */
      withBackdrop: {
        type: Boolean,
        value: false,
        reflectToAttribute: true,
        sync: true
      }
    };
  }
  static get observers() {
    return ["_rendererOrDataChanged(renderer, owner, model, opened)"];
  }
  constructor() {
    super();
    this._boundMouseDownListener = this._mouseDownListener.bind(this);
    this._boundMouseUpListener = this._mouseUpListener.bind(this);
    this._boundOutsideClickListener = this._outsideClickListener.bind(this);
    this._boundKeydownListener = this._keydownListener.bind(this);
    if (isIOS) {
      this._boundIosResizeListener = () => this._detectIosNavbar();
    }
  }
  /** @protected */
  ready() {
    super.ready();
    this.addEventListener("click", () => {
    });
    this.$.backdrop.addEventListener("click", () => {
    });
    this.addEventListener("mouseup", () => {
      if (document.activeElement === document.body && this.$.overlay.getAttribute("tabindex") === "0") {
        this.$.overlay.focus();
      }
    });
  }
  /** @protected */
  connectedCallback() {
    super.connectedCallback();
    if (this._boundIosResizeListener) {
      this._detectIosNavbar();
      window.addEventListener("resize", this._boundIosResizeListener);
    }
  }
  /** @protected */
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._boundIosResizeListener) {
      window.removeEventListener("resize", this._boundIosResizeListener);
    }
  }
  /**
   * Requests an update for the content of the overlay.
   * While performing the update, it invokes the renderer passed in the `renderer` property.
   *
   * It is not guaranteed that the update happens immediately (synchronously) after it is requested.
   */
  requestContentUpdate() {
    if (this.renderer) {
      this.renderer.call(this.owner, this, this.owner, this.model);
    }
  }
  /**
   * @param {Event=} sourceEvent
   */
  close(sourceEvent) {
    const evt = new CustomEvent("vaadin-overlay-close", {
      bubbles: true,
      cancelable: true,
      detail: { sourceEvent }
    });
    this.dispatchEvent(evt);
    if (!evt.defaultPrevented) {
      this.opened = false;
    }
  }
  /** @private */
  _detectIosNavbar() {
    if (!this.opened) {
      return;
    }
    const innerHeight = window.innerHeight;
    const innerWidth = window.innerWidth;
    const landscape = innerWidth > innerHeight;
    const clientHeight = document.documentElement.clientHeight;
    if (landscape && clientHeight > innerHeight) {
      this.style.setProperty("--vaadin-overlay-viewport-bottom", `${clientHeight - innerHeight}px`);
    } else {
      this.style.setProperty("--vaadin-overlay-viewport-bottom", "0");
    }
  }
  /** @private */
  _addGlobalListeners() {
    document.addEventListener("mousedown", this._boundMouseDownListener);
    document.addEventListener("mouseup", this._boundMouseUpListener);
    document.documentElement.addEventListener("click", this._boundOutsideClickListener, true);
  }
  /** @private */
  _removeGlobalListeners() {
    document.removeEventListener("mousedown", this._boundMouseDownListener);
    document.removeEventListener("mouseup", this._boundMouseUpListener);
    document.documentElement.removeEventListener("click", this._boundOutsideClickListener, true);
  }
  /** @private */
  _rendererOrDataChanged(renderer, owner, model, opened) {
    const ownerOrModelChanged = this._oldOwner !== owner || this._oldModel !== model;
    this._oldModel = model;
    this._oldOwner = owner;
    const rendererChanged = this._oldRenderer !== renderer;
    const hasOldRenderer = this._oldRenderer !== void 0;
    this._oldRenderer = renderer;
    const openedChanged = this._oldOpened !== opened;
    this._oldOpened = opened;
    if (rendererChanged && hasOldRenderer) {
      this.innerHTML = "";
      delete this._$litPart$;
    }
    if (opened && renderer && (rendererChanged || openedChanged || ownerOrModelChanged)) {
      this.requestContentUpdate();
    }
  }
  /** @private */
  _modelessChanged(modeless) {
    if (!modeless) {
      if (this.opened) {
        this._addGlobalListeners();
        this._enterModalState();
      }
    } else {
      this._removeGlobalListeners();
      this._exitModalState();
    }
  }
  /** @private */
  _openedChanged(opened, wasOpened) {
    if (opened) {
      this._saveFocus();
      this._animatedOpening();
      this.__scheduledOpen = requestAnimationFrame(() => {
        setTimeout(() => {
          this._trapFocus();
          this.dispatchEvent(new CustomEvent("vaadin-overlay-open", { bubbles: true }));
        });
      });
      document.addEventListener("keydown", this._boundKeydownListener);
      if (!this.modeless) {
        this._addGlobalListeners();
      }
    } else if (wasOpened) {
      if (this.__scheduledOpen) {
        cancelAnimationFrame(this.__scheduledOpen);
        this.__scheduledOpen = null;
      }
      this._resetFocus();
      this._animatedClosing();
      document.removeEventListener("keydown", this._boundKeydownListener);
      if (!this.modeless) {
        this._removeGlobalListeners();
      }
    }
  }
  /** @private */
  _hiddenChanged(hidden) {
    if (hidden && this.hasAttribute("closing")) {
      this._flushAnimation("closing");
    }
  }
  /**
   * @return {boolean}
   * @private
   */
  _shouldAnimate() {
    const style2 = getComputedStyle(this);
    const name = style2.getPropertyValue("animation-name");
    const hidden = style2.getPropertyValue("display") === "none";
    return !hidden && name && name !== "none";
  }
  /**
   * @param {string} type
   * @param {Function} callback
   * @private
   */
  _enqueueAnimation(type, callback) {
    const handler = `__${type}Handler`;
    const listener = (event) => {
      if (event && event.target !== this) {
        return;
      }
      callback();
      this.removeEventListener("animationend", listener);
      delete this[handler];
    };
    this[handler] = listener;
    this.addEventListener("animationend", listener);
  }
  /**
   * @param {string} type
   * @protected
   */
  _flushAnimation(type) {
    const handler = `__${type}Handler`;
    if (typeof this[handler] === "function") {
      this[handler]();
    }
  }
  /** @private */
  _animatedOpening() {
    if (this.parentNode === document.body && this.hasAttribute("closing")) {
      this._flushAnimation("closing");
    }
    this._attachOverlay();
    if (!this.modeless) {
      this._enterModalState();
    }
    this.setAttribute("opening", "");
    if (this._shouldAnimate()) {
      this._enqueueAnimation("opening", () => {
        this._finishOpening();
      });
    } else {
      this._finishOpening();
    }
  }
  /** @private */
  _attachOverlay() {
    this._placeholder = document.createComment("vaadin-overlay-placeholder");
    this.parentNode.insertBefore(this._placeholder, this);
    document.body.appendChild(this);
    this.bringToFront();
  }
  /** @private */
  _finishOpening() {
    this.removeAttribute("opening");
  }
  /** @private */
  _finishClosing() {
    this._detachOverlay();
    this.$.overlay.style.removeProperty("pointer-events");
    this.removeAttribute("closing");
    this.dispatchEvent(new CustomEvent("vaadin-overlay-closed"));
  }
  /** @private */
  _animatedClosing() {
    if (this.hasAttribute("opening")) {
      this._flushAnimation("opening");
    }
    if (this._placeholder) {
      this._exitModalState();
      this.setAttribute("closing", "");
      this.dispatchEvent(new CustomEvent("vaadin-overlay-closing"));
      if (this._shouldAnimate()) {
        this._enqueueAnimation("closing", () => {
          this._finishClosing();
        });
      } else {
        this._finishClosing();
      }
    }
  }
  /** @private */
  _detachOverlay() {
    this._placeholder.parentNode.insertBefore(this, this._placeholder);
    this._placeholder.parentNode.removeChild(this._placeholder);
  }
  /** @private */
  _mouseDownListener(event) {
    this._mouseDownInside = event.composedPath().indexOf(this.$.overlay) >= 0;
  }
  /** @private */
  _mouseUpListener(event) {
    this._mouseUpInside = event.composedPath().indexOf(this.$.overlay) >= 0;
  }
  /**
   * Whether to close the overlay on outside click or not.
   * Override this method to customize the closing logic.
   *
   * @param {Event} _event
   * @return {boolean}
   * @protected
   */
  _shouldCloseOnOutsideClick(_event) {
    return this._last;
  }
  /**
   * Outside click listener used in capture phase to close the overlay before
   * propagating the event to the listener on the element that triggered it.
   * Otherwise, calling `open()` would result in closing and re-opening.
   *
   * @private
   */
  _outsideClickListener(event) {
    if (event.composedPath().includes(this.$.overlay) || this._mouseDownInside || this._mouseUpInside) {
      this._mouseDownInside = false;
      this._mouseUpInside = false;
      return;
    }
    if (!this._shouldCloseOnOutsideClick(event)) {
      return;
    }
    const evt = new CustomEvent("vaadin-overlay-outside-click", {
      bubbles: true,
      cancelable: true,
      detail: { sourceEvent: event }
    });
    this.dispatchEvent(evt);
    if (this.opened && !evt.defaultPrevented) {
      this.close(event);
    }
  }
  /**
   * Listener used to close whe overlay on Escape press, if it is the last one.
   * @private
   */
  _keydownListener(event) {
    if (!this._last) {
      return;
    }
    if (this.modeless && !event.composedPath().includes(this.$.overlay)) {
      return;
    }
    if (event.key === "Escape") {
      const evt = new CustomEvent("vaadin-overlay-escape-press", {
        bubbles: true,
        cancelable: true,
        detail: { sourceEvent: event }
      });
      this.dispatchEvent(evt);
      if (this.opened && !evt.defaultPrevented) {
        this.close(event);
      }
    }
  }
};

// node_modules/@vaadin/overlay/src/vaadin-overlay-core-styles.js
var overlayStyles = i`
  :host {
    z-index: 200;
    position: fixed;

    /* Despite of what the names say, <vaadin-overlay> is just a container
          for position/sizing/alignment. The actual overlay is the overlay part. */

    /* Default position constraints: the entire viewport. Note: themes can
          override this to introduce gaps between the overlay and the viewport. */
    inset: 0;
    bottom: var(--vaadin-overlay-viewport-bottom);

    /* Use flexbox alignment for the overlay part. */
    display: flex;
    flex-direction: column; /* makes dropdowns sizing easier */
    /* Align to center by default. */
    align-items: center;
    justify-content: center;

    /* Allow centering when max-width/max-height applies. */
    margin: auto;

    /* The host is not clickable, only the overlay part is. */
    pointer-events: none;

    /* Remove tap highlight on touch devices. */
    -webkit-tap-highlight-color: transparent;

    /* CSS API for host */
    --vaadin-overlay-viewport-bottom: 0;
  }

  :host([hidden]),
  :host(:not([opened]):not([closing])),
  :host(:not([opened]):not([closing])) [part='overlay'] {
    display: none !important;
  }

  [part='overlay'] {
    -webkit-overflow-scrolling: touch;
    overflow: auto;
    pointer-events: auto;

    /* Prevent overflowing the host */
    max-width: 100%;
    box-sizing: border-box;

    -webkit-tap-highlight-color: initial; /* reenable tap highlight inside */
  }

  [part='backdrop'] {
    z-index: -1;
    content: '';
    background: rgba(0, 0, 0, 0.5);
    position: fixed;
    inset: 0;
    pointer-events: auto;
  }
`;

// node_modules/@vaadin/component-base/src/dom-utils.js
function getAncestorRootNodes(node) {
  const result = [];
  while (node) {
    if (node.nodeType === Node.DOCUMENT_NODE) {
      result.push(node);
      break;
    }
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      result.push(node);
      node = node.host;
      continue;
    }
    if (node.assignedSlot) {
      node = node.assignedSlot;
      continue;
    }
    node = node.parentNode;
  }
  return result;
}
function deserializeAttributeValue(value) {
  if (!value) {
    return /* @__PURE__ */ new Set();
  }
  return new Set(value.split(" "));
}
function serializeAttributeValue(values) {
  return values ? [...values].join(" ") : "";
}
function addValueToAttribute(element, attr, value) {
  const values = deserializeAttributeValue(element.getAttribute(attr));
  values.add(value);
  element.setAttribute(attr, serializeAttributeValue(values));
}
function removeValueFromAttribute(element, attr, value) {
  const values = deserializeAttributeValue(element.getAttribute(attr));
  values.delete(value);
  if (values.size === 0) {
    element.removeAttribute(attr);
    return;
  }
  element.setAttribute(attr, serializeAttributeValue(values));
}
function isEmptyTextNode(node) {
  return node.nodeType === Node.TEXT_NODE && node.textContent.trim() === "";
}

// node_modules/@vaadin/overlay/src/vaadin-overlay-utils.js
function observeMove(element, callback) {
  let io = null;
  let timeout;
  const root2 = document.documentElement;
  function cleanup() {
    timeout && clearTimeout(timeout);
    io && io.disconnect();
    io = null;
  }
  function refresh(skip = false, threshold = 1) {
    cleanup();
    const { left, top, width, height } = element.getBoundingClientRect();
    if (!skip) {
      callback();
    }
    if (!width || !height) {
      return;
    }
    const insetTop = Math.floor(top);
    const insetRight = Math.floor(root2.clientWidth - (left + width));
    const insetBottom = Math.floor(root2.clientHeight - (top + height));
    const insetLeft = Math.floor(left);
    const rootMargin = `${-insetTop}px ${-insetRight}px ${-insetBottom}px ${-insetLeft}px`;
    const options = {
      rootMargin,
      threshold: Math.max(0, Math.min(1, threshold)) || 1
    };
    let isFirstUpdate = true;
    function handleObserve(entries) {
      const ratio = entries[0].intersectionRatio;
      if (ratio !== threshold) {
        if (!isFirstUpdate) {
          return refresh();
        }
        if (!ratio) {
          timeout = setTimeout(() => {
            refresh(false, 1e-7);
          }, 1e3);
        } else {
          refresh(false, ratio);
        }
      }
      isFirstUpdate = false;
    }
    io = new IntersectionObserver(handleObserve, options);
    io.observe(element);
  }
  refresh(true);
  return cleanup;
}

// node_modules/@vaadin/overlay/src/vaadin-overlay-position-mixin.js
var PROP_NAMES_VERTICAL = {
  start: "top",
  end: "bottom"
};
var PROP_NAMES_HORIZONTAL = {
  start: "left",
  end: "right"
};
var targetResizeObserver = new ResizeObserver((entries) => {
  setTimeout(() => {
    entries.forEach((entry) => {
      if (entry.target.__overlay) {
        entry.target.__overlay._updatePosition();
      }
    });
  });
});
var PositionMixin = (superClass) => class PositionMixin extends superClass {
  static get properties() {
    return {
      /**
       * The element next to which this overlay should be aligned.
       * The position of the overlay relative to the positionTarget can be adjusted
       * with properties `horizontalAlign`, `verticalAlign`, `noHorizontalOverlap`
       * and `noVerticalOverlap`.
       */
      positionTarget: {
        type: Object,
        value: null,
        sync: true
      },
      /**
       * When `positionTarget` is set, this property defines whether to align the overlay's
       * left or right side to the target element by default.
       * Possible values are `start` and `end`.
       * RTL is taken into account when interpreting the value.
       * The overlay is automatically flipped to the opposite side when it doesn't fit into
       * the default side defined by this property.
       *
       * @attr {start|end} horizontal-align
       */
      horizontalAlign: {
        type: String,
        value: "start",
        sync: true
      },
      /**
       * When `positionTarget` is set, this property defines whether to align the overlay's
       * top or bottom side to the target element by default.
       * Possible values are `top` and `bottom`.
       * The overlay is automatically flipped to the opposite side when it doesn't fit into
       * the default side defined by this property.
       *
       * @attr {top|bottom} vertical-align
       */
      verticalAlign: {
        type: String,
        value: "top",
        sync: true
      },
      /**
       * When `positionTarget` is set, this property defines whether the overlay should overlap
       * the target element in the x-axis, or be positioned right next to it.
       *
       * @attr {boolean} no-horizontal-overlap
       */
      noHorizontalOverlap: {
        type: Boolean,
        value: false,
        sync: true
      },
      /**
       * When `positionTarget` is set, this property defines whether the overlay should overlap
       * the target element in the y-axis, or be positioned right above/below it.
       *
       * @attr {boolean} no-vertical-overlap
       */
      noVerticalOverlap: {
        type: Boolean,
        value: false,
        sync: true
      },
      /**
       * If the overlay content has no intrinsic height, this property can be used to set
       * the minimum vertical space (in pixels) required by the overlay. Setting a value to
       * the property effectively disables the content measurement in favor of using this
       * fixed value for determining the open direction.
       *
       * @attr {number} required-vertical-space
       */
      requiredVerticalSpace: {
        type: Number,
        value: 0,
        sync: true
      }
    };
  }
  static get observers() {
    return [
      "__positionSettingsChanged(horizontalAlign, verticalAlign, noHorizontalOverlap, noVerticalOverlap, requiredVerticalSpace)",
      "__overlayOpenedChanged(opened, positionTarget)"
    ];
  }
  constructor() {
    super();
    this.__onScroll = this.__onScroll.bind(this);
    this._updatePosition = this._updatePosition.bind(this);
  }
  /** @protected */
  connectedCallback() {
    super.connectedCallback();
    if (this.opened) {
      this.__addUpdatePositionEventListeners();
    }
  }
  /** @protected */
  disconnectedCallback() {
    super.disconnectedCallback();
    this.__removeUpdatePositionEventListeners();
  }
  /** @private */
  __addUpdatePositionEventListeners() {
    window.visualViewport.addEventListener("resize", this._updatePosition);
    window.visualViewport.addEventListener("scroll", this.__onScroll, true);
    this.__positionTargetAncestorRootNodes = getAncestorRootNodes(this.positionTarget);
    this.__positionTargetAncestorRootNodes.forEach((node) => {
      node.addEventListener("scroll", this.__onScroll, true);
    });
    if (this.positionTarget) {
      this.__observePositionTargetMove = observeMove(this.positionTarget, () => {
        this._updatePosition();
      });
    }
  }
  /** @private */
  __removeUpdatePositionEventListeners() {
    window.visualViewport.removeEventListener("resize", this._updatePosition);
    window.visualViewport.removeEventListener("scroll", this.__onScroll, true);
    if (this.__positionTargetAncestorRootNodes) {
      this.__positionTargetAncestorRootNodes.forEach((node) => {
        node.removeEventListener("scroll", this.__onScroll, true);
      });
      this.__positionTargetAncestorRootNodes = null;
    }
    if (this.__observePositionTargetMove) {
      this.__observePositionTargetMove();
      this.__observePositionTargetMove = null;
    }
  }
  /** @private */
  __overlayOpenedChanged(opened, positionTarget) {
    this.__removeUpdatePositionEventListeners();
    if (positionTarget) {
      positionTarget.__overlay = null;
      targetResizeObserver.unobserve(positionTarget);
      if (opened) {
        this.__addUpdatePositionEventListeners();
        positionTarget.__overlay = this;
        targetResizeObserver.observe(positionTarget);
      }
    }
    if (opened) {
      const computedStyle = getComputedStyle(this);
      if (!this.__margins) {
        this.__margins = {};
        ["top", "bottom", "left", "right"].forEach((propName) => {
          this.__margins[propName] = parseInt(computedStyle[propName], 10);
        });
      }
      this._updatePosition();
      requestAnimationFrame(() => this._updatePosition());
    }
  }
  __positionSettingsChanged() {
    this._updatePosition();
  }
  /** @private */
  __onScroll(e4) {
    if (e4.target instanceof Node && this.contains(e4.target)) {
      return;
    }
    this._updatePosition();
  }
  _updatePosition() {
    if (!this.positionTarget || !this.opened || !this.__margins) {
      return;
    }
    const targetRect = this.positionTarget.getBoundingClientRect();
    if (targetRect.width === 0 && targetRect.height === 0 && this.opened) {
      this.opened = false;
      return;
    }
    const shouldAlignStartVertically = this.__shouldAlignStartVertically(targetRect);
    this.style.justifyContent = shouldAlignStartVertically ? "flex-start" : "flex-end";
    const isRTL = this.__isRTL;
    const shouldAlignStartHorizontally = this.__shouldAlignStartHorizontally(targetRect, isRTL);
    const flexStart = !isRTL && shouldAlignStartHorizontally || isRTL && !shouldAlignStartHorizontally;
    this.style.alignItems = flexStart ? "flex-start" : "flex-end";
    const overlayRect = this.getBoundingClientRect();
    const verticalProps = this.__calculatePositionInOneDimension(
      targetRect,
      overlayRect,
      this.noVerticalOverlap,
      PROP_NAMES_VERTICAL,
      this,
      shouldAlignStartVertically
    );
    const horizontalProps = this.__calculatePositionInOneDimension(
      targetRect,
      overlayRect,
      this.noHorizontalOverlap,
      PROP_NAMES_HORIZONTAL,
      this,
      shouldAlignStartHorizontally
    );
    Object.assign(this.style, verticalProps, horizontalProps);
    this.toggleAttribute("bottom-aligned", !shouldAlignStartVertically);
    this.toggleAttribute("top-aligned", shouldAlignStartVertically);
    this.toggleAttribute("end-aligned", !flexStart);
    this.toggleAttribute("start-aligned", flexStart);
  }
  __shouldAlignStartHorizontally(targetRect, rtl) {
    const contentWidth = Math.max(this.__oldContentWidth || 0, this.$.overlay.offsetWidth);
    this.__oldContentWidth = this.$.overlay.offsetWidth;
    const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth);
    const defaultAlignLeft = !rtl && this.horizontalAlign === "start" || rtl && this.horizontalAlign === "end";
    return this.__shouldAlignStart(
      targetRect,
      contentWidth,
      viewportWidth,
      this.__margins,
      defaultAlignLeft,
      this.noHorizontalOverlap,
      PROP_NAMES_HORIZONTAL
    );
  }
  __shouldAlignStartVertically(targetRect) {
    const contentHeight = this.requiredVerticalSpace || Math.max(this.__oldContentHeight || 0, this.$.overlay.offsetHeight);
    this.__oldContentHeight = this.$.overlay.offsetHeight;
    const viewportHeight = Math.min(window.innerHeight, document.documentElement.clientHeight);
    const defaultAlignTop = this.verticalAlign === "top";
    return this.__shouldAlignStart(
      targetRect,
      contentHeight,
      viewportHeight,
      this.__margins,
      defaultAlignTop,
      this.noVerticalOverlap,
      PROP_NAMES_VERTICAL
    );
  }
  // eslint-disable-next-line @typescript-eslint/max-params
  __shouldAlignStart(targetRect, contentSize, viewportSize, margins, defaultAlignStart, noOverlap, propNames) {
    const spaceForStartAlignment = viewportSize - targetRect[noOverlap ? propNames.end : propNames.start] - margins[propNames.end];
    const spaceForEndAlignment = targetRect[noOverlap ? propNames.start : propNames.end] - margins[propNames.start];
    const spaceForDefaultAlignment = defaultAlignStart ? spaceForStartAlignment : spaceForEndAlignment;
    const spaceForOtherAlignment = defaultAlignStart ? spaceForEndAlignment : spaceForStartAlignment;
    const shouldGoToDefaultSide = spaceForDefaultAlignment > spaceForOtherAlignment || spaceForDefaultAlignment > contentSize;
    return defaultAlignStart === shouldGoToDefaultSide;
  }
  /**
   * Returns an adjusted value after resizing the browser window,
   * to avoid wrong calculations when e.g. previously set `bottom`
   * CSS property value is larger than the updated viewport height.
   * See https://github.com/vaadin/web-components/issues/4604
   */
  __adjustBottomProperty(cssPropNameToSet, propNames, currentValue) {
    let adjustedProp;
    if (cssPropNameToSet === propNames.end) {
      if (propNames.end === PROP_NAMES_VERTICAL.end) {
        const viewportHeight = Math.min(window.innerHeight, document.documentElement.clientHeight);
        if (currentValue > viewportHeight && this.__oldViewportHeight) {
          const heightDiff = this.__oldViewportHeight - viewportHeight;
          adjustedProp = currentValue - heightDiff;
        }
        this.__oldViewportHeight = viewportHeight;
      }
      if (propNames.end === PROP_NAMES_HORIZONTAL.end) {
        const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth);
        if (currentValue > viewportWidth && this.__oldViewportWidth) {
          const widthDiff = this.__oldViewportWidth - viewportWidth;
          adjustedProp = currentValue - widthDiff;
        }
        this.__oldViewportWidth = viewportWidth;
      }
    }
    return adjustedProp;
  }
  /**
   * Returns an object with CSS position properties to set,
   * e.g. { top: "100px" }
   */
  // eslint-disable-next-line @typescript-eslint/max-params
  __calculatePositionInOneDimension(targetRect, overlayRect, noOverlap, propNames, overlay2, shouldAlignStart) {
    const cssPropNameToSet = shouldAlignStart ? propNames.start : propNames.end;
    const cssPropNameToClear = shouldAlignStart ? propNames.end : propNames.start;
    const currentValue = parseFloat(overlay2.style[cssPropNameToSet] || getComputedStyle(overlay2)[cssPropNameToSet]);
    const adjustedValue = this.__adjustBottomProperty(cssPropNameToSet, propNames, currentValue);
    const diff = overlayRect[shouldAlignStart ? propNames.start : propNames.end] - targetRect[noOverlap === shouldAlignStart ? propNames.end : propNames.start];
    const valueToSet = adjustedValue ? `${adjustedValue}px` : `${currentValue + diff * (shouldAlignStart ? -1 : 1)}px`;
    return {
      [cssPropNameToSet]: valueToSet,
      [cssPropNameToClear]: ""
    };
  }
};

// node_modules/@vaadin/combo-box/src/vaadin-combo-box-overlay-mixin.js
var ComboBoxOverlayMixin = (superClass) => class ComboBoxOverlayMixin extends PositionMixin(superClass) {
  static get observers() {
    return ["_setOverlayWidth(positionTarget, opened)"];
  }
  constructor() {
    super();
    this.requiredVerticalSpace = 200;
  }
  /** @protected */
  connectedCallback() {
    super.connectedCallback();
    const comboBox2 = this._comboBox;
    const hostDir = comboBox2 && comboBox2.getAttribute("dir");
    if (hostDir) {
      this.setAttribute("dir", hostDir);
    }
  }
  /**
   * Override method inherited from `Overlay`
   * to not close on position target click.
   *
   * @param {Event} event
   * @return {boolean}
   * @protected
   */
  _shouldCloseOnOutsideClick(event) {
    const eventPath = event.composedPath();
    return !eventPath.includes(this.positionTarget) && !eventPath.includes(this);
  }
  /**
   * @protected
   * @override
   */
  _mouseDownListener(event) {
    super._mouseDownListener(event);
    if (this._shouldCloseOnOutsideClick(event) && !isElementFocusable(event.composedPath()[0])) {
      event.preventDefault();
    }
  }
  /** @protected */
  _updateOverlayWidth() {
    const propPrefix = this.localName;
    this.style.setProperty(`--_${propPrefix}-default-width`, `${this.positionTarget.offsetWidth}px`);
    const customWidth = getComputedStyle(this._comboBox).getPropertyValue(`--${propPrefix}-width`);
    if (customWidth === "") {
      this.style.removeProperty(`--${propPrefix}-width`);
    } else {
      this.style.setProperty(`--${propPrefix}-width`, customWidth);
    }
  }
  /** @private */
  _setOverlayWidth(positionTarget, opened) {
    if (positionTarget && opened) {
      this._updateOverlayWidth();
      this._updatePosition();
    }
  }
};

// node_modules/@vaadin/combo-box/src/vaadin-combo-box-overlay.js
var comboBoxOverlayStyles = i`
  #overlay {
    width: var(--vaadin-combo-box-overlay-width, var(--_vaadin-combo-box-overlay-default-width, auto));
  }

  [part='content'] {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
`;
registerStyles("vaadin-combo-box-overlay", [overlayStyles, comboBoxOverlayStyles], {
  moduleId: "vaadin-combo-box-overlay-styles"
});
var ComboBoxOverlay = class extends ComboBoxOverlayMixin(OverlayMixin(DirMixin(ThemableMixin(PolymerElement)))) {
  static get is() {
    return "vaadin-combo-box-overlay";
  }
  static get template() {
    return html`
      <div id="backdrop" part="backdrop" hidden></div>
      <div part="overlay" id="overlay">
        <div part="loader"></div>
        <div part="content" id="content"><slot></slot></div>
      </div>
    `;
  }
};
defineCustomElement(ComboBoxOverlay);

// node_modules/@vaadin/component-base/src/path-utils.js
function get2(path, object) {
  return path.split(".").reduce((obj, property) => obj ? obj[property] : void 0, object);
}

// node_modules/@vaadin/component-base/src/unique-id-utils.js
var uniqueId = 0;
function generateUniqueId() {
  return uniqueId++;
}

// node_modules/@vaadin/component-base/src/async.js
var microtaskCurrHandle2 = 0;
var microtaskLastHandle2 = 0;
var microtaskCallbacks2 = [];
var microtaskScheduled2 = false;
function microtaskFlush2() {
  microtaskScheduled2 = false;
  const len = microtaskCallbacks2.length;
  for (let i5 = 0; i5 < len; i5++) {
    const cb = microtaskCallbacks2[i5];
    if (cb) {
      try {
        cb();
      } catch (e4) {
        setTimeout(() => {
          throw e4;
        });
      }
    }
  }
  microtaskCallbacks2.splice(0, len);
  microtaskLastHandle2 += len;
}
var timeOut = {
  /**
   * Returns a sub-module with the async interface providing the provided
   * delay.
   *
   * @memberof timeOut
   * @param {number=} delay Time to wait before calling callbacks in ms
   * @return {!AsyncInterface} An async timeout interface
   */
  after(delay) {
    return {
      run(fn) {
        return window.setTimeout(fn, delay);
      },
      cancel(handle) {
        window.clearTimeout(handle);
      }
    };
  },
  /**
   * Enqueues a function called in the next task.
   *
   * @memberof timeOut
   * @param {!Function} fn Callback to run
   * @param {number=} delay Delay in milliseconds
   * @return {number} Handle used for canceling task
   */
  run(fn, delay) {
    return window.setTimeout(fn, delay);
  },
  /**
   * Cancels a previously enqueued `timeOut` callback.
   *
   * @memberof timeOut
   * @param {number} handle Handle returned from `run` of callback to cancel
   * @return {void}
   */
  cancel(handle) {
    window.clearTimeout(handle);
  }
};
var animationFrame = {
  /**
   * Enqueues a function called at `requestAnimationFrame` timing.
   *
   * @memberof animationFrame
   * @param {function(number):void} fn Callback to run
   * @return {number} Handle used for canceling task
   */
  run(fn) {
    return window.requestAnimationFrame(fn);
  },
  /**
   * Cancels a previously enqueued `animationFrame` callback.
   *
   * @memberof animationFrame
   * @param {number} handle Handle returned from `run` of callback to cancel
   * @return {void}
   */
  cancel(handle) {
    window.cancelAnimationFrame(handle);
  }
};
var idlePeriod = {
  /**
   * Enqueues a function called at `requestIdleCallback` timing.
   *
   * @memberof idlePeriod
   * @param {function(!IdleDeadline):void} fn Callback to run
   * @return {number} Handle used for canceling task
   */
  run(fn) {
    return window.requestIdleCallback ? window.requestIdleCallback(fn) : window.setTimeout(fn, 16);
  },
  /**
   * Cancels a previously enqueued `idlePeriod` callback.
   *
   * @memberof idlePeriod
   * @param {number} handle Handle returned from `run` of callback to cancel
   * @return {void}
   */
  cancel(handle) {
    if (window.cancelIdleCallback) {
      window.cancelIdleCallback(handle);
    } else {
      window.clearTimeout(handle);
    }
  }
};
var microTask2 = {
  /**
   * Enqueues a function called at microtask timing.
   *
   * @memberof microTask
   * @param {!Function=} callback Callback to run
   * @return {number} Handle used for canceling task
   */
  run(callback) {
    if (!microtaskScheduled2) {
      microtaskScheduled2 = true;
      queueMicrotask(() => microtaskFlush2());
    }
    microtaskCallbacks2.push(callback);
    const result = microtaskCurrHandle2;
    microtaskCurrHandle2 += 1;
    return result;
  },
  /**
   * Cancels a previously enqueued `microTask` callback.
   *
   * @memberof microTask
   * @param {number} handle Handle returned from `run` of callback to cancel
   * @return {void}
   */
  cancel(handle) {
    const idx = handle - microtaskLastHandle2;
    if (idx >= 0) {
      if (!microtaskCallbacks2[idx]) {
        throw new Error(`invalid async handle: ${handle}`);
      }
      microtaskCallbacks2[idx] = null;
    }
  }
};

// node_modules/@vaadin/component-base/src/debounce.js
var debouncerQueue = /* @__PURE__ */ new Set();
var Debouncer = class _Debouncer {
  /**
   * Creates a debouncer if no debouncer is passed as a parameter
   * or it cancels an active debouncer otherwise. The following
   * example shows how a debouncer can be called multiple times within a
   * microtask and "debounced" such that the provided callback function is
   * called once. Add this method to a custom element:
   *
   * ```js
   * import {microTask} from '@vaadin/component-base/src/async.js';
   * import {Debouncer} from '@vaadin/component-base/src/debounce.js';
   * // ...
   *
   * _debounceWork() {
   *   this._debounceJob = Debouncer.debounce(this._debounceJob,
   *       microTask, () => this._doWork());
   * }
   * ```
   *
   * If the `_debounceWork` method is called multiple times within the same
   * microtask, the `_doWork` function will be called only once at the next
   * microtask checkpoint.
   *
   * Note: In testing it is often convenient to avoid asynchrony. To accomplish
   * this with a debouncer, you can use `enqueueDebouncer` and
   * `flush`. For example, extend the above example by adding
   * `enqueueDebouncer(this._debounceJob)` at the end of the
   * `_debounceWork` method. Then in a test, call `flush` to ensure
   * the debouncer has completed.
   *
   * @param {Debouncer?} debouncer Debouncer object.
   * @param {!AsyncInterface} asyncModule Object with Async interface
   * @param {function()} callback Callback to run.
   * @return {!Debouncer} Returns a debouncer object.
   */
  static debounce(debouncer, asyncModule, callback) {
    if (debouncer instanceof _Debouncer) {
      debouncer._cancelAsync();
    } else {
      debouncer = new _Debouncer();
    }
    debouncer.setConfig(asyncModule, callback);
    return debouncer;
  }
  constructor() {
    this._asyncModule = null;
    this._callback = null;
    this._timer = null;
  }
  /**
   * Sets the scheduler; that is, a module with the Async interface,
   * a callback and optional arguments to be passed to the run function
   * from the async module.
   *
   * @param {!AsyncInterface} asyncModule Object with Async interface.
   * @param {function()} callback Callback to run.
   * @return {void}
   */
  setConfig(asyncModule, callback) {
    this._asyncModule = asyncModule;
    this._callback = callback;
    this._timer = this._asyncModule.run(() => {
      this._timer = null;
      debouncerQueue.delete(this);
      this._callback();
    });
  }
  /**
   * Cancels an active debouncer and returns a reference to itself.
   *
   * @return {void}
   */
  cancel() {
    if (this.isActive()) {
      this._cancelAsync();
      debouncerQueue.delete(this);
    }
  }
  /**
   * Cancels a debouncer's async callback.
   *
   * @return {void}
   */
  _cancelAsync() {
    if (this.isActive()) {
      this._asyncModule.cancel(
        /** @type {number} */
        this._timer
      );
      this._timer = null;
    }
  }
  /**
   * Flushes an active debouncer and returns a reference to itself.
   *
   * @return {void}
   */
  flush() {
    if (this.isActive()) {
      this.cancel();
      this._callback();
    }
  }
  /**
   * Returns true if the debouncer is active.
   *
   * @return {boolean} True if active.
   */
  isActive() {
    return this._timer != null;
  }
};
function enqueueDebouncer(debouncer) {
  debouncerQueue.add(debouncer);
}
function flushDebouncers() {
  const didFlush = Boolean(debouncerQueue.size);
  debouncerQueue.forEach((debouncer) => {
    try {
      debouncer.flush();
    } catch (e4) {
      setTimeout(() => {
        throw e4;
      });
    }
  });
  return didFlush;
}
var flush = () => {
  let debouncers;
  do {
    debouncers = flushDebouncers();
  } while (debouncers);
};

// node_modules/@vaadin/component-base/src/iron-list-core.js
var IOS = navigator.userAgent.match(/iP(?:hone|ad;(?: U;)? CPU) OS (\d+)/u);
var IOS_TOUCH_SCROLLING = IOS && IOS[1] >= 8;
var DEFAULT_PHYSICAL_COUNT = 3;
var ironList = {
  /**
   * The ratio of hidden tiles that should remain in the scroll direction.
   * Recommended value ~0.5, so it will distribute tiles evenly in both
   * directions.
   */
  _ratio: 0.5,
  /**
   * The padding-top value for the list.
   */
  _scrollerPaddingTop: 0,
  /**
   * This value is a cached value of `scrollTop` from the last `scroll` event.
   */
  _scrollPosition: 0,
  /**
   * The sum of the heights of all the tiles in the DOM.
   */
  _physicalSize: 0,
  /**
   * The average `offsetHeight` of the tiles observed till now.
   */
  _physicalAverage: 0,
  /**
   * The number of tiles which `offsetHeight` > 0 observed until now.
   */
  _physicalAverageCount: 0,
  /**
   * The Y position of the item rendered in the `_physicalStart`
   * tile relative to the scrolling list.
   */
  _physicalTop: 0,
  /**
   * The number of items in the list.
   */
  _virtualCount: 0,
  /**
   * The estimated scroll height based on `_physicalAverage`
   */
  _estScrollHeight: 0,
  /**
   * The scroll height of the dom node
   */
  _scrollHeight: 0,
  /**
   * The height of the list. This is referred as the viewport in the context of
   * list.
   */
  _viewportHeight: 0,
  /**
   * The width of the list. This is referred as the viewport in the context of
   * list.
   */
  _viewportWidth: 0,
  /**
   * An array of DOM nodes that are currently in the tree
   * @type {?Array<!HTMLElement>}
   */
  _physicalItems: null,
  /**
   * An array of heights for each item in `_physicalItems`
   * @type {?Array<number>}
   */
  _physicalSizes: null,
  /**
   * A cached value for the first visible index.
   * See `firstVisibleIndex`
   * @type {?number}
   */
  _firstVisibleIndexVal: null,
  /**
   * A cached value for the last visible index.
   * See `lastVisibleIndex`
   * @type {?number}
   */
  _lastVisibleIndexVal: null,
  /**
   * The max number of pages to render. One page is equivalent to the height of
   * the list.
   */
  _maxPages: 2,
  /**
   * The cost of stamping a template in ms.
   */
  _templateCost: 0,
  /**
   * The bottom of the physical content.
   */
  get _physicalBottom() {
    return this._physicalTop + this._physicalSize;
  },
  /**
   * The bottom of the scroll.
   */
  get _scrollBottom() {
    return this._scrollPosition + this._viewportHeight;
  },
  /**
   * The n-th item rendered in the last physical item.
   */
  get _virtualEnd() {
    return this._virtualStart + this._physicalCount - 1;
  },
  /**
   * The height of the physical content that isn't on the screen.
   */
  get _hiddenContentSize() {
    return this._physicalSize - this._viewportHeight;
  },
  /**
   * The maximum scroll top value.
   */
  get _maxScrollTop() {
    return this._estScrollHeight - this._viewportHeight + this._scrollOffset;
  },
  /**
   * The largest n-th value for an item such that it can be rendered in
   * `_physicalStart`.
   */
  get _maxVirtualStart() {
    const virtualCount = this._virtualCount;
    return Math.max(0, virtualCount - this._physicalCount);
  },
  get _virtualStart() {
    return this._virtualStartVal || 0;
  },
  set _virtualStart(val) {
    val = this._clamp(val, 0, this._maxVirtualStart);
    this._virtualStartVal = val;
  },
  get _physicalStart() {
    return this._physicalStartVal || 0;
  },
  /**
   * The k-th tile that is at the top of the scrolling list.
   */
  set _physicalStart(val) {
    val %= this._physicalCount;
    if (val < 0) {
      val = this._physicalCount + val;
    }
    this._physicalStartVal = val;
  },
  /**
   * The k-th tile that is at the bottom of the scrolling list.
   */
  get _physicalEnd() {
    return (this._physicalStart + this._physicalCount - 1) % this._physicalCount;
  },
  get _physicalCount() {
    return this._physicalCountVal || 0;
  },
  set _physicalCount(val) {
    this._physicalCountVal = val;
  },
  /**
   * An optimal physical size such that we will have enough physical items
   * to fill up the viewport and recycle when the user scrolls.
   *
   * This default value assumes that we will at least have the equivalent
   * to a viewport of physical items above and below the user's viewport.
   */
  get _optPhysicalSize() {
    return this._viewportHeight === 0 ? Infinity : this._viewportHeight * this._maxPages;
  },
  /**
   * True if the current list is visible.
   */
  get _isVisible() {
    return Boolean(this.offsetWidth || this.offsetHeight);
  },
  /**
   * Gets the index of the first visible item in the viewport.
   *
   * @type {number}
   */
  get firstVisibleIndex() {
    let idx = this._firstVisibleIndexVal;
    if (idx == null) {
      let physicalOffset = this._physicalTop + this._scrollOffset;
      idx = this._iterateItems((pidx, vidx) => {
        physicalOffset += this._getPhysicalSizeIncrement(pidx);
        if (physicalOffset > this._scrollPosition) {
          return vidx;
        }
      }) || 0;
      this._firstVisibleIndexVal = idx;
    }
    return idx;
  },
  /**
   * Gets the index of the last visible item in the viewport.
   *
   * @type {number}
   */
  get lastVisibleIndex() {
    let idx = this._lastVisibleIndexVal;
    if (idx == null) {
      let physicalOffset = this._physicalTop + this._scrollOffset;
      this._iterateItems((pidx, vidx) => {
        if (physicalOffset < this._scrollBottom) {
          idx = vidx;
        }
        physicalOffset += this._getPhysicalSizeIncrement(pidx);
      });
      this._lastVisibleIndexVal = idx;
    }
    return idx;
  },
  get _scrollOffset() {
    return this._scrollerPaddingTop + this.scrollOffset;
  },
  /**
   * Recycles the physical items when needed.
   */
  _scrollHandler() {
    const scrollTop = Math.max(0, Math.min(this._maxScrollTop, this._scrollTop));
    let delta = scrollTop - this._scrollPosition;
    const isScrollingDown = delta >= 0;
    this._scrollPosition = scrollTop;
    this._firstVisibleIndexVal = null;
    this._lastVisibleIndexVal = null;
    if (Math.abs(delta) > this._physicalSize && this._physicalSize > 0) {
      delta -= this._scrollOffset;
      const idxAdjustment = Math.round(delta / this._physicalAverage);
      this._virtualStart += idxAdjustment;
      this._physicalStart += idxAdjustment;
      this._physicalTop = Math.min(Math.floor(this._virtualStart) * this._physicalAverage, this._scrollPosition);
      this._update();
    } else if (this._physicalCount > 0) {
      const reusables = this._getReusables(isScrollingDown);
      if (isScrollingDown) {
        this._physicalTop = reusables.physicalTop;
        this._virtualStart += reusables.indexes.length;
        this._physicalStart += reusables.indexes.length;
      } else {
        this._virtualStart -= reusables.indexes.length;
        this._physicalStart -= reusables.indexes.length;
      }
      this._update(reusables.indexes, isScrollingDown ? null : reusables.indexes);
      this._debounce("_increasePoolIfNeeded", this._increasePoolIfNeeded.bind(this, 0), microTask2);
    }
  },
  /**
   * Returns an object that contains the indexes of the physical items
   * that might be reused and the physicalTop.
   *
   * @param {boolean} fromTop If the potential reusable items are above the scrolling region.
   */
  _getReusables(fromTop) {
    let ith, offsetContent, physicalItemHeight;
    const idxs = [];
    const protectedOffsetContent = this._hiddenContentSize * this._ratio;
    const virtualStart = this._virtualStart;
    const virtualEnd = this._virtualEnd;
    const physicalCount = this._physicalCount;
    let top = this._physicalTop + this._scrollOffset;
    const bottom = this._physicalBottom + this._scrollOffset;
    const scrollTop = this._scrollPosition;
    const scrollBottom = this._scrollBottom;
    if (fromTop) {
      ith = this._physicalStart;
      offsetContent = scrollTop - top;
    } else {
      ith = this._physicalEnd;
      offsetContent = bottom - scrollBottom;
    }
    while (true) {
      physicalItemHeight = this._getPhysicalSizeIncrement(ith);
      offsetContent -= physicalItemHeight;
      if (idxs.length >= physicalCount || offsetContent <= protectedOffsetContent) {
        break;
      }
      if (fromTop) {
        if (virtualEnd + idxs.length + 1 >= this._virtualCount) {
          break;
        }
        if (top + physicalItemHeight >= scrollTop - this._scrollOffset) {
          break;
        }
        idxs.push(ith);
        top += physicalItemHeight;
        ith = (ith + 1) % physicalCount;
      } else {
        if (virtualStart - idxs.length <= 0) {
          break;
        }
        if (top + this._physicalSize - physicalItemHeight <= scrollBottom) {
          break;
        }
        idxs.push(ith);
        top -= physicalItemHeight;
        ith = ith === 0 ? physicalCount - 1 : ith - 1;
      }
    }
    return { indexes: idxs, physicalTop: top - this._scrollOffset };
  },
  /**
   * Update the list of items, starting from the `_virtualStart` item.
   * @param {!Array<number>=} itemSet
   * @param {!Array<number>=} movingUp
   */
  _update(itemSet, movingUp) {
    if (itemSet && itemSet.length === 0 || this._physicalCount === 0) {
      return;
    }
    this._assignModels(itemSet);
    this._updateMetrics(itemSet);
    if (movingUp) {
      while (movingUp.length) {
        const idx = movingUp.pop();
        this._physicalTop -= this._getPhysicalSizeIncrement(idx);
      }
    }
    this._positionItems();
    this._updateScrollerSize();
  },
  _isClientFull() {
    return this._scrollBottom !== 0 && this._physicalBottom - 1 >= this._scrollBottom && this._physicalTop <= this._scrollPosition;
  },
  /**
   * Increases the pool size.
   */
  _increasePoolIfNeeded(count) {
    const nextPhysicalCount = this._clamp(
      this._physicalCount + count,
      DEFAULT_PHYSICAL_COUNT,
      this._virtualCount - this._virtualStart
    );
    const delta = nextPhysicalCount - this._physicalCount;
    let nextIncrease = Math.round(this._physicalCount * 0.5);
    if (delta < 0) {
      return;
    }
    if (delta > 0) {
      const ts = window.performance.now();
      [].push.apply(this._physicalItems, this._createPool(delta));
      for (let i5 = 0; i5 < delta; i5++) {
        this._physicalSizes.push(0);
      }
      this._physicalCount += delta;
      if (this._physicalStart > this._physicalEnd && this._isIndexRendered(this._focusedVirtualIndex) && this._getPhysicalIndex(this._focusedVirtualIndex) < this._physicalEnd) {
        this._physicalStart += delta;
      }
      this._update();
      this._templateCost = (window.performance.now() - ts) / delta;
      nextIncrease = Math.round(this._physicalCount * 0.5);
    }
    if (this._virtualEnd >= this._virtualCount - 1 || nextIncrease === 0) {
    } else if (!this._isClientFull()) {
      this._debounce("_increasePoolIfNeeded", this._increasePoolIfNeeded.bind(this, nextIncrease), microTask2);
    } else if (this._physicalSize < this._optPhysicalSize) {
      this._debounce(
        "_increasePoolIfNeeded",
        this._increasePoolIfNeeded.bind(this, this._clamp(Math.round(50 / this._templateCost), 1, nextIncrease)),
        idlePeriod
      );
    }
  },
  /**
   * Renders the a new list.
   */
  _render() {
    if (!this.isAttached || !this._isVisible) {
      return;
    }
    if (this._physicalCount !== 0) {
      const reusables = this._getReusables(true);
      this._physicalTop = reusables.physicalTop;
      this._virtualStart += reusables.indexes.length;
      this._physicalStart += reusables.indexes.length;
      this._update(reusables.indexes);
      this._update();
      this._increasePoolIfNeeded(0);
    } else if (this._virtualCount > 0) {
      this.updateViewportBoundaries();
      this._increasePoolIfNeeded(DEFAULT_PHYSICAL_COUNT);
    }
  },
  /**
   * Called when the items have changed. That is, reassignments
   * to `items`, splices or updates to a single item.
   */
  _itemsChanged(change) {
    if (change.path === "items") {
      this._virtualStart = 0;
      this._physicalTop = 0;
      this._virtualCount = this.items ? this.items.length : 0;
      this._physicalIndexForKey = {};
      this._firstVisibleIndexVal = null;
      this._lastVisibleIndexVal = null;
      if (!this._physicalItems) {
        this._physicalItems = [];
      }
      if (!this._physicalSizes) {
        this._physicalSizes = [];
      }
      this._physicalStart = 0;
      if (this._scrollTop > this._scrollOffset) {
        this._resetScrollPosition(0);
      }
      this._debounce("_render", this._render, animationFrame);
    }
  },
  /**
   * Executes a provided function per every physical index in `itemSet`
   * `itemSet` default value is equivalent to the entire set of physical
   * indexes.
   *
   * @param {!function(number, number)} fn
   * @param {!Array<number>=} itemSet
   */
  _iterateItems(fn, itemSet) {
    let pidx, vidx, rtn, i5;
    if (arguments.length === 2 && itemSet) {
      for (i5 = 0; i5 < itemSet.length; i5++) {
        pidx = itemSet[i5];
        vidx = this._computeVidx(pidx);
        if ((rtn = fn.call(this, pidx, vidx)) != null) {
          return rtn;
        }
      }
    } else {
      pidx = this._physicalStart;
      vidx = this._virtualStart;
      for (; pidx < this._physicalCount; pidx++, vidx++) {
        if ((rtn = fn.call(this, pidx, vidx)) != null) {
          return rtn;
        }
      }
      for (pidx = 0; pidx < this._physicalStart; pidx++, vidx++) {
        if ((rtn = fn.call(this, pidx, vidx)) != null) {
          return rtn;
        }
      }
    }
  },
  /**
   * Returns the virtual index for a given physical index
   *
   * @param {number} pidx Physical index
   * @return {number}
   */
  _computeVidx(pidx) {
    if (pidx >= this._physicalStart) {
      return this._virtualStart + (pidx - this._physicalStart);
    }
    return this._virtualStart + (this._physicalCount - this._physicalStart) + pidx;
  },
  /**
   * Updates the position of the physical items.
   */
  _positionItems() {
    this._adjustScrollPosition();
    let y3 = this._physicalTop;
    this._iterateItems((pidx) => {
      this.translate3d(0, `${y3}px`, 0, this._physicalItems[pidx]);
      y3 += this._physicalSizes[pidx];
    });
  },
  _getPhysicalSizeIncrement(pidx) {
    return this._physicalSizes[pidx];
  },
  /**
   * Adjusts the scroll position when it was overestimated.
   */
  _adjustScrollPosition() {
    const deltaHeight = this._virtualStart === 0 ? this._physicalTop : Math.min(this._scrollPosition + this._physicalTop, 0);
    if (deltaHeight !== 0) {
      this._physicalTop -= deltaHeight;
      const scrollTop = this._scrollPosition;
      if (!IOS_TOUCH_SCROLLING && scrollTop > 0) {
        this._resetScrollPosition(scrollTop - deltaHeight);
      }
    }
  },
  /**
   * Sets the position of the scroll.
   */
  _resetScrollPosition(pos) {
    if (this.scrollTarget && pos >= 0) {
      this._scrollTop = pos;
      this._scrollPosition = this._scrollTop;
    }
  },
  /**
   * Sets the scroll height, that's the height of the content,
   *
   * @param {boolean=} forceUpdate If true, updates the height no matter what.
   */
  _updateScrollerSize(forceUpdate) {
    const estScrollHeight = this._physicalBottom + Math.max(this._virtualCount - this._physicalCount - this._virtualStart, 0) * this._physicalAverage;
    this._estScrollHeight = estScrollHeight;
    if (forceUpdate || this._scrollHeight === 0 || this._scrollPosition >= estScrollHeight - this._physicalSize || Math.abs(estScrollHeight - this._scrollHeight) >= this._viewportHeight) {
      this.$.items.style.height = `${estScrollHeight}px`;
      this._scrollHeight = estScrollHeight;
    }
  },
  /**
   * Scroll to a specific index in the virtual list regardless
   * of the physical items in the DOM tree.
   *
   * @method scrollToIndex
   * @param {number} idx The index of the item
   */
  scrollToIndex(idx) {
    if (typeof idx !== "number" || idx < 0 || idx > this.items.length - 1) {
      return;
    }
    flush();
    if (this._physicalCount === 0) {
      return;
    }
    idx = this._clamp(idx, 0, this._virtualCount - 1);
    if (!this._isIndexRendered(idx) || idx >= this._maxVirtualStart) {
      this._virtualStart = idx - 1;
    }
    this._assignModels();
    this._updateMetrics();
    this._physicalTop = this._virtualStart * this._physicalAverage;
    let currentTopItem = this._physicalStart;
    let currentVirtualItem = this._virtualStart;
    let targetOffsetTop = 0;
    const hiddenContentSize = this._hiddenContentSize;
    while (currentVirtualItem < idx && targetOffsetTop <= hiddenContentSize) {
      targetOffsetTop += this._getPhysicalSizeIncrement(currentTopItem);
      currentTopItem = (currentTopItem + 1) % this._physicalCount;
      currentVirtualItem += 1;
    }
    this._updateScrollerSize(true);
    this._positionItems();
    this._resetScrollPosition(this._physicalTop + this._scrollOffset + targetOffsetTop);
    this._increasePoolIfNeeded(0);
    this._firstVisibleIndexVal = null;
    this._lastVisibleIndexVal = null;
  },
  /**
   * Reset the physical average and the average count.
   */
  _resetAverage() {
    this._physicalAverage = 0;
    this._physicalAverageCount = 0;
  },
  /**
   * A handler for the `iron-resize` event triggered by `IronResizableBehavior`
   * when the element is resized.
   */
  _resizeHandler() {
    this._debounce(
      "_render",
      () => {
        this._firstVisibleIndexVal = null;
        this._lastVisibleIndexVal = null;
        if (this._isVisible) {
          this.updateViewportBoundaries();
          this.toggleScrollListener(true);
          this._resetAverage();
          this._render();
        } else {
          this.toggleScrollListener(false);
        }
      },
      animationFrame
    );
  },
  _isIndexRendered(idx) {
    return idx >= this._virtualStart && idx <= this._virtualEnd;
  },
  _getPhysicalIndex(vidx) {
    return (this._physicalStart + (vidx - this._virtualStart)) % this._physicalCount;
  },
  _clamp(v2, min, max) {
    return Math.min(max, Math.max(min, v2));
  },
  _debounce(name, cb, asyncModule) {
    if (!this._debouncers) {
      this._debouncers = {};
    }
    this._debouncers[name] = Debouncer.debounce(this._debouncers[name], asyncModule, cb.bind(this));
    enqueueDebouncer(this._debouncers[name]);
  }
};

// node_modules/@vaadin/component-base/src/virtualizer-iron-list-adapter.js
var MAX_VIRTUAL_COUNT = 1e5;
var OFFSET_ADJUST_MIN_THRESHOLD = 1e3;
var IronListAdapter = class {
  constructor({ createElements, updateElement, scrollTarget, scrollContainer, elementsContainer, reorderElements }) {
    this.isAttached = true;
    this._vidxOffset = 0;
    this.createElements = createElements;
    this.updateElement = updateElement;
    this.scrollTarget = scrollTarget;
    this.scrollContainer = scrollContainer;
    this.elementsContainer = elementsContainer || scrollContainer;
    this.reorderElements = reorderElements;
    this._maxPages = 1.3;
    this.__placeholderHeight = 200;
    this.__elementHeightQueue = Array(10);
    this.timeouts = {
      SCROLL_REORDER: 500,
      IGNORE_WHEEL: 500,
      FIX_INVALID_ITEM_POSITIONING: 100
    };
    this.__resizeObserver = new ResizeObserver(() => this._resizeHandler());
    if (getComputedStyle(this.scrollTarget).overflow === "visible") {
      this.scrollTarget.style.overflow = "auto";
    }
    if (getComputedStyle(this.scrollContainer).position === "static") {
      this.scrollContainer.style.position = "relative";
    }
    this.__resizeObserver.observe(this.scrollTarget);
    this.scrollTarget.addEventListener("scroll", () => this._scrollHandler());
    const attachObserver = new ResizeObserver(([{ contentRect }]) => {
      const isHidden = contentRect.width === 0 && contentRect.height === 0;
      if (!isHidden && this.__scrollTargetHidden && this.scrollTarget.scrollTop !== this._scrollPosition) {
        this.scrollTarget.scrollTop = this._scrollPosition;
      }
      this.__scrollTargetHidden = isHidden;
    });
    attachObserver.observe(this.scrollTarget);
    this._scrollLineHeight = this._getScrollLineHeight();
    this.scrollTarget.addEventListener("wheel", (e4) => this.__onWheel(e4));
    this.scrollTarget.addEventListener("virtualizer-element-focused", (e4) => this.__onElementFocused(e4));
    this.elementsContainer.addEventListener("focusin", () => {
      this.scrollTarget.dispatchEvent(
        new CustomEvent("virtualizer-element-focused", { detail: { element: this.__getFocusedElement() } })
      );
    });
    if (this.reorderElements) {
      this.scrollTarget.addEventListener("mousedown", () => {
        this.__mouseDown = true;
      });
      this.scrollTarget.addEventListener("mouseup", () => {
        this.__mouseDown = false;
        if (this.__pendingReorder) {
          this.__reorderElements();
        }
      });
    }
  }
  get scrollOffset() {
    return 0;
  }
  get adjustedFirstVisibleIndex() {
    return this.firstVisibleIndex + this._vidxOffset;
  }
  get adjustedLastVisibleIndex() {
    return this.lastVisibleIndex + this._vidxOffset;
  }
  get _maxVirtualIndexOffset() {
    return this.size - this._virtualCount;
  }
  __hasPlaceholders() {
    return this.__getVisibleElements().some((el) => el.__virtualizerPlaceholder);
  }
  scrollToIndex(index) {
    if (typeof index !== "number" || isNaN(index) || this.size === 0 || !this.scrollTarget.offsetHeight) {
      return;
    }
    delete this.__pendingScrollToIndex;
    if (this._physicalCount <= 3) {
      this.flush();
    }
    index = this._clamp(index, 0, this.size - 1);
    const visibleElementCount = this.__getVisibleElements().length;
    let targetVirtualIndex = Math.floor(index / this.size * this._virtualCount);
    if (this._virtualCount - targetVirtualIndex < visibleElementCount) {
      targetVirtualIndex = this._virtualCount - (this.size - index);
      this._vidxOffset = this._maxVirtualIndexOffset;
    } else if (targetVirtualIndex < visibleElementCount) {
      if (index < OFFSET_ADJUST_MIN_THRESHOLD) {
        targetVirtualIndex = index;
        this._vidxOffset = 0;
      } else {
        targetVirtualIndex = OFFSET_ADJUST_MIN_THRESHOLD;
        this._vidxOffset = index - targetVirtualIndex;
      }
    } else {
      this._vidxOffset = index - targetVirtualIndex;
    }
    this.__skipNextVirtualIndexAdjust = true;
    super.scrollToIndex(targetVirtualIndex);
    if (this.adjustedFirstVisibleIndex !== index && this._scrollTop < this._maxScrollTop && !this.grid) {
      this._scrollTop -= this.__getIndexScrollOffset(index) || 0;
    }
    this._scrollHandler();
    if (this.__hasPlaceholders()) {
      this.__pendingScrollToIndex = index;
    }
  }
  flush() {
    if (this.scrollTarget.offsetHeight === 0) {
      return;
    }
    this._resizeHandler();
    flush();
    this._scrollHandler();
    if (this.__fixInvalidItemPositioningDebouncer) {
      this.__fixInvalidItemPositioningDebouncer.flush();
    }
    if (this.__scrollReorderDebouncer) {
      this.__scrollReorderDebouncer.flush();
    }
    if (this.__debouncerWheelAnimationFrame) {
      this.__debouncerWheelAnimationFrame.flush();
    }
  }
  hostConnected() {
    if (this.scrollTarget.offsetParent && this.scrollTarget.scrollTop !== this._scrollPosition) {
      this.scrollTarget.scrollTop = this._scrollPosition;
    }
  }
  update(startIndex = 0, endIndex = this.size - 1) {
    const updatedElements = [];
    this.__getVisibleElements().forEach((el) => {
      if (el.__virtualIndex >= startIndex && el.__virtualIndex <= endIndex) {
        this.__updateElement(el, el.__virtualIndex, true);
        updatedElements.push(el);
      }
    });
    this.__afterElementsUpdated(updatedElements);
  }
  /**
   * Updates the height for a given set of items.
   *
   * @param {!Array<number>=} itemSet
   */
  _updateMetrics(itemSet) {
    flush();
    let newPhysicalSize = 0;
    let oldPhysicalSize = 0;
    const prevAvgCount = this._physicalAverageCount;
    const prevPhysicalAvg = this._physicalAverage;
    this._iterateItems((pidx, vidx) => {
      oldPhysicalSize += this._physicalSizes[pidx];
      this._physicalSizes[pidx] = Math.ceil(this.__getBorderBoxHeight(this._physicalItems[pidx]));
      newPhysicalSize += this._physicalSizes[pidx];
      this._physicalAverageCount += this._physicalSizes[pidx] ? 1 : 0;
    }, itemSet);
    this._physicalSize = this._physicalSize + newPhysicalSize - oldPhysicalSize;
    if (this._physicalAverageCount !== prevAvgCount) {
      this._physicalAverage = Math.round(
        (prevPhysicalAvg * prevAvgCount + newPhysicalSize) / this._physicalAverageCount
      );
    }
  }
  __getBorderBoxHeight(el) {
    const style2 = getComputedStyle(el);
    const itemHeight = parseFloat(style2.height) || 0;
    if (style2.boxSizing === "border-box") {
      return itemHeight;
    }
    const paddingBottom = parseFloat(style2.paddingBottom) || 0;
    const paddingTop = parseFloat(style2.paddingTop) || 0;
    const borderBottomWidth = parseFloat(style2.borderBottomWidth) || 0;
    const borderTopWidth = parseFloat(style2.borderTopWidth) || 0;
    return itemHeight + paddingBottom + paddingTop + borderBottomWidth + borderTopWidth;
  }
  __updateElement(el, index, forceSameIndexUpdates) {
    if (el.__virtualizerPlaceholder) {
      el.style.paddingTop = "";
      el.style.opacity = "";
      el.__virtualizerPlaceholder = false;
    }
    if (!this.__preventElementUpdates && (el.__lastUpdatedIndex !== index || forceSameIndexUpdates)) {
      this.updateElement(el, index);
      el.__lastUpdatedIndex = index;
    }
  }
  /**
   * Called synchronously right after elements have been updated.
   * This is a good place to do any post-update work.
   *
   * @param {!Array<!HTMLElement>} updatedElements
   */
  __afterElementsUpdated(updatedElements) {
    updatedElements.forEach((el) => {
      const elementHeight = el.offsetHeight;
      if (elementHeight === 0) {
        el.style.paddingTop = `${this.__placeholderHeight}px`;
        el.style.opacity = "0";
        el.__virtualizerPlaceholder = true;
        this.__placeholderClearDebouncer = Debouncer.debounce(
          this.__placeholderClearDebouncer,
          animationFrame,
          () => this._resizeHandler()
        );
      } else {
        this.__elementHeightQueue.push(elementHeight);
        this.__elementHeightQueue.shift();
        const filteredHeights = this.__elementHeightQueue.filter((h3) => h3 !== void 0);
        this.__placeholderHeight = Math.round(filteredHeights.reduce((a3, b3) => a3 + b3, 0) / filteredHeights.length);
      }
    });
    if (this.__pendingScrollToIndex !== void 0 && !this.__hasPlaceholders()) {
      this.scrollToIndex(this.__pendingScrollToIndex);
    }
  }
  __getIndexScrollOffset(index) {
    const element = this.__getVisibleElements().find((el) => el.__virtualIndex === index);
    return element ? this.scrollTarget.getBoundingClientRect().top - element.getBoundingClientRect().top : void 0;
  }
  get size() {
    return this.__size;
  }
  set size(size) {
    if (size === this.size) {
      return;
    }
    if (this.__fixInvalidItemPositioningDebouncer) {
      this.__fixInvalidItemPositioningDebouncer.cancel();
    }
    if (this._debouncers && this._debouncers._increasePoolIfNeeded) {
      this._debouncers._increasePoolIfNeeded.cancel();
    }
    this.__preventElementUpdates = true;
    let fvi;
    let fviOffsetBefore;
    if (size > 0) {
      fvi = this.adjustedFirstVisibleIndex;
      fviOffsetBefore = this.__getIndexScrollOffset(fvi);
    }
    this.__size = size;
    this._itemsChanged({
      path: "items"
    });
    flush();
    if (size > 0) {
      fvi = Math.min(fvi, size - 1);
      this.scrollToIndex(fvi);
      const fviOffsetAfter = this.__getIndexScrollOffset(fvi);
      if (fviOffsetBefore !== void 0 && fviOffsetAfter !== void 0) {
        this._scrollTop += fviOffsetBefore - fviOffsetAfter;
      }
    }
    this.__preventElementUpdates = false;
    if (!this._isVisible) {
      this._assignModels();
    }
    if (!this.elementsContainer.children.length) {
      requestAnimationFrame(() => this._resizeHandler());
    }
    this._resizeHandler();
    flush();
    this._debounce("_update", this._update, microTask2);
  }
  /** @private */
  get _scrollTop() {
    return this.scrollTarget.scrollTop;
  }
  /** @private */
  set _scrollTop(top) {
    this.scrollTarget.scrollTop = top;
  }
  /** @private */
  get items() {
    return {
      length: Math.min(this.size, MAX_VIRTUAL_COUNT)
    };
  }
  /** @private */
  get offsetHeight() {
    return this.scrollTarget.offsetHeight;
  }
  /** @private */
  get $() {
    return {
      items: this.scrollContainer
    };
  }
  /** @private */
  updateViewportBoundaries() {
    const styles = window.getComputedStyle(this.scrollTarget);
    this._scrollerPaddingTop = this.scrollTarget === this ? 0 : parseInt(styles["padding-top"], 10);
    this._isRTL = Boolean(styles.direction === "rtl");
    this._viewportWidth = this.elementsContainer.offsetWidth;
    this._viewportHeight = this.scrollTarget.offsetHeight;
    this._scrollPageHeight = this._viewportHeight - this._scrollLineHeight;
    if (this.grid) {
      this._updateGridMetrics();
    }
  }
  /** @private */
  setAttribute() {
  }
  /** @private */
  _createPool(size) {
    const physicalItems = this.createElements(size);
    const fragment = document.createDocumentFragment();
    physicalItems.forEach((el) => {
      el.style.position = "absolute";
      fragment.appendChild(el);
      this.__resizeObserver.observe(el);
    });
    this.elementsContainer.appendChild(fragment);
    return physicalItems;
  }
  /** @private */
  _assignModels(itemSet) {
    const updatedElements = [];
    this._iterateItems((pidx, vidx) => {
      const el = this._physicalItems[pidx];
      el.hidden = vidx >= this.size;
      if (!el.hidden) {
        el.__virtualIndex = vidx + (this._vidxOffset || 0);
        this.__updateElement(el, el.__virtualIndex);
        updatedElements.push(el);
      } else {
        delete el.__lastUpdatedIndex;
      }
    }, itemSet);
    this.__afterElementsUpdated(updatedElements);
  }
  /** @private */
  _isClientFull() {
    setTimeout(() => {
      this.__clientFull = true;
    });
    return this.__clientFull || super._isClientFull();
  }
  /** @private */
  translate3d(_x, y3, _z, el) {
    el.style.transform = `translateY(${y3})`;
  }
  /** @private */
  toggleScrollListener() {
  }
  /** @private */
  __getFocusedElement(visibleElements = this.__getVisibleElements()) {
    return visibleElements.find(
      (element) => element.contains(this.elementsContainer.getRootNode().activeElement) || element.contains(this.scrollTarget.getRootNode().activeElement)
    );
  }
  /** @private */
  __nextFocusableSiblingMissing(focusedElement, visibleElements) {
    return (
      // Check if focused element is the last visible DOM element
      visibleElements.indexOf(focusedElement) === visibleElements.length - 1 && // ...while there are more items available
      this.size > focusedElement.__virtualIndex + 1
    );
  }
  /** @private */
  __previousFocusableSiblingMissing(focusedElement, visibleElements) {
    return (
      // Check if focused element is the first visible DOM element
      visibleElements.indexOf(focusedElement) === 0 && // ...while there are preceding items available
      focusedElement.__virtualIndex > 0
    );
  }
  /** @private */
  __onElementFocused(e4) {
    if (!this.reorderElements) {
      return;
    }
    const focusedElement = e4.detail.element;
    if (!focusedElement) {
      return;
    }
    const visibleElements = this.__getVisibleElements();
    if (this.__previousFocusableSiblingMissing(focusedElement, visibleElements) || this.__nextFocusableSiblingMissing(focusedElement, visibleElements)) {
      this.flush();
    }
    const reorderedVisibleElements = this.__getVisibleElements();
    if (this.__nextFocusableSiblingMissing(focusedElement, reorderedVisibleElements)) {
      this._scrollTop += Math.ceil(focusedElement.getBoundingClientRect().bottom) - Math.floor(this.scrollTarget.getBoundingClientRect().bottom - 1);
      this.flush();
    } else if (this.__previousFocusableSiblingMissing(focusedElement, reorderedVisibleElements)) {
      this._scrollTop -= Math.ceil(this.scrollTarget.getBoundingClientRect().top + 1) - Math.floor(focusedElement.getBoundingClientRect().top);
      this.flush();
    }
  }
  _scrollHandler() {
    if (this.scrollTarget.offsetHeight === 0) {
      return;
    }
    this._adjustVirtualIndexOffset(this._scrollTop - (this.__previousScrollTop || 0));
    const delta = this.scrollTarget.scrollTop - this._scrollPosition;
    super._scrollHandler();
    if (this._physicalCount !== 0) {
      const isScrollingDown = delta >= 0;
      const reusables = this._getReusables(!isScrollingDown);
      if (reusables.indexes.length) {
        this._physicalTop = reusables.physicalTop;
        if (isScrollingDown) {
          this._virtualStart -= reusables.indexes.length;
          this._physicalStart -= reusables.indexes.length;
        } else {
          this._virtualStart += reusables.indexes.length;
          this._physicalStart += reusables.indexes.length;
        }
        this._resizeHandler();
      }
    }
    if (delta) {
      this.__fixInvalidItemPositioningDebouncer = Debouncer.debounce(
        this.__fixInvalidItemPositioningDebouncer,
        timeOut.after(this.timeouts.FIX_INVALID_ITEM_POSITIONING),
        () => this.__fixInvalidItemPositioning()
      );
    }
    if (this.reorderElements) {
      this.__scrollReorderDebouncer = Debouncer.debounce(
        this.__scrollReorderDebouncer,
        timeOut.after(this.timeouts.SCROLL_REORDER),
        () => this.__reorderElements()
      );
    }
    this.__previousScrollTop = this._scrollTop;
    if (this._scrollTop === 0 && this.firstVisibleIndex !== 0 && Math.abs(delta) > 0) {
      this.scrollToIndex(0);
    }
  }
  /** @override */
  _resizeHandler() {
    super._resizeHandler();
    const lastIndexVisible = this.adjustedLastVisibleIndex === this.size - 1;
    const emptySpace = this._physicalTop - this._scrollPosition;
    if (lastIndexVisible && emptySpace > 0) {
      const idxAdjustment = Math.ceil(emptySpace / this._physicalAverage);
      this._virtualStart = Math.max(0, this._virtualStart - idxAdjustment);
      this._physicalStart = Math.max(0, this._physicalStart - idxAdjustment);
      super.scrollToIndex(this._virtualCount - 1);
      this.scrollTarget.scrollTop = this.scrollTarget.scrollHeight - this.scrollTarget.clientHeight;
    }
  }
  /**
   * Work around an iron-list issue with invalid item positioning.
   * See https://github.com/vaadin/flow-components/issues/4306
   * @private
   */
  __fixInvalidItemPositioning() {
    if (!this.scrollTarget.isConnected) {
      return;
    }
    const physicalTopBelowTop = this._physicalTop > this._scrollTop;
    const physicalBottomAboveBottom = this._physicalBottom < this._scrollBottom;
    const firstIndexVisible = this.adjustedFirstVisibleIndex === 0;
    const lastIndexVisible = this.adjustedLastVisibleIndex === this.size - 1;
    if (physicalTopBelowTop && !firstIndexVisible || physicalBottomAboveBottom && !lastIndexVisible) {
      const isScrollingDown = physicalBottomAboveBottom;
      const originalRatio = this._ratio;
      this._ratio = 0;
      this._scrollPosition = this._scrollTop + (isScrollingDown ? -1 : 1);
      this._scrollHandler();
      this._ratio = originalRatio;
    }
  }
  /** @private */
  __onWheel(e4) {
    if (e4.ctrlKey || this._hasScrolledAncestor(e4.target, e4.deltaX, e4.deltaY)) {
      return;
    }
    let deltaY = e4.deltaY;
    if (e4.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      deltaY *= this._scrollLineHeight;
    } else if (e4.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      deltaY *= this._scrollPageHeight;
    }
    if (!this._deltaYAcc) {
      this._deltaYAcc = 0;
    }
    if (this._wheelAnimationFrame) {
      this._deltaYAcc += deltaY;
      e4.preventDefault();
      return;
    }
    deltaY += this._deltaYAcc;
    this._deltaYAcc = 0;
    this._wheelAnimationFrame = true;
    this.__debouncerWheelAnimationFrame = Debouncer.debounce(
      this.__debouncerWheelAnimationFrame,
      animationFrame,
      () => {
        this._wheelAnimationFrame = false;
      }
    );
    const momentum = Math.abs(e4.deltaX) + Math.abs(deltaY);
    if (this._canScroll(this.scrollTarget, e4.deltaX, deltaY)) {
      e4.preventDefault();
      this.scrollTarget.scrollTop += deltaY;
      this.scrollTarget.scrollLeft += e4.deltaX;
      this._hasResidualMomentum = true;
      this._ignoreNewWheel = true;
      this._debouncerIgnoreNewWheel = Debouncer.debounce(
        this._debouncerIgnoreNewWheel,
        timeOut.after(this.timeouts.IGNORE_WHEEL),
        () => {
          this._ignoreNewWheel = false;
        }
      );
    } else if (this._hasResidualMomentum && momentum <= this._previousMomentum || this._ignoreNewWheel) {
      e4.preventDefault();
    } else if (momentum > this._previousMomentum) {
      this._hasResidualMomentum = false;
    }
    this._previousMomentum = momentum;
  }
  /**
   * Determines if the element has an ancestor that handles the scroll delta prior to this
   *
   * @private
   */
  _hasScrolledAncestor(el, deltaX, deltaY) {
    if (el === this.scrollTarget || el === this.scrollTarget.getRootNode().host) {
      return false;
    } else if (this._canScroll(el, deltaX, deltaY) && ["auto", "scroll"].indexOf(getComputedStyle(el).overflow) !== -1) {
      return true;
    } else if (el !== this && el.parentElement) {
      return this._hasScrolledAncestor(el.parentElement, deltaX, deltaY);
    }
  }
  _canScroll(el, deltaX, deltaY) {
    return deltaY > 0 && el.scrollTop < el.scrollHeight - el.offsetHeight || deltaY < 0 && el.scrollTop > 0 || deltaX > 0 && el.scrollLeft < el.scrollWidth - el.offsetWidth || deltaX < 0 && el.scrollLeft > 0;
  }
  /**
   * Increases the pool size.
   * @override
   */
  _increasePoolIfNeeded(count) {
    if (this._physicalCount > 2 && count) {
      const totalItemCount = Math.ceil(this._optPhysicalSize / this._physicalAverage);
      const missingItemCount = totalItemCount - this._physicalCount;
      super._increasePoolIfNeeded(Math.max(count, Math.min(100, missingItemCount)));
    } else {
      super._increasePoolIfNeeded(count);
    }
  }
  /**
   * An optimal physical size such that we will have enough physical items
   * to fill up the viewport and recycle when the user scrolls.
   *
   * This default value assumes that we will at least have the equivalent
   * to a viewport of physical items above and below the user's viewport.
   * @override
   */
  get _optPhysicalSize() {
    const optPhysicalSize = super._optPhysicalSize;
    if (optPhysicalSize <= 0 || this.__hasPlaceholders()) {
      return optPhysicalSize;
    }
    return optPhysicalSize + this.__getItemHeightBuffer();
  }
  /**
   * Extra item height buffer used when calculating optimal physical size.
   *
   * The iron list core uses the optimal physical size when determining whether to increase the item pool.
   * For the cases where some items are much larger than the average, the iron list core might not increase item pool.
   * This can lead to the large item not being rendered.
   *
   * @returns {Number} - Extra item height buffer
   * @private
   */
  __getItemHeightBuffer() {
    if (this._physicalCount === 0) {
      return 0;
    }
    const bufferZoneHeight = Math.ceil(this._viewportHeight * (this._maxPages - 1) / 2);
    const maxItemHeight = Math.max(...this._physicalSizes);
    if (maxItemHeight > Math.min(...this._physicalSizes)) {
      return Math.max(0, maxItemHeight - bufferZoneHeight);
    }
    return 0;
  }
  /**
   * @returns {Number|undefined} - The browser's default font-size in pixels
   * @private
   */
  _getScrollLineHeight() {
    const el = document.createElement("div");
    el.style.fontSize = "initial";
    el.style.display = "none";
    document.body.appendChild(el);
    const fontSize = window.getComputedStyle(el).fontSize;
    document.body.removeChild(el);
    return fontSize ? window.parseInt(fontSize) : void 0;
  }
  __getVisibleElements() {
    return Array.from(this.elementsContainer.children).filter((element) => !element.hidden);
  }
  /** @private */
  __reorderElements() {
    if (this.__mouseDown) {
      this.__pendingReorder = true;
      return;
    }
    this.__pendingReorder = false;
    const adjustedVirtualStart = this._virtualStart + (this._vidxOffset || 0);
    const visibleElements = this.__getVisibleElements();
    const targetElement = this.__getFocusedElement(visibleElements) || visibleElements[0];
    if (!targetElement) {
      return;
    }
    const targetPhysicalIndex = targetElement.__virtualIndex - adjustedVirtualStart;
    const delta = visibleElements.indexOf(targetElement) - targetPhysicalIndex;
    if (delta > 0) {
      for (let i5 = 0; i5 < delta; i5++) {
        this.elementsContainer.appendChild(visibleElements[i5]);
      }
    } else if (delta < 0) {
      for (let i5 = visibleElements.length + delta; i5 < visibleElements.length; i5++) {
        this.elementsContainer.insertBefore(visibleElements[i5], visibleElements[0]);
      }
    }
    if (isSafari) {
      const { transform } = this.scrollTarget.style;
      this.scrollTarget.style.transform = "translateZ(0)";
      setTimeout(() => {
        this.scrollTarget.style.transform = transform;
      });
    }
  }
  /** @private */
  _adjustVirtualIndexOffset(delta) {
    const maxOffset = this._maxVirtualIndexOffset;
    if (this._virtualCount >= this.size) {
      this._vidxOffset = 0;
    } else if (this.__skipNextVirtualIndexAdjust) {
      this.__skipNextVirtualIndexAdjust = false;
    } else if (Math.abs(delta) > 1e4) {
      const scale = this._scrollTop / (this.scrollTarget.scrollHeight - this.scrollTarget.clientHeight);
      this._vidxOffset = Math.round(scale * maxOffset);
    } else {
      const oldOffset = this._vidxOffset;
      const threshold = OFFSET_ADJUST_MIN_THRESHOLD;
      const maxShift = 100;
      if (this._scrollTop === 0) {
        this._vidxOffset = 0;
        if (oldOffset !== this._vidxOffset) {
          super.scrollToIndex(0);
        }
      } else if (this.firstVisibleIndex < threshold && this._vidxOffset > 0) {
        this._vidxOffset -= Math.min(this._vidxOffset, maxShift);
        super.scrollToIndex(this.firstVisibleIndex + (oldOffset - this._vidxOffset));
      }
      if (this._scrollTop >= this._maxScrollTop && this._maxScrollTop > 0) {
        this._vidxOffset = maxOffset;
        if (oldOffset !== this._vidxOffset) {
          super.scrollToIndex(this._virtualCount - 1);
        }
      } else if (this.firstVisibleIndex > this._virtualCount - threshold && this._vidxOffset < maxOffset) {
        this._vidxOffset += Math.min(maxOffset - this._vidxOffset, maxShift);
        super.scrollToIndex(this.firstVisibleIndex - (this._vidxOffset - oldOffset));
      }
    }
  }
};
Object.setPrototypeOf(IronListAdapter.prototype, ironList);

// node_modules/@vaadin/component-base/src/virtualizer.js
var Virtualizer = class {
  /**
   * @typedef {Object} VirtualizerConfig
   * @property {Function} createElements Function that returns the given number of new elements
   * @property {Function} updateElement Function that updates the element at a specific index
   * @property {HTMLElement} scrollTarget Reference to the scrolling element
   * @property {HTMLElement} scrollContainer Reference to a wrapper for the item elements (or a slot) inside the scrollTarget
   * @property {HTMLElement | undefined} elementsContainer Reference to the container in which the item elements are placed, defaults to scrollContainer
   * @property {boolean | undefined} reorderElements Determines whether the physical item elements should be kept in order in the DOM
   * @param {VirtualizerConfig} config Configuration for the virtualizer
   */
  constructor(config) {
    this.__adapter = new IronListAdapter(config);
  }
  /**
   * Gets the index of the first visible item in the viewport.
   *
   * @return {number}
   */
  get firstVisibleIndex() {
    return this.__adapter.adjustedFirstVisibleIndex;
  }
  /**
   * Gets the index of the last visible item in the viewport.
   *
   * @return {number}
   */
  get lastVisibleIndex() {
    return this.__adapter.adjustedLastVisibleIndex;
  }
  /**
   * The size of the virtualizer
   * @return {number | undefined} The size of the virtualizer
   */
  get size() {
    return this.__adapter.size;
  }
  /**
   * The size of the virtualizer
   * @param {number} size The size of the virtualizer
   */
  set size(size) {
    this.__adapter.size = size;
  }
  /**
   * Scroll to a specific index in the virtual list
   *
   * @method scrollToIndex
   * @param {number} index The index of the item
   */
  scrollToIndex(index) {
    this.__adapter.scrollToIndex(index);
  }
  /**
   * Requests the virtualizer to re-render the item elements on an index range, if currently in the DOM
   *
   * @method update
   * @param {number | undefined} startIndex The start index of the range
   * @param {number | undefined} endIndex The end index of the range
   */
  update(startIndex = 0, endIndex = this.size - 1) {
    this.__adapter.update(startIndex, endIndex);
  }
  /**
   * Flushes active asynchronous tasks so that the component and the DOM end up in a stable state
   *
   * @method update
   * @param {number | undefined} startIndex The start index of the range
   * @param {number | undefined} endIndex The end index of the range
   */
  flush() {
    this.__adapter.flush();
  }
  /**
   * Notifies the virtualizer about its host element connected to the DOM.
   *
   * @method hostConnected
   */
  hostConnected() {
    this.__adapter.hostConnected();
  }
};

// node_modules/@vaadin/combo-box/src/vaadin-combo-box-placeholder.js
var ComboBoxPlaceholder = class ComboBoxPlaceholder2 {
  toString() {
    return "";
  }
};

// node_modules/@vaadin/combo-box/src/vaadin-combo-box-scroller-mixin.js
var ComboBoxScrollerMixin = (superClass) => class ComboBoxScrollerMixin extends superClass {
  static get properties() {
    return {
      /**
       * A full set of items to filter the visible options from.
       * Set to an empty array when combo-box is not opened.
       */
      items: {
        type: Array,
        sync: true,
        observer: "__itemsChanged"
      },
      /**
       * Index of an item that has focus outline and is scrolled into view.
       * The actual focus still remains in the input field.
       */
      focusedIndex: {
        type: Number,
        sync: true,
        observer: "__focusedIndexChanged"
      },
      /**
       * Set to true while combo-box fetches new page from the data provider.
       */
      loading: {
        type: Boolean,
        sync: true,
        observer: "__loadingChanged"
      },
      /**
       * Whether the combo-box is currently opened or not. If set to false,
       * calling `scrollIntoView` does not have any effect.
       */
      opened: {
        type: Boolean,
        sync: true,
        observer: "__openedChanged"
      },
      /**
       * The selected item from the `items` array.
       */
      selectedItem: {
        type: Object,
        sync: true,
        observer: "__selectedItemChanged"
      },
      /**
       * A function used to generate CSS class names for dropdown
       * items based on the item. The return value should be the
       * generated class name as a string, or multiple class names
       * separated by whitespace characters.
       */
      itemClassNameGenerator: {
        type: Object,
        observer: "__itemClassNameGeneratorChanged"
      },
      /**
       * Path for the id of the item, used to detect whether the item is selected.
       */
      itemIdPath: {
        type: String
      },
      /**
       * Reference to the owner (combo-box owner), used by the item elements.
       */
      owner: {
        type: Object
      },
      /**
       * Function used to set a label for every combo-box item.
       */
      getItemLabel: {
        type: Object
      },
      /**
       * Function used to render the content of every combo-box item.
       */
      renderer: {
        type: Object,
        sync: true,
        observer: "__rendererChanged"
      },
      /**
       * Used to propagate the `theme` attribute from the host element.
       */
      theme: {
        type: String
      }
    };
  }
  constructor() {
    super();
    this.__boundOnItemClick = this.__onItemClick.bind(this);
  }
  /** @private */
  get _viewportTotalPaddingBottom() {
    if (this._cachedViewportTotalPaddingBottom === void 0) {
      const itemsStyle = window.getComputedStyle(this.$.selector);
      this._cachedViewportTotalPaddingBottom = [itemsStyle.paddingBottom, itemsStyle.borderBottomWidth].map((v2) => {
        return parseInt(v2, 10);
      }).reduce((sum, v2) => {
        return sum + v2;
      });
    }
    return this._cachedViewportTotalPaddingBottom;
  }
  /** @protected */
  ready() {
    super.ready();
    this.setAttribute("role", "listbox");
    this.id = `${this.localName}-${generateUniqueId()}`;
    this.__hostTagName = this.constructor.is.replace("-scroller", "");
    this.addEventListener("click", (e4) => e4.stopPropagation());
    this.__patchWheelOverScrolling();
  }
  /**
   * Updates the virtualizer's size and items.
   */
  requestContentUpdate() {
    if (!this.__virtualizer) {
      return;
    }
    if (this.items) {
      this.__virtualizer.size = this.items.length;
    }
    if (this.opened) {
      this.__virtualizer.update();
    }
  }
  /**
   * Scrolls an item at given index into view and adjusts `scrollTop`
   * so that the element gets fully visible on Arrow Down key press.
   * @param {number} index
   */
  scrollIntoView(index) {
    if (!this.__virtualizer || !(this.opened && index >= 0)) {
      return;
    }
    const visibleItemsCount = this._visibleItemsCount();
    let targetIndex = index;
    if (index > this.__virtualizer.lastVisibleIndex - 1) {
      this.__virtualizer.scrollToIndex(index);
      targetIndex = index - visibleItemsCount + 1;
    } else if (index > this.__virtualizer.firstVisibleIndex) {
      targetIndex = this.__virtualizer.firstVisibleIndex;
    }
    this.__virtualizer.scrollToIndex(Math.max(0, targetIndex));
    const lastPhysicalItem = [...this.children].find(
      (el) => !el.hidden && el.index === this.__virtualizer.lastVisibleIndex
    );
    if (!lastPhysicalItem || index !== lastPhysicalItem.index) {
      return;
    }
    const lastPhysicalItemRect = lastPhysicalItem.getBoundingClientRect();
    const scrollerRect = this.getBoundingClientRect();
    const scrollTopAdjust = lastPhysicalItemRect.bottom - scrollerRect.bottom + this._viewportTotalPaddingBottom;
    if (scrollTopAdjust > 0) {
      this.scrollTop += scrollTopAdjust;
    }
  }
  /**
   * @param {string | object} item
   * @param {string | object} selectedItem
   * @param {string} itemIdPath
   * @protected
   */
  _isItemSelected(item2, selectedItem, itemIdPath) {
    if (item2 instanceof ComboBoxPlaceholder) {
      return false;
    } else if (itemIdPath && item2 !== void 0 && selectedItem !== void 0) {
      return get2(itemIdPath, item2) === get2(itemIdPath, selectedItem);
    }
    return item2 === selectedItem;
  }
  /** @private */
  __initVirtualizer() {
    this.__virtualizer = new Virtualizer({
      createElements: this.__createElements.bind(this),
      updateElement: this._updateElement.bind(this),
      elementsContainer: this,
      scrollTarget: this,
      scrollContainer: this.$.selector,
      reorderElements: true
    });
  }
  /** @private */
  __itemsChanged(items) {
    if (items && this.__virtualizer) {
      this.requestContentUpdate();
    }
  }
  /** @private */
  __loadingChanged() {
    this.requestContentUpdate();
  }
  /** @private */
  __openedChanged(opened) {
    if (opened) {
      if (!this.__virtualizer) {
        this.__initVirtualizer();
      }
      this.requestContentUpdate();
    }
  }
  /** @private */
  __selectedItemChanged() {
    this.requestContentUpdate();
  }
  /** @private */
  __itemClassNameGeneratorChanged(generator, oldGenerator) {
    if (generator || oldGenerator) {
      this.requestContentUpdate();
    }
  }
  /** @private */
  __focusedIndexChanged(index, oldIndex) {
    if (index !== oldIndex) {
      this.requestContentUpdate();
    }
    if (index >= 0 && !this.loading) {
      this.scrollIntoView(index);
    }
  }
  /** @private */
  __rendererChanged(renderer, oldRenderer) {
    if (renderer || oldRenderer) {
      this.requestContentUpdate();
    }
  }
  /** @private */
  __createElements(count) {
    return [...Array(count)].map(() => {
      const item2 = document.createElement(`${this.__hostTagName}-item`);
      item2.addEventListener("click", this.__boundOnItemClick);
      item2.tabIndex = "-1";
      item2.style.width = "100%";
      return item2;
    });
  }
  /**
   * @param {HTMLElement} el
   * @param {number} index
   * @protected
   */
  _updateElement(el, index) {
    const item2 = this.items[index];
    const focusedIndex = this.focusedIndex;
    const selected = this._isItemSelected(item2, this.selectedItem, this.itemIdPath);
    el.setProperties({
      item: item2,
      index,
      label: this.getItemLabel(item2),
      selected,
      renderer: this.renderer,
      focused: !this.loading && focusedIndex === index
    });
    if (typeof this.itemClassNameGenerator === "function") {
      el.className = this.itemClassNameGenerator(item2);
    } else if (el.className !== "") {
      el.className = "";
    }
    el.id = `${this.__hostTagName}-item-${index}`;
    el.setAttribute("role", index !== void 0 ? "option" : false);
    el.setAttribute("aria-selected", selected.toString());
    el.setAttribute("aria-posinset", index + 1);
    el.setAttribute("aria-setsize", this.items.length);
    if (this.theme) {
      el.setAttribute("theme", this.theme);
    } else {
      el.removeAttribute("theme");
    }
    if (item2 instanceof ComboBoxPlaceholder) {
      this.__requestItemByIndex(index);
    }
  }
  /** @private */
  __onItemClick(e4) {
    this.dispatchEvent(new CustomEvent("selection-changed", { detail: { item: e4.currentTarget.item } }));
  }
  /**
   * We want to prevent the kinetic scrolling energy from being transferred from the overlay contents over to the parent.
   * Further improvement ideas: after the contents have been scrolled to the top or bottom and scrolling has stopped, it could allow
   * scrolling the parent similarly to touch scrolling.
   * @private
   */
  __patchWheelOverScrolling() {
    this.$.selector.addEventListener("wheel", (e4) => {
      const scrolledToTop = this.scrollTop === 0;
      const scrolledToBottom = this.scrollHeight - this.scrollTop - this.clientHeight <= 1;
      if (scrolledToTop && e4.deltaY < 0) {
        e4.preventDefault();
      } else if (scrolledToBottom && e4.deltaY > 0) {
        e4.preventDefault();
      }
    });
  }
  /**
   * Dispatches an `index-requested` event for the given index to notify
   * the data provider that it should start loading the page containing the requested index.
   *
   * The event is dispatched asynchronously to prevent an immediate page request and therefore
   * a possible infinite recursion in case the data provider implements page request cancelation logic
   * by invoking data provider page callbacks with an empty array.
   * The infinite recursion may occur otherwise since invoking a data provider page callback with an empty array
   * triggers a synchronous scroller update and, if the callback corresponds to the currently visible page,
   * the scroller will synchronously request the page again which may lead to looping in the end.
   * That was the case for the Flow counterpart:
   * https://github.com/vaadin/flow-components/issues/3553#issuecomment-1239344828
   * @private
   */
  __requestItemByIndex(index) {
    requestAnimationFrame(() => {
      this.dispatchEvent(
        new CustomEvent("index-requested", {
          detail: {
            index
          }
        })
      );
    });
  }
  /** @private */
  _visibleItemsCount() {
    this.__virtualizer.scrollToIndex(this.__virtualizer.firstVisibleIndex);
    const hasItems = this.__virtualizer.size > 0;
    return hasItems ? this.__virtualizer.lastVisibleIndex - this.__virtualizer.firstVisibleIndex + 1 : 0;
  }
};

// node_modules/@vaadin/combo-box/src/vaadin-combo-box-scroller.js
var ComboBoxScroller = class extends ComboBoxScrollerMixin(PolymerElement) {
  static get is() {
    return "vaadin-combo-box-scroller";
  }
  static get template() {
    return html`
      <style>
        :host {
          display: block;
          min-height: 1px;
          overflow: auto;

          /* Fixes item background from getting on top of scrollbars on Safari */
          transform: translate3d(0, 0, 0);

          /* Enable momentum scrolling on iOS */
          -webkit-overflow-scrolling: touch;

          /* Fixes scrollbar disappearing when 'Show scroll bars: Always' enabled in Safari */
          box-shadow: 0 0 0 white;
        }

        #selector {
          border-width: var(--_vaadin-combo-box-items-container-border-width);
          border-style: var(--_vaadin-combo-box-items-container-border-style);
          border-color: var(--_vaadin-combo-box-items-container-border-color, transparent);
          position: relative;
        }
      </style>
      <div id="selector">
        <slot></slot>
      </div>
    `;
  }
};
defineCustomElement(ComboBoxScroller);

// node_modules/@vaadin/vaadin-development-mode-detector/vaadin-development-mode-detector.js
var DEV_MODE_CODE_REGEXP = /\/\*[\*!]\s+vaadin-dev-mode:start([\s\S]*)vaadin-dev-mode:end\s+\*\*\//i;
var FlowClients = window.Vaadin && window.Vaadin.Flow && window.Vaadin.Flow.clients;
function isMinified() {
  function test() {
    return true;
  }
  return uncommentAndRun(test);
}
function isDevelopmentMode() {
  try {
    if (isForcedDevelopmentMode()) {
      return true;
    }
    if (!isLocalhost()) {
      return false;
    }
    if (FlowClients) {
      return !isFlowProductionMode();
    }
    return !isMinified();
  } catch (e4) {
    return false;
  }
}
function isForcedDevelopmentMode() {
  return localStorage.getItem("vaadin.developmentmode.force");
}
function isLocalhost() {
  return ["localhost", "127.0.0.1"].indexOf(window.location.hostname) >= 0;
}
function isFlowProductionMode() {
  if (FlowClients) {
    const productionModeApps = Object.keys(FlowClients).map((key) => FlowClients[key]).filter((client) => client.productionMode);
    if (productionModeApps.length > 0) {
      return true;
    }
  }
  return false;
}
function uncommentAndRun(callback, args) {
  if (typeof callback !== "function") {
    return;
  }
  const match = DEV_MODE_CODE_REGEXP.exec(callback.toString());
  if (match) {
    try {
      callback = new Function(match[1]);
    } catch (e4) {
      console.log("vaadin-development-mode-detector: uncommentAndRun() failed", e4);
    }
  }
  return callback(args);
}
window["Vaadin"] = window["Vaadin"] || {};
var runIfDevelopmentMode = function(callback, args) {
  if (window.Vaadin.developmentMode) {
    return uncommentAndRun(callback, args);
  }
};
if (window.Vaadin.developmentMode === void 0) {
  window.Vaadin.developmentMode = isDevelopmentMode();
}

// node_modules/@vaadin/vaadin-usage-statistics/vaadin-usage-statistics-collect.js
function maybeGatherAndSendStats() {
}
var usageStatistics = function() {
  if (typeof runIfDevelopmentMode === "function") {
    return runIfDevelopmentMode(maybeGatherAndSendStats);
  }
};

// node_modules/@vaadin/component-base/src/element-mixin.js
setCancelSyntheticClickEvents(false);
if (!window.Vaadin) {
  window.Vaadin = {};
}
if (!window.Vaadin.registrations) {
  window.Vaadin.registrations = [];
}
if (!window.Vaadin.developmentModeCallback) {
  window.Vaadin.developmentModeCallback = {};
}
window.Vaadin.developmentModeCallback["vaadin-usage-statistics"] = function() {
  usageStatistics();
};
var statsJob;
var registered = /* @__PURE__ */ new Set();
var ElementMixin2 = (superClass) => class VaadinElementMixin extends DirMixin(superClass) {
  /** @protected */
  static finalize() {
    super.finalize();
    const { is } = this;
    if (is && !registered.has(is)) {
      window.Vaadin.registrations.push(this);
      registered.add(is);
      if (window.Vaadin.developmentModeCallback) {
        statsJob = Debouncer.debounce(statsJob, idlePeriod, () => {
          window.Vaadin.developmentModeCallback["vaadin-usage-statistics"]();
        });
        enqueueDebouncer(statsJob);
      }
    }
  }
  constructor() {
    super();
    if (document.doctype === null) {
      console.warn(
        'Vaadin components require the "standards mode" declaration. Please add <!DOCTYPE html> to the HTML document.'
      );
    }
  }
};

// node_modules/@vaadin/component-base/src/slot-observer.js
var SlotObserver = class {
  constructor(slot, callback) {
    this.slot = slot;
    this.callback = callback;
    this._storedNodes = [];
    this._connected = false;
    this._scheduled = false;
    this._boundSchedule = () => {
      this._schedule();
    };
    this.connect();
    this._schedule();
  }
  /**
   * Activates an observer. This method is automatically called when
   * a `SlotObserver` is created. It should only be called to  re-activate
   * an observer that has been deactivated via the `disconnect` method.
   */
  connect() {
    this.slot.addEventListener("slotchange", this._boundSchedule);
    this._connected = true;
  }
  /**
   * Deactivates the observer. After calling this method the observer callback
   * will not be called when changes to slotted nodes occur. The `connect` method
   * may be subsequently called to reactivate the observer.
   */
  disconnect() {
    this.slot.removeEventListener("slotchange", this._boundSchedule);
    this._connected = false;
  }
  /** @private */
  _schedule() {
    if (!this._scheduled) {
      this._scheduled = true;
      queueMicrotask(() => {
        this.flush();
      });
    }
  }
  /**
   * Run the observer callback synchronously.
   */
  flush() {
    if (!this._connected) {
      return;
    }
    this._scheduled = false;
    this._processNodes();
  }
  /** @private */
  _processNodes() {
    const currentNodes = this.slot.assignedNodes({ flatten: true });
    let addedNodes = [];
    const removedNodes = [];
    const movedNodes = [];
    if (currentNodes.length) {
      addedNodes = currentNodes.filter((node) => !this._storedNodes.includes(node));
    }
    if (this._storedNodes.length) {
      this._storedNodes.forEach((node, index) => {
        const idx = currentNodes.indexOf(node);
        if (idx === -1) {
          removedNodes.push(node);
        } else if (idx !== index) {
          movedNodes.push(node);
        }
      });
    }
    if (addedNodes.length || removedNodes.length || movedNodes.length) {
      this.callback({ addedNodes, currentNodes, movedNodes, removedNodes });
    }
    this._storedNodes = currentNodes;
  }
};

// node_modules/@vaadin/component-base/src/slot-controller.js
var SlotController = class extends EventTarget {
  /**
   * Ensure that every instance has unique ID.
   *
   * @param {HTMLElement} host
   * @param {string} slotName
   * @return {string}
   * @protected
   */
  static generateId(host, prefix = "default") {
    return `${prefix}-${host.localName}-${generateUniqueId()}`;
  }
  constructor(host, slotName, tagName, config = {}) {
    super();
    const { initializer, multiple, observe, useUniqueId, uniqueIdPrefix } = config;
    this.host = host;
    this.slotName = slotName;
    this.tagName = tagName;
    this.observe = typeof observe === "boolean" ? observe : true;
    this.multiple = typeof multiple === "boolean" ? multiple : false;
    this.slotInitializer = initializer;
    if (multiple) {
      this.nodes = [];
    }
    if (useUniqueId) {
      this.defaultId = this.constructor.generateId(host, uniqueIdPrefix || slotName);
    }
  }
  hostConnected() {
    if (!this.initialized) {
      if (this.multiple) {
        this.initMultiple();
      } else {
        this.initSingle();
      }
      if (this.observe) {
        this.observeSlot();
      }
      this.initialized = true;
    }
  }
  /** @protected */
  initSingle() {
    let node = this.getSlotChild();
    if (!node) {
      node = this.attachDefaultNode();
      this.initNode(node);
    } else {
      this.node = node;
      this.initAddedNode(node);
    }
  }
  /** @protected */
  initMultiple() {
    const children = this.getSlotChildren();
    if (children.length === 0) {
      const defaultNode = this.attachDefaultNode();
      if (defaultNode) {
        this.nodes = [defaultNode];
        this.initNode(defaultNode);
      }
    } else {
      this.nodes = children;
      children.forEach((node) => {
        this.initAddedNode(node);
      });
    }
  }
  /**
   * Create and attach default node using the provided tag name, if any.
   * @return {Node | undefined}
   * @protected
   */
  attachDefaultNode() {
    const { host, slotName, tagName } = this;
    let node = this.defaultNode;
    if (!node && tagName) {
      node = document.createElement(tagName);
      if (node instanceof Element) {
        if (slotName !== "") {
          node.setAttribute("slot", slotName);
        }
        this.defaultNode = node;
      }
    }
    if (node) {
      this.node = node;
      host.appendChild(node);
    }
    return node;
  }
  /**
   * Return the list of nodes matching the slot managed by the controller.
   * @return {Node}
   */
  getSlotChildren() {
    const { slotName } = this;
    return Array.from(this.host.childNodes).filter((node) => {
      return node.nodeType === Node.ELEMENT_NODE && node.slot === slotName || node.nodeType === Node.TEXT_NODE && node.textContent.trim() && slotName === "";
    });
  }
  /**
   * Return a reference to the node managed by the controller.
   * @return {Node}
   */
  getSlotChild() {
    return this.getSlotChildren()[0];
  }
  /**
   * Run `slotInitializer` for the node managed by the controller.
   *
   * @param {Node} node
   * @protected
   */
  initNode(node) {
    const { slotInitializer } = this;
    if (slotInitializer) {
      slotInitializer(node, this.host);
    }
  }
  /**
   * Override to initialize the newly added custom node.
   *
   * @param {Node} _node
   * @protected
   */
  initCustomNode(_node) {
  }
  /**
   * Override to teardown slotted node when it's removed.
   *
   * @param {Node} _node
   * @protected
   */
  teardownNode(_node) {
  }
  /**
   * Run both `initCustomNode` and `initNode` for a custom slotted node.
   *
   * @param {Node} node
   * @protected
   */
  initAddedNode(node) {
    if (node !== this.defaultNode) {
      this.initCustomNode(node);
      this.initNode(node);
    }
  }
  /**
   * Setup the observer to manage slot content changes.
   * @protected
   */
  observeSlot() {
    const { slotName } = this;
    const selector = slotName === "" ? "slot:not([name])" : `slot[name=${slotName}]`;
    const slot = this.host.shadowRoot.querySelector(selector);
    this.__slotObserver = new SlotObserver(slot, ({ addedNodes, removedNodes }) => {
      const current = this.multiple ? this.nodes : [this.node];
      const newNodes = addedNodes.filter((node) => !isEmptyTextNode(node) && !current.includes(node));
      if (removedNodes.length) {
        this.nodes = current.filter((node) => !removedNodes.includes(node));
        removedNodes.forEach((node) => {
          this.teardownNode(node);
        });
      }
      if (newNodes && newNodes.length > 0) {
        if (this.multiple) {
          if (this.defaultNode) {
            this.defaultNode.remove();
          }
          this.nodes = [...current, ...newNodes].filter((node) => node !== this.defaultNode);
          newNodes.forEach((node) => {
            this.initAddedNode(node);
          });
        } else {
          if (this.node) {
            this.node.remove();
          }
          this.node = newNodes[0];
          this.initAddedNode(this.node);
        }
      }
    });
  }
};

// node_modules/@vaadin/component-base/src/tooltip-controller.js
var TooltipController = class extends SlotController {
  constructor(host) {
    super(host, "tooltip");
    this.setTarget(host);
  }
  /**
   * Override to initialize the newly added custom tooltip.
   *
   * @param {Node} tooltipNode
   * @protected
   * @override
   */
  initCustomNode(tooltipNode) {
    tooltipNode.target = this.target;
    if (this.ariaTarget !== void 0) {
      tooltipNode.ariaTarget = this.ariaTarget;
    }
    if (this.context !== void 0) {
      tooltipNode.context = this.context;
    }
    if (this.manual !== void 0) {
      tooltipNode.manual = this.manual;
    }
    if (this.opened !== void 0) {
      tooltipNode.opened = this.opened;
    }
    if (this.position !== void 0) {
      tooltipNode._position = this.position;
    }
    if (this.shouldShow !== void 0) {
      tooltipNode.shouldShow = this.shouldShow;
    }
    this.__notifyChange();
  }
  /**
   * Override to notify the host when the tooltip is removed.
   *
   * @param {Node} tooltipNode
   * @protected
   * @override
   */
  teardownNode() {
    this.__notifyChange();
  }
  /**
   * Set an HTML element for linking with the tooltip overlay
   * via `aria-describedby` attribute used by screen readers.
   * @param {HTMLElement} ariaTarget
   */
  setAriaTarget(ariaTarget) {
    this.ariaTarget = ariaTarget;
    const tooltipNode = this.node;
    if (tooltipNode) {
      tooltipNode.ariaTarget = ariaTarget;
    }
  }
  /**
   * Set a context object to be used by generator.
   * @param {object} context
   */
  setContext(context) {
    this.context = context;
    const tooltipNode = this.node;
    if (tooltipNode) {
      tooltipNode.context = context;
    }
  }
  /**
   * Toggle manual state on the slotted tooltip.
   * @param {boolean} manual
   */
  setManual(manual) {
    this.manual = manual;
    const tooltipNode = this.node;
    if (tooltipNode) {
      tooltipNode.manual = manual;
    }
  }
  /**
   * Toggle opened state on the slotted tooltip.
   * @param {boolean} opened
   */
  setOpened(opened) {
    this.opened = opened;
    const tooltipNode = this.node;
    if (tooltipNode) {
      tooltipNode.opened = opened;
    }
  }
  /**
   * Set default position for the slotted tooltip.
   * This can be overridden by setting the position
   * using corresponding property or attribute.
   * @param {string} position
   */
  setPosition(position) {
    this.position = position;
    const tooltipNode = this.node;
    if (tooltipNode) {
      tooltipNode._position = position;
    }
  }
  /**
   * Set function used to detect whether to show
   * the tooltip based on a condition.
   * @param {Function} shouldShow
   */
  setShouldShow(shouldShow) {
    this.shouldShow = shouldShow;
    const tooltipNode = this.node;
    if (tooltipNode) {
      tooltipNode.shouldShow = shouldShow;
    }
  }
  /**
   * Set an HTML element to attach the tooltip to.
   * @param {HTMLElement} target
   */
  setTarget(target) {
    this.target = target;
    const tooltipNode = this.node;
    if (tooltipNode) {
      tooltipNode.target = target;
    }
  }
  /** @private */
  __notifyChange() {
    this.dispatchEvent(new CustomEvent("tooltip-changed", { detail: { node: this.node } }));
  }
};

// node_modules/@vaadin/a11y-base/src/focus-mixin.js
var FocusMixin = dedupeMixin(
  (superclass) => class FocusMixinClass extends superclass {
    /**
     * @protected
     * @return {boolean}
     */
    get _keyboardActive() {
      return isKeyboardActive();
    }
    /** @protected */
    ready() {
      this.addEventListener("focusin", (e4) => {
        if (this._shouldSetFocus(e4)) {
          this._setFocused(true);
        }
      });
      this.addEventListener("focusout", (e4) => {
        if (this._shouldRemoveFocus(e4)) {
          this._setFocused(false);
        }
      });
      super.ready();
    }
    /** @protected */
    disconnectedCallback() {
      super.disconnectedCallback();
      if (this.hasAttribute("focused")) {
        this._setFocused(false);
      }
    }
    /**
     * Override to change how focused and focus-ring attributes are set.
     *
     * @param {boolean} focused
     * @protected
     */
    _setFocused(focused) {
      this.toggleAttribute("focused", focused);
      this.toggleAttribute("focus-ring", focused && this._keyboardActive);
    }
    /**
     * Override to define if the field receives focus based on the event.
     *
     * @param {FocusEvent} _event
     * @return {boolean}
     * @protected
     */
    _shouldSetFocus(_event) {
      return true;
    }
    /**
     * Override to define if the field loses focus based on the event.
     *
     * @param {FocusEvent} _event
     * @return {boolean}
     * @protected
     */
    _shouldRemoveFocus(_event) {
      return true;
    }
  }
);

// node_modules/@vaadin/a11y-base/src/disabled-mixin.js
var DisabledMixin = dedupeMixin(
  (superclass) => class DisabledMixinClass extends superclass {
    static get properties() {
      return {
        /**
         * If true, the user cannot interact with this element.
         */
        disabled: {
          type: Boolean,
          value: false,
          observer: "_disabledChanged",
          reflectToAttribute: true,
          sync: true
        }
      };
    }
    /**
     * @param {boolean} disabled
     * @protected
     */
    _disabledChanged(disabled) {
      this._setAriaDisabled(disabled);
    }
    /**
     * @param {boolean} disabled
     * @protected
     */
    _setAriaDisabled(disabled) {
      if (disabled) {
        this.setAttribute("aria-disabled", "true");
      } else {
        this.removeAttribute("aria-disabled");
      }
    }
    /**
     * Overrides the default element `click` method in order to prevent
     * firing the `click` event when the element is disabled.
     * @protected
     * @override
     */
    click() {
      if (!this.disabled) {
        super.click();
      }
    }
  }
);

// node_modules/@vaadin/a11y-base/src/tabindex-mixin.js
var TabindexMixin = (superclass) => class TabindexMixinClass extends DisabledMixin(superclass) {
  static get properties() {
    return {
      /**
       * Indicates whether the element can be focused and where it participates in sequential keyboard navigation.
       *
       * @protected
       */
      tabindex: {
        type: Number,
        reflectToAttribute: true,
        observer: "_tabindexChanged",
        sync: true
      },
      /**
       * Stores the last known tabindex since the element has been disabled.
       *
       * @protected
       */
      _lastTabIndex: {
        type: Number
      }
    };
  }
  /**
   * When the element gets disabled, the observer saves the last known tabindex
   * and makes the element not focusable by setting tabindex to -1.
   * As soon as the element gets enabled, the observer restores the last known tabindex
   * so that the element can be focusable again.
   *
   * @protected
   * @override
   */
  _disabledChanged(disabled, oldDisabled) {
    super._disabledChanged(disabled, oldDisabled);
    if (this.__shouldAllowFocusWhenDisabled()) {
      return;
    }
    if (disabled) {
      if (this.tabindex !== void 0) {
        this._lastTabIndex = this.tabindex;
      }
      this.setAttribute("tabindex", "-1");
    } else if (oldDisabled) {
      if (this._lastTabIndex !== void 0) {
        this.setAttribute("tabindex", this._lastTabIndex);
      } else {
        this.tabindex = void 0;
      }
    }
  }
  /**
   * When the user has changed tabindex while the element is disabled,
   * the observer reverts tabindex to -1 and rather saves the new tabindex value to apply it later.
   * The new value will be applied as soon as the element becomes enabled.
   *
   * @protected
   */
  _tabindexChanged(tabindex) {
    if (this.__shouldAllowFocusWhenDisabled()) {
      return;
    }
    if (this.disabled && tabindex !== -1) {
      this._lastTabIndex = tabindex;
      this.setAttribute("tabindex", "-1");
    }
  }
  /**
   * Overrides the native `focus` method in order to prevent
   * focusing the element when it is disabled. Note, setting
   * `tabindex` to -1 does not prevent the element from being
   * programmatically focusable.
   *
   * @protected
   * @override
   */
  focus() {
    if (!this.disabled || this.__shouldAllowFocusWhenDisabled()) {
      super.focus();
    }
  }
  /**
   * Returns whether the component should be focusable when disabled.
   * Returns false by default.
   *
   * @private
   * @return {boolean}
   */
  __shouldAllowFocusWhenDisabled() {
    return false;
  }
};

// node_modules/@vaadin/a11y-base/src/delegate-focus-mixin.js
var DelegateFocusMixin = dedupeMixin(
  (superclass) => class DelegateFocusMixinClass extends FocusMixin(TabindexMixin(superclass)) {
    static get properties() {
      return {
        /**
         * Specify that this control should have input focus when the page loads.
         */
        autofocus: {
          type: Boolean
        },
        /**
         * A reference to the focusable element controlled by the mixin.
         * It can be an input, textarea, button or any element with tabindex > -1.
         *
         * Any component implementing this mixin is expected to provide it
         * by using `this._setFocusElement(input)` Polymer API.
         *
         * Toggling `tabindex` attribute on the host element propagates its value to `focusElement`.
         *
         * @protected
         * @type {!HTMLElement}
         */
        focusElement: {
          type: Object,
          readOnly: true,
          observer: "_focusElementChanged",
          sync: true
        },
        /**
         * Override the property from `TabIndexMixin`
         * to ensure the `tabindex` attribute of the focus element
         * will be restored to `0` after re-enabling the element.
         *
         * @protected
         * @override
         */
        _lastTabIndex: {
          value: 0
        }
      };
    }
    constructor() {
      super();
      this._boundOnBlur = this._onBlur.bind(this);
      this._boundOnFocus = this._onFocus.bind(this);
    }
    /** @protected */
    ready() {
      super.ready();
      if (this.autofocus && !this.disabled) {
        requestAnimationFrame(() => {
          this.focus();
          this.setAttribute("focus-ring", "");
        });
      }
    }
    /**
     * @protected
     * @override
     */
    focus() {
      if (this.focusElement && !this.disabled) {
        this.focusElement.focus();
      }
    }
    /**
     * @protected
     * @override
     */
    blur() {
      if (this.focusElement) {
        this.focusElement.blur();
      }
    }
    /**
     * @protected
     * @override
     */
    click() {
      if (this.focusElement && !this.disabled) {
        this.focusElement.click();
      }
    }
    /** @protected */
    _focusElementChanged(element, oldElement) {
      if (element) {
        element.disabled = this.disabled;
        this._addFocusListeners(element);
        this.__forwardTabIndex(this.tabindex);
      } else if (oldElement) {
        this._removeFocusListeners(oldElement);
      }
    }
    /**
     * @param {HTMLElement} element
     * @protected
     */
    _addFocusListeners(element) {
      element.addEventListener("blur", this._boundOnBlur);
      element.addEventListener("focus", this._boundOnFocus);
    }
    /**
     * @param {HTMLElement} element
     * @protected
     */
    _removeFocusListeners(element) {
      element.removeEventListener("blur", this._boundOnBlur);
      element.removeEventListener("focus", this._boundOnFocus);
    }
    /**
     * Focus event does not bubble, so we dispatch it manually
     * on the host element to support adding focus listeners
     * when the focusable element is placed in light DOM.
     * @param {FocusEvent} event
     * @protected
     */
    _onFocus(event) {
      event.stopPropagation();
      this.dispatchEvent(new Event("focus"));
    }
    /**
     * Blur event does not bubble, so we dispatch it manually
     * on the host element to support adding blur listeners
     * when the focusable element is placed in light DOM.
     * @param {FocusEvent} event
     * @protected
     */
    _onBlur(event) {
      event.stopPropagation();
      this.dispatchEvent(new Event("blur"));
    }
    /**
     * @param {FocusEvent} event
     * @return {boolean}
     * @protected
     * @override
     */
    _shouldSetFocus(event) {
      return event.target === this.focusElement;
    }
    /**
     * @param {FocusEvent} event
     * @return {boolean}
     * @protected
     * @override
     */
    _shouldRemoveFocus(event) {
      return event.target === this.focusElement;
    }
    /**
     * @param {boolean} disabled
     * @param {boolean} oldDisabled
     * @protected
     * @override
     */
    _disabledChanged(disabled, oldDisabled) {
      super._disabledChanged(disabled, oldDisabled);
      if (this.focusElement) {
        this.focusElement.disabled = disabled;
      }
      if (disabled) {
        this.blur();
      }
    }
    /**
     * Override an observer from `TabindexMixin`.
     * Do not call super to remove tabindex attribute
     * from the host after it has been forwarded.
     * @param {string} tabindex
     * @protected
     * @override
     */
    _tabindexChanged(tabindex) {
      this.__forwardTabIndex(tabindex);
    }
    /** @private */
    __forwardTabIndex(tabindex) {
      if (tabindex !== void 0 && this.focusElement) {
        this.focusElement.tabIndex = tabindex;
        if (tabindex !== -1) {
          this.tabindex = void 0;
        }
      }
      if (this.disabled && tabindex) {
        if (tabindex !== -1) {
          this._lastTabIndex = tabindex;
        }
        this.tabindex = void 0;
      }
      if (tabindex === void 0 && this.hasAttribute("tabindex")) {
        this.removeAttribute("tabindex");
      }
    }
  }
);

// node_modules/@vaadin/a11y-base/src/keyboard-mixin.js
var KeyboardMixin = dedupeMixin(
  (superclass) => class KeyboardMixinClass extends superclass {
    /** @protected */
    ready() {
      super.ready();
      this.addEventListener("keydown", (event) => {
        this._onKeyDown(event);
      });
      this.addEventListener("keyup", (event) => {
        this._onKeyUp(event);
      });
    }
    /**
     * A handler for the `keydown` event. By default, it calls
     * separate methods for handling "Enter" and "Escape" keys.
     * Override the method to implement your own behavior.
     *
     * @param {KeyboardEvent} event
     * @protected
     */
    _onKeyDown(event) {
      switch (event.key) {
        case "Enter":
          this._onEnter(event);
          break;
        case "Escape":
          this._onEscape(event);
          break;
        default:
          break;
      }
    }
    /**
     * A handler for the `keyup` event. By default, it does nothing.
     * Override the method to implement your own behavior.
     *
     * @param {KeyboardEvent} _event
     * @protected
     */
    _onKeyUp(_event) {
    }
    /**
     * A handler for the "Enter" key. By default, it does nothing.
     * Override the method to implement your own behavior.
     *
     * @param {KeyboardEvent} _event
     * @protected
     */
    _onEnter(_event) {
    }
    /**
     * A handler for the "Escape" key. By default, it does nothing.
     * Override the method to implement your own behavior.
     *
     * @param {KeyboardEvent} _event
     * @protected
     */
    _onEscape(_event) {
    }
  }
);

// node_modules/@vaadin/component-base/src/slot-styles-mixin.js
var stylesMap = /* @__PURE__ */ new WeakMap();
function getRootStyles(root2) {
  if (!stylesMap.has(root2)) {
    stylesMap.set(root2, /* @__PURE__ */ new Set());
  }
  return stylesMap.get(root2);
}
function insertStyles(styles, root2) {
  const style2 = document.createElement("style");
  style2.textContent = styles;
  if (root2 === document) {
    document.head.appendChild(style2);
  } else {
    root2.insertBefore(style2, root2.firstChild);
  }
}
var SlotStylesMixin = dedupeMixin(
  (superclass) => class SlotStylesMixinClass extends superclass {
    /**
     * List of styles to insert into root.
     * @protected
     */
    get slotStyles() {
      return [];
    }
    /** @protected */
    connectedCallback() {
      super.connectedCallback();
      this.__applySlotStyles();
    }
    /** @private */
    __applySlotStyles() {
      const root2 = this.getRootNode();
      const rootStyles = getRootStyles(root2);
      this.slotStyles.forEach((styles) => {
        if (!rootStyles.has(styles)) {
          insertStyles(styles, root2);
          rootStyles.add(styles);
        }
      });
    }
  }
);

// node_modules/@vaadin/field-base/src/input-mixin.js
var InputMixin = dedupeMixin(
  (superclass) => class InputMixinClass extends superclass {
    static get properties() {
      return {
        /**
         * A reference to the input element controlled by the mixin.
         * Any component implementing this mixin is expected to provide it
         * by using `this._setInputElement(input)` Polymer API.
         *
         * A typical case is using `InputController` that does this automatically.
         * However, the input element does not have to always be native <input>:
         * as an example, <vaadin-combo-box-light> accepts other components.
         *
         * @protected
         * @type {!HTMLElement}
         */
        inputElement: {
          type: Object,
          readOnly: true,
          observer: "_inputElementChanged",
          sync: true
        },
        /**
         * String used to define input type.
         * @protected
         */
        type: {
          type: String,
          readOnly: true
        },
        /**
         * The value of the field.
         */
        value: {
          type: String,
          value: "",
          observer: "_valueChanged",
          notify: true,
          sync: true
        }
      };
    }
    constructor() {
      super();
      this._boundOnInput = this._onInput.bind(this);
      this._boundOnChange = this._onChange.bind(this);
    }
    /**
     * Indicates whether the value is different from the default one.
     * Override if the `value` property has a type other than `string`.
     *
     * @protected
     */
    get _hasValue() {
      return this.value != null && this.value !== "";
    }
    /**
     * A property for accessing the input element's value.
     *
     * Override this getter if the property is different from the default `value` one.
     *
     * @protected
     * @return {string}
     */
    get _inputElementValueProperty() {
      return "value";
    }
    /**
     * The input element's value.
     *
     * @protected
     * @return {string}
     */
    get _inputElementValue() {
      return this.inputElement ? this.inputElement[this._inputElementValueProperty] : void 0;
    }
    /**
     * The input element's value.
     *
     * @protected
     */
    set _inputElementValue(value) {
      if (this.inputElement) {
        this.inputElement[this._inputElementValueProperty] = value;
      }
    }
    /**
     * Clear the value of the field.
     */
    clear() {
      this.value = "";
      this._inputElementValue = "";
    }
    /**
     * Add event listeners to the input element instance.
     * Override this method to add custom listeners.
     * @param {!HTMLElement} input
     * @protected
     */
    _addInputListeners(input) {
      input.addEventListener("input", this._boundOnInput);
      input.addEventListener("change", this._boundOnChange);
    }
    /**
     * Remove event listeners from the input element instance.
     * @param {!HTMLElement} input
     * @protected
     */
    _removeInputListeners(input) {
      input.removeEventListener("input", this._boundOnInput);
      input.removeEventListener("change", this._boundOnChange);
    }
    /**
     * A method to forward the value property set on the field
     * programmatically back to the input element value.
     * Override this method to perform additional checks,
     * for example to skip this in certain conditions.
     * @param {string} value
     * @protected
     */
    _forwardInputValue(value) {
      if (!this.inputElement) {
        return;
      }
      this._inputElementValue = value != null ? value : "";
    }
    /**
     * @param {HTMLElement | undefined} input
     * @param {HTMLElement | undefined} oldInput
     * @protected
     */
    _inputElementChanged(input, oldInput) {
      if (input) {
        this._addInputListeners(input);
      } else if (oldInput) {
        this._removeInputListeners(oldInput);
      }
    }
    /**
     * An input event listener used to update the field value.
     *
     * @param {Event} event
     * @protected
     */
    _onInput(event) {
      const target = event.composedPath()[0];
      this.__userInput = event.isTrusted;
      this.value = target.value;
      this.__userInput = false;
    }
    /**
     * A change event listener.
     * Override this method with an actual implementation.
     * @param {Event} _event
     * @protected
     */
    _onChange(_event) {
    }
    /**
     * Toggle the has-value attribute based on the value property.
     *
     * @param {boolean} hasValue
     * @protected
     */
    _toggleHasValue(hasValue) {
      this.toggleAttribute("has-value", hasValue);
    }
    /**
     * Observer called when a value property changes.
     * @param {string | undefined} newVal
     * @param {string | undefined} oldVal
     * @protected
     */
    _valueChanged(newVal, oldVal) {
      this._toggleHasValue(this._hasValue);
      if (newVal === "" && oldVal === void 0) {
        return;
      }
      if (this.__userInput) {
        return;
      }
      this._forwardInputValue(newVal);
    }
  }
);

// node_modules/@vaadin/field-base/src/clear-button-mixin.js
var ClearButtonMixin = (superclass) => class ClearButtonMixinClass extends InputMixin(KeyboardMixin(superclass)) {
  static get properties() {
    return {
      /**
       * Set to true to display the clear icon which clears the input.
       *
       * It is up to the component to choose where to place the clear icon:
       * in the Shadow DOM or in the light DOM. In any way, a reference to
       * the clear icon element should be provided via the `clearElement` getter.
       *
       * @attr {boolean} clear-button-visible
       */
      clearButtonVisible: {
        type: Boolean,
        reflectToAttribute: true,
        value: false
      }
    };
  }
  /**
   * Any element extending this mixin is required to implement this getter.
   * It returns the reference to the clear button element.
   *
   * @protected
   * @return {Element | null | undefined}
   */
  get clearElement() {
    console.warn(`Please implement the 'clearElement' property in <${this.localName}>`);
    return null;
  }
  /** @protected */
  ready() {
    super.ready();
    if (this.clearElement) {
      this.clearElement.addEventListener("mousedown", (event) => this._onClearButtonMouseDown(event));
      this.clearElement.addEventListener("click", (event) => this._onClearButtonClick(event));
    }
  }
  /**
   * @param {Event} event
   * @protected
   */
  _onClearButtonClick(event) {
    event.preventDefault();
    this._onClearAction();
  }
  /**
   * @param {MouseEvent} event
   * @protected
   */
  _onClearButtonMouseDown(event) {
    event.preventDefault();
    if (!isTouch) {
      this.inputElement.focus();
    }
  }
  /**
   * Override an event listener inherited from `KeydownMixin` to clear on Esc.
   * Components that extend this mixin can prevent this behavior by overriding
   * this method without calling `super._onEscape` to provide custom logic.
   *
   * @param {KeyboardEvent} event
   * @protected
   * @override
   */
  _onEscape(event) {
    super._onEscape(event);
    if (this.clearButtonVisible && !!this.value && !this.readonly) {
      event.stopPropagation();
      this._onClearAction();
    }
  }
  /**
   * Clears the value and dispatches `input` and `change` events
   * on the input element. This method should be called
   * when the clear action originates from the user.
   *
   * @protected
   */
  _onClearAction() {
    this._inputElementValue = "";
    this.inputElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.inputElement.dispatchEvent(new Event("change", { bubbles: true }));
  }
};

// node_modules/@vaadin/a11y-base/src/aria-id-reference.js
var attributeToTargets = /* @__PURE__ */ new Map();
function getAttrMap(attr) {
  if (!attributeToTargets.has(attr)) {
    attributeToTargets.set(attr, /* @__PURE__ */ new WeakMap());
  }
  return attributeToTargets.get(attr);
}
function cleanAriaIDReference(target, attr) {
  if (!target) {
    return;
  }
  target.removeAttribute(attr);
}
function storeAriaIDReference(target, attr) {
  if (!target || !attr) {
    return;
  }
  const attributeMap = getAttrMap(attr);
  if (attributeMap.has(target)) {
    return;
  }
  const values = deserializeAttributeValue(target.getAttribute(attr));
  attributeMap.set(target, new Set(values));
}
function restoreGeneratedAriaIDReference(target, attr) {
  if (!target || !attr) {
    return;
  }
  const attributeMap = getAttrMap(attr);
  const values = attributeMap.get(target);
  if (!values || values.size === 0) {
    target.removeAttribute(attr);
  } else {
    addValueToAttribute(target, attr, serializeAttributeValue(values));
  }
  attributeMap.delete(target);
}
function setAriaIDReference(target, attr, config = { newId: null, oldId: null, fromUser: false }) {
  if (!target || !attr) {
    return;
  }
  const { newId, oldId, fromUser } = config;
  const attributeMap = getAttrMap(attr);
  const storedValues = attributeMap.get(target);
  if (!fromUser && !!storedValues) {
    oldId && storedValues.delete(oldId);
    newId && storedValues.add(newId);
    return;
  }
  if (fromUser) {
    if (!storedValues) {
      storeAriaIDReference(target, attr);
    } else if (!newId) {
      attributeMap.delete(target);
    }
    cleanAriaIDReference(target, attr);
  }
  removeValueFromAttribute(target, attr, oldId);
  const attributeValue = !newId ? serializeAttributeValue(storedValues) : newId;
  if (attributeValue) {
    addValueToAttribute(target, attr, attributeValue);
  }
}
function removeAriaIDReference(target, attr) {
  storeAriaIDReference(target, attr);
  cleanAriaIDReference(target, attr);
}

// node_modules/@vaadin/a11y-base/src/field-aria-controller.js
var FieldAriaController = class {
  constructor(host) {
    this.host = host;
    this.__required = false;
  }
  /**
   * Sets a target element to which ARIA attributes are added.
   *
   * @param {HTMLElement} target
   */
  setTarget(target) {
    this.__target = target;
    this.__setAriaRequiredAttribute(this.__required);
    this.__setLabelIdToAriaAttribute(this.__labelId, this.__labelId);
    if (this.__labelIdFromUser != null) {
      this.__setLabelIdToAriaAttribute(this.__labelIdFromUser, this.__labelIdFromUser, true);
    }
    this.__setErrorIdToAriaAttribute(this.__errorId);
    this.__setHelperIdToAriaAttribute(this.__helperId);
    this.setAriaLabel(this.__label);
  }
  /**
   * Toggles the `aria-required` attribute on the target element
   * if the target is the host component (e.g. a field group).
   * Otherwise, it does nothing.
   *
   * @param {boolean} required
   */
  setRequired(required) {
    this.__setAriaRequiredAttribute(required);
    this.__required = required;
  }
  /**
   * Defines the `aria-label` attribute of the target element.
   *
   * To remove the attribute, pass `null` as `label`.
   *
   * @param {string | null | undefined} label
   */
  setAriaLabel(label) {
    this.__setAriaLabelToAttribute(label);
    this.__label = label;
  }
  /**
   * Links the target element with a slotted label element
   * via the target's attribute `aria-labelledby`.
   *
   * To unlink the previous slotted label element, pass `null` as `labelId`.
   *
   * @param {string | null} labelId
   */
  setLabelId(labelId, fromUser = false) {
    const oldLabelId = fromUser ? this.__labelIdFromUser : this.__labelId;
    this.__setLabelIdToAriaAttribute(labelId, oldLabelId, fromUser);
    if (fromUser) {
      this.__labelIdFromUser = labelId;
    } else {
      this.__labelId = labelId;
    }
  }
  /**
   * Links the target element with a slotted error element via the target's attribute:
   * - `aria-labelledby` if the target is the host component (e.g a field group).
   * - `aria-describedby` otherwise.
   *
   * To unlink the previous slotted error element, pass `null` as `errorId`.
   *
   * @param {string | null} errorId
   */
  setErrorId(errorId) {
    this.__setErrorIdToAriaAttribute(errorId, this.__errorId);
    this.__errorId = errorId;
  }
  /**
   * Links the target element with a slotted helper element via the target's attribute:
   * - `aria-labelledby` if the target is the host component (e.g a field group).
   * - `aria-describedby` otherwise.
   *
   * To unlink the previous slotted helper element, pass `null` as `helperId`.
   *
   * @param {string | null} helperId
   */
  setHelperId(helperId) {
    this.__setHelperIdToAriaAttribute(helperId, this.__helperId);
    this.__helperId = helperId;
  }
  /**
   * @param {string | null | undefined} label
   * @private
   * */
  __setAriaLabelToAttribute(label) {
    if (!this.__target) {
      return;
    }
    if (label) {
      removeAriaIDReference(this.__target, "aria-labelledby");
      this.__target.setAttribute("aria-label", label);
    } else if (this.__label) {
      restoreGeneratedAriaIDReference(this.__target, "aria-labelledby");
      this.__target.removeAttribute("aria-label");
    }
  }
  /**
   * @param {string | null | undefined} labelId
   * @param {string | null | undefined} oldLabelId
   * @param {boolean | null | undefined} fromUser
   * @private
   */
  __setLabelIdToAriaAttribute(labelId, oldLabelId, fromUser) {
    setAriaIDReference(this.__target, "aria-labelledby", { newId: labelId, oldId: oldLabelId, fromUser });
  }
  /**
   * @param {string | null | undefined} errorId
   * @param {string | null | undefined} oldErrorId
   * @private
   */
  __setErrorIdToAriaAttribute(errorId, oldErrorId) {
    setAriaIDReference(this.__target, "aria-describedby", { newId: errorId, oldId: oldErrorId, fromUser: false });
  }
  /**
   * @param {string | null | undefined} helperId
   * @param {string | null | undefined} oldHelperId
   * @private
   */
  __setHelperIdToAriaAttribute(helperId, oldHelperId) {
    setAriaIDReference(this.__target, "aria-describedby", { newId: helperId, oldId: oldHelperId, fromUser: false });
  }
  /**
   * @param {boolean} required
   * @private
   */
  __setAriaRequiredAttribute(required) {
    if (!this.__target) {
      return;
    }
    if (["input", "textarea"].includes(this.__target.localName)) {
      return;
    }
    if (required) {
      this.__target.setAttribute("aria-required", "true");
    } else {
      this.__target.removeAttribute("aria-required");
    }
  }
};

// node_modules/@vaadin/a11y-base/src/announce.js
var region = document.createElement("div");
region.style.position = "fixed";
region.style.clip = "rect(0px, 0px, 0px, 0px)";
region.setAttribute("aria-live", "polite");
document.body.appendChild(region);
var alertDebouncer;
function announce(text, options = {}) {
  const mode = options.mode || "polite";
  const timeout = options.timeout === void 0 ? 150 : options.timeout;
  if (mode === "alert") {
    region.removeAttribute("aria-live");
    region.removeAttribute("role");
    alertDebouncer = Debouncer.debounce(alertDebouncer, animationFrame, () => {
      region.setAttribute("role", "alert");
    });
  } else {
    if (alertDebouncer) {
      alertDebouncer.cancel();
    }
    region.removeAttribute("role");
    region.setAttribute("aria-live", mode);
  }
  region.textContent = "";
  setTimeout(() => {
    region.textContent = text;
  }, timeout);
}

// node_modules/@vaadin/component-base/src/slot-child-observe-controller.js
var SlotChildObserveController = class extends SlotController {
  constructor(host, slot, tagName, config = {}) {
    super(host, slot, tagName, { ...config, useUniqueId: true });
  }
  /**
   * Override to initialize the newly added custom node.
   *
   * @param {Node} node
   * @protected
   * @override
   */
  initCustomNode(node) {
    this.__updateNodeId(node);
    this.__notifyChange(node);
  }
  /**
   * Override to notify the controller host about removal of
   * the custom node, and to apply the default one if needed.
   *
   * @param {Node} _node
   * @protected
   * @override
   */
  teardownNode(_node) {
    const node = this.getSlotChild();
    if (node && node !== this.defaultNode) {
      this.__notifyChange(node);
    } else {
      this.restoreDefaultNode();
      this.updateDefaultNode(this.node);
    }
  }
  /**
   * Override method inherited from `SlotMixin`
   * to set ID attribute on the default node.
   *
   * @return {Node}
   * @protected
   * @override
   */
  attachDefaultNode() {
    const node = super.attachDefaultNode();
    if (node) {
      this.__updateNodeId(node);
    }
    return node;
  }
  /**
   * Override to restore default node when a custom one is removed.
   *
   * @protected
   */
  restoreDefaultNode() {
  }
  /**
   * Override to update default node text on property change.
   *
   * @param {Node} node
   * @protected
   */
  updateDefaultNode(node) {
    this.__notifyChange(node);
  }
  /**
   * Setup the mutation observer on the node to update ID and notify host.
   * Node doesn't get observed automatically until this method is called.
   *
   * @param {Node} node
   * @protected
   */
  observeNode(node) {
    if (this.__nodeObserver) {
      this.__nodeObserver.disconnect();
    }
    this.__nodeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const target = mutation.target;
        const isCurrentNodeMutation = target === this.node;
        if (mutation.type === "attributes") {
          if (isCurrentNodeMutation) {
            this.__updateNodeId(target);
          }
        } else if (isCurrentNodeMutation || target.parentElement === this.node) {
          this.__notifyChange(this.node);
        }
      });
    });
    this.__nodeObserver.observe(node, {
      attributes: true,
      attributeFilter: ["id"],
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  /**
   * Returns true if a node is an HTML element with children,
   * or is a defined custom element, or has non-empty text.
   *
   * @param {Node} node
   * @return {boolean}
   * @private
   */
  __hasContent(node) {
    if (!node) {
      return false;
    }
    return node.nodeType === Node.ELEMENT_NODE && (customElements.get(node.localName) || node.children.length > 0) || node.textContent && node.textContent.trim() !== "";
  }
  /**
   * Fire an event to notify the controller host about node changes.
   *
   * @param {Node} node
   * @private
   */
  __notifyChange(node) {
    this.dispatchEvent(
      new CustomEvent("slot-content-changed", {
        detail: { hasContent: this.__hasContent(node), node }
      })
    );
  }
  /**
   * Set default ID on the node in case it is an HTML element.
   *
   * @param {Node} node
   * @private
   */
  __updateNodeId(node) {
    const isFirstNode = !this.nodes || node === this.nodes[0];
    if (node.nodeType === Node.ELEMENT_NODE && (!this.multiple || isFirstNode) && !node.id) {
      node.id = this.defaultId;
    }
  }
};

// node_modules/@vaadin/field-base/src/error-controller.js
var ErrorController = class extends SlotChildObserveController {
  constructor(host) {
    super(host, "error-message", "div");
  }
  /**
   * Set the error message element text content.
   *
   * @param {string} errorMessage
   */
  setErrorMessage(errorMessage) {
    this.errorMessage = errorMessage;
    this.updateDefaultNode(this.node);
  }
  /**
   * Set invalid state for detecting whether to show error message.
   *
   * @param {boolean} invalid
   */
  setInvalid(invalid) {
    this.invalid = invalid;
    this.updateDefaultNode(this.node);
  }
  /**
   * Override method inherited from `SlotController` to not run
   * initializer on the custom slotted node unnecessarily.
   *
   * @param {Node} node
   * @protected
   * @override
   */
  initAddedNode(node) {
    if (node !== this.defaultNode) {
      this.initCustomNode(node);
    }
  }
  /**
   * Override to initialize the newly added default error message.
   *
   * @param {Node} errorNode
   * @protected
   * @override
   */
  initNode(errorNode) {
    this.updateDefaultNode(errorNode);
  }
  /**
   * Override to initialize the newly added custom error message.
   *
   * @param {Node} errorNode
   * @protected
   * @override
   */
  initCustomNode(errorNode) {
    if (errorNode.textContent && !this.errorMessage) {
      this.errorMessage = errorNode.textContent.trim();
    }
    super.initCustomNode(errorNode);
  }
  /**
   * Override method inherited from `SlotChildObserveController`
   * to restore the default error message element.
   *
   * @protected
   * @override
   */
  restoreDefaultNode() {
    this.attachDefaultNode();
  }
  /**
   * Override method inherited from `SlotChildObserveController`
   * to update the error message text and hidden state.
   *
   * Note: unlike with other controllers, this method is
   * called for both default and custom error message.
   *
   * @param {Node | undefined} node
   * @protected
   * @override
   */
  updateDefaultNode(errorNode) {
    const { errorMessage, invalid } = this;
    const hasError = Boolean(invalid && errorMessage && errorMessage.trim() !== "");
    if (errorNode) {
      errorNode.textContent = hasError ? errorMessage : "";
      errorNode.hidden = !hasError;
      if (hasError) {
        announce(errorMessage, { mode: "assertive" });
      }
    }
    super.updateDefaultNode(errorNode);
  }
};

// node_modules/@vaadin/field-base/src/helper-controller.js
var HelperController = class extends SlotChildObserveController {
  constructor(host) {
    super(host, "helper", null);
  }
  /**
   * Set helper text based on corresponding host property.
   *
   * @param {string} helperText
   */
  setHelperText(helperText) {
    this.helperText = helperText;
    const helperNode = this.getSlotChild();
    if (!helperNode) {
      this.restoreDefaultNode();
    }
    if (this.node === this.defaultNode) {
      this.updateDefaultNode(this.node);
    }
  }
  /**
   * Override method inherited from `SlotChildObserveController`
   * to create the default helper element lazily as needed.
   *
   * @param {Node | undefined} node
   * @protected
   * @override
   */
  restoreDefaultNode() {
    const { helperText } = this;
    if (helperText && helperText.trim() !== "") {
      this.tagName = "div";
      const helperNode = this.attachDefaultNode();
      this.observeNode(helperNode);
    }
  }
  /**
   * Override method inherited from `SlotChildObserveController`
   * to update the default helper element text content.
   *
   * @param {Node | undefined} node
   * @protected
   * @override
   */
  updateDefaultNode(node) {
    if (node) {
      node.textContent = this.helperText;
    }
    super.updateDefaultNode(node);
  }
  /**
   * Override to observe the newly added custom node.
   *
   * @param {Node} node
   * @protected
   * @override
   */
  initCustomNode(node) {
    super.initCustomNode(node);
    this.observeNode(node);
  }
};

// node_modules/@vaadin/field-base/src/label-controller.js
var LabelController = class extends SlotChildObserveController {
  constructor(host) {
    super(host, "label", "label");
  }
  /**
   * Set label based on corresponding host property.
   *
   * @param {string} label
   */
  setLabel(label) {
    this.label = label;
    const labelNode = this.getSlotChild();
    if (!labelNode) {
      this.restoreDefaultNode();
    }
    if (this.node === this.defaultNode) {
      this.updateDefaultNode(this.node);
    }
  }
  /**
   * Override method inherited from `SlotChildObserveController`
   * to restore and observe the default label element.
   *
   * @protected
   * @override
   */
  restoreDefaultNode() {
    const { label } = this;
    if (label && label.trim() !== "") {
      const labelNode = this.attachDefaultNode();
      this.observeNode(labelNode);
    }
  }
  /**
   * Override method inherited from `SlotChildObserveController`
   * to update the default label element text content.
   *
   * @param {Node | undefined} node
   * @protected
   * @override
   */
  updateDefaultNode(node) {
    if (node) {
      node.textContent = this.label;
    }
    super.updateDefaultNode(node);
  }
  /**
   * Override to observe the newly added custom node.
   *
   * @param {Node} node
   * @protected
   * @override
   */
  initCustomNode(node) {
    super.initCustomNode(node);
    this.observeNode(node);
  }
};

// node_modules/@vaadin/field-base/src/label-mixin.js
var LabelMixin = dedupeMixin(
  (superclass) => class LabelMixinClass extends ControllerMixin(superclass) {
    static get properties() {
      return {
        /**
         * The label text for the input node.
         * When no light dom defined via [slot=label], this value will be used.
         */
        label: {
          type: String,
          observer: "_labelChanged"
        }
      };
    }
    constructor() {
      super();
      this._labelController = new LabelController(this);
      this._labelController.addEventListener("slot-content-changed", (event) => {
        this.toggleAttribute("has-label", event.detail.hasContent);
      });
    }
    /** @protected */
    get _labelId() {
      const node = this._labelNode;
      return node && node.id;
    }
    /** @protected */
    get _labelNode() {
      return this._labelController.node;
    }
    /** @protected */
    ready() {
      super.ready();
      this.addController(this._labelController);
    }
    /** @protected */
    _labelChanged(label) {
      this._labelController.setLabel(label);
    }
  }
);

// node_modules/@vaadin/field-base/src/validate-mixin.js
var ValidateMixin = dedupeMixin(
  (superclass) => class ValidateMixinClass extends superclass {
    static get properties() {
      return {
        /**
         * Set to true when the field is invalid.
         */
        invalid: {
          type: Boolean,
          reflectToAttribute: true,
          notify: true,
          value: false,
          sync: true
        },
        /**
         * Set to true to enable manual validation mode. This mode disables automatic
         * constraint validation, allowing you to control the validation process yourself.
         * You can still trigger constraint validation manually with the `validate()` method
         * or use `checkValidity()` to assess the component's validity without affecting
         * the invalid state. In manual validation mode, you can also manipulate
         * the `invalid` property directly through your application logic without conflicts
         * with the component's internal validation.
         *
         * @attr {boolean} manual-validation
         */
        manualValidation: {
          type: Boolean,
          value: false
        },
        /**
         * Specifies that the user must fill in a value.
         */
        required: {
          type: Boolean,
          reflectToAttribute: true,
          sync: true
        }
      };
    }
    /**
     * Validates the field and sets the `invalid` property based on the result.
     *
     * The method fires a `validated` event with the result of the validation.
     *
     * @return {boolean} True if the value is valid.
     */
    validate() {
      const isValid = this.checkValidity();
      this._setInvalid(!isValid);
      this.dispatchEvent(new CustomEvent("validated", { detail: { valid: isValid } }));
      return isValid;
    }
    /**
     * Returns true if the field value satisfies all constraints (if any).
     *
     * @return {boolean}
     */
    checkValidity() {
      return !this.required || !!this.value;
    }
    /**
     * @param {boolean} invalid
     * @protected
     */
    _setInvalid(invalid) {
      if (this._shouldSetInvalid(invalid)) {
        this.invalid = invalid;
      }
    }
    /**
     * Override this method to define whether the given `invalid` state should be set.
     *
     * @param {boolean} _invalid
     * @return {boolean}
     * @protected
     */
    _shouldSetInvalid(_invalid) {
      return true;
    }
    /** @protected */
    _requestValidation() {
      if (!this.manualValidation) {
        this.validate();
      }
    }
    /**
     * Fired whenever the field is validated.
     *
     * @event validated
     * @param {Object} detail
     * @param {boolean} detail.valid the result of the validation.
     */
  }
);

// node_modules/@vaadin/field-base/src/field-mixin.js
var FieldMixin = (superclass) => class FieldMixinClass extends ValidateMixin(LabelMixin(ControllerMixin(superclass))) {
  static get properties() {
    return {
      /**
       * A target element to which ARIA attributes are set.
       * @protected
       */
      ariaTarget: {
        type: Object,
        observer: "_ariaTargetChanged"
      },
      /**
       * Error to show when the field is invalid.
       *
       * @attr {string} error-message
       */
      errorMessage: {
        type: String,
        observer: "_errorMessageChanged"
      },
      /**
       * String used for the helper text.
       * @attr {string} helper-text
       */
      helperText: {
        type: String,
        observer: "_helperTextChanged"
      },
      /**
       * String used to label the component to screen reader users.
       * @attr {string} accessible-name
       */
      accessibleName: {
        type: String,
        observer: "_accessibleNameChanged"
      },
      /**
       * Id of the element used as label of the component to screen reader users.
       * @attr {string} accessible-name-ref
       */
      accessibleNameRef: {
        type: String,
        observer: "_accessibleNameRefChanged"
      }
    };
  }
  static get observers() {
    return ["_invalidChanged(invalid)", "_requiredChanged(required)"];
  }
  constructor() {
    super();
    this._fieldAriaController = new FieldAriaController(this);
    this._helperController = new HelperController(this);
    this._errorController = new ErrorController(this);
    this._errorController.addEventListener("slot-content-changed", (event) => {
      this.toggleAttribute("has-error-message", event.detail.hasContent);
    });
    this._labelController.addEventListener("slot-content-changed", (event) => {
      const { hasContent, node } = event.detail;
      this.__labelChanged(hasContent, node);
    });
    this._helperController.addEventListener("slot-content-changed", (event) => {
      const { hasContent, node } = event.detail;
      this.toggleAttribute("has-helper", hasContent);
      this.__helperChanged(hasContent, node);
    });
  }
  /**
   * @protected
   * @return {HTMLElement}
   */
  get _errorNode() {
    return this._errorController.node;
  }
  /**
   * @protected
   * @return {HTMLElement}
   */
  get _helperNode() {
    return this._helperController.node;
  }
  /** @protected */
  ready() {
    super.ready();
    this.addController(this._fieldAriaController);
    this.addController(this._helperController);
    this.addController(this._errorController);
  }
  /** @private */
  __helperChanged(hasHelper, helperNode) {
    if (hasHelper) {
      this._fieldAriaController.setHelperId(helperNode.id);
    } else {
      this._fieldAriaController.setHelperId(null);
    }
  }
  /** @protected */
  _accessibleNameChanged(accessibleName) {
    this._fieldAriaController.setAriaLabel(accessibleName);
  }
  /** @protected */
  _accessibleNameRefChanged(accessibleNameRef) {
    this._fieldAriaController.setLabelId(accessibleNameRef, true);
  }
  /** @private */
  __labelChanged(hasLabel, labelNode) {
    if (hasLabel) {
      this._fieldAriaController.setLabelId(labelNode.id);
    } else {
      this._fieldAriaController.setLabelId(null);
    }
  }
  /**
   * @param {string | null | undefined} errorMessage
   * @protected
   */
  _errorMessageChanged(errorMessage) {
    this._errorController.setErrorMessage(errorMessage);
  }
  /**
   * @param {string} helperText
   * @protected
   */
  _helperTextChanged(helperText) {
    this._helperController.setHelperText(helperText);
  }
  /**
   * @param {HTMLElement | null | undefined} target
   * @protected
   */
  _ariaTargetChanged(target) {
    if (target) {
      this._fieldAriaController.setTarget(target);
    }
  }
  /**
   * @param {boolean} required
   * @protected
   */
  _requiredChanged(required) {
    this._fieldAriaController.setRequired(required);
  }
  /**
   * @param {boolean} invalid
   * @protected
   */
  _invalidChanged(invalid) {
    this._errorController.setInvalid(invalid);
    setTimeout(() => {
      if (invalid) {
        const node = this._errorNode;
        this._fieldAriaController.setErrorId(node && node.id);
      } else {
        this._fieldAriaController.setErrorId(null);
      }
    });
  }
};

// node_modules/@vaadin/component-base/src/delegate-state-mixin.js
var DelegateStateMixin = dedupeMixin(
  (superclass) => class DelegateStateMixinClass extends superclass {
    static get properties() {
      return {
        /**
         * A target element to which attributes and properties are delegated.
         * @protected
         */
        stateTarget: {
          type: Object,
          observer: "_stateTargetChanged"
        }
      };
    }
    /**
     * An array of the host attributes to delegate to the target element.
     */
    static get delegateAttrs() {
      return [];
    }
    /**
     * An array of the host properties to delegate to the target element.
     */
    static get delegateProps() {
      return [];
    }
    /** @protected */
    ready() {
      super.ready();
      this._createDelegateAttrsObserver();
      this._createDelegatePropsObserver();
    }
    /** @protected */
    _stateTargetChanged(target) {
      if (target) {
        this._ensureAttrsDelegated();
        this._ensurePropsDelegated();
      }
    }
    /** @protected */
    _createDelegateAttrsObserver() {
      this._createMethodObserver(`_delegateAttrsChanged(${this.constructor.delegateAttrs.join(", ")})`);
    }
    /** @protected */
    _createDelegatePropsObserver() {
      this._createMethodObserver(`_delegatePropsChanged(${this.constructor.delegateProps.join(", ")})`);
    }
    /** @protected */
    _ensureAttrsDelegated() {
      this.constructor.delegateAttrs.forEach((name) => {
        this._delegateAttribute(name, this[name]);
      });
    }
    /** @protected */
    _ensurePropsDelegated() {
      this.constructor.delegateProps.forEach((name) => {
        this._delegateProperty(name, this[name]);
      });
    }
    /** @protected */
    _delegateAttrsChanged(...values) {
      this.constructor.delegateAttrs.forEach((name, index) => {
        this._delegateAttribute(name, values[index]);
      });
    }
    /** @protected */
    _delegatePropsChanged(...values) {
      this.constructor.delegateProps.forEach((name, index) => {
        this._delegateProperty(name, values[index]);
      });
    }
    /** @protected */
    _delegateAttribute(name, value) {
      if (!this.stateTarget) {
        return;
      }
      if (name === "invalid") {
        this._delegateAttribute("aria-invalid", value ? "true" : false);
      }
      if (typeof value === "boolean") {
        this.stateTarget.toggleAttribute(name, value);
      } else if (value) {
        this.stateTarget.setAttribute(name, value);
      } else {
        this.stateTarget.removeAttribute(name);
      }
    }
    /** @protected */
    _delegateProperty(name, value) {
      if (!this.stateTarget) {
        return;
      }
      this.stateTarget[name] = value;
    }
  }
);

// node_modules/@vaadin/field-base/src/input-constraints-mixin.js
var InputConstraintsMixin = dedupeMixin(
  (superclass) => class InputConstraintsMixinClass extends DelegateStateMixin(ValidateMixin(InputMixin(superclass))) {
    /**
     * An array of attributes which participate in the input validation.
     * Changing these attributes will cause the input to re-validate.
     *
     * IMPORTANT: The attributes should be properly delegated to the input element
     * from the host using `delegateAttrs` getter (see `DelegateStateMixin`).
     * The `required` attribute is already delegated.
     */
    static get constraints() {
      return ["required"];
    }
    static get delegateAttrs() {
      return [...super.delegateAttrs, "required"];
    }
    /** @protected */
    ready() {
      super.ready();
      this._createConstraintsObserver();
    }
    /**
     * Returns true if the current input value satisfies all constraints (if any).
     * @return {boolean}
     */
    checkValidity() {
      if (this.inputElement && this._hasValidConstraints(this.constructor.constraints.map((c4) => this[c4]))) {
        return this.inputElement.checkValidity();
      }
      return !this.invalid;
    }
    /**
     * Returns true if some of the provided set of constraints are valid.
     * @param {Array} constraints
     * @return {boolean}
     * @protected
     */
    _hasValidConstraints(constraints) {
      return constraints.some((c4) => this.__isValidConstraint(c4));
    }
    /**
     * Override this method to customize setting up constraints observer.
     * @protected
     */
    _createConstraintsObserver() {
      this._createMethodObserver(`_constraintsChanged(stateTarget, ${this.constructor.constraints.join(", ")})`);
    }
    /**
     * Override this method to implement custom validation constraints.
     * @param {HTMLElement | undefined} stateTarget
     * @param {unknown[]} constraints
     * @protected
     */
    _constraintsChanged(stateTarget, ...constraints) {
      if (!stateTarget) {
        return;
      }
      const hasConstraints = this._hasValidConstraints(constraints);
      const isLastConstraintRemoved = this.__previousHasConstraints && !hasConstraints;
      if ((this._hasValue || this.invalid) && hasConstraints) {
        this._requestValidation();
      } else if (isLastConstraintRemoved && !this.manualValidation) {
        this._setInvalid(false);
      }
      this.__previousHasConstraints = hasConstraints;
    }
    /**
     * Override an event listener inherited from `InputMixin`
     * to capture native `change` event and make sure that
     * a new one is dispatched after validation runs.
     * @param {Event} event
     * @protected
     * @override
     */
    _onChange(event) {
      event.stopPropagation();
      this._requestValidation();
      this.dispatchEvent(
        new CustomEvent("change", {
          detail: {
            sourceEvent: event
          },
          bubbles: event.bubbles,
          cancelable: event.cancelable
        })
      );
    }
    /** @private */
    __isValidConstraint(constraint) {
      return Boolean(constraint) || constraint === 0;
    }
  }
);

// node_modules/@vaadin/field-base/src/input-control-mixin.js
var InputControlMixin = (superclass) => class InputControlMixinClass extends SlotStylesMixin(
  DelegateFocusMixin(InputConstraintsMixin(FieldMixin(ClearButtonMixin(KeyboardMixin(superclass)))))
) {
  static get properties() {
    return {
      /**
       * A pattern matched against individual characters the user inputs.
       *
       * When set, the field will prevent:
       * - `keydown` events if the entered key doesn't match `/^allowedCharPattern$/`
       * - `paste` events if the pasted text doesn't match `/^allowedCharPattern*$/`
       * - `drop` events if the dropped text doesn't match `/^allowedCharPattern*$/`
       *
       * For example, to allow entering only numbers and minus signs, use:
       * `allowedCharPattern = "[\\d-]"`
       * @attr {string} allowed-char-pattern
       */
      allowedCharPattern: {
        type: String,
        observer: "_allowedCharPatternChanged"
      },
      /**
       * If true, the input text gets fully selected when the field is focused using click or touch / tap.
       */
      autoselect: {
        type: Boolean,
        value: false
      },
      /**
       * The name of this field.
       */
      name: {
        type: String,
        reflectToAttribute: true
      },
      /**
       * A hint to the user of what can be entered in the field.
       */
      placeholder: {
        type: String,
        reflectToAttribute: true
      },
      /**
       * When present, it specifies that the field is read-only.
       */
      readonly: {
        type: Boolean,
        value: false,
        reflectToAttribute: true
      },
      /**
       * The text usually displayed in a tooltip popup when the mouse is over the field.
       */
      title: {
        type: String,
        reflectToAttribute: true
      }
    };
  }
  static get delegateAttrs() {
    return [...super.delegateAttrs, "name", "type", "placeholder", "readonly", "invalid", "title"];
  }
  constructor() {
    super();
    this._boundOnPaste = this._onPaste.bind(this);
    this._boundOnDrop = this._onDrop.bind(this);
    this._boundOnBeforeInput = this._onBeforeInput.bind(this);
  }
  /** @protected */
  get slotStyles() {
    return [
      `
          :is(input[slot='input'], textarea[slot='textarea'])::placeholder {
            font: inherit;
            color: inherit;
          }
        `
    ];
  }
  /**
   * Override an event listener from `DelegateFocusMixin`.
   * @param {FocusEvent} event
   * @protected
   * @override
   */
  _onFocus(event) {
    super._onFocus(event);
    if (this.autoselect && this.inputElement) {
      this.inputElement.select();
    }
  }
  /**
   * Override a method from `InputMixin`.
   * @param {!HTMLElement} input
   * @protected
   * @override
   */
  _addInputListeners(input) {
    super._addInputListeners(input);
    input.addEventListener("paste", this._boundOnPaste);
    input.addEventListener("drop", this._boundOnDrop);
    input.addEventListener("beforeinput", this._boundOnBeforeInput);
  }
  /**
   * Override a method from `InputMixin`.
   * @param {!HTMLElement} input
   * @protected
   * @override
   */
  _removeInputListeners(input) {
    super._removeInputListeners(input);
    input.removeEventListener("paste", this._boundOnPaste);
    input.removeEventListener("drop", this._boundOnDrop);
    input.removeEventListener("beforeinput", this._boundOnBeforeInput);
  }
  /**
   * Override an event listener from `KeyboardMixin`.
   * @param {!KeyboardEvent} event
   * @protected
   * @override
   */
  _onKeyDown(event) {
    super._onKeyDown(event);
    if (this.allowedCharPattern && !this.__shouldAcceptKey(event) && event.target === this.inputElement) {
      event.preventDefault();
      this._markInputPrevented();
    }
  }
  /** @protected */
  _markInputPrevented() {
    this.setAttribute("input-prevented", "");
    this._preventInputDebouncer = Debouncer.debounce(this._preventInputDebouncer, timeOut.after(200), () => {
      this.removeAttribute("input-prevented");
    });
  }
  /** @private */
  __shouldAcceptKey(event) {
    return event.metaKey || event.ctrlKey || !event.key || // Allow typing anything if event.key is not supported
    event.key.length !== 1 || // Allow "Backspace", "ArrowLeft" etc.
    this.__allowedCharRegExp.test(event.key);
  }
  /** @private */
  _onPaste(e4) {
    if (this.allowedCharPattern) {
      const pastedText = e4.clipboardData.getData("text");
      if (!this.__allowedTextRegExp.test(pastedText)) {
        e4.preventDefault();
        this._markInputPrevented();
      }
    }
  }
  /** @private */
  _onDrop(e4) {
    if (this.allowedCharPattern) {
      const draggedText = e4.dataTransfer.getData("text");
      if (!this.__allowedTextRegExp.test(draggedText)) {
        e4.preventDefault();
        this._markInputPrevented();
      }
    }
  }
  /** @private */
  _onBeforeInput(e4) {
    if (this.allowedCharPattern && e4.data && !this.__allowedTextRegExp.test(e4.data)) {
      e4.preventDefault();
      this._markInputPrevented();
    }
  }
  /** @private */
  _allowedCharPatternChanged(charPattern) {
    if (charPattern) {
      try {
        this.__allowedCharRegExp = new RegExp(`^${charPattern}$`, "u");
        this.__allowedTextRegExp = new RegExp(`^${charPattern}*$`, "u");
      } catch (e4) {
        console.error(e4);
      }
    }
  }
  /**
   * Fired when the user commits a value change.
   *
   * @event change
   */
  /**
   * Fired when the value is changed by the user: on every typing keystroke,
   * and the value is cleared using the clear button.
   *
   * @event input
   */
};

// node_modules/@vaadin/field-base/src/input-controller.js
var InputController = class extends SlotController {
  constructor(host, callback, options = {}) {
    const { uniqueIdPrefix } = options;
    super(host, "input", "input", {
      initializer: (node, host2) => {
        if (host2.value) {
          node.value = host2.value;
        }
        if (host2.type) {
          node.setAttribute("type", host2.type);
        }
        node.id = this.defaultId;
        if (typeof callback === "function") {
          callback(node);
        }
      },
      useUniqueId: true,
      uniqueIdPrefix
    });
  }
};

// node_modules/@vaadin/field-base/src/labelled-input-controller.js
var LabelledInputController = class {
  constructor(input, labelController) {
    this.input = input;
    this.__preventDuplicateLabelClick = this.__preventDuplicateLabelClick.bind(this);
    labelController.addEventListener("slot-content-changed", (event) => {
      this.__initLabel(event.detail.node);
    });
    this.__initLabel(labelController.node);
  }
  /**
   * @param {HTMLElement} label
   * @private
   */
  __initLabel(label) {
    if (label) {
      label.addEventListener("click", this.__preventDuplicateLabelClick);
      if (this.input) {
        label.setAttribute("for", this.input.id);
      }
    }
  }
  /**
   * The native platform fires an event for both the click on the label, and also
   * the subsequent click on the native input element caused by label click.
   * This results in two click events arriving at the host, but we only want one.
   * This method prevents the duplicate click and ensures the correct isTrusted event
   * with the correct event.target arrives at the host.
   * @private
   */
  __preventDuplicateLabelClick() {
    const inputClickHandler = (e4) => {
      e4.stopImmediatePropagation();
      this.input.removeEventListener("click", inputClickHandler);
    };
    this.input.addEventListener("click", inputClickHandler);
  }
};

// node_modules/@vaadin/field-base/src/pattern-mixin.js
var PatternMixin = (superclass) => class PatternMixinClass extends InputConstraintsMixin(superclass) {
  static get properties() {
    return {
      /**
       * A regular expression that the value is checked against.
       * The pattern must match the entire value, not just some subset.
       */
      pattern: {
        type: String
      }
    };
  }
  static get delegateAttrs() {
    return [...super.delegateAttrs, "pattern"];
  }
  static get constraints() {
    return [...super.constraints, "pattern"];
  }
};

// node_modules/@vaadin/field-base/src/styles/button-core-styles.js
var button = i`
  [part='clear-button'] {
    display: none;
    cursor: default;
  }

  [part='clear-button']::before {
    content: '\\2715';
  }

  :host([clear-button-visible][has-value]:not([disabled]):not([readonly])) [part='clear-button'] {
    display: block;
  }
`;

// node_modules/@vaadin/field-base/src/styles/container-core-styles.js
var container = i`
  [class$='container'] {
    display: flex;
    flex-direction: column;
    min-width: 100%;
    max-width: 100%;
    width: var(--vaadin-field-default-width, 12em);
  }
`;

// node_modules/@vaadin/field-base/src/styles/field-core-styles.js
var field = i`
  :host {
    display: inline-flex;
    outline: none;
  }

  :host::before {
    content: '\\2003';
    width: 0;
    display: inline-block;
    /* Size and position this element on the same vertical position as the input-field element
          to make vertical align for the host element work as expected */
  }

  :host([hidden]) {
    display: none !important;
  }

  :host(:not([has-label])) [part='label'] {
    display: none;
  }

  @media (forced-colors: active) {
    :host(:not([readonly])) [part='input-field'] {
      outline: 1px solid;
      outline-offset: -1px;
    }
    :host([focused]) [part='input-field'] {
      outline-width: 2px;
    }
    :host([disabled]) [part='input-field'] {
      outline-color: GrayText;
    }
  }
`;

// node_modules/@vaadin/field-base/src/styles/input-field-shared-styles.js
var inputFieldShared2 = [field, container, button];

// node_modules/@vaadin/component-base/src/data-provider-controller/helpers.js
function getFlatIndexContext(cache, flatIndex, level = 0) {
  let levelIndex = flatIndex;
  for (const subCache of cache.subCaches) {
    const index = subCache.parentCacheIndex;
    if (levelIndex <= index) {
      break;
    } else if (levelIndex <= index + subCache.flatSize) {
      return getFlatIndexContext(subCache, levelIndex - index - 1, level + 1);
    }
    levelIndex -= subCache.flatSize;
  }
  return {
    cache,
    item: cache.items[levelIndex],
    index: levelIndex,
    page: Math.floor(levelIndex / cache.pageSize),
    level
  };
}
function getItemContext({ getItemId }, cache, targetItem, level = 0, levelFlatIndex = 0) {
  for (let index = 0; index < cache.items.length; index++) {
    const item2 = cache.items[index];
    if (!!item2 && getItemId(item2) === getItemId(targetItem)) {
      return {
        cache,
        level,
        item: item2,
        index,
        page: Math.floor(index / cache.pageSize),
        subCache: cache.getSubCache(index),
        flatIndex: levelFlatIndex + cache.getFlatIndex(index)
      };
    }
  }
  for (const subCache of cache.subCaches) {
    const parentItemFlatIndex = levelFlatIndex + cache.getFlatIndex(subCache.parentCacheIndex);
    const result = getItemContext({ getItemId }, subCache, targetItem, level + 1, parentItemFlatIndex + 1);
    if (result) {
      return result;
    }
  }
}
function getFlatIndexByPath(cache, [levelIndex, ...subIndexes], flatIndex = 0) {
  if (levelIndex === Infinity) {
    levelIndex = cache.size - 1;
  }
  const flatIndexOnLevel = cache.getFlatIndex(levelIndex);
  const subCache = cache.getSubCache(levelIndex);
  if (subCache && subCache.flatSize > 0 && subIndexes.length) {
    return getFlatIndexByPath(subCache, subIndexes, flatIndex + flatIndexOnLevel + 1);
  }
  return flatIndex + flatIndexOnLevel;
}

// node_modules/@vaadin/component-base/src/data-provider-controller/cache.js
var Cache = class _Cache {
  /**
   * A context object.
   *
   * @type {{ isExpanded: (item: unknown) => boolean }}
   */
  context;
  /**
   * The number of items to display per page.
   *
   * @type {number}
   */
  pageSize;
  /**
   * An array of cached items.
   *
   * @type {object[]}
   */
  items = [];
  /**
   * A map where the key is a requested page and the value is a callback
   * that will be called with data once the request is complete.
   *
   * @type {Record<number, Function>}
   */
  pendingRequests = {};
  /**
   * A map where the key is the index of an item in the `items` array
   * and the value is a sub-cache associated with that item.
   *
   * Note, it's intentionally defined as an object instead of a Map
   * to ensure that Object.entries() returns an array with keys sorted
   * in alphabetical order, rather than the order they were added.
   *
   * @type {Record<number, Cache>}
   * @private
   */
  __subCacheByIndex = {};
  /**
   * The number of items.
   *
   * @type {number}
   * @private
   */
  __size = 0;
  /**
   * The total number of items, including items from expanded sub-caches.
   *
   * @type {number}
   * @private
   */
  __flatSize = 0;
  /**
   * @param {Cache['context']} context
   * @param {number} pageSize
   * @param {number | undefined} size
   * @param {Cache | undefined} parentCache
   * @param {number | undefined} parentCacheIndex
   */
  constructor(context, pageSize, size, parentCache, parentCacheIndex) {
    this.context = context;
    this.pageSize = pageSize;
    this.size = size;
    this.parentCache = parentCache;
    this.parentCacheIndex = parentCacheIndex;
    this.__flatSize = size || 0;
  }
  /**
   * An item in the parent cache that the current cache is associated with.
   *
   * @return {object | undefined}
   */
  get parentItem() {
    return this.parentCache && this.parentCache.items[this.parentCacheIndex];
  }
  /**
   * An array of sub-caches sorted in the same order as their associated items
   * appear in the `items` array.
   *
   * @return {Cache[]}
   */
  get subCaches() {
    return Object.values(this.__subCacheByIndex);
  }
  /**
   * Whether the cache or any of its descendant caches have pending requests.
   *
   * @return {boolean}
   */
  get isLoading() {
    if (Object.keys(this.pendingRequests).length > 0) {
      return true;
    }
    return this.subCaches.some((subCache) => subCache.isLoading);
  }
  /**
   * The total number of items, including items from expanded sub-caches.
   *
   * @return {number}
   */
  get flatSize() {
    return this.__flatSize;
  }
  /**
   * The total number of items, including items from expanded sub-caches.
   *
   * @protected
   * @deprecated since 24.3 and will be removed in Vaadin 25.
   */
  get effectiveSize() {
    console.warn(
      "<vaadin-grid> The `effectiveSize` property of ItemCache is deprecated and will be removed in Vaadin 25."
    );
    return this.flatSize;
  }
  /**
   * The number of items.
   *
   * @return {number}
   */
  get size() {
    return this.__size;
  }
  /**
   * Sets the number of items.
   *
   * @param {number} size
   */
  set size(size) {
    const oldSize = this.__size;
    if (oldSize === size) {
      return;
    }
    this.__size = size;
    if (this.context.placeholder !== void 0) {
      this.items.length = size || 0;
      for (let i5 = 0; i5 < size || 0; i5++) {
        this.items[i5] ||= this.context.placeholder;
      }
    }
    Object.keys(this.pendingRequests).forEach((page) => {
      const startIndex = parseInt(page) * this.pageSize;
      if (startIndex >= this.size || 0) {
        delete this.pendingRequests[page];
      }
    });
  }
  /**
   * Recalculates the flattened size for the cache and its descendant caches recursively.
   */
  recalculateFlatSize() {
    this.__flatSize = !this.parentItem || this.context.isExpanded(this.parentItem) ? this.size + this.subCaches.reduce((total, subCache) => {
      subCache.recalculateFlatSize();
      return total + subCache.flatSize;
    }, 0) : 0;
  }
  /**
   * Adds an array of items corresponding to the given page
   * to the `items` array.
   *
   * @param {number} page
   * @param {object[]} items
   */
  setPage(page, items) {
    const startIndex = page * this.pageSize;
    items.forEach((item2, i5) => {
      const itemIndex = startIndex + i5;
      if (this.size === void 0 || itemIndex < this.size) {
        this.items[itemIndex] = item2;
      }
    });
  }
  /**
   * Retrieves the sub-cache associated with the item at the given index
   * in the `items` array.
   *
   * @param {number} index
   * @return {Cache | undefined}
   */
  getSubCache(index) {
    return this.__subCacheByIndex[index];
  }
  /**
   * Removes the sub-cache associated with the item at the given index
   * in the `items` array.
   *
   * @param {number} index
   */
  removeSubCache(index) {
    delete this.__subCacheByIndex[index];
  }
  /**
   * Removes all sub-caches.
   */
  removeSubCaches() {
    this.__subCacheByIndex = {};
  }
  /**
   * Creates and associates a sub-cache for the item at the given index
   * in the `items` array.
   *
   * @param {number} index
   * @return {Cache}
   */
  createSubCache(index) {
    const subCache = new _Cache(this.context, this.pageSize, 0, this, index);
    this.__subCacheByIndex[index] = subCache;
    return subCache;
  }
  /**
   * Retrieves the flattened index corresponding to the given index
   * of an item in the `items` array.
   *
   * @param {number} index
   * @return {number}
   */
  getFlatIndex(index) {
    const clampedIndex = Math.max(0, Math.min(this.size - 1, index));
    return this.subCaches.reduce((prev, subCache) => {
      const index2 = subCache.parentCacheIndex;
      return clampedIndex > index2 ? prev + subCache.flatSize : prev;
    }, clampedIndex);
  }
  /**
   * @deprecated since 24.3 and will be removed in Vaadin 25.
   */
  getItemForIndex(index) {
    console.warn(
      "<vaadin-grid> The `getItemForIndex` method of ItemCache is deprecated and will be removed in Vaadin 25."
    );
    const { item: item2 } = getFlatIndexContext(this, index);
    return item2;
  }
  /**
   * @deprecated since 24.3 and will be removed in Vaadin 25.
   */
  getCacheAndIndex(index) {
    console.warn(
      "<vaadin-grid> The `getCacheAndIndex` method of ItemCache is deprecated and will be removed in Vaadin 25."
    );
    const { cache, index: scaledIndex } = getFlatIndexContext(this, index);
    return { cache, scaledIndex };
  }
  /**
   * @deprecated since 24.3 and will be removed in Vaadin 25.
   */
  updateSize() {
    console.warn("<vaadin-grid> The `updateSize` method of ItemCache is deprecated and will be removed in Vaadin 25.");
    this.recalculateFlatSize();
  }
  /**
   * @deprecated since 24.3 and will be removed in Vaadin 25.
   */
  ensureSubCacheForScaledIndex(scaledIndex) {
    console.warn(
      "<vaadin-grid> The `ensureSubCacheForScaledIndex` method of ItemCache is deprecated and will be removed in Vaadin 25."
    );
    if (!this.getSubCache(scaledIndex)) {
      const subCache = this.createSubCache(scaledIndex);
      this.context.__controller.__loadCachePage(subCache, 0);
    }
  }
  /**
   * @deprecated since 24.3 and will be removed in Vaadin 25.
   */
  get grid() {
    console.warn("<vaadin-grid> The `grid` property of ItemCache is deprecated and will be removed in Vaadin 25.");
    return this.context.__controller.host;
  }
  /**
   * @deprecated since 24.3 and will be removed in Vaadin 25.
   */
  get itemCaches() {
    console.warn(
      "<vaadin-grid> The `itemCaches` property of ItemCache is deprecated and will be removed in Vaadin 25."
    );
    return this.__subCacheByIndex;
  }
};

// node_modules/@vaadin/component-base/src/data-provider-controller/data-provider-controller.js
var DataProviderController = class extends EventTarget {
  /**
   * The controller host element.
   *
   * @param {HTMLElement}
   */
  host;
  /**
   * A callback that returns data based on the passed params such as
   * `page`, `pageSize`, `parentItem`, etc.
   */
  dataProvider;
  /**
   * A callback that returns additional params that need to be passed
   * to the data provider callback with every request.
   */
  dataProviderParams;
  /**
   * A number of items to display per page.
   *
   * @type {number}
   */
  pageSize;
  /**
   * A callback that returns whether the given item is expanded.
   *
   * @type {(item: unknown) => boolean}
   */
  isExpanded;
  /**
   * A callback that returns the id for the given item and that
   * is used when checking object items for equality.
   *
   * @type { (item: unknown) => unknown}
   */
  getItemId;
  /**
   * A reference to the root cache instance.
   *
   * @param {Cache}
   */
  rootCache;
  /**
   * A placeholder item that is used to indicate that the item is not loaded yet.
   *
   * @type {unknown}
   */
  placeholder;
  /**
   * A callback that returns whether the given item is a placeholder.
   *
   * @type {(item: unknown) => boolean}
   */
  isPlaceholder;
  constructor(host, { size, pageSize, isExpanded, getItemId, isPlaceholder, placeholder, dataProvider, dataProviderParams }) {
    super();
    this.host = host;
    this.pageSize = pageSize;
    this.getItemId = getItemId;
    this.isExpanded = isExpanded;
    this.placeholder = placeholder;
    this.isPlaceholder = isPlaceholder;
    this.dataProvider = dataProvider;
    this.dataProviderParams = dataProviderParams;
    this.rootCache = this.__createRootCache(size);
  }
  /**
   * The total number of items, including items from expanded sub-caches.
   */
  get flatSize() {
    return this.rootCache.flatSize;
  }
  /** @private */
  get __cacheContext() {
    return {
      isExpanded: this.isExpanded,
      placeholder: this.placeholder,
      // The controller instance is needed to ensure deprecated cache methods work.
      __controller: this
    };
  }
  /**
   * Whether the root cache or any of its decendant caches have pending requests.
   *
   * @return {boolean}
   */
  isLoading() {
    return this.rootCache.isLoading;
  }
  /**
   * Sets the page size and clears the cache.
   *
   * @param {number} pageSize
   */
  setPageSize(pageSize) {
    this.pageSize = pageSize;
    this.clearCache();
  }
  /**
   * Sets the data provider callback and clears the cache.
   *
   * @type {Function}
   */
  setDataProvider(dataProvider) {
    this.dataProvider = dataProvider;
    this.clearCache();
  }
  /**
   * Recalculates the flattened size.
   */
  recalculateFlatSize() {
    this.rootCache.recalculateFlatSize();
  }
  /**
   * Clears the cache.
   */
  clearCache() {
    this.rootCache = this.__createRootCache(this.rootCache.size);
  }
  /**
   * Returns context for the given flattened index, including:
   * - the corresponding cache
   * - the cache level
   * - the corresponding item (if loaded)
   * - the item's index in the cache's items array
   * - the page containing the item
   *
   * @param {number} flatIndex
   */
  getFlatIndexContext(flatIndex) {
    return getFlatIndexContext(this.rootCache, flatIndex);
  }
  /**
   * Returns context for the given item, including:
   * - the cache containing the item
   * - the cache level
   * - the item
   * - the item's index in the cache's items array
   * - the item's flattened index
   * - the item's sub-cache (if exists)
   * - the page containing the item
   *
   * If the item isn't found, the method returns undefined.
   */
  getItemContext(item2) {
    return getItemContext({ getItemId: this.getItemId }, this.rootCache, item2);
  }
  /**
   * Returns the flattened index for the item that the given indexes point to.
   * Each index in the path array points to a sub-item of the previous index.
   * Using `Infinity` as an index will point to the last item on the level.
   *
   * @param {number[]} path
   * @return {number}
   */
  getFlatIndexByPath(path) {
    return getFlatIndexByPath(this.rootCache, path);
  }
  /**
   * Requests the data provider to load the page with the item corresponding
   * to the given flattened index. If the item is already loaded, the method
   * returns immediatelly.
   *
   * @param {number} flatIndex
   */
  ensureFlatIndexLoaded(flatIndex) {
    const { cache, page, item: item2 } = this.getFlatIndexContext(flatIndex);
    if (!this.__isItemLoaded(item2)) {
      this.__loadCachePage(cache, page);
    }
  }
  /**
   * Creates a sub-cache for the item corresponding to the given flattened index and
   * requests the data provider to load the first page into the created sub-cache.
   * If the sub-cache already exists, the method returns immediatelly.
   *
   * @param {number} flatIndex
   */
  ensureFlatIndexHierarchy(flatIndex) {
    const { cache, item: item2, index } = this.getFlatIndexContext(flatIndex);
    if (this.__isItemLoaded(item2) && this.isExpanded(item2) && !cache.getSubCache(index)) {
      const subCache = cache.createSubCache(index);
      this.__loadCachePage(subCache, 0);
    }
  }
  /**
   * Loads the first page into the root cache.
   */
  loadFirstPage() {
    this.__loadCachePage(this.rootCache, 0);
  }
  /** @private */
  __createRootCache(size) {
    return new Cache(this.__cacheContext, this.pageSize, size);
  }
  /** @private */
  __loadCachePage(cache, page) {
    if (!this.dataProvider || cache.pendingRequests[page]) {
      return;
    }
    let params = {
      page,
      pageSize: this.pageSize,
      parentItem: cache.parentItem
    };
    if (this.dataProviderParams) {
      params = { ...params, ...this.dataProviderParams() };
    }
    const callback = (items, size) => {
      if (cache.pendingRequests[page] !== callback) {
        return;
      }
      if (size !== void 0) {
        cache.size = size;
      } else if (params.parentItem) {
        cache.size = items.length;
      }
      cache.setPage(page, items);
      this.recalculateFlatSize();
      this.dispatchEvent(new CustomEvent("page-received"));
      delete cache.pendingRequests[page];
      this.dispatchEvent(new CustomEvent("page-loaded"));
    };
    cache.pendingRequests[page] = callback;
    this.dispatchEvent(new CustomEvent("page-requested"));
    this.dataProvider(params, callback);
  }
  /** @private */
  __isItemLoaded(item2) {
    if (this.isPlaceholder) {
      return !this.isPlaceholder(item2);
    } else if (this.placeholder) {
      return item2 !== this.placeholder;
    }
    return !!item2;
  }
};

// node_modules/@vaadin/combo-box/src/vaadin-combo-box-data-provider-mixin.js
var ComboBoxDataProviderMixin = (superClass) => class DataProviderMixin extends superClass {
  static get properties() {
    return {
      /**
       * Number of items fetched at a time from the dataprovider.
       * @attr {number} page-size
       * @type {number}
       */
      pageSize: {
        type: Number,
        value: 50,
        observer: "_pageSizeChanged",
        sync: true
      },
      /**
       * Total number of items.
       * @type {number | undefined}
       */
      size: {
        type: Number,
        observer: "_sizeChanged",
        sync: true
      },
      /**
       * Function that provides items lazily. Receives arguments `params`, `callback`
       *
       * `params.page` Requested page index
       *
       * `params.pageSize` Current page size
       *
       * `params.filter` Currently applied filter
       *
       * `callback(items, size)` Callback function with arguments:
       *   - `items` Current page of items
       *   - `size` Total number of items.
       * @type {ComboBoxDataProvider | undefined}
       */
      dataProvider: {
        type: Object,
        observer: "_dataProviderChanged",
        sync: true
      },
      /** @private */
      __dataProviderInitialized: {
        type: Boolean,
        value: false
      },
      /** @private */
      __previousDataProviderFilter: {
        type: String
      }
    };
  }
  static get observers() {
    return [
      "_dataProviderFilterChanged(filter)",
      "_warnDataProviderValue(dataProvider, value)",
      "_ensureFirstPage(opened)"
    ];
  }
  constructor() {
    super();
    this.__dataProviderController = new DataProviderController(this, {
      placeholder: new ComboBoxPlaceholder(),
      isPlaceholder: (item2) => item2 instanceof ComboBoxPlaceholder,
      dataProviderParams: () => ({ filter: this.filter })
    });
    this.__dataProviderController.addEventListener("page-requested", this.__onDataProviderPageRequested.bind(this));
    this.__dataProviderController.addEventListener("page-loaded", this.__onDataProviderPageLoaded.bind(this));
  }
  /** @protected */
  ready() {
    super.ready();
    this._scroller.addEventListener("index-requested", (e4) => {
      if (!this._shouldFetchData()) {
        return;
      }
      const index = e4.detail.index;
      if (index !== void 0) {
        this.__dataProviderController.ensureFlatIndexLoaded(index);
      }
    });
    this.__dataProviderInitialized = true;
    if (this.dataProvider) {
      this.__synchronizeControllerState();
    }
  }
  /** @private */
  _dataProviderFilterChanged(filter) {
    if (this.__previousDataProviderFilter === void 0 && filter === "") {
      this.__previousDataProviderFilter = filter;
      return;
    }
    if (this.__previousDataProviderFilter !== filter) {
      this.__previousDataProviderFilter = filter;
      this.__keepOverlayOpened = true;
      this.size = void 0;
      this.clearCache();
      this.__keepOverlayOpened = false;
    }
  }
  /** @protected */
  _shouldFetchData() {
    if (!this.dataProvider) {
      return false;
    }
    return this.opened || this.filter && this.filter.length;
  }
  /** @private */
  _ensureFirstPage(opened) {
    if (!this._shouldFetchData() || !opened) {
      return;
    }
    if (this._forceNextRequest || this.size === void 0) {
      this._forceNextRequest = false;
      this.__dataProviderController.loadFirstPage();
    } else if (this.size > 0) {
      this.__dataProviderController.ensureFlatIndexLoaded(0);
    }
  }
  /** @private */
  __onDataProviderPageRequested() {
    this.loading = true;
  }
  /** @private */
  __onDataProviderPageLoaded() {
    const { rootCache } = this.__dataProviderController;
    rootCache.items = [...rootCache.items];
    this.__synchronizeControllerState();
    if (!this.opened && !this._isInputFocused()) {
      this._commitValue();
    }
  }
  /**
   * Clears the cached pages and reloads data from dataprovider when needed.
   */
  clearCache() {
    if (!this.dataProvider) {
      return;
    }
    this.__dataProviderController.clearCache();
    this.__synchronizeControllerState();
    if (this._shouldFetchData()) {
      this._forceNextRequest = false;
      this.__dataProviderController.loadFirstPage();
    } else {
      this._forceNextRequest = true;
    }
  }
  /**
   * When the size change originates externally, synchronizes the new size with
   * the controller and request a content update to re-render the scroller.
   *
   * @private
   */
  _sizeChanged(size) {
    const { rootCache } = this.__dataProviderController;
    if (rootCache.size !== size) {
      rootCache.size = size;
      rootCache.items = [...rootCache.items];
      this.__synchronizeControllerState();
    }
  }
  /**
   * When the items change originates externally, synchronizes the new items with
   * the controller and requests a content update to re-render the scroller.
   *
   * @private
   * @override
   */
  _filteredItemsChanged(items) {
    super._filteredItemsChanged(items);
    if (this.dataProvider && items) {
      const { rootCache } = this.__dataProviderController;
      if (rootCache.items !== items) {
        rootCache.items = items;
        this.__synchronizeControllerState();
      }
    }
  }
  /**
   * Synchronizes the controller's state with the component, which can be
   * out of sync after the controller receives new data from the data provider
   * or if the state in the controller is directly manipulated.
   *
   * @private
   */
  __synchronizeControllerState() {
    if (this.__dataProviderInitialized && this.dataProvider) {
      const { rootCache } = this.__dataProviderController;
      this.size = rootCache.size;
      this.filteredItems = rootCache.items;
      this.loading = this.__dataProviderController.isLoading();
    }
  }
  /** @private */
  _pageSizeChanged(pageSize, oldPageSize) {
    if (Math.floor(pageSize) !== pageSize || pageSize < 1) {
      this.pageSize = oldPageSize;
      throw new Error("`pageSize` value must be an integer > 0");
    }
    this.__dataProviderController.setPageSize(pageSize);
    this.clearCache();
  }
  /** @private */
  _dataProviderChanged(dataProvider, oldDataProvider) {
    this._ensureItemsOrDataProvider(() => {
      this.dataProvider = oldDataProvider;
    });
    this.__dataProviderController.setDataProvider(dataProvider);
    this.clearCache();
  }
  /** @private */
  _ensureItemsOrDataProvider(restoreOldValueCallback) {
    if (this.items !== void 0 && this.dataProvider !== void 0) {
      restoreOldValueCallback();
      throw new Error("Using `items` and `dataProvider` together is not supported");
    }
  }
  /** @private */
  _warnDataProviderValue(dataProvider, value) {
    if (dataProvider && value !== "" && (this.selectedItem === void 0 || this.selectedItem === null)) {
      const valueIndex = this.__getItemIndexByValue(this.filteredItems, value);
      if (valueIndex < 0 || !this._getItemLabel(this.filteredItems[valueIndex])) {
        console.warn(
          "Warning: unable to determine the label for the provided `value`. Nothing to display in the text field. This usually happens when setting an initial `value` before any items are returned from the `dataProvider` callback. Consider setting `selectedItem` instead of `value`"
        );
      }
    }
  }
};

// node_modules/@vaadin/component-base/src/overlay-class-mixin.js
var OverlayClassMixin = (superclass) => class OverlayClassMixinClass extends superclass {
  static get properties() {
    return {
      /**
       * A space-delimited list of CSS class names to set on the overlay element.
       * This property does not affect other CSS class names set manually via JS.
       *
       * Note, if the CSS class name was set with this property, clearing it will
       * remove it from the overlay, even if the same class name was also added
       * manually, e.g. by using `classList.add()` in the `renderer` function.
       *
       * @attr {string} overlay-class
       */
      overlayClass: {
        type: String
      },
      /**
       * An overlay element on which CSS class names are set.
       *
       * @protected
       */
      _overlayElement: {
        type: Object
      }
    };
  }
  static get observers() {
    return ["__updateOverlayClassNames(overlayClass, _overlayElement)"];
  }
  /** @private */
  __updateOverlayClassNames(overlayClass, overlayElement) {
    if (!overlayElement) {
      return;
    }
    if (overlayClass === void 0) {
      return;
    }
    const { classList } = overlayElement;
    if (!this.__initialClasses) {
      this.__initialClasses = new Set(classList);
    }
    if (Array.isArray(this.__previousClasses)) {
      const classesToRemove = this.__previousClasses.filter((name) => !this.__initialClasses.has(name));
      if (classesToRemove.length > 0) {
        classList.remove(...classesToRemove);
      }
    }
    const classesToAdd = typeof overlayClass === "string" ? overlayClass.split(" ").filter(Boolean) : [];
    if (classesToAdd.length > 0) {
      classList.add(...classesToAdd);
    }
    this.__previousClasses = classesToAdd;
  }
};

// node_modules/@vaadin/component-base/src/templates.js
function processTemplates(component) {
  if (window.Vaadin && window.Vaadin.templateRendererCallback) {
    window.Vaadin.templateRendererCallback(component);
    return;
  }
  if (component.querySelector("template")) {
    console.warn(
      `WARNING: <template> inside <${component.localName}> is no longer supported. Import @vaadin/polymer-legacy-adapter/template-renderer.js to enable compatibility.`
    );
  }
}

// node_modules/@vaadin/field-base/src/virtual-keyboard-controller.js
var VirtualKeyboardController = class {
  /**
   * @param {{ inputElement?: HTMLElement; opened: boolean } & HTMLElement} host
   */
  constructor(host) {
    this.host = host;
    host.addEventListener("opened-changed", () => {
      if (!host.opened) {
        this.__setVirtualKeyboardEnabled(false);
      }
    });
    host.addEventListener("blur", () => this.__setVirtualKeyboardEnabled(true));
    host.addEventListener("touchstart", () => this.__setVirtualKeyboardEnabled(true));
  }
  /** @private */
  __setVirtualKeyboardEnabled(value) {
    if (this.host.inputElement) {
      this.host.inputElement.inputMode = value ? "" : "none";
    }
  }
};

// node_modules/@vaadin/combo-box/src/vaadin-combo-box-mixin.js
function isValidValue(value) {
  return value !== void 0 && value !== null;
}
function findItemIndex(items, callback) {
  return items.findIndex((item2) => {
    if (item2 instanceof ComboBoxPlaceholder) {
      return false;
    }
    return callback(item2);
  });
}
var ComboBoxMixin = (subclass) => class ComboBoxMixinClass extends OverlayClassMixin(
  ControllerMixin(ValidateMixin(FocusMixin(KeyboardMixin(InputMixin(DisabledMixin(subclass))))))
) {
  static get properties() {
    return {
      /**
       * True if the dropdown is open, false otherwise.
       * @type {boolean}
       */
      opened: {
        type: Boolean,
        notify: true,
        value: false,
        reflectToAttribute: true,
        sync: true,
        observer: "_openedChanged"
      },
      /**
       * Set true to prevent the overlay from opening automatically.
       * @attr {boolean} auto-open-disabled
       */
      autoOpenDisabled: {
        type: Boolean,
        sync: true
      },
      /**
       * When present, it specifies that the field is read-only.
       * @type {boolean}
       */
      readonly: {
        type: Boolean,
        value: false,
        reflectToAttribute: true
      },
      /**
       * Custom function for rendering the content of every item.
       * Receives three arguments:
       *
       * - `root` The `<vaadin-combo-box-item>` internal container DOM element.
       * - `comboBox` The reference to the `<vaadin-combo-box>` element.
       * - `model` The object with the properties related with the rendered
       *   item, contains:
       *   - `model.index` The index of the rendered item.
       *   - `model.item` The item.
       * @type {ComboBoxRenderer | undefined}
       */
      renderer: {
        type: Object,
        sync: true
      },
      /**
       * A full set of items to filter the visible options from.
       * The items can be of either `String` or `Object` type.
       * @type {!Array<!ComboBoxItem | string> | undefined}
       */
      items: {
        type: Array,
        sync: true,
        observer: "_itemsChanged"
      },
      /**
       * If `true`, the user can input a value that is not present in the items list.
       * `value` property will be set to the input value in this case.
       * Also, when `value` is set programmatically, the input value will be set
       * to reflect that value.
       * @attr {boolean} allow-custom-value
       * @type {boolean}
       */
      allowCustomValue: {
        type: Boolean,
        value: false
      },
      /**
       * A subset of items, filtered based on the user input. Filtered items
       * can be assigned directly to omit the internal filtering functionality.
       * The items can be of either `String` or `Object` type.
       * @type {!Array<!ComboBoxItem | string> | undefined}
       */
      filteredItems: {
        type: Array,
        observer: "_filteredItemsChanged",
        sync: true
      },
      /**
       * Used to detect user value changes and fire `change` events.
       * @private
       */
      _lastCommittedValue: String,
      /**
       * When set to `true`, "loading" attribute is added to host and the overlay element.
       * @type {boolean}
       */
      loading: {
        type: Boolean,
        value: false,
        reflectToAttribute: true,
        sync: true
      },
      /**
       * @type {number}
       * @protected
       */
      _focusedIndex: {
        type: Number,
        observer: "_focusedIndexChanged",
        value: -1,
        sync: true
      },
      /**
       * Filtering string the user has typed into the input field.
       * @type {string}
       */
      filter: {
        type: String,
        value: "",
        notify: true,
        sync: true
      },
      /**
       * The selected item from the `items` array.
       * @type {ComboBoxItem | string | undefined}
       */
      selectedItem: {
        type: Object,
        notify: true,
        sync: true
      },
      /**
       * A function used to generate CSS class names for dropdown
       * items based on the item. The return value should be the
       * generated class name as a string, or multiple class names
       * separated by whitespace characters.
       */
      itemClassNameGenerator: {
        type: Object
      },
      /**
       * Path for label of the item. If `items` is an array of objects, the
       * `itemLabelPath` is used to fetch the displayed string label for each
       * item.
       *
       * The item label is also used for matching items when processing user
       * input, i.e., for filtering and selecting items.
       * @attr {string} item-label-path
       * @type {string}
       */
      itemLabelPath: {
        type: String,
        value: "label",
        observer: "_itemLabelPathChanged",
        sync: true
      },
      /**
       * Path for the value of the item. If `items` is an array of objects, the
       * `itemValuePath:` is used to fetch the string value for the selected
       * item.
       *
       * The item value is used in the `value` property of the combo box,
       * to provide the form value.
       * @attr {string} item-value-path
       * @type {string}
       */
      itemValuePath: {
        type: String,
        value: "value",
        sync: true
      },
      /**
       * Path for the id of the item. If `items` is an array of objects,
       * the `itemIdPath` is used to compare and identify the same item
       * in `selectedItem` and `filteredItems` (items given by the
       * `dataProvider` callback).
       * @attr {string} item-id-path
       */
      itemIdPath: {
        type: String,
        sync: true
      },
      /**
       * @type {!HTMLElement | undefined}
       * @protected
       */
      _toggleElement: {
        type: Object,
        observer: "_toggleElementChanged"
      },
      /**
       * Set of items to be rendered in the dropdown.
       * @protected
       */
      _dropdownItems: {
        type: Array,
        sync: true
      },
      /** @private */
      _closeOnBlurIsPrevented: Boolean,
      /** @private */
      _scroller: {
        type: Object,
        sync: true
      },
      /** @private */
      _overlayOpened: {
        type: Boolean,
        sync: true,
        observer: "_overlayOpenedChanged"
      },
      /** @private */
      __keepOverlayOpened: {
        type: Boolean,
        sync: true
      }
    };
  }
  static get observers() {
    return [
      "_selectedItemChanged(selectedItem, itemValuePath, itemLabelPath)",
      "_openedOrItemsChanged(opened, _dropdownItems, loading, __keepOverlayOpened)",
      "_updateScroller(_scroller, _dropdownItems, opened, loading, selectedItem, itemIdPath, _focusedIndex, renderer, _theme, itemClassNameGenerator)"
    ];
  }
  constructor() {
    super();
    this._boundOverlaySelectedItemChanged = this._overlaySelectedItemChanged.bind(this);
    this._boundOnClearButtonMouseDown = this.__onClearButtonMouseDown.bind(this);
    this._boundOnClick = this._onClick.bind(this);
    this._boundOnOverlayTouchAction = this._onOverlayTouchAction.bind(this);
    this._boundOnTouchend = this._onTouchend.bind(this);
  }
  /**
   * Tag name prefix used by scroller and items.
   * @protected
   * @return {string}
   */
  get _tagNamePrefix() {
    return "vaadin-combo-box";
  }
  /**
   * Get a reference to the native `<input>` element.
   * Override to provide a custom input.
   * @protected
   * @return {HTMLInputElement | undefined}
   */
  get _nativeInput() {
    return this.inputElement;
  }
  /**
   * Override method inherited from `InputMixin`
   * to customize the input element.
   * @protected
   * @override
   */
  _inputElementChanged(inputElement) {
    super._inputElementChanged(inputElement);
    const input = this._nativeInput;
    if (input) {
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", !!this.opened);
      input.setAttribute("spellcheck", "false");
      input.setAttribute("autocorrect", "off");
      this._revertInputValueToValue();
      if (this.clearElement) {
        this.clearElement.addEventListener("mousedown", this._boundOnClearButtonMouseDown);
      }
    }
  }
  /** @protected */
  ready() {
    super.ready();
    this._initOverlay();
    this._initScroller();
    this._lastCommittedValue = this.value;
    this.addEventListener("click", this._boundOnClick);
    this.addEventListener("touchend", this._boundOnTouchend);
    const bringToFrontListener = () => {
      requestAnimationFrame(() => {
        this._overlayElement.bringToFront();
      });
    };
    this.addEventListener("mousedown", bringToFrontListener);
    this.addEventListener("touchstart", bringToFrontListener);
    processTemplates(this);
    this.addController(new VirtualKeyboardController(this));
  }
  /** @protected */
  disconnectedCallback() {
    super.disconnectedCallback();
    this.close();
  }
  /**
   * Requests an update for the content of items.
   * While performing the update, it invokes the renderer (passed in the `renderer` property) once an item.
   *
   * It is not guaranteed that the update happens immediately (synchronously) after it is requested.
   */
  requestContentUpdate() {
    if (!this._scroller) {
      return;
    }
    this._scroller.requestContentUpdate();
    this._getItemElements().forEach((item2) => {
      item2.requestContentUpdate();
    });
  }
  /**
   * Opens the dropdown list.
   */
  open() {
    if (!this.disabled && !this.readonly) {
      this.opened = true;
    }
  }
  /**
   * Closes the dropdown list.
   */
  close() {
    this.opened = false;
  }
  /**
   * Override Polymer lifecycle callback to handle `filter` property change after
   * the observer for `opened` property is triggered. This is needed when opening
   * combo-box on user input to ensure the focused index is set correctly.
   *
   * @param {!Object} currentProps Current accessor values
   * @param {?Object} changedProps Properties changed since the last call
   * @param {?Object} oldProps Previous values for each changed property
   * @protected
   * @override
   */
  _propertiesChanged(currentProps, changedProps, oldProps) {
    super._propertiesChanged(currentProps, changedProps, oldProps);
    if (changedProps.filter !== void 0) {
      this._filterChanged(changedProps.filter);
    }
  }
  /**
   * Override LitElement lifecycle callback to handle filter property change.
   * @param {Object} props
   * @protected
   */
  updated(props) {
    super.updated(props);
    if (props.has("filter")) {
      this._filterChanged(this.filter);
    }
  }
  /** @private */
  _initOverlay() {
    const overlay2 = this.$.overlay;
    overlay2._comboBox = this;
    overlay2.addEventListener("touchend", this._boundOnOverlayTouchAction);
    overlay2.addEventListener("touchmove", this._boundOnOverlayTouchAction);
    overlay2.addEventListener("mousedown", (e4) => e4.preventDefault());
    overlay2.addEventListener("opened-changed", (e4) => {
      this._overlayOpened = e4.detail.value;
    });
    this._overlayElement = overlay2;
  }
  /**
   * Create and initialize the scroller element.
   * Override to provide custom host reference.
   *
   * @protected
   */
  _initScroller(host) {
    const scroller = document.createElement(`${this._tagNamePrefix}-scroller`);
    scroller.owner = host || this;
    scroller.getItemLabel = this._getItemLabel.bind(this);
    scroller.addEventListener("selection-changed", this._boundOverlaySelectedItemChanged);
    const overlay2 = this._overlayElement;
    overlay2.renderer = (root2) => {
      if (!root2.innerHTML) {
        root2.appendChild(scroller);
      }
    };
    overlay2.requestContentUpdate();
    this._scroller = scroller;
  }
  /** @private */
  // eslint-disable-next-line @typescript-eslint/max-params
  _updateScroller(scroller, items, opened, loading, selectedItem, itemIdPath, focusedIndex, renderer, theme, itemClassNameGenerator) {
    if (scroller) {
      if (opened) {
        scroller.style.maxHeight = getComputedStyle(this).getPropertyValue(`--${this._tagNamePrefix}-overlay-max-height`) || "65vh";
      }
      scroller.setProperties({
        items: opened ? items : [],
        opened,
        loading,
        selectedItem,
        itemIdPath,
        focusedIndex,
        renderer,
        theme,
        itemClassNameGenerator
      });
    }
  }
  /** @private */
  _openedOrItemsChanged(opened, items, loading, keepOverlayOpened) {
    this._overlayOpened = opened && (keepOverlayOpened || loading || !!(items && items.length));
  }
  /** @private */
  _overlayOpenedChanged(opened, wasOpened) {
    if (opened) {
      this.dispatchEvent(new CustomEvent("vaadin-combo-box-dropdown-opened", { bubbles: true, composed: true }));
      this._onOpened();
    } else if (wasOpened && this._dropdownItems && this._dropdownItems.length) {
      this.close();
      this.dispatchEvent(new CustomEvent("vaadin-combo-box-dropdown-closed", { bubbles: true, composed: true }));
    }
  }
  /** @private */
  _focusedIndexChanged(index, oldIndex) {
    if (oldIndex === void 0) {
      return;
    }
    this._updateActiveDescendant(index);
  }
  /** @protected */
  _isInputFocused() {
    return this.inputElement && isElementFocused(this.inputElement);
  }
  /** @private */
  _updateActiveDescendant(index) {
    const input = this._nativeInput;
    if (!input) {
      return;
    }
    const item2 = this._getItemElements().find((el) => el.index === index);
    if (item2) {
      input.setAttribute("aria-activedescendant", item2.id);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }
  /** @private */
  _openedChanged(opened, wasOpened) {
    if (wasOpened === void 0) {
      return;
    }
    if (opened) {
      if (!this._isInputFocused() && !isTouch) {
        if (this.inputElement) {
          this.inputElement.focus();
        }
      }
    } else {
      this._onClosed();
    }
    const input = this._nativeInput;
    if (input) {
      input.setAttribute("aria-expanded", !!opened);
      if (opened) {
        input.setAttribute("aria-controls", this._scroller.id);
      } else {
        input.removeAttribute("aria-controls");
      }
    }
  }
  /** @private */
  _onOverlayTouchAction() {
    this._closeOnBlurIsPrevented = true;
    this.inputElement.blur();
    this._closeOnBlurIsPrevented = false;
  }
  /** @protected */
  _isClearButton(event) {
    return event.composedPath()[0] === this.clearElement;
  }
  /** @private */
  __onClearButtonMouseDown(event) {
    event.preventDefault();
    this.inputElement.focus();
  }
  /**
   * @param {Event} event
   * @protected
   */
  _onClearButtonClick(event) {
    event.preventDefault();
    this._onClearAction();
    if (this.opened) {
      this.requestContentUpdate();
    }
  }
  /**
   * @param {Event} event
   * @private
   */
  _onToggleButtonClick(event) {
    event.preventDefault();
    if (this.opened) {
      this.close();
    } else {
      this.open();
    }
  }
  /**
   * @param {Event} event
   * @protected
   */
  _onHostClick(event) {
    if (!this.autoOpenDisabled) {
      event.preventDefault();
      this.open();
    }
  }
  /** @private */
  _onClick(event) {
    if (this._isClearButton(event)) {
      this._onClearButtonClick(event);
    } else if (event.composedPath().includes(this._toggleElement)) {
      this._onToggleButtonClick(event);
    } else {
      this._onHostClick(event);
    }
  }
  /**
   * Override an event listener from `KeyboardMixin`.
   *
   * @param {KeyboardEvent} e
   * @protected
   * @override
   */
  _onKeyDown(e4) {
    super._onKeyDown(e4);
    if (e4.key === "ArrowDown") {
      this._onArrowDown();
      e4.preventDefault();
    } else if (e4.key === "ArrowUp") {
      this._onArrowUp();
      e4.preventDefault();
    }
  }
  /** @private */
  _getItemLabel(item2) {
    let label = item2 && this.itemLabelPath ? get2(this.itemLabelPath, item2) : void 0;
    if (label === void 0 || label === null) {
      label = item2 ? item2.toString() : "";
    }
    return label;
  }
  /** @private */
  _getItemValue(item2) {
    let value = item2 && this.itemValuePath ? get2(this.itemValuePath, item2) : void 0;
    if (value === void 0) {
      value = item2 ? item2.toString() : "";
    }
    return value;
  }
  /** @private */
  _onArrowDown() {
    if (this.opened) {
      const items = this._dropdownItems;
      if (items) {
        this._focusedIndex = Math.min(items.length - 1, this._focusedIndex + 1);
        this._prefillFocusedItemLabel();
      }
    } else {
      this.open();
    }
  }
  /** @private */
  _onArrowUp() {
    if (this.opened) {
      if (this._focusedIndex > -1) {
        this._focusedIndex = Math.max(0, this._focusedIndex - 1);
      } else {
        const items = this._dropdownItems;
        if (items) {
          this._focusedIndex = items.length - 1;
        }
      }
      this._prefillFocusedItemLabel();
    } else {
      this.open();
    }
  }
  /** @private */
  _prefillFocusedItemLabel() {
    if (this._focusedIndex > -1) {
      const focusedItem = this._dropdownItems[this._focusedIndex];
      this._inputElementValue = this._getItemLabel(focusedItem);
      this._markAllSelectionRange();
    }
  }
  /** @private */
  _setSelectionRange(start, end) {
    if (this._isInputFocused() && this.inputElement.setSelectionRange) {
      this.inputElement.setSelectionRange(start, end);
    }
  }
  /** @private */
  _markAllSelectionRange() {
    if (this._inputElementValue !== void 0) {
      this._setSelectionRange(0, this._inputElementValue.length);
    }
  }
  /** @private */
  _clearSelectionRange() {
    if (this._inputElementValue !== void 0) {
      const pos = this._inputElementValue ? this._inputElementValue.length : 0;
      this._setSelectionRange(pos, pos);
    }
  }
  /** @private */
  _closeOrCommit() {
    if (!this.opened && !this.loading) {
      this._commitValue();
    } else {
      this.close();
    }
  }
  /**
   * Override an event listener from `KeyboardMixin`.
   *
   * @param {KeyboardEvent} e
   * @protected
   * @override
   */
  _onEnter(e4) {
    if (!this._hasValidInputValue()) {
      e4.preventDefault();
      e4.stopPropagation();
      return;
    }
    if (this.opened) {
      e4.preventDefault();
      e4.stopPropagation();
    }
    this._closeOrCommit();
  }
  /**
   * @protected
   */
  _hasValidInputValue() {
    const hasInvalidOption = this._focusedIndex < 0 && this._inputElementValue !== "" && this._getItemLabel(this.selectedItem) !== this._inputElementValue;
    return this.allowCustomValue || !hasInvalidOption;
  }
  /**
   * Override an event listener from `KeyboardMixin`.
   * Do not call `super` in order to override clear
   * button logic defined in `InputControlMixin`.
   *
   * @param {!KeyboardEvent} e
   * @protected
   * @override
   */
  _onEscape(e4) {
    if (this.autoOpenDisabled && (this.opened || this.value !== this._inputElementValue && this._inputElementValue.length > 0)) {
      e4.stopPropagation();
      this._focusedIndex = -1;
      this.cancel();
    } else if (this.opened) {
      e4.stopPropagation();
      if (this._focusedIndex > -1) {
        this._focusedIndex = -1;
        this._revertInputValue();
      } else {
        this.cancel();
      }
    } else if (this.clearButtonVisible && !!this.value && !this.readonly) {
      e4.stopPropagation();
      this._onClearAction();
    }
  }
  /** @private */
  _toggleElementChanged(toggleElement) {
    if (toggleElement) {
      toggleElement.addEventListener("mousedown", (e4) => e4.preventDefault());
      toggleElement.addEventListener("click", () => {
        if (isTouch && !this._isInputFocused()) {
          document.activeElement.blur();
        }
      });
    }
  }
  /**
   * Clears the current value.
   * @protected
   */
  _onClearAction() {
    this.selectedItem = null;
    if (this.allowCustomValue) {
      this.value = "";
    }
    this._detectAndDispatchChange();
  }
  /**
   * Clears the current filter. Should be used instead of setting the property
   * directly in order to allow overriding this in multi-select combo box.
   * @protected
   */
  _clearFilter() {
    this.filter = "";
  }
  /**
   * Reverts back to original value.
   */
  cancel() {
    this._revertInputValueToValue();
    this._lastCommittedValue = this.value;
    this._closeOrCommit();
  }
  /** @private */
  _onOpened() {
    this._lastCommittedValue = this.value;
  }
  /** @private */
  _onClosed() {
    if (!this.loading || this.allowCustomValue) {
      this._commitValue();
    }
  }
  /** @private */
  _commitValue() {
    if (this._focusedIndex > -1) {
      const focusedItem = this._dropdownItems[this._focusedIndex];
      if (this.selectedItem !== focusedItem) {
        this.selectedItem = focusedItem;
      }
      this._inputElementValue = this._getItemLabel(this.selectedItem);
      this._focusedIndex = -1;
    } else if (this._inputElementValue === "" || this._inputElementValue === void 0) {
      this.selectedItem = null;
      if (this.allowCustomValue) {
        this.value = "";
      }
    } else {
      const items = [this.selectedItem, ...this._dropdownItems || []];
      const itemMatchingInputValue = items[this.__getItemIndexByLabel(items, this._inputElementValue)];
      if (this.allowCustomValue && // To prevent a repetitive input value being saved after pressing ESC and Tab.
      !itemMatchingInputValue) {
        const customValue = this._inputElementValue;
        this._lastCustomValue = customValue;
        const e4 = new CustomEvent("custom-value-set", {
          detail: customValue,
          composed: true,
          cancelable: true,
          bubbles: true
        });
        this.dispatchEvent(e4);
        if (!e4.defaultPrevented) {
          this.value = customValue;
        }
      } else if (!this.allowCustomValue && !this.opened && itemMatchingInputValue) {
        this.value = this._getItemValue(itemMatchingInputValue);
      } else {
        this._revertInputValueToValue();
      }
    }
    this._detectAndDispatchChange();
    this._clearSelectionRange();
    this._clearFilter();
  }
  /**
   * Override an event listener from `InputMixin`.
   * @param {!Event} event
   * @protected
   * @override
   */
  _onInput(event) {
    const filter = this._inputElementValue;
    const props = {};
    if (this.filter === filter) {
      this._filterChanged(this.filter);
    } else {
      props.filter = filter;
    }
    if (!this.opened && !this._isClearButton(event) && !this.autoOpenDisabled) {
      props.opened = true;
    }
    this.setProperties(props);
  }
  /**
   * Override an event listener from `InputMixin`.
   * @param {!Event} event
   * @protected
   * @override
   */
  _onChange(event) {
    event.stopPropagation();
  }
  /** @private */
  _itemLabelPathChanged(itemLabelPath) {
    if (typeof itemLabelPath !== "string") {
      console.error("You should set itemLabelPath to a valid string");
    }
  }
  /** @private */
  _filterChanged(filter) {
    this._scrollIntoView(0);
    this._focusedIndex = -1;
    if (this.items) {
      this.filteredItems = this._filterItems(this.items, filter);
    } else {
      this._filteredItemsChanged(this.filteredItems);
    }
  }
  /** @protected */
  _revertInputValue() {
    if (this.filter !== "") {
      this._inputElementValue = this.filter;
    } else {
      this._revertInputValueToValue();
    }
    this._clearSelectionRange();
  }
  /** @private */
  _revertInputValueToValue() {
    if (this.allowCustomValue && !this.selectedItem) {
      this._inputElementValue = this.value;
    } else {
      this._inputElementValue = this._getItemLabel(this.selectedItem);
    }
  }
  /** @private */
  _selectedItemChanged(selectedItem) {
    if (selectedItem === null || selectedItem === void 0) {
      if (this.filteredItems) {
        if (!this.allowCustomValue) {
          this.value = "";
        }
        this._toggleHasValue(this._hasValue);
        this._inputElementValue = this.value;
      }
    } else {
      const value = this._getItemValue(selectedItem);
      if (this.value !== value) {
        this.value = value;
        if (this.value !== value) {
          return;
        }
      }
      this._toggleHasValue(true);
      this._inputElementValue = this._getItemLabel(selectedItem);
    }
  }
  /**
   * Override an observer from `InputMixin`.
   * @protected
   * @override
   */
  _valueChanged(value, oldVal) {
    if (value === "" && oldVal === void 0) {
      return;
    }
    if (isValidValue(value)) {
      if (this._getItemValue(this.selectedItem) !== value) {
        this._selectItemForValue(value);
      }
      if (!this.selectedItem && this.allowCustomValue) {
        this._inputElementValue = value;
      }
      this._toggleHasValue(this._hasValue);
    } else {
      this.selectedItem = null;
    }
    this._clearFilter();
    this._lastCommittedValue = void 0;
  }
  /** @private */
  _detectAndDispatchChange() {
    if (document.hasFocus()) {
      this._requestValidation();
    }
    if (this.value !== this._lastCommittedValue) {
      this.dispatchEvent(new CustomEvent("change", { bubbles: true }));
      this._lastCommittedValue = this.value;
    }
  }
  /** @private */
  _itemsChanged(items, oldItems) {
    this._ensureItemsOrDataProvider(() => {
      this.items = oldItems;
    });
    if (items) {
      this.filteredItems = items.slice(0);
    } else if (oldItems) {
      this.filteredItems = null;
    }
  }
  /** @private */
  _filteredItemsChanged(filteredItems) {
    this._setDropdownItems(filteredItems);
  }
  /** @private */
  _filterItems(arr, filter) {
    if (!arr) {
      return arr;
    }
    const filteredItems = arr.filter((item2) => {
      filter = filter ? filter.toString().toLowerCase() : "";
      return this._getItemLabel(item2).toString().toLowerCase().indexOf(filter) > -1;
    });
    return filteredItems;
  }
  /** @private */
  _selectItemForValue(value) {
    const valueIndex = this.__getItemIndexByValue(this.filteredItems, value);
    const previouslySelectedItem = this.selectedItem;
    if (valueIndex >= 0) {
      this.selectedItem = this.filteredItems[valueIndex];
    } else if (this.dataProvider && this.selectedItem === void 0) {
      this.selectedItem = void 0;
    } else {
      this.selectedItem = null;
    }
    if (this.selectedItem === null && previouslySelectedItem === null) {
      this._selectedItemChanged(this.selectedItem);
    }
  }
  /**
   * Provide items to be rendered in the dropdown.
   * Override this method to show custom items.
   *
   * @protected
   */
  _setDropdownItems(newItems) {
    const oldItems = this._dropdownItems;
    this._dropdownItems = newItems;
    const focusedItem = oldItems ? oldItems[this._focusedIndex] : null;
    const valueIndex = this.__getItemIndexByValue(newItems, this.value);
    if ((this.selectedItem === null || this.selectedItem === void 0) && valueIndex >= 0) {
      this.selectedItem = newItems[valueIndex];
    }
    const focusedItemIndex = this.__getItemIndexByValue(newItems, this._getItemValue(focusedItem));
    if (focusedItemIndex > -1) {
      this._focusedIndex = focusedItemIndex;
    } else {
      this._focusedIndex = this.__getItemIndexByLabel(newItems, this.filter);
    }
  }
  /** @private */
  _getItemElements() {
    return Array.from(this._scroller.querySelectorAll(`${this._tagNamePrefix}-item`));
  }
  /** @private */
  _scrollIntoView(index) {
    if (!this._scroller) {
      return;
    }
    this._scroller.scrollIntoView(index);
  }
  /**
   * Returns the first item that matches the provided value.
   *
   * @private
   */
  __getItemIndexByValue(items, value) {
    if (!items || !isValidValue(value)) {
      return -1;
    }
    return findItemIndex(items, (item2) => {
      return this._getItemValue(item2) === value;
    });
  }
  /**
   * Returns the first item that matches the provided label.
   * Labels are matched against each other case insensitively.
   *
   * @private
   */
  __getItemIndexByLabel(items, label) {
    if (!items || !label) {
      return -1;
    }
    return findItemIndex(items, (item2) => {
      return this._getItemLabel(item2).toString().toLowerCase() === label.toString().toLowerCase();
    });
  }
  /** @private */
  _overlaySelectedItemChanged(e4) {
    e4.stopPropagation();
    if (e4.detail.item instanceof ComboBoxPlaceholder) {
      return;
    }
    if (this.opened) {
      this._focusedIndex = this.filteredItems.indexOf(e4.detail.item);
      this.close();
    }
  }
  /**
   * Override method inherited from `FocusMixin`
   * to close the overlay on blur and commit the value.
   *
   * @param {boolean} focused
   * @protected
   * @override
   */
  _setFocused(focused) {
    super._setFocused(focused);
    if (!focused && !this.readonly && !this._closeOnBlurIsPrevented) {
      if (!this.opened && this.allowCustomValue && this._inputElementValue === this._lastCustomValue) {
        delete this._lastCustomValue;
        return;
      }
      if (isKeyboardActive()) {
        this._closeOrCommit();
        return;
      }
      if (!this.opened) {
        this._commitValue();
      } else if (!this._overlayOpened) {
        this.close();
      }
    }
  }
  /**
   * Override method inherited from `FocusMixin` to not remove focused
   * state when focus moves to the overlay.
   *
   * @param {FocusEvent} event
   * @return {boolean}
   * @protected
   * @override
   */
  _shouldRemoveFocus(event) {
    if (event.relatedTarget && event.relatedTarget.localName === `${this._tagNamePrefix}-item`) {
      return false;
    }
    if (event.relatedTarget === this._overlayElement) {
      event.composedPath()[0].focus();
      return false;
    }
    return true;
  }
  /** @private */
  _onTouchend(event) {
    if (!this.clearElement || event.composedPath()[0] !== this.clearElement) {
      return;
    }
    event.preventDefault();
    this._onClearAction();
  }
  /**
   * Fired when the value changes.
   *
   * @event value-changed
   * @param {Object} detail
   * @param {String} detail.value the combobox value
   */
  /**
   * Fired when selected item changes.
   *
   * @event selected-item-changed
   * @param {Object} detail
   * @param {Object|String} detail.value the selected item. Type is the same as the type of `items`.
   */
  /**
   * Fired when the user sets a custom value.
   * @event custom-value-set
   * @param {String} detail the custom value
   */
  /**
   * Fired when the user commits a value change.
   * @event change
   */
  /**
   * Fired after the `vaadin-combo-box-overlay` opens.
   *
   * @event vaadin-combo-box-dropdown-opened
   */
  /**
   * Fired after the `vaadin-combo-box-overlay` closes.
   *
   * @event vaadin-combo-box-dropdown-closed
   */
};

// node_modules/@vaadin/combo-box/src/vaadin-combo-box.js
registerStyles("vaadin-combo-box", inputFieldShared2, { moduleId: "vaadin-combo-box-styles" });
var ComboBox = class extends ComboBoxDataProviderMixin(
  ComboBoxMixin(PatternMixin(InputControlMixin(ThemableMixin(ElementMixin2(PolymerElement)))))
) {
  static get is() {
    return "vaadin-combo-box";
  }
  static get template() {
    return html`
      <style>
        :host([opened]) {
          pointer-events: auto;
        }
      </style>

      <div class="vaadin-combo-box-container">
        <div part="label">
          <slot name="label"></slot>
          <span part="required-indicator" aria-hidden="true" on-click="focus"></span>
        </div>

        <vaadin-input-container
          part="input-field"
          readonly="[[readonly]]"
          disabled="[[disabled]]"
          invalid="[[invalid]]"
          theme$="[[_theme]]"
        >
          <slot name="prefix" slot="prefix"></slot>
          <slot name="input"></slot>
          <div id="clearButton" part="clear-button" slot="suffix" aria-hidden="true"></div>
          <div id="toggleButton" part="toggle-button" slot="suffix" aria-hidden="true"></div>
        </vaadin-input-container>

        <div part="helper-text">
          <slot name="helper"></slot>
        </div>

        <div part="error-message">
          <slot name="error-message"></slot>
        </div>
      </div>

      <vaadin-combo-box-overlay
        id="overlay"
        opened="[[_overlayOpened]]"
        loading$="[[loading]]"
        theme$="[[_theme]]"
        position-target="[[_positionTarget]]"
        no-vertical-overlap
      ></vaadin-combo-box-overlay>

      <slot name="tooltip"></slot>
    `;
  }
  static get properties() {
    return {
      /**
       * @protected
       */
      _positionTarget: {
        type: Object
      }
    };
  }
  /**
   * Used by `InputControlMixin` as a reference to the clear button element.
   * @protected
   * @return {!HTMLElement}
   */
  get clearElement() {
    return this.$.clearButton;
  }
  /** @protected */
  ready() {
    super.ready();
    this.addController(
      new InputController(this, (input) => {
        this._setInputElement(input);
        this._setFocusElement(input);
        this.stateTarget = input;
        this.ariaTarget = input;
      })
    );
    this.addController(new LabelledInputController(this.inputElement, this._labelController));
    this._tooltipController = new TooltipController(this);
    this.addController(this._tooltipController);
    this._tooltipController.setPosition("top");
    this._tooltipController.setAriaTarget(this.inputElement);
    this._tooltipController.setShouldShow((target) => !target.opened);
    this._positionTarget = this.shadowRoot.querySelector('[part="input-field"]');
    this._toggleElement = this.$.toggleButton;
  }
  /**
   * Override the method from `InputControlMixin`
   * to stop event propagation to prevent `ComboBoxMixin`
   * from handling this click event also on its own.
   *
   * @param {Event} event
   * @protected
   * @override
   */
  _onClearButtonClick(event) {
    event.stopPropagation();
    super._onClearButtonClick(event);
  }
  /**
   * @param {Event} event
   * @protected
   */
  _onHostClick(event) {
    const path = event.composedPath();
    if (path.includes(this._labelNode) || path.includes(this._positionTarget)) {
      super._onHostClick(event);
    }
  }
};
defineCustomElement(ComboBox);
/*! Bundled license information:

@vaadin/component-base/src/define.js:
@vaadin/vaadin-themable-mixin/src/css-utils.js:
@vaadin/component-base/src/dir-mixin.js:
@vaadin/input-container/src/vaadin-input-container-core-styles.js:
@vaadin/input-container/src/vaadin-input-container-mixin.js:
@vaadin/input-container/src/vaadin-input-container.js:
@vaadin/component-base/src/browser-utils.js:
@vaadin/a11y-base/src/aria-modal-controller.js:
@vaadin/a11y-base/src/focus-utils.js:
@vaadin/a11y-base/src/focus-restoration-controller.js:
@vaadin/a11y-base/src/focus-trap-controller.js:
@vaadin/component-base/src/controller-mixin.js:
@vaadin/component-base/src/dom-utils.js:
@vaadin/component-base/src/unique-id-utils.js:
@vaadin/component-base/src/virtualizer-iron-list-adapter.js:
@vaadin/component-base/src/element-mixin.js:
@vaadin/component-base/src/slot-controller.js:
@vaadin/a11y-base/src/focus-mixin.js:
@vaadin/a11y-base/src/disabled-mixin.js:
@vaadin/a11y-base/src/tabindex-mixin.js:
@vaadin/a11y-base/src/delegate-focus-mixin.js:
@vaadin/a11y-base/src/keyboard-mixin.js:
@vaadin/component-base/src/slot-styles-mixin.js:
@vaadin/field-base/src/input-mixin.js:
@vaadin/field-base/src/clear-button-mixin.js:
@vaadin/a11y-base/src/field-aria-controller.js:
@vaadin/field-base/src/error-controller.js:
@vaadin/field-base/src/helper-controller.js:
@vaadin/field-base/src/label-controller.js:
@vaadin/field-base/src/label-mixin.js:
@vaadin/field-base/src/validate-mixin.js:
@vaadin/field-base/src/field-mixin.js:
@vaadin/component-base/src/delegate-state-mixin.js:
@vaadin/field-base/src/input-constraints-mixin.js:
@vaadin/field-base/src/input-control-mixin.js:
@vaadin/field-base/src/input-controller.js:
@vaadin/field-base/src/labelled-input-controller.js:
@vaadin/field-base/src/pattern-mixin.js:
@vaadin/field-base/src/styles/button-core-styles.js:
@vaadin/field-base/src/styles/container-core-styles.js:
@vaadin/field-base/src/styles/field-core-styles.js:
@vaadin/field-base/src/styles/input-field-shared-styles.js:
@vaadin/component-base/src/data-provider-controller/helpers.js:
@vaadin/component-base/src/data-provider-controller/cache.js:
@vaadin/component-base/src/data-provider-controller/data-provider-controller.js:
@vaadin/component-base/src/templates.js:
@vaadin/field-base/src/virtual-keyboard-controller.js:
  (**
   * @license
   * Copyright (c) 2021 - 2025 Vaadin Ltd.
   * This program is available under Apache License Version 2.0, available at https://vaadin.com/license/
   *)

@vaadin/vaadin-lumo-styles/version.js:
@vaadin/vaadin-themable-mixin/vaadin-theme-property-mixin.js:
@vaadin/vaadin-themable-mixin/vaadin-themable-mixin.js:
@vaadin/vaadin-themable-mixin/register-styles.js:
@vaadin/vaadin-lumo-styles/color.js:
@vaadin/vaadin-lumo-styles/spacing.js:
@vaadin/vaadin-lumo-styles/style.js:
@vaadin/vaadin-lumo-styles/font-icons.js:
@vaadin/vaadin-lumo-styles/sizing.js:
@vaadin/vaadin-lumo-styles/typography.js:
@vaadin/vaadin-lumo-styles/mixins/overlay.js:
@vaadin/vaadin-lumo-styles/mixins/menu-overlay.js:
@vaadin/vaadin-lumo-styles/mixins/field-button.js:
@vaadin/vaadin-lumo-styles/mixins/helper.js:
@vaadin/vaadin-lumo-styles/mixins/required-field.js:
@vaadin/vaadin-lumo-styles/mixins/input-field-shared.js:
@vaadin/overlay/src/vaadin-overlay-focus-mixin.js:
@vaadin/overlay/src/vaadin-overlay-stack-mixin.js:
@vaadin/overlay/src/vaadin-overlay-mixin.js:
@vaadin/overlay/src/vaadin-overlay-core-styles.js:
@vaadin/overlay/src/vaadin-overlay-styles.js:
@vaadin/overlay/src/vaadin-overlay-position-mixin.js:
  (**
   * @license
   * Copyright (c) 2017 - 2025 Vaadin Ltd.
   * This program is available under Apache License Version 2.0, available at https://vaadin.com/license/
   *)

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/reactive-element.js:
lit-html/lit-html.js:
lit-element/lit-element.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@vaadin/vaadin-lumo-styles/mixins/loader.js:
@vaadin/component-base/src/tooltip-controller.js:
@vaadin/a11y-base/src/announce.js:
@vaadin/component-base/src/slot-child-observe-controller.js:
  (**
   * @license
   * Copyright (c) 2022 - 2025 Vaadin Ltd.
   * This program is available under Apache License Version 2.0, available at https://vaadin.com/license/
   *)

@polymer/polymer/lib/utils/boot.js:
@polymer/polymer/lib/utils/resolve-url.js:
@polymer/polymer/lib/utils/settings.js:
@polymer/polymer/lib/utils/mixin.js:
@polymer/polymer/lib/elements/dom-module.js:
@polymer/polymer/lib/utils/style-gather.js:
@polymer/polymer/lib/utils/wrap.js:
@polymer/polymer/lib/utils/path.js:
@polymer/polymer/lib/utils/case-map.js:
@polymer/polymer/lib/utils/async.js:
@polymer/polymer/lib/mixins/properties-changed.js:
@polymer/polymer/lib/mixins/property-accessors.js:
@polymer/polymer/lib/mixins/template-stamp.js:
@polymer/polymer/lib/utils/telemetry.js:
@polymer/polymer/lib/mixins/properties-mixin.js:
@polymer/polymer/lib/utils/html-tag.js:
@polymer/polymer/polymer-element.js:
@vaadin/component-base/src/debounce.js:
  (**
  @license
  Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
  This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
  The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
  The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
  Code distributed by Google as part of the polymer project is also
  subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
  *)

@polymer/polymer/lib/mixins/property-effects.js:
@polymer/polymer/lib/mixins/element-mixin.js:
  (**
   * @fileoverview
   * @suppress {checkPrototypalTypes}
   * @license Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
   * This code may only be used under the BSD style license found at
   * http://polymer.github.io/LICENSE.txt The complete set of authors may be found
   * at http://polymer.github.io/AUTHORS.txt The complete set of contributors may
   * be found at http://polymer.github.io/CONTRIBUTORS.txt Code distributed by
   * Google as part of the polymer project is also subject to an additional IP
   * rights grant found at http://polymer.github.io/PATENTS.txt
   *)

@vaadin/combo-box/src/vaadin-combo-box-item-mixin.js:
@vaadin/combo-box/src/vaadin-combo-box-item.js:
@vaadin/combo-box/src/vaadin-combo-box-overlay-mixin.js:
@vaadin/combo-box/src/vaadin-combo-box-overlay.js:
@vaadin/combo-box/src/vaadin-combo-box-placeholder.js:
@vaadin/combo-box/src/vaadin-combo-box-scroller-mixin.js:
@vaadin/combo-box/src/vaadin-combo-box-scroller.js:
@vaadin/combo-box/src/vaadin-combo-box-data-provider-mixin.js:
@vaadin/combo-box/src/vaadin-combo-box-mixin.js:
@vaadin/combo-box/src/vaadin-combo-box.js:
  (**
   * @license
   * Copyright (c) 2015 - 2025 Vaadin Ltd.
   * This program is available under Apache License Version 2.0, available at https://vaadin.com/license/
   *)

@vaadin/a11y-base/src/aria-hidden.js:
  (**
   * @license
   * Copyright (c) 2017 Anton Korzunov
   * SPDX-License-Identifier: MIT
   *)

@vaadin/overlay/src/vaadin-overlay-utils.js:
  (**
   * @license
   * Copyright (c) 2024 - 2025 Vaadin Ltd.
   * This program is available under Apache License Version 2.0, available at https://vaadin.com/license/
   *)

@vaadin/component-base/src/path-utils.js:
@vaadin/component-base/src/slot-observer.js:
@vaadin/a11y-base/src/aria-id-reference.js:
@vaadin/component-base/src/overlay-class-mixin.js:
  (**
   * @license
   * Copyright (c) 2023 - 2025 Vaadin Ltd.
   * This program is available under Apache License Version 2.0, available at https://vaadin.com/license/
   *)

@vaadin/component-base/src/async.js:
  (**
   * @license
   * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
   * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
   * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
   * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
   * Code distributed by Google as part of the polymer project is also
   * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
   *)

@vaadin/component-base/src/iron-list-core.js:
  (**
   * @license
   * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
   * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
   * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
   * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
   * Code distributed by Google as part of the polymer project is also
   * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
   *)

@vaadin/vaadin-usage-statistics/vaadin-usage-statistics-collect.js:
  (*! vaadin-dev-mode:start
    (function () {
  'use strict';
  
  var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
    return typeof obj;
  } : function (obj) {
    return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
  };
  
  var classCallCheck = function (instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  };
  
  var createClass = function () {
    function defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
      }
    }
  
    return function (Constructor, protoProps, staticProps) {
      if (protoProps) defineProperties(Constructor.prototype, protoProps);
      if (staticProps) defineProperties(Constructor, staticProps);
      return Constructor;
    };
  }();
  
  var getPolymerVersion = function getPolymerVersion() {
    return window.Polymer && window.Polymer.version;
  };
  
  var StatisticsGatherer = function () {
    function StatisticsGatherer(logger) {
      classCallCheck(this, StatisticsGatherer);
  
      this.now = new Date().getTime();
      this.logger = logger;
    }
  
    createClass(StatisticsGatherer, [{
      key: 'frameworkVersionDetectors',
      value: function frameworkVersionDetectors() {
        return {
          'Flow': function Flow() {
            if (window.Vaadin && window.Vaadin.Flow && window.Vaadin.Flow.clients) {
              var flowVersions = Object.keys(window.Vaadin.Flow.clients).map(function (key) {
                return window.Vaadin.Flow.clients[key];
              }).filter(function (client) {
                return client.getVersionInfo;
              }).map(function (client) {
                return client.getVersionInfo().flow;
              });
              if (flowVersions.length > 0) {
                return flowVersions[0];
              }
            }
          },
          'Vaadin Framework': function VaadinFramework() {
            if (window.vaadin && window.vaadin.clients) {
              var frameworkVersions = Object.values(window.vaadin.clients).filter(function (client) {
                return client.getVersionInfo;
              }).map(function (client) {
                return client.getVersionInfo().vaadinVersion;
              });
              if (frameworkVersions.length > 0) {
                return frameworkVersions[0];
              }
            }
          },
          'AngularJs': function AngularJs() {
            if (window.angular && window.angular.version && window.angular.version) {
              return window.angular.version.full;
            }
          },
          'Angular': function Angular() {
            if (window.ng) {
              var tags = document.querySelectorAll("[ng-version]");
              if (tags.length > 0) {
                return tags[0].getAttribute("ng-version");
              }
              return "Unknown";
            }
          },
          'Backbone.js': function BackboneJs() {
            if (window.Backbone) {
              return window.Backbone.VERSION;
            }
          },
          'React': function React() {
            var reactSelector = '[data-reactroot], [data-reactid]';
            if (!!document.querySelector(reactSelector)) {
              // React does not publish the version by default
              return "unknown";
            }
          },
          'Ember': function Ember() {
            if (window.Em && window.Em.VERSION) {
              return window.Em.VERSION;
            } else if (window.Ember && window.Ember.VERSION) {
              return window.Ember.VERSION;
            }
          },
          'jQuery': function (_jQuery) {
            function jQuery() {
              return _jQuery.apply(this, arguments);
            }
  
            jQuery.toString = function () {
              return _jQuery.toString();
            };
  
            return jQuery;
          }(function () {
            if (typeof jQuery === 'function' && jQuery.prototype.jquery !== undefined) {
              return jQuery.prototype.jquery;
            }
          }),
          'Polymer': function Polymer() {
            var version = getPolymerVersion();
            if (version) {
              return version;
            }
          },
          'LitElement': function LitElement() {
            var version = window.litElementVersions && window.litElementVersions[0];
            if (version) {
              return version;
            }
          },
          'LitHtml': function LitHtml() {
            var version = window.litHtmlVersions && window.litHtmlVersions[0];
            if (version) {
              return version;
            }
          },
          'Vue.js': function VueJs() {
            if (window.Vue) {
              return window.Vue.version;
            }
          }
        };
      }
    }, {
      key: 'getUsedVaadinElements',
      value: function getUsedVaadinElements(elements) {
        var version = getPolymerVersion();
        var elementClasses = void 0;
        // NOTE: In case you edit the code here, YOU MUST UPDATE any statistics reporting code in Flow.
        // Check all locations calling the method getEntries() in
        // https://github.com/vaadin/flow/blob/master/flow-server/src/main/java/com/vaadin/flow/internal/UsageStatistics.java#L106
        // Currently it is only used by BootstrapHandler.
        if (version && version.indexOf('2') === 0) {
          // Polymer 2: components classes are stored in window.Vaadin
          elementClasses = Object.keys(window.Vaadin).map(function (c) {
            return window.Vaadin[c];
          }).filter(function (c) {
            return c.is;
          });
        } else {
          // Polymer 3: components classes are stored in window.Vaadin.registrations
          elementClasses = window.Vaadin.registrations || [];
        }
        elementClasses.forEach(function (klass) {
          var version = klass.version ? klass.version : "0.0.0";
          elements[klass.is] = { version: version };
        });
      }
    }, {
      key: 'getUsedVaadinThemes',
      value: function getUsedVaadinThemes(themes) {
        ['Lumo', 'Material'].forEach(function (themeName) {
          var theme;
          var version = getPolymerVersion();
          if (version && version.indexOf('2') === 0) {
            // Polymer 2: themes are stored in window.Vaadin
            theme = window.Vaadin[themeName];
          } else {
            // Polymer 3: themes are stored in custom element registry
            theme = customElements.get('vaadin-' + themeName.toLowerCase() + '-styles');
          }
          if (theme && theme.version) {
            themes[themeName] = { version: theme.version };
          }
        });
      }
    }, {
      key: 'getFrameworks',
      value: function getFrameworks(frameworks) {
        var detectors = this.frameworkVersionDetectors();
        Object.keys(detectors).forEach(function (framework) {
          var detector = detectors[framework];
          try {
            var version = detector();
            if (version) {
              frameworks[framework] = { version: version };
            }
          } catch (e) {}
        });
      }
    }, {
      key: 'gather',
      value: function gather(storage) {
        var storedStats = storage.read();
        var gatheredStats = {};
        var types = ["elements", "frameworks", "themes"];
  
        types.forEach(function (type) {
          gatheredStats[type] = {};
          if (!storedStats[type]) {
            storedStats[type] = {};
          }
        });
  
        var previousStats = JSON.stringify(storedStats);
  
        this.getUsedVaadinElements(gatheredStats.elements);
        this.getFrameworks(gatheredStats.frameworks);
        this.getUsedVaadinThemes(gatheredStats.themes);
  
        var now = this.now;
        types.forEach(function (type) {
          var keys = Object.keys(gatheredStats[type]);
          keys.forEach(function (key) {
            if (!storedStats[type][key] || _typeof(storedStats[type][key]) != _typeof({})) {
              storedStats[type][key] = { firstUsed: now };
            }
            // Discards any previously logged version number
            storedStats[type][key].version = gatheredStats[type][key].version;
            storedStats[type][key].lastUsed = now;
          });
        });
  
        var newStats = JSON.stringify(storedStats);
        storage.write(newStats);
        if (newStats != previousStats && Object.keys(storedStats).length > 0) {
          this.logger.debug("New stats: " + newStats);
        }
      }
    }]);
    return StatisticsGatherer;
  }();
  
  var StatisticsStorage = function () {
    function StatisticsStorage(key) {
      classCallCheck(this, StatisticsStorage);
  
      this.key = key;
    }
  
    createClass(StatisticsStorage, [{
      key: 'read',
      value: function read() {
        var localStorageStatsString = localStorage.getItem(this.key);
        try {
          return JSON.parse(localStorageStatsString ? localStorageStatsString : '{}');
        } catch (e) {
          return {};
        }
      }
    }, {
      key: 'write',
      value: function write(data) {
        localStorage.setItem(this.key, data);
      }
    }, {
      key: 'clear',
      value: function clear() {
        localStorage.removeItem(this.key);
      }
    }, {
      key: 'isEmpty',
      value: function isEmpty() {
        var storedStats = this.read();
        var empty = true;
        Object.keys(storedStats).forEach(function (key) {
          if (Object.keys(storedStats[key]).length > 0) {
            empty = false;
          }
        });
  
        return empty;
      }
    }]);
    return StatisticsStorage;
  }();
  
  var StatisticsSender = function () {
    function StatisticsSender(url, logger) {
      classCallCheck(this, StatisticsSender);
  
      this.url = url;
      this.logger = logger;
    }
  
    createClass(StatisticsSender, [{
      key: 'send',
      value: function send(data, errorHandler) {
        var logger = this.logger;
  
        if (navigator.onLine === false) {
          logger.debug("Offline, can't send");
          errorHandler();
          return;
        }
        logger.debug("Sending data to " + this.url);
  
        var req = new XMLHttpRequest();
        req.withCredentials = true;
        req.addEventListener("load", function () {
          // Stats sent, nothing more to do
          logger.debug("Response: " + req.responseText);
        });
        req.addEventListener("error", function () {
          logger.debug("Send failed");
          errorHandler();
        });
        req.addEventListener("abort", function () {
          logger.debug("Send aborted");
          errorHandler();
        });
        req.open("POST", this.url);
        req.setRequestHeader("Content-Type", "application/json");
        req.send(data);
      }
    }]);
    return StatisticsSender;
  }();
  
  var StatisticsLogger = function () {
    function StatisticsLogger(id) {
      classCallCheck(this, StatisticsLogger);
  
      this.id = id;
    }
  
    createClass(StatisticsLogger, [{
      key: '_isDebug',
      value: function _isDebug() {
        return localStorage.getItem("vaadin." + this.id + ".debug");
      }
    }, {
      key: 'debug',
      value: function debug(msg) {
        if (this._isDebug()) {
          console.info(this.id + ": " + msg);
        }
      }
    }]);
    return StatisticsLogger;
  }();
  
  var UsageStatistics = function () {
    function UsageStatistics() {
      classCallCheck(this, UsageStatistics);
  
      this.now = new Date();
      this.timeNow = this.now.getTime();
      this.gatherDelay = 10; // Delay between loading this file and gathering stats
      this.initialDelay = 24 * 60 * 60;
  
      this.logger = new StatisticsLogger("statistics");
      this.storage = new StatisticsStorage("vaadin.statistics.basket");
      this.gatherer = new StatisticsGatherer(this.logger);
      this.sender = new StatisticsSender("https://tools.vaadin.com/usage-stats/submit", this.logger);
    }
  
    createClass(UsageStatistics, [{
      key: 'maybeGatherAndSend',
      value: function maybeGatherAndSend() {
        var _this = this;
  
        if (localStorage.getItem(UsageStatistics.optOutKey)) {
          return;
        }
        this.gatherer.gather(this.storage);
        setTimeout(function () {
          _this.maybeSend();
        }, this.gatherDelay * 1000);
      }
    }, {
      key: 'lottery',
      value: function lottery() {
        return true;
      }
    }, {
      key: 'currentMonth',
      value: function currentMonth() {
        return this.now.getYear() * 12 + this.now.getMonth();
      }
    }, {
      key: 'maybeSend',
      value: function maybeSend() {
        var firstUse = Number(localStorage.getItem(UsageStatistics.firstUseKey));
        var monthProcessed = Number(localStorage.getItem(UsageStatistics.monthProcessedKey));
  
        if (!firstUse) {
          // Use a grace period to avoid interfering with tests, incognito mode etc
          firstUse = this.timeNow;
          localStorage.setItem(UsageStatistics.firstUseKey, firstUse);
        }
  
        if (this.timeNow < firstUse + this.initialDelay * 1000) {
          this.logger.debug("No statistics will be sent until the initial delay of " + this.initialDelay + "s has passed");
          return;
        }
        if (this.currentMonth() <= monthProcessed) {
          this.logger.debug("This month has already been processed");
          return;
        }
        localStorage.setItem(UsageStatistics.monthProcessedKey, this.currentMonth());
        // Use random sampling
        if (this.lottery()) {
          this.logger.debug("Congratulations, we have a winner!");
        } else {
          this.logger.debug("Sorry, no stats from you this time");
          return;
        }
  
        this.send();
      }
    }, {
      key: 'send',
      value: function send() {
        // Ensure we have the latest data
        this.gatherer.gather(this.storage);
  
        // Read, send and clean up
        var data = this.storage.read();
        data["firstUse"] = Number(localStorage.getItem(UsageStatistics.firstUseKey));
        data["usageStatisticsVersion"] = UsageStatistics.version;
        var info = 'This request contains usage statistics gathered from the application running in development mode. \n\nStatistics gathering is automatically disabled and excluded from production builds.\n\nFor details and to opt-out, see https://github.com/vaadin/vaadin-usage-statistics.\n\n\n\n';
        var self = this;
        this.sender.send(info + JSON.stringify(data), function () {
          // Revert the 'month processed' flag
          localStorage.setItem(UsageStatistics.monthProcessedKey, self.currentMonth() - 1);
        });
      }
    }], [{
      key: 'version',
      get: function get$1() {
        return '2.1.2';
      }
    }, {
      key: 'firstUseKey',
      get: function get$1() {
        return 'vaadin.statistics.firstuse';
      }
    }, {
      key: 'monthProcessedKey',
      get: function get$1() {
        return 'vaadin.statistics.monthProcessed';
      }
    }, {
      key: 'optOutKey',
      get: function get$1() {
        return 'vaadin.statistics.optout';
      }
    }]);
    return UsageStatistics;
  }();
  
  try {
    window.Vaadin = window.Vaadin || {};
    window.Vaadin.usageStatsChecker = window.Vaadin.usageStatsChecker || new UsageStatistics();
    window.Vaadin.usageStatsChecker.maybeGatherAndSend();
  } catch (e) {
    // Intentionally ignored as this is not a problem in the app being developed
  }
  
  }());
  
    vaadin-dev-mode:end **)
*/
