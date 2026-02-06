(() => {
  const DEFAULT_FUNCTIONS = Object.freeze({
    abs: (value) => {
      if (!Number.isFinite(value)) {
        throw new Error('abs requires a finite number.');
      }
      return Math.abs(value);
    },
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    min: Math.min,
    max: Math.max,
    clamp: (value, min, max) => {
      if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
        throw new Error('clamp requires three finite numbers.');
      }
      return Math.min(Math.max(value, min), max);
    }
  });

  const normalizeVariableKey = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) {
      throw new Error('Variable key cannot be empty.');
    }
    const normalized = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!normalized) {
      throw new Error(`Variable key "${value}" has no alphanumeric characters.`);
    }
    return normalized;
  };

  class Tokenizer {
    constructor(input) {
      this.input = String(input || '');
      this.index = 0;
      this.current = null;
    }

    peek() {
      if (!this.current) {
        this.current = this._nextToken();
      }
      return this.current;
    }

    next() {
      const token = this.peek();
      this.current = null;
      return token;
    }

    _skipWhitespace() {
      while (this.index < this.input.length && /\s/.test(this.input[this.index])) {
        this.index += 1;
      }
    }

    _nextToken() {
      this._skipWhitespace();
      if (this.index >= this.input.length) {
        return { type: 'eof', value: '' };
      }
      const remaining = this.input.slice(this.index);
      const numberMatch = remaining.match(/^(\d+(\.\d*)?|\.\d+)/);
      if (numberMatch) {
        const raw = numberMatch[0];
        this.index += raw.length;
        return { type: 'number', value: Number(raw) };
      }
      const identMatch = remaining.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
      if (identMatch) {
        const name = identMatch[0];
        this.index += name.length;
        return { type: 'identifier', value: name };
      }
      const char = this.input[this.index];
      if ('+-*/^'.includes(char)) {
        this.index += 1;
        return { type: 'operator', value: char };
      }
      if (char === '(' || char === ')') {
        this.index += 1;
        return { type: 'paren', value: char };
      }
      if (char === ',') {
        this.index += 1;
        return { type: 'comma', value: char };
      }
      throw new Error(`Unexpected character '${char}' at position ${this.index}.`);
    }
  }

  const parseExpression = (tokens) => {
    let node = parseTerm(tokens);
    while (true) {
      const token = tokens.peek();
      if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
        tokens.next();
        const right = parseTerm(tokens);
        node = { type: 'binary', op: token.value, left: node, right };
        continue;
      }
      break;
    }
    return node;
  };

  const parseTerm = (tokens) => {
    let node = parseExponent(tokens);
    while (true) {
      const token = tokens.peek();
      if (token.type === 'operator' && (token.value === '*' || token.value === '/')) {
        tokens.next();
        const right = parseExponent(tokens);
        node = { type: 'binary', op: token.value, left: node, right };
        continue;
      }
      break;
    }
    return node;
  };

  const parseExponent = (tokens) => {
    let node = parseUnary(tokens);
    const token = tokens.peek();
    if (token.type === 'operator' && token.value === '^') {
      tokens.next();
      const right = parseExponent(tokens);
      node = { type: 'binary', op: '^', left: node, right };
    }
    return node;
  };

  const parseUnary = (tokens) => {
    const token = tokens.peek();
    if (token.type === 'operator' && token.value === '-') {
      tokens.next();
      const expr = parseUnary(tokens);
      return { type: 'unary', op: '-', expr };
    }
    return parsePrimary(tokens);
  };

  const parsePrimary = (tokens) => {
    const token = tokens.next();
    if (token.type === 'number') {
      return { type: 'number', value: token.value };
    }
    if (token.type === 'identifier') {
      const nextToken = tokens.peek();
      if (nextToken.type === 'paren' && nextToken.value === '(') {
        tokens.next();
        const args = [];
        const lookahead = tokens.peek();
        if (!(lookahead.type === 'paren' && lookahead.value === ')')) {
          args.push(parseExpression(tokens));
          while (tokens.peek().type === 'comma') {
            tokens.next();
            args.push(parseExpression(tokens));
          }
        }
        const closing = tokens.next();
        if (closing.type !== 'paren' || closing.value !== ')') {
          throw new Error('Expected ")" after function arguments.');
        }
        return { type: 'call', name: token.value, args };
      }
      return { type: 'variable', name: token.value };
    }
    if (token.type === 'paren' && token.value === '(') {
      const expr = parseExpression(tokens);
      const closing = tokens.next();
      if (closing.type !== 'paren' || closing.value !== ')') {
        throw new Error('Expected ")" after expression.');
      }
      return expr;
    }
    throw new Error(`Unexpected token '${token.value}' in expression.`);
  };

  const resolveVariable = (name, variables) => {
    if (name === 'infinity') {
      return 1e100;
    }
    if (!variables || typeof variables !== 'object') {
      throw new Error(`Missing variables for '${name}'.`);
    }
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return coerceNumber(name, variables[name]);
    }
    if (name.includes('.')) {
      const parts = name.split('.');
      let current = variables;
      for (const part of parts) {
        if (!current || typeof current !== 'object' || !(part in current)) {
          throw new Error(`Unknown variable '${name}'.`);
        }
        current = current[part];
      }
      return coerceNumber(name, current);
    }
    throw new Error(`Unknown variable '${name}'.`);
  };

  const coerceNumber = (label, value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Variable '${label}' is not a finite number.`);
    }
    return numeric;
  };

  const evaluateNode = (node, variables, functions) => {
    switch (node.type) {
      case 'number':
        return node.value;
      case 'variable':
        return resolveVariable(node.name, variables);
      case 'unary': {
        const val = evaluateNode(node.expr, variables, functions);
        return -val;
      }
      case 'binary': {
        const left = evaluateNode(node.left, variables, functions);
        const right = evaluateNode(node.right, variables, functions);
        switch (node.op) {
          case '+':
            return left + right;
          case '-':
            return left - right;
          case '*':
            return left * right;
          case '/':
            return left / right;
          case '^':
            return Math.pow(left, right);
          default:
            throw new Error(`Unsupported operator '${node.op}'.`);
        }
      }
      case 'call': {
        const fn = functions[node.name];
        if (typeof fn !== 'function') {
          throw new Error(`Unknown function '${node.name}'.`);
        }
        const args = node.args.map(arg => evaluateNode(arg, variables, functions));
        return fn(...args);
      }
      default:
        throw new Error('Invalid expression node.');
    }
  };

  const compile = (expression, customFunctions = {}) => {
    if (typeof expression !== 'string') {
      throw new Error('Expression must be a string.');
    }
    const trimmed = expression.trim();
    if (!trimmed) {
      throw new Error('Expression cannot be empty.');
    }
    const tokens = new Tokenizer(trimmed);
    const ast = parseExpression(tokens);
    const tail = tokens.next();
    if (tail.type !== 'eof') {
      throw new Error(`Unexpected token '${tail.value}' after expression.`);
    }
    const functions = { ...DEFAULT_FUNCTIONS, ...customFunctions };
    return (variables = {}) => {
      const result = evaluateNode(ast, variables, functions);
      if (!Number.isFinite(result)) {
        throw new Error('Expression result is not a finite number.');
      }
      return result;
    };
  };

  const collectVariables = (expression) => {
    if (typeof expression !== 'string') {
      throw new Error('Expression must be a string.');
    }
    const trimmed = expression.trim();
    if (!trimmed) {
      throw new Error('Expression cannot be empty.');
    }
    const tokens = new Tokenizer(trimmed);
    const ast = parseExpression(tokens);
    const tail = tokens.next();
    if (tail.type !== 'eof') {
      throw new Error(`Unexpected token '${tail.value}' after expression.`);
    }

    const variables = new Set();
    const walk = (node) => {
      if (!node || typeof node !== 'object') {
        return;
      }
      switch (node.type) {
        case 'variable':
          variables.add(node.name);
          break;
        case 'unary':
          walk(node.expr);
          break;
        case 'binary':
          walk(node.left);
          walk(node.right);
          break;
        case 'call':
          node.args.forEach(arg => walk(arg));
          break;
        default:
          break;
      }
    };
    walk(ast);
    return Array.from(variables);
  };

  const FormulaEvaluator = {
    compile,
    collectVariables,
    normalizeVariableKey
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FormulaEvaluator;
  }
  if (typeof window !== 'undefined') {
    window.FormulaEvaluator = FormulaEvaluator;
  }
})();
